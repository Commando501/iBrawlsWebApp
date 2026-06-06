# `src/sim/` — Deterministic Headless Grifball Engine

A DOM/THREE-scene-free, seeded reimplementation of the Grifball match loop, built as the
simulation substrate for offline reinforcement-learning self-play. It runs the **same
pure rules modules** as the live game (`src/game/grifball*`, `teamScoring`, `roster`,
`mapPhysics`, …) and ports the physics/weapons/tick logic out of the 9,186-line
`src/components/GrifballGame.tsx` into pure functions.

`GrifballGame.tsx` stays the untouched fidelity reference. This tree is a **parallel**
engine: zero changes to the live runtime.

> Status: **Phases A–F implemented** (full vertical slice). A: deterministic
> `stepSimulation`. B: `env/` observation/action/reward encoding. C: `server/` batched
> binary vec-env over stdio. E: `harness/` random + heuristic baseline policies + eval. D:
> Python PPO trainer under `python/`. Everything is tested; a polish pass (fidelity
> tightening, terminal-obs on truncation, multi-worker scaling) is the next step. See
> `docs/ml reinforcement ai plan.md`.

### Phase B–F modules

| File | Role |
|---|---|
| `env/observation.ts` | Ego-centric fixed-width `encodeObservation` into a shared buffer; `OBS_DIM`/`OBS_LAYOUT`. |
| `env/action.ts` | Factorized discrete action space + `decodeAction`; `ACTION_NVEC`. |
| `env/reward.ts` | `RewardConfig`-driven shaping (terminal/goal/possession/progress/kills). |
| `env/spec.ts` | `buildEnvSpec()` — the JSON handshake header (single source of truth for dims). |
| `server/vecEnv.ts` | N parallel matches; batched `reset`/`step`; auto-reset; built-in heuristic opponent. |
| `server/protocol.ts` | Length-prefixed binary frames; little-endian tensor (de)serialization. |
| `server/main.ts` | stdio transport host (`runServer`); `npm run sim:serve`. |
| `harness/{policy,randomPolicy,heuristicPolicy}.ts` | Baseline policies (bootstrap opponent + benchmark). |
| `harness/rollout.ts` | `playMatch` / `evaluate` head-to-head; `scripts/sim/{bench,eval}.ts`. |
| `python/**` | SB3 PPO trainer, `GrifballVecEnv` client, spaces/policies/selfplay/eval. |

## Layout

| File | Role |
|---|---|
| `rng.ts` | Seeded mulberry32 PRNG. **The only randomness source** — no `Math.random` may ever appear under `src/sim/`. Serializable single-uint32 state. |
| `actions.ts` | `ActionInput` per combatant — the seam that replaces keyboard/gamepad/mobile input. |
| `simState.ts` | `SimState` + `SimCombatant`: a plain-`Vec3`, fully serializable mirror of the live combatant, stripped of React/THREE. |
| `factory.ts` | `createMatch({ seed, teamSizes, settings, map })` — reuses `DEFAULT_ADMIN_SETTINGS`, the Championship Stadium arena, and the pure objective modules. |
| `physics.ts` | Port of the movement core (turn, walk/run/crouch, dash, jump/gravity, lunge flight) + reused arena/obstacle constraint. |
| `weapons.ts` | Hammer/sword/punch FSM (windup→active→recover), lethal hit resolution, respawns. |
| `grifball.ts` | Pure objective tick (phase machine, ball follow/physics, pickups, scoring, carrier perks, passes) — port of `grifballObjectiveRuntime.ts`. |
| `step.ts` | `stepSimulation(state, actionsById)` — one fixed `1/60`s tick, phased like the live tick. Returns per-tick events. |
| `hash.ts` | Deterministic state serialization + FNV-1a hash for the determinism tests. |

## Determinism contract

`(seed + action sequence)` ⇒ an identical `SimState` hash, across runs and process
restarts (`step.test.ts`). This holds because:

- All randomness flows through the injected `Rng`, whose state is snapshotted into
  `SimState.rngState` each tick.
