import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import {
  appendV3ArmorPlate,
  appendV3InsetChannel,
  appendV3MirroredReferenceFeature,
  appendV3ProjectedPanelZone,
  appendV3ReferenceVentSet,
  appendV3SegmentedBand,
  appendV3SteppedRidge,
  appendV3TaperedArmorPlate,
  appendV3VentPair,
  buildV3ReferenceTaperProfile,
  carveV3NotchedSeam,
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

  it('projects a normalized panel zone into clamped integer bounds and overwrites duplicate cells', () => {
    const voxels: VoxelData[] = [
      { x: 0, y: 2, z: 2, color: '#111827', emissive: false },
    ];

    appendV3ProjectedPanelZone(voxels, {
      dimensions: [6, 5, 3],
      zone: {
        xMinRatio: -0.25,
        xMaxRatio: 0.35,
        yMinRatio: 0.4,
        yMaxRatio: 1.2,
      },
      z: 8,
      color: '#38bdf8',
      emissive: true,
    });

    assert.deepEqual(uniqueValues(voxels, 'x'), [0, 1, 2]);
    assert.deepEqual(uniqueValues(voxels, 'y'), [2, 3, 4]);
    assert.deepEqual(uniqueValues(voxels, 'z'), [2]);
    assert.equal(voxels.length, 9);
    const overwritten = voxels.find((voxel) => voxel.x === 0 && voxel.y === 2 && voxel.z === 2);
    assert.equal(overwritten?.color, '#38bdf8');
    assert.equal(overwritten?.emissive, true);
  });

  it('carves a notched seam while preserving deterministic cells on tiny parts', () => {
    const voxels: VoxelData[] = [];
    appendV3ArmorPlate(voxels, {
      origin: [0, 0, 0],
      dimensions: [1, 3, 1],
      color: '#64748b',
    });

    carveV3NotchedSeam(voxels, {
      dimensions: [1, 3, 1],
      axis: 'x',
      positionRatio: 0.5,
      width: 1,
      z: 0,
      preserveEvery: 2,
    });

    assert.equal(voxels.length, 2);
    assert.equal(hasVoxel(voxels, 0, 0, 0), true);
    assert.equal(hasVoxel(voxels, 0, 1, 0), false);
    assert.equal(hasVoxel(voxels, 0, 2, 0), true);
  });

  it('places a deterministic reference vent set with the requested count', () => {
    const voxels: VoxelData[] = [];

    appendV3ReferenceVentSet(voxels, {
      dimensions: [8, 4, 2],
      side: 'left',
      yRatio: 0.5,
      z: 3,
      count: 3,
      color: '#22d3ee',
      emissive: true,
    });

    assert.deepEqual(uniqueValues(voxels, 'x'), [0, 1, 2]);
    assert.equal(voxels.length, 3);
    assert.ok(voxels.every((voxel) => voxel.y === 2 && voxel.z === 1));
    assert.ok(voxels.every((voxel) => voxel.color === '#22d3ee' && voxel.emissive === true));
  });

  it('mirrors a bounded reference feature around local x', () => {
    const voxels: VoxelData[] = [];

    appendV3MirroredReferenceFeature(voxels, {
      dimensions: [8, 6, 3],
      origin: [1, 2, 1],
      featureDimensions: [2, 2, 1],
      color: '#f97316',
    });

    assert.deepEqual(uniqueValues(voxels, 'x'), [1, 2, 5, 6]);
    assert.deepEqual(uniqueValues(voxels, 'y'), [2, 3]);
    assert.deepEqual(uniqueValues(voxels, 'z'), [1]);
    assert.equal(voxels.length, 8);
  });

  it('builds a reference taper profile from normalized width and depth bands', () => {
    const profile = buildV3ReferenceTaperProfile([10, 5, 8], [
      { yRatio: 1, widthRatio: 0.2, depthRatio: 0.25 },
      { yRatio: 0, widthRatio: 1, depthRatio: 1 },
      { yRatio: 0.5, widthRatio: 0.6, depthRatio: 0.5 },
    ]);

    assert.deepEqual(profile.xInsets, [[0, 0], [0.5, 2], [1, 4]]);
    assert.deepEqual(profile.zInsets, [[0, 0], [0.5, 2], [1, 3]]);
  });
});
