import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateV3VoxelAsset } from './v3AssetValidation';
import type { V3PreviewVoxel } from './v3Voxelize';

const voxels: V3PreviewVoxel[] = [
  { x: 0, y: 0, z: 0, material: 'armor_primary' },
  { x: 1, y: 0, z: 0, material: 'armor_primary' },
  { x: 1, y: 1, z: 0, material: 'armor_secondary' },
];

describe('validateV3VoxelAsset', () => {
  it('accepts connected voxels inside budget and bounds', () => {
    const result = validateV3VoxelAsset({
      voxels,
      maxVoxels: 8,
      allowedBounds: { min: [0, 0, 0], max: [2, 2, 2] },
      requiredMaterials: ['armor_primary'],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.voxelCount, 3);
    assert.equal(result.connectedComponentCount, 1);
    assert.deepEqual(result.materials, ['armor_primary', 'armor_secondary']);
  });

  it('reports budget, bounds, material, and connectivity failures', () => {
    const result = validateV3VoxelAsset({
      voxels: [
        ...voxels,
        { x: 9, y: 9, z: 9, material: 'loose' },
      ],
      maxVoxels: 2,
      allowedBounds: { min: [0, 0, 0], max: [2, 2, 2] },
      requiredMaterials: ['visor'],
    });

    assert.deepEqual(result.errors, [
      'voxel count 4 exceeds budget 2',
      'voxel 9,9,9 is outside allowed bounds',
      'missing required material visor',
      'asset has 2 disconnected components',
    ]);
    assert.equal(result.connectedComponentCount, 2);
    assert.deepEqual(result.materials, ['armor_primary', 'armor_secondary', 'loose']);
  });

  it('treats face-touching voxels as connected and diagonal voxels as separate', () => {
    assert.equal(validateV3VoxelAsset({
      voxels: [
        { x: 0, y: 0, z: 0, material: 'a' },
        { x: 0, y: 0, z: 1, material: 'a' },
      ],
      maxVoxels: 4,
      allowedBounds: { min: [0, 0, 0], max: [2, 2, 2] },
    }).connectedComponentCount, 1);

    assert.equal(validateV3VoxelAsset({
      voxels: [
        { x: 0, y: 0, z: 0, material: 'a' },
        { x: 1, y: 1, z: 1, material: 'a' },
      ],
      maxVoxels: 4,
      allowedBounds: { min: [0, 0, 0], max: [2, 2, 2] },
    }).connectedComponentCount, 2);
  });
});
