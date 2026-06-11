import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  voxelizeBoundsPreview,
  voxelizeTriangleBoundsPreview,
  type V3PreviewTriangle,
} from './v3Voxelize';

describe('voxelizeBoundsPreview', () => {
  it('fills a deterministic voxel shell for a bounded part', () => {
    const preview = voxelizeBoundsPreview({
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      resolution: 4,
      material: 'armor_primary',
    });

    assert.equal(preview.resolution, 4);
    assert.equal(preview.voxels.length, 56);
    assert.deepEqual(preview.voxels[0], { x: 0, y: 0, z: 0, material: 'armor_primary' });
    assert.equal(preview.voxels.some((voxel) => voxel.x === 1 && voxel.y === 1 && voxel.z === 1), false);
  });

  it('clamps invalid resolutions to a single occupied voxel', () => {
    const preview = voxelizeBoundsPreview({
      bounds: { min: [-2, -1, 0], max: [2, 1, 3] },
      resolution: 0,
      material: 'fallback',
    });

    assert.equal(preview.resolution, 1);
    assert.deepEqual(preview.voxels, [{ x: 0, y: 0, z: 0, material: 'fallback' }]);
  });
});

describe('voxelizeTriangleBoundsPreview', () => {
  it('marks voxels overlapped by triangle bounding boxes', () => {
    const preview = voxelizeTriangleBoundsPreview({
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      resolution: 4,
      triangles: [
        { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], material: 'visor' },
      ],
    });

    assert.equal(preview.voxels.length, 16);
    assert.equal(preview.voxels.every((voxel) => voxel.z === 0), true);
    assert.deepEqual(preview.voxels[0], { x: 0, y: 0, z: 0, material: 'visor' });
  });

  it('deduplicates overlapping cells per material while preserving distinct materials', () => {
    const triangle: Omit<V3PreviewTriangle, 'material'> = {
      a: [0, 0, 0],
      b: [1, 0, 0],
      c: [0, 1, 0],
    };
    const preview = voxelizeTriangleBoundsPreview({
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      resolution: 4,
      triangles: [
        { ...triangle, material: 'visor' },
        { ...triangle, material: 'visor' },
        { ...triangle, material: 'decal' },
      ],
    });

    assert.equal(preview.voxels.length, 32);
    assert.equal(preview.voxels.filter((voxel) => voxel.material === 'visor').length, 16);
    assert.equal(preview.voxels.filter((voxel) => voxel.material === 'decal').length, 16);
  });
});
