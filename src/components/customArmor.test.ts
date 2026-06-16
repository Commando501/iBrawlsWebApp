import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AVAILABLE_PRESETS } from './VoxelModels';
import { getVoxelSegmentDataV2 } from './VoxelModelsV2';
import {
  CUSTOM_ARMOR_MAX_HISTORY,
  createCustomArmorPiece,
  createCustomArmorSnapshot,
  createCustomArmorThumbnail,
  duplicateCustomArmorPiece,
  getCustomArmorSlotLabel,
  normalizeCustomArmorCatalog,
  normalizeCustomArmorSnapshot,
  removeFloatingVoxels,
  restoreCustomArmorHistoryEntry,
  sanitizeCharacterLoadoutForNetwork,
  seedCornerAnchor,
  upsertCustomArmorPieceInCatalog,
  validateCustomArmorPiece,
  voxelDataToCustomArmorVoxels,
  type CustomArmorCatalog,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type CustomArmorSlot,
  type CustomArmorVoxel,
} from './customArmor';
import { V3_CHARACTER_SLOT_IDS } from './v3/v3ModelTypes';
import { getV3CharacterPartBounds } from './v3/v3PartBounds';

const cloneBuiltInPiece = (
  slot: CustomArmorSlot,
  preset: string,
  sourceSlot: string,
  modelType: 'medium' | 'large' = 'medium'
) => {
  const voxels = getVoxelSegmentDataV2(sourceSlot, preset, 200, false, modelType);
  return createCustomArmorPiece(slot, `${preset} clone`, voxelDataToCustomArmorVoxels(voxels), preset, modelType);
};

test('built-in V2 armor clones satisfy custom armor validation', () => {
  const cases: Array<[CustomArmorSlot, string, string]> = [
    ['helmet', 'mark-vi', 'helmet'],
    ['torso', 'mark-vi', 'torso'],
    ['arm', 'mark-vi', 'leftArm'],
    ['leg', 'mark-vi', 'leftLeg'],
  ];

  for (const [slot, preset, sourceSlot] of cases) {
    const result = validateCustomArmorPiece(cloneBuiltInPiece(slot, preset, sourceSlot));
    assert.equal(result.valid, true, `${slot}: ${result.errors.join(', ')}`);
  }
});

test('large built-in V2 armor clones satisfy custom armor validation', () => {
  const cases: Array<[CustomArmorSlot, readonly string[], string]> = [
    ['helmet', AVAILABLE_PRESETS.helmet, 'helmet'],
    ['torso', AVAILABLE_PRESETS.torso, 'torso'],
    ['arm', AVAILABLE_PRESETS.arm, 'leftArm'],
    ['leg', AVAILABLE_PRESETS.leg, 'leftLeg'],
  ];

  for (const [slot, presets, sourceSlot] of cases) {
    for (const preset of presets) {
      const result = validateCustomArmorPiece(cloneBuiltInPiece(slot, preset, sourceSlot, 'large'));
      assert.equal(result.valid, true, `${slot}/${preset}: ${result.errors.join(', ')}`);
    }
  }
});

test('sparse single-voxel custom armor is rejected with actionable errors', () => {
  const piece = createCustomArmorPiece('helmet', 'Ghost', [
    { x: 0, y: 36, z: 0, role: 'primary' },
  ]);
  const result = validateCustomArmorPiece(piece);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('at least')));
  assert.ok(result.errors.some((error) => error.includes('ghost piece')));
});

test('repair helpers remove floating voxels and seed a corner anchor', () => {
  const base: CustomArmorVoxel[] = [
    { x: -9, y: 12, z: -4, role: 'primary' },
    { x: -8, y: 12, z: -4, role: 'primary' },
    { x: -9, y: 13, z: -4, role: 'primary' },
    { x: -4, y: 32, z: 3, role: 'accent' },
  ];

  const repaired = removeFloatingVoxels(base);
  assert.equal(repaired.length, 3);

  const seeded = seedCornerAnchor(createCustomArmorSnapshot(createCustomArmorPiece('arm', 'Seed', repaired)));
  assert.equal(validateCustomArmorPiece(seeded).stats.anchorCluster, true);
});

