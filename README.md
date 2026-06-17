# iBrawls Web App

iBrawls is a React, Vite, Three.js browser game with a local Node/WebSocket relay for development and a Cloudflare Worker Durable Object relay for deployment.

## Local Development

1. Install root dependencies:
   `npm install`
2. Start the local app and relay:
   `npm run dev`
3. Open `http://localhost:3000`.

The root dev server runs `server.ts`, which hosts Vite in middleware mode and provides the local WebSocket matchmaking/gameplay relay.

Registered accounts reserve their saved Spartan Pilot Identity nameplate as a registered display name. The account owner keeps the plain base name in public identity surfaces. Guests or other signed-in accounts using the same registered base name are rendered by the Worker relay with a random session-only discriminator such as `ASpence501#1001`; the editable base name remains capped at 10 characters, but rendered collision names may be longer because of the suffix. Signed-in cloud-save updates that try to claim another account's registered display name are rejected and the UI reverts to the account's previous registered name.

Hosting a multiplayer match now creates a staged pre-match lobby instead of immediately starting gameplay. The host configures access (`open`, `private`, or `password`), game mode (`sandbox` shown as iBrawls, or `grifball`), map/custom map, player slot count, observer allowance, match timer, and kills/goals target through the shared `MatchLobbyConfig` contract in `src/network/protocol.ts`. Players can join staged lobbies by public room code, password prompt, or direct invite; the host starts the match with a `start_match` handshake and relays broadcast `match_start` with the authoritative config before clients enter gameplay.

Multiplayer rooms stay advertised while a staged or running match has an open player slot. The Global Broadcast player list and lobby browser show mode, map, access, slots, observers, timer, and target metadata through `MatchLobbySummary`; private lobbies do not expose joinable public room codes, and password lobbies expose only a `hasPassword` flag. Passwords are hashed server-side and are never sent in presence, lobby lists, invites, or sync payloads. Direct invites include relay-issued invite tokens for the target user so invited users can enter private/password rooms without public listing access. Quick Play only matches open, non-password lobbies with available player slots. The local relay and Worker relay both cap active players at 8 total (host + 7 guests), keep observers outside player-slot capacity, and assign stable spawn slots so simultaneous joins or respawns do not stack players on one spawn point. Signed-in accounts are limited to one active browser page/location at a time: a newer signed-in page displaces older lobby/gameplay sockets for the same account to prevent player cloning.

Multiplayer match loading uses the gameplay WebSocket roster, not the lobby presence id. The relays add optional hue/loadout identity and match visual model policy to participant entries, then forward `match_loading_status` sync packets with each browser's loading percentage, stage, and ready flag. `src/components/loading/useMatchLoadingGate.ts` keeps the local/remote loading roster including players and observers, holds HUD/chat/replay overlays behind `MatchLoadingOverlay`, renders participant previews through the active match policy, and releases gameplay only after every connected participant is ready or has crossed the loading timeout fallback.

Main-menu header/navigation UI lives in `src/components/main-menu/MainMenuHeader.tsx`, the resizable main-menu frame controller lives in `src/components/main-menu/useMainMenuFrameLayout.ts`, the Global Broadcast rail UI lives in `src/components/main-menu/MainMenuBroadcastRail.tsx` and its identity/player-list/chat subframes live in `src/components/main-menu/GlobalBroadcastPanel.tsx`, the right-side reference/customization column lives in `src/components/main-menu/MainMenuReferencePanel.tsx`, keyboard/gamepad binding controls live in `src/components/main-menu/KeybindingControls.tsx`, keybinding persistence, rebinding listeners, and controller-cursor/gamepad diagnostics live in `src/settings/useKeybindingControls.ts`, the manual controls panel lives in `src/components/main-menu/ManualControlsPanel.tsx`, armor customization, painting, and save-code UI live in `src/components/main-menu/CustomizationPanel.tsx`, the standalone V2 armor model editor page lives in `src/armorModelEditorPage.tsx`, player identity/admin-settings local persistence lives in `src/settings/usePlayerSettings.ts`, save-code import/export plus account cloud-save sync live in `src/settings/useSaveAccountSync.ts`, gameplay presets, the Official Multiplayer Preset, multiplayer ruleset draft, and admin publish state live in `src/settings/useGameplayPresetControls.ts`, saved custom-AI presets and main AI archetype controls live in `src/settings/useAiPresetControls.ts`, the visual controller mapper lives in `src/components/main-menu/VisualGamepadMapper.tsx`, bot setup modal UI lives in `src/components/main-menu/BotSetupModal.tsx`, sandbox setup UI lives in `src/components/main-menu/SandboxSetupPanel.tsx`, the dedicated single-player AI Behavior Editor mode and Custom AI Behavior editor UI live in `src/components/main-menu/SinglePlayerSetupPanel.tsx` and `src/components/main-menu/AiBehaviorEditorPanel.tsx`, custom-AI menu labels/knob metadata live in `src/components/main-menu/aiMenuContent.ts`, map preview rendering plus the `createHighFidelityObjectMesh` compatibility export live in `src/components/main-menu/MapPreview.tsx`, match loading overlays, generated top-down map previews, compact Spartan loading previews, and the match-loading ready-gate hook live in `src/components/loading/`, app shell notice/status/cursor overlays live in `src/components/AppShellOverlays.tsx`, App session flags, pause submenu state, first-run notice, match-result state, and chat message storage live in `src/components/useAppSessionState.ts`, browser/device capability detection lives in `src/platform/browserCapabilities.ts`, online/device tracking plus WebGL and Edge low-FPS warning state live in `src/platform/useBrowserDiagnostics.ts`, browser warning modals live in `src/components/BrowserWarningModals.tsx`, Theater replay load/edit/save/upload behavior, library/cache panels, archive modals, and in-game/full-screen heatmap playback live in `src/components/replay/`, multiplayer setup UI lives in `src/components/multiplayer/MultiplayerSetupPanel.tsx`, matchmaker endpoint persistence, WebSocket URL construction, room-code generation, and public/LAN IP discovery live in `src/components/multiplayer/useMatchmakerEndpoint.ts`, matchmaker lobby socket, presence, chat, quick-play, and invite state live in `src/components/multiplayer/useLobbyConnection.ts`, raw multiplayer session state and quick-play host/join refs live in `src/components/multiplayer/useMultiplayerSessionState.ts`, gameplay WebSocket host/join setup, in-match chat, map sync, role-change, and participant-count handling live in `src/components/multiplayer/useGameplayConnection.ts`, multiplayer invite overlays live in `src/components/multiplayer/InviteOverlays.tsx`, shared multiplayer socket constants and connection types live in `src/components/multiplayer/multiplayerConnectionConstants.ts`, pause-menu home actions live in `src/components/pause/PauseMenuHome.tsx`, mechanics settings grids live in `src/components/settings/MechanicsSettingsGrid.tsx`, pause-screen keybinding settings live in `src/components/settings/KeybindingSettingsModal.tsx`, lighting controls live in `src/components/settings/LightingSettingsModal.tsx`, tournament setup UI lives in `src/components/tournament/TournamentSetupPanel.tsx`, tournament bracket persistence and match lifecycle controls live in `src/components/tournament/useTournamentFlow.ts`, tournament victory overlay UI lives in `src/components/tournament/TournamentVictoryOverlay.tsx`, HUD layout persistence and adjustment behavior live in `src/components/hud/useHudLayoutControls.ts`, current HUD stat defaults and lobby ping synchronization live in `src/components/hud/useCurrentGameStats.ts`, HUD adjustment toolbar UI lives in `src/components/hud/UiAdjustmentToolbar.tsx`, and reusable online-client display, lobby grouping, and multiplayer presence helpers live in `src/network/onlineClients.ts`. `src/App.tsx` keeps top-level screen routing and cross-domain orchestration.
Tournament score-result resolution for App stat updates lives in `src/components/tournament/tournamentStatsResult.ts`.
Top-level game lifecycle actions for starting, closing, resuming, resetting, returning to the main menu, and applying matchmaker endpoint changes live in `src/components/useAppLifecycleActions.ts`.
App stat-update orchestration for tournament outcomes, Edge low-FPS tracking, and HUD multiplayer labels lives in `src/components/useAppStatsUpdateHandler.ts`.

Main-menu primary tab routing for single-player, multiplayer, spectator, and theater panels lives in `src/components/main-menu/MainMenuPrimaryPanel.tsx`.

Main-menu customization/reference tab state, player-loadout bootstrap, paint mode, selected preview weapon, custom armor catalog persistence, and cross-tab refresh after standalone armor-editor saves live in `src/components/main-menu/useCustomizationState.ts`.

Main-menu admin dashboard visibility and persisted Gameplay/Mechanics section-collapse state live in `src/components/main-menu/useMainMenuAdminState.ts`.

Start-menu shell composition, frame splitters, broadcast rail placement, and admin dashboard rendering live in `src/components/main-menu/MainMenuOverlay.tsx`.

Tournament bracket, game-over, and current-match UI live in `src/components/tournament/TournamentBracketPanel.tsx`.

Spectator setup UI lives in `src/components/main-menu/SpectatorSetupPanel.tsx`.

Single-player Sandbox Experience (sandbox and tournament side-by-side) and AI Behavior Editor composition live in `src/components/main-menu/SinglePlayerSetupPanel.tsx`.

Active gameplay rendering, match-loading, HUD, replay heatmap, tournament victory, and in-game chat overlays live in `src/components/ActiveGameSurface.tsx`.

Global overlay composition for first-run notice, terminated state, pause drawer, HUD adjustment toolbar, direct invites, bot setup, replay archive modals, browser warnings, invite notifications, and gamepad cursor lives in `src/components/AppOverlayStack.tsx`.

Pause overlay routing and the gameplay/mechanics pause modal composition live in `src/components/pause/PauseOverlay.tsx`.

Bot setup overlay wiring for Grifball map defaults and main-AI archetype application lives in `src/components/main-menu/BotSetupOverlay.tsx`.

Bot setup defaults, per-slot bot setup state, selected map, and lobby custom-map data live in `src/components/main-menu/useBotSetupState.ts`.

## Worker Relay

The Cloudflare Worker implementation lives in `worker/`.

Useful commands:

- `npm run typecheck:worker` from the repo root
- `cd worker && npm run dev`
- `cd worker && npm run deploy`

## Checks

- `npm run lint`: frontend/root TypeScript check
- `npm run typecheck:worker`: Worker TypeScript check
- `npm run typecheck:all`: frontend and Worker checks
- `npm test`: Node test runner for extracted pure TypeScript modules
- `npm run build`: production frontend build plus bundled Node server

## Build Note

This workspace has previously had Windows `EPERM` locks on stale files under `dist\assets`. Vite is configured with `build.emptyOutDir: false` so `npm run build` can still produce a fresh `index.html`, CSS bundle, JS bundle, and server bundle. Run `npm run clean` when no process is holding `dist` files open.

## Browser Performance

iBrawls expects hardware-accelerated WebGL. The app warns when WebGL is unavailable, blocked, or routed through a slow software rasterizer. Microsoft Edge remains supported, but if Edge reports accelerated WebGL while sustained gameplay stays below 20 FPS for 5 seconds, the app shows an Edge-specific degraded graphics-path warning with `edge://gpu`, `edge://settings/system`, Edge update, and GPU driver troubleshooting steps, then recommends Chrome or Firefox for best performance on that device.

## AI Systems

Tournament mode includes a **NeuralNet** bracket option that runs exported PPO browser brains for live 1v1 matches. `CombatDRV2` remains the default stable brain under `public/brains/combat_dr_v2/`, and `CombatDRV4` is available under `public/brains/combat_dr_v4/` for live practice testing. Both browser artifacts (`manifest.json`, `weights.bin`, and `fixtures.json`) are generated with `python -m ibrawls_rl.export_browser_brain`. Their current trained contract is combat mode, observation version 1, env spec v7, frame stack 4, decision interval 5, input width 560, and action factors `[9, 4, 4, 2, 2, 2]`.

`CombatDRV3` is a new anti-bait brain family, not a replacement for the shipped `CombatDRV2` artifact. Its training contract uses observation version 3 / env spec v9, appending `combat_threat_v3` threat features after the v2 pressure block so the policy can see ready melee opponents, range margins, closing speed, facing-self state, and passive-bait risk. Training can mix scripted bait curricula with `combat_bait_layout_mix`, `combat_bait_opponent`, and `combat_bait_reward_scale`, plus the `dangerApproach`, `baitDisengage`, and `trapDeath` reward components. Promotion now requires the normal combat matrix, a frozen-snapshot matrix score, and the anti-bait matrix: `lone_wolf_score >= 0.75`, `frozen_snapshot_score >= 0.55`, `anti_bait_score >= 0.70`, and `trap_death_rate <= 0.20`. Browser integration remains telemetry-only until a real `public/brains/combat_dr_v3/` export exists and passes those gates; `CombatDRV2` stays the default selectable NeuralNet brain.

Combat AI loop wiring is delegated from `GrifballGame.tsx` with pure decision logic in `src/game/` and single-combatant tick orchestration (10-state FSM including `PRESSURING`) in `src/components/grifball/aiSingleEntityRuntime.ts`. Shared combat geometry helpers, AI orchestrator bridge helpers and arena/orchestrator callback factory, combatant action-state and combatant action callback factory, player weapon action-state and weapon-action callback factory, player sword, hammer, and pistol animation plus weapon-animation frame orchestration, enemy weapon action triggers, tactical weapon-choice runtime adapters, and player sword-lunge target/recovery plus lunge-update runtime helpers, hammer strike impact, player hammer melee impact, player sword slash impact, combat-impact callback factory, combat-resolution callback factory, and pistol hitscan runtime helpers, main-AI sword slash, hammer melee impact, and weapon-animation runtime helpers, AI sword-lunge start, finish, flight, and hit runtime helpers, AI dash movement, spatial-dodge start/fallback, bulltrue counter, lunge-evasion/bulltrue reaction, and ground-movement prelude and ground attack-opportunity runtime helpers, combo-orchestration and combo melee-strike runtime helpers, respawn, local-player respawn, horizontal movement, movement-integration, player physics frame runtime helpers, and player-frame callback factory, active gameplay frame runtime helpers, game-frame callback factory, match-frame callback factory, AI roster callback factory, AI roster tick dispatch, AI tick-state, AI combat-tuning prelude, AI frame-adapter helpers, AI engagement-frame prep, AI coordination runtime, AI bookkeeping and combat-bookkeeping callback factory, pressure-state lunge preference/approach/dash/re-swing, post-kill pressure, airborne hammer-opportunity, airborne/pre-ground recovery, and no-target spawn-guard runtime helpers, AI combatant frame-sync and weapon-timing helpers, arena/collision callback factory, arena boundary and sword-lunge boundary helpers, AI target prediction/clamp, AI combat-range, AI incoming-lunge, and body-collision helpers, arena frame sync, arena runtime spawn/resize adapters, player collision sync, runtime state/ref initialization, match timer helpers, Grifball neutral-objective runtime, AI team-awareness, and AI objective-movement runtime helpers, bot melee impact runtime helpers, trade bookkeeping and sword-lunge trade-resolution runtime helpers, outgoing multiplayer-hit runtime helpers, multiplayer mode/prop sync and WebSocket packet-handler helpers, player/AI target-selection, tactical target scoring, and tactical target callback factory helpers, HUD stats builders and HUD push adapters, death-feed and player-medal helpers, match-pressure tuning adapters, replay data, replay runtime callback factory, replay playback event controls, interpolation, visual sync, and playback-frame runtime helpers, replay recording initialization/persistence, match telemetry, replay-target helpers, and view-target callback factory, adaptive player-model observation callback factory and persistent-memory adapters, AI altitude-recovery adapters, spectator target-data adapters, legacy roster prop adapters, input/pointer ref management plus player look, weapon input dispatch, keyboard action dispatch, chat input focus guards, observer keyboard/custom-event controls, input handler factory, input listener registration, and observer movement runtime helpers, prop contracts, map selection, overlay DOM projection, mount-scene orchestration, scene initialization, custom-map base arena setup, live camera/FOV and render-frame helpers, arena spawn/resizing helpers, Three combatant model construction, host/enemy model rebuild helpers, and remote combatant provisioning, combatant animation, visual-update callback factory, observer and roster visual sync, and mesh lookup helpers, admin-settings/invulnerability/debug/jump-zone/emissive/weather visual-state and transient VFX callback, creation, lifecycle, and frame-update helpers, weapon audio helpers, and custom-map procedural asset generation live under `src/components/grifball/` so the main game component stays under Babel's 500KB styling deoptimization threshold while preserving the existing `createHighFidelityObjectMesh` export.
Championship stadium, synthwave, rainy-streets, and winter-rink custom-map scenery construction live in `src/components/grifball/customMapStadiumSceneryRuntime.ts`, `src/components/grifball/customMapSynthwaveSceneryRuntime.ts`, `src/components/grifball/customMapRainyStreetsSceneryRuntime.ts`, and `src/components/grifball/customMapWinterSceneryRuntime.ts`; default hangar/holodeck arena construction lives in `src/components/grifball/defaultArenaSceneRuntime.ts`, local first-person weapon/debug/jump-zone mesh setup lives in `src/components/grifball/localPlayerViewRuntime.ts`, multiplayer remote-enemy view setup lives in `src/components/grifball/multiplayerEnemyViewRuntime.ts`, initial offline roster seeding lives in `src/components/grifball/offlineRosterInitializationRuntime.ts`, pointer-lock/drag/touch look math and handler factories plus pointer/mobile/keyboard player input dispatch lives in `src/components/grifball/playerInputRuntime.ts`, chat input focus/key guards live in `src/components/grifball/chatInputRuntime.ts`, observer keyboard/custom-event controls live in `src/components/grifball/observerInputRuntime.ts`, and DOM input listener registration/cleanup lives in `src/components/grifball/inputEventListenersRuntime.ts` so arena, player-view, roster, and input setup can continue leaving `GrifballGame.tsx`.

| Module | Role |
|--------|------|
| `aiCombatDecision.ts` | Tactical weapon choice; punish-window gates when opponents are dash- or swap-locked (mechanic-aware difficulties) |
| `aiTuning.ts` | Hybrid tuning: derives spatial IQ, feint chance, and pressure aggression from the 7 base knobs, with optional Custom Matrix overrides; score-aware match multipliers for leads, deficits, close games, and match point |
| `aiMatchContext.ts` | Per-match memory (player models, feint cooldowns, combo state, skill calibration, multi-bot coordinator) reset on match start |
| `aiComboEngine.ts` | Mid-combat weapon combo strings (Mixup, Safe Finish, Bait & Smash, Double Tap); gated by weapon-swap IQ ≥ 70/90 and weapon prioritization |
| `aiPlayerModel.ts` | Adaptive opponent modeling via EMA observations (lunge habits, dodge bias, counters); persists a tiny IndexedDB style fingerprint across matches while raw per-match volumes reset |
| `aiPressure.ts` | Post-hit pressure chains: enter/exit gates, approach speed, and follow-up attack timing driven by `pressureAggression` |
| `aiFeints.ts` | Mind-game feints: approach abort, weapon-swap fake, charge abort, and lunge fake-out; gated by `feintChance`, per-bot cooldowns, and player-model counter feedback |
| `aiSpatialStrategy.ts` | Arena spatial control and evasion: edge/center scoring, cut-off intercepts, spawn-guard aim, target selection bonuses; perpendicular dodges away from arena edges, variable lunge trigger range (±20%), bait dodges at ~12m, post-dodge punish commits, and player-model dodge timing |
| `aiMovementMechanics.ts` | Locomotion-mechanic usage: sprint (close ground / chase fleeing targets) and committed slide gap-closers, gated by the live `enableSprint`/`enableSlide` toggles and scaled by `speedSprint`/`speedSlide`/`slideDistance`/`slideCooldown` |
| `aiPersonalities.ts` | Six combat archetypes with knob presets and flags (spacing, pressure skip, feint bias); sandbox UI + tournament assignment |
| `aiPsychologicalPressure.ts` | Mind-game tempo: post-kill spawn camping, slow/fast reaction bands, lunge-kill sword telegraphs, escalating standoff commits |
| `aiBotCoordinator.ts` | Multi-bot coordination: shared focus target after damage tags, pincer approach offsets, staggered attack phases, pressure/flanker/punisher roles at 3+ bots |
| `aiOrchestrator.ts` | Offline roster lifecycle: spawn/despawn to `offlineBotCount`, `main_ai` ensure/remove, per-slot team/config distribution, per-frame coordination tick (never drives `controller: 'remote'` entries) |
| `aiSkillCalibration.ts` | Rolling engagement window (last 10) tracking K/D, dodge/counter success, and death pacing; subtle ±12.5% drift on `reactionLatency`, `anticipationFactor`, and lunge aggression for standard difficulties only |
| `rosterSlotConfig.ts` | Unified per-slot AI config (`RosterSlotConfig`): Sandbox neural-net settings are the default template; each combatant (main AI + bots) resolves knobs through the same path with optional per-slot overrides |
| `roster.ts` | Unified combatant roster: `otherPlayers` map holds every non-local combatant with a `controller` discriminator (`ai` = locally ticked bots, `remote` = network humans); `main_ai` is slot 0 offline; helpers (`getAICombatants`, `getRosterCombatant`, `isAICombatReady`, etc.) filter AI vs remote for tick/render/HUD |
| `teamScoring.ts` | Per-team tally (`blue` / `red`) as scoring source of truth; legacy `scorePlayer` / `scoreEnemy` / `enemy*` fields bridge through perspective-aware accessors; `RosterSlotConfig.team` drives combatant team assignment |
| `aiGrifballRoles.ts` | Grifball AI role resolution (`runner`, `escort`, `chaser`), fanned V-shaped screening target positions, allied spacing repulsion, and runner obstacle-avoidance steering vectors |

