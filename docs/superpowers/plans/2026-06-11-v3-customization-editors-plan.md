# V3 Customization And Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add V3 modular armor selection, paint-role aware custom armor pieces, and V3 armor-editor support while preserving V1/V2 customization and keeping V3 visual-only.

**Architecture:** Phase 6 extends the existing local custom armor catalog instead of creating a server-backed asset path. V3 custom pieces are saved as bounded voxel payloads keyed by V3 character slots, validated against V3 fit bounds and budgets, and consumed only by V3 model builders. V1/V2 loadouts, V2 medium/large constraints, gameplay collision, hitboxes, and network policy semantics remain unchanged.

**Tech Stack:** TypeScript, React, Three.js, existing `customArmor` catalog/localStorage, V3 manifests and fit bounds, Node test runner with `tsx`, Vite build.

---

## Scope And Guardrails

- Preserve V1 and V2 user choices. Existing V2 custom armor pieces must continue to validate, save, equip, and render exactly as before.
- V3 custom armor is visual-only. Do not alter `characterModelTypes`, gameplay collision, target hitboxes, attack ranges, AI, replay timing, or weapon timing.
- End users only edit voxel armor in-game/local UI. Do not add OBJ/FBX/Blend upload, network upload, or arbitrary mesh import to runtime UI.
- Developer-only mesh tooling from earlier phases remains offline and repo-local.
- Do not commit private reference assets, textures, generated conversions, screenshots, `.obj`, `.mtl`, `.fbx`, or `.blend` files.
- Use V3 manifest part ids, V3 fit bounds, V3 paint roles, and V3 budget metadata as the authoritative constraints.
- README has a stale reference to `CustomizationPanel.tsx`; the live customization UI is `src/components/main-menu/ArmoryPanel.tsx`.
- Phase 5 already added V3 animation-editor targets, so this phase does not redo `animation-editor.html` or `src/tools/animationEditor.ts` unless a V3 custom armor editor change truly requires it.

## Planned Files

- Modify `src/components/customArmor.ts`: add model-system aware custom armor pieces, V3 slot support, V3 role sanitation, V3 bounds/budget validation, and V3 network sanitation.
- Modify `src/components/customArmor.test.ts`: add V3 custom armor validation, catalog normalization, network sanitizer, and V2 regression coverage.
- Modify `src/components/VoxelModels.ts`: widen `CharacterLoadout.customArmor` keys to support V3 slots and pass V3 loadout data into the V3 builder.
- Modify `src/components/v3/VoxelModelsV3.ts`: consume V3 custom armor pieces and expose reusable V3 built-in part voxel snapshots for the editor.
- Modify `src/components/v3/VoxelModelsV3.test.ts`: prove V3 custom pieces override built-in V3 parts while V1/V2 dispatch remains unchanged.
- Modify `src/components/previewModelUtils.ts`: include V3 slot custom armor signatures without serializing voxel arrays.
- Modify `src/components/main-menu/useCustomizationState.ts`: normalize loaded player loadout and catalog data before using it in the UI.
- Modify `src/components/main-menu/useCustomizationState.test.ts`: add V3 loadout normalization coverage.
- Modify `src/components/main-menu/ArmoryPanel.tsx`: add Version 3 selection, V3 modular part tiles, V3 custom piece filtering/equip behavior, and V3 editor entry text.
- Modify `src/components/main-menu/ArmorModelEditor.tsx`: add a V3 editor mode with V3 slots, roles, bounds, built-in clone source, save/equip, and V3 rig preview.
- Modify `src/armorModelEditorPage.tsx`: preserve the active loadout model system instead of forcing V2, and update standalone copy/counts for V2/V3.
- Modify `README.md`: document Phase 6 V3 customization/editor support and correct stale customization-panel path language if touched nearby.

---

## Task 1: V3 Custom Armor Contracts

**Files:**
- Modify: `src/components/customArmor.test.ts`
- Modify: `src/components/customArmor.ts`
- Modify: `src/components/VoxelModels.ts`

- [ ] **Step 1: Write failing V3 custom armor tests**

Add these imports to `src/components/customArmor.test.ts`:

```ts
import { V3_CHARACTER_SLOT_IDS } from './v3/v3ModelTypes';
import { getV3CharacterPartBounds } from './v3/v3PartBounds';
```

Add tests:

