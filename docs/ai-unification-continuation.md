# AI Combatant Unification — Continuation Doc

_Last updated: 2026-05-30. Status: items 2/3/5 + structural-tidy done & runtime-verified; item 4
(vertical-physics) implemented (tsc clean, 127/127 tests) but **awaiting a foreground playtest** — the
preview MCP desynced after a parallel commit/restart this session, so the feel of jumps/lunges + the
"run on air" bug still need a human check. `isMainAI` now down to 6 (5 real + 1 comment); only the
irreducible structural self/pos/vel + a swap-lockout-tick fork remain.

NOTE: mid-session the repo was committed forward (HEAD ca5769c→e5920e7, v0.490→v0.510) with parallel
Theater-Mode/replay work; all earlier refactor commits are intact, item-4 edits are currently
uncommitted. Line numbers below were refreshed for the v0.510 file._

## Goal

The main AI and the additional bots used to be **two separate code methodologies**. Unify them
into **one homogeneous structure** so the main AI is just another combatant: one brain, one tick,
one data structure, one targeting/respawn/attack path. After the refactor is complete, AI "feel"
will be tuned separately (the user explicitly deprioritized feel during this refactor — behavioral
convergences that change feel are acceptable).

All work is in `src/components/GrifballGame.tsx` (one ~11.6k-line file) plus `src/types.ts`.
Pure decision logic already lived in shared, unit-tested modules under `src/game/ai*.ts` — those
were always shared; the divergence was in `GrifballGame.tsx`.

## Mental model of the architecture (as it stands now)

- **Decision modules** (`src/game/ai*.ts`): combat decision, personalities/tuning, feints, spatial
  strategy, pressure/psych, combo engine, bot coordinator, skill calibration, movement mechanics,
  altitude. Shared by all combatants, keyed by `botId` (`'main_ai'` is just an id). Don't need changes.
- **`Combatant` type** (`src/types.ts:226`): the single in-memory shape for the main AI + all bots
  (+ remote players). `pos`/`vel` are live `THREE.Vector3`.
- **`getMainAICombatant()`** (`GrifballGame.tsx:9491`): the main AI **as a `Combatant`**. SOURCE-OF-TRUTH
  FLIP is done — this object OWNS the main AI's ~28 scalar combat fields as plain data, and each flat
  `s.aiXxx` SCALAR was redefined via `Object.defineProperty` to forward into it (so the ~506 existing
  readers of `s.aiXxx` — HUD/render/radar/observer — still work). Vectors (`aiPos`/`aiVel`/lunge
  dirs/`aiDashDir`) and team-score fields (`scoreEnemy`/`enemyKills`/`enemyDeaths`/`enemyRespawnTimer`)
  stay canonical on `stateRef` and are exposed via accessors (vectors shared by reference). Cached in
  `mainAICombatantRef`.
- **`getAllCombatants()`** (`GrifballGame.tsx:9605`): the single source of truth for "every AI
  combatant (main AI + bots)" as one uniform list. **Chosen approach: UNIFIED ACCESSOR, not raw-map
  membership** — `main_ai` is deliberately NOT an entry in the `otherPlayers` map, because ~20
  rendering/collision/networking loops rely on that map meaning "everyone except player & main AI".
- **`getCombatantMesh(id)`** (`GrifballGame.tsx:9616`): the one intentional per-combatant seam
  (main AI → bespoke `enemyGroup`; bots → `otherPlayerMeshes`). `getCombatantWeaponMeshes(id)` (just
  below) returns the `{hammer, sword}` display-mesh pair the same way.
