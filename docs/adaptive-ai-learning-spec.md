# Production Spec — Adaptive "Learn the Opponent" AI (per-match)

> **Status:** Ready to implement. This is workstream 3, deferred after the A+B
> "expose & centralize AI tuning constants" effort shipped. This document is
> self-contained so a fresh session can execute it without prior context.

---

## 1. Goal

During a match, each AI should **progressively adapt its behavior to the opponents it actually fights** — emulating how a real player reads and adjusts to an opponent over a game. In matches with more than one AI, **every AI adapts to the human player AND to the other AIs** it engages.

Concretely: as the match goes on, an AI should start anticipating a specific opponent's habits — preferred lunge distance, dodge bias direction, counter rate, approach aggression, weapon preference, edge-hugging — and bias its own weapon choice, lunge aim, dodge direction, and feint frequency accordingly against *that* opponent.

## 2. Scope & non-goals (decided with the user)

- **Per-match only.** Learning resets every match. No cross-match persistence — there is no server/DB and all data is client-side, so we deliberately avoid a "forever" model for now.
- **Shared per-target model.** One learned profile per opponent, keyed by combatant id. Every AI reads the same profile of a given target (cheapest, builds directly on existing infra). NOT subjective per-(observer→target) models.
- **Offline/local AI only.** The adaptive loop runs where the client owns AI simulation (Sandbox / local training). Do not attempt to drive it from remote/authoritative state in multiplayer.
- **Non-goal:** difficulty rubber-banding — that already exists per-bot (`aiSkillCalibration.ts`) and needs no change.
- **Non-goal:** new UI. The learning-rate knob is already exposed (`aiTunePlayerModelEmaAlpha`, "Learning Rate (EMA α)").

## 3. Key insight — most of this already exists

The adaptive **player-modeling** infrastructure (`PlayerModel`, PR-B) is already built and already consumed; it is simply **only fed for the local human player** and **only read back for the player target**. Generalizing it to all combatants is an *extension*, not a new system.

What already exists:

- **Storage:** `AIMatchContext.playerModels: Map<string, PlayerModel>` keyed by combatant id — already generic. (`src/game/aiMatchContext.ts`)
- **Model + observers:** `src/game/aiPlayerModel.ts` — `PlayerModel`, `createPlayerModel`, `getOrCreatePlayerModel(context, id, defaults?)`, `getPlayerModelSnapshot`, and `observePlayer*` mutators (lunge start/end, hammer attack, dash, weapon swap, counter, damage dealt/received, position, approach speed, reaction). The model carries its own `emaAlpha` (learning rate).
- **Consumers already keyed by target id:** in `src/components/GrifballGame.tsx` the brain already calls `getTargetPlayerModel(target.id)` and feeds the snapshot into combat decisions, lunge aim bias (`applyLungeAimBias`), approach lateral offset, evasion timing (`getEvasionTimingScale`), feint pressure multiplier, and dodge-direction scoring (`pickPerpendicularDodgeDirection`).
- **Per-match reset:** `resetAIMatchContext` clears `playerModels` and fires on `aiMatchSessionKey` change (`useEffect` in GrifballGame). So per-match/cleared-at-match-end is already wired.
- **Learning-rate knob:** `aiTunePlayerModelEmaAlpha` (default 0.08) flows into new models via `getOrCreatePlayerModel(..., { emaAlpha, defaultLungeDistance, defaultReactionTime })`.

## 4. The two gaps to close

### Gap A — Consumer is hard-gated to the local player
`getTargetPlayerModel(targetId)` in `GrifballGame.tsx` currently short-circuits:

```ts
const getTargetPlayerModel = (targetId: string) => {
  if (targetId !== LOCAL_PLAYER_ID) return null;   // <-- remove/loosen this
  ...
};
```

**Fix:** return the snapshot for **any** target id that has enough samples:
`return getPlayerModelSnapshot(s.aiMatchContext, targetId, MIN_SAMPLES);`
(keep the existing minimum-samples gate so behavior only kicks in after the model has observed a few actions). For the player target this is unchanged behavior; for bot targets it now returns a populated profile once that bot has acted enough.

### Gap B — Producer only feeds the local human player
Today the only writer is `recordLocalPlayerObservation(observe)`, which always keys `LOCAL_PLAYER_ID` (`'player'`). AI combatants' actions are never recorded, so `playerModels` only ever contains `'player'`.

**Fix:** add a sibling that records into the **acting bot's** model, then call it at the AI action sites (mirroring where the local-player hooks already live):

```ts
const recordCombatantObservation = (botId: string, observe: (m: PlayerModel) => void) => {
  const s = stateRef.current;
  const tuning = resolveBehaviorTuning(s.settings);
  observe(getOrCreatePlayerModel(s.aiMatchContext, botId, {
    emaAlpha: tuning.playerModelEmaAlpha,
    defaultLungeDistance: tuning.defaultLungeDistance,
    defaultReactionTime: tuning.defaultReactionTime,
  }));
};
```

**Important framing:** a combatant's model is built from *that combatant's own actions* and is consumed by *whoever targets it*. The acting bot records into `model[botId]`; it does not observe itself. Opponents read `model[botId]` via `getTargetPlayerModel(botId)`.

## 5. Observation hook map (player → AI equivalent)

For each existing local-player observation, add the matching AI-combatant hook keyed by the acting bot id. Anchor by **symbol**, not line number (offsets drift):