The reinforcement trainer and dashboard live under `python/ibrawls_rl/`. The TypeScript sim remains the gameplay source of truth while Python owns PPO training, frame-stacked short history, reward-component logging, combat evaluation matrices, and frozen snapshot league grades. Combat training can use explicit scenario mixes such as `1v1x16`, `1v2x6`, `1v3x6`, `1v7x2`, `ffa4x6`, and `ffa8x4`, with a lone-wolf reward scale for singleton teams in asymmetric layouts; combat mode does not add a low-health scenario, which remains a Grifball runner condition. The sim action schema includes nearest-hostile aim for combat policies, optional reward-discipline penalties expose wasted attack/dash/jump/swap/repeated-action behavior as `reward_component/*` metrics in the control board, and older 21-logit combat checkpoints auto-migrate into the 22-logit action head when warm-starting if network width/depth still match.

RL runs also write `training_metadata.json` with the model contract and sampled mechanics coverage. The Control Board Evaluate tab reads that Brain Contract for selected models, falls back to partial `config_used.toml` data for older runs, and can run a combat Mechanics suite that repeats the matrix over nominal, low-band, high-band, and live-current mechanics so rankings account for worst-preset robustness.


All offline AI combatants (including `main_ai` at roster slot 0) share the same voxel Spartan mesh rig via `otherPlayerMeshes` / `createOrUpdateRemotePlayer` (including mesh provisioning on orchestrator spawn/hue change). Offline AI is currently clamped to the Medium V2 model profile even if stale bot setup state requests Large; player and remote-human loadouts can still use Large. The legacy `enemyGroup` path is retained **only** for multiplayer observer/host-client spectate rendering — not for offline bot display. Offline sandbox stores every AI in `otherPlayers` with `controller: 'ai'`; multiplayer stores remote humans with `controller: 'remote'` and never runs local AI ticks on them.

**Roster membership:** One `otherPlayers` map keyed by combatant id. Each entry is a full `Combatant` plus `controller: 'ai' | 'remote'`. **`aiOrchestrator.ts`** runs once per offline frame to spawn/despawn bots to `offlineBotCount`, ensure `main_ai`, distribute per-slot config/teams, and tick bot coordination (`aiBotCoordinator`). `getRosterAI()` / `getAICombatants()` drives `updateAI`; `getDisplayOpponent()` drives HUD/enemy stats (main_ai offline, primary remote online). Replay recording writes all AI combatants into `frame.otherPlayers`; legacy `frame.ai` is read-only for older replays.

**Phase 6 cleanup:** No privileged `main_ai` combat loops — damage, pressure, respawn, skeletal animation, and replay all iterate the roster uniformly. The stable id `'main_ai'` remains as offline slot 0; `mai()` is a thin accessor to `getMainAI()`. Team scoring bridges (`scoreEnemy`, `enemy*`) remain for HUD/multiplayer perspective.

**Team scoring:** Match scores live in `teamScores` (per-team `score`, `kills`, `deaths`, `respawnTimer`). Sandbox maps the local player to `blue` and AI combatants to `red` via `RosterSlotConfig.team`. HUD, win conditions, elimination feed, and multiplayer sync still read the legacy `scorePlayer` / `scoreEnemy` names through bridges that flip perspective for multiplayer clients (client = red). Main AI death/respawn updates both the combatant object and the red-team tally via legacy `enemy*` bridges.

**Custom AI Behavior** (the `custom` difficulty, formerly "Custom Matrix Override") exposes *every* engine-wired AI dial in a grouped panel: base neural-matrix knobs (reflex latency, anticipation, strafe/evade, weapon-swap IQ, playstyle, weapon prioritization) plus advanced behavior overrides — `aiSpatialIQ`, `aiFeintChance`, `aiPressureAggression`, `aiSpacingBand` (combat spacing), and `aiSkipPressure` (disable post-hit pressure chaining). Advanced overrides display "Auto" until set and fall back to derived/neutral values. All of these persist in saved Custom AI Presets (`AITuning`) and are threaded per-bot through `RosterSlotConfig`. **`aiPersonalities.ts`** provides six **Behavior Archetype Presets** (Berserker, Counter-Fighter, Zoner, Mixup Artist, Assassin, Brawler, formerly "Combat Archetype") that overlay difficulty tuning with distinct knob presets and behavioral flags (`skipPressure`, `feintBias`, `spacingBand`); selecting one fills in every Custom AI Behavior dial as an editable starting point. Sandbox, admin settings, and the Holographic Combatant Grid bot setup expose the archetype dropdown; tournament opponents receive a random archetype per bracket entrant or can be procedurally generated from a selected pool of Custom AI Presets. **`rosterSlotConfig.ts`** applies the Sandbox "AI BEHAVIOR EDITOR" panel as the shared default for every AI combatant; per-slot grid overrides (difficulty, archetype, hue) merge on top so bots inherit the full weapon-prioritization range (e.g. sword-100) unless explicitly overridden, while bot model type overrides are ignored and resolve to Medium.

> Convention: any new AI-behavior knob added to the combat engine must also be exposed in the Custom AI Behavior panel, persisted in `AITuning` presets, and threaded through `RosterSlotConfig`.

**PRESSURING state:** When a bot lands a non-lethal hit and `pressureAggression` is above threshold (passive bots skip), it enters `PRESSURING` instead of retreating through a full `COOLDOWN`. The bot closes faster, uses shorter attack timers, prefers hammer re-swings or sword lunges, and exits when the target dies, becomes invulnerable, leaves range, or the pressure timer expires. Chain length scales with score context (longer when behind, shorter when protecting a large lead).

**Match state awareness:** `deriveMatchStateMultipliers()` reads `scorePlayer` / `scoreEnemy` (and tournament `killsToWin`) to modulate aggression, spacing, cooldowns, weapon-swap IQ, coin-flip trade avoidance, and PRESSURING duration. Large leads play safer; large deficits press harder; scores within 2 get peak tactical IQ; match point behavior splits between extreme commit (aggressive playstyle) and extreme patience (passive playstyle).

**Weapon combo strings (IQ ≥ 70):** High weapon-swap IQ bots chain mid-combat sequences stored in `aiMatchContext.comboState`. **Mixup** (hammer hit → sword lunge), **Safe Finish** (double hammer), **Bait & Smash** (IQ ≥ 90: sword flash → hammer punish), and **Double Tap** (sword hit → hammer finish) respect swap lockouts, abort on target state changes, and override tactical swaps while active. Mixup Artist tournament/sandbox opponents initiate combos most often.

**Feinting (Hard+/Custom IQ ≥ 60):** Bots with non-zero `feintChance` can abort forward approaches, flash a sword swap before reverting to hammer, sideways-dash out of committed charges when the opponent swings, or rush in without lunging. Each feint respects a 3–5s per-bot cooldown stored in `aiMatchContext`. Counter-heavy players (high `counterRate` in the adaptive model) see reduced feint pressure.

**Smart evasion:** Incoming sword lunges trigger perpendicular dashes (or hammer jumps / sidestep jumps as fallbacks) using `aiSpatialStrategy` to pick a side away from the arena boundary and informed by learned dodge bias. Detection range jitters ±20% with `spatialIQ`; bait dodges can fire near 12m when an opponent holds sword. After a successful evasive dash, bots may enter `CHARGE_ATTACK` when the target is recovering and in range. Learned opponent `reactionTime` slightly scales evasion trigger distance.

**Arena spatial control:** `scorePosition` and `getSpatialMovementBias` (gated by `spatialIQ`) steer `APPROACHING` and `SIDE_STEPPING` movement: bots recentre when exposed on the edge, cut off retreat paths when targets are pinned, and press harder when an opponent is cornered. `SPAWN_GUARDING` uses a corridor-aware aim angle and recentres when too close to the boundary. Hard+ target selection adds a bonus for edge-pinned opponents.

**Locomotion mechanics (sprint & slide):** `aiMovementMechanics.ts` lets bots use the same optional movement mechanics the player tunes in Gameplay / Mechanics Options. When `enableSprint` is on, bots sprint (scaled by `speedSprint`) to close ground while `APPROACHING`/`DANCING_FORWARD`/`PRESSURING` or to chase a fleeing target. When `enableSlide` is on, bots commit a `slideDistance`/`speedSlide` slide as a mid-range gap-closer and then respect `slideCooldown`. Both read live from settings each frame—toggling a mechanic off or retuning its speed/distance/cooldown takes effect immediately—and never stack with dashes. Sprint/slide also drive the bot’s crouch posture and run/slide animation.