- **`updateSingleAIEntity(botId, dt)`** (`GrifballGame.tsx:~10168`): the single per-entity tick.
  `isMainAI` is derived inside (`botId === 'main_ai'`); a `self` accessor = `getMainAICombatant()` for
  the main AI, else `s.otherPlayers.get(botId)`. Almost all state read/written through `self`. Gravity/
  altitude for ALL combatants is now integrated here (the main AI's old external block is gone).
- **`updateAI(dt)`** (`GrifballGame.tsx:1203`): once-per-frame loop. Now uses ONE respawn loop
  (`respawnCombatant`) and ONE update-dispatch loop, both over `getAllCombatants()`.
- **`updatePhysics(dt)`** (called before `updateAI` each frame): handles the local player's movement +
  gravity only. It no longer touches the main AI (the AI gravity block was removed in the item-4
  convergence) — every AI combatant's vertical physics lives in `updateSingleAIEntity` now.

## Progress: `isMainAI` branch count 79 → 6

Done (behavior-neutral unless noted): `Combatant` type + typed map; persistent main-AI combatant;
unified targeting (`buildPotentialTargets` at `9196` iterates `getAllCombatants()`); unified update
dispatch; unified respawn; source-of-truth flip; jump airborne-DETECTION convergence; weapon-trigger
convergence via `triggerCombatantAttack` (`9651`) — _behavioral: bots now record attack timestamps +
use proper hammer-melee states; main gained an sfx, lost swap/dash guards_; `startAIHammerJump`
(`9478`) and `canStartAIHammerJump` (`9468`) take `self`; collapsed `botMesh`, invuln-tick,
field-default init, SPAWN_GUARDING partial-syncs, dash-reset, crouch write, evasion-dodge jump onto `self`;
**lunge-initiation convergence via `triggerCombatantLunge(self, lungeDir, pos, vel)`** (defined just
after `triggerCombatantAttack`) — added `.copy()` bridge setters for `lungeStartPos`/`lungeTargetDir`
on the main-AI combatant (mirroring `aiDashDir`); both former `if (isMainAI) triggerEnemySwordLunge`
sites now call the helper. _Behavioral: bots now set `isJumping` + record `lastSwordAttackTime`; main
no longer short-circuits on swap-cooldown/dash-remaining here._ The main-only `triggerEnemySwordLunge`
(`6686`) is KEPT — the multiplayer `lunge_sword` network-replay handler (~`2653`) still uses it (it
handles the no-customDir target-derivation fallback). Runtime-verified: ~28s match at 59 fps, main AI
scored + sword-lunged, zero console errors.

**weapon-swap-mesh convergence via `swapCombatantWeapon(self, type, setLockout)`** (defined after
`triggerCombatantLunge`) + `getCombatantWeaponMeshes(id)` (after `getCombatantMesh`, returns the
`{hammer, sword}` pair — `enemyHammer`/`enemySword` for main, the `otherPlayerMeshes` entry for bots).
All three forks (`applyTacticalWeapon`, `revertWeaponSwapFeint`, the SPAWN_GUARDING sword telegraph)
now call the helper. The dead `swapEnemyWeapon` (was `6718`) was **deleted** — it had no other callers
(no network path). _Behavioral: the main AI no longer sets the `weaponReadyTime` swap cooldown
(`aiSwapCooldownTimer`) on swap — inert in the unified tick since only the network-replay triggers
read it — and dropped the HP/paused/LUNGING guards; the feint-revert and spawn-telegraph no longer
re-arm the swap lockout (converged down to the bot behavior)._ Runtime-verified: match at 176 fps,
clock advancing, zero console errors.

**cosmetic lunge-trail VFX convergence** — the lunge-flight trail style at `~10773` was
`isMainAI ? 'enemyCube' : 'shockwave'`; now every AI-team lunge uses the red `'enemyCube'` cube trail
(converged bots up to the main AI's team-colored style — `'enemyCube'` is an already-proven
`renderSwordLungeTrailVfx` style the main AI uses every lunge). Also reworded the dead-air-sway
comment (~`10943`) so it no longer literally mentions `isMainAI`. Static-verified (tsc + 127 tests);
full-speed runtime capture was blocked by the rAF throttle this round, but it's a string-literal swap
to an existing code path (no new accessor / type change), so the risk is nil.

**structural tidy (item 1, partial)** — removed the redundant `botState` local and the threaded
`isMainAI` parameter from `updateSingleAIEntity`. `isMainAI` is now derived once inside (`botId ===
'main_ai'`); `self` resolves directly (`isMainAI ? getMainAICombatant() : s.otherPlayers.get(botId)`,
then `if (!self) return`); every former `botState!` body ref now goes through `self` (they were the
same object for bots); pos/vel source from `self.pos`/`self.vel` (the live-ref-main / working-copy-bot
distinction is **preserved** — `new THREE.Vector3().copy(self.pos)` for bots). Caller no longer passes
`isMain`. Behavior-neutral (verified: every `self.pos`/`self.vel` use inside the fn is a write/sync, no
mid-tick read; cross-combatant reads in the dispatch loop see post-sync values). Runtime-verified: 166
fps, ~47s combat, Red-AI elimination-feed activity, zero console errors.

**vertical-physics convergence (item 4) — full in-tick model.** Deleted the external "Handle AI Gravity
Physics" block in `updatePhysics` (main AI no longer integrates gravity/altitude/arena-constraint in a
separate phase-1 pass); the main AI now integrates gravity IN-TICK in `updateSingleAIEntity`, the same
path bots use (removed the `!isMainAI` guards on the no-target airborne block + the combat gravity
block). Replaced `recoverMainAIFromRunawayAltitude` (deleted) and the 4 main-vs-bot recover forks with
ONE helper `recoverCombatantAltitude(self, pos, vel)` (defined by the recover wrapper at ~`1046`) that
runs the shared altitude clamp, then — gated by `self.id === 'main_ai'` — re-asserts the airborne flag
and clears the main-only hammer-jump plan (`aiHammerJumpPlanned/Type/WindowTimer`); the wrapper now
returns the recovered boolean. Air-sway blocks unified (they're dead past the floor-pin anyway). Added
`self.isJumping = false` on landing in the no-target block so the main AI's flag clears in-tick (the
external block used to do this). _Behavioral/feel changes to validate by playtest: main-AI gravity now
applies one frame-phase later (phase 3 vs phase 1); during altitude-runaway recovery the weaponState
'recovering' guard is dropped (shared helper sets 'ready' unconditionally); main-AI airborne lunges now
share the bots' double-gravity quirk (gravity block + lunge-flight block both integrate)._ Count: 11 →
6. tsc clean, 127 tests pass. **NOT yet runtime-verified — needs a foreground playtest** (preview MCP
desynced this session).