```ts
test('V3 custom armor pieces validate against V3 slot bounds and budgets', () => {
  const helmetBounds = getV3CharacterPartBounds('helmet');
  const validVoxels: CustomArmorVoxel[] = Array.from({ length: 130 }, (_, index) => ({
    x: index % helmetBounds.maxDimensions.x,
    y: Math.floor(index / helmetBounds.maxDimensions.x) % helmetBounds.maxDimensions.y,
    z: Math.floor(index / (helmetBounds.maxDimensions.x * helmetBounds.maxDimensions.y)) % helmetBounds.maxDimensions.z,
    role: index % 7 === 0 ? 'visor' : index % 5 === 0 ? 'secondary' : 'primary',
    emissive: index % 7 === 0,
  }));
  const piece = createCustomArmorPiece('helmet', 'V3 Helmet', validVoxels, 'ibv3-aegis-helmet', undefined, 'v3');

  const result = validateCustomArmorPiece(piece);

  assert.equal(piece.modelSystem, 'v3');
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.stats.v3Slot, 'helmet');
});

test('V3 custom armor rejects voxels outside the V3 local fit bounds', () => {
  const piece = createCustomArmorPiece('helmet', 'Oversized V3 Helmet', [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 99, y: 0, z: 0, role: 'primary' },
  ], undefined, undefined, 'v3');

  const result = validateCustomArmorPiece(piece);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('outside the V3 helmet bounds')));
});

test('V3 custom armor catalog normalization keeps V3 slots without breaking V2 pieces', () => {
  const v2Piece = cloneBuiltInPiece('arm', 'mark-vi', 'leftArm');
  const v3Piece = createCustomArmorPiece('forearmRight', 'V3 Bracer', [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'accent' },
    { x: 0, y: 1, z: 0, role: 'secondary' },
  ], 'ibv3-aegis-forearmRight', undefined, 'v3');
  const catalog = normalizeCustomArmorCatalog({ version: 1, pieces: [v2Piece, v3Piece] });

  assert.equal(catalog.pieces.find((piece) => piece.id === v2Piece.id)?.modelSystem ?? 'v2', 'v2');
  assert.equal(catalog.pieces.find((piece) => piece.id === v3Piece.id)?.modelSystem, 'v3');
});

test('sanitizeCharacterLoadoutForNetwork keeps valid V3 custom armor and strips mesh import data', () => {
  const piece = createCustomArmorPiece('chest', 'V3 Chest', Array.from({ length: 260 }, (_, index) => ({
    x: index % 12,
    y: Math.floor(index / 12) % 12,
    z: Math.floor(index / 144),
    role: 'primary' as const,
  })), 'ibv3-aegis-chest', undefined, 'v3');
  const snapshot = createCustomArmorSnapshot(piece);
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v3',
    customArmor: { chest: snapshot },
    meshImportPath: 'C:/private/reference.obj',
    rawMesh: { vertices: [0, 1, 2] },
  }) as any;

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.customArmor.chest.modelSystem, 'v3');
  assert.equal(loadout.meshImportPath, undefined);
  assert.equal(loadout.rawMesh, undefined);
});

test('V3 custom armor slot ids remain aligned with V3 manifest slots', () => {
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const piece = createCustomArmorPiece(slot, `${slot} draft`, [], undefined, undefined, 'v3');
    assert.equal(piece.slot, slot);
    assert.equal(piece.modelSystem, 'v3');
  }
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/customArmor.test.ts
```

Expected: FAIL because `createCustomArmorPiece()` does not accept V3 model-system pieces and `CustomArmorSlot` does not include V3-only slots.

- [ ] **Step 3: Extend custom armor types without changing V2 defaults**

In `src/components/customArmor.ts`, import V3 contracts:

```ts
import {
  V3_CHARACTER_SLOT_IDS,
  V3_PAINT_ROLES,
  type V3CharacterSlotId,
  type V3PaintRole,
} from './v3/v3ModelTypes';
import {
  getDefaultV3CharacterLoadout,
  getV3CharacterPartManifest,
} from './v3/v3AssetManifest';
import { getV3CharacterPartBounds } from './v3/v3PartBounds';
import type { ModelSystem } from '../model/modelSystem';
```

Change the slot and role types:

```ts
export type V2CustomArmorSlot = 'helmet' | 'torso' | 'arm' | 'leg';
export type V3CustomArmorSlot = V3CharacterSlotId;
export type CustomArmorSlot = V2CustomArmorSlot | V3CustomArmorSlot;
export type CustomArmorModelSystem = Extract<ModelSystem, 'v2' | 'v3'>;
export type CustomArmorMaterialRole =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'visor'
  | 'dark'
  | 'highlight'
  | 'undersuit'
  | 'emissive'
  | 'decal'
  | 'fixed';
```

Add `modelSystem` and V3 stats fields:

```ts
export interface CustomArmorPieceSnapshot {
  version: 1;
  id: string;
  name: string;
  slot: CustomArmorSlot;
  modelSystem?: CustomArmorModelSystem;
  modelType?: CharacterModelType;
  sourcePreset?: string;
  voxels: CustomArmorVoxel[];
  thumbnail?: string;
  updatedAt: number;
}
```

Extend validation stats:

```ts
stats: {
  voxelCount: number;
  payloadBytes: number;
  components: number;
  bounds?: CustomArmorBounds;
  subpartCounts: Record<string, number>;
  anchorCluster: boolean;
  modelSystem: CustomArmorModelSystem;
  v3Slot?: V3CharacterSlotId;
};
```

Add constants:

