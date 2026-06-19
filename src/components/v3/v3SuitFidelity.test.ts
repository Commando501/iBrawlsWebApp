import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import type {
  V3ReferenceFeatureGuide,
  V3ReferenceFeaturePanelZoneKind,
  V3ReferenceFeatureSlot,
  V3ReferenceFeatureSlotGuide,
} from '../../tools/v3ReferenceFeatureGuide';
import {
  analyzeV3BuiltInReferenceFeatureMatch,
  analyzeV3BuiltInSuitFidelity,
  analyzeV3PartFidelity,
  analyzeV3ReferenceFeatureMatch,
  type V3PartFidelityIssueCode,
} from './v3SuitFidelity';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';
import { getV3BuiltinPartVoxels } from './VoxelModelsV3';

const TEST_COLOR = '#ffffff';
const REFERENCE_COLORS = {
  primary: '#101010',
  secondary: '#202020',
  accent: '#303030',
  visor: '#404040',
  emissive: '#505050',
  decal: '#606060',
  fixed: '#707070',
} as const;

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

const recolorWhere = (
  voxels: readonly VoxelData[],
  color: string,
  predicate: (voxel: VoxelData) => boolean
): VoxelData[] => voxels.map((voxel) => (predicate(voxel) ? { ...voxel, color } : voxel));

const roleColoredHelmetBlockout = (): VoxelData[] => {
  let voxels: VoxelData[] = filledBox(10, 8, 8).map((voxel) => ({ ...voxel, color: REFERENCE_COLORS.primary }));
  voxels = recolorWhere(voxels, REFERENCE_COLORS.secondary, (voxel) => voxel.y >= 5 && voxel.z <= 6);
  voxels = recolorWhere(voxels, REFERENCE_COLORS.fixed, (voxel) => voxel.z === 7 && voxel.y <= 2);
  voxels = recolorWhere(voxels, REFERENCE_COLORS.visor, (voxel) => voxel.z === 7 && voxel.y >= 4);
  return voxels;
};

const roleColoredChestBlockout = (): VoxelData[] => {
  let voxels: VoxelData[] = filledBox(20, 16, 8).map((voxel) => ({ ...voxel, color: REFERENCE_COLORS.primary }));
  voxels = recolorWhere(voxels, REFERENCE_COLORS.secondary, (voxel) => voxel.z === 7 && voxel.y >= 10);
  voxels = recolorWhere(voxels, REFERENCE_COLORS.fixed, (voxel) => voxel.z === 7 && voxel.y >= 5 && voxel.y <= 10);
  voxels = recolorWhere(voxels, REFERENCE_COLORS.decal, (voxel) => voxel.z === 7 && Math.abs(voxel.x - 10) <= 1 && voxel.y >= 8);
  return voxels;
};

const roleColoredBackBlockout = (): VoxelData[] => {
  let voxels: VoxelData[] = filledBox(16, 14, 8).map((voxel) => ({ ...voxel, color: REFERENCE_COLORS.primary }));
  voxels = recolorWhere(voxels, REFERENCE_COLORS.secondary, (voxel) => voxel.z === 0 && voxel.y >= 4);
  voxels = recolorWhere(voxels, REFERENCE_COLORS.emissive, (voxel) => voxel.z === 0 && Math.abs(voxel.x - 8) <= 1 && voxel.y >= 4);
  return voxels;
};

const roleColoredShoulderBlockout = (): VoxelData[] => {
  let voxels: VoxelData[] = filledBox(12, 10, 8).map((voxel) => ({ ...voxel, color: REFERENCE_COLORS.primary }));
  voxels = recolorWhere(voxels, REFERENCE_COLORS.accent, (voxel) => voxel.y <= 1);
  voxels = recolorWhere(voxels, REFERENCE_COLORS.secondary, (voxel) => voxel.z === 7 && voxel.y >= 5);
  return voxels;
};

const makePanelZone = (kind: V3ReferenceFeaturePanelZoneKind) => ({
  kind,
  objectCount: 1,
  verticalBand: 'middle' as const,
  side: 'center' as const,
  materialRoleHints: [],
});

