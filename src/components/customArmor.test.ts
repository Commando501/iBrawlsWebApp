import test from 'node:test';
import assert from 'node:assert/strict';
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

const cloneBuiltInPiece = (slot: CustomArmorSlot, preset: string, sourceSlot: string) => {
  const voxels = getVoxelSegmentDataV2(sourceSlot, preset, 200, false);
  return createCustomArmorPiece(slot, `${preset} clone`, voxelDataToCustomArmorVoxels(voxels), preset);
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
