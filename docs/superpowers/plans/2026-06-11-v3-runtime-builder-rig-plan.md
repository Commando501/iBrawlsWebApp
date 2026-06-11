# V3 Runtime Builder And Rig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first live V3 runtime model and weapon builders, route V3 dispatch through existing visual-policy seams, and expose compatible rig/first-person sockets without changing V1/V2 behavior.

**Architecture:** Phase 4 consumes the original V3 manifest contracts from `src/components/v3/` and produces deterministic blockout voxel geometry that is original to iBrawls. The first runtime pass keeps broad combatant compatibility by continuing to expose `lowerTorso`, `upperTorso`, `head`, `leftArm`, `rightArm`, `leftLeg`, and `rightLeg` while adding V3 metadata and socket transforms for later animation phases. This phase does not add custom V3 editor UX, multiplayer policy UI, replay policy persistence, or authored full-body animation.

**Tech Stack:** TypeScript, Three.js, existing voxel `VoxelData`/`createVoxelGroup` helpers, Node test runner with `tsx`, Vite build.

---

## Scope And Guardrails

- Keep V1 and V2 runtime behavior unchanged.
- Keep V3 visual-only; do not change gameplay collision, attack ranges, AI, or save/network payload semantics.
- Do not commit private OBJ/MTL/FBX/Blend files, screenshots, textures, or direct reference conversions.
- V3 builder output may be original procedural blockout geometry in this phase, but must consume V3 manifest ids, bounds, budgets, LODs, and socket metadata.
- V3 character models must expose the same broad segment `userData` keys expected by `buildCombatantRigForModel()`.
- V3 weapons must include hammer, sword, and pistol from the start.
- First-person support in this phase means shared grip metadata and a V3-aware first-person weapon builder, not full V3 arms animation.

## Planned Files

- Create `src/components/v3/VoxelModelsV3.ts`: V3 character builder, weapon builders, V3 color mapping, and manifest-to-voxel blockout helpers.
- Create `src/components/v3/VoxelModelsV3.test.ts`: V3 builder tests for model metadata, required segments, manifest coverage, weapon metadata, sockets, and legacy dispatch preservation.
- Create `src/components/v3/v3GeometryCache.ts`: small geometry/material cache for V3 blockout parts and weapons.
- Create `src/components/v3/v3GeometryCache.test.ts`: cache identity/disposal tests.
- Create `src/components/grifball/combatantRigV3.ts`: V3 socket adapter helpers that map V3 socket definitions to existing broad rig attachment names.
- Create `src/components/grifball/combatantRigV3.test.ts`: V3 rig compatibility and socket transform tests.
- Modify `src/components/VoxelModels.ts`: route `modelSystem: 'v3'` to `buildVoxelSpartanModelV3()`, export V3 weapon builders where needed.
- Modify `src/components/grifball/combatantModels.ts`: use V3 hammer/sword/pistol builders for V3 loadouts while preserving legacy weapon builders otherwise.
- Modify `src/components/grifball/combatantRig.ts`: read V3 socket offsets when present and keep V1/V2 attachments unchanged.
- Modify `src/components/grifball/localPlayerViewRuntime.ts`: create local first-person V3 weapons when the local visual loadout is V3.
- Modify `src/components/grifball/combatantRig.test.ts`: add V3 broad-rig compatibility assertions without weakening existing V1/V2 tests.
- Modify `package.json`: add new V3 runtime tests to `npm test`.
- Modify `README.md`: document that Phase 4 adds first live V3 blockout builders but not full V3 animation/customization rollout.

---

## Task 1: V3 Runtime Builder Contracts

