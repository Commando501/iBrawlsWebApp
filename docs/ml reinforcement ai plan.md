# RL for iBrawls (Grifball) — TS Headless Sim + Python Self-Play Trainer

## Context

The "iBrawls" mode is **Grifball** (4v4: carry the ball to the enemy goal plate, first
team to `goalTarget` goals — default 5). Today the AI is entirely heuristic/FSM
(`src/game/ai*.ts`) with no learning. We will train a strongly-optimized policy via
**reinforcement learning with self-play**, for **research/offline** use (no in-browser
realtime deployment constraint yet).

**Chosen architecture (Option 2): TS sim + Python trainer.** The game engine is TypeScript,
so we keep **one** simulation in TS (zero divergence from the real game) and expose it as a
fast, headless, **vectorized env server** over a **binary batched transport**. Learning runs
in **Python** with the mature RL stack (PyTorch + Stable-Baselines3 / CleanRL), which owns the
PPO self-play loop, GPU math, and league bookkeeping.

RL needs tens of millions of steps, so the gating prerequisite is a deterministic headless TS
engine. The rules core is already pure and tested, but physics/collision/weapon integration
and the tick live inside the 9,186-line React component `src/components/GrifballGame.tsx`
(`updatePhysics` 5184–~6963, `enforceArenaBounds` 504, `updateGrifball` 736, `updateMatchTimers`
750, `updateSingleAIEntity` 6963), fused with DOM input, React refs, and `Math.random` (91
coupled call sites). We extract a **parallel pure engine** into a new `src/sim/` tree and leave
`GrifballGame.tsx` untouched as the fidelity reference.

Per the user's selections: TS sim + Python trainer · self-play · research/offline.

## Goals & non-goals

- **Goal:** deterministic, seeded, allocation-light TS `stepSimulation()` advancing a full
  Grifball match from per-combatant action inputs, reusing existing pure modules.
- **Goal:** a TS **vec-env server** that batches N parallel matches and exchanges **flat binary
  Float32/Int32 buffers** (never per-step JSON) with Python.
- **Goal:** a Python **Gymnasium-compatible VecEnv client** + a **PPO self-play learner** with a
  league/opponent-sampler, checkpointing, and eval-vs-heuristic.
- **Goal:** baseline harness — random + wrapped-heuristic-AI policies as bootstrap opponents and
  benchmarks.
- **Non-goal (this phase):** browser/ONNX export, server inference for live play.
- **Non-goal:** modifying the live game runtime.

## Approach

### A. Deterministic headless TS engine — `src/sim/`

DOM/THREE-free, seeded; plain `Vec3` (the `grifballBall.ts` shape) instead of `THREE.Vector3`.

- `src/sim/rng.ts` — seeded PRNG (mulberry32/xorshift). **All** randomness via injected `rng`;
  no `Math.random` anywhere under `src/sim/`.
- `src/sim/simState.ts` — serializable `SimState` { `SimCombatant[]`, `GrifballMatchState`
  (reuse), `TeamScoresState` (reuse), map ref, tick count, seed }. `SimCombatant` is a Vec3-based
  mirror of `Combatant` (pos/vel/yaw/hp/weapon/weaponState/timers/team/has-ball), no React coupling.
- `src/sim/actions.ts` — `ActionInput` per combatant ({ moveX, moveZ, aim, jump, dash, crouch,
  attackPrimary, attackSecondary/pass, passCharge, swapWeapon }). The seam that **replaces**
  keyboard/gamepad/mobile input read in `updatePhysics`.
- `src/sim/physics.ts` — **port** movement integration, sprint/slide/dash, jump/hammer-jump,
  crouch, arena/map collision out of `updatePhysics` + `enforceArenaBounds` into pure functions.
  Reuse `src/game/mapPhysics.ts`, `src/game/mapNavigation.ts`.
- `src/sim/weapons.ts` — port weapon FSM + hit detection (hammer swing/splash, sword lunge,
  punch/ball, swap lockout, damage, respawn timers). Reuse `weaponCompat.ts`; emit kill events
  for `rewards.ts` medals.
- `src/sim/grifball.ts` — objective tick reusing pure modules: `tickBallPhysics`/`findBallPickup`/
  `attachBallTo`/`throwBall`/`dropBall` (`grifballBall.ts`), `grifballGoals.ts`, `registerGoal`/
  `tickGrifballMatch` (`grifballMatch.ts`), `teamScoring.ts`, `grifballTeams.ts`, `roster.ts`,
  `rosterSlotConfig.ts`. Carrier perks (+HP, punch swap, heal-on-pickup) mirror
  `grifballObjectiveRuntime.ts`.
