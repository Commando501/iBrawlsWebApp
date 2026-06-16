import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import {
  analyzeV3BuiltInSuitFidelity,
  analyzeV3PartFidelity,
  type V3PartFidelityIssueCode,
} from './v3SuitFidelity';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';
import { getV3BuiltinPartVoxels } from './VoxelModelsV3';

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

const scaffoldLimb = (): VoxelData[] => {
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

const issueCodes = (slotReport: ReturnType<typeof analyzeV3PartFidelity>): V3PartFidelityIssueCode[] =>
  slotReport.issues.map((issue) => issue.code);

const roundedSignature = (slotReport: ReturnType<typeof analyzeV3PartFidelity>): string =>
  [
    slotReport.metrics.frontCoverageRatio,
    slotReport.metrics.sideCoverageRatio,
    slotReport.metrics.centerGapRatio,
    slotReport.metrics.rowSpanVariation,
    slotReport.metrics.terminalTaperRatio,
    slotReport.metrics.panelDensity,
    slotReport.metrics.colorDiversity,
  ].map((value) => value.toFixed(4)).join('|');

describe('analyzeV3BuiltInSuitFidelity', () => {
  it('passes every built-in V3 slot without fidelity issues', () => {
    const reports = analyzeV3BuiltInSuitFidelity();

    assert.deepEqual(Object.keys(reports).sort(), [...V3_CHARACTER_SLOT_IDS].sort());

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const report = reports[slot];

      assert.equal(report.slot, slot);
      assert.ok(report.voxelCount > 0, `${slot} should have source voxels`);
      assert.ok(report.occupiedBounds.sizeX > 0, `${slot} should report x bounds`);
      assert.ok(report.occupiedBounds.sizeY > 0, `${slot} should report y bounds`);
      assert.ok(report.occupiedBounds.sizeZ > 0, `${slot} should report z bounds`);
      assert.ok(report.panelCount > 0, `${slot} should expose surface panel hierarchy`);
      assert.ok(report.exposedFaceCount > report.panelCount, `${slot} should merge faces into panels`);
      assert.equal(report.ready, true, `${slot} should be suit-fidelity ready: ${JSON.stringify(report.issues)}`);
      assert.deepEqual(report.issues, [], `${slot} should have no suit-fidelity issues`);
    }
  });

  it('keeps mirrored left and right built-ins silhouette-equivalent after normalization', () => {
    const reports = analyzeV3BuiltInSuitFidelity();
    const pairs = [
      ['shoulderLeft', 'shoulderRight'],
      ['upperArmLeft', 'upperArmRight'],
      ['forearmLeft', 'forearmRight'],
      ['handLeft', 'handRight'],
      ['thighLeft', 'thighRight'],
      ['shinLeft', 'shinRight'],
      ['footLeft', 'footRight'],
    ] as const;

    for (const [leftSlot, rightSlot] of pairs) {
      assert.equal(
        roundedSignature(reports[leftSlot]),
        roundedSignature(reports[rightSlot]),
        `${leftSlot}/${rightSlot} should share normalized silhouette signatures`
      );
    }
  });
});

describe('analyzeV3PartFidelity', () => {
  it('flags filled chest slabs with missing center gap and weak panel hierarchy', () => {
    const report = analyzeV3PartFidelity('chest', filledBox(18, 16, 12));
    const codes = issueCodes(report);

    assert.equal(report.ready, false);
    assert.ok(codes.includes('slab-profile'));
    assert.ok(codes.includes('center-gap-filled'));
    assert.ok(codes.includes('panel-hierarchy-flat'));
    assert.ok(report.metrics.frontCoverageRatio > 0.9);
    assert.ok(report.metrics.centerGapRatio < 0.2);
  });

  it('flags cube helmets without a tapered profile', () => {
    const report = analyzeV3PartFidelity('helmet', filledBox(12, 12, 12));
    const codes = issueCodes(report);

    assert.equal(report.ready, false);
    assert.ok(codes.includes('cube-profile'));
    assert.ok(codes.includes('terminal-taper-flat'));
    assert.equal(report.metrics.terminalTaperRatio, 1);
  });

  it('flags production geometry that has been flattened to one material group', () => {
    const monochromeHelmet = getV3BuiltinPartVoxels('helmet', 192).map((voxel) => ({
      ...voxel,
      color: TEST_COLOR,
      emissive: false,
    }));
    const report = analyzeV3PartFidelity('helmet', monochromeHelmet);
    const codes = issueCodes(report);

    assert.equal(report.ready, false);
    assert.ok(codes.includes('material-diversity-low'));
    assert.equal(report.materialDiversity.materialGroupCount, 1);
  });

  it('flags scaffold limbs with sparse vertical structure', () => {
    const report = analyzeV3PartFidelity('forearmRight', scaffoldLimb());
    const codes = issueCodes(report);

    assert.equal(report.ready, false);
    assert.ok(codes.includes('vertical-scaffold'));
    assert.ok(codes.includes('silhouette-too-sparse'));
    assert.ok(report.metrics.frontCoverageRatio < 0.35);
  });

  it('flags oversized hands that do not read as terminal pieces', () => {
    const report = analyzeV3PartFidelity('handRight', filledBox(9, 9, 9));
    const codes = issueCodes(report);

    assert.equal(report.ready, false);
    assert.ok(codes.includes('terminal-proportion-oversized'));
    assert.ok(codes.includes('cube-profile'));
    assert.ok(report.occupiedBounds.sizeY >= 9);
  });
});