- Physics/weapons are currently pure arithmetic (no RNG yet); the RNG seam is wired
  through `stepSimulation` so future stochastic feel (e.g. spread) stays reproducible.
- Floats are quantized to `1e-5` before hashing so mathematically-identical runs compare
  equal without trailing-bit sensitivity.

## Reuse vs. port vs. divergence

**Reused verbatim (pure, already shared with the live game):** `grifballBall`,
`grifballGoals`, `grifballMatch`, `teamScoring`, `grifballTeams`, `roster`,
`rosterSlotConfig`, `grifballMaps`, `premadeMaps`, `arenaDimensions`, `mapPhysics`
(via the THREE-math seam), plus the already-extracted pure helpers
`grifball/arenaBounds.ts` and `grifball/combatGeometry.ts`.

**Ported (read from `GrifballGame.tsx`, reimplemented pure):**
- Movement core (`updatePhysics` ~5740–5937): walk `5.8 m/s`, ball-runner `×1.3`,
  crouch `2.5`, jump `vy = 7.2`, gravity `18`, dash `dashDistance/dashDuration`. Yaw
  convention preserved: `forward = (0,0,-1)` rotated about `+Y` by yaw.
- Objective tick: a 1:1 port of `updateGrifballObjectiveForState`.

**Intentional divergences (to be tightened against golden fidelity tests — Verification
#3 in the plan):**
- **Melee hit test** is a forward-cone approximation (distance ≤ reach, facing dot ≥
  0.35) using the reused reach constants, not the live per-VFX swept volume.
- **Combos, feints, weapon trades, hammer-jump, psychological pressure** — heuristic-AI
  flavour, not modelled. These belong to the (future) `harness/heuristicPolicy.ts`.
- **Sprint/slide** input is not in the action space (and `enableSprint`/`enableSlide`
  default off), so those speed branches are inert.
- **THREE.Vector3** is used purely as a deterministic math type at the collision seam
  (`physics.ts`) so we can reuse `mapPhysics`/`arenaBounds` byte-for-byte. No THREE scene,
  camera, renderer, or DOM is ever constructed. `SimState` itself is plain `Vec3`.
- Rendering-only concerns (camera, VFX, audio, nameplates, replay) are dropped.

## Running

```bash
# Sim unit + determinism + golden-rules tests (also part of `npm test`):
node --import tsx --test src/sim/rng.test.ts src/sim/factory.test.ts \
  src/sim/grifball.test.ts src/sim/step.test.ts
```

## Verified end-to-end

- #1 determinism, #2 golden rules, #3 melee fidelity (eye→body 3D reach + 1.0-rad cone,
  pinned in `weapons.test.ts`), #4 protocol round-trip (TS + real stdio + Python), #5
  throughput (~220k agent-steps/s, ~640 matches/min single-core), #6 heuristic 100% vs
  random, **#7 the full loop learns** — PPO win-rate vs the random opponent rose
  0.22 → 0.71 over 1.5M steps (TS sim ↔ binary protocol ↔ Python PPO).

The scripted heuristic is a ~100% shutout, so it's a curriculum *target*, not a cold-start
opponent (a from-scratch policy gets no foothold against it). Train `random` → `self` →
`heuristic`.

## Truncation vs termination

A real match end is a true terminal (no value bootstrap); a `maxTicks` cut-off is a
**truncation** that bootstraps from the terminal observation. This matters: near-random
policies stall, so early-training matches truncate ~75% of the time (measured via
`scripts/sim/truncation_probe.ts`). The vec-env tags `truncated`, sends per-done terminal
observations over the wire, and the Python env surfaces `TimeLimit.truncated` +
`terminal_observation` so SB3 bootstraps correctly.

## Next (optional, not blocking)

- Multi-Node-worker scaling behind one learner (the protocol is already per-process).
- Longer / seed-averaged runs + the self-play league (`selfplay.py`, currently scaffolding
  for the CleanRL path) to push toward beating the heuristic.
- `VecNormalize` (reward/obs running stats) if longer runs prove unstable.