test('catalog normalization and network sanitizer preserve valid selected custom armor', () => {
  const piece = cloneBuiltInPiece('arm', 'mark-vi', 'leftArm');
  const catalog = normalizeCustomArmorCatalog({ version: 1, pieces: [piece] });
  const snapshot = createCustomArmorSnapshot(catalog.pieces[0]);
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v2',
    arm: 'mark-vi',
    customArmor: { arm: snapshot },
    junk: '<script>',
  }) as any;

  assert.equal(catalog.pieces.length, 1);
  assert.equal(loadout.modelSystem, 'v2');
  assert.equal(loadout.customArmor.arm.id, snapshot.id);
  assert.equal(loadout.junk, undefined);
});

test('custom armor pieces and sanitized loadouts carry v2 model type', () => {
  const piece = cloneBuiltInPiece('torso', 'mark-vi', 'torso');
  const largeSnapshot = createCustomArmorSnapshot({
    ...piece,
    modelType: 'large',
  } as any) as any;

  assert.equal((createCustomArmorSnapshot(piece) as any).modelType, 'medium');
  assert.equal(largeSnapshot.modelType, 'large');

  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v2',
    modelType: 'large',
    torso: 'mark-vi',
    customArmor: { torso: largeSnapshot },
  }) as any;

  assert.equal(loadout.modelType, 'large');
  assert.equal(loadout.customArmor.torso.modelType, 'large');
});

test('sanitizeCharacterLoadoutForNetwork preserves v3 model system without custom mesh data', () => {
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v3',
    modelType: 'large',
    helmet: 'mark-vi',
    torso: 'scout',
    hammerPreset: 'gravity-axe',
    meshImportPath: 'C:/private/reference.obj',
    rawMesh: { vertices: [0, 1, 2] },
  }) as any;

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.modelType, undefined);
  assert.equal(loadout.helmet, 'mark-vi');
  assert.equal(loadout.torso, 'scout');
  assert.equal(loadout.hammerPreset, 'gravity-axe');
  assert.equal(loadout.meshImportPath, undefined);
  assert.equal(loadout.rawMesh, undefined);
});

test('sanitizeCharacterLoadoutForNetwork keeps v2 model type semantics unchanged', () => {
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v2',
    modelType: 'large',
  }) as any;

  assert.equal(loadout.modelSystem, 'v2');
  assert.equal(loadout.modelType, 'large');
});

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

test('new V3 custom armor drafts default to gridScale 2 while snapshots preserve it', () => {
  const piece = createCustomArmorPiece('helmet', 'High Density V3 Helmet', [], undefined, undefined, 'v3');
  const snapshot = createCustomArmorSnapshot(piece);

  assert.equal(piece.gridScale, 2);
  assert.equal(snapshot.gridScale, 2);
});

test('legacy V3 custom armor without gridScale normalizes as gridScale 1', () => {
  const helmetBounds = getV3CharacterPartBounds('helmet');
  const voxels: CustomArmorVoxel[] = Array.from({ length: 130 }, (_, index) => ({
    x: index % helmetBounds.maxDimensions.x,
    y: Math.floor(index / helmetBounds.maxDimensions.x) % helmetBounds.maxDimensions.y,
    z: Math.floor(index / (helmetBounds.maxDimensions.x * helmetBounds.maxDimensions.y)) % helmetBounds.maxDimensions.z,
    role: 'primary',
  }));

  const normalized = normalizeCustomArmorSnapshot({
    version: 1,
    id: 'legacy-v3-helmet',
    name: 'Legacy V3 Helmet',
    slot: 'helmet',
    modelSystem: 'v3',
    voxels,
    updatedAt: 1,
  });

  assert.ok(normalized);
  assert.equal(normalized.gridScale, 1);
  assert.equal(validateCustomArmorPiece(normalized).valid, true);
});

