import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import {
  analyzeV3BuiltInShapeLanguage,
  analyzeV3ShapeLanguage,
} from './v3ShapeLanguage';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';

const TEST_COLOR = '#ffffff';

const filledBox = (width: number, height: number, depth: number): VoxelData[] => {
  const voxels: VoxelData[] = [];

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) {
        voxels.push({ x, y, z, color: TEST_COLOR });
      }
    }
  }

  return voxels;
};

const frontColumnLimb = (): VoxelData[] => {
  const voxels: VoxelData[] = [];

  for (let y = 0; y < 18; y += 1) {
    voxels.push({ x: 3, y, z: 5, color: TEST_COLOR });
  }

  for (const y of [0, 5, 10, 17]) {
    for (let x = 1; x <= 5; x += 1) {
      voxels.push({ x, y, z: 0, color: TEST_COLOR });
    }
  }

  return voxels;
};

const issueCodes = (report: ReturnType<typeof analyzeV3ShapeLanguage>): string[] =>
  report.issues.map((issue) => issue.code);

describe('analyzeV3BuiltInShapeLanguage', () => {
  it('passes every built-in V3 slot with no shape-language issues', () => {
    const reportBySlot = analyzeV3BuiltInShapeLanguage();

    assert.deepEqual(Object.keys(reportBySlot).sort(), [...V3_CHARACTER_SLOT_IDS].sort());

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const report = reportBySlot[slot];

      assert.equal(report.slot, slot);
      assert.ok(report.occupiedBounds.sizeX > 0, `${slot} should report occupied x bounds`);
      assert.ok(report.occupiedBounds.sizeY > 0, `${slot} should report occupied y bounds`);
      assert.ok(report.occupiedBounds.sizeZ > 0, `${slot} should report occupied z bounds`);
      assert.equal(Number.isFinite(report.depthRatio), true, `${slot} should report depth ratio`);
      assert.deepEqual(report.issues, [], `${slot} should satisfy V3 shape-language gates`);
    }
  });
});

describe('analyzeV3ShapeLanguage', () => {
  it('flags broad chest slabs that fill the pectoral center channel and front face', () => {
    const report = analyzeV3ShapeLanguage('chest', filledBox(18, 16, 12));

    assert.ok(issueCodes(report).includes('center-channel-filled'));
    assert.ok(issueCodes(report).includes('front-slab-coverage-high'));
    assert.ok(report.centerChannelFill > 0);
    assert.ok(report.frontSlabCoverage > 0.8);
  });

  it('flags cube helmets without a tapered crown', () => {
    const report = analyzeV3ShapeLanguage('helmet', filledBox(12, 12, 12));

    assert.ok(issueCodes(report).includes('crown-not-tapered'));
    assert.ok(report.crownTaper > 0.9);
  });

  it('flags limb payloads with full-height front scaffolding bars', () => {
    const report = analyzeV3ShapeLanguage('forearmRight', frontColumnLimb());

    assert.ok(issueCodes(report).includes('full-height-front-column'));
    assert.equal(report.hasFullHeightFrontColumn, true);
  });
});