## Remaining 6 `isMainAI` (the irreducible core)

To see them: `grep -n isMainAI src/components/GrifballGame.tsx`

1. **Structural (5 occurrences, incl. 1 comment) — irreducible** — the `isMainAI` derivation + `self`/
   `pos`/`vel` resolution at the top of `updateSingleAIEntity` (~`10151`-`10193`). The redundant
   `botState` alias and threaded param are GONE (see Progress). What remains is irreducible: the `self`
   resolution itself (`isMainAI ? getMainAICombatant() : s.otherPlayers.get(botId)`) and the `pos`/`vel`
   working-copy (bot) vs live-ref (main) distinction. Both only removable by putting `main_ai` in the
   raw `otherPlayers` map (**deliberately rejected**) and unifying the vector-mutation model.
   **Recommend leaving.**

6. **Swap-lockout tick fork (1)** — `if (!isMainAI && (self.swapLockoutTimer ?? 0) > 0)` at ~`10689`
   ticks the bot swap-lockout in-tick; the main AI's `aiSwapLockoutTimer` is decremented externally in
   `updateHammerAnimations` (~`8270`). The lone non-physics fork left. Unifiable like item 4 was (tick
   `self.swapLockoutTimer` here for all + drop the external main decrement) — small, low-risk, but
   touches `updateHammerAnimations`. Easy follow-up if a true zero is wanted.

2. ~~**Weapon-SWAP mesh fork (3)**~~ — DONE. See Progress section (`swapCombatantWeapon` /
   `getCombatantWeaponMeshes`).

3. ~~**Lunge INITIATION (2)**~~ — DONE. See Progress section (`triggerCombatantLunge`).

4. ~~**Gravity-integration / air-sway / altitude-recovery (6)**~~ — DONE (full in-tick convergence).
   See Progress section (`recoverCombatantAltitude`; external `updatePhysics` block deleted).
   **Awaiting a foreground playtest** to confirm jump/lunge feel + the "run on air" bug.

5. ~~**Cosmetic (~2)**~~ — DONE. See Progress section (trail VFX converged to `'enemyCube'`; comment
   reworded).

## How to verify (IMPORTANT — environment gotchas)

- **Typecheck:** `npm run lint` then check `echo $?` (== 0). **Do NOT** judge by piping to `tail` — a
  pipe masks tsc's nonzero exit code. Also: a freshly-written file read mid-flush can produce a STALE
  tsc error (a phantom "brace imbalance"); re-run `npm run lint` to confirm before chasing it.