const makeSlotGuide = (
  slot: V3ReferenceFeatureSlot,
  panelKinds: readonly V3ReferenceFeaturePanelZoneKind[]
): V3ReferenceFeatureSlotGuide => ({
  slot,
  objectCount: Math.max(1, panelKinds.length),
  objectNames: panelKinds.length === 0 ? [`${slot}-placeholder`] : panelKinds.map((kind) => `${slot}-${kind}`),
  materialRoleHints: [],
  boundsRatio: {
    widthToReferenceHeight: 0.1,
    depthToReferenceHeight: 0.1,
    heightToReferenceHeight: 0.1,
  },
  verticalRange: {
    minRatio: 0,
    maxRatio: 1,
  },
  panelZones: panelKinds.map(makePanelZone),
  centerlineGaps: [],
  ridgeHints: [],
  ventHints: [],
  channelHints: [],
  symmetrySignature: {
    leftCount: 0,
    rightCount: 0,
    centerCount: 1,
    pairedObjectCount: 0,
    balance: 1,
    hasLeftRightPair: false,
  },
});

const makeReferenceGuide = (slotGuides: readonly V3ReferenceFeatureSlotGuide[]): V3ReferenceFeatureGuide => ({
  schemaVersion: 'v3-reference-feature-guide/v1',
  version: 1,
  source: {
    kind: 'obj',
    canonicalKind: 'obj',
    fileName: 'synthetic-phase-35-guide.obj',
    label: 'synthetic phase 35 guide',
    metadata: {
      objectCount: slotGuides.reduce((total, slotGuide) => total + slotGuide.objectCount, 0),
      materialCount: 0,
      vertexCount: 0,
      faceCount: 0,
      triangleCountEstimate: 0,
    },
  },
  slotOrder: slotGuides.map((slotGuide) => slotGuide.slot),
  slotGuides: [...slotGuides],
  summary: {
    slotCount: slotGuides.length,
    objectCount: slotGuides.reduce((total, slotGuide) => total + slotGuide.objectCount, 0),
    materialRoleHints: [],
    symmetrySignature: {
      leftCount: 0,
      rightCount: 0,
      centerCount: slotGuides.length,
      pairedObjectCount: 0,
      balance: 1,
      hasLeftRightPair: false,
    },
  },
});

const issueCodes = (slotReport: ReturnType<typeof analyzeV3PartFidelity>): V3PartFidelityIssueCode[] =>
  slotReport.issues.map((issue) => issue.code);

const metricVector = (slotReport: ReturnType<typeof analyzeV3PartFidelity>): number[] => [
  slotReport.metrics.frontCoverageRatio,
  slotReport.metrics.sideCoverageRatio,
  slotReport.metrics.centerGapRatio,
  slotReport.metrics.rowSpanVariation,
  slotReport.metrics.terminalTaperRatio,
  slotReport.metrics.panelDensity,
  slotReport.metrics.colorDiversity,
];

describe('analyzeV3BuiltInSuitFidelity', () => {
  it('decodes every exact OBJ-source built-in V3 slot and reports known Phase 38 fidelity blockers', () => {
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
    }

    const blockedSlots = V3_CHARACTER_SLOT_IDS.filter((slot) => !reports[slot].ready);
    assert.deepEqual(blockedSlots.sort(), ['back', 'forearmLeft', 'forearmRight', 'handLeft', 'handRight']);
    assert.ok(reports.forearmLeft.issues.some((issue) => issue.code === 'material-diversity-low'));
    assert.ok(reports.forearmRight.issues.some((issue) => issue.code === 'material-diversity-low'));
    assert.ok(reports.handLeft.issues.some((issue) => issue.code === 'terminal-proportion-oversized'));
    assert.ok(reports.handRight.issues.some((issue) => issue.code === 'terminal-proportion-oversized'));
    assert.ok(reports.back.issues.some((issue) => issue.code === 'slab-profile'));
  });

  it('keeps paired exact OBJ-source built-ins close after normalization', () => {
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
      const deltas = metricVector(reports[leftSlot]).map((value, index) =>
        Math.abs(value - metricVector(reports[rightSlot])[index])
      );
      assert.ok(Math.max(...deltas) <= 0.08, `${leftSlot}/${rightSlot} should stay near-mirrored: ${deltas.join(', ')}`);
    }
  });

  it('keeps reference feature-match blocked with actionable exact-source gaps', () => {
    const report = analyzeV3BuiltInReferenceFeatureMatch();

    assert.equal(report.ready, false);
    assert.ok(report.summary.slotCount >= 18, 'neck is excluded, every guided armor slot is checked');
    assert.ok(report.summary.averageScore < 0.9, `Phase 38 should keep feature-match blockers visible: ${report.summary.averageScore}`);
    assert.ok(report.summary.issueCount > 0);
    assert.ok(report.issues.some((issue) => issue.code === 'missing-reference-feature' && issue.slot === 'chest'));
    assert.ok(report.issues.some((issue) => issue.code === 'material-role-diversity-low' && issue.slot === 'forearmLeft'));
    assert.ok(report.issues.some((issue) => issue.code === 'slot-fidelity-blocked' && issue.slot === 'back'));

    const helmet = report.slots.helmet;
    const chest = report.slots.chest;
    const back = report.slots.back;
    const shin = report.slots.shinRight;
    const foot = report.slots.footRight;

    assert.equal(helmet?.features.find((feature) => feature.kind === 'visor')?.present, true);
    assert.equal(helmet?.features.find((feature) => feature.kind === 'jaw')?.present, true);
    assert.equal(helmet?.features.find((feature) => feature.kind === 'crown')?.present, true);
    assert.equal(chest?.features.find((feature) => feature.kind === 'pectoral')?.present, true);
    assert.equal(chest?.features.find((feature) => feature.kind === 'core')?.present, true);
    assert.equal(chest?.features.find((feature) => feature.kind === 'abdomen')?.present, false);
    assert.equal(back?.features.find((feature) => feature.kind === 'rail')?.present, true);
    assert.equal(back?.features.find((feature) => feature.kind === 'spine')?.present, true);
    assert.equal(shin?.features.find((feature) => feature.kind === 'knee')?.present, true);
    assert.equal(foot?.features.find((feature) => feature.kind === 'toe')?.present, false);
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
    const report = analyzeV3PartFidelity('handRight', filledBox(13, 13, 13));
    const codes = issueCodes(report);

    assert.equal(report.ready, false);
    assert.ok(codes.includes('terminal-proportion-oversized'));
    assert.ok(codes.includes('cube-profile'));
    assert.ok(report.occupiedBounds.sizeY >= 13);
  });
});

