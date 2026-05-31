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

Combat AI is orchestrated from `GrifballGame.tsx` (10-state FSM including `PRESSURING`) with pure decision logic in `src/game/`.

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

All offline AI combatants (including `main_ai` at roster slot 0) share the same voxel Spartan mesh rig via `otherPlayerMeshes` / `createOrUpdateRemotePlayer` (including mesh provisioning on orchestrator spawn/hue change). The legacy `enemyGroup` path is retained **only** for multiplayer observer/host-client spectate rendering — not for offline bot display. Offline sandbox stores every AI in `otherPlayers` with `controller: 'ai'`; multiplayer stores remote humans with `controller: 'remote'` and never runs local AI ticks on them.

**Roster membership:** One `otherPlayers` map keyed by combatant id. Each entry is a full `Combatant` plus `controller: 'ai' | 'remote'`. **`aiOrchestrator.ts`** runs once per offline frame to spawn/despawn bots to `offlineBotCount`, ensure `main_ai`, distribute per-slot config/teams, and tick bot coordination (`aiBotCoordinator`). `getRosterAI()` / `getAICombatants()` drives `updateAI`; `getDisplayOpponent()` drives HUD/enemy stats (main_ai offline, primary remote online). Replay recording writes all AI combatants into `frame.otherPlayers`; legacy `frame.ai` is read-only for older replays.

**Phase 6 cleanup:** No privileged `main_ai` combat loops — damage, pressure, respawn, skeletal animation, and replay all iterate the roster uniformly. The stable id `'main_ai'` remains as offline slot 0; `mai()` is a thin accessor to `getMainAI()`. Team scoring bridges (`scoreEnemy`, `enemy*`) remain for HUD/multiplayer perspective.

**Team scoring:** Match scores live in `teamScores` (per-team `score`, `kills`, `deaths`, `respawnTimer`). Sandbox maps the local player to `blue` and AI combatants to `red` via `RosterSlotConfig.team`. HUD, win conditions, elimination feed, and multiplayer sync still read the legacy `scorePlayer` / `scoreEnemy` names through bridges that flip perspective for multiplayer clients (client = red). Main AI death/respawn updates both the combatant object and the red-team tally via legacy `enemy*` bridges.

Custom difficulty exposes derived-parameter overrides (`aiSpatialIQ`, `aiFeintChance`, `aiPressureAggression`) alongside the existing neural matrix sliders. **`aiPersonalities.ts`** provides six combat archetypes (Berserker, Counter-Fighter, Zoner, Mixup Artist, Assassin, Brawler) that overlay difficulty tuning with distinct knob presets and behavioral flags (`skipPressure`, `feintBias`, `spacingBand`). Sandbox, admin settings, and the Holographic Combatant Grid bot setup expose an archetype dropdown; tournament opponents receive a random archetype per bracket entrant or can be procedurally generated from a selected pool of Custom AI Presets. **`rosterSlotConfig.ts`** applies the Sandbox "AI COMBAT NEURAL NET" panel as the shared default for every AI combatant; per-slot grid overrides (difficulty, archetype, hue) merge on top so bots inherit the full weapon-prioritization range (e.g. sword-100) unless explicitly overridden.

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
- **Jump / Boost**: `Spacebar` (Launch hammer jump if pressed immediately after Slam)
- **Dash**: `Q` (Quick dash in movement direction)
- **Crouch / Slide**: `C` (Slide when running forward)
- **Sprint**: `Shift` (Hold while moving forward)
- **Scoreboard**: `U` (Hold to view current stats)
- **Weapon 1 (Hammer)**: `1`
- **Weapon 2 (Sword)**: `2`
- **Switch Weapons**: `Scroll Wheel`
- **Primary Attack**: `Left Mouse Button` (Hammer Slam / Sword Lunge)
- **Alt Attack**: `Right Mouse Button` (Sword Quick Slash)
- **Pause / Menu**: `Escape`

