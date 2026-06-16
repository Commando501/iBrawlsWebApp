import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../customArmor';
import {
  getCustomArmorGridScale,
  isVoxelInSlotBounds,
  validateCustomArmorPiece,
} from '../customArmor';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import {
  applyV3SmartAuthoringTool,
  buildV3SmartAuthoringPreview,
  type V3ArmorSmartToolId,
  type V3SmartAuthoringContext,
  type V3SmartAuthoringOptions,
} from './v3ArmorEditorSmartAuthoring';

const piece = (
  voxels: CustomArmorPieceSnapshot['voxels'],
  overrides: Partial<CustomArmorPieceSnapshot> = {}
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: 'smart-draft',
  name: 'Smart Draft',
  slot: 'helmet',
  modelSystem: 'v3',
  gridScale: 2,
  sourcePreset: 'phase-21',
  thumbnail: 'data:image/png;base64,phase21',
  voxels,
  updatedAt: 10,
  ...overrides,
});

const context = (
  overrides: Partial<V3SmartAuthoringContext> = {}
): V3SmartAuthoringContext => ({
  cursor: { x: 9, y: 8, z: 7 },
  size: { x: 5, y: 3, z: 3 },
  axis: 'x',
  role: 'accent',
  fixedColor: '#ff00aa',
  emissive: false,
  now: 99,
  ...overrides,
});

const box = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  role: CustomArmorMaterialRole
): CustomArmorVoxel[] => {
  const voxels: CustomArmorVoxel[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        voxels.push({ x, y, z, role });
      }
    }
  }
  return voxels;
};

