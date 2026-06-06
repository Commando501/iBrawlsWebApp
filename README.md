# iBrawls Web App

iBrawls is a React, Vite, Three.js browser game with a local Node/WebSocket relay for development and a Cloudflare Worker Durable Object relay for deployment.

## Local Development

1. Install root dependencies:
   `npm install`
2. Start the local app and relay:
   `npm run dev`
3. Open `http://localhost:3000`.

The root dev server runs `server.ts`, which hosts Vite in middleware mode and provides the local WebSocket matchmaking/gameplay relay.

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

## AI Systems

Combat AI is orchestrated from `GrifballGame.tsx` (10-state FSM including `PRESSURING`) with pure decision logic in `src/game/`. Shared combat geometry helpers, AI orchestrator bridge helpers and arena/orchestrator callback factory, combatant action-state and combatant action callback factory, player weapon action-state and weapon-action callback factory, player sword, hammer, and pistol animation plus weapon-animation frame orchestration, enemy weapon action triggers, tactical weapon-choice runtime adapters, and player sword-lunge target/recovery plus lunge-update runtime helpers, hammer strike impact, player hammer melee impact, player sword slash impact, combat-impact callback factory, combat-resolution callback factory, and pistol hitscan runtime helpers, main-AI sword slash, hammer melee impact, and weapon-animation runtime helpers, AI sword-lunge start, finish, flight, and hit runtime helpers, AI dash movement, spatial-dodge start/fallback, bulltrue counter, lunge-evasion/bulltrue reaction, and ground-movement prelude and ground attack-opportunity runtime helpers, combo and combo melee-strike runtime helpers, respawn, local-player respawn, horizontal movement, movement-integration, player physics frame runtime helpers, and player-frame callback factory, active gameplay frame runtime helpers, game-frame callback factory, match-frame callback factory, AI roster callback factory, AI roster tick dispatch, AI tick-state, AI combat-tuning prelude, AI engagement-frame prep, AI coordination runtime, AI bookkeeping and combat-bookkeeping callback factory, pressure-state lunge preference/approach/dash/re-swing, post-kill pressure, airborne hammer-opportunity, airborne/pre-ground recovery, and no-target spawn-guard runtime helpers, AI combatant frame-sync and weapon-timing helpers, arena/collision callback factory, arena boundary and sword-lunge boundary helpers, AI target prediction/clamp, AI combat-range, AI incoming-lunge, and body-collision helpers, arena frame sync, arena runtime spawn/resize adapters, player collision sync, runtime state/ref initialization, match timer helpers, Grifball neutral-objective runtime, AI team-awareness, and AI objective-movement runtime helpers, bot melee impact runtime helpers, trade bookkeeping and sword-lunge trade-resolution runtime helpers, outgoing multiplayer-hit runtime helpers, multiplayer mode/prop sync and WebSocket packet-handler helpers, player/AI target-selection, tactical target scoring, and tactical target callback factory helpers, HUD stats builders and HUD push adapters, death-feed and player-medal helpers, match-pressure tuning adapters, replay data, replay runtime callback factory, replay playback event controls, interpolation, visual sync, and playback-frame runtime helpers, replay recording initialization/persistence, match telemetry, replay-target helpers, and view-target callback factory, adaptive player-model observation callback factory and warm-start adapters, AI altitude-recovery adapters, spectator target-data adapters, legacy roster prop adapters, input/pointer ref management plus player look, weapon input dispatch, keyboard action dispatch, chat input focus guards, observer keyboard/custom-event controls, input listener registration, and observer movement runtime helpers, prop contracts, map selection, overlay DOM projection, scene initialization, custom-map base arena setup, live camera/FOV and render-frame helpers, arena spawn/resizing helpers, Three combatant model construction, host/enemy model rebuild helpers, and remote combatant provisioning, combatant animation, visual-update callback factory, observer and roster visual sync, and mesh lookup helpers, admin-settings/invulnerability/debug/jump-zone/emissive/weather visual-state and transient VFX callback, creation, lifecycle, and frame-update helpers, weapon audio helpers, and custom-map procedural asset generation live under `src/components/grifball/` so the main game component stays under Babel's 500KB styling deoptimization threshold while preserving the existing `createHighFidelityObjectMesh` export.
Championship stadium, synthwave, rainy-streets, and winter-rink custom-map scenery construction live in `src/components/grifball/customMapStadiumSceneryRuntime.ts`, `src/components/grifball/customMapSynthwaveSceneryRuntime.ts`, `src/components/grifball/customMapRainyStreetsSceneryRuntime.ts`, and `src/components/grifball/customMapWinterSceneryRuntime.ts`; default hangar/holodeck arena construction lives in `src/components/grifball/defaultArenaSceneRuntime.ts`, local first-person weapon/debug/jump-zone mesh setup lives in `src/components/grifball/localPlayerViewRuntime.ts`, multiplayer remote-enemy view setup lives in `src/components/grifball/multiplayerEnemyViewRuntime.ts`, initial offline roster seeding lives in `src/components/grifball/offlineRosterInitializationRuntime.ts`, pointer-lock/drag/touch look math and handler factories plus pointer/mobile/keyboard player input dispatch lives in `src/components/grifball/playerInputRuntime.ts`, chat input focus/key guards live in `src/components/grifball/chatInputRuntime.ts`, observer keyboard/custom-event controls live in `src/components/grifball/observerInputRuntime.ts`, and DOM input listener registration/cleanup lives in `src/components/grifball/inputEventListenersRuntime.ts` so arena, player-view, roster, and input setup can continue leaving `GrifballGame.tsx`.