test('gridScale 2 V3 custom armor validates against doubled local fit bounds', () => {
  const helmetBounds = getV3CharacterPartBounds('helmet');
  const gridScale = 2;
  const validVoxels: CustomArmorVoxel[] = Array.from({ length: 130 }, (_, index) => ({
    x: index % (helmetBounds.maxDimensions.x * gridScale),
    y: Math.floor(index / (helmetBounds.maxDimensions.x * gridScale)) % (helmetBounds.maxDimensions.y * gridScale),
    z: Math.floor(index / (helmetBounds.maxDimensions.x * helmetBounds.maxDimensions.y * gridScale)) % (helmetBounds.maxDimensions.z * gridScale),
    role: 'primary',
  }));
  const validPiece = createCustomArmorPiece('helmet', 'HD Fit Helmet', validVoxels, undefined, undefined, 'v3', gridScale);
  const invalidPiece = {
    ...createCustomArmorSnapshot(validPiece),
    voxels: [
      ...validVoxels,
      { x: helmetBounds.maxDimensions.x * gridScale, y: 0, z: 0, role: 'accent' as const },
    ],
  };

  assert.equal(validateCustomArmorPiece(validPiece).valid, true);
  assert.equal(validateCustomArmorPiece(invalidPiece).valid, false);
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

test('upsertCustomArmorPieceInCatalog inserts new V3 snapshot with gridScale and deterministic timestamps', () => {
  const now = 123_456;
  const draft: CustomArmorPieceSnapshot = {
    version: 1,
    id: 'v3_helmet_new',
    name: '   ',
    slot: 'helmet',
    modelSystem: 'v3',
    modelType: 'large',
    gridScale: 2,
    voxels: [
      { x: 0, y: 0, z: 0, role: 'primary' },
      { x: 1, y: 0, z: 0, role: 'secondary' },
      { x: 0, y: 1, z: 0, role: 'visor' },
    ],
    updatedAt: 1,
  };
  const catalog: CustomArmorCatalog = { version: 1, pieces: [] };

  const result = upsertCustomArmorPieceInCatalog(catalog, draft, { now });

  assert.equal(result.catalog.pieces.length, 1);
  assert.deepEqual(result.catalog.pieces[0], result.piece);
  assert.equal(result.piece.id, 'v3_helmet_new');
  assert.equal(result.piece.name, `${getCustomArmorSlotLabel('helmet', 'v3')} Custom`);
  assert.equal(result.piece.modelSystem, 'v3');
  assert.equal(result.piece.modelType, undefined);
  assert.equal(result.piece.gridScale, 2);
  assert.equal(result.piece.thumbnail, createCustomArmorThumbnail('helmet', draft.voxels.length, 'v3'));
  assert.equal(result.piece.createdAt, now);
  assert.equal(result.piece.updatedAt, now);
  assert.deepEqual(result.snapshot, createCustomArmorSnapshot(result.piece));
});

test('upsertCustomArmorPieceInCatalog updates existing piece and caps prepended history', () => {
  const existing: CustomArmorPiece = {
    ...createCustomArmorPiece('helmet', 'Existing Helmet', [
      { x: 0, y: 0, z: 0, role: 'primary' },
      { x: 1, y: 0, z: 0, role: 'secondary' },
      { x: 0, y: 1, z: 0, role: 'visor' },
    ], undefined, undefined, 'v3', 2),
    id: 'v3_helmet_existing',
    createdAt: 10,
    updatedAt: 20,
  };
  existing.history = Array.from({ length: CUSTOM_ARMOR_MAX_HISTORY }, (_, index) => ({
    ...createCustomArmorSnapshot(existing),
    name: `History ${index}`,
    updatedAt: 100 + index,
  }));
  const previousSnapshot = createCustomArmorSnapshot(existing);
  const draft: CustomArmorPieceSnapshot = {
    ...previousSnapshot,
    name: 'Updated Helmet',
    voxels: [
      ...previousSnapshot.voxels,
      { x: 2, y: 0, z: 0, role: 'accent' },
    ],
    updatedAt: 30,
  };

  const result = upsertCustomArmorPieceInCatalog({ version: 1, pieces: [existing] }, draft, { now: 999 });

  assert.equal(result.catalog.pieces.length, 1);
  assert.equal(result.piece.createdAt, 10);
  assert.equal(result.piece.updatedAt, 999);
  assert.equal(result.piece.name, 'Updated Helmet');
  assert.equal(result.piece.history?.length, CUSTOM_ARMOR_MAX_HISTORY);
  assert.deepEqual(result.piece.history?.[0], previousSnapshot);
  assert.deepEqual(result.piece.history?.[1], existing.history[0]);
  assert.equal(result.piece.history?.some((entry) => entry.name === `History ${CUSTOM_ARMOR_MAX_HISTORY - 1}`), false);
  assert.deepEqual(result.snapshot, createCustomArmorSnapshot(result.piece));
});

test('upsertCustomArmorPieceInCatalog clones draft voxels before saving', () => {
  const firstVoxel: CustomArmorVoxel = { x: 0, y: 0, z: 0, role: 'primary' };
  const draft: CustomArmorPieceSnapshot = {
    version: 1,
    id: 'v3_helmet_clone_guard',
    name: 'Clone Guard',
    slot: 'helmet',
    modelSystem: 'v3',
    gridScale: 2,
    voxels: [
      firstVoxel,
      { x: 1, y: 0, z: 0, role: 'secondary' },
      { x: 0, y: 1, z: 0, role: 'visor' },
    ],
    updatedAt: 1,
  };

  const result = upsertCustomArmorPieceInCatalog({ version: 1, pieces: [] }, draft, { now: 111 });

  draft.voxels.push({ x: 9, y: 9, z: 9, role: 'accent' });
  firstVoxel.x = 7;
  firstVoxel.role = 'dark';

  assert.notStrictEqual(result.catalog.pieces[0].voxels, draft.voxels);
  assert.notStrictEqual(result.piece.voxels, draft.voxels);
  assert.notStrictEqual(result.catalog.pieces[0].voxels[0], firstVoxel);
  assert.notStrictEqual(result.piece.voxels[0], firstVoxel);
  assert.deepEqual(result.catalog.pieces[0].voxels, [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'secondary' },
    { x: 0, y: 1, z: 0, role: 'visor' },
  ]);
  assert.deepEqual(result.piece.voxels, [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'secondary' },
    { x: 0, y: 1, z: 0, role: 'visor' },
  ]);
});