const coordKey = (voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

const voxelAt = (
  draft: CustomArmorPieceSnapshot,
  x: number,
  y: number,
  z: number
): CustomArmorVoxel | undefined => draft.voxels.find((voxel) => (
  voxel.x === x && voxel.y === y && voxel.z === z
));

const countRole = (
  draft: CustomArmorPieceSnapshot,
  role: CustomArmorMaterialRole
): number => draft.voxels.filter((voxel) => voxel.role === role).length;

const sortVoxels = (voxels: readonly CustomArmorVoxel[]): CustomArmorVoxel[] =>
  [...voxels].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

const materialKey = (voxel: Pick<CustomArmorVoxel, 'role' | 'color' | 'emissive'>): string =>
  `${voxel.role}:${voxel.color ?? ''}:${voxel.emissive === true ? '1' : '0'}`;

const assertAllVoxelsInBounds = (draft: CustomArmorPieceSnapshot): void => {
  const gridScale = getCustomArmorGridScale(draft);
  for (const voxel of draft.voxels) {
    assert.equal(
      isVoxelInSlotBounds(draft.slot, voxel, 'medium', 'v3', gridScale),
      true,
      `expected ${coordKey(voxel)} to stay inside ${draft.slot} bounds`
    );
  }
};

const assertMetadata = (
  actual: CustomArmorPieceSnapshot,
  expected: CustomArmorPieceSnapshot,
  updatedAt: number
): void => {
  assert.equal(actual.version, expected.version);
  assert.equal(actual.id, expected.id);
  assert.equal(actual.name, expected.name);
  assert.equal(actual.slot, expected.slot);
  assert.equal(actual.modelSystem, expected.modelSystem);
  assert.equal(actual.modelType, expected.modelType);
  assert.equal(actual.sourcePreset, expected.sourcePreset);
  assert.equal(actual.gridScale, expected.gridScale);
  assert.equal(actual.thumbnail, expected.thumbnail);
  assert.equal(actual.updatedAt, updatedAt);
};

const broadBlock = (): CustomArmorPieceSnapshot => piece(box(2, 17, 3, 14, 3, 12, 'primary'));

test('preview reports panelStripe added voxels without changing the draft', () => {
  const draft = piece(box(4, 13, 4, 11, 4, 8, 'primary'));
  const before = structuredClone(draft);

  const preview = buildV3SmartAuthoringPreview(draft, 'panelStripe', context({
    cursor: { x: 19, y: 8, z: 7 },
    size: { x: 5, y: 1, z: 1 },
    axis: 'x',
    role: 'fixed',
    fixedColor: '#ff00aa',
    emissive: true,
    now: 900,
  }));

  assert.equal(preview.toolId, 'panelStripe');
  assert.equal(preview.changed, true);
  assert.deepEqual(draft, before);
  assert.equal(preview.previewDraft.updatedAt, draft.updatedAt);
  assert.deepEqual(preview.removed, []);
  assert.deepEqual(preview.remapped, []);
  assert.deepEqual(sortVoxels(preview.added), [
    { x: 17, y: 8, z: 7, role: 'fixed', color: '#ff00aa', emissive: true },
    { x: 18, y: 8, z: 7, role: 'fixed', color: '#ff00aa', emissive: true },
    { x: 19, y: 8, z: 7, role: 'fixed', color: '#ff00aa', emissive: true },
  ]);
});

test('preview reports edgeAccent role changes as remapped voxels', () => {
  const draft = piece(box(0, 6, 4, 10, 4, 8, 'primary'));

  const preview = buildV3SmartAuthoringPreview(draft, 'edgeAccent', context({
    cursor: { x: 0, y: 7, z: 6 },
    size: { x: 3, y: 5, z: 5 },
    axis: 'y',
    role: 'highlight',
    fixedColor: '#ffffff',
    now: 901,
  }));

  assert.equal(preview.changed, true);
  assert.deepEqual(preview.added, []);
  assert.deepEqual(preview.removed, []);
  assert.ok(preview.remapped.length > 0);
  assert.equal(preview.remapped.length, countRole(preview.previewDraft, 'highlight'));
  assert.ok(preview.remapped.every((diff) => (
    diff.before.role === 'primary' &&
    diff.after.role === 'highlight' &&
    diff.before.x === diff.after.x &&
    diff.before.y === diff.after.y &&
    diff.before.z === diff.after.z
  )));
});

test('preview reports carveSeam removed voxels', () => {
  const draft = piece(box(4, 15, 4, 13, 4, 10, 'primary'));

  const preview = buildV3SmartAuthoringPreview(draft, 'carveSeam', context({
    cursor: { x: 9, y: 8, z: 7 },
    size: { x: 12, y: 1, z: 1 },
    axis: 'x',
    now: 902,
  }));

  assert.equal(preview.changed, true);
  assert.deepEqual(preview.added, []);
  assert.deepEqual(preview.remapped, []);
  assert.deepEqual(sortVoxels(preview.removed), box(4, 15, 8, 8, 7, 7, 'primary'));
  assert.equal(preview.previewDraft.updatedAt, draft.updatedAt);
});

test('preview returns no changes for non-V3 drafts and blocked no-op tools', () => {
  const legacy = piece(box(0, 3, 35, 39, 0, 4, 'primary'), {
    modelSystem: 'v2',
    modelType: 'medium',
    gridScale: undefined,
    sourcePreset: 'legacy',
    updatedAt: 42,
  });

  const legacyPreview = buildV3SmartAuthoringPreview(legacy, 'panelStripe', context({ now: 903 }));

  assert.equal(legacyPreview.changed, false);
  assert.deepEqual(legacyPreview.added, []);
  assert.deepEqual(legacyPreview.removed, []);
  assert.deepEqual(legacyPreview.remapped, []);
  assert.deepEqual(legacyPreview.previewDraft, legacy);
  assert.notEqual(legacyPreview.previewDraft.voxels[0], legacy.voxels[0]);

  const tiny = piece(box(4, 5, 4, 5, 4, 5, 'primary'));
  const trimPreview = buildV3SmartAuthoringPreview(tiny, 'trimCorners', context({ now: 904 }));

  assert.equal(trimPreview.changed, false);
  assert.deepEqual(trimPreview.added, []);
  assert.deepEqual(trimPreview.removed, []);
  assert.deepEqual(trimPreview.remapped, []);
  assert.deepEqual(trimPreview.previewDraft, tiny);
});

test('preview draft matches applyV3SmartAuthoringTool except timestamp preservation', () => {
  const draft = broadBlock();
  const preview = buildV3SmartAuthoringPreview(draft, 'taperMass', context({
    cursor: { x: 17, y: 8, z: 8 },
    now: 905,
  }), {
    taperMass: {
      axis: 'x',
      side: 'max',
      depthRatio: 0.4,
      removeRatio: 0.18,
      preserveRatio: 0.75,
    },
  });
  const applied = applyV3SmartAuthoringTool(draft, 'taperMass', context({
    cursor: { x: 17, y: 8, z: 8 },
    now: 905,
  }), {
    taperMass: {
      axis: 'x',
      side: 'max',
      depthRatio: 0.4,
      removeRatio: 0.18,
      preserveRatio: 0.75,
    },
  });

  assert.equal(preview.changed, true);
  assert.equal(preview.previewDraft.updatedAt, draft.updatedAt);
  assert.equal(applied.updatedAt, 905);
  assert.deepEqual(
    { ...preview.previewDraft, updatedAt: applied.updatedAt },
    applied
  );
});

test('options omitted and strength normal preserve Phase 21 output for every tool', () => {
  const contexts: Record<V3ArmorSmartToolId, V3SmartAuthoringContext> = {
    panelStripe: context({
      cursor: { x: 10, y: 8, z: 8 },
      size: { x: 7, y: 1, z: 1 },
      axis: 'x',
      now: 910,
    }),
    edgeAccent: context({
      cursor: { x: 2, y: 8, z: 8 },
      size: { x: 3, y: 5, z: 5 },
      axis: 'z',
      now: 911,
    }),
    carveSeam: context({
      cursor: { x: 10, y: 8, z: 8 },
      size: { x: 7, y: 1, z: 1 },
      axis: 'x',
      now: 912,
    }),
    trimCorners: context({ now: 913 }),
    taperMass: context({ now: 914 }),
    mirrorLocalX: context({ now: 915 }),
  };
  const drafts: Record<V3ArmorSmartToolId, CustomArmorPieceSnapshot> = {
    panelStripe: broadBlock(),
    edgeAccent: broadBlock(),
    carveSeam: broadBlock(),
    trimCorners: broadBlock(),
    taperMass: broadBlock(),
    mirrorLocalX: broadBlock(),
  };

  for (const toolId of Object.keys(contexts) as V3ArmorSmartToolId[]) {
    assert.deepEqual(
      applyV3SmartAuthoringTool(drafts[toolId], toolId, contexts[toolId], { strength: 'normal' }),
      applyV3SmartAuthoringTool(drafts[toolId], toolId, contexts[toolId]),
      `${toolId} should keep Phase 21 output with strength normal`
    );
  }
});

test('empty carveSeam options behave like omitted options', () => {
  const draft = broadBlock();
  const fullVolumeSeam = context({
    cursor: { x: 9, y: 8, z: 8 },
    size: { x: 16, y: 12, z: 10 },
    axis: 'x',
    now: 916,
  });

  const omitted = applyV3SmartAuthoringTool(draft, 'carveSeam', fullVolumeSeam);
  const empty = applyV3SmartAuthoringTool(draft, 'carveSeam', fullVolumeSeam, {
    carveSeam: {},
  });
  const explicit = applyV3SmartAuthoringTool(draft, 'carveSeam', fullVolumeSeam, {
    carveSeam: { preserveRatio: 0.7 },
  });

  assert.equal(omitted.voxels.length, draft.voxels.length);
  assert.deepEqual(empty, omitted);
  assert.ok(explicit.voxels.length < omitted.voxels.length);
});

test('smart authoring options are deterministic and bounds-safe', () => {
  const draft = broadBlock();
  const outOfRangeOptions: V3SmartAuthoringOptions = {
    strength: 'heavy',
    panelStripe: { thickness: 99, overwriteExisting: false },
    edgeAccent: { coverageRatio: 99, minVoxels: 99, edgeMode: 'bounds-only' },
    carveSeam: { preserveRatio: -10, minVoxels: -5 },
    trimCorners: { removeRatio: 99, preserveRatio: -10, cornerThreshold: 3 },
    taperMass: {
      axis: 'z',
      side: 'min',
      depthRatio: 99,
      removeRatio: 99,
      preserveRatio: -10,
    },
    mirrorLocalX: { scope: 'cursorVolume', overwriteExisting: true },
  };

  const narrowStripe = applyV3SmartAuthoringTool(draft, 'panelStripe', context({
    cursor: { x: 19, y: 8, z: 8 },
    size: { x: 3, y: 1, z: 1 },
    axis: 'x',
    now: 920,
  }), { panelStripe: { thickness: 1 } });
  const wideStripe = applyV3SmartAuthoringTool(draft, 'panelStripe', context({
    cursor: { x: 19, y: 8, z: 8 },
    size: { x: 3, y: 1, z: 1 },
    axis: 'x',
    now: 920,
  }), { panelStripe: { thickness: 3 } });
  assert.ok(wideStripe.voxels.length > narrowStripe.voxels.length);

  const exposedAccent = applyV3SmartAuthoringTool(draft, 'edgeAccent', context({
    cursor: { x: 9, y: 8, z: 8 },
    size: { x: 16, y: 12, z: 10 },
    axis: 'x',
    role: 'highlight',
    now: 921,
  }), { edgeAccent: { coverageRatio: 0.1, minVoxels: 2, edgeMode: 'exposed-only' } });
  const boundsAccent = applyV3SmartAuthoringTool(draft, 'edgeAccent', context({
    cursor: { x: 9, y: 8, z: 8 },
    size: { x: 16, y: 12, z: 10 },
    axis: 'x',
    role: 'highlight',
    now: 921,
  }), { edgeAccent: { coverageRatio: 0.1, minVoxels: 2, edgeMode: 'bounds-only' } });
  assert.ok(countRole(exposedAccent, 'highlight') > countRole(boundsAccent, 'highlight'));
  assert.ok(boundsAccent.voxels.every((voxel) => (
    voxel.role !== 'highlight' || voxel.x === 0 || voxel.x === 23
  )));

  const shallowSeam = applyV3SmartAuthoringTool(draft, 'carveSeam', context({
    cursor: { x: 9, y: 8, z: 8 },
    size: { x: 16, y: 12, z: 1 },
    axis: 'x',
    now: 922,
  }), { carveSeam: { preserveRatio: 0.95, minVoxels: 24 } });
  const deepSeam = applyV3SmartAuthoringTool(draft, 'carveSeam', context({
    cursor: { x: 9, y: 8, z: 8 },
    size: { x: 16, y: 12, z: 1 },
    axis: 'x',
    now: 922,
  }), { carveSeam: { preserveRatio: 0.7, minVoxels: 24 } });
  assert.ok(shallowSeam.voxels.length > deepSeam.voxels.length);

  const gentleTrim = applyV3SmartAuthoringTool(draft, 'trimCorners', context({ now: 923 }), {
    trimCorners: { removeRatio: 0.02, preserveRatio: 0.95, cornerThreshold: 2 },
  });
  const hardTrim = applyV3SmartAuthoringTool(draft, 'trimCorners', context({ now: 923 }), {
    trimCorners: { removeRatio: 0.2, preserveRatio: 0.7, cornerThreshold: 2 },
  });
  const cornerOnlyTrim = applyV3SmartAuthoringTool(draft, 'trimCorners', context({ now: 923 }), {
    trimCorners: { removeRatio: 0.2, preserveRatio: 0.7, cornerThreshold: 3 },
  });
  assert.ok(gentleTrim.voxels.length > hardTrim.voxels.length);
  assert.ok(cornerOnlyTrim.voxels.length > hardTrim.voxels.length);

  const taperMinZ = applyV3SmartAuthoringTool(draft, 'taperMass', context({
    cursor: { x: 9, y: 8, z: 8 },
    now: 924,
  }), {
    taperMass: { axis: 'z', side: 'min', depthRatio: 0.2, removeRatio: 0.1, preserveRatio: 0.8 },
  });
  const taperMaxZ = applyV3SmartAuthoringTool(draft, 'taperMass', context({
    cursor: { x: 9, y: 8, z: 8 },
    now: 924,
  }), {
    taperMass: { axis: 'z', side: 'max', depthRatio: 0.2, removeRatio: 0.1, preserveRatio: 0.8 },
  });
  assert.ok(taperMinZ.voxels.some((voxel) => voxel.z === 12));
  assert.ok(taperMaxZ.voxels.some((voxel) => voxel.z === 3));

  const mirrorDraft = piece(box(2, 6, 4, 11, 4, 8, 'secondary'));
  const mirroredPiece = applyV3SmartAuthoringTool(mirrorDraft, 'mirrorLocalX', context({ now: 925 }));
  const mirroredCursor = applyV3SmartAuthoringTool(mirrorDraft, 'mirrorLocalX', context({
    cursor: { x: 3, y: 5, z: 5 },
    size: { x: 3, y: 3, z: 3 },
    now: 925,
  }), {
    mirrorLocalX: { scope: 'cursorVolume' },
  });
  assert.ok(mirroredPiece.voxels.length > mirroredCursor.voxels.length);
  assert.ok(mirroredCursor.voxels.length > mirrorDraft.voxels.length);

  for (const toolId of Object.keys(outOfRangeOptions).filter((key) => key !== 'strength') as V3ArmorSmartToolId[]) {
    const first = applyV3SmartAuthoringTool(draft, toolId, context({
      cursor: { x: 9, y: 8, z: 8 },
      size: { x: 8, y: 6, z: 4 },
      axis: 'x',
      now: 930,
    }), outOfRangeOptions);
    const second = applyV3SmartAuthoringTool(draft, toolId, context({
      cursor: { x: 9, y: 8, z: 8 },
      size: { x: 8, y: 6, z: 4 },
      axis: 'x',
      now: 930,
    }), outOfRangeOptions);

    assert.deepEqual(first, second, `${toolId} should clamp options deterministically`);
    assertAllVoxelsInBounds(first);
    assert.equal(validateCustomArmorPiece(first).valid, true);
  }
});

test('panelStripe adds bounded active-role voxels around cursor and preserves metadata', () => {
  const draft = piece(box(4, 13, 4, 11, 4, 8, 'primary'));

  const authored = applyV3SmartAuthoringTool(draft, 'panelStripe', context({
    cursor: { x: 19, y: 8, z: 7 },
    size: { x: 5, y: 1, z: 1 },
    axis: 'x',
    role: 'fixed',
    fixedColor: '#ff00aa',
    emissive: true,
    now: 123,
  }));

  assertMetadata(authored, draft, 123);
  assertAllVoxelsInBounds(authored);
  assert.ok(authored.voxels.length > draft.voxels.length);
  for (const x of [17, 18, 19]) {
    assert.deepEqual(voxelAt(authored, x, 8, 7), {
      x,
      y: 8,
      z: 7,
      role: 'fixed',
      color: '#ff00aa',
      emissive: true,
    });
  }
  assert.equal(voxelAt(authored, 4, 4, 4)?.role, 'primary');
});

test('edgeAccent changes exposed or bounds-edge voxels to active role without leaving bounds', () => {
  const draft = piece(box(0, 6, 4, 10, 4, 8, 'primary'));

  const authored = applyV3SmartAuthoringTool(draft, 'edgeAccent', context({
    cursor: { x: 0, y: 7, z: 6 },
    size: { x: 3, y: 5, z: 5 },
    axis: 'y',
    role: 'highlight',
    fixedColor: '#ffffff',
    now: 124,
  }));

  assertMetadata(authored, draft, 124);
  assert.equal(authored.voxels.length, draft.voxels.length);
  assert.ok(countRole(authored, 'highlight') > countRole(draft, 'highlight'));
  assert.ok(authored.voxels.some((voxel) => voxel.x === 0 && voxel.role === 'highlight'));
  assertAllVoxelsInBounds(authored);
  assert.equal(validateCustomArmorPiece(authored).valid, true);
});

test('carveSeam removes a deterministic seam while keeping valid V3 drafts valid', () => {
  const draft = piece(box(4, 15, 4, 13, 4, 10, 'primary'));
  assert.equal(validateCustomArmorPiece(draft).valid, true);

  const authored = applyV3SmartAuthoringTool(draft, 'carveSeam', context({
    cursor: { x: 9, y: 8, z: 7 },
    size: { x: 12, y: 1, z: 1 },
    axis: 'x',
    now: 125,
  }));
  const repeated = applyV3SmartAuthoringTool(draft, 'carveSeam', context({
    cursor: { x: 9, y: 8, z: 7 },
    size: { x: 12, y: 1, z: 1 },
    axis: 'x',
    now: 125,
  }));

  assertMetadata(authored, draft, 125);
  assert.ok(authored.voxels.length < draft.voxels.length);
  assert.deepEqual(authored, repeated);
  for (let x = 4; x <= 15; x++) {
    assert.equal(voxelAt(authored, x, 8, 7), undefined);
  }
  assertAllVoxelsInBounds(authored);
  assert.equal(validateCustomArmorPiece(authored).valid, true);
});

test('trimCorners and taperMass reduce broad blocks deterministically while preserving safe mass and bounds', () => {
  const draft = broadBlock();

  const trimmed = applyV3SmartAuthoringTool(draft, 'trimCorners', context({ now: 126 }));
  const trimmedAgain = applyV3SmartAuthoringTool(draft, 'trimCorners', context({ now: 126 }));
  const tapered = applyV3SmartAuthoringTool(draft, 'taperMass', context({ now: 127 }));
  const taperedAgain = applyV3SmartAuthoringTool(draft, 'taperMass', context({ now: 127 }));

  assert.deepEqual(trimmed, trimmedAgain);
  assert.deepEqual(tapered, taperedAgain);
  assert.ok(trimmed.voxels.length < draft.voxels.length);
  assert.ok(tapered.voxels.length < draft.voxels.length);
  assert.ok(trimmed.voxels.length >= Math.ceil(draft.voxels.length * 0.85));
  assert.ok(tapered.voxels.length >= Math.ceil(draft.voxels.length * 0.8));
  assertAllVoxelsInBounds(trimmed);
  assertAllVoxelsInBounds(tapered);
  assert.equal(validateCustomArmorPiece(trimmed).valid, true);
  assert.equal(validateCustomArmorPiece(tapered).valid, true);
});

test('mirrorLocalX creates matching mirrored voxels across the slot-local X center', () => {
  const source = box(2, 6, 4, 11, 4, 8, 'secondary').map((voxel) => (
    voxel.x === 3 && voxel.y === 5 && voxel.z === 5
      ? { ...voxel, role: 'fixed' as const, color: '#123456', emissive: true }
      : voxel
  ));
  const draft = piece(source);
  const slotMaxX = getV3CharacterPartBounds('helmet').maxDimensions.x * getCustomArmorGridScale(draft) - 1;

  const authored = applyV3SmartAuthoringTool(draft, 'mirrorLocalX', context({
    now: 128,
  }));

  assertMetadata(authored, draft, 128);
  assertAllVoxelsInBounds(authored);
  assert.ok(authored.voxels.length > draft.voxels.length);
  for (const voxel of draft.voxels) {
    const mirrored = voxelAt(authored, slotMaxX - voxel.x, voxel.y, voxel.z);
    assert.ok(mirrored, `expected mirrored voxel for ${coordKey(voxel)}`);
    assert.equal(mirrored.role, voxel.role);
    assert.equal(mirrored.color, voxel.color);
    assert.equal(mirrored.emissive, voxel.emissive);
  }
  assert.deepEqual(voxelAt(authored, 16, 5, 5), {
    x: 16,
    y: 5,
    z: 5,
    role: 'fixed',
    color: '#123456',
    emissive: true,
  });
});

test('all smart authoring operations are deterministic with context.now', () => {
  const draft = broadBlock();
  const contexts: Record<V3ArmorSmartToolId, V3SmartAuthoringContext> = {
    panelStripe: context({
      cursor: { x: 10, y: 8, z: 8 },
      size: { x: 7, y: 1, z: 1 },
      axis: 'x',
      now: 200,
    }),
    edgeAccent: context({
      cursor: { x: 2, y: 8, z: 8 },
      size: { x: 3, y: 5, z: 5 },
      axis: 'z',
      now: 201,
    }),
    carveSeam: context({
      cursor: { x: 10, y: 8, z: 8 },
      size: { x: 7, y: 1, z: 1 },
      axis: 'x',
      now: 202,
    }),
    trimCorners: context({ now: 203 }),
    taperMass: context({ now: 204 }),
    mirrorLocalX: context({ now: 205 }),
  };

  for (const toolId of Object.keys(contexts) as V3ArmorSmartToolId[]) {
    const first = applyV3SmartAuthoringTool(draft, toolId, contexts[toolId]);
    const second = applyV3SmartAuthoringTool(draft, toolId, contexts[toolId]);

    assert.deepEqual(first, second, `${toolId} should be deterministic`);
  }
});

test('non-V3 draft is no-op and metadata-preserving with cloned voxels', () => {
  const draft = piece(box(0, 3, 35, 39, 0, 4, 'primary'), {
    modelSystem: 'v2',
    modelType: 'medium',
    gridScale: undefined,
    sourcePreset: 'legacy',
    updatedAt: 42,
  });

  const authored = applyV3SmartAuthoringTool(draft, 'panelStripe', context({
    now: 300,
  }));

  assert.notEqual(authored, draft);
  assert.notEqual(authored.voxels[0], draft.voxels[0]);
  assert.deepEqual(authored, draft);
});