### Gamepad (Xbox Controller Layout)
- **Movement**: `Left Analog Stick`
- **Aim / Camera**: `Right Analog Stick` (Continuous framerate-independent rotation)
- **Jump / Boost**: `A` (Button 0)
- **Crouch / Slide**: `B` (Button 1)
- **Sonic Dash**: `X` (Button 2)
- **Swap Weapon**: `Y` (Button 3)
- **Slam / Lunge (Attack)**: `Right Trigger (RT)` (Button 7)
- **Quick Slash (Alt Attack)**: `Right Shoulder (RB)` (Button 5)
- **Sprint**: `Left Stick Click (LS)` (Button 10)
- **Scoreboard**: `Back / View` (Button 8)
- **Pause / Menu**: `Start` (Button 9)

An interactive, high-tech vector diagnostics panel in the settings overlay visualizes all active controller bindings in real-time, flashing and pulsing button elements during rebinding.

## Physics & Collisions

To prevent players and AI characters from passing straight through one another, iBrawls incorporates a 2.5D cylinder-based rigid-body collision system:

- **Entity Cylinders**: Every active, living participant (local player, main AI, and custom bots/remote players) is bounded by a vertical collision cylinder with a radius of **0.55m** (diameter of **1.1m**) and state-dependent height ranges (**1.8m** standing, **1.2m** crouching).
- **Kinematic Resolution**: When two participants overlap both horizontally and vertically, they are pushed apart by **50%** of the overlap depth each along the collision normal.
- **Velocity Normal Damping**: To ensure collisions feel solid and prevent jittering or high-speed passthroughs, the relative velocity component along the collision normal is cancelled when entities are moving towards each other.
- **Multi-iteration Solver**: The collision engine runs for **3 iterations** each frame inside `enforceArenaBounds` before bounding players to the circular arena, ensuring perfectly stable physics even in crowded multi-bot pincers.
- **Zero-lag Rendering**: State positions are proactively synchronized to Three.js group meshes immediately following collision resolution to eliminate 1-frame rendering lag.

## Map Selection & Environments

Local play setups feature an interactive map selector overlay supported by a dynamic, real-time rotating 3D preview of both standard arenas, premade environments, and custom-loaded maps:

- **Industrial Hangar**: The default grimy voxel-art warehouse environment. It includes 12 structural support H-beam columns, safety hazard warnings, ceiling trusses, metal conduits, exhaust vents, and warm amber spotlighting.
- **Circle Arena (Holodeck)**: A clean, sleek virtual simulation deck. It is a minimalist space-void arena featuring high-tech glowing neon cyan grids, concentric glowing ring alignments, four cardinal neon posts, and a cool cyan spotlight core.
- **Cyber Hex Grid (Preset)**: A high-tech tactical holodeck featuring glowing neon pillars, defensive carbon-fiber partitions, rechargeable crates, and a central plasma core reactor emitting massive violet neon glows.
- **Jungle Ruined Outpost (Preset)**: An overgrown, crumbling training outpost dominated by nature elements. Features rustic stone walls, giant mossy boulders, forest giant tree trunks, and a mystical emerald crystal totem.
- **Vanguard Asteroid Mine (Preset)**: An industrial minerals extraction facility situated on a space asteroid. Featuring heavy blast doors, freight containers, metallic core processor drills, amber industrial warning lights, and orange-veined meteorite ore clusters.
- **Forerunner Canyon Plateau (Preset)**: A suspended rectangular forerunner arena hovering over a golden desert canyon at sunset. Features team-colored spires (Blue on the left, Red on the right) and a majestic background beacon tower.
- **Neon Outrun Grid (Preset)**: A suspended rectangular retro holodeck hovering over a glowing cyber city at twilight. Features glowing neon palm trees, background light beams, and a colossal striped sunset sun.
- **Custom Local Map**: Load a custom map file (`.json`) exported from the local Standalone Map Maker. The 3D thumbnail preview updates in real-time to render all placed obstacles, light sources, and spawn points in miniature!

## Standalone 3D Map Maker

iBrawls features a beautiful, feature-rich, and completely standalone 3D Map Maker application that runs 100% locally and offline in the user's browser. Since it is entirely decoupled from the main web application, players simply open the local HTML file to design custom battle arenas using standard assets!