| Module | Role |
|--------|------|
| `aiCombatDecision.ts` | Tactical weapon choice; punish-window gates when opponents are dash- or swap-locked (mechanic-aware difficulties) |
| `aiTuning.ts` | Hybrid tuning: derives spatial IQ, feint chance, and pressure aggression from the 7 base knobs, with optional Custom Matrix overrides; score-aware match multipliers for leads, deficits, close games, and match point |
| `aiMatchContext.ts` | Per-match memory (player models, feint cooldowns, combo state, skill calibration, multi-bot coordinator) reset on match start |
| `aiComboEngine.ts` | Mid-combat weapon combo strings (Mixup, Safe Finish, Bait & Smash, Double Tap); gated by weapon-swap IQ ≥ 70/90 and weapon prioritization |
| `aiPlayerModel.ts` | Adaptive opponent modeling via EMA observations (lunge habits, dodge bias, counters); feeds combat and FSM movement |
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


All offline AI combatants (including `main_ai` at roster slot 0) share the same voxel Spartan mesh rig via `otherPlayerMeshes` / `createOrUpdateRemotePlayer` (including mesh provisioning on orchestrator spawn/hue change). The legacy `enemyGroup` path is retained **only** for multiplayer observer/host-client spectate rendering — not for offline bot display. Offline sandbox stores every AI in `otherPlayers` with `controller: 'ai'`; multiplayer stores remote humans with `controller: 'remote'` and never runs local AI ticks on them.

**Roster membership:** One `otherPlayers` map keyed by combatant id. Each entry is a full `Combatant` plus `controller: 'ai' | 'remote'`. **`aiOrchestrator.ts`** runs once per offline frame to spawn/despawn bots to `offlineBotCount`, ensure `main_ai`, distribute per-slot config/teams, and tick bot coordination (`aiBotCoordinator`). `getRosterAI()` / `getAICombatants()` drives `updateAI`; `getDisplayOpponent()` drives HUD/enemy stats (main_ai offline, primary remote online). Replay recording writes all AI combatants into `frame.otherPlayers`; legacy `frame.ai` is read-only for older replays.

**Phase 6 cleanup:** No privileged `main_ai` combat loops — damage, pressure, respawn, skeletal animation, and replay all iterate the roster uniformly. The stable id `'main_ai'` remains as offline slot 0; `mai()` is a thin accessor to `getMainAI()`. Team scoring bridges (`scoreEnemy`, `enemy*`) remain for HUD/multiplayer perspective.

**Team scoring:** Match scores live in `teamScores` (per-team `score`, `kills`, `deaths`, `respawnTimer`). Sandbox maps the local player to `blue` and AI combatants to `red` via `RosterSlotConfig.team`. HUD, win conditions, elimination feed, and multiplayer sync still read the legacy `scorePlayer` / `scoreEnemy` names through bridges that flip perspective for multiplayer clients (client = red). Main AI death/respawn updates both the combatant object and the red-team tally via legacy `enemy*` bridges.

