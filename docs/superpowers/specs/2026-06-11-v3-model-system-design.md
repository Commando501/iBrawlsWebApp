# V3 Model System Design

Status: Approved design draft
Date: 2026-06-11

## Purpose

iBrawls needs a Version 3 character and weapon model system that raises visual fidelity and animation quality while preserving the voxel identity and render-optimized runtime. V3 should become the long-term preferred model system across the game, but V1 and V2 must remain first-class sandbox options.

The work should proceed as a comprehensive, phased implementation. The first implementation phase can focus on offline conversion and preview tooling, but only after the full architecture is planned.

## Goals

- Add a parallel `v3` model system without replacing or corrupting V1/V2 behavior.
- Support V3 across player, bots, remote humans, observers, loading previews, replays, first-person, third-person, and weapons.
- Preserve sandbox optionality so offline and hosted matches can force all visible combatants to V1, V2, or V3.
- Keep model-system choice visual-only. Gameplay collision, target ranges, melee reach, lunge logic, and AI decision distances remain normalized.
- Build V3 around modular armor and weapons from the start.
- Support player-facing in-game voxel editing for custom armor.
- Support developer-only offline mesh/OBJ/FBX/Blend reference tooling, with curated output committed through the repository.
- Target live gameplay with up to 8 V3 combatants on desktop and mobile.
- Use procedural layered animation as the primary runtime approach, with keyframes used for tuning and refinement.

## Non-Goals

- Do not ship direct conversions of the private reference Halo assets.
- Do not add server-side arbitrary mesh upload or runtime import of external models.
- Do not make V3 hitboxes or reach larger by default.
- Do not remove V1 or V2.
- Do not rewrite all rendering and animation systems before proving the V3 asset pipeline.

## Reference Asset Policy

The supplied Halo Reach OBJ/FBX/Blend files are private local reference assets only. They can guide proportions, segmentation, density, rig expectations, material grouping, and animation-quality targets. Shipped V3 iBrawls armor and weapon assets should be original designs.

OBJ is useful as a geometry fallback, but FBX/Blend should be the planning reference source because OBJ does not preserve rig, bone, or skin-weight data.

## Core Architecture

V3 should be implemented as a parallel model system:

- Existing model systems remain valid: `v1`, `v2`, and new `v3`.
- V3 gets dedicated character, weapon, rig, animation, and tooling modules.
- Shared public entry points resolve through model-system aware adapters where practical.
- Existing gameplay contracts remain stable while the visible model system evolves.

The architecture should distinguish two concepts:

- Personal loadout: armor parts, colors, weapon skins, custom armor, and similar player choices.
- Match visual policy: host/offline setting that forces all visible combatants to render as V1, V2, or V3.

The match visual policy should control rendering only. Collision, target radius, melee reach, lunge range, body collision, AI distance checks, and scoring remain normalized.

Likely modules:

- `VoxelModelsV3`: V3 character and weapon construction.
- `v3ModelTypes`: V3 part ids, loadout schema, palette roles, profile data, and budgets.
- `v3PartBounds`: visual fit constraints for modular and custom armor.
- `v3AssetPipeline`: offline conversion output formats and validators.
- `combatantRigV3` or a version-aware rig adapter: V3 skeleton, sockets, and first-person hand rigs.
- `combatantAnimationV3`: layered procedural animation runtime.
- `modelVisualPolicy`: policy resolution for offline, multiplayer, replay, and previews.

## Match Visual Policy

Offline play should allow the user to force all combatants to:

- V1 classic models
- V2 rigged models
- V3 advanced models

Multiplayer hosting should expose the same policy when creating a match. Clients should receive the host-selected policy and render all visible combatants accordingly.

Resolution rules:

1. Read the match visual policy.
2. Resolve each combatant's visible model system from that policy.
3. Apply compatible personal loadout fields for that model system.
4. If a selected loadout piece is incompatible, fall back to a safe default for that model system.
5. Keep gameplay state and collision independent from the visual result.

Legacy clients or invalid payloads should fall back to safe defaults rather than crashing or rejecting a match.

## V3 Asset And Customization Design

V3 assets should be modular from the start. Canonical part families should include:

- Helmet and head gear
- Neck and collar
- Chest and torso
- Shoulders
- Upper arms
- Forearms
- Hands
- Pelvis and waist
- Thighs
- Shins
- Feet and toes
- Back equipment pack
- Optional attachments such as knife, pouches, antennae, visor modules, shoulder extras, and utility gear

Each part should define:

- Part id
- Slot family
- Target V3 bone or socket
- Voxel payload or generated voxel source
- Paint roles
- Visual fit bounds
- LOD metadata
- Budget metadata

Paint roles should include at least:

- primary
- secondary
- trim/accent
- undersuit
- visor
- emissive
- decal/detail
- fixed material

Custom armor remains voxel-based for users. The in-game editor should validate:

- Part stays inside V3 visual fit bounds.
- Voxel count stays within budget.
- Merged geometry/material group count stays within budget.
- The piece has enough connected structure to be readable.
- The piece does not create extreme silhouettes that undermine match readability.

Developer tooling can import local OBJ/FBX/Blend references offline and output curated V3 voxel parts. This tooling has no server integration and no player upload path.

## V3 Weapons

V3 includes weapon models from the start:

- Gravity hammer
- Energy sword
- Pistol

Weapon assets should use the same V3 principles:

- High-fidelity voxel models
- Original iBrawls designs
- Paint/material roles
- First-person and third-person socket compatibility
- LOD/budget metadata
- Shared grip definitions
- Optional weapon skin/preset support

Weapon grips should be authored as contract data, not hard-coded offsets scattered through consumers. Required sockets include:

- Right-hand primary grip
- Left-hand/offhand support grip
- First-person primary grip
- First-person offhand grip
- Holster/back/idle attachment points where useful

## V3 Rig Design

V3 should use a richer skeleton than V2 while exposing adapters for existing gameplay systems.

Core third-person rig groups:

- root
- pelvis
- spine lower
- spine mid
- spine upper
- chest
- neck
- head
- clavicle left/right
- shoulder left/right
- upper arm left/right
- forearm left/right
- wrist left/right
- hand left/right
- optional finger/grip groups
- thigh left/right
- knee/shin left/right
- ankle left/right
- foot left/right
- toe left/right

Attachment points:

- third-person weapon grip
- third-person offhand grip
- right hand grip
- left hand grip
- first-person weapon grip
- first-person offhand grip
- head center
- chest center
- back/equipment socket
- holster sockets as needed

First-person support is part of V3 from the beginning. The first-person arms/hands rig should share grip semantics with the third-person rig so weapon positioning and animation do not drift.

Existing systems that expect the broad V1/V2 combatant bones should receive a stable adapter rather than depending directly on every V3 bone.

## Procedural Animation Design

V3 animation should be procedural and layered. Keyframes are refinement data, not the only source of runtime motion.

Primary layers:

- Lower-body locomotion: idle, walk, strafe, sprint, crouch, jump, fall, land, turn-in-place, foot and toe motion.
- Upper-body weapon actions: hammer slam, hammer melee, sword ready, sword slash, sword lunge, sword recover, pistol ready, pistol fire, pistol recover, ball carry, and ball pass.
- Additive overlays: hit reactions, recoil, breathing, shield flare, sprint intensity, weapon weight, head/look tracking, and equipment motion.
- Constraint layer: hand-to-weapon grip, offhand support, first-person grip alignment, and foot grounding where practical.
- State blending: each action affects only the relevant body regions.

Examples:

- Hammer attack primarily drives upper body, arms, hands, and weapon while lower-body locomotion continues.
- Sprint affects legs, pelvis, chest lean, and arm swing unless overridden by an active upper-body weapon state.
- Pistol fire adds recoil to hands, forearms, upper chest, and camera/first-person rig without taking over the full body.
- Sword lunge combines locomotion impulse visuals with upper-body weapon extension and recovery.

The animation runtime should blend layers by body mask, priority, and weight. It should be state-aware enough to avoid impossible poses while retaining responsiveness.

## Animation Editor Requirements

The animation editor should support V3 directly:

- V3 model-system option.
- V3 bone list and skeleton overlay.
- V3 first-person and third-person views.
- Hammer, sword, and pistol weapon targets.
- Socket editing for all V3 grip points.
- Sparse key poses for pose-preset tuning.
- Exported pose/curve data consumed by the procedural runtime.

Editor exports should remain versioned. V3 export data should be able to coexist with V1/V2 editor data.

When runtime V3 rig or animation behavior changes, the editor preview/export path must be updated in the same implementation phase that needs parity.

## Runtime Integration Surfaces

V3 support must reach every visible model surface:

- Local player first-person arms and weapons
- Local player third-person model where used
- AI bots and offline rosters
- Remote multiplayer players
- Observer/spectator visuals
- Replay playback visuals
- Loading-screen player previews
- Main menu character preview
- Armor/model editor
- Animation editor
- Weapon previews/customization
- README and docs

Shared entry points such as `buildVoxelSpartanModel`, `createCombatantMeshRig`, preview builders, loading preview builders, replay visuals, and remote combatant provisioning should resolve through the active visual policy or an explicit requested model system.

## Multiplayer And Network Design

The host-selected visual model policy should be included in match/lobby configuration and distributed to clients.

Network sanitation should:

- Accept V3 model-system fields.
- Preserve V1/V2 backward compatibility.
- Sanitize V3 custom armor and weapon customization to bounded payloads.
- Reject unknown or oversized fields.
- Fall back to defaults for incompatible loadout pieces.

Both relay paths need parity:

- Local Node/WebSocket relay
- Cloudflare Worker Durable Object relay

The network contract should avoid sending developer-only mesh/import data. V3 runtime payloads should contain curated ids, bounded voxel custom armor snapshots where allowed, colors, and policy fields.

## Replay And Observer Design

Replays should persist enough visual metadata to reproduce the intended model policy:

- Match visual model policy
- Player loadouts or sanitized snapshots
- Weapon selections/skins where applicable

Older replays without this metadata should continue to render using legacy defaults.

Observer and replay rendering should use the same V3 model/weapon builders and animation adapters as live gameplay where practical, to avoid visual drift.

## Performance And Mobile Design

V3 must support live gameplay with up to 8 visible combatants on desktop and mobile.

Every V3 character part and weapon should have budget metadata:

- Source voxel count
- Greedy-merged box count
- Geometry/material group count
- Draw-call estimate
- LOD count
- Memory estimate

Rendering guidelines:

- No per-voxel draw calls in live gameplay.
- Use greedy meshing, material grouping, cached geometry, and instancing where useful.
- Reuse built geometry for repeated parts/loadouts when safe.
- Keep material counts low enough for mobile.
- Treat emissive/detail layers as quality-tier-dependent.

Adaptive quality ladder:

- Same V3 model and rig contract across desktop and mobile.
- Desktop can use higher LODs, richer materials, longer LOD distances, and more additive overlays.
- Mobile can use lower LODs, stricter batching, cheaper materials, reduced shadows, and throttled distant animation updates.
- Runtime FPS/device checks choose a default quality tier.
- Sandbox/user settings can expose manual override where practical.

Animation performance:

- Full update rate for local player and nearby/important combatants.
- Lower update frequency for distant/offscreen combatants.
- Optional disabling of secondary/additive overlays on low tiers.
- Avoid expensive per-frame geometry rebuilds.

## Art Direction

V3 should aim for readable competitive silhouettes first, with high-detail armor panels layered on top. In live Grifball, players must quickly read:

- Team/color identity
- Facing direction
- Weapon state
- Movement direction
- Attack windup/recovery
- Alive/downed state

Detail is valuable only when it reinforces those reads. Dense parts should not blur silhouette or hide gameplay-critical animation.

## Phased Rollout

### Phase 1: Architecture And Contracts

- Finalize V3 type/schema contracts.
- Define match visual policy.
- Define V3 part taxonomy, paint roles, budgets, and rig graph.
- Map every runtime, UI, replay, network, and tooling surface.
- Add planning tests where useful for policy resolution.

### Phase 2: Offline Asset Pipeline

