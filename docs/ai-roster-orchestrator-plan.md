# AI Roster + Orchestrator — Architecture Plan

_Created 2026-05-30. Status: PROPOSAL for review — no code changed yet. Successor to
`ai-unification-continuation.md` (which unified the AI **code path**; this unifies the AI
**identity, config, and lifecycle**)._

## Vision (from the user)

> "It should all be the same. All bots should be the main AI and vice versa. If we were to
> consider a 'main AI', it would be an **orchestrator** that handles what every bot (anything
> not the player) does in a match."

End state: **one homogeneous roster of AI-controlled combatants** with **no privileged member**,
**per-slot config with a shared default**, and a **separate orchestrator** that owns the roster's
lifecycle and coordination — not a combatant itself.

## What's already done vs what remains

The `isMainAI` work unified the **code path**: one `Combatant` shape, one `updateSingleAIEntity`
tick, one shared decision module, one targeting/respawn/attack path (down to 6 `isMainAI` lines).
Three **structural** separations remain — and the "SWORD USER 100/0 still uses hammer" surprise is
a direct symptom of #2:

1. **Identity / membership.** `main_ai` lives in flat `s.aiXxx` fields (bridged to a `Combatant`
   by `getMainAICombatant`) + a bespoke `enemyGroup` mesh; bots live in the `s.otherPlayers` map +
   `otherPlayerMeshes`. `getAllCombatants()` unifies them for AI logic, but ~112 `s.otherPlayers`
   sites and the mesh/scoring layers still treat the map as "everyone except player & main AI."
   This is the **"don't put `main_ai` in the map" decision we deliberately made** — and the thing
   this plan reverses.
2. **Configuration / tuning.** Main AI reads `s.settings.aiXxx` (Sandbox sliders, full 0–100
   ranges); bots read `botDifficulties` / `botBehaviors` / `botWeaponBehaviors` (per-bot, capped —
   e.g. weapon only `balanced` / `sword_75_25` / `hammer_75_25`, so bots **cannot** express
   sword-100). Resolved in `resolveBotKnobs` (`GrifballGame.tsx:~1079`).
3. **Team / scoring.** `main_ai` is hardwired as Red "enemy" (`scoreEnemy`/`enemyKills`/
   `enemyDeaths`/`enemyRespawnTimer`, ~119 score-field sites); bots carry their own
   `score`/`kills`/`deaths`. No general team model.

## Critical constraint — `otherPlayers` is overloaded

`s.otherPlayers` means **two different things**:

- **Offline:** AI bots (count = `offlineBotCount`), spawned locally, ticked by `updateAI`.
- **Online (multiplayer):** **remote human players**, driven by the network; the **local AI does
  not run** (`getAllCombatants` pushes `main_ai` only when `!s.isMultiplayer`; `enemyGroup` is
  hidden when multiplayer — `GrifballGame.tsx:914, 1024, 1955`).

So the roster model must keep **"AI-controlled" distinct from "remote-human."** The orchestrator
governs AI-controlled combatants only. This is the single highest-risk area of the whole effort.

## Target architecture

### Roster
- One combatant collection keyed by id, each entry an identical `Combatant` plus a **`controller`
  discriminator** (`'ai' | 'remote' | …`). `main_ai` becomes an ordinary `controller: 'ai'` entry
  (keep the id `'main_ai'` as slot 0 for now to limit blast radius; full anonymization later).
- Flat `s.aiXxx` is **retired** — the source-of-truth flip already moved the data into a
  `Combatant`; this step puts that object in the map and deletes the `getMainAICombatant` bridge.
- Rendering: every AI combatant is provisioned through the **same rig builder**
  (`createOrUpdateRemotePlayer` / `otherPlayerMeshes`); the bespoke `enemyGroup`/`enemyHammer`/
  `enemySword` path is generalized away. `getCombatantMesh` already abstracts the read side.

### Config (per-slot with a default — chosen)
- A `RosterSlotConfig` schema: `{ difficulty, weaponPrioritization, playstyle, behavior,
  archetype, team, hue, name }` — the **same shape and full ranges for every slot**.