describe('analyzeV3ReferenceFeatureMatch', () => {
  it('fails a blockout fixture that lacks role contrast and reference feature hierarchy', () => {
    const report = analyzeV3ReferenceFeatureMatch({
      slots: ['helmet'],
      voxelsBySlot: {
        helmet: filledBox(10, 8, 8),
      },
    });
    const helmet = report.slots.helmet;

    assert.equal(report.ready, false);
    assert.equal(helmet?.ready, false);
    assert.ok(helmet?.issues.some((issue) => issue.code === 'missing-reference-feature'));
    assert.ok(helmet?.issues.some((issue) => issue.code === 'material-role-diversity-low'));
    assert.ok((helmet?.score ?? 1) < 0.5);
  });

  it('fails role-colored blockouts that only paint expected feature bands onto a filled box', () => {
    const report = analyzeV3ReferenceFeatureMatch({
      slots: ['helmet'],
      voxelsBySlot: {
        helmet: roleColoredHelmetBlockout(),
      },
    });
    const helmet = report.slots.helmet;

    assert.ok((helmet?.score ?? 0) >= 0.66, 'the fixture intentionally satisfies most old feature-count gates');
    assert.equal(report.ready, false);
    assert.equal(helmet?.ready, false);
    assert.ok(helmet?.issues.some((issue) => issue.code === 'slot-fidelity-blocked'));
  });

  it('fails helmet, chest, back, and shoulder matches when guide coverage omits their required zones', () => {
    const report = analyzeV3ReferenceFeatureMatch({
      guide: makeReferenceGuide([
        makeSlotGuide('helmet', ['visor']),
        makeSlotGuide('chest', ['pectoral']),
        makeSlotGuide('back', ['rail']),
        makeSlotGuide('shoulder', []),
      ]),
      slots: ['helmet', 'chest', 'back', 'shoulderRight'],
      voxelsBySlot: {
        helmet: roleColoredHelmetBlockout(),
        chest: roleColoredChestBlockout(),
        back: roleColoredBackBlockout(),
        shoulderRight: roleColoredShoulderBlockout(),
      },
    });
    const missingGuideSlots = new Set(
      report.issues
        .filter((issue) => issue.code === 'missing-guide-coverage')
        .map((issue) => issue.slot)
    );

    assert.equal(report.ready, false);
    assert.deepEqual(
      [...missingGuideSlots].sort(),
      ['back', 'chest', 'helmet', 'shoulderRight'].sort()
    );
    assert.equal(report.slots.helmet?.ready, false);
    assert.equal(report.slots.chest?.ready, false);
    assert.equal(report.slots.back?.ready, false);
    assert.equal(report.slots.shoulderRight?.ready, false);
  });
});