```ts
export const V2_CUSTOM_ARMOR_SLOTS = ['helmet', 'torso', 'arm', 'leg'] as const;
export const V3_CUSTOM_ARMOR_SLOTS = V3_CHARACTER_SLOT_IDS;
const V2_SLOT_SET = new Set<CustomArmorSlot>(V2_CUSTOM_ARMOR_SLOTS);
const V3_SLOT_SET = new Set<CustomArmorSlot>(V3_CUSTOM_ARMOR_SLOTS);
const ROLE_SET = new Set<CustomArmorMaterialRole>([
  'primary',
  'secondary',
  'accent',
  'visor',
  'dark',
  'highlight',
  'undersuit',
  'emissive',
  'decal',
  'fixed',
]);
```

Add an internal V3 manifest lookup:

```ts
function getDefaultV3CharacterPartManifestForSlot(slot: V3CharacterSlotId) {
  const manifestId = getDefaultV3CharacterLoadout().partIds[slot];
  const manifest = getV3CharacterPartManifest(manifestId);
  if (!manifest) {
    throw new Error(`Missing default V3 character part manifest for ${slot}`);
  }
  return manifest;
}
```

- [ ] **Step 4: Add model-system aware creation and normalization**

Update `createCustomArmorId`:

```ts
export function createCustomArmorId(slot: CustomArmorSlot, modelSystem: CustomArmorModelSystem = 'v2'): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `custom_${modelSystem}_${slot}_${Date.now().toString(36)}_${suffix}`;
}
```

Update `createCustomArmorPiece` signature:

```ts
export function createCustomArmorPiece(
  slot: CustomArmorSlot,
  name: string,
  voxels: CustomArmorVoxel[] = [],
  sourcePreset?: string,
  modelType: CharacterModelType | undefined = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2'
): CustomArmorPiece {
  const now = Date.now();
  const resolvedModelSystem: CustomArmorModelSystem = modelSystem === 'v3' ? 'v3' : 'v2';
  const resolvedModelType = resolvedModelSystem === 'v2'
    ? resolveCharacterModelType(modelType, 'v2')
    : undefined;
  const fallbackLabel = getCustomArmorSlotLabel(slot, resolvedModelSystem, resolvedModelType);
  return {
    version: 1,
    id: createCustomArmorId(slot, resolvedModelSystem),
    name: sanitizePieceName(name, fallbackLabel),
    slot,
    modelSystem: resolvedModelSystem,
    modelType: resolvedModelType,
    sourcePreset,
    voxels: dedupeCustomArmorVoxels(voxels),
    thumbnail: createCustomArmorThumbnail(slot, voxels.length, resolvedModelSystem),
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}
```

Add helper labels:

```ts
export function getCustomArmorPieceModelSystem(piece: Pick<CustomArmorPieceSnapshot, 'modelSystem'>): CustomArmorModelSystem {
  return piece.modelSystem === 'v3' ? 'v3' : 'v2';
}

export function getCustomArmorSlotLabel(
  slot: CustomArmorSlot,
  modelSystem: CustomArmorModelSystem = 'v2',
  modelType: CharacterModelType = 'medium'
): string {
  if (modelSystem === 'v3' && V3_SLOT_SET.has(slot)) {
    return getDefaultV3CharacterPartManifestForSlot(slot as V3CharacterSlotId).label;
  }
  return getCustomArmorSlotSpec(slot as V2CustomArmorSlot, modelType).label;
}
```

Update `createCustomArmorSnapshot()` so it preserves `modelSystem` and only stores `modelType` on V2:

```ts
const modelSystem = getCustomArmorPieceModelSystem(piece);
return {
  version: 1,
  id: piece.id,
  name: piece.name,
  slot: piece.slot,
  modelSystem,
  modelType: modelSystem === 'v2' ? resolveCharacterModelType(piece.modelType, 'v2') : undefined,
  sourcePreset: piece.sourcePreset,
  voxels: piece.voxels.map(cloneVoxel),
  thumbnail: piece.thumbnail,
  updatedAt: piece.updatedAt,
};
```

- [ ] **Step 5: Add V3 voxel bounds normalization**

Update `isVoxelInSlotBounds()` and `clampVoxelToSlot()` to branch on model system:

```ts
export function isVoxelInSlotBounds(
  slot: CustomArmorSlot,
  voxel: { x: number; y: number; z: number },
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2'
): boolean {
  if (modelSystem === 'v3') {
    if (!V3_SLOT_SET.has(slot)) return false;
    const b = getV3CharacterPartBounds(slot as V3CharacterSlotId).maxDimensions;
    return voxel.x >= 0 && voxel.x < b.x && voxel.y >= 0 && voxel.y < b.y && voxel.z >= 0 && voxel.z < b.z;
  }
  const b = getCustomArmorSlotSpec(slot as V2CustomArmorSlot, modelType).bounds;
  return voxel.x >= b.minX && voxel.x <= b.maxX
    && voxel.y >= b.minY && voxel.y <= b.maxY
    && voxel.z >= b.minZ && voxel.z <= b.maxZ;
}
```

Use the same model-system branch in `normalizeCustomArmorVoxel()`, `normalizeCustomArmorPiece()`, `validateCustomArmorPiece()`, `centerCustomArmorPiece()`, `seedCornerAnchor()`, and `fitCustomArmorToBounds()`. For V3 pieces:

```ts
const modelSystem = raw.modelSystem === 'v3' ? 'v3' : 'v2';
if (modelSystem === 'v3' && !V3_SLOT_SET.has(slot)) return null;
if (modelSystem === 'v2' && !V2_SLOT_SET.has(slot)) return null;
```

- [ ] **Step 6: Add V3 validation branch**

In `validateCustomArmorPiece()`, branch before the V2 subpart checks:

```ts
if (modelSystem === 'v3') {
  const v3Slot = normalized.slot as V3CharacterSlotId;
  const manifest = getDefaultV3CharacterPartManifestForSlot(v3Slot);
  const fit = getV3CharacterPartBounds(v3Slot);
  const maxVoxels = manifest.budget.sourceVoxelCount;
  const minVoxels = Math.max(3, Math.min(120, Math.floor(maxVoxels * 0.08)));

  if (voxels.length < minVoxels) {
    errors.push(`${manifest.label} needs at least ${minVoxels} voxels; current piece has ${voxels.length}.`);
  }
  if (voxels.length > maxVoxels) {
    errors.push(`${manifest.label} exceeds the ${maxVoxels} voxel budget.`);
  }
  for (const voxel of voxels) {
    if (!isVoxelInSlotBounds(v3Slot, voxel, 'medium', 'v3')) {
      errors.push(`${manifest.label} voxel ${coordKey(voxel)} is outside the V3 ${v3Slot} bounds.`);
      break;
    }
  }
  if (payloadBytes > CUSTOM_ARMOR_MAX_SELECTED_BYTES) {
    errors.push(`Selected piece payload is ${payloadBytes} bytes; max is ${CUSTOM_ARMOR_MAX_SELECTED_BYTES}.`);
  }
  const components = countConnectedComponents(voxels);
  if (components > 1) warnings.push(`${components} disconnected voxel islands detected; remove floating voxels before publishing.`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      voxelCount: voxels.length,
      payloadBytes,
      components,
      bounds,
      subpartCounts: {},
      anchorCluster: true,
      modelSystem,
      v3Slot,
    },
  };
}
```

Keep the existing V2 validation branch below this block.

- [ ] **Step 7: Update selected custom armor sanitation**

Change `sanitizeSelectedCustomArmor()` to accept model system:

```ts
export function sanitizeSelectedCustomArmor(
  value: unknown,
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2'
): Partial<Record<CustomArmorSlot, CustomArmorPieceSnapshot>> | undefined
```

Iterate `modelSystem === 'v3' ? V3_CUSTOM_ARMOR_SLOTS : V2_CUSTOM_ARMOR_SLOTS`, require `snapshot.modelSystem` to match, and validate through `validateCustomArmorPiece()`.

In `sanitizeCharacterLoadoutForNetwork()`:

```ts
const loadoutModelSystem = out.modelSystem === 'v3' ? 'v3' : 'v2';
const customArmor = sanitizeSelectedCustomArmor(raw.customArmor, modelType, loadoutModelSystem);
```

- [ ] **Step 8: Widen `CharacterLoadout.customArmor` keys**

In `src/components/VoxelModels.ts`, keep the existing import name but rely on the widened `CustomArmorSlot`:

```ts
customArmor?: Partial<Record<CustomArmorSlot, CustomArmorPieceSnapshot>>;
```

No V1/V2 builder logic changes happen in this task.

- [ ] **Step 9: Run focused contract tests**

Run:

```powershell
node --import tsx --test src/components/customArmor.test.ts src/components/v3/v3PartBounds.test.ts src/components/v3/v3AssetManifest.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

Run:

```powershell
git add src/components/customArmor.ts src/components/customArmor.test.ts src/components/VoxelModels.ts
git commit -m "feat: add v3 custom armor contracts"
```

Expected: commit includes only Task 1 files.

---

## Task 2: V3 Builder Custom Part Rendering

**Files:**
- Modify: `src/components/v3/VoxelModelsV3.test.ts`
- Modify: `src/components/v3/VoxelModelsV3.ts`
- Modify: `src/components/VoxelModels.ts`
- Modify: `src/components/previewModelUtils.ts`

- [ ] **Step 1: Write failing V3 builder tests**

Add imports to `src/components/v3/VoxelModelsV3.test.ts`:

```ts
import { createCustomArmorPiece, createCustomArmorSnapshot } from '../customArmor';
```

Add tests:

```ts
it('builds V3 custom armor pieces in place of matching built-in V3 parts', () => {
  const customHelmet = createCustomArmorSnapshot(createCustomArmorPiece('helmet', 'Test V3 Helmet', Array.from({ length: 130 }, (_, index) => ({
    x: index % 8,
    y: Math.floor(index / 8) % 8,
    z: Math.floor(index / 64),
    role: index % 11 === 0 ? 'visor' : 'primary',
    emissive: index % 11 === 0,
  })), 'ibv3-aegis-helmet', undefined, 'v3'));

  const model = buildV3SpartanModel({
    isEnemy: false,
    customHue: 192,
    loadout: { modelSystem: 'v3', customArmor: { helmet: customHelmet } },
  });
  const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

  assert.equal(helmet.userData.customArmorId, customHelmet.id);
  assert.equal(helmet.userData.v3Slot, 'helmet');
});

