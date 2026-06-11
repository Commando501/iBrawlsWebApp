import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AVAILABLE_PRESETS } from './VoxelModels';
import { getVoxelSegmentDataV2 } from './VoxelModelsV2';
import {
  createCustomArmorPiece,
  createCustomArmorSnapshot,
  normalizeCustomArmorCatalog,
  removeFloatingVoxels,
  sanitizeCharacterLoadoutForNetwork,
  seedCornerAnchor,
  validateCustomArmorPiece,
  voxelDataToCustomArmorVoxels,
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
