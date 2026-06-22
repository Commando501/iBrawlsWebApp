# V3 Model + Animation Redux Handoff

Status: internal prototype
Player readiness: Not Player Ready
Last updated: 2026-06-20

## Purpose

This document is the working handoff for the Version 3 model and animation redux. It is intended to let a new session continue the work without relying on chat history.

The core goal is to turn V3 into the game's high-fidelity Spartan-style model system:

- A static body that visually matches the canonical reference model as a voxelized form.
- Runtime V3 models that remain voxel/render-system compatible, not runtime mesh imports.
- Animation that makes the exact voxel body move like a coherent armored character.
- Weapon carry and attack animation that holds the hammer, sword, and pistol correctly.
- Editor and dashboard tooling that helps us prove readiness before exposing V3 to players.

V3 must remain internal until static model quality, runtime performance, rigging, animation, weapon handling, and editor QA are all credible.

## Locked Decisions

- V3 remains hidden from player-facing model selection until explicitly released.
- V1 and V2 behavior must remain unchanged.
- Gameplay collision, hitboxes, melee reach, weapon mechanics, AI, networking, simulation, and save schemas must remain unchanged unless a later phase explicitly scopes them.
- The accepted V3 body source is an offline OBJ-derived voxel source, not a runtime OBJ/FBX/GLB mesh.
- Raw reference assets must not be committed, uploaded, persisted in exports, or loaded at runtime.
- Saved player armor remains voxel JSON.
- The dashboard/reference comparison may use exact source fidelity; gameplay/runtime paths may use derived LODs.
- Numeric tests are necessary but not sufficient for animation acceptance. Browser atlas visual review is required for visible motion work.

## Canonical Static Body Baseline

The current static V3 body baseline is the exact OBJ-surface voxel source generated at:

- `targetHeightVoxels: 192`
- `surfaceThicknessVoxels: 1`
- accepted source hash: `sha256:d47bdeb71004a1d1f6f0129ca67ae96c0e74a9cf9e0b8ba449c9594555b1cef7`

That exact source is considered screenshot-accepted. Do not reshape or regenerate it unless the user explicitly reopens static body fidelity.

Relevant files:

- `src/components/v3/v3AegisObjSurfaceVoxels.generated.ts`
- `src/components/v3/v3ExactSourceBaseline.ts`
- `src/components/v3/v3ExactSourceLod.ts`
- `src/components/v3/VoxelModelsV3.ts`
- `src/tools/v3ObjSurfaceVoxelizer.ts`
- `src/tools/generateV3AegisFromObj.ts`

## Rendering + Runtime Model Policy

V3 has two source-fidelity modes:

- `exact`: full accepted source for dashboard/reference/high-fidelity inspection.
- `runtimeLod`: deterministic derived LODs for gameplay-scale runtime and smoke scenes.

The runtime optimization direction is LOD and caching, not lowering the accepted exact source.

Relevant files:

- `src/components/v3/v3QualityTiers.ts`
- `src/components/v3/v3GeometryCache.ts`
- `src/components/v3/v3PerformanceBudget.ts`
- `src/tools/v3PerformanceSmoke.ts`
- `src/tools/v3ReadinessDashboard.ts`

## Editor + Dashboard Tooling

The V3 editor and dashboard are internal tooling surfaces:

- `/v3-readiness-dashboard.html`
- `/v3-performance-smoke.html`
- `/v3-animation-atlas-smoke.html`
- `/armor-model-editor.html`

The dashboard should keep reporting V3 as `Not Player Ready` until release criteria are intentionally changed. The animation atlas is the primary visual review tool for motion. It should be used for frame-by-frame review, four-view inspection, overlays, and defect report export.

## Animation Architecture

The intended V3 animation architecture is layered:

1. Exact OBJ-derived voxel body.
2. Canonical V3 rig contract derived from exact-source slot bounds.
3. External clean-rig motion sources: Mixamo remains authoritative for idle/walk and hammer references, while Mesh2Motion GLB data now drives sprint, slide, sword carry, sword lunge, and sword slash through a TPose-calibrated driver skeleton.
4. Runtime-only lower-body bridges to hide voxel seam tearing without changing source geometry.
5. Persistent upper-body weapon carry layer.
6. V3 procedural weapon attack tracks.
7. V3-specific death voxel burst.

Relevant files:

- `src/components/grifball/combatantAnimationV3.ts`
- `src/components/grifball/v3AnimationFidelity.ts`
- `src/components/grifball/v3RetargetedAnimationClips.ts`
- `src/components/grifball/v3Mesh2MotionClips.ts`
- `src/components/grifball/v3MotionRetarget.ts`
- `src/components/grifball/v3PoseClearance.ts`
- `src/components/grifball/v3AnimationAtlasDefects.ts`
- `src/components/grifball/v3SlotContinuity.ts`
- `src/components/grifball/v3LowerBodyChain.ts`
- `src/components/grifball/v3LowerBodyContinuity.ts`
- `src/components/grifball/v3LowerBodyJointBridges.ts`
- `src/components/grifball/v3DeathVoxelBurst.ts`

## Completed Milestones

### Static Body

- The original blocky hand-authored V3 model was replaced by an OBJ-derived voxel source.
- The dashboard side-by-side comparison reached a visually accepted static body shape.
- The accepted source was locked behind an exact-source baseline gate.
- Runtime LOD and geometry cache work made the exact source usable in runtime-scale tests.

### Locomotion

- Mixamo `Idle`, `Walking`, `Running`, and `T-Pose` FBX files were imported through a local-only pipeline.
- Generated clip data is sanitized and checked into code, while raw FBX files remain private authoring inputs.
- Idle and walk use retargeted Mixamo clips. Sprint now uses the generated Mesh2Motion `Sprint_Loop` clean-rig clip.
- Mesh2Motion grouped GLB exports are imported through `src/tools/v3Mesh2MotionImporter.ts`; local raw GLBs live under `reference/mesh2motion-v3/` and sanitized generated data lives in `src/components/grifball/v3Mesh2MotionClips.generated.ts`.
- The Mesh2Motion importer now emits schema v2 data: sanitized source skeleton metadata, `TPose` calibration, direct mappings such as `spine_03 -> spine3`, virtual V3 attachments such as `chest`, `helmet`, `collar`, `backpack`, and `grip*`, retargeted joint quaternions, and per-joint offsets for driver-rig playback.
- Earlier lower-body tearing was reduced through a single-chain lower-body binding and runtime undersuit bridge geometry.
- Current user assessment: idle, walk, and sprint are good enough for now.

### Death

- V3 death uses a deterministic voxel burst.
- The user has stated hit react is not needed and death is good enough as-is.

## Current Blocking Problem: Weapon Carry + Attack Animations

The next major issue is V3 weapon handling. The current carry sockets and weapon animations are visually wrong.

User requirements:

- Hammer is a two-handed weapon.
- Hammer carry must show both hands holding the weapon.
- Hammer slam:
  - Start from two-hand carry.
  - Bring hammer up and back behind the head, like a pickaxe swing.
  - Bring hammer down to slam the ground.
  - Return to neutral carry.
- Hammer melee:
  - Horizontal right-to-left swing.
- Sword is one-handed.
- Sword slash:
  - Horizontal right-to-left swing.
- Weapons must point the correct way in the model's hands.
- Weapon models must be correctly aligned to sockets before attack animation polish.

Recent code-level tests were added for broad semantic intent in `src/components/grifball/v3AnimationFidelity.test.ts`, but those tests are not enough. They verified pose deltas and atlas numeric thresholds, not the visual socket basis. The user is correct that the current carry/weapon visuals still look wrong.

## Likely Root Cause To Investigate First

Do not continue by only tuning `weaponPose.position` and `weaponPose.rotation` numbers. That was insufficient.

The likely root cause is a coordinate-contract mismatch between:

- V3 weapon mesh local axes.
- V3 weapon manifest sockets.
- `thirdPersonWeaponGrip` / `thirdPersonOffhandGrip`.
- Carry pose weapon offsets in `v3AnimationFidelity.ts`.
- Attachment behavior in `combatantRig.ts`.

Important observation:

- V2 applies per-weapon attachment rotations when attaching a child to `thirdPersonWeaponGrip`.
- V3 currently does not apply equivalent per-weapon socket-basis normalization at attachment time.
- That means V3 carry poses may be compensating for raw weapon mesh axes instead of starting from a correct grip basis.

Relevant files for this specific bug:

- `src/components/grifball/combatantRig.ts`
- `src/components/grifball/combatantRigV3.ts`
- `src/components/grifball/combatantAnimation.ts`
- `src/components/grifball/combatantAnimationV3.ts`
- `src/components/grifball/v3AnimationFidelity.ts`
- `src/components/v3/v3AssetManifest.ts`
- `src/components/v3/VoxelModelsV3.ts`
- `src/components/v3/v3WeaponScaleProfile.ts`
- `src/tools/v3AnimationAtlasSmoke.ts`
- `src/tools/v3AnimationAtlasSmokePage.ts`

