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