| Event | Existing local-player call | Where the AI does the same thing |
|---|---|---|
| Lunge start (records avg lunge distance + frequency) | `observePlayerLungeStart` | when a bot starts a sword lunge (`triggerCombatantAttack` / lunge-begin path) |
| Lunge end (hit/miss, distance traveled) | `observePlayerLungeEnd` | `finishSwordLunge(...)` in the bot brain (it already has outcome + target) |
| Hammer attack (lowers lunge-frequency signal) | `observePlayerHammerAttack` | when a bot triggers a hammer swing |
| Dash / dodge direction (dodge bias) | `observePlayerDash` | when a bot dashes/evades (it computes a dash dir) |
| Weapon swap (weapon preference) | `observePlayerWeaponSwap` | `swapCombatantWeapon(self, type)` for a bot |
| Counter attempt/landed (counter rate) | `observePlayerCounter` | bot counter/trade resolution paths |
| Damage dealt / received | `observePlayerDamageDealt` / `Received` | bot hit-applied / hit-taken paths |
| Position sample (edge proximity) | `observePlayerPosition` | per-tick in `updateSingleAIEntity` using the bot's pos + arena radius/shape |
| Approach speed | `observePlayerApproachSpeed` | per-tick in `updateSingleAIEntity` |
| Reaction time | `observePlayerReaction` | optional; only if a clean reaction signal exists for bots |

Notes:
- The per-tick samplers (`observePlayerPosition`, `observePlayerApproachSpeed`) self-throttle (position sampler already rate-limits to ~0.25s); calling them each AI tick is fine.
- Prefer reusing the **existing event sites** in the bot brain (`finishSwordLunge`, `swapCombatantWeapon`, dash trigger, hit application) rather than adding new detection logic.

## 6. Suggested implementation order

1. **Gap A** (one-line-ish): loosen `getTargetPlayerModel` + define `MIN_SAMPLES` (reuse the existing `minSamples` default of 3). Verify no behavior change for the player; bots still return `null` until fed.
2. **Producer helper:** add `recordCombatantObservation(botId, observe)`.
3. **Wire the cheap, high-signal hooks first:** `finishSwordLunge` (lunge end + hit), `swapCombatantWeapon` (weapon pref), bot dash (dodge bias), per-tick position/approach in `updateSingleAIEntity`. These alone make AIs read each other.
4. **Then the rest:** hammer attack, lunge start, counter, damage dealt/received.
5. **Guardrails:** only record for `controller === 'ai'` combatants that are alive; skip while respawning; respect observer mode where relevant (mirror `recordLocalPlayerObservation`'s `isObserverMode` guard for the human only — bots always record).

## 7. Tuning already available (no new UI needed)

These Expert-AI sliders (Adaptation & Learning group) already affect the loop once it's wired:
- `aiTunePlayerModelEmaAlpha` — learning rate (how fast the model adapts). Higher = reacts to recent behavior faster / more jittery; lower = smoother / slower.
- `aiTuneDefaultLungeDistance`, `aiTuneDefaultReactionTime` — cold-start priors for a fresh model.
- Calibration knobs (`aiTuneMaxCalibrationDrift`, `aiTuneCalibrationWindowSize`, resolve delays) tune the separate per-bot difficulty rubber-band.

## 8. Verification

- **Unit:** extend `src/game/aiPlayerModel.test.ts` and add coverage that `getOrCreatePlayerModel` builds independent models per id, that observers update the correct id's model, and that a populated bot model drives `applyLungeAimBias` / `getApproachLateralOffset` / `getFeintPressureMultiplier` differently than a null model. (`aiPlayerModel` functions are pure and already unit-tested — follow that style. Remember to add any new test file to the `test` script in `package.json`.)
- **Typecheck:** `npm run lint` (tsc --noEmit) clean.
- **Tests:** `npm test` green.
- **In-app (preview):** Sandbox → 2+ AIs vs each other (or AI vs AI with the player spectating). Over ~30–60s the AIs should visibly shift weapon/aim/dodge tendencies against specific opponents. Confirm no console errors and that the per-match reset wipes learning on rematch (`aiMatchSessionKey` change). Note: starting a local match requires a real pointer-lock user gesture, so the human may need to start it; AI-vs-AI observation can be done in spectator/observer mode.

## 9. Risks / edge cases

- **Self-modeling:** ensure a bot never reads its *own* model as a target (it targets opponents; `getTargetPlayerModel(target.id)` is already target-scoped — fine).
- **Multiplayer:** do not feed/consume models where the client isn't the AI authority. Keep to offline/local AI paths.
- **Churn vs. stability:** with a high EMA α and sparse samples, behavior can over-react. The existing `minSamples` gate + EMA smoothing mitigate this; expose/keep the α slider as the tuning lever.
- **Performance:** per-tick samplers are cheap and self-throttled; the model map is tiny (one entry per combatant). No concern.

## 10. Pointers

- Memory: `ai-behavior-tuning-centralization` (this effort's predecessor), `ai-mirrors-player-mechanics`, `custom-ai-behavior-exposure`, `ai-combatant-unification`.
- Central tuning: `src/game/aiBehaviorTuning.ts`.
- Model + observers: `src/game/aiPlayerModel.ts`; context store: `src/game/aiMatchContext.ts`.
- Consumers + producer hooks: `src/components/GrifballGame.tsx` (`getTargetPlayerModel`, `recordLocalPlayerObservation`, `finishSwordLunge`, `swapCombatantWeapon`, `updateSingleAIEntity`).