test('upsertCustomArmorPieceInCatalog preserves V2 modelType and leaves V3 modelType undefined', () => {
  const v2Draft: CustomArmorPieceSnapshot = {
    version: 1,
    id: 'v2_large_torso',
    name: 'Large Torso',
    slot: 'torso',
    modelSystem: 'v2',
    modelType: 'large',
    gridScale: 2,
    voxels: [{ x: 0, y: 20, z: 0, role: 'primary' }],
    updatedAt: 1,
  };
  const v3Draft: CustomArmorPieceSnapshot = {
    version: 1,
    id: 'v3_chest',
    name: 'V3 Chest',
    slot: 'chest',
    modelSystem: 'v3',
    modelType: 'large',
    voxels: [{ x: 0, y: 0, z: 0, role: 'primary' }],
    updatedAt: 2,
  };

  const v2Result = upsertCustomArmorPieceInCatalog({ version: 1, pieces: [] }, v2Draft, { now: 50 });
  const v3Result = upsertCustomArmorPieceInCatalog({ version: 1, pieces: [] }, v3Draft, { now: 60 });

  assert.equal(v2Result.piece.modelSystem, 'v2');
  assert.equal(v2Result.piece.modelType, 'large');
  assert.equal(v2Result.piece.gridScale, undefined);
  assert.equal(v3Result.piece.modelSystem, 'v3');
  assert.equal(v3Result.piece.modelType, undefined);
  assert.equal(v3Result.piece.gridScale, 1);
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

test('sanitizeCharacterLoadoutForNetwork preserves sanitized V3 role paint only', () => {
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v3',
    paintJob: {
      v3RoleColors: {
        primary: '#ABCDEF',
        visor: '#00ffaa',
        accent: 'bad-color',
        rawMesh: '#ffffff',
      },
      v3RoleEmissive: {
        visor: true,
        primary: false,
        rawMesh: true,
      },
    },
  }) as any;

  assert.deepEqual(loadout.paintJob.v3RoleColors, { primary: '#abcdef', visor: '#00ffaa' });
  assert.deepEqual(loadout.paintJob.v3RoleEmissive, { primary: false, visor: true });
});

test('V3 custom armor slot ids remain aligned with V3 manifest slots', () => {
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const piece = createCustomArmorPiece(slot, `${slot} draft`, [], undefined, undefined, 'v3');
    assert.equal(piece.slot, slot);
    assert.equal(piece.modelSystem, 'v3');
  }
});

test('shared preview loadout signature tracks large custom armor without serializing voxels', async () => {
  const { getPreviewLoadoutSignature } = await import('./previewModelUtils');
  const voxels = Array.from({ length: 3_000 }, (_, index) => ({
    x: index,
    y: index % 40,
    z: index % 8,
    role: 'primary' as const,
  }));
  const baseSignature = getPreviewLoadoutSignature({
    modelSystem: 'v2',
    modelType: 'large',
    helmet: 'mark-vi',
    torso: 'mark-vi',
    customArmor: {
      torso: {
        version: 1,
        id: 'large-torso',
        name: 'Large Torso',
        slot: 'torso',
        modelType: 'large',
        voxels,
        updatedAt: 100,
      },
    },
  });
  const updatedSignature = getPreviewLoadoutSignature({
    modelSystem: 'v2',
    modelType: 'large',
    helmet: 'mark-vi',
    torso: 'mark-vi',
    customArmor: {
      torso: {
        version: 1,
        id: 'large-torso',
        name: 'Large Torso',
        slot: 'torso',
        modelType: 'large',
        voxels,
        updatedAt: 101,
      },
    },
  });

  assert.notEqual(baseSignature, updatedSignature);
  assert.ok(baseSignature.length < 400);
  assert.equal(baseSignature.includes('"voxels"'), false);
  assert.equal(baseSignature.includes('2999'), false);
});

test('shared preview loadout signature tracks V3 custom armor without serializing voxels', async () => {
  const { getPreviewLoadoutSignature } = await import('./previewModelUtils');
  const voxels = Array.from({ length: 1_000 }, (_, index) => ({
    x: index % 10,
    y: Math.floor(index / 10) % 10,
    z: Math.floor(index / 100),
    role: 'primary' as const,
  }));
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

  assert.ok(signature.includes('forearmRight:v3:v3-forearm'));
  assert.equal(signature.includes('"voxels"'), false);
  assert.equal(signature.includes('999'), false);
});

test('shared preview disposal releases nested mesh resources', async () => {
  const { disposePreviewObject } = await import('./previewModelUtils');
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const firstMaterial = new THREE.MeshBasicMaterial();
  const secondMaterial = new THREE.MeshBasicMaterial();
  let geometryDisposed = 0;
  let firstMaterialDisposed = 0;
  let secondMaterialDisposed = 0;
  geometry.dispose = () => {
    geometryDisposed += 1;
  };
  firstMaterial.dispose = () => {
    firstMaterialDisposed += 1;
  };
  secondMaterial.dispose = () => {
    secondMaterialDisposed += 1;
  };
  group.add(new THREE.Mesh(geometry, [firstMaterial, secondMaterial]));

  disposePreviewObject(group);

  assert.equal(geometryDisposed, 1);
  assert.equal(firstMaterialDisposed, 1);
  assert.equal(secondMaterialDisposed, 1);
});

test('duplicateCustomArmorPiece creates a new variant without copying history', () => {
  const piece = createCustomArmorPiece('helmet', 'Original', [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'secondary' },
    { x: 0, y: 1, z: 0, role: 'visor' },
  ], undefined, undefined, 'v3');
  piece.history = [createCustomArmorSnapshot(piece)];

  const copy = duplicateCustomArmorPiece(piece, 'Original Copy');

  assert.notEqual(copy.id, piece.id);
  assert.equal(copy.name, 'Original Copy');
  assert.equal(copy.modelSystem, 'v3');
  assert.equal(copy.history?.length ?? 0, 0);
  assert.deepEqual(copy.voxels, piece.voxels);
});

test('restoreCustomArmorHistoryEntry returns a current snapshot from piece history', () => {
  const piece = createCustomArmorPiece('helmet', 'Current', [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'secondary' },
    { x: 0, y: 1, z: 0, role: 'visor' },
  ], undefined, undefined, 'v3');
  piece.history = [{
    ...createCustomArmorSnapshot(piece),
    name: 'Previous',
    voxels: [{ x: 0, y: 0, z: 0, role: 'visor' }],
  }];

  const restored = restoreCustomArmorHistoryEntry(piece, 0);

  assert.equal(restored?.id, piece.id);
  assert.equal(restored?.name, 'Previous');
  assert.deepEqual(restored?.voxels, [{ x: 0, y: 0, z: 0, role: 'visor' }]);
});
