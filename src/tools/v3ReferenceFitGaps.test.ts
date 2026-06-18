import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeV3ReferenceFitGaps,
  formatV3ReferenceFitGapSummary,
  type V3ReferenceFitGapBounds,
} from './v3ReferenceFitGaps';
import type { V3ReferenceFeatureGuide } from './v3ReferenceFeatureGuide';

const guide = {
  schemaVersion: 'v3-reference-feature-guide/v1',
  version: 1,
  source: {
    kind: 'obj',
    canonicalKind: 'obj',
    fileName: 'reference.obj',
    label: 'reference',
    metadata: {
      objectCount: 3,
      materialCount: 1,
      vertexCount: 0,
      faceCount: 0,
      triangleCountEstimate: 0,
    },
  },
  slotOrder: ['chest', 'shoulder', 'shin'],
  slotGuides: [
    {
      slot: 'chest',
      objectCount: 1,
      objectNames: ['Chest'],
      materialRoleHints: ['primary'],
      boundsRatio: {
        widthToReferenceHeight: 0.32,
        depthToReferenceHeight: 0.18,
        heightToReferenceHeight: 0.18,
      },
      verticalRange: { minRatio: 0.58, maxRatio: 0.76 },
      panelZones: [],
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
    },
    {
      slot: 'shoulder',
      objectCount: 2,
      objectNames: ['Shoulder_L', 'Shoulder_R'],
      materialRoleHints: ['primary'],
      boundsRatio: {
        widthToReferenceHeight: 0.46,
        depthToReferenceHeight: 0.13,
        heightToReferenceHeight: 0.12,
      },
      verticalRange: { minRatio: 0.63, maxRatio: 0.75 },
      panelZones: [],
      centerlineGaps: [],
      ridgeHints: [],
      ventHints: [],
      channelHints: [],
      symmetrySignature: {
        leftCount: 1,
        rightCount: 1,
        centerCount: 0,
        pairedObjectCount: 2,
        balance: 1,
        hasLeftRightPair: true,
      },
    },
    {
      slot: 'shin',
      objectCount: 2,
      objectNames: ['Shin_L', 'Shin_R'],
      materialRoleHints: ['secondary'],
      boundsRatio: {
        widthToReferenceHeight: 0.26,
        depthToReferenceHeight: 0.09,
        heightToReferenceHeight: 0.2,
      },
      verticalRange: { minRatio: 0.1, maxRatio: 0.3 },
      panelZones: [],
      centerlineGaps: [],
      ridgeHints: [],
      ventHints: [],
      channelHints: [],
      symmetrySignature: {
        leftCount: 1,
        rightCount: 1,
        centerCount: 0,
        pairedObjectCount: 2,
        balance: 1,
        hasLeftRightPair: true,
      },
    },
  ],
  summary: {
    slotCount: 3,
    objectCount: 3,
    materialRoleHints: ['primary', 'secondary'],
    symmetrySignature: {
      leftCount: 2,
      rightCount: 2,
      centerCount: 1,
      pairedObjectCount: 4,
      balance: 1,
      hasLeftRightPair: true,
    },
  },
} satisfies V3ReferenceFeatureGuide;

const bounds = ({
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ,
}: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}): V3ReferenceFitGapBounds => ({
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ,
});