- Build local-only converter/preview tooling.
- Read OBJ as geometry fallback and FBX/Blend as reference sources.
- Generate original V3 voxel part drafts.
- Preview voxel density, segmentation, palette roles, and LODs.
- Validate budgets and fit bounds.

### Phase 3: Canonical V3 Model And Weapons

- Create one complete modular V3 Spartan-style model.
- Create V3 hammer, sword, and pistol.
- Add LOD and budget metadata.
- Keep assets original to iBrawls.

### Phase 4: Runtime Builder And Rig

- Add `modelSystem: 'v3'`.
- Add V3 model and weapon builders.
- Add V3 rig/sockets and first-person support.
- Preserve V1/V2 builder behavior.
- Add focused rig and socket tests.

### Phase 5: Procedural Animation Runtime

- Add V3 layered animation runtime.
- Implement lower-body locomotion.
- Implement upper-body weapon actions.
- Implement additive overlays and constraint layer.
- Support first-person and third-person parity.
- Integrate editor-exported pose/curve presets.

### Phase 6: Customization And Editors

- Add V3 modular armor selection.
- Add V3 paint roles.
- Add V3 custom armor constraints in the player-facing editor.
- Add V3 animation-editor targets and preview/export support.
- Preserve V1/V2 customization paths.

### Phase 7: Match Policy, Multiplayer, And Replay

- Add offline visual model policy controls.
- Add hosted multiplayer visual model policy controls.
- Update protocol, local relay, and Worker relay sanitation.
- Persist visual model policy in replay metadata.
- Update observer/replay/loading previews.

### Phase 8: Performance And Mobile

- Add adaptive V3 render quality tiers.
- Add LOD selection and animation throttling.
- Verify live 8-combatant V3 matches.
- Verify mobile layouts and render tiers.
- Tune budgets based on measured behavior.

### Phase 9: Default Rollout

- Make V3 the recommended/default model system when stable.
- Keep V1 and V2 as selectable legacy sandbox modes.
- Update README and user-facing documentation.

## Verification Strategy

Verification should include:

- Unit tests for model-policy resolution.
- Unit tests for V3 loadout sanitation and fallbacks.
- Rig tests for V3 bones, sockets, first-person grips, and weapon attachments.
- Animation tests for body-mask layering and first-person/third-person grip stability.
- Converter validation tests for voxel bounds, budgets, and LOD metadata.
- Replay tests for missing-policy fallback and V3 metadata preservation.
- Multiplayer host/join tests for policy propagation.
- Loading/preview tests for model policy application.
- `npm run lint`
- `npm test`
- `npm run build`
- Browser smoke checks for editor, preview, live match, replay, and loading flows.
- Mobile viewport/device-tier checks.

## Risks And Mitigations

Risk: V3 visual fidelity exceeds mobile performance budgets.
Mitigation: Require LODs, budget metadata, adaptive quality tiers, and early mobile validation.

Risk: V3 customization creates unreadable silhouettes.
Mitigation: Use visual fit bounds, silhouette rules, voxel budgets, and validation warnings/errors.

Risk: V3 rig complexity leaks into gameplay logic.
Mitigation: Keep normalized gameplay collision and use adapters for broad combatant contracts.

Risk: V3 breaks multiplayer compatibility.
Mitigation: Add policy fallback rules, strict sanitation, and relay parity tests.

Risk: Editor/runtime animation drift.
Mitigation: Update editor targets and exports in the same phases that introduce V3 runtime animation changes.

Risk: Reference assets create licensing or originality issues.
Mitigation: Treat them as private local reference only and ship original iBrawls assets.

## Completion Criteria

V3 is complete when:

- A full match can run with 8 V3 combatants on desktop and mobile-appropriate quality tiers.
- V3 supports first-person and third-person character and weapon visuals.
- V3 supports modular armor, color customization, and bounded in-game custom armor pieces.
- V3 procedural layered animations cover core movement, combat, and weapon states.
- Offline and hosted matches can force V1, V2, or V3 visuals.
- V1 and V2 remain playable legacy options.
- Replays, observers, loading previews, character previews, and editors all support V3.
- Gameplay collision/range behavior remains normalized and visual-policy independent.
- Tests, build, and browser/mobile verification gates pass.
