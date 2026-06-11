# V3 Layered Procedural Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first V3-only layered procedural animation runtime with body-mask isolation, weapon-specific upper-body poses, first/third-person socket parity, and animation-editor V3 targets while preserving V1/V2 animation behavior.

**Architecture:** Keep V3 animation in a separate `combatantAnimationV3.ts` module and dispatch into it only when `mesh.userData.modelSystem === 'v3'`. The V3 runtime composes lower-body locomotion, upper-body weapon action, and additive detail layers against the broad V3 rig groups from Phase 4, then a later task mirrors those V3 targets in the standalone animation editor.

**Tech Stack:** TypeScript, Three.js, existing combatant rig attachment names, Node test runner with `tsx`, Vite build.

---

## Scope And Guardrails

- Keep V1 and V2 animation behavior unchanged unless a focused regression test proves the change is V3-only.
- V3 animation is visual-only. Do not change hitboxes, attack ranges, collision, AI, weapon timing, or network payload semantics.
- Use original procedural poses only. Do not import private reference animation data or generated Halo-derived keyframes.
- Body masks must isolate action layers: lower-body locomotion continues while upper-body attacks play.
- First-person support in this phase means V3 weapons and sockets have matching procedural pose helpers; full V3 first-person arms can remain a later customization phase if no arm mesh exists yet.
- Runtime animation/rig changes must be mirrored in the standalone animation editor target lists and export path when parity matters.

## Planned Files

- Create `src/components/grifball/combatantAnimationV3.ts`: V3 layered animation inputs, body-mask helpers, lower-body locomotion, upper-body weapon poses, additive detail layers, and first-person V3 weapon pose helpers.
- Create `src/components/grifball/combatantAnimationV3.test.ts`: body-mask isolation, locomotion, weapon action, pistol recoil, death reset, and first-person pose tests.
- Modify `src/components/grifball/combatantAnimation.ts`: dispatch V3 models to `animateV3CombatantModel()` and pass through optional `activeWeapon`, `isLunging`, and settings data without changing existing call sites.
- Modify `src/components/grifball/combatantRig.test.ts`: add V3 animation/rig regression coverage only if broad rig integration needs a shared assertion.
- Modify `animation-editor.html`: add Version 3 and pistol options.
- Modify `src/tools/animationEditor.ts`: add V3 model-system state, V3 target lists, V3 preview loadout, V3 weapons including pistol, and linked V3 arm-track seeding.
- Modify `src/tools/animationEditorCore.test.ts`: add V3 export/target persistence coverage if editor core payload shape changes.
- Modify `package.json`: include `combatantAnimationV3.test.ts` in `npm test`.
- Modify `README.md`: document that Phase 5 adds V3 layered procedural animation and V3 editor targets, while full V3 custom armor editing remains later.

---

## Task 1: V3 Layered Animation Runtime

**Files:**
- Create: `src/components/grifball/combatantAnimationV3.test.ts`
- Create: `src/components/grifball/combatantAnimationV3.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing V3 animation runtime tests**

Create `src/components/grifball/combatantAnimationV3.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { buildCombatantRigForModel } from './combatantRig';
import {
  animateV3CombatantModel,
  getFirstPersonV3WeaponPose,
  getV3BodyMaskForLayer,
} from './combatantAnimationV3';
import { createInitialGrifballThreeRefs } from './threeRefs';

const createV3Model = () => {
  const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
  buildCombatantRigForModel(model);
  return model;
};

describe('combatantAnimationV3 body masks', () => {
  it('declares separate lower-body, upper-body, and full-body masks', () => {
    assert.deepEqual(getV3BodyMaskForLayer('locomotion'), ['lowerTorso', 'leftLeg', 'rightLeg']);
    assert.deepEqual(getV3BodyMaskForLayer('weapon'), ['upperTorso', 'head', 'leftArm', 'rightArm']);
    assert.deepEqual(getV3BodyMaskForLayer('death'), [
      'lowerTorso',
      'upperTorso',
      'head',
      'leftArm',
      'rightArm',
      'leftLeg',
      'rightLeg',
    ]);
  });
});

describe('animateV3CombatantModel', () => {
  it('keeps lower-body locomotion active during hammer windup upper-body animation', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.18,
      dt: 1,
      settings: { hammerAttackAnimation: 'highFidelity' },
    });

    assert.notEqual(model.userData.upperTorso.rotation.y, 0);
    assert.notEqual(model.userData.rightArm.rotation.x, 0);
    assert.notEqual(model.userData.leftArm.rotation.x, 0);
    assert.notEqual(model.userData.leftLeg.rotation.x, 0);
    assert.notEqual(model.userData.rightLeg.rotation.x, 0);
  });

  it('pistol recoil affects upper-body groups without disturbing planted feet', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.04,
      dt: 1,
      settings: {},
    });

    assert.notEqual(model.userData.upperTorso.rotation.x, 0);
    assert.notEqual(model.userData.rightArm.rotation.x, 0);
    assert.equal(model.userData.leftLeg.rotation.x, 0);
    assert.equal(model.userData.rightLeg.rotation.x, 0);
  });

  it('resets V3 broad rig groups on death', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    model.userData.upperTorso.rotation.set(1, 1, 1);
    model.userData.leftLeg.rotation.set(1, 1, 1);

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 0,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      settings: {},
    });

    assert.deepEqual(model.userData.upperTorso.rotation.toArray().slice(0, 3), [0, 0, 0]);
    assert.deepEqual(model.userData.leftLeg.rotation.toArray().slice(0, 3), [0, 0, 0]);
  });
});

describe('getFirstPersonV3WeaponPose', () => {
  it('returns deterministic first-person poses for hammer, sword, and pistol', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const pose = getFirstPersonV3WeaponPose({
        activeWeapon: weapon,
        weaponState: weapon === 'pistol' ? 'firing' : 'ready',
        weaponTimer: 0.1,
        isLunging: weapon === 'sword',
        settings: {},
      });

      assert.equal(pose.position.length, 3);
      assert.equal(pose.rotation.length, 3);
      assert.equal(pose.position.every(Number.isFinite), true);
      assert.equal(pose.rotation.every(Number.isFinite), true);
    }
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts
```

Expected: FAIL because `combatantAnimationV3.ts` does not exist.

- [ ] **Step 3: Implement `combatantAnimationV3.ts`**

Create `src/components/grifball/combatantAnimationV3.ts` with these exports:

```ts
import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { WeaponPose } from './attackAnimationPresets';
import type { GrifballThreeRefs } from './threeRefs';

export type V3AnimationLayerName = 'locomotion' | 'weapon' | 'additive' | 'death';
export type V3BroadBodyGroupName =
  | 'lowerTorso'
  | 'upperTorso'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg';

export interface V3CombatantAnimationInput {
  refs: GrifballThreeRefs;
  mesh: THREE.Group | null | undefined;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  activeWeapon?: string;
  weaponState: string;
  weaponTimer: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
  hammerSlamWindupTime?: number;
  hammerSlamAttackTime?: number;
  settings?: Record<string, unknown>;
}

export interface V3FirstPersonWeaponPoseInput {
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  weaponState: string;
  weaponTimer: number;
  isLunging?: boolean;
  settings?: Record<string, unknown>;
}

export function getV3BodyMaskForLayer(layer: V3AnimationLayerName): readonly V3BroadBodyGroupName[];
export function animateV3CombatantModel(input: V3CombatantAnimationInput): void;
export function getFirstPersonV3WeaponPose(input: V3FirstPersonWeaponPoseInput): WeaponPose;
```

Implementation rules:

- Read V3 broad groups from `mesh.userData.lowerTorso`, `upperTorso`, `head`, `leftArm`, `rightArm`, `leftLeg`, and `rightLeg`.
- Reset all broad groups to neutral rotation and `lowerTorso.position.y = 0` when `hp <= 0`.
- Lower-body locomotion owns `lowerTorso`, `leftLeg`, and `rightLeg`.
- Upper-body weapon animation owns `upperTorso`, `head`, `leftArm`, and `rightArm`.
- Hammer `swing_up`, `swing_down`, `melee_swing`, and recovery states move upper torso and arms.
- Sword lunge/slash states move upper torso and arms without changing legs.
- Pistol `firing`, `fire`, or `shooting` states add recoil to upper torso and right arm.
- Idle/ready states should settle upper body toward neutral with a small breathing/head hint.
- Use `THREE.MathUtils.lerp` and deterministic math only. Do not use `Date.now()` in tests-sensitive output.

- [ ] **Step 4: Add the test to `npm test` and run focused tests**

Modify `package.json` so `npm test` includes:

```text
src/components/grifball/combatantAnimationV3.test.ts
```

Place it near `src/components/grifball/combatantRig.test.ts`.

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/components/grifball/combatantAnimationV3.ts src/components/grifball/combatantAnimationV3.test.ts package.json
git commit -m "feat: add v3 layered animation runtime"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: Dispatch V3 Runtime Animation

**Files:**
- Modify: `src/components/grifball/combatantAnimation.ts`
- Modify: `src/components/grifball/combatantAnimationV3.test.ts`
- Modify: `src/components/grifball/combatantRig.test.ts`

- [ ] **Step 1: Write failing dispatch regression tests**

Extend `src/components/grifball/combatantAnimationV3.test.ts`:

```ts
import { animateSpartanCombatantModel } from './combatantAnimation';

it('animateSpartanCombatantModel dispatches V3 models to the V3 layered runtime', () => {
  const model = createV3Model();
  const refs = createInitialGrifballThreeRefs();

  animateSpartanCombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(2.5, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: 'pistol',
    weaponState: 'firing',
    weaponTimer: 0.04,
    dt: 1,
    settings: {},
  });

  assert.notEqual(model.userData.upperTorso.rotation.x, 0);
  assert.notEqual(model.userData.leftLeg.rotation.x, 0);
});
```

Extend `src/components/grifball/combatantRig.test.ts` only if needed to assert the dispatch does not break V1/V2 rig assumptions.

- [ ] **Step 2: Run focused tests and confirm dispatch fails**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: FAIL because `animateSpartanCombatantModel()` does not dispatch V3 with active weapon context yet.

- [ ] **Step 3: Add V3 dispatch without breaking existing call sites**

In `src/components/grifball/combatantAnimation.ts`, import:

```ts
import { animateV3CombatantModel } from './combatantAnimationV3';
```

Widen the `animateSpartanCombatantModel` input type with optional fields:

```ts
activeWeapon?: string;
isLunging?: boolean;
settings?: Record<string, unknown>;
```

Add the V3 branch before the V2 branch:

```ts
if (mesh.userData.modelSystem === 'v3') {
  animateV3CombatantModel({
    refs,
    mesh,
    vel,
    yaw,
    hp,
    activeWeapon,
    weaponState,
    weaponTimer,
    dt,
    isSliding,
    isSprinting,
    isLunging,
    hammerSlamWindupTime,
    hammerSlamAttackTime,
    settings,
  });
  return;
}
```

Keep the V2 branch and legacy fallback intact.

- [ ] **Step 4: Pass active weapon context from current callers only where available**

Search current callers:

```powershell
Select-String -Path 'src/**/*.ts','src/**/*.tsx' -Pattern 'animateSpartanCombatantModel\\(' -Context 3,8
```

If a caller already has `activeWeapon`, `isLunging`, or settings in scope, pass them through. If a caller does not have them, do not create broad plumbing in this task; V3 should fall back to `activeWeapon ?? 'hammer'`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add src/components/grifball/combatantAnimation.ts src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/combatantRig.test.ts
git commit -m "feat: dispatch v3 layered combatant animation"
```

Expected: commit succeeds with only Task 2 files. If `combatantRig.test.ts` was not changed, do not stage it.

---

## Task 3: V3 Third-Person Weapon Pose Integration

**Files:**
- Modify: `src/components/grifball/combatantAnimationV3.ts`
- Modify: `src/components/grifball/combatantAnimationV3.test.ts`
- Modify: `src/components/grifball/combatantAnimation.ts`

- [ ] **Step 1: Add tests for V3 weapon meshes keeping socket-relative pose data**

Extend `src/components/grifball/combatantAnimationV3.test.ts`:

```ts
import { buildV3HammerModel, buildV3PistolModel, buildV3SwordModel } from '../v3/VoxelModelsV3';
import { animateCombatantWeaponMeshes } from './combatantAnimation';

it('animateCombatantWeaponMeshes applies V3 hammer poses without legacy V1/V2 offsets', () => {
  const hammer = buildV3HammerModel(192);
  const model = createV3Model();

  animateCombatantWeaponMeshes({
    hammerModel: hammer,
    swordModel: buildV3SwordModel(192),
    activeWeapon: 'hammer',
    weaponState: 'swing_up',
    weaponTimer: 0.18,
    isLunging: false,
    dt: 1,
    settings: { hammerAttackAnimation: 'highFidelity' },
    combatantModel: model,
  });

  assert.equal(hammer.visible, true);
  assert.notEqual(hammer.rotation.x, 0);
  assert.equal(hammer.userData.modelSystem, 'v3');
});

it('V3 pistol visibility is controlled by active pistol state when supplied', () => {
  const pistol = buildV3PistolModel(192);

  animateCombatantWeaponMeshes({
    hammerModel: buildV3HammerModel(192),
    swordModel: buildV3SwordModel(192),
    pistolModel: pistol,
    activeWeapon: 'pistol',
    weaponState: 'firing',
    weaponTimer: 0.04,
    isLunging: false,
    dt: 1,
    settings: {},
  });

  assert.equal(pistol.visible, true);
  assert.notEqual(pistol.position.z, 0);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts
```

Expected: FAIL because `animateCombatantWeaponMeshes()` does not accept a `pistolModel` and does not branch V3 pose logic.

- [ ] **Step 3: Add V3-aware weapon mesh pose helpers**

In `combatantAnimationV3.ts`, export:

```ts
export interface V3WeaponMeshAnimationInput {
  hammerModel?: THREE.Group | null;
  swordModel?: THREE.Group | null;
  pistolModel?: THREE.Group | null;
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  dt: number;
  settings: Record<string, unknown>;
}

export function animateV3WeaponMeshes(input: V3WeaponMeshAnimationInput): void;
```

The helper should:

- Toggle hammer, sword, and pistol visibility by `activeWeapon`.
- Apply V3 hammer windup/strike/recover rotations.
- Apply V3 sword lunge/slash/recover rotations.
- Apply V3 pistol ready/fire/recover recoil.
- Keep transforms socket-relative; do not subtract `THIRD_PERSON_RIGHT_HAND_REST_OFFSET`.

- [ ] **Step 4: Route V3 weapon meshes from `animateCombatantWeaponMeshes()`**

In `combatantAnimation.ts`, widen the function input with:

```ts
pistolModel?: THREE.Group | undefined | null;
```

Before legacy hammer/sword pose logic, detect any V3 weapon:

```ts
if (
  hammerModel?.userData.modelSystem === 'v3' ||
  swordModel?.userData.modelSystem === 'v3' ||
  pistolModel?.userData.modelSystem === 'v3'
) {
  animateV3WeaponMeshes({
    hammerModel,
    swordModel,
    pistolModel,
    activeWeapon,
    weaponState,
    weaponTimer,
    isLunging,
    dt,
    settings,
  });
  applyCombatantArmPose(...);
  return;
}
```

Keep existing V1/V2 hammer/sword logic unchanged when no V3 weapon is present.

- [ ] **Step 5: Update callers that already have a pistol model**

Search:

```powershell
Select-String -Path 'src/**/*.ts','src/**/*.tsx' -Pattern 'animateCombatantWeaponMeshes\\(' -Context 4,12
```

Where a caller has `pistol` or `playerPistol` in scope, pass it as `pistolModel`. Do not create unrelated pistol state plumbing in this task.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add src/components/grifball/combatantAnimationV3.ts src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/combatantAnimation.ts
git commit -m "feat: animate v3 weapon meshes"
```

Expected: commit succeeds with only Task 3 files and any caller files that were actually updated.

---

## Task 4: Animation Editor V3 Targets

**Files:**
- Modify: `animation-editor.html`
- Modify: `src/tools/animationEditor.ts`
- Modify: `src/tools/animationEditorCore.test.ts`

- [ ] **Step 1: Add failing editor core/export coverage if schema changes**

If the existing `AnimationEditorRigExport` schema can represent V3 bone/socket tracks without changes, do not edit `animationEditorCore.ts`. Otherwise extend `src/tools/animationEditorCore.test.ts` with a V3 export payload case before changing production code.

- [ ] **Step 2: Add V3 options to the editor HTML**

In `animation-editor.html`, add:

```html
<option value="pistol">Pistol</option>
```

to `weaponSelect`, and add:

```html
<option value="v3">Version 3 (Advanced)</option>
```

to `modelSystemSelect`.

- [ ] **Step 3: Widen editor model-system state**

In `src/tools/animationEditor.ts`, change the editor model-system type from:

```ts
modelSystem: 'v1' | 'v2';
versionedData: Record<'v1' | 'v2', VersionedAnimationData>;
```

to:

```ts
modelSystem: 'v1' | 'v2' | 'v3';
versionedData: Record<'v1' | 'v2' | 'v3', VersionedAnimationData>;
```

Initialize:

```ts
v3: createEmptyVersionedData(31),
```

- [ ] **Step 4: Add V3 preview loadout and model swapping**

Update `currentPreviewLoadout()`:

```ts
function currentPreviewLoadout(system: 'v1' | 'v2' | 'v3' = state.modelSystem) {
  if (system === 'v3') return { modelSystem: 'v3' as const };
  return system === 'v2'
    ? { modelSystem: 'v2' as const, modelType: state.modelType }
    : { modelSystem: 'v1' as const };
}
```

Update `swapModelSystem(newSystem: 'v1' | 'v2' | 'v3')` and the `modelSystemSelect` event cast to include `v3`.

- [ ] **Step 5: Add V3 target lists and linked arm seeding**

Add a V3 bone target list:

```ts
const V3_BONE_NAMES = ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
```

Use V3 targets when `state.modelSystem === 'v3'`; keep V2 targets on the existing fine-grained V2 list and V1 targets on `COMBATANT_BONE_NAMES`.

Add `seedLinkedThirdPersonArmTracksV3()` that seeds `rightArm` and `leftArm` using the existing `getThirdPersonCombatantArmPose(...)` output, matching the broad V3 group names.

- [ ] **Step 6: Add V3 pistol objects in editor preview**

Ensure third-person V3 pistol and first-person V3 pistol are selectable, visible only when `state.weapon === 'pistol'`, and included in `getWeaponObject()`.

- [ ] **Step 7: Run editor-focused tests**

Run:

```powershell
node --import tsx --test src/tools/animationEditorCore.test.ts src/components/grifball/combatantAnimationV3.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```powershell
git add animation-editor.html src/tools/animationEditor.ts src/tools/animationEditorCore.test.ts
git commit -m "feat: add v3 animation editor targets"
```

Expected: commit succeeds with only touched editor files. If `animationEditorCore.test.ts` was not needed, do not stage it.

---

## Task 5: Phase 5 Documentation And Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add a concise note near the animation editor or V3 model-system section:

```md
Phase 5 adds a V3-only layered procedural animation runtime. V3 combatants now compose lower-body locomotion with upper-body hammer, sword, and pistol action layers so attacks can animate above active movement, and the local animation editor exposes V3 model and weapon targets for refinement. V1/V2 animation paths remain selectable and unchanged.
```

- [ ] **Step 2: Run focused V3 animation/editor tests**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/combatantRig.test.ts src/tools/animationEditorCore.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run full tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```powershell
npm run build
```

Expected: PASS with only existing Vite chunk-size warnings.

- [ ] **Step 6: Check whitespace and private asset exclusion**

Run:

```powershell
git diff --check
git status --short
git diff --name-only HEAD
```

Expected: no whitespace findings; no `.obj`, `.mtl`, `.fbx`, `.blend`, texture, screenshot, or direct converted private reference asset appears.

- [ ] **Step 7: Commit documentation**

Run:

```powershell
git add README.md
git commit -m "docs: describe v3 layered animation"
```

Expected: commit succeeds with only README changes unless verification found a defect that was fixed.

---

## Phase 5 Completion Criteria

- V3 has a dedicated layered procedural animation module.
- V3 lower-body locomotion continues during upper-body hammer/sword/pistol actions.
- Pistol recoil affects upper-body groups without moving feet.
- V3 death/reset animation returns broad groups to neutral.
- `animateSpartanCombatantModel()` dispatches V3 models without changing V1/V2 behavior.
- V3 weapon meshes receive socket-relative hammer/sword/pistol poses.
- The standalone animation editor can select Version 3 and hammer/sword/pistol targets.
- Focused tests, lint, full tests, build, and whitespace checks pass.
- No private reference assets or direct conversions are committed.