test('analyzeV3ReferenceFitGaps ranks oversized and undersized slot-family mismatches', () => {
  const report = analyzeV3ReferenceFitGaps(guide, {
    modelHeight: 100,
    boundsBySlot: {
      chest: bounds({ minX: -22, maxX: 22, minY: 58, maxY: 77, minZ: -12, maxZ: 12 }),
      shoulderLeft: bounds({ minX: -35, maxX: -18, minY: 64, maxY: 76, minZ: -7, maxZ: 7 }),
      shoulderRight: bounds({ minX: 18, maxX: 35, minY: 64, maxY: 76, minZ: -7, maxZ: 7 }),
      shinLeft: bounds({ minX: -8, maxX: -4, minY: 11, maxY: 26, minZ: -3, maxZ: 3 }),
      shinRight: bounds({ minX: 4, maxX: 8, minY: 11, maxY: 26, minZ: -3, maxZ: 3 }),
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.summary.slotCount, 3);
  assert.equal(report.summary.issueCount, 4);
  assert.equal(report.slots[0].slot, 'shoulder');
  assert.equal(report.slots[0].issues[0].code, 'too-wide');
  assert.equal(report.slots[0].issues[0].direction, 'too-large');
  assert.equal(report.slots[1].slot, 'chest');
  assert.equal(report.slots[1].issues[0].code, 'too-wide');
  assert.equal(report.slots[2].slot, 'shin');
  assert.equal(report.slots[2].issues[0].code, 'too-narrow');
  assert.deepEqual(report.slots[2].v3Slots, ['shinLeft', 'shinRight']);

  const summary = formatV3ReferenceFitGapSummary(report);
  assert.match(summary, /Reference Fit Gaps blocked/);
  assert.match(summary, /chest width too wide/);
  assert.match(summary, /shoulder width too wide/);
  assert.match(summary, /shin width too narrow/);
});

test('analyzeV3ReferenceFitGaps passes matched synthetic slot families', () => {
  const report = analyzeV3ReferenceFitGaps(guide, {
    modelHeight: 100,
    boundsBySlot: {
      chest: bounds({ minX: -16, maxX: 16, minY: 58, maxY: 76, minZ: -9, maxZ: 9 }),
      shoulderLeft: bounds({ minX: -23, maxX: -18, minY: 63, maxY: 75, minZ: -6, maxZ: 6 }),
      shoulderRight: bounds({ minX: 18, maxX: 23, minY: 63, maxY: 75, minZ: -6, maxZ: 6 }),
      shinLeft: bounds({ minX: -13, maxX: -5, minY: 10, maxY: 30, minZ: -4, maxZ: 5 }),
      shinRight: bounds({ minX: 5, maxX: 13, minY: 10, maxY: 30, minZ: -4, maxZ: 5 }),
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.summary.issueCount, 0);
  assert.equal(formatV3ReferenceFitGapSummary(report), 'Reference Fit Gaps ready: 3/3 slot families within tolerance.');
});

test('analyzeV3ReferenceFitGaps flags implausible reference targets before ranking model gaps', () => {
  const noisyGuide: V3ReferenceFeatureGuide = {
    ...guide,
    slotGuides: guide.slotGuides.map((slotGuide) =>
      slotGuide.slot === 'shin'
        ? {
          ...slotGuide,
          boundsRatio: {
            ...slotGuide.boundsRatio,
            depthToReferenceHeight: 0.055,
            heightToReferenceHeight: 0.07,
          },
          verticalRange: { minRatio: 0.245, maxRatio: 0.315 },
        }
        : slotGuide
    ),
  };

  const report = analyzeV3ReferenceFitGaps(noisyGuide, {
    modelHeight: 100,
    boundsBySlot: {
      chest: bounds({ minX: -16, maxX: 16, minY: 58, maxY: 76, minZ: -9, maxZ: 9 }),
      shoulderLeft: bounds({ minX: -23, maxX: -18, minY: 63, maxY: 75, minZ: -6, maxZ: 6 }),
      shoulderRight: bounds({ minX: 18, maxX: 23, minY: 63, maxY: 75, minZ: -6, maxZ: 6 }),
      shinLeft: bounds({ minX: -13, maxX: -5, minY: 10, maxY: 30, minZ: -5, maxZ: 5 }),
      shinRight: bounds({ minX: 5, maxX: 13, minY: 10, maxY: 30, minZ: -5, maxZ: 5 }),
    },
  });
  const shin = report.slots.find((slot) => slot.slot === 'shin');

  assert.equal(report.ready, false);
  assert.equal(report.summary.targetWarningCount, 2);
  assert.equal(shin?.targetConfidence, 'needs-review');
  assert.deepEqual(shin?.targetWarnings.map((warning) => warning.axis).sort(), ['depth', 'height']);
  assert.equal(shin?.issues.some((issue) => issue.code === 'too-tall'), false);
  assert.match(formatV3ReferenceFitGapSummary(report), /2 reference targets need review/);
});
