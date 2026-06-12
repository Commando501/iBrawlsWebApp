# V3 Production Roadmap Design

Status: Approved continuation from the completed V3 foundation rollout
Date: 2026-06-12

## Purpose

The original V3 implementation plan completed the foundation: V3 exists as a parallel model system, can be selected or forced as a visual policy, is the recommended default, and has basic runtime, customization, replay, loading, and performance support. The long-term goal remains higher: V3 should reach production-quality voxel character and weapon visuals, richer procedural animation, deeper customization, and verified desktop/mobile reliability while V1 and V2 remain playable legacy options.

This roadmap extends V3 past the foundation phases without changing the core guardrails: V3 remains visual-only, private reference assets stay local and unshipped, and all shipped armor and weapon content must be original to iBrawls.

## Post-Rollout Phases

### Phase 10: Production Asset Quality Foundation

Phase 10 upgrades the current V3 blockout assets into a measurable production-quality asset pipeline. It adds asset quality audit contracts, richer procedural voxel grammar for built-in V3 parts, stronger weapon silhouettes, and preview/reporting hooks. The output should still be code-authored original voxel assets, not direct conversions from private OBJ/FBX/Blend files.

Completion means:

- V3 built-in character parts and weapons expose measurable production-quality signals: material diversity, paint-role use, emissive/detail usage, silhouette variation, and budget compliance.
- Character and weapon voxel generators are richer than rectangular shell blockouts while staying inside V3 fit bounds and performance budgets.
- Tests can distinguish a plain blockout from a production candidate.
- README and local preview tooling explain that Phase 10 is the first production-quality asset pass.

### Phase 11: Animation Fidelity Pass

Phase 11 upgrades the V3 animation runtime from functional layered motion to expressive procedural motion. It should improve lower-body locomotion, upper-body weapon layers, first-person weapon feel, hit reactions, recoil, breathing, look tracking, hand-to-weapon constraints, and editor-tuned pose presets.

Completion means:

- Core movement and weapon states have production-ready V3 motion in first and third person.
- Attack layers affect the correct body masks while locomotion remains active.
- Animation editor exports can tune V3 poses without replacing the procedural runtime.
- Browser smoke checks confirm live, replay, observer, and editor paths do not drift.

### Phase 12: Customization Depth And Creator UX

Phase 12 expands player-facing V3 customization from a bounded proof of concept into a practical creator workflow. It should add more modular armor and weapon options, better paint/material controls, validation feedback, preview comparison, and save/load ergonomics.

Completion means:

- Players can build and equip varied V3 armor combinations without leaving in-game voxel editing.
- Custom V3 pieces remain bounded, readable, performant, and sanitized for multiplayer.
- Weapon skins and material roles have clear editor and preview behavior.
- V1/V2 customization remains intact.

### Phase 13: Production QA, Optimization, And Parity

Phase 13 hardens V3 for routine play. It verifies desktop and mobile performance, multiplayer/observer/replay/loading parity, first-person and third-person consistency, and long-session stability.

Completion means:

- Eight V3 combatants run acceptably on desktop and mobile-appropriate tiers.
- V3 visual policy behaves identically across offline, hosted multiplayer, clients, observers, loading screens, and replays.
- Browser smoke checks cover desktop and mobile viewports.
- Tests, lint, build, and runtime smoke checks pass.

## Phase Ordering Rationale

Production assets come first because animation and editor polish need stable visual targets. Animation fidelity comes second because it depends on richer V3 part proportions and weapon silhouettes. Customization depth comes third because player-created content should inherit the production asset grammar and validation rules. QA and optimization come last because it should validate the actual production content instead of temporary blockouts.

## Guardrails

- Do not ship direct Halo-derived meshes, names, textures, or converted voxel payloads.
- Do not add server-side mesh upload or arbitrary runtime import paths.
- Do not alter gameplay collision, melee reach, weapon timing, movement, scoring, AI decision distances, or network authority.
- Do not remove V1 or V2 model policy choices.
- Do not make mobile share expensive desktop-only visuals when a tiered render path is available.

## Verification Strategy

Each post-rollout phase must include:

- Focused unit tests for new contracts and touched modules.
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- Browser smoke checks for any changed UI, preview, editor, or live-rendering surface.
- Mobile viewport checks when visible text or layout changes.

## Final Completion Criteria

The long-term V3 vision is complete when:

- V3 built-in character and weapon assets are production-quality original voxel assets.
- V3 supports rich first-person and third-person procedural animation across core movement and combat states.
- V3 supports modular armor, color/material customization, bounded custom armor, and useful creator tooling.
- Offline and hosted matches can force V1, V2, or V3 visuals.
- V3 works for local players, bots, remote humans, observers, loading previews, replays, character previews, weapon previews, armor editor, and animation editor.
- Desktop and mobile performance targets are verified for up to eight V3 combatants.
- V1 and V2 remain playable legacy options.
- Gameplay remains normalized and independent of visual model policy.