**Files:**
- Create: `src/components/v3/VoxelModelsV3.test.ts`
- Create: `src/components/v3/VoxelModelsV3.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing V3 builder tests**

Create `src/components/v3/VoxelModelsV3.test.ts` with these tests:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel } from '../VoxelModels';
import {
  buildV3PistolModel,
  buildV3SpartanModel,
  buildV3WeaponModel,
} from './VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, V3_WEAPON_IDS } from './v3ModelTypes';
import { getDefaultV3CharacterLoadout, getDefaultV3WeaponManifest } from './v3AssetManifest';

const requiredSegments = ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

describe('buildV3SpartanModel', () => {
  it('builds a V3 model with required combatant segment groups and manifest metadata', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });

    assert.equal(model.userData.modelSystem, 'v3');
    assert.equal(model.userData.v3CharacterLoadout.id, getDefaultV3CharacterLoadout().id);
    assert.deepEqual(Object.keys(model.userData.v3PartGroups).sort(), [...V3_CHARACTER_SLOT_IDS].sort());

    for (const key of requiredSegments) {
      assert.ok(model.userData[key] instanceof THREE.Group, `missing ${key}`);
    }
  });

  it('produces a visible original blockout inside normalized gameplay scale', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());

    assert.ok(size.x > 0.5 && size.x < 2.2, `unexpected width ${size.x}`);
    assert.ok(size.y > 1.2 && size.y < 2.8, `unexpected height ${size.y}`);
    assert.ok(size.z > 0.25 && size.z < 1.8, `unexpected depth ${size.z}`);
  });
});

describe('V3 weapon builders', () => {
  it('builds every V3 weapon with manifest id, weapon type, lod, and socket metadata', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const manifest = getDefaultV3WeaponManifest(weapon);

      assert.equal(model.userData.modelSystem, 'v3');
      assert.equal(model.userData.weaponType, weapon);
      assert.equal(model.userData.v3ManifestId, manifest.id);
      assert.equal(model.userData.v3Sockets.length, manifest.sockets.length);
      assert.ok(model.children.length > 0, `${weapon} should render geometry`);
    }
  });

  it('exports pistol-specific convenience builder', () => {
    assert.equal(buildV3PistolModel(192).userData.weaponType, 'pistol');
  });
});

describe('buildVoxelSpartanModel V3 dispatch', () => {
  it('preserves V1 and V2 dispatch while routing V3 separately', () => {
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v1' }).userData.modelSystem, undefined);
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v2' }).userData.modelSystem, 'v2');
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }).userData.modelSystem, 'v3');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts
```

Expected: FAIL because `src/components/v3/VoxelModelsV3.ts` does not exist.

- [ ] **Step 3: Implement V3 builder module**

Create `src/components/v3/VoxelModelsV3.ts` exporting:

```ts
export interface V3SpartanBuildOptions {
  isEnemy?: boolean;
  customHue?: number;
}

export interface V3WeaponBuildOptions {
  customHue?: number;
}

export function buildV3SpartanModel(options?: V3SpartanBuildOptions): THREE.Group;
export function buildV3WeaponModel(weapon: V3WeaponId, options?: V3WeaponBuildOptions): THREE.Group;
export function buildV3HammerModel(customHue?: number): THREE.Group;
export function buildV3SwordModel(customHue?: number): THREE.Group;
export function buildV3PistolModel(customHue?: number): THREE.Group;
```

Implementation rules:

- Import `createVoxelGroup`, `type VoxelData`, and `type SpartanColors` from `../VoxelModels`.
- Import `BUILT_IN_V3_CHARACTER_PARTS`, `getDefaultV3CharacterLoadout`, and `getDefaultV3WeaponManifest`.
- Generate original blockout voxels procedurally from V3 slots and bounds. Do not use private reference meshes.
- Use `group.userData.modelSystem = 'v3'`.
- Store `group.userData.v3CharacterLoadout`, `group.userData.v3PartGroups`, and broad segment keys.
- For weapons, store `userData.modelSystem = 'v3'`, `userData.weaponType`, `userData.v3ManifestId`, `userData.v3Sockets`, and `userData.v3SelectedLod`.
- Keep generated model height near current normalized player height.

- [ ] **Step 4: Route V3 through `buildVoxelSpartanModel()`**

Modify `src/components/VoxelModels.ts`:

```ts
import { buildV3SpartanModel } from './v3/VoxelModelsV3';
```

Then add before the V2 branch or directly after it:

```ts
if (loadout.modelSystem === 'v3') {
  return buildV3SpartanModel({ isEnemy, customHue });
}
```

Keep the existing V2 branch exactly intact and keep V1 fallback as the default.

- [ ] **Step 5: Add test to `npm test` and run focused tests**

Modify `package.json` so `npm test` includes:

```text
src/components/v3/VoxelModelsV3.test.ts
```

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts src/components/VoxelModels.ts package.json
git commit -m "feat: add v3 runtime builders"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: V3 Geometry Cache

**Files:**
- Create: `src/components/v3/v3GeometryCache.test.ts`
- Create: `src/components/v3/v3GeometryCache.ts`
- Modify: `src/components/v3/VoxelModelsV3.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing cache tests**

Create `src/components/v3/v3GeometryCache.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  clearV3GeometryCache,
  getV3CachedMaterial,
  getV3GeometryCacheStats,
} from './v3GeometryCache';

describe('v3GeometryCache', () => {
  it('reuses materials for identical color and emissive keys', () => {
    clearV3GeometryCache();
    const a = getV3CachedMaterial('#ff0000', false);
    const b = getV3CachedMaterial('#ff0000', false);
    const c = getV3CachedMaterial('#ff0000', true);

    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.deepEqual(getV3GeometryCacheStats(), { materials: 2 });
  });

  it('clears and disposes cached materials', () => {
    clearV3GeometryCache();
    const material = getV3CachedMaterial('#00ff00', false);
    let disposed = false;
    material.addEventListener('dispose', () => {
      disposed = true;
    });

    clearV3GeometryCache();

    assert.equal(disposed, true);
    assert.deepEqual(getV3GeometryCacheStats(), { materials: 0 });
  });
});
```

- [ ] **Step 2: Run the cache test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/v3GeometryCache.test.ts
```

Expected: FAIL because `v3GeometryCache.ts` does not exist.

- [ ] **Step 3: Implement cache helpers**

Create `src/components/v3/v3GeometryCache.ts`:

```ts
import * as THREE from 'three';

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function getV3CachedMaterial(color: string, emissive = false): THREE.MeshStandardMaterial {
  const key = `${color}:${emissive ? '1' : '0'}`;
  const existing = materialCache.get(key);
  if (existing) return existing;

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.28,
    emissive: emissive ? new THREE.Color(color) : new THREE.Color('#000000'),
    emissiveIntensity: emissive ? 0.55 : 0,
  });
  materialCache.set(key, material);
  return material;
}

export function getV3GeometryCacheStats(): { materials: number } {
  return { materials: materialCache.size };
}

export function clearV3GeometryCache(): void {
  for (const material of materialCache.values()) {
    material.dispose();
  }
  materialCache.clear();
}
```

- [ ] **Step 4: Wire V3 builder materials through cache if practical**

If `createVoxelGroup` cannot accept material instances without broad refactor, keep this cache as a Phase 4 support contract and do not force it into `createVoxelGroup`. If a helper in `VoxelModelsV3.ts` creates direct `THREE.Mesh` instances, use `getV3CachedMaterial()` there.

- [ ] **Step 5: Add test to `npm test` and run focused tests**

Add `src/components/v3/v3GeometryCache.test.ts` near other V3 tests in `package.json`.

Run:

```powershell
node --import tsx --test src/components/v3/v3GeometryCache.test.ts src/components/v3/VoxelModelsV3.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add src/components/v3/v3GeometryCache.ts src/components/v3/v3GeometryCache.test.ts src/components/v3/VoxelModelsV3.ts package.json
git commit -m "feat: add v3 geometry cache"
```

Expected: commit succeeds with only Task 2 files. If `VoxelModelsV3.ts` did not need cache edits, do not stage it.

---

## Task 3: V3 Third-Person Weapon Routing

**Files:**
- Modify: `src/components/grifball/combatantModels.ts`
- Modify: `src/components/v3/VoxelModelsV3.test.ts`
- Modify: `src/components/grifball/combatantRig.test.ts`

- [ ] **Step 1: Add tests for V3 combatant weapon builders**

Extend `src/components/v3/VoxelModelsV3.test.ts`:

```ts
import { createCombatantMeshRig } from '../grifball/combatantModels';

it('createCombatantMeshRig uses V3 weapon builders for V3 loadouts', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });

  assert.equal(meshes.group.userData.modelSystem, 'v3');
  assert.equal(meshes.hammer.userData.modelSystem, 'v3');
  assert.equal(meshes.sword.userData.modelSystem, 'v3');
  assert.equal(meshes.pistol.userData.modelSystem, 'v3');
  assert.equal(meshes.hammer.userData.weaponType, 'hammer');
  assert.equal(meshes.sword.userData.weaponType, 'sword');
  assert.equal(meshes.pistol.userData.weaponType, 'pistol');
});
```

Extend `src/components/grifball/combatantRig.test.ts`:

```ts
test('V3 combatant weapons attach to the third-person grip without changing legacy sockets', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });
  const grip = meshes.rig.attachments.thirdPersonWeaponGrip;

  assert.ok(grip);
  assert.equal(meshes.hammer.parent, grip.group);
  assert.equal(meshes.sword.parent, grip.group);
  assert.equal(meshes.pistol.parent, grip.group);
  assert.equal(meshes.hammer.userData.weaponType, 'hammer');
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: FAIL because `combatantModels.ts` still uses legacy weapon builders.

- [ ] **Step 3: Route V3 weapons in `combatantModels.ts`**

Import V3 builders:

```ts
import { buildV3HammerModel, buildV3PistolModel, buildV3SwordModel } from '../v3/VoxelModelsV3';
```

Add small helpers:

```ts
const isV3Loadout = (loadout?: CharacterLoadout): boolean => loadout?.modelSystem === 'v3';

const buildCombatantHammer = (hue: number | undefined, loadout?: CharacterLoadout): THREE.Group =>
  isV3Loadout(loadout) ? buildV3HammerModel(hue) : buildGravityHammerModel(hue, loadout?.hammerPreset);

const buildCombatantSword = (hue: number | undefined, loadout?: CharacterLoadout): THREE.Group =>
  isV3Loadout(loadout) ? buildV3SwordModel(hue) : buildKatarSwordModel(hue, loadout?.swordPreset);

const buildCombatantPistol = (hue: number | undefined, loadout?: CharacterLoadout): THREE.Group =>
  isV3Loadout(loadout) ? buildV3PistolModel(hue) : buildPistolModel(hue);
```

Use those helpers in `createCombatantMeshRig()` and `rebuildDualWeaponCombatantModel()`. Keep legacy `positionHammer`, `positionSword`, and `positionPistol` for V1/V2, but skip those hard-coded legacy transforms for V3 weapons if the V3 builder already uses manifest socket orientation.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantRig.test.ts src/components/grifball/combatantModelRebuild.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add src/components/grifball/combatantModels.ts src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantRig.test.ts
git commit -m "feat: route v3 combatant weapons"
```

Expected: commit succeeds with only Task 3 files.

---

## Task 4: V3 Rig Socket Adapter

**Files:**
- Create: `src/components/grifball/combatantRigV3.test.ts`
- Create: `src/components/grifball/combatantRigV3.ts`
- Modify: `src/components/grifball/combatantRig.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing V3 rig socket adapter tests**

Create `src/components/grifball/combatantRigV3.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { buildCombatantRigForModel } from './combatantRig';
import {
  getV3AttachmentOffset,
  mapV3SocketNameToCombatantAttachment,
} from './combatantRigV3';

describe('combatantRigV3', () => {
  it('maps manifest socket names onto existing combatant attachments', () => {
    assert.equal(mapV3SocketNameToCombatantAttachment('thirdPersonPrimaryGrip'), 'thirdPersonWeaponGrip');
    assert.equal(mapV3SocketNameToCombatantAttachment('thirdPersonOffhandGrip'), 'thirdPersonOffhandGrip');
    assert.equal(mapV3SocketNameToCombatantAttachment('firstPersonPrimaryGrip'), 'firstPersonWeaponGrip');
    assert.equal(mapV3SocketNameToCombatantAttachment('firstPersonOffhandGrip'), 'firstPersonOffhandGrip');
  });

  it('builds broad compatibility rig attachments from V3 hand groups', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const rig = buildCombatantRigForModel(model);

    assert.equal(rig.attachments.thirdPersonWeaponGrip?.group.parent, model.userData.handRight);
    assert.equal(rig.attachments.thirdPersonOffhandGrip?.group.parent, model.userData.handLeft);
    assert.ok(getV3AttachmentOffset(model, 'thirdPersonWeaponGrip'));
  });
});
```

- [ ] **Step 2: Run the rig adapter test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantRigV3.test.ts
```

Expected: FAIL because `combatantRigV3.ts` does not exist and `combatantRig.ts` has no V3 offset support.

- [ ] **Step 3: Implement `combatantRigV3.ts`**

Create helper exports:

```ts
import type { V3SocketDefinition, V3SocketName } from '../v3/v3ModelTypes';
import type { CombatantAttachmentPointName } from './combatantRig';

export function mapV3SocketNameToCombatantAttachment(name: V3SocketName): CombatantAttachmentPointName | undefined;
export function getV3AttachmentOffset(model: THREE.Group, attachment: CombatantAttachmentPointName): THREE.Vector3Tuple | undefined;
export function getV3AttachmentRotation(model: THREE.Group, attachment: CombatantAttachmentPointName): THREE.Vector3Tuple | undefined;
```

Use `model.userData.v3CharacterSockets` or `model.userData.v3WeaponSockets` if present. For this phase, character hand groups may expose default grip offsets directly on `model.userData.v3AttachmentOffsets`.

- [ ] **Step 4: Modify `combatantRig.ts` to read V3 hand groups and offsets**

In `buildCombatantRigForModel()`:

- Treat `model.userData.modelSystem === 'v3'` separately from V2.
- Use `model.userData.handRight || bones.rightArm` and `model.userData.handLeft || bones.leftArm` as V3 weapon bones.
- Use `getV3AttachmentOffset(model, 'thirdPersonWeaponGrip')` and `getV3AttachmentOffset(model, 'thirdPersonOffhandGrip')` before falling back to existing V1 offsets.
- Keep V2 profile offsets unchanged.

- [ ] **Step 5: Add the test to `npm test` and run focused rig tests**

Add `src/components/grifball/combatantRigV3.test.ts` near `combatantRig.test.ts` in `package.json`.

Run:

```powershell
node --import tsx --test src/components/grifball/combatantRigV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add src/components/grifball/combatantRigV3.ts src/components/grifball/combatantRigV3.test.ts src/components/grifball/combatantRig.ts package.json
git commit -m "feat: add v3 combatant rig sockets"
```

Expected: commit succeeds with only Task 4 files.

---

## Task 5: First-Person V3 Weapon Support

**Files:**
- Modify: `src/components/grifball/localPlayerViewRuntime.ts`
- Modify: `src/components/grifball/combatantRigV3.test.ts`
- Modify: `src/components/v3/VoxelModelsV3.test.ts`

- [ ] **Step 1: Inspect current local first-person weapon creation**

Run:

```powershell
Select-String -LiteralPath 'src/components/grifball/localPlayerViewRuntime.ts' -Pattern 'createFirstPersonWeaponRig|buildGravityHammerModel|buildKatarSwordModel|buildPistolModel|firstPersonWeaponGrip' -Context 4,12
```

Expected: shows local weapon builders and hard-coded transforms.

- [ ] **Step 2: Add tests for first-person V3 socket metadata**

Extend `src/components/v3/VoxelModelsV3.test.ts`:

```ts
it('V3 weapon manifests include first-person socket metadata on built weapons', () => {
  for (const weapon of V3_WEAPON_IDS) {
    const model = buildV3WeaponModel(weapon, { customHue: 192 });
    const socketNames = model.userData.v3Sockets.map((socket: { name: string }) => socket.name);

    assert.ok(socketNames.includes('firstPersonPrimaryGrip'), `${weapon} missing first-person primary grip`);
    assert.ok(socketNames.includes('firstPersonOffhandGrip'), `${weapon} missing first-person offhand grip`);
  }
});
```

- [ ] **Step 3: Add V3-aware local weapon builder helper**

In `localPlayerViewRuntime.ts`, add a helper that chooses V3 weapon builders when the local resolved visual loadout is V3:

```ts
const buildLocalFirstPersonWeaponSet = (hue: number | undefined, loadout?: CharacterLoadout) => ({
  hammer: loadout?.modelSystem === 'v3' ? buildV3HammerModel(hue) : buildGravityHammerModel(hue, loadout?.hammerPreset),
  sword: loadout?.modelSystem === 'v3' ? buildV3SwordModel(hue) : buildKatarSwordModel(hue, loadout?.swordPreset),
  pistol: loadout?.modelSystem === 'v3' ? buildV3PistolModel(hue) : buildPistolModel(hue),
});
```

Only wire this through an existing loadout parameter if the runtime already has access to the local visual loadout. If not, expose and test the helper without changing the mount path in this task; broad local-view policy wiring belongs with the user-facing policy phase.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantRigV3.test.ts src/components/grifball/combatantRig.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add src/components/grifball/localPlayerViewRuntime.ts src/components/grifball/combatantRigV3.test.ts src/components/v3/VoxelModelsV3.test.ts
git commit -m "feat: add v3 first-person weapon support"
```

Expected: commit succeeds with only Task 5 files. If `localPlayerViewRuntime.ts` could not be safely wired in this phase, commit only the tested V3 first-person socket support and note the runtime mount handoff in README.

---

## Task 6: Documentation And Phase 4 Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add a short note near the V3 Offline Asset Tooling or Spartan Armor section:

```md
Phase 4 adds original runtime V3 blockout builders for the default modular character and V3 hammer/sword/pistol weapons. These builders route `modelSystem: 'v3'` through the live model factory and expose broad rig-compatible segments plus V3 socket metadata, but full layered V3 animation, V3 custom armor editing, replay policy rollout, and V3-by-default matchmaking remain later phases.
```

- [ ] **Step 2: Run focused V3 runtime tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/v3/v3GeometryCache.test.ts src/components/grifball/combatantRigV3.test.ts src/components/grifball/combatantRig.test.ts src/components/grifball/combatantModelRebuild.test.ts
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

Expected: PASS with only existing Vite chunk-size warnings. If sandboxed build resolves through the conflicted parent checkout, rerun with escalation and document the sandbox artifact.

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
git commit -m "docs: describe v3 runtime builders"
```

Expected: commit succeeds with only README changes unless verification found a defect that was fixed.

---

## Phase 4 Completion Criteria

- `buildVoxelSpartanModel(..., { modelSystem: 'v3' })` returns a V3 model and V1/V2 dispatch remains covered.
- V3 model exposes broad combatant segment keys expected by `buildCombatantRigForModel()`.
- V3 default manifest parts are represented by runtime part groups.
- V3 hammer, sword, and pistol builders exist and carry manifest, LOD, socket, and weapon metadata.
- Third-person combatant construction uses V3 weapon builders for V3 loadouts.
- First-person V3 weapon support has at least manifest socket coverage and a safe builder handoff.
- Focused tests, lint, full tests, build, and whitespace checks pass.
- No private source assets or direct conversions are committed.