it('ignores V2 custom armor snapshots when building a V3 model', () => {
  const v2Helmet = createCustomArmorSnapshot(createCustomArmorPiece('helmet', 'V2 Helmet', Array.from({ length: 130 }, (_, index) => ({
    x: index % 4,
    y: 35 + Math.floor(index / 4) % 8,
    z: Math.floor(index / 32),
    role: 'primary' as const,
  })));

  const model = buildV3SpartanModel({
    isEnemy: false,
    customHue: 192,
    loadout: { modelSystem: 'v3', customArmor: { helmet: v2Helmet } },
  });
  const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

  assert.equal(helmet.userData.customArmorId, undefined);
  assert.equal(helmet.userData.v3PartId, 'ibv3-aegis-helmet');
});
```

Add a preview signature test to `src/components/customArmor.test.ts` or a new focused block in an existing preview test:

```ts
test('shared preview loadout signature tracks V3 custom armor without serializing voxels', async () => {
  const { getPreviewLoadoutSignature } = await import('./previewModelUtils');
  const voxels = Array.from({ length: 1_000 }, (_, index) => ({ x: index % 10, y: Math.floor(index / 10) % 10, z: Math.floor(index / 100), role: 'primary' as const }));
  const signature = getPreviewLoadoutSignature({
    modelSystem: 'v3',
    customArmor: {
      forearmRight: {
        version: 1,
        id: 'v3-forearm',
        name: 'V3 Forearm',
        slot: 'forearmRight',
        modelSystem: 'v3',
        voxels,
        updatedAt: 200,
      },
    },
  });

  assert.ok(signature.includes('forearmRight:v3-forearm'));
  assert.equal(signature.includes('"voxels"'), false);
  assert.equal(signature.includes('999'), false);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/customArmor.test.ts
```

Expected: FAIL because `buildV3SpartanModel()` does not accept loadout custom armor and preview signatures only inspect V2 slots.

- [ ] **Step 3: Accept loadout in V3 builder options**

In `src/components/v3/VoxelModelsV3.ts`, import:

```ts
import type { CharacterLoadout } from '../VoxelModels';
import {
  customArmorPieceToVoxels,
  getCustomArmorPieceModelSystem,
  validateCustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type CustomArmorColors,
} from '../customArmor';
```

Update options:

```ts
export interface V3SpartanBuildOptions {
  isEnemy?: boolean;
  customHue?: number;
  loadout?: CharacterLoadout;
}
```

Add a V3 color adapter:

```ts
const createCustomArmorColors = (colors: SpartanColors): CustomArmorColors => ({
  primary: colors.primary,
  secondary: colors.secondary,
  accent: colors.accent,
  visor: colors.visor,
  dark: colors.dark,
  highlight: colors.highlight,
});
```

Export built-in V3 part voxels for the armor editor:

```ts
export function getV3BuiltinPartVoxels(slot: V3CharacterSlotId, customHue?: number): VoxelData[] {
  const part = BUILT_IN_V3_CHARACTER_PARTS.find((candidate) => candidate.slot === slot);
  if (!part) {
    throw new Error(`Missing built-in V3 part for ${slot}`);
  }
  return createPartVoxels(part, V3_PART_SPECS[slot].dimensions, createColors(false, customHue));
}
```

Add helper:

```ts
function getValidV3CustomPiece(
  loadout: CharacterLoadout | undefined,
  slot: V3CharacterSlotId
): CustomArmorPieceSnapshot | undefined {
  const piece = loadout?.customArmor?.[slot];
  if (!piece || piece.slot !== slot || getCustomArmorPieceModelSystem(piece) !== 'v3') return undefined;
  const validation = validateCustomArmorPiece(piece);
  return validation.valid ? piece : undefined;
}
```

- [ ] **Step 4: Render V3 custom pieces**

In the built-in part loop:

```ts
const customPiece = getValidV3CustomPiece(options.loadout, part.slot);
const voxels = customPiece
  ? customArmorPieceToVoxels(customPiece, createCustomArmorColors(colors))
  : createPartVoxels(part, spec.dimensions, colors);
const group = createVoxelGroup(voxels, V3_VOXEL_SCALE);
```

After setting standard metadata:

```ts
if (customPiece) {
  group.userData.customArmorId = customPiece.id;
  group.userData.customArmorName = customPiece.name;
}
```

- [ ] **Step 5: Pass loadout through `buildVoxelSpartanModel()`**

In `src/components/VoxelModels.ts`, change:

```ts
return buildV3SpartanModel({ isEnemy, customHue });
```

to:

```ts
return buildV3SpartanModel({ isEnemy, customHue, loadout });
```

- [ ] **Step 6: Track V3 slots in preview signatures**

In `src/components/previewModelUtils.ts`, import `V3_CHARACTER_SLOT_IDS` and change the custom armor signature slots:

```ts
import { V3_CHARACTER_SLOT_IDS } from './v3/v3ModelTypes';

const CUSTOM_ARMOR_SIGNATURE_SLOTS = ['helmet', 'torso', 'arm', 'leg', ...V3_CHARACTER_SLOT_IDS] as const;
```

Deduplicate overlapping `helmet`:

```ts
const CUSTOM_ARMOR_SIGNATURE_SLOTS = Array.from(new Set(['helmet', 'torso', 'arm', 'leg', ...V3_CHARACTER_SLOT_IDS])) as Array<'helmet' | 'torso' | 'arm' | 'leg' | V3CharacterSlotId>;
```

Include `piece.modelSystem ?? 'v2'` in each piece signature.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/customArmor.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```powershell
git add src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts src/components/VoxelModels.ts src/components/previewModelUtils.ts src/components/customArmor.test.ts
git commit -m "feat: render v3 custom armor pieces"
```

Expected: commit includes only Task 2 files.

---

## Task 3: Armory V3 Selection And Loadout Normalization

**Files:**
- Modify: `src/components/main-menu/useCustomizationState.test.ts`
- Modify: `src/components/main-menu/useCustomizationState.ts`
- Modify: `src/components/main-menu/ArmoryPanel.tsx`

- [ ] **Step 1: Write loadout normalization tests**

Add to `src/components/main-menu/useCustomizationState.test.ts`:

```ts
test('loadStoredPlayerLoadout preserves V3 model system and V3 custom armor slots', () => {
  const loadout = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({
    modelSystem: 'v3',
    customArmor: {
      forearmRight: {
        version: 1,
        id: 'v3-forearm',
        name: 'V3 Forearm',
        slot: 'forearmRight',
        modelSystem: 'v3',
        voxels: [{ x: 0, y: 0, z: 0, role: 'primary' }],
        updatedAt: 1,
      },
    },
  })));

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.customArmor?.forearmRight?.modelSystem, 'v3');
  assert.equal(loadout.modelType, undefined);
});