## Recommended Next Phase

The next phase should be:

**Phase 51: V3 Weapon Socket Basis + Carry Pose Rebuild**

Scope:

1. Add diagnostics that prove weapon forward/up/right axes in world space for hammer, sword, and pistol.
2. Add visual/socket tests for:
   - primary grip at right hand,
   - offhand grip at left hand for hammer,
   - weapon forward direction,
   - weapon head/blade/barrel direction,
   - two-hand hammer span,
   - one-hand sword carry.
3. Normalize V3 weapon attachment basis at the rig/socket layer.
4. Rebuild carry poses after the socket basis is correct.
5. Only then rebuild attack tracks.

Do not start with the slam/slash tracks. Start with static carry correctness.

Suggested public helpers:

- `deriveV3WeaponSocketBasis(weaponModel, weapon)`
- `applyV3WeaponSocketBasis(weaponModel, weapon, attachmentName)`
- `analyzeV3WeaponCarryAlignment(model, weaponModel, weapon)`
- `buildV3WeaponCarryAlignmentOverlays(report)`

Acceptance targets:

- Hammer carry visually uses both hands.
- Hammer shaft/head are oriented consistently across front/side/rear views.
- Sword carry is one-handed and points forward/up in a believable grip.
- Pistol carry points the barrel forward and stays near the right hand.
- Atlas weapon cases start from the carry pose without snapping.
- Numeric atlas defect reports agree with browser-visible review.

## After Carry Is Correct

Proceed to procedural attack remake:

1. Hammer slam:
   - two-hand carry
   - pickaxe windup behind head
   - downward ground slam
   - recover to carry
2. Hammer melee:
   - horizontal right-to-left swing
   - recover to carry
3. Sword slash:
   - one-hand horizontal right-to-left slash
   - recover to carry
4. Pistol:
   - one-hand aim/fire recoil
   - recover to carry

Each track should be judged in `/v3-animation-atlas-smoke.html` from front, left, rear, and right views.

## Commands For New Session

Start with:

```powershell
git status --short
```

Useful focused tests:

```powershell
node --import tsx --test src/tools/v3Mesh2MotionImporter.test.ts
node --import tsx --test src/components/grifball/v3AuthoredAnimationClips.test.ts src/components/grifball/v3CleanRig.test.ts
node --import tsx --test src/components/grifball/v3AnimationFidelity.test.ts
node --import tsx --test src/components/grifball/v3AnimationAtlasDefects.test.ts
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts
node --import tsx --test src/tools/v3AnimationAtlasSmoke.test.ts
```

Broader V3 animation check:

```powershell
node --import tsx --test src/tools/v3Mesh2MotionImporter.test.ts src/components/grifball/v3AuthoredAnimationClips.test.ts src/components/grifball/v3CleanRig.test.ts src/tools/v3AnimationAtlasSmoke.test.ts src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/v3RetargetedAnimationClips.test.ts src/components/grifball/v3MotionRetarget.test.ts src/components/grifball/v3PoseClearance.test.ts
```

Final verification before claiming completion:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Browser QA:

- Open `/v3-animation-atlas-smoke.html`.
- Review idle/walk/sprint with hammer, sword, and pistol carry.
- Review hammer windup, hammer strike, hammer recover, hammer melee, sword lunge, sword slash, and pistol fire.
- Enable relevant overlays:
  - slot continuity,
  - weapon grip drift,
  - model bounds,
  - foot floor if locomotion is involved.
- Export defect reports for any visible issue.

## Current Worktree Notes

At the time this document was created, there were local changes in:

- `src/components/grifball/v3AnimationFidelity.ts`
- `src/components/grifball/v3AnimationFidelity.test.ts`

Those changes added semantic tests and small retarget constants for hammer/sword weapon tracks, but they should not be treated as a final visual solution for weapon carry or socket alignment.

There was also unrelated local Python/test-output noise reported by Git around:

- `python/.pytest_tmp/...`
- `.codex/pytest-tmp-advisor/`

Do not revert or depend on those unrelated files when continuing V3 work.

## Guardrails For Future Sessions

- Do not claim weapon animations are fixed without browser atlas review.
- Do not rely solely on `weaponGripDrift` if the weapon points the wrong way.
- Do not tune attack animation constants before carry/socket basis is correct.
- Do not reshape the accepted OBJ voxel body to fix weapon animation.
- Do not expose V3 to players as part of weapon animation work.
- Do not change V1/V2 weapon behavior.
- Do not change gameplay reach, hitboxes, collision, or weapon mechanics.
