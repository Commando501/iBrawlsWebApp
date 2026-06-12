import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import {
  V3_PRODUCTION_QUALITY_THRESHOLDS,
  analyzeV3VoxelQuality,
  classifyV3ProductionReadiness,
} from './v3ProductionQuality';

const blockout: VoxelData[] = [
  { x: 0, y: 0, z: 0, color: '#111111' },
  { x: 1, y: 0, z: 0, color: '#111111' },
  { x: 0, y: 1, z: 0, color: '#111111' },
  { x: 1, y: 1, z: 0, color: '#111111' },
];

const productionCandidate: VoxelData[] = [
  { x: 0, y: 0, z: 0, color: '#111111' },
  { x: 2, y: 0, z: 0, color: '#222222' },
  { x: 0, y: 2, z: 0, color: '#333333' },
  { x: 1, y: 1, z: 1, color: '#44ccff', emissive: true },
  { x: 3, y: 1, z: 0, color: '#eeeeee' },
  { x: 1, y: 3, z: 0, color: '#ffcc00', emissive: true },
  { x: 0, y: 1, z: 2, color: '#222222' },
  { x: 2, y: 2, z: 2, color: '#333333' },
];

describe('V3 production quality audit', () => {
  it('measures material diversity, emissive detail, occupied span, and silhouette variation', () => {
    const report = analyzeV3VoxelQuality(productionCandidate);

    assert.equal(report.voxelCount, productionCandidate.length);
    assert.equal(report.materialCount, 6);
    assert.equal(report.emissiveVoxelCount, 2);
    assert.deepEqual(report.occupiedDimensions, { x: 4, y: 4, z: 3 });
    assert.equal(report.silhouetteColumnCount >= 7, true);
  });

  it('classifies plain blockouts below the production candidate threshold', () => {
    const report = analyzeV3VoxelQuality(blockout);

    assert.equal(classifyV3ProductionReadiness(report, V3_PRODUCTION_QUALITY_THRESHOLDS.characterPart), 'blockout');
  });

  it('classifies richer voxel payloads as production candidates', () => {
    const report = analyzeV3VoxelQuality(productionCandidate);

    assert.equal(
      classifyV3ProductionReadiness(report, {
        minVoxels: 8,
        minMaterials: 4,
        minEmissiveVoxels: 2,
        minSilhouetteColumns: 7,
      }),
      'productionCandidate'
    );
  });
});