- `src/sim/step.ts` — `stepSimulation(state, actionsById, dt, rng)`, one **fixed** tick
  (`dt = 1/60`): ingest actions → physics → weapons/damage → grifball → match timers → respawns.
  Returns per-tick events (goals/kills/deaths) for reward calc.
- `src/sim/factory.ts` — `createMatch({ seed, teamSizes, settings, map })` (reuse
  `UniversalSettings` defaults, `grifballMaps.ts`/`premadeMaps.ts`).

**Fidelity:** port verbatim where feasible, pin with golden tests; drop browser-only concerns
(camera/VFX/audio/nameplates/replay). Document divergences in `src/sim/README.md`.

### B. Observation / action / reward (TS side) — `src/sim/env/`

- `src/sim/env/observation.ts` — `encodeObservation(state, agentId, outFloat32, offset)`:
  ego-centric, **fixed-width**, writes directly into a shared buffer (no per-step allocation).
  Self (pos rel to own & enemy goal, vel, yaw, hp/maxHp, weapon one-hot, weapon cooldown,
  has-ball, dash/jump/crouch timers); ball (rel pos, vel, state one-hot, holder∈{self,team,enemy,
  none}); fixed teammate/opponent slots (rel pos, vel, hp, weapon, has-ball) with presence masks
  for <4v4; match context (score diff, phase one-hot, phase timer, clock). Layout/dim documented
  and exported as a constant shared with Python.
- `src/sim/env/action.ts` — factorized **discrete** action space (move 8-way+idle; aim
  toward-ball/toward-enemy/hold; attack none/primary/secondary; jump 0/1; dash 0/1; swap 0/1);
  `decodeAction(int32[]) → ActionInput`. Action layout exported as a shared constant.
- `src/sim/env/reward.ts` — `RewardConfig`-driven: terminal win/loss + goal scored/conceded, plus
  dense shaping (possession, ball-progress-toward-enemy-goal delta, kills/deaths/damage from
  `teamScoring.ts`, optional medal bonuses from `rewards.ts`). All weights configurable.

### C. Vec-env server + binary transport — `src/sim/server/`

The performance-critical boundary. **Batched, binary, zero per-step JSON.**

- `src/sim/server/vecEnv.ts` — owns `N` parallel `SimState`s. `reset()` and
  `step(actionsInt32) → { obs: Float32Array, reward: Float32Array, done: Uint8Array, info }`,
  laid out as contiguous `[numEnvs × numAgents × dim]` arrays reused across calls. Auto-resets a
  finished match and inserts its terminal obs per Gymnasium convention.
- `src/sim/server/protocol.ts` — wire format: length-prefixed binary frames. Header (numEnvs,
  numAgents, obsDim, actDim, seed) sent once on handshake; per step Python sends an `Int32` action
  block, Node returns concatenated `obs`+`reward`+`done` blocks. No JSON on the hot path (JSON only
  for the one-time handshake/config).
- `src/sim/server/main.ts` — transport host. **Default: stdio** (Python `subprocess` spawns Node,
  exchanges length-prefixed buffers over stdin/stdout) for simplicity and zero network setup;
  pluggable to a Unix domain socket / TCP later. Obs encoding stays in Node (cheap), so each
  round-trip moves only raw tensors for hundreds/thousands of envs at once.
- Scaling lever (documented, not required day 1): multiple Node worker processes, one learner.

### D. Python trainer — `python/` (new top-level dir, separate from the npm app)

- `python/ibrawls_rl/envs/grifball_vec_env.py` — Gymnasium `VectorEnv` client speaking the binary
  protocol to the Node server process (spawn + handshake + step). Exposes `MultiAgentVecEnv`
  semantics (agents flattened into the batch dimension for shared-policy self-play).
- `python/ibrawls_rl/spaces.py` — builds `observation_space`/`action_space` from the handshake
  header so Python never hard-codes dims (single source of truth = TS constants).
- `python/ibrawls_rl/policies.py` — actor-critic MLP (PyTorch); shared policy across all agents.
- `python/ibrawls_rl/selfplay.py` — `OpponentSampler` (latest snapshot + PFSP league),
  `PolicySnapshot` save/load, opponent-vs-learner agent assignment per env.