### How to Run the Map Maker
1. **Locate the File**: Find `mapmaker.html` in the root of the project directory.
2. **Open Locally**: Simply double-click `mapmaker.html` to launch it in any modern web browser. No local development server, Node.js environment, or compilation is required!
3. **Design & Customize**: Spawn crates, columns, barriers, and cores. Modify positions, rotations, scales, colors, metalness, and roughness using the visual transformation sliders. Choose between **Circular** and **Rectangular** arena shapes!
4. **Lighting Controls**: Add custom point lights to set up warm or cold ambient mood lighting in your arena.
5. **Bake Nav Mesh**: Click the **Bake Nav Mesh** button to programmatically generate the automated pathfinding node navigation grid. The walkable pathways will instantly light up in glowing green and cyan in the viewport!
6. **Export JSON**: Click the **Export JSON** button to download your compiled arena as a `.json` map file.
7. **Load in Game**: Launch the main game, select **"Load Custom Map (.json)"** from the Battle Arena selection dropdown in the lobby, choose your exported file, and instantly start fighting on your custom battlefield!

### Editor Features
- **Interactive 3D Canvas**: Outfitted with `PerspectiveCamera` and `OrbitControls` for full inspection. Allows direct mouse click/raycast selections with real-time selection helpers.
- **Flexible Object Placement**: Place and transform Box, Cylinder, and Sphere obstacles. Modify dimensions, position, rotation, opacity, metalness, roughness, colors, emissive neon glow, and collidable status (`isCollidable`).
- **Flexible Arena Shapes**: Toggle between **Circular** and **Rectangular** boundaries. The rectangular court uses a standard 2:1 aspect ratio with a dedicated rectangular grid helper.
- **Dynamic Lighting Controls**: Add custom point lights to set up mood lighting. Adjust position, distance, intensity, decay, and color using real-time inspectors.
- **Texture Presets**: Dress obstacles in 20 custom texture profiles matching 7 distinct themes:
  - *Nature*: Grass turf (`nature_grass`), Mossy Stone (`nature_mossy_stone`), Wood Grain (`nature_wood`).
  - *Space*: Starbase alloy plate (`space_alloy`), Lunar meteorite crag (`space_meteorite`), Cosmic dust (`space_lunar_dust`).
  - *Futuristic*: Sleek carbon fiber (`futuristic_carbon`), Neon hexagonal plates (`futuristic_hex`), Energy grid shield (`futuristic_shield`).
  - *City*: Asphalt pavement (`city_asphalt`), Warehouse brick (`city_brick`), Raw concrete (`city_concrete`).
  - *Fantasy*: Runed stone monolith (`fantasy_runed_stone`), Rustic cobblestones (`fantasy_cobble`), Polished gold plating (`fantasy_gold`).
  - *Forerunner*: Dark metal panels with gold circuits (`forerunner_panel`), Ornate etched gold plating (`forerunner_gold`).
  - *Synthwave*: Synthwave Cyan Grid (`synthwave_grid`), Neon Laser Energy (`synthwave_neon_laser`), Sunset Chrome (`synthwave_chrome`).
- **Automated Nav-Mesh Baking**: Spatial analysis engine automatically runs spartan clearance tests ($0.65\text{m}$) against circular or rectangular collidable boundaries to generate a 2D Node Navigation Grid. Walkable paths are visualized as beautiful glowing green nodes with blue connection lines in the editor viewport!
- **Local File System IO**: Fully offline-based import and export. Save maps as local `.json` files to distribute to other players or load them directly in the game lobby for training skirmishes.

## Secrets & Easter Eggs

- **GRIFB Pistol**: A hidden laser-pistol weapon can be unlocked by holding the letters **`G`**, **`R`**, **`I`**, **`F`**, and **`B`** at the same time, with no other keys pressed, for **2 seconds** during active gameplay. 
  - **Effect**: Replaces the player's standard loadout with a high-performance neon laser pistol.
  - **Hitscan Tech**: Employs mathematically resolved ray-sphere intersection testing with instant raycasted hit detection, rendering glowing tracer beams and particle impacts.
  - **Recoil & Recovery**: Fully animated programmatically, presenting a dynamic recoil kickback and smooth recovery poise synced directly to HUD reload and cooldown systems.