**Custom AI Behavior** (the `custom` difficulty, formerly "Custom Matrix Override") exposes *every* engine-wired AI dial in a grouped panel: base neural-matrix knobs (reflex latency, anticipation, strafe/evade, weapon-swap IQ, playstyle, weapon prioritization) plus advanced behavior overrides — `aiSpatialIQ`, `aiFeintChance`, `aiPressureAggression`, `aiSpacingBand` (combat spacing), and `aiSkipPressure` (disable post-hit pressure chaining). Advanced overrides display "Auto" until set and fall back to derived/neutral values. All of these persist in saved Custom AI Presets (`AITuning`) and are threaded per-bot through `RosterSlotConfig`. **`aiPersonalities.ts`** provides six **Behavior Archetype Presets** (Berserker, Counter-Fighter, Zoner, Mixup Artist, Assassin, Brawler, formerly "Combat Archetype") that overlay difficulty tuning with distinct knob presets and behavioral flags (`skipPressure`, `feintBias`, `spacingBand`); selecting one fills in every Custom AI Behavior dial as an editable starting point. Sandbox, admin settings, and the Holographic Combatant Grid bot setup expose the archetype dropdown; tournament opponents receive a random archetype per bracket entrant or can be procedurally generated from a selected pool of Custom AI Presets. **`rosterSlotConfig.ts`** applies the Sandbox "AI COMBAT NEURAL NET" panel as the shared default for every AI combatant; per-slot grid overrides (difficulty, archetype, hue) merge on top so bots inherit the full weapon-prioritization range (e.g. sword-100) unless explicitly overridden.

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
- **Runner (Ball Carrier)**: Moves 1.3x faster, receives extra health (+1 HP, totaling 2 HP by default) and heals to full on pickup. Replaces the default hammer swing with a short-range punch (1.8m range, 1.5m contact radius) and executes dynamic obstacle-avoidance steering to navigate around blockers.
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
- **Replicated VFX and Audio Cues**: Dashing, lunging, and weapon swings automatically trigger their matching sound effects, speed lines trails, evasion box particles, and colossal hammer ground-impact splash explosions, shockwaves, and ground burn decals.
- **Rolling Match Cache**: Features a local rolling cache of the last **5 auto-saved matches** (via IndexedDB) that overwrite sequentially. Players can commit cache items permanently to the **Replays Archive** with custom titles and descriptions.
- **Spectator Controls**: A bottom glassmorphism timeline control bar enables:
  - Timeline scrubbing/seeking to any second of the match.
  - Variable speed multiplier rates (`0.25x`, `0.5x`, `1.0x`, `2.0x`, `4.0x`).
  - Active lock-target tracking dropdown to focus first-person, third-person orbit, or free fly-camera on any recorded Spartan.
  - Fully simulated scoreboard and SFX/sparks triggers synced forward-only to prevent audio cluster when scrubbing.

## Controls & Inputs

iBrawls supports both classic Keyboard + Mouse inputs and native Gamepad (Xbox/PlayStation controller) support, configurable via the custom settings panel:

### Keyboard + Mouse Controls
- **Move**: `W`, `A`, `S`, `D` (or Arrows)
- **Jump**: `Spacebar` (Launch hammer jump if pressed immediately after Slam)
- **Thrust**: `Q` (Quick dash in movement direction)
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
- **Thrust**: `X` (Button 2)
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

- **Entity Cylinders**: Every active, living participant (local player, main AI, and custom bots/remote players) is bounded by a vertical collision cylinder with a radius of **0.55m** (diameter of **1.1m**) and state-dependent height ranges (**1.8m** standing, **1.2m** crouching).
- **Kinematic Resolution**: When two participants overlap both horizontally and vertically, they are pushed apart by **50%** of the overlap depth each along the collision normal.
- **Velocity Normal Damping**: To ensure collisions feel solid and prevent jittering or high-speed passthroughs, the relative velocity component along the collision normal is cancelled when entities are moving towards each other.
- **Multi-iteration Solver**: The collision engine runs for **3 iterations** each frame inside `enforceArenaBounds` before bounding players to the circular arena, ensuring perfectly stable physics even in crowded multi-bot pincers.
- **Zero-lag Rendering**: State positions are proactively synchronized to Three.js group meshes immediately following collision resolution to eliminate 1-frame rendering lag.