- **Tests:** `npm test` (expect `# pass 127`, `# fail 0`).
- **Brace-balance sanity** (if a syntax error appears): the file should be net-balanced. Quick check:
  `awk '{b+=gsub(/{/,"{")-gsub(/}/,"}")} END{print b}' src/components/GrifballGame.tsx` → expect 0.
- **Runtime:** the headless preview throttles `requestAnimationFrame` to ~1 fps when backgrounded
  (screenshots may time out / clock won't advance). To get a real frame: start the dev server, drive
  the menu (Sandbox Mode → Start Local Training → Initialize Simulation), then **click `#canvas-viewport`**
  to foreground before screenshotting. A healthy match shows FPS ~60-160, both teams scoring in the
  Elimination Feed (`Red (AI)` = the main AI), and **no console errors**. Note: in strict-mode ES
  modules, writing a getter-only bridge property THROWS every frame — so "no console errors" is a strong
  signal the bridge accessors are complete.

## "Run on air" bug — ROOT-CAUSED & FIXED (2026-05-30)

User originally reported (intermittent): an AI can "reset its floor and run around in the air." After
the item-4 convergence the user reproduced it reliably: the AI **sword-lunges UPWARD at a target, gets
the kill, then strafes around at the kill altitude.**

Root cause: the **post-kill-pressure early-return block** (`if (postKillPressure)` in
`updateSingleAIEntity`, ~`10346`) is a ground spawn-guard behavior — it sets a purely horizontal `vel`
(`vel.copy(moveHeading…)`, y=0), moves `pos` horizontally, and returns **without ever applying gravity
or touching `pos.y`**. `finishSwordLunge` leaves a lunge-kill airborne (`isJumping=true`, high `pos.y`),
so the AI enters this block airborne and strafes in mid-air for the whole post-kill-pressure window. The
OLD external `updatePhysics` AI-gravity block (phase 1) pulled the main AI down every frame regardless,
masking it; bots always had it (the "intermittent" report). Removing the external block in item 4
exposed it on the main AI and made it reproducible.

Fix: added an airborne guard at the top of the post-kill block (mirrors the no-target airborne block) —
if `self.isJumping || pos.y > 0.01 || |vel.y| > 0.01`, integrate gravity + `recoverCombatantAltitude` +
land-pin + horizontal air-damping, then `syncStateAndMesh(); return`. The AI falls to the floor before
resuming the spawn-guard. tsc clean, 127 tests pass.

Also still in place: the **defensive floor-pin** after the `isAirborneBeforeGroundMovement` early-return
(`pos.y = 0; vel.y = 0; self.isJumping = false`) — insurance against any other stuck-airborne state
reaching the ground-movement state machine. Playtest should confirm the lunge-kill case is gone and
jumps/lunges still feel right.

## Suggested next steps (in order)

1. ~~Lunge-initiation (item 3)~~ — DONE.
2. ~~Weapon-swap-mesh (item 2)~~ — DONE.
3. ~~Cosmetic trail VFX (item 5)~~ — DONE.
4. ~~Structural tidy (item 1, safe part)~~ — DONE.
5. ~~Vertical-physics convergence (item 4)~~ — IMPLEMENTED; **playtest pending** (jump arcs, lunge
   arcs, AI-vs-AI air combat, and the "run on air" bug). If the feel regresses, the cleanest revert is
   to restore the external `updatePhysics` AI-gravity block + `recoverMainAIFromRunawayAltitude` and
   re-add the `!isMainAI` guards on the two in-tick gravity blocks.
6. Optional: swap-lockout-tick fork (remaining item 6) — small, low-risk follow-up to reach a true
   near-zero. Then the only thing left is item 1's irreducible structural core.

All five planned convergences are now implemented (79 → 6). What remains: item 1's irreducible
structural core (the `self`-resolution + `pos`/`vel` live-ref-vs-copy distinction — would need
`main_ai` in the raw `otherPlayers` map + a unified vector-mutation model, deliberately rejected) and
the lone swap-lockout-tick fork (item 6, easily unifiable). Item 4's feel must be confirmed by playtest
before declaring done.

## Related memory

See `~/.claude/projects/G--git-iBrawlsWebApp/memory/ai-combatant-unification.md` for the running log.