**Psychological pressure (Hard+, aggression ≥ 15):** After a lethal hit, bots rush the victim’s anticipated spawn (`aiPsychologicalPressure` + `aiMatchContext.psychState`) instead of resetting—lunge kills hold sword at the spawn lip as a telegraph. During neutral exchanges, tempo alternation toggles effective `reactionLatency` every ~9s (slow vs fast bands), and mid-range standoff timers in `SIDE_STEPPING` escalate commit chance using match-state multipliers from `aiTuning`.

**Multi-bot coordination (Hard+ offline):** When one bot tags damage, `aiBotCoordinator` sets a shared priority target for ~8s so allies focus fire. Two or more bots on the same target pincer with lateral offsets; attack commits stagger by role (pressure → flanker → punisher). Three or more assign punisher bots that wait for recovery windows before swinging. Easy difficulty skips coordination.

**Dynamic skill calibration (Normal/Hard/Nightmare):** `aiSkillCalibration` maintains a rolling window of the last 10 engagements per bot (kills, deaths, dodge/counter outcomes, time-between-deaths). When the player dominates, bots receive a subtle buff to reaction speed, anticipation, and lunge aggression; when the bot dominates, those knobs drift down slightly (±12.5% max). Disabled for Custom difficulty (including tournament opponents with explicit tuning) and Easy mode.

### Grifball AI Behavior

For the specialized Grifball game mode, the combat engine drives customized tactical behaviors:
- **Goal Plates**: Grifball goals are floor-mounted cyberpunk plates sized to the V1 Spartan collision radius (1.1m default diameter). The scoring trigger is resolved from the placed object footprint, so resizing a goal plate in the Map Maker also resizes the live scoring zone.
- **Runner / Ball mechanics**: Gameplay / Mechanics Options includes a Runner / Ball category for carrier-only forward/strafe/backward speed multipliers, throw enablement, trajectory line color/thickness, punch reach/cooldown, runner health, delayed healing, healing rate, and runner thrust enablement. Defaults preserve the current feel: 130% runner directional speed, throwing on, red 0.14m trajectory dashes, 1.8m punch reach with a 1.5m contact radius, 0.5s punch cooldown, 2 HP runner health, 3.0s heal delay, 1.0 HP/s healing, and thrust on. These settings are wired into live gameplay and the headless sim; this change does not add them to RL domain randomization or the mechanics observation contract.
- **Escorts**: Form a dynamic V-shaped screening formation ahead of the runner (fanned out left, right, or center based on roster indexing) and maintain spacing (default 4.0m) to prevent collateral double-kills from enemy hammer blasts. They defend themselves if enemies approach close (< 6.0m).
- **Chasers / Loose Ball**: Rush the ball or enemy carrier while applying teammate spacing repulsion to prevent clustering in a single voxel point.

## Theater Mode

iBrawls includes a high-fidelity 3D "Theater Mode" archive that allows players to save, rename, search, filter, and play back their recorded gameplay sessions with granular media player control.

- **Fidelity Playback**: Instead of video recording, the system transcribes active gameplay structural snapshots at a stable **20Hz (50ms)** tick rate.
- **Zero-Movement Compression**: Drastically reduces file sizes (under ~200KB for an 8-minute 8-player match) by filtering out stationary pilot frames where coordinates change $<0.001$ and state matches the previous frame. Missing keyframe deltas are dynamically reconstructed on-the-fly during playback using reverse scanning.
- **Interpolation Engine**: Angles are resolved using shortest-path wrapping:
  $$\Delta\theta = \text{atan2}(\sin(\theta_B - \theta_A), \cos(\theta_B - \theta_A))$$
  to prevent visual spin flips when yaw bounds are crossed. Position coordinates are interpolated using linear LERP, presenting a fluid 60FPS spectator experience.
- **Full Joint & Skeletal Animations**: Spartan models dynamically run walk/run/sprint leg cycles, crouch/slide leaning, and weapon swinging/melee sweeping torso twists during playback by executing the full `animateSpartanModel` skeletal animation engine in the replay loop.
- **Swappable Attack Animation Presets**: `hammerAttackAnimation` and `swordAttackAnimation` can switch from the legacy weapon poses to programmatic high-fidelity hammer swing/melee and sword lunge/slash poses that use staged windups, stronger silhouettes, and recovery settling for clearer combat reads.
- **Gravity Hammer Slam Timing**: Gameplay / Mechanics Options exposes `hammerSlamWindupTime`, `hammerSlamAttackTime`, and `hammerSlamTimingLocked`; locked edits preserve the legacy 0.28s / 0.12s phase ratio while unlocked edits tune windup and strike phases independently. Damage and VFX land after `windup + attack`, while hammer recovery and melee sliders remain separate.
- **Replicated VFX and Audio Cues**: Dashing, lunging, and weapon swings automatically trigger their matching sound effects, speed lines trails, evasion box particles, and colossal hammer ground-impact splash explosions, shockwaves, and ground burn decals.
- **Replay Heatmaps**: New replay files include explicit `heatmap` event data (`version: 1`) for kill, death, and recorded medal events with replay time, actor/victim ids, team, weapon, and world `x/z` location. Theater cards render an end-of-film 2D top-down heatmap preview when that data exists; the heatmap uses the map's top-down floor art as the base image, including the default Circular Arena/Hangar tile atlas plus authored custom floor tiles, obstacles, goal plates, and spawn markers when map data is available, so event positions line up with recognizable field geometry. The 3D replay view starts with a collapsible, resizable heatmap panel, and Theater can open a heatmap-only playback mode with the same timeline. Older replay files without `heatmap.events` show an empty/disabled heatmap instead of deriving events from frame counter deltas.
- **Replay Visual Policy**: New replay files store the match visual model policy and sanitized loadout-like metadata for playback. Older replay files with no visual policy keep legacy Version 1 playback visuals, and upload sanitization strips raw mesh/private reference data before replay metadata leaves the local archive.
- **Rolling Match Cache**: Features a local rolling cache of the last **5 auto-saved matches** (via IndexedDB) that overwrite sequentially. Players can commit cache items permanently to the **Replays Archive** with custom titles and descriptions.
- **Spectator Controls**: A bottom glassmorphism timeline control bar enables:
  - Timeline scrubbing/seeking to any second of the match.
  - Variable speed multiplier rates (`0.25x`, `0.5x`, `1.0x`, `2.0x`, `4.0x`).
  - Active lock-target tracking dropdown to focus first-person, third-person orbit, or free fly-camera on any recorded Spartan.
  - Fully simulated scoreboard and SFX/sparks triggers synced forward-only to prevent audio cluster when scrubbing.

## Controls & Inputs

iBrawls supports both classic Keyboard + Mouse inputs and native Gamepad (Xbox/PlayStation controller) support, configurable via the custom settings panel. Main-menu parent buttons such as **Play**, **Customization**, and **Creative Tools** reveal their child actions directly beneath the parent navigation row, so users can switch setup, controls, armor, and tooling views without hunting through a separate side dock.

The main menu frames are resizable on desktop: drag the docked dividers between game setup, customization, and global chat to resize the layout. Frame sizes persist locally under `ibrawls_main_menu_frame_layout_v1`; use **Reset Frame Layout** in the menu header to restore the default proportions. Global chat messages are normalized, capped at 240 characters, and rate-limited by the relay so rapid spam bursts are rejected before broadcast.

### Keyboard + Mouse Controls
- **Move**: `W`, `A`, `S`, `D` (or Arrows)
- **Jump**: `Spacebar` (Launch hammer jump if pressed immediately after Slam)
- **Thrust**: `Q` (Quick dash in movement direction)
- **Pickup**: `E` (Pick up the ball when in range)
- **Crouch / Slide**: `C` (Slide when running forward)
- **Sprint**: `Shift` (Hold while moving forward)
- **Scoreboard**: `U` (Hold to view current stats)
- **Weapon Slot 1 (Hammer)**: `1`
- **Weapon Slot 2 (Sword)**: `2`
- **Switch Weapons**: `Scroll Wheel`
- **Primary Attack**: `Left Mouse Button` (Hammer Slam / Sword Lunge)
- **Secondary Attack**: `Right Mouse Button` (Sword Quick Slash)
- **Pause / Menu**: `Escape`

### Gamepad (Xbox Controller Layout)
- **Movement**: `Left Analog Stick` (First-person movement / Spectator fly-movement)
- **Aim / Camera**: `Right Analog Stick` (First-person aim rotation)
- **Jump**: `A` (Button 0)
- **Crouch / Slide**: `B` (Button 1)
- **Pickup**: `X` (Button 2)
- **Thrust**: `Left Shoulder (LB)` (Button 4)
- **Swap Weapon**: `Y` (Button 3)
- **Primary Attack**: `Right Trigger (RT)` (Button 7)
- **Secondary Attack**: `Right Shoulder (RB)` (Button 5)
- **Sprint**: `Left Stick Click (LS)` (Button 10)
- **Scoreboard**: `Back / View` (Button 8)
- **Pause / Menu**: `Start` (Button 9)

### Gamepad Menu Navigation (Controller Cursor)
When in menus, setup screens, or paused:
- **Menu Cursor Movement**: `Right Analog Stick` (Presents a custom cyan neon cursor ring, with speeds modifiable via the dedicated **Controller Cursor Speed** settings slider)
- **Simulate Mouse Click**: `A` (Button 0)
- **Drag UI Sliders**: Hold `A` and move the `Right Analog Stick`
- **Interactive Highlight**: Hovering over interactive UI elements (buttons, inputs, sliders) applies a glowing neon blue highlight outline (`.gpad-hover`)

An interactive, high-tech visual controller mapper panel in the hotkey adjustments overlay displays a large-scale Xbox controller linked directly to action labels via wireframe paths. It supports click/tap-to-rebind for PC and mobile, real-time diagnostic button-press highlights, and a 3-second button hold directly on the controller to prompt mapping configuration with custom circular hold-progress indicators.

## Physics & Collisions

To prevent players and AI characters from passing straight through one another, iBrawls incorporates a 2.5D cylinder-based rigid-body collision system:

- **Entity Cylinders**: Every active, living participant (local player, main AI, and custom bots/remote players) is bounded by a model-profile collision cylinder. V2 Medium keeps the legacy radius of **0.55m** with **1.8m** standing / **1.2m** crouching height, while V2 Large uses a broader **0.75m** radius with **2.2m** standing / **1.45m** crouching height. Melee, hammer-impact, and sword-lunge target checks add the same Large radius bonus so the larger visual body has a matching gameplay hitbox.
- **Kinematic Resolution**: When two participants overlap both horizontally and vertically, they are pushed apart by **50%** of the overlap depth each along the collision normal.
- **Velocity Normal Damping**: To ensure collisions feel solid and prevent jittering or high-speed passthroughs, the relative velocity component along the collision normal is cancelled when entities are moving towards each other.
- **Multi-iteration Solver**: The collision engine runs for **3 iterations** each frame inside `enforceArenaBounds` before bounding players to the circular arena, ensuring perfectly stable physics even in crowded multi-bot pincers.
- **Arena Boundary Walls**: Circular and rectangular arena bounds act as hard walls for live combatants and the Grifball ball. Free-ball physics receives the active map bounds in both the browser runtime and the headless sim, clamps the ball center by its radius, and reflects thrown-ball horizontal velocity so wall bounces are visible in both live play and the throw trajectory preview.
- **Zero-lag Rendering**: State positions are proactively synchronized to Three.js group meshes immediately following collision resolution to eliminate 1-frame rendering lag.

## Map Selection & Environments

Local play setups feature an interactive map selector overlay supported by a dynamic, real-time rotating 3D preview of both standard arenas, premade environments, and custom-loaded maps. Each map now features an adaptive HD procedural 360-degree **Sky Dome** (inverted sphere mesh) running independent of fog, with 4096x2048 sky textures on capable desktop devices and 2048x1024 fallback textures on constrained/mobile devices. Skyboxes now pair with a map-authored atmosphere system for animated haze, optimized instanced cloud decks, starfields, weather particles, lightning pulses, energy bands, celestial bodies, and horizon detail while preserving the existing skybox selector/export contract.

- **Industrial Hangar**: The default grimy voxel-art warehouse environment. It includes a custom steel hangar skybox with scaffolding trusses, caution light beams, and a colossal viewport showing a blue planet in orbit.
- **Circle Arena (Holodeck)**: A clean, sleek virtual simulation deck. It features the holodeck coordinate grid void skybox—a perfect bright gold grid wrapping the entire sphere in horizontal and vertical lines.
- **Cyber Hex Grid (Preset)**: A high-tech tactical holodeck featuring glowing neon pillars, defensive carbon-fiber partitions, rechargeable crates, and a central plasma core reactor emitting massive violet neon glows.
- **Jungle Ruined Outpost (Preset)**: An overgrown, crumbling training outpost dominated by nature elements. Features rustic stone walls, giant mossy boulders, forest giant tree trunks, and a mystical emerald crystal totem.
- **Vanguard Asteroid Mine (Preset)**: An industrial minerals extraction facility situated on a space asteroid. Featuring heavy blast doors, freight containers, metallic core processor drills, amber industrial warning lights, and orange-veined meteorite ore clusters.
- **Forerunner Canyon Plateau (Preset)**: A suspended rectangular forerunner arena hovering over a golden desert canyon at sunset. Features team-colored spires (Blue on the left, Red on the right) and a majestic background beacon tower.
- **Neon Outrun Grid (Preset)**: A suspended rectangular retro holodeck hovering over a glowing cyber city at twilight. Features glowing neon palm trees, background light beams, and a colossal striped sunset sun.
- **Rainy Cyber Streets (Preset)**: A dark, rain-slicked industrial street court under warm sodium spotlights, framed by towering skyscrapers and a giant neon dog billboard.
- **Glacier Hockey Rink (Preset)**: A pristine rectangular ice hockey arena set in a beautiful, sunlit arctic glacier valley. Features surrounding clear-blue acrylic glass boards, red hockey goal posts, background icebergs, snowy pine trees, and gently falling snow.
- **Grifball Championship Stadium (Preset)**: An elite, high-tech steel arena framed by cheering stands, brilliant stadium spotlights, a massive center scoreboard, and glowing team boundary lines. Features a suspended scoreboard showing Spartan silhouette screens and corner floodlight towers casting dramatic light beams.
- **Custom Local Map**: Load a custom map file (`.json`) exported from the local Standalone Map Maker. The 3D thumbnail preview updates in real-time to render all placed obstacles, light sources, and spawn points in miniature!
- **High-Fidelity 3D Assets Engine**: A dynamic geometry processor that intercepts simple primitives (flat boxes, cylinders, spheres) and upgrades them at render-time into complex, compound 3D models. Standard primitives are transformed into detailed thematic assets like tapering Forerunner obelisks with floating energy crystals, heavy freight containers with vertical corrugated panel ridges, chamfered recharge station crates, and floating planetary plasma reactors with orbital stabilizer rings. The V2 voxel map-object pass raises the reactor, Forerunner spire, tech crate, mossy boulder/meteor, and cargo-container generators to denser deterministic grids with added cage frames, emissive channels, hazard striping, craggy mineral veins, door hardware, cooling units, and status-light details while preserving the existing primitive dispatch path.

## Standalone Animation Editor

`animation-editor.html` is a local frame-by-frame weapon animation editor served by the Vite/Node dev server. It previews the same voxel Spartan, gravity hammer, katar sword, and pistol builders used by the game, lets the editor set three anchor key poses at arbitrary frames, and generates every missing `WeaponPose` frame between those anchors with linear, smoothstep, or cubic interpolation. Position channels are interpolated directly, while Euler rotations use shortest-path angular interpolation so keyed poses rotate through the direct movement direction.

Open it from the main menu via **Animation Editor** or visit `http://localhost:3000/animation-editor.html` while `npm run dev` is running. The tool can show bone/socket overlays, select weapons, bones, or sockets as transform targets, keyframe those rig targets independently, lock weapon targets to a chosen socket pivot for socket-relative rotation, reposition a weapon directly onto the selected socket, export versioned rig JSON including those socket-lock relationships, and still copy the original TypeScript `WeaponPose[]` snippet for moving refined weapon poses back into `src/components/grifball/attackAnimationPresets.ts`.

Voxel Spartans now expose a lightweight combatant rig contract in `src/components/grifball/combatantRig.ts`. The rig wraps the current voxel body segments in explicit group-pivot articulation controllers (`root`, `lowerTorso`, `upperTorso`, `head`, arms, and legs), keeps the raw visible meshes under `segmentGroups`, and inserts named attachment lock points such as `thirdPersonWeaponGrip`, `thirdPersonOffhandGrip`, `rightHandGrip`, `leftHandGrip`, `firstPersonWeaponGrip`, `headCenter`, and `chestCenter`. Third-person weapons are mounted through the right-hand combat grip and the shared attack presets convert legacy torso-space weapon poses into hand-local transforms, so hammer windups/strikes/melee and sword lunges/slashes now drive matching right- and offhand arm poses across AI, roster, observer, and replay visuals. V3 models also expose a reference-inspired detail bone map for pelvis, spine, chest, neck, helmet, backpack, clavicles, upper/lower limbs, hands, grips, feet, and toes so procedural armor parts can fit and animate against finer anchors while retaining the existing broad rig contract. This is still a grouped voxel rig, not a full skinned-mesh skeleton with blend weights.

Phase 5 adds a V3-only layered procedural animation runtime. V3 combatants now compose lower-body locomotion with upper-body hammer, sword, and pistol action layers so attacks can animate above active movement, and the local animation editor exposes Version 3 model and hammer/sword/pistol targets for refinement. V1/V2 animation paths remain selectable and unchanged.

## Standalone Armor Model Editor

`armor-model-editor.html` is a full-screen V2/V3 armor model editor served by the Vite/Node dev server. Open it from the main menu via **Armor Editor**, from the Armor tab via **Create / Edit V2 Armor Model** or **Create / Edit V3 Armor Model**, or visit `http://localhost:3000/armor-model-editor.html` while `npm run dev` is running.

The page reuses `src/components/main-menu/ArmorModelEditor.tsx` in standalone layout mode so the voxel canvas, validation panel, material tools, catalog, and import/export controls get the full browser workspace instead of the narrow customization rail. Its viewport supports direct mouse inspection with drag-to-orbit, modified/right/middle drag panning, and wheel zooming while keeping voxel edits reserved for intentional clicks. It reads and writes the same `grifball_player_loadout`, `grifball_player_hue`, `grifball_custom_armor_catalog`, and `grifball_v3_suit_profiles` localStorage keys as the main app. When an armor piece or V3 suit profile is saved in the standalone editor, the main menu refreshes its customization catalogs on storage/focus events and the saved entry appears in the regular Armor Loadout or Suit Profiles UI.

Phase 6 adds V3 modular armor customization and a V3-aware local armor editor. V3 custom armor pieces are local voxel payloads keyed to V3 fit-bound slots and paint roles, saved in the existing custom armor catalog, and consumed only by the V3 visual builder. V1/V2 remain selectable, V2 medium/large editor behavior is preserved, and no mesh/OBJ/FBX upload path is exposed to end users.

### V3 Offline Asset Tooling

V3 reference mesh tooling is developer-only and local. Use `node --import tsx scripts/v3/inspect-reference-asset.ts --obj <local.obj>` to inspect OBJ metadata, and use `/v3-asset-preview.html` during local development for synthetic voxel budget previews. Do not commit private reference meshes, textures, or direct conversions.

Phase 3 canonical V3 asset contracts live in `src/components/v3/`. `v3ModelTypes.ts`, `v3PartBounds.ts`, `v3AssetManifest.ts`, and `v3Lod.ts` define original iBrawls modular armor slots, hammer/sword/pistol weapon manifests, paint roles, visual fit bounds, socket metadata, budget estimates, and desktop/mobile LOD selection. These files are manifest contracts only: they do not include private reference meshes, textures, generated conversions, voxel payload arrays, or any runtime upload path.

Phase 4 adds original runtime V3 blockout builders for the default modular character and V3 hammer/sword/pistol weapons. These builders route `modelSystem: 'v3'` through the live model factory and expose broad rig-compatible segments, V3 detail rig anchors, and V3 socket metadata. Phase 5 layers V3 procedural locomotion/action animation and V3 editor targets on top of those builders. Phase 6 adds local V3 modular custom armor editing.