- One **default/template** (today's Sandbox "AI COMBAT NEURAL NET" panel) applied to all slots;
  each slot may **override** any field (so bots gain the full sword-100 range automatically).
- `resolveBotKnobs` reads each combatant's resolved `RosterSlotConfig` uniformly — no
  `botId === 'main_ai'` fork, no `botWeaponBehaviors` 3-way cap.

### Orchestrator (promote `aiCoordinator`)
- Owns the **roster lifecycle**: spawn/despawn to the configured count, team assignment, per-slot
  config resolution/distribution, and the existing coordination/role logic — operating over the
  whole AI roster, with player-awareness. Runs once per frame, offline (or for AI-filled slots in
  mixed sessions). It is **not** a combatant.

### Team / scoring
- Generalize the player-vs-enemy scalars into a **per-team tally**. `main_ai`'s `scoreEnemy`
  becomes "team Red score." Define the team model (start with the existing 2 teams; structure so N
  is possible). Win-condition + HUD + elimination feed read the team model.

## Phased migration (each phase must end green: `tsc` 0, `127/127` tests, runtime-verified)

**Phase 0 — Guardrails.** Land the in-flight item-4 + run-on-air fix first (commit). Capture a
behavior snapshot (FPS, scoring, both-teams-active, no console errors) as the regression baseline.

**Phase 1 — Config unification (quick win + foundation).** Introduce `RosterSlotConfig` + a default
template; route `resolveBotKnobs` through it for every combatant including `main_ai`; let bots
inherit/override the full ranges. **This alone fixes the sword-100 bug.** No identity/mesh changes
yet. _Lowest risk, highest immediate value._

**Phase 2 — Mesh unification.** Generalize the `enemyGroup` rig into the shared
`createOrUpdateRemotePlayer`/`otherPlayerMeshes` provisioning so `main_ai` can render as a roster
member. `main_ai` still lives in flat state for now; only its mesh path changes.

**Phase 3 — Team/scoring generalization.** Replace `scoreEnemy`/`enemy*` scalars with the team
model behind accessors (keep the bridge so HUD/feed keep working), mirroring the source-of-truth
flip technique.

**Phase 4 — Roster membership flip (the big one).** Add the `controller` discriminator; put
`main_ai` into the unified collection; migrate the ~112 `otherPlayers` consumers — **categorized
first** into {AI-logic, rendering, collision, networking/serialization, scoring} and migrated
category-by-category with the multiplayer/remote distinction preserved at every step. Retire flat
`s.aiXxx` + `getMainAICombatant`.

**Phase 5 — Orchestrator extraction.** Promote `aiCoordinator` to own spawn/despawn, team
assignment, and config distribution over the roster (currently scattered across `useEffect`s like
the `offlineBotCount` spawn at `GrifballGame.tsx:~3117` and the main-AI lifecycle).

**Phase 6 — Cleanup.** Delete `getAllCombatants` special-casing, the last `isMainAI` lines, the
`main_ai` mesh/scoring special cases, and any now-dead bridges.

## Risks / watch-items
- **Multiplayer/remote overlap** (`otherPlayers` double duty) — must never let the orchestrator
  drive remote-human entries. Highest risk.
- **Networking serialization** of combatants (the `frame.otherPlayers` push paths).
- **Scoring / win-condition** correctness across the team-model change.
- **Parallel Theater/replay work** touches rendering/replay of `otherPlayers` — coordinate/rebase;
  the repo moved v0.490→v0.510 mid-session.
- Bridge-accessor discipline: strict-mode getter-only writes throw every frame, so "no console
  errors" remains a strong signal at each phase.

## Open decisions to settle before/within each phase
- Keep id `'main_ai'` (slot 0) vs fully anonymize the roster.
- One map + `controller` flag (recommended) vs a separate AI-roster collection alongside the
  remote-player map.
- Team model shape: fixed 2 teams now, or general N-team from the start.

## Suggested first action
Phase 1 (config unification) — it fixes the reported sword-100 bug immediately, is low-risk, and
lays the `RosterSlotConfig` foundation every later phase builds on.