test('loadStoredPlayerLoadout keeps malformed saved loadouts on safe defaults', () => {
  const loadout = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({
    modelSystem: 'v4',
    modelType: 'large',
    customArmor: { rawMesh: { vertices: [1] } },
  })));

  assert.notEqual(loadout.modelSystem, 'v4' as any);
  assert.equal(loadout.customArmor, undefined);
});
```

- [ ] **Step 2: Run test and confirm failure if normalization is missing**

Run:

```powershell
node --import tsx --test src/components/main-menu/useCustomizationState.test.ts
```

Expected: FAIL if invalid model systems are not normalized.

- [ ] **Step 3: Normalize stored loadouts through existing sanitizer**

In `src/components/main-menu/useCustomizationState.ts`, import:

```ts
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';
```

Add:

```ts
export function normalizeStoredPlayerLoadout(value: unknown): CharacterLoadout {
  const sanitized = sanitizeCharacterLoadoutForNetwork(value) as CharacterLoadout | undefined;
  return sanitized ? { ...DEFAULT_LOADOUT, ...sanitized } : DEFAULT_LOADOUT;
}
```

Change `loadStoredPlayerLoadout()` to parse JSON and call `normalizeStoredPlayerLoadout(parsed)`.

- [ ] **Step 4: Add V3 model-system control to ArmoryPanel**

In `src/components/main-menu/ArmoryPanel.tsx`, change the model buttons from V1/V2 only to:

```ts
([
  { id: 'v1', label: 'V1 Classic' },
  { id: 'v2', label: 'V2 Rigged' },
  { id: 'v3', label: 'V3 Advanced' },
] as const)
```

Use this click behavior:

```ts
onClick={() => updateLoadout({
  modelSystem: model.id,
  modelType: model.id === 'v2' ? activeModelType : undefined,
})}
```

Do not clear `customArmor` when switching models; filtering in the builders and UI keeps V2/V3 pieces isolated.

- [ ] **Step 5: Add V3 custom piece tiles**

In `ArmoryPanel.tsx`, import:

```ts
import {
  V3_CUSTOM_ARMOR_SLOTS,
  getCustomArmorPieceModelSystem,
  getCustomArmorSlotLabel,
  type V2CustomArmorSlot,
  type V3CustomArmorSlot,
} from '../customArmor';
```

Create a V3 loadout slot list:

```ts
const V3_LOADOUT_SLOTS = V3_CUSTOM_ARMOR_SLOTS.map((slot) => ({
  key: slot,
  label: getCustomArmorSlotLabel(slot, 'v3'),
}));
```

When `activeModelSystem === 'v3'`, render V3 slots separately from the V2 `LOADOUT_SLOTS` preset grid. For each V3 slot, show:

```tsx
{customArmorCatalog.pieces
  .filter((piece) => piece.slot === key && getCustomArmorPieceModelSystem(piece) === 'v3')
  .map((piece) => (
    <button
      key={piece.id}
      type="button"
      onClick={() => updateLoadout({
        modelSystem: 'v3',
        modelType: undefined,
        customArmor: {
          ...(playerLoadout.customArmor ?? {}),
          [key]: {
            version: 1,
            id: piece.id,
            name: piece.name,
            slot: piece.slot,
            modelSystem: 'v3',
            sourcePreset: piece.sourcePreset,
            voxels: piece.voxels,
            thumbnail: piece.thumbnail,
            updatedAt: piece.updatedAt,
          },
        },
      })}
      title={piece.name}
      className={isCustomActive ? activeClass : inactiveClass}
    >
      {piece.thumbnail ?? 'V3'} {piece.name.slice(0, 8)}
    </button>
  ))}
```

Keep existing V2 preset/custom armor rendering unchanged for `activeModelSystem !== 'v3'`.

- [ ] **Step 6: Update armor editor entry point**

Change the editor link label to switch by active model system:

```tsx
{activeModelSystem === 'v3' ? 'Create / Edit V3 Armor Model' : 'Create / Edit V2 Armor Model'}
```

Clicking the link should preserve `modelSystem: activeModelSystem === 'v3' ? 'v3' : 'v2'`.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/main-menu/useCustomizationState.test.ts src/components/customArmor.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add src/components/main-menu/useCustomizationState.ts src/components/main-menu/useCustomizationState.test.ts src/components/main-menu/ArmoryPanel.tsx
git commit -m "feat: add v3 armory customization controls"
```

Expected: commit includes only Task 3 files.

---

## Task 4: Armor Editor V3 Mode

**Files:**
- Modify: `src/components/main-menu/ArmorModelEditor.tsx`
- Modify: `src/armorModelEditorPage.tsx`

- [ ] **Step 1: Add V3 editor model-system state**

In `ArmorModelEditor.tsx`, import:

```ts
import {
  V2_CUSTOM_ARMOR_SLOTS,
  V3_CUSTOM_ARMOR_SLOTS,
  getCustomArmorPieceModelSystem,
  getCustomArmorSlotLabel,
  type CustomArmorModelSystem,
} from '../customArmor';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import { getV3BuiltinPartVoxels } from '../v3/VoxelModelsV3';
```

Add state:

```ts
const initialModelSystem: CustomArmorModelSystem = playerLoadout.modelSystem === 'v3' ? 'v3' : 'v2';
const [modelSystem, setModelSystem] = useState<CustomArmorModelSystem>(initialModelSystem);
```

Calculate slots:

```ts
const activeSlotOptions = modelSystem === 'v3'
  ? V3_CUSTOM_ARMOR_SLOTS.map((slot) => ({ slot, label: getCustomArmorSlotLabel(slot, 'v3') }))
  : SLOT_OPTIONS;
```

- [ ] **Step 2: Update V3 draft creation**

Replace `snapshotFromBuiltin()` with a model-system aware function:

```ts
const snapshotFromBuiltin = (
  slot: CustomArmorSlot,
  preset: string,
  hue: number,
  modelType: CharacterModelType,
  modelSystem: CustomArmorModelSystem,
  name = `${preset} Remix`
): CustomArmorPieceSnapshot => {
  const voxels = modelSystem === 'v3'
    ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, hue)
    : getVoxelSegmentDataV2(getV2SourceSlot(slot as V2CustomArmorSlot), preset, hue, false, modelType);
  const piece = createCustomArmorPiece(slot, name, voxelDataToCustomArmorVoxels(voxels), preset, modelSystem === 'v2' ? modelType : undefined, modelSystem);
  return createCustomArmorSnapshot(piece);
};
```

For V3 blank drafts, call:

```ts
createBlankSnapshot(slot, modelType, modelSystem)
```

and pass `modelSystem` into `createCustomArmorPiece()`.

- [ ] **Step 3: Add V3 slot bounds and cursor logic**

For edit view bounds, use:

```ts
const b = modelSystem === 'v3'
  ? {
      minX: 0,
      maxX: getV3CharacterPartBounds(slot as V3CustomArmorSlot).maxDimensions.x - 1,
      minY: 0,
      maxY: getV3CharacterPartBounds(slot as V3CustomArmorSlot).maxDimensions.y - 1,
      minZ: 0,
      maxZ: getV3CharacterPartBounds(slot as V3CustomArmorSlot).maxDimensions.z - 1,
    }
  : getCustomArmorSlotSpec(slot as V2CustomArmorSlot, modelType).bounds;
```

Use this same branch in `voxelWithinCurrentSlot()`, cursor initialization, `switchSlot()`, repair helpers, and silhouette rendering.

- [ ] **Step 4: Add V3 model-system buttons**

Add a compact segmented control beside the V2 body-size control:

```tsx
{(['v2', 'v3'] as const).map((system) => (
  <button
    key={system}
    type="button"
    onClick={() => switchModelSystem(system)}
    className={modelSystem === system ? activeClass : inactiveClass}
  >
    {system.toUpperCase()}
  </button>
))}
```

`switchModelSystem('v3')` should:

```ts
setModelSystem('v3');
setModelType('medium');
setSlot('helmet');
replaceDraft(snapshotFromBuiltin('helmet', 'ibv3-aegis-helmet', playerHue, 'medium', 'v3', 'Aegis Vanguard Helmet Remix'));
onLoadoutChange({ modelSystem: 'v3', modelType: undefined });
```

`switchModelSystem('v2')` should preserve existing V2 behavior and call `onLoadoutChange({ modelSystem: 'v2', modelType })`.

- [ ] **Step 5: Save and equip V3 pieces**

When saving:

```ts
onLoadoutChange({
  modelSystem,
  modelType: modelSystem === 'v2' ? modelType : undefined,
  customArmor: {
    ...(playerLoadout.customArmor ?? {}),
    [draft.slot]: createCustomArmorSnapshot(nextPiece),
  },
});
```

Catalog filtering should require:

```ts
piece.slot === slot && getCustomArmorPieceModelSystem(piece) === modelSystem
```

For V2, keep the existing `modelType` filter.

- [ ] **Step 6: Preview V3 rigs**

In rig preview, set:

```ts
const previewLoadout: CharacterLoadout = {
  ...playerLoadout,
  modelSystem,
  modelType: modelSystem === 'v2' ? modelType : undefined,
  customArmor: {
    ...(playerLoadout.customArmor ?? {}),
    [slot]: { ...draft, modelSystem, modelType: modelSystem === 'v2' ? modelType : undefined },
  },
};
```

`buildVoxelSpartanModel(false, playerHue, previewLoadout)` should now render V3 custom parts through Task 2.

- [ ] **Step 7: Update standalone page copy and forced model system**

In `src/armorModelEditorPage.tsx`, initialize with the stored loadout without forcing V2:

```ts
const [playerLoadout, setPlayerLoadout] = useState<CharacterLoadout>(() => loadStoredPlayerLoadout());
```

Change the header title:

```tsx
{playerLoadout.modelSystem === 'v3' ? 'V3 Armor Model Editor' : 'V2 Armor Model Editor'}
```

Change the status line:

```tsx
<span>{playerLoadout.modelSystem === 'v3' ? 'Version 3 modular armor' : 'Version 2 rig'}</span>
```

Keep persistence localStorage-only.

- [ ] **Step 8: Run focused editor compile checks**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```powershell
git add src/components/main-menu/ArmorModelEditor.tsx src/armorModelEditorPage.tsx
git commit -m "feat: add v3 armor editor mode"
```

Expected: commit includes only Task 4 files.

---

## Task 5: Documentation, Browser Smoke, And Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Near the armor editor and V3 model-system sections, document:

```md
Phase 6 adds V3 modular armor customization and a V3-aware local armor editor. V3 custom armor pieces are local voxel payloads keyed to V3 fit-bound slots and paint roles, saved in the existing custom armor catalog, and consumed only by the V3 visual builder. V1/V2 remain selectable, V2 medium/large editor behavior is preserved, and no mesh/OBJ/FBX upload path is exposed to end users.
```

Also correct any nearby stale reference from `CustomizationPanel.tsx` to `ArmoryPanel.tsx` if the paragraph is touched.

- [ ] **Step 2: Run focused tests**

Run:

```powershell
node --import tsx --test src/components/customArmor.test.ts src/components/v3/VoxelModelsV3.test.ts src/components/main-menu/useCustomizationState.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run lint
npm test
npm run build
git diff --check
```

Expected: PASS. `npm run build` may emit existing Vite large-chunk warnings only.

- [ ] **Step 4: Private asset scan**

Run:

```powershell
git diff --name-only HEAD
git status --short
```

Expected: no `.obj`, `.mtl`, `.fbx`, `.blend`, texture, screenshot, or generated private reference asset appears.

- [ ] **Step 5: Browser smoke**

With the dev server running on port `3000`, open:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/armor-model-editor.html
```

Expected:
- Main menu can select V1, V2, and V3 model systems.
- V2 armor editor still supports medium/large pieces.
- V3 armor editor can create, save, equip, and preview a V3 piece.
- Character preview and editor rig preview are nonblank.
- No console errors from the touched customization/editor code.

If this environment serves stale HTML or hits the known `EPERM: operation not permitted, lstat 'C:\Users\eastr'` dev-server blocker, document the browser-smoke blocker and rely on lint/tests/build for the code gate.

- [ ] **Step 6: Commit documentation**

Run:

```powershell
git add README.md
git commit -m "docs: describe v3 armor customization"
```

Expected: commit includes only README changes unless verification required a small follow-up fix.

---

## Phase 6 Completion Criteria

- V3 custom armor pieces have model-system aware contracts, V3 slot validation, V3 paint roles, and V3 budget/bounds enforcement.
- V2 custom armor medium/large behavior and V1/V2 model selection remain unchanged.
- V3 builder renders valid V3 custom pieces and ignores V2 custom pieces.
- Main-menu armory exposes V3 as a selectable model system and lists V3 custom armor pieces separately from V2 pieces.
- Standalone armor editor supports V2 and V3 local voxel editing without mesh uploads.
- No private reference asset or runtime upload path is added.
- Focused tests, lint, full tests, build, and whitespace checks pass or environment-specific browser smoke blockers are documented.
