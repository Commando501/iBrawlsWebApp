# AI Combatant Unification — Continuation Doc

_Last updated: 2026-05-30. Status: in progress, all green (tsc clean, 127/127 tests, runtime-verified).
Lunge-initiation (item 3), weapon-swap-mesh (item 2), cosmetic trail VFX (item 5), and the safe part of
the structural item (1 — redundant `botState` alias + threaded param removed) now done. Only the
irreducible structural core + vertical-physics (item 4) remain._

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
- **`updateSingleAIEntity(botId, dt)`** (`GrifballGame.tsx:9742`): the single per-entity tick.
  `isMainAI` is derived inside (`botId === 'main_ai'`); a `self` accessor = `getMainAICombatant()` for
  the main AI, else `s.otherPlayers.get(botId)`. Almost all state read/written through `self`.
- **`updateAI(dt)`** (`GrifballGame.tsx:1203`): once-per-frame loop. Now uses ONE respawn loop
  (`respawnCombatant`, `GrifballGame.tsx:9693`) and ONE update-dispatch loop, both over
  `getAllCombatants()`.

## Progress: `isMainAI` branch count 79 → 11

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

## Remaining 11 `isMainAI` (the irreducible / deferred core)

To see them: `grep -n isMainAI src/components/GrifballGame.tsx`

1. **Structural (5 occurrences, incl. 1 comment) — PARTIALLY DONE** — the `self`/`pos`/`vel`
   resolution at the top of `updateSingleAIEntity` (~`9743`-`9785`). The redundant `botState` alias
   and the threaded `isMainAI` param are GONE (see Progress). What remains is irreducible: the `self`
   resolution itself (`isMainAI ? getMainAICombatant() : s.otherPlayers.get(botId)`) and the `pos`/`vel`
   working-copy (bot) vs live-ref (main) distinction. Both only removable by putting `main_ai` in the
   raw `otherPlayers` map (**deliberately rejected**) and unifying the vector-mutation model.
   **Recommend leaving.** (Plus the bot-only swap-lockout tick at ~`10284`, paired with item 4's
   external-block timing.)

2. ~~**Weapon-SWAP mesh fork (3)**~~ — DONE. See Progress section (`swapCombatantWeapon` /
   `getCombatantWeaponMeshes`).

3. ~~**Lunge INITIATION (2)**~~ — DONE. See Progress section (`triggerCombatantLunge`).

4. **Gravity-integration / air-sway / altitude-recovery (6)** — the genuine vertical-physics model
   difference. Main integrates gravity in an EXTERNAL block (`GrifballGame.tsx:7842`, gated by
   `s.aiIsJumping`, calls `recoverMainAIFromRunawayAltitude`); bots integrate inside
   `updateSingleAIEntity` (~`10123`). Also the no-target airborne block (~`10024`), the lunge-flight
   altitude-recovery fork (`recoverMainAIFromRunawayAltitude` vs `recoverAIFromRunawayAltitude`,
   ~`10771`), and bot-only air-sway (~`10946`/`11019`, plus the grounded snap at ~`10924`). Converging
   means picking one model and removing the external block (timing-sensitive). **Deferred —
   feel-sensitive; do with active playtesting.**

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

## Known open bug (separate from the refactor)

User reported (intermittent, trigger unknown): an AI can "reset its floor and run around in the air."
Static tracing showed every airborne path applies gravity and all horizontal movement is gated behind
an airborne early-return, so it couldn't be reproduced from reading. A **defensive floor-pin** was added
right after the `isAirborneBeforeGroundMovement` early-return in `updateSingleAIEntity`
(`pos.y = 0; vel.y = 0; self.isJumping = false`) — a no-op in normal play, insurance against any stuck
state reaching the ground-movement state machine. Needs a foreground playtest to confirm gone + jumps
still feel right.

## Suggested next steps (in order)

1. ~~Lunge-initiation unification (item 3)~~ — DONE.
2. ~~Weapon-swap-mesh unification (item 2)~~ — DONE.
3. ~~Cosmetic trail VFX (item 5)~~ — DONE.
4. ~~Structural tidy (item 1, safe part)~~ — DONE (`botState` alias + threaded param removed).
5. Then either declare done, or (with active playtesting) converge the vertical-physics model
   (item 4) — the only remaining branches that change feel.

The safe, non-feel-affecting unification is **complete** (79 → 11). The remaining 11 are the
deferred/irreducible core: item 1's last 5 (the `self`-resolution + `pos`/`vel` live-ref-vs-copy
distinction — would need `main_ai` in the raw `otherPlayers` map + a unified vector-mutation model,
deliberately rejected) and item 4's 6 (vertical-physics — playtest-gated). A true zero-`isMainAI` end
state requires deciding both, and neither is a clear win without playtesting.

## Related memory

See `~/.claude/projects/G--git-iBrawlsWebApp/memory/ai-combatant-unification.md` for the running log.