- `python/ibrawls_rl/train_ppo.py` — PPO loop. **Start on Stable-Baselines3** for a fast working
  baseline; keep a CleanRL single-file variant as the customizable path for self-play league logic.
  Checkpoints, TensorBoard logging, periodic eval vs heuristic + vs frozen snapshots.
- `python/ibrawls_rl/eval.py` — head-to-head over K matches (win rate, goal diff, K/D, length).
- `python/pyproject.toml` / `requirements.txt` — `torch`, `stable-baselines3`, `gymnasium`,
  `numpy`, `tensorboard`. `python/README.md` documents the spawn/handshake and how to run training.

### E. Baseline policies (both sides) — `src/sim/harness/`

- `randomPolicy.ts` (masked random) and `heuristicPolicy.ts` — adapter exposing the existing FSM
  AI as a `Policy` over `SimState→ActionInput`, so scripted bots are the **bootstrap opponent**
  and the **benchmark**. (Adapt `aiCombatDecision.ts`/`aiGrifballRoles.ts`; if too coupled, a
  faithful thin re-derivation, noted in README.) The heuristic also runs **inside the Node server**
  as a built-in opponent id so Python can request "play vs heuristic" without shipping a policy.

### F. Wiring

- TS: new `src/sim/**`, `*.test.ts` beside sources, appended to the `test` script in
  `package.json`. npm scripts: `sim:bench` (throughput), `sim:serve` (env server), `sim:eval`.
- Python: standalone `python/` project (its own venv); not part of the Vite/worker builds.
- Determinism, protocol, and obs/action layouts pinned by tests on both sides.

## Critical files

**Reuse (already pure):** `src/game/grifballBall.ts`, `grifballMatch.ts`, `grifballGoals.ts`,
`teamScoring.ts`, `grifballTeams.ts`, `roster.ts`, `rosterSlotConfig.ts`, `mapPhysics.ts`,
`mapNavigation.ts`, `rewards.ts`, `weaponCompat.ts`, `grifballMaps.ts`, `arenaDimensions.ts`;
`src/types.ts`.

**Port reference (read, don't modify):** `GrifballGame.tsx` `updatePhysics` (5184–~6963),
`enforceArenaBounds` (504), `updateGrifball` (736), `updateMatchTimers` (750), `updateSingleAIEntity`
(6963); `grifball/grifballObjectiveRuntime.ts`, `grifball/combatantActions.ts`,
`grifball/playerWeaponActions.ts`.

**Adapt for heuristic policy:** `src/game/aiCombatDecision.ts`, `aiGrifballRoles.ts`, `aiTuning.ts`,
`aiMatchContext.ts`.

**New:** `src/sim/**`, `scripts/sim/**`, `python/**`.

## Verification

1. **Determinism (TS):** same seed + action sequence ⇒ identical `SimState` hash over a full
   match, across runs and process restarts (`src/sim/step.test.ts`).
2. **Rules correctness (TS):** golden tests — goal credits the right team and triggers `scored`;
   first-to-`goalTarget` ends the match; ball auto-returns; carrier gets +HP/punch; death drops
   the ball loose (largely exercises reused pure modules).
3. **Fidelity spot-checks:** scripted scenarios (run-in goal; sword-lunge kill; hammer splash)
   match the live game within tolerance; snapshot expected values; list intentional divergences.
4. **Protocol round-trip:** TS-encoded obs/reward/done bytes decode to identical arrays in Python
   (`python/tests/test_protocol.py`); handshake dims equal the exported TS constants.
5. **Throughput:** `npm run sim:bench` (pure TS steps/sec & matches/sec) and an end-to-end Python
   `env.step` rate through the transport; record both — target many thousands of matches/min and
   confirm the transport isn't the bottleneck (raise batch size if it is).
6. **Baseline sanity:** `eval.py heuristic vs random` over ≥200 matches — heuristic wins decisively
   (>90%), confirming the env rewards real Grifball skill.
7. **Learning signal:** a short PPO run (few M steps) vs the heuristic shows monotonically rising
   win rate / goal diff on TensorBoard — proof the full loop learns before scaling up.
8. `npm test` (incl. new sim tests) and `npm run typecheck:all` pass; `pytest` green in `python/`.

## Next phase (designed-for)

Scale PPO self-play: PFSP league, reward-shaping sweeps via the harness, larger nets/GPU. Browser
deployment (ONNX Runtime Web / TF.js export of the PyTorch policy) remains deferred — current
target is research/offline. The TS sim stays the single source of game-truth, so a trained policy
can later be exported to run in-browser without a second engine.