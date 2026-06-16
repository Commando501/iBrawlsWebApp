import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import {
  appendV3ArmorPlate,
  appendV3InsetChannel,
  appendV3SegmentedBand,
  appendV3SteppedRidge,
  appendV3TaperedArmorPlate,
  appendV3VentPair,
} from './v3ArmorSculpt';

const hasVoxel = (voxels: VoxelData[], x: number, y: number, z: number): boolean =>
  voxels.some((voxel) => voxel.x === x && voxel.y === y && voxel.z === z);

const voxelsAtY = (voxels: VoxelData[], y: number): VoxelData[] =>
  voxels.filter((voxel) => voxel.y === y);

const uniqueValues = (voxels: VoxelData[], axis: 'x' | 'y' | 'z'): number[] =>
  [...new Set(voxels.map((voxel) => voxel[axis]))].sort((a, b) => a - b);

describe('V3 armor sculpt primitives', () => {
  it('adds a tapered plate that narrows across its taper axis and stays in bounds', () => {
    const voxels: VoxelData[] = [];

    appendV3TaperedArmorPlate(voxels, {
      origin: [2, 3, 1],
      dimensions: [7, 4, 2],
      taperAxis: 'x',
      taperAmount: 2,
      color: '#38bdf8',
    });

    const bottomRowXs = uniqueValues(voxelsAtY(voxels, 3), 'x');
    const topRowXs = uniqueValues(voxelsAtY(voxels, 6), 'x');

    assert.ok(bottomRowXs.length > topRowXs.length);
    assert.deepEqual(bottomRowXs, [2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(topRowXs, [4, 5, 6]);
    assert.ok(voxels.every((voxel) => voxel.x >= 2 && voxel.x < 9));
    assert.ok(voxels.every((voxel) => voxel.y >= 3 && voxel.y < 7));
    assert.ok(voxels.every((voxel) => voxel.z >= 1 && voxel.z < 3));
  });

  it('adds a stepped ridge as separated segments instead of one solid bar', () => {
    const voxels: VoxelData[] = [];

    appendV3SteppedRidge(voxels, {
      origin: [0, 2, 4],
      axis: 'x',
      length: 8,
      width: 1,
      stepEvery: 2,
      gapEvery: 1,
      color: '#facc15',
    });

    assert.deepEqual(uniqueValues(voxels, 'x'), [0, 1, 3, 4, 6, 7]);
    assert.equal(hasVoxel(voxels, 2, 2, 4), false);
    assert.equal(hasVoxel(voxels, 5, 2, 4), false);
  });

  it('removes a visible center seam from a filled plate', () => {
    const voxels: VoxelData[] = [];
    appendV3ArmorPlate(voxels, {
      origin: [0, 0, 0],
      dimensions: [5, 3, 1],
      color: '#64748b',
    });

    appendV3InsetChannel(voxels, {
      axis: 'y',
      fixed: { x: 2, z: 0 },
      mode: 'remove',
    });

    assert.equal(voxels.length, 12);
    assert.equal(hasVoxel(voxels, 2, 0, 0), false);
    assert.equal(hasVoxel(voxels, 2, 1, 0), false);
    assert.equal(hasVoxel(voxels, 2, 2, 0), false);
  });

  it('adds symmetrical vent pairs around center x and preserves material flags', () => {
    const voxels: VoxelData[] = [];

    appendV3VentPair(voxels, {
      centerX: 6,
      y: 1,
      z: 0,
      pairs: 2,
      spacing: 2,
      color: '#22d3ee',
      emissive: true,
    });

    assert.deepEqual(uniqueValues(voxels, 'x'), [2, 4, 8, 10]);
    assert.equal(voxels.length, 4);
    assert.ok(voxels.every((voxel) => voxel.y === 1 && voxel.z === 0));
    assert.ok(voxels.every((voxel) => voxel.color === '#22d3ee' && voxel.emissive === true));
  });

  it('adds a segmented band with deterministic gaps inside the requested dimensions', () => {
    const voxels: VoxelData[] = [];

    appendV3SegmentedBand(voxels, {
      origin: [1, 2, 0],
      dimensions: [8, 2, 1],
      axis: 'x',
      segmentLength: 2,
      gapLength: 1,
      color: '#a855f7',
    });

    assert.deepEqual(uniqueValues(voxels, 'x'), [1, 2, 4, 5, 7, 8]);
    assert.equal(voxels.length, 12);
    assert.ok(voxels.every((voxel) => voxel.x >= 1 && voxel.x < 9));
    assert.ok(voxels.every((voxel) => voxel.y >= 2 && voxel.y < 4));
    assert.ok(voxels.every((voxel) => voxel.z === 0));
    assert.equal(hasVoxel(voxels, 3, 2, 0), false);
    assert.equal(hasVoxel(voxels, 6, 3, 0), false);
  });
});