## Map Selection & Environments

Local play setups feature an interactive map selector overlay supported by a dynamic, real-time rotating 3D preview of both standard arenas, premade environments, and custom-loaded maps. Each map now features a beautiful, procedurally generated 360-degree **Sky Dome** (inverted sphere mesh) running independent of fog, complete with slow, smooth background rotation that brings the stars, nebulas, and stadium spotlights to life!

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
- **High-Fidelity 3D Assets Engine**: A dynamic geometry processor that intercepts simple primitives (flat boxes, cylinders, spheres) and upgrades them at render-time into complex, compound 3D models. Standard primitives are transformed into detailed thematic assets like tapering Forerunner obelisks with floating energy crystals, heavy freight containers with vertical corrugated panel ridges, chamfered recharge station crates, and floating planetary plasma reactors with orbital stabilizer rings.

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
- **Interactive Skybox Selector**: A visual dropdown inside the *Atmospherics & Size* panel lists 16 distinct high-fidelity procedural 3D Sky Dome textures (including 4 premium extra skies: *Toxic Green Wasteland*, *Jagged Lava Inferno*, *Digital Matrix Code*, and *Surreal Planet Nebula*) plus an *Auto Match Theme* option. Backed by full map JSON import/export serialization to perfectly preserve custom skies.
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

iBrawls features a beautiful and comprehensive character customization suite:

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
- **Premium Energy Sword Model Swapping**: Swap between 10 distinct, beautifully recreated Halo-inspired energy sword variants in high-fidelity voxels, complete with programmatic lightning crackles:
  - **CE Classic**: Retro chunkier profile with solid neon cyan glow and a glowing white energy core.
  - **Halo 2**: Sleek, curved prongs, elegant purple/grey hilt, and pink/magenta energy crackles running along the light blue blade.
  - **Halo 3**: Pristine white-blue blades with silver-accented dark hilt and subtle violet wisps.
  - **Reach**: Sharp curved blades, dark hilt, with an amber/orange indicator light accent.
  - **CEA**: High-contrast cyan and white electric crackles with a shiny steel hilt.
  - **Halo 4**: Aggressive blocky triangular guard base with high-frequency electric blue energy.
  - **H2A Blue**: Pristine sapphire and soft sky blue plasma curves with gray-blue alloy hilt.
  - **H2A Pink**: Shadowy obsidian guard with glowing magenta, pink, and red-purple crackling energy (infected style).
  - **Halo 5**: Sleek carbon hilt with premium gold/bronze emitter trims and advanced clean blue energy.
  - **Infinite**: Shiny chrome-silver hilt and classical curved blades with complex sky blue, deep blue, and white crackling patterns.
- **Immersive 3D Paint Job Studio**: An extremely rich, fully integrated 3D **Paint Job** studio inside the character customization tab, built using Three.js and React to offer precise per-voxel coloring:

- **Immersive 3D Viewport**: Click **"Start Paint Job"** to enter the painting studio. The camera shifts face-forward towards the Spartan, auto-rotation is paused, and continuous 360° mouse orbiting and scroll-wheel zooming are fully unlocked.
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

## Secrets & Easter Eggs

- **GRIFB Pistol**: A hidden laser-pistol weapon can be unlocked by holding the letters **`G`**, **`R`**, **`I`**, **`F`**, and **`B`** at the same time, with no other keys pressed, for **2 seconds** during active gameplay. 
  - **Effect**: Replaces the player's standard loadout with a high-performance neon laser pistol.
  - **Hitscan Tech**: Employs mathematically resolved ray-sphere intersection testing with instant raycasted hit detection, rendering glowing tracer beams and particle impacts.
  - **Recoil & Recovery**: Fully animated programmatically, presenting a dynamic recoil kickback and smooth recovery poise synced directly to HUD reload and cooldown systems.