Phase 7 added match-wide visual policy plumbing, loading-preview policy resolution, and replay visual metadata. Gameplay match setup supports V1 Classic and V2 Rigged for regular players; V3 Advanced remains an admin-only visual policy while the advanced models continue production hardening.

Phase 8 adds adaptive V3 render quality using the canonical `mobileLow`, `mobile`, `desktop`, and `ultra` tier names. Mobile devices default no higher than `mobile`, and unaccelerated graphics defaults to `mobileLow`. Quality is render-only: selected LODs, budget metadata, and constrained-tier remote animation throttling do not alter hitboxes, movement, AI decisions, weapon timings, scoring, replay timing, or network authority. Use `/v3-performance-smoke.html` while `npm run dev` is running to render eight V3 combatants with mixed hammer/sword/pistol loadouts for desktop and mobile smoke checks.

V3 remains visual-only while the advanced models continue production hardening. New offline and hosted matches default to Version 2 Rigged, regular-player Model Set controls expose only Version 1 Classic and Version 2 Rigged, admin sessions also expose Version 3 Advanced, and invalid or unavailable gameplay policies still normalize back to Version 2.

Phase 10 starts the production asset quality pass. Built-in V3 character parts and V3 hammer/sword/pistol visuals now run through deterministic production-quality audits for material diversity, emissive/detail usage, silhouette variation, and budget compliance before they are treated as production candidates.

Phase 11 upgrades V3 animation fidelity with shared procedural pose profiles, deterministic additive motion, first-person weapon sway/recoil, replay-aware active weapon body animation, and animation-editor exports that identify their V3 procedural profile source. These changes remain visual-only: V1/V2 animation, hitboxes, weapon timings, network authority, replay timing, and gameplay simulation are unchanged.

Phase 12 hardens the developer-only offline V3 asset pipeline. Local OBJ/MTL inspection can now emit sanitized review packages with slot candidates, paint-role hints, coarse voxel previews, fit/budget validation, and source-safe metadata. These packages are for local art-direction review only: private reference files, texture paths, direct conversions, server uploads, and gameplay/runtime mesh import remain excluded.

Phase 12B expands V3 creator depth. V3 armor and V3 weapon visuals can share per-role paint overrides, the armory exposes V3 material-role controls, and the armor editor surfaces role coverage, budget comparison, built-in deltas, save-copy, and history restore workflows. These tools stay local and visual-only: V1/V2 customization remains available, gameplay simulation is unchanged, and mesh upload/import remains excluded from player-facing UI.

Phase 13 finishes the production QA, optimization, and parity pass for the current V3 roadmap. The V3 performance smoke scene now gates eight V3 combatants across mobile-low, mobile, desktop, and ultra tiers, browser smoke metadata covers desktop and mobile surfaces, and parity tests protect V1/V2/V3 visual policy behavior across live combatants, loading previews, and replays. V3 remains visual-only: gameplay collision, timing, scoring, AI, network authority, and V1/V2 legacy model choices are unchanged.

Phase 14 expands the V3 procedural character rig with deterministic detail bones and slot-to-bone armor parenting. Upper-body attack layers now distribute motion through spine, clavicle, forearm, hand, and grip controllers while lower-body locomotion drives thigh, calf, foot, and toe controllers independently. The built-in Aegis Vanguard set now serves as the first vertical-slice armor pass on top of those anchors, using sculpted row-level voxel silhouettes, a wider chest-to-waist read, bulkier bracers, slimmer hands, boot/toe shaping, and backpack tapering while staying inside the existing V3 fit bounds. The expanded rig is exposed through the shared combatant rig so local, AI, roster, observer, and replay visuals can reuse the same V3 anchors without importing private reference meshes.

Phase 15 extends the high-density V3 armor-surface pass across the full built-in Aegis armor set. Every built-in V3 character part now uses gridScale 2 voxel payloads rendered at half voxel scale, with slimmer undersuit cores plus separated shoulder caps, arm bands, bracers, gloves, pelvis plates, leg guards, boots, collar, backpack rails, and emissive details so the suit reads as segmented armor instead of a raw blockout. The second silhouette pass narrows the chest/back slab profile, tapers the helmet crown, moves limb detail from full-height bars into local armor plates, and renders V3 armor surfaces with clipped octagonal panel corners while voxel-edit mode stays cube-authored. Player-authored V3 custom armor remains saved as voxel data, V1/V2 behavior remains unchanged, and gameplay collision, timing, scoring, AI, and network authority are still untouched.

Phase 16/17 locks that V3 shape language into deterministic tests and polishes the V3-only armor-surface renderer. Built-in Aegis parts now pass `v3ShapeLanguage` gates for chest/back slab depth, pectoral center gaps, helmet crown taper, limb taper, smaller hands, and full-height limb bar rejection. Runtime armor and the editor Armor Preview share the same clipped, recessed, beveled panel defaults, while Voxel Edit remains square cube geometry for authoring and click targets. After the Phase 25 fidelity pass, the measured built-in character sources total 12,499 voxels, 2,411 merged panels, and 68 material groups, with manifest headroom at 14,197 source voxels, 2,855 merged boxes, and 87 material groups; this remains a visual-only upgrade with saved custom armor still stored as voxel data and no changes to V1/V2 behavior, collision, hitboxes, reach, AI, networking, or gameplay simulation.

Phase 18 adds deterministic V3 visual QA gates on top of the shape-language and surface-renderer work. `v3VisualQa` samples front, side, rear, and three-quarter projections for desktop and mobile viewport aspects, then checks occupied silhouette area, projected mass, dark/emissive coverage, panel count, material diversity, and required rig part visibility. The V3 performance smoke report now exposes `visualQaReady` plus the aggregated visual QA snapshot summary across all eight smoke combatants, and `/v3-performance-smoke.html` must show `Phase 18 Ready` with `visual pass` before browser smoke is considered complete. This is still a visual-only QA layer: player armor remains voxel-authored data, Voxel Edit remains cube-based, and V1/V2 visuals plus gameplay collision, hitboxes, reach, AI, networking, and simulation are unchanged.

Phase 19 brings that visual QA into the V3 armor editor as player-facing readability feedback. V3 custom drafts now get an advisory `Read` score and a concise Visual QA message based on the same clipped, recessed armor-surface preview used by runtime/editor Armor Preview, with single-piece thresholds so helmet/chest/limb drafts are not treated like full-body smoke scenes. This does not block saving, change custom armor JSON, add mesh upload, or alter V1/V2 behavior, gameplay collision, hitboxes, reach, AI, networking, or simulation.

Phase 20 adds V3 editor Suggested Fixes and auto-polish actions for readability. These are reversible, advisory editor-assistance tools; saved custom armor remains voxel JSON, Visual QA does not block saving, and V1/V2 visuals plus gameplay collision, networking, and simulation are unchanged. Players continue authoring voxel armor rather than meshes.

Phase 21 adds V3-only Smart V3 authoring tools and slot starter templates. These reversible editor helpers preserve voxel JSON and the save format, remain advisory-only rather than a save gate, and do not add mesh import or mesh authoring. V1/V2 visuals plus gameplay, collision, hitbox, reach, AI, networking, and simulation behavior are unchanged.

Phase 22 adds live Smart V3 preview overlays, limited smart parameters, cheap readability feedback, and stronger slot-specific starter templates. Saved armor remains voxel JSON, Visual QA and readability remain advisory and are not save gates, and V1/V2 visuals plus gameplay, collision, hitbox, reach, AI, networking, and simulation are unchanged.

Phase 23 adds a V3-only Suit Workspace to the armor editor. Players can stage every modular V3 slot from equipped custom pieces or starter templates, switch slots while keeping unsaved drafts in memory, preview the staged suit on the full rig, and batch save/equip all valid slots through the existing custom armor catalog and `CharacterLoadout.customArmor` map. The batch save is all-or-nothing for normal validation and catalog limits, while readability remains advisory; no kit/profile schema, mesh import, save migration, V1/V2 behavior, gameplay collision, hitboxes, reach, AI, networking, or simulation changes are introduced.

Phase 24 adds V3 suit profiles as durable named references to existing per-slot custom armor pieces. Profiles live in their own local catalog, can be saved from the equipped V3 suit, applied from the editor or Armory, and exported/imported as JSON bundles that include referenced voxel snapshots for portability. The armor piece schema and `CharacterLoadout` stay unchanged: applying a profile only patches the existing `customArmor` slot map, unsaved staged drafts must be saved/equipped first, and readability remains advisory-only with no V1/V2, gameplay, collision, hitbox, reach, AI, networking, or simulation changes.

Phase 25 upgrades the built-in V3 Aegis suit fidelity while keeping V3 procedural and voxel-authored. Built-in armor generation now lives behind a dedicated Aegis source module, the sculpt helper set includes reusable tapered plates, segmented bands, ridges, vents, and inset channels, and the built-in suit runs through deterministic `v3SuitFidelity` gates for slab profiles, cube helmets, scaffold limbs, oversized terminal pieces, panel hierarchy, material diversity, and mirrored part signatures. The tuned Aegis collar, shoulders, boots, and backpack use carved negative-space face breaks so the suit reads less like broad filled rectangles while staying inside the same gridScale 2 fit bounds. This is a visual-only content pass: saved custom armor remains voxel JSON, V3 editor readability stays advisory, FBX/GLB stays reference-only, and V1/V2 visuals plus gameplay, collision, hitbox, reach, AI, networking, and simulation behavior are unchanged.

Phase 26 adds deterministic V3 pose clearance and motion QA. `v3PoseClearance` checks representative idle, walk, sprint, slide, weapon, hit, and death poses for armor/body clearance, and the V3 performance smoke report now includes a `motion pass` gate alongside visual readiness. This is a visual-only guarantee: saved custom armor remains voxel JSON and is not blocked by pose QA, and there are no V1/V2, gameplay collision, hitbox, reach, AI, networking, save schema, or mesh import changes.

Phase 27 brings that motion QA into the V3 armor editor. Rig Preview now uses the same Phase 26 pose cases for V3 armor, including weapon poses, and the editor can run advisory Motion QA against the active slot or staged full suit with optional overlay hints for pose-clearance issues. Motion warnings do not block saving; custom armor remains voxel JSON, suit profiles stay reference-based, and V1/V2 visuals plus gameplay, collision, hitbox, reach, AI, networking, and simulation behavior are unchanged.

Phase 28 adds V3-only pose-aware repair suggestions to the armor editor. Motion Fixes are preview-first, undoable, advisory-only helpers such as Clear Limb Overlap; applying one preserves the player-authored voxel format and does not change V1/V2 behavior, gameplay, collision, hitboxes, reach, AI, networking, simulation, suit profiles, or the save schema.

## Standalone 3D Map Maker

iBrawls features a beautiful, feature-rich, and completely standalone 3D Map Maker application that runs 100% locally and offline in the user's browser. Since it is entirely decoupled from the main web application, players simply open the local HTML file to design custom battle arenas using standard assets!

### How to Run the Map Maker
1. **Launch Directly from the Game**: You can now launch the Map Maker directly from the main menu by clicking the **🛠️ Map Maker** button in the top navigation bar!
2. **Double-Click Offline**: Alternatively, locate `mapmaker.html` in the root of the project directory and double-click it to launch it completely offline in any modern web browser. No local development server, Node.js environment, or compilation is required!
3. **New Tab Safety & Multi-tasking**: When launching from the game, the Map Maker opens in a new tab to ensure that any accidental window closes or back navigations don't cause you to lose your custom map work (since it runs entirely client-side).
4. **Smart Exit Protection**: Click the new **Exit Editor** button in the top-right overlay of the Map Maker when you're finished. 
   - If you have **unsaved changes**, it will warn you and prompt: *"Would you like to export/save your map before exiting?"* (Clicking OK triggers the JSON map file download and exits; Cancel lets you choose to exit without saving or stay in the editor).
   - If opened from the game's navigation bar, it will safely close the tab upon exiting; if opened directly, it gracefully redirects you back to the game's main menu (`/`).
5. **Design & Customize**: Spawn crates, columns, barriers, and cores. Browse and search the newly added **3D Asset Catalog** for premium pre-styled elements. Modify positions, rotations, scales, colors, metalness, and roughness using the visual transformation sliders. Choose between **Circular** and **Rectangular** arena shapes!

### Editor Features
- **Photoshop-style Outliner & Folders**: A professional outliner panel with a hierarchical folder grouping system, vertical nesting lines, and individual collapsible groups, letting designers keep complex battlefields perfectly organized.
- **HTML5 Drag-and-Drop Layers Manager**: Drag and drop elements inside the outliner to reorder them in the layers stack (Photoshop-style reordering), drag objects into folders to group them, or drop them in the dedicated root zone to ungroup them.
- **Lock/Unlock In-Place**: Click the lock icon on a folder or individual object to freeze it in place. Locked elements are excluded from viewport raycast clicking, their transform sliders are disabled, and their Three.js translation/rotation gizmos are automatically detached to prevent accidental editing.
- **Visibility Toggle (Eye Icons)**: Instantly hide/unhide folders and nested objects in both the outliner tree and 3D viewport. Hiding a folder dynamically hides all nested objects inside.
- **Unreal Engine-style Workspace Layout**: A professional level-design editor workspace featuring a persistent bottom-bar **Content Browser** (housing the vertical folders list, action buttons, real-time search, and a responsive asset cards grid) and a dedicated right-side **Outliner & Details Inspector** (for element listing, active translations, 3D rotations, scaling sliders, PBR materials, and emissive neon glow controls).
- **Interactive 3D Canvas**: Outfitted with `PerspectiveCamera` and `OrbitControls` for full inspection. Allows direct mouse click/raycast selections with real-time selection helpers. Fully integrated with standard **Transform Gizmos** for both Translation (Movement) and Rotation modes.
- **Dual Transform Modes**: Toggle between **Movement Mode** and **Rotation Mode** via a premium glassmorphic selector in the bottom right of the viewport, or use industry-standard hotkeys: **`W`** for Movement and **`E`** for Rotation.
- **Multi-Plane 3D Rotation**: Rotate selected objects across all three dimensions (Pitch, Yaw, and Roll) using either the 3D circular gizmos directly in the canvas or the range sliders in the sidebar panel.
- **Sleek Cyberpunk Design System**: High-fidelity glassmorphic styles and dark themes for all sidebar components (inputs, dropdowns, range sliders with glowing cyan thumbs, scrollbars, and buttons) to create a premium, state-of-the-art battle arena builder.
- **Categorized 3D Asset Catalog**: A searchable catalog of 17+ pre-made futuristic obstacles classified into:
  - 🏗️ *Structures & Cover*: Translucent energy shield gates, reinforced concrete barriers, giant titanium walls, and red-framed ice hockey goals.
  - ⚡ *Hazards & Energy*: Glowing plasma cores, fusion energy pillars, leaking toxic drums, and quantum warp relics.
  - 📦 *Industrial & Space*: Heavy steel cargo boxes, weapon lockboxes, pressurized gas cylinders, and nanite stasis pods.
  - 🌿 *Nature & Ruins*: Mossy stone monoliths, ancient obelisks carved with purple glowing magic runes, organic boulders, and snow-covered boulders.
  - 👽 *Alien & Forerunner*: Ornate forerunner sentry spires, reflective gold pedestals, levitating gravity anchors, and glowing glacier ice crystals.
  - 📐 *Primitives*: Clean untextured cubes, cylinders, and spheres for direct greybox blockouts.
- **Flexible Object Placement**: Place and transform Box, Cylinder, and Sphere obstacles. Modify dimensions, position, rotation, opacity, metalness, roughness, colors, emissive neon glow, and collidable status (`isCollidable`).
- **Flexible Arena Shapes**: Toggle between **Circular** and **Rectangular** boundaries. The rectangular court uses a standard 2:1 aspect ratio with a dedicated rectangular grid helper.
- **Dynamic Lighting Controls**: Add custom point lights to set up mood lighting. Adjust position, distance, intensity, decay, and color using real-time inspectors.
- **Interactive Skybox & Atmosphere Selector**: A visual dropdown inside the *Atmospherics & Size* panel lists 16 bold, high-fidelity procedural 3D Sky Dome textures (including 4 premium extra skies: *Toxic Green Wasteland*, *Jagged Lava Inferno*, *Digital Matrix Code*, and *Surreal Planet Nebula*) plus an *Auto Match Theme* option. Each sky exposes map-authored 0-100 controls for motion, optimized layered cloud decks, volumetric haze, starfields, weather particles, lightning pulses, energy bands, celestial bodies, and horizon detail. Exported map JSON preserves these settings through the additive `atmosphere` object while older maps load with preset defaults.
- **Texture Presets**: Dress obstacles in 24 custom texture profiles matching 10 distinct themes (upgraded to ultra-high-fidelity 2048x2048 resolutions and integrated with tactile, physically modeled 3D bump maps and custom surface specular relief scales):
  - *Nature*: Grass turf (`nature_grass`), Mossy Stone (`nature_mossy_stone`), Wood Grain (`nature_wood`).
  - *Space*: Starbase alloy plate (`space_alloy`), Lunar meteorite crag (`space_meteorite`), Cosmic dust (`space_lunar_dust`).
  - *Futuristic*: Sleek carbon fiber (`futuristic_carbon`), Neon hexagonal plates (`futuristic_hex`), Energy grid shield (`futuristic_shield`).
  - *City*: Asphalt pavement (`city_asphalt`), Warehouse brick (`city_brick`), Raw concrete (`city_concrete`).
  - *Fantasy*: Runed stone monolith (`fantasy_runed_stone`), Rustic cobblestones (`fantasy_cobble`), Polished gold plating (`fantasy_gold`).
  - *Forerunner*: Dark metal panels with gold circuits (`forerunner_panel`), Ornate etched gold plating (`forerunner_gold`).
  - *Synthwave*: Synthwave Cyan Grid (`synthwave_grid`), Neon Laser Energy (`synthwave_neon_laser`), Sunset Chrome (`synthwave_chrome`).
  - *Rainy Streets*: Wet Asphalt Tarmac (`rainy_streets_asphalt`), Amber Neon Glow (`rainy_streets_neon_glow`), Tech Dog Billboard (`rainy_streets_dog_billboard`).
  - *Winter Glacier*: Glacier Rink Ice (`winter_ice`), Powdery Snow (`winter_snow`), Translucent Frost Glass (`winter_glacier_glass`).
  - *Grifball Stadium*: Diamond Steel Grid (`stadium_steel_grid`), Scoreboard Screen (`stadium_scoreboard_screen`), Sapphire Burger Ad (`stadium_advertisement_sapphire`), Gauss Soda Ad (`stadium_advertisement_gauss`).
- **Automated Nav-Mesh Baking**: Spatial analysis engine automatically runs spartan clearance tests ($0.65\text{m}$) against circular or rectangular collidable boundaries to generate a 2D Node Navigation Grid. Walkable paths are visualized as beautiful glowing green nodes with blue connection lines in the editor viewport!
- **Local File System IO**: Fully offline-based import and export. Save maps as local `.json` files to distribute to other players or load them directly in the game lobby for training skirmishes.

## Spartan Armor & Weapon Customization

iBrawls features a beautiful and comprehensive character customization suite, available from the main menu **Customization** frame under the **Armor** tab:

- **Model System Versions**: Select between different model systems:
  - **Version 1 (Classic)**: Standard hierarchical rigid segment group.
  - **Version 2 (Rigged)**: High-fidelity skeletal bone & joint system with enhanced state-based animations (breathing idles, walking leg swing cycles with knees bending and ankle/toe flexes, sprinting leans and arm pumps, crouched sliding folds, and elbow-bending weapon swings).
    - **Model Types**: V2 loadouts support **Medium** and **Large** body profiles. Medium is the current V2 Spartan footprint. Large uses denser powerarmor-style voxel volumes, a larger collision cylinder and target hitbox, and matching custom-armor editor bounds/catalog filtering so Large pieces do not mix with Medium pieces.
    - **Hitbox Constraints & Customizer Safety**: To support future custom voxel parts (via a model maker/editor), V2 enforces a strict, standardized hitbox size constraint (in voxels) for each of the 15 body parts. Any custom part must fit within these bounding boxes:
      * `pelvis`: Max `10 x 11 x 7`
      * `stomach`: Max `9 x 8 x 6`
      * `chest`: Max `13 x 16 x 14`
      * `neck`: Max `7 x 4 x 4`
      * `head`: Max `9 x 10 x 9`
      * `shoulder`: Max `7 x 8 x 6`
      * `arm_upper`: Max `4 x 5 x 9`
      * `arm_lower`: Max `5 x 6 x 9`
      * `hand`: Max `4 x 4 x 4`
      * `leg_upper`: Max `6 x 7 x 12`
      * `leg_lower`: Max `6 x 9 x 14`
      * `foot`: Max `6 x 8 x 5`
      * `toes`: Max `6 x 5 x 4`
  - **Version 3 (Advanced)**: A parallel voxel model system for modular armor, V3 weapons, first-person parity, layered procedural animation, and local V3 custom armor editing. V3 is available as a visual-only gameplay policy: combat ranges, collision, hitboxes, weapon timing, movement physics, and AI decisions remain normalized while the rendered model can use V3 loadout data.
    - **Match Visual Policy**: Match setup defaults to **Version 2 Rigged** and regular-player controls support **Version 1 Classic** and **Version 2 Rigged**. Signed-in admin sessions also expose **Version 3 Advanced**; non-admin sessions clamp saved, staged, or received V3 policy values back to V2. Offline sandbox applies the selected policy to the local player and bots without changing gameplay collision or weapon logic. Multiplayer hosts choose the lobby policy through `MatchLobbyConfig.visualModelPolicy`; clients and observers consume the normalized policy permitted for their session. Loading screens render participant previews through the active match policy. New replays store the normalized policy and sanitized visual loadout metadata, while older replays without policy continue to use legacy V1 playback visuals.
- **Premium Hammer Model Swapping**: Swap between 9 distinct premium hammer variants shown in the game customizer, fully rendered in high-fidelity voxels:
  - **Akelas**: Sleek, aerodynamic dark carbon-like head with a thin, glowing red stripe along its edge.
  - **Akelus**: Sleek, white high-tech plating with pulsing neon blue energy channels on the back of the head.
  - **Paegaas**: Metallic silver and gold plates with glowing orange vents along the head.
  - **Sepulo'tez**: Ancient stone-brick texture, gold ornamentation, and leather rope wrappings around the handle.
  - **Halbashi**: Brutalist, heavy, rectangular copper-bronze head with layered steps/teeth along the front.
  - **Eektah-Fel**: A dark metallic frame encapsulating three glowing, vertical radioactive green neon vials/capsules.
  - **Gravity Axe ("Diminisher of Hope")**: Double-sided axe configuration with molten glowing orange-red energy blades extending from a dark metal center.
  - **Gravity Mace ("Chainbreaker")**: Spiked mace head with glowing red-hot spikes radiating outwards and leather-wrapped handle.
  - **Fist of Rukt**: Massive gray stone mallet-head, gold/brass gears on the sides, and a brown wooden handle.
- **Premium Energy Sword Model Swapping**: Swap between 10 distinct original energy sword variants in high-fidelity voxels, complete with programmatic lightning crackles:
  - **Cyan Classic**: Retro chunkier profile with solid neon cyan glow and a glowing white energy core.
  - **Twin Arc**: Sleek, curved prongs, elegant purple/grey hilt, and pink/magenta energy crackles running along the light blue blade.
  - **Prism Edge**: Pristine white-blue blades with silver-accented dark hilt and subtle violet wisps.
  - **Emberline**: Sharp curved blades, dark hilt, with an amber/orange indicator light accent.
  - **Aegis Arc**: High-contrast cyan and white electric crackles with a shiny steel hilt.
  - **Vanguard IV**: Aggressive blocky triangular guard base with high-frequency electric blue energy.
  - **Cerulean Rift**: Pristine sapphire and soft sky blue plasma curves with gray-blue alloy hilt.
  - **Crimson Rift**: Shadowy obsidian guard with glowing magenta, pink, and red-purple crackling energy.
  - **Aurum V**: Sleek carbon hilt with premium gold/bronze emitter trims and advanced clean blue energy.
  - **Infinite**: Shiny chrome-silver hilt and classical curved blades with complex sky blue, deep blue, and white crackling patterns.
- **Immersive 3D Paint Job Studio**: An extremely rich, fully integrated 3D **Paint Job** studio inside the character customization tab, built using Three.js and React to offer precise per-voxel coloring:

- **Immersive 3D Viewport**: Click **"Start Paint Job"** to enter the painting studio. The camera shifts face-forward towards the Spartan, auto-rotation is paused, and continuous 360° mouse orbiting and scroll-wheel zooming are fully unlocked.
- **Draggable Frame Scaling**: The paint studio's 3D viewport and tool/control frames have corner scale handles. Drag either handle to manually enlarge or shrink that frame; sizes persist locally under `ibrawls_paint_editor_frame_scale_v1`.
- **Futuristic SVG Navigation Skeleton**: A glowing neon wireframe HUD of a Spartan is displayed in the top-left corner. Hovering and clicking on skeletal zones (Head, Chest, Arms, Legs) triggers a **smooth camera interpolation (lerp)** that glides the viewport close-up to focus on that specific armor piece, resetting any model translation and camera zoom to their default framing.
- **Dual Paint Modes**:
  - **Voxel Paint**: Spawns every single voxel in the character's active armor loadout as an individual, raycastable 3D box mesh. Raycasting maps clicks precisely to the voxel's relative coordinates.
  - **Base Paint (Fill)**: Flood-fills the entire selected armor segment (Helmet, Torso, Arms, or Legs) with the active paint color in a single click.
- **2D Screen-Space Marquee Selector Box**: Drag with Left Click (when Brush or Eraser is selected) to draw a glowing dashed absolute marquee overlay rectangle. Mathematically projects 3D voxel coordinates to screen pixels to highlight and paint/erase all covered voxels at once on release. Single click paints/erases a single targeted voxel.
- **✋ Mover Pan Tool**: Toggle the Mover tool to freely move the Spartan model around on all 2D screen planes in 3D space, which automatically centers and fits perfectly on segment camera refocus.
- **Dynamic Neon Paint Toggle**: A toggle to paint individual voxels with high-intensity glowing emissive neon lights, letting players paint custom glowing decals, visors, or energy stripes.
- **Mirrored Arm & Leg Painting**: Automatically mirrors edits across limbs (Left Arm $\leftrightarrow$ Right Arm, Left Leg $\leftrightarrow$ Right Leg) using relative coordinate reflection ($x \leftrightarrow -x$) to keep your custom designs perfectly symmetrical.
- **Advanced Hex Selector & Themes**: Paste exact color hex codes directly into the advanced color field, or click on curated premium preset themes named after famous sci-fi aesthetics (e.g. *Master Chief*, *Covenant*, *Synthwave*, *Cyberpunk*, *N7*).
- **Voxel Eraser**: Switch to eraser mode to wipe custom paint off individual voxels, reverting them back to their HSL-calculated default armor colors.
- **Context-Aware Reset**: Reverts your changes in a smart, context-aware manner: resets just the currently focused armor piece if focused, or wipes the entire character back to defaults if viewing the whole model.
- **In-Game Persistence**: Saving compiles your custom voxel paint maps directly into `localStorage` under `grifball_player_loadout`. These custom paint patterns are fully synced and rendered at run-time in singleplayer sandbox matches, bot battles, and theater replays!

- **V2/V3 Custom Armor Model Editor**: The Armor panel links to the standalone local model editor for player-made V2 Helmet, Chest, Arms, and Legs pieces or V3 modular armor slots:
  - **Creation Sources**: Start from a blank piece, clone any built-in V2 preset or default V3 modular part, clone the equipped custom piece, import JSON, or remix saved catalog entries.
  - **Voxel Modeling Tools**: Place single voxels, erase, box-fill, draw lines and planes, extrude, move or duplicate selections, flood-fill a slot, and apply role-based materials (`primary`, `secondary`, `accent`, `visor`, `dark`, `highlight`, or fixed colors via picker or exact hex input) with optional emissive glow.
  - **Native Viewport Controls**: Drag the editor frame to orbit, use modified/right/middle drag to pan, and scroll to zoom without accidentally placing or deleting voxels during camera movement.
  - **Live Preview**: Toggle between an edit view and a rigged Spartan preview with idle, walk, sprint, crouch, hammer-swing, and sword-lunge poses to catch clipping and readability issues before saving.
  - **Editor Overlays**: Toggle V2/V3 fit bounds, original preset/default part silhouette, player collision cylinder, density heatmap, clipping guidance, and payload/performance budget readouts.
  - **Validation & Auto-Repair**: The editor explains invalid saves with exact causes such as too few voxels, missing subpart volume, oversized V2 subparts, V3 fit-bound or voxel-budget violations, sparse ghost-like shapes, missing far-corner anchor clusters, disconnected islands, or oversized payloads. Repair actions can center a piece, fit it back inside bounds, remove floating voxels, or seed a corner anchor.
  - **Catalog & Loadout Integration**: Saved custom armor lives in `grifball_custom_armor_catalog`, appears as purple player-made tiles in Armor Loadout, can be renamed/duplicated/deleted through the editor, and is equipped as a selected custom snapshot on the matching V2 or V3 visual loadout. V3 suit profiles live separately in `grifball_v3_suit_profiles` as named references to those saved pieces and can be applied without changing the armor-piece schema.
  - **Sync & Multiplayer Safety**: Save codes/cloud saves use `SaveData` v3 to include the current loadout and full custom armor catalog while accepting older v2 saves. Multiplayer sends only the selected custom piece snapshots, and both the local server and Cloudflare Worker sanitize custom loadout payloads before relaying them.

## Secrets & Easter Eggs

- **GRIFB Pistol**: A hidden laser-pistol weapon can be unlocked by holding the letters **`G`**, **`R`**, **`I`**, **`F`**, and **`B`** at the same time, with no other keys pressed, for **2 seconds** during active gameplay. 
  - **Effect**: Replaces the player's standard loadout with a high-performance neon laser pistol.
  - **Hitscan Tech**: Employs mathematically resolved ray-sphere intersection testing with instant raycasted hit detection, rendering glowing tracer beams and particle impacts.
  - **Recoil & Recovery**: Fully animated programmatically, presenting a dynamic recoil kickback and smooth recovery poise synced directly to HUD reload and cooldown systems.
