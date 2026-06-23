import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeV3ReferenceFitGaps,
  formatV3ReferenceFitGapSummary,
  type V3ReferenceFitGapBounds,
} from './v3ReferenceFitGaps';
import type {
  V3ReferenceFeatureGuide,
  V3ReferenceFeatureSlot,
  V3ReferenceFeatureSlotGuide,
} from './v3ReferenceFeatureGuide';

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

const slotGuide = (
  slot: V3ReferenceFeatureSlot,
  boundsRatio: V3ReferenceFeatureSlotGuide['boundsRatio'],
  verticalRange: V3ReferenceFeatureSlotGuide['verticalRange']
): V3ReferenceFeatureSlotGuide => ({
  slot,
  objectCount: 1,
  objectNames: [`${slot}-sanitized-target`],
  materialRoleHints: ['primary'],
  boundsRatio,
  verticalRange,
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
});

const dashboardFitGuide = {
  ...guide,
  slotOrder: [
    'helmet',
    'chest',
    'pelvis',
    'back',
    'shoulder',
    'upperArm',
    'forearm',
    'hand',
    'thigh',
    'shin',
    'foot',
  ],
  slotGuides: [
    slotGuide('helmet', {
      widthToReferenceHeight: 0.36101,
      heightToReferenceHeight: 0.234946,
      depthToReferenceHeight: 0.280131,
    }, { minRatio: 0.765054, maxRatio: 1 }),
    slotGuide('chest', {
      widthToReferenceHeight: 0.386194,
      heightToReferenceHeight: 0.229129,
      depthToReferenceHeight: 0.178913,
    }, { minRatio: 0.569174, maxRatio: 0.798303 }),
    slotGuide('pelvis', {
      widthToReferenceHeight: 0.277559,
      heightToReferenceHeight: 0.182721,
      depthToReferenceHeight: 0.198394,
    }, { minRatio: 0.420157, maxRatio: 0.602878 }),
    slotGuide('back', {
      widthToReferenceHeight: 0.382521,
      heightToReferenceHeight: 0.247511,
      depthToReferenceHeight: 0.133618,
    }, { minRatio: 0.554002, maxRatio: 0.801512 }),
    slotGuide('shoulder', {
      widthToReferenceHeight: 0.587807,
      heightToReferenceHeight: 0.213205,
      depthToReferenceHeight: 0.191844,
    }, { minRatio: 0.569485, maxRatio: 0.78269 }),
    slotGuide('upperArm', {
      widthToReferenceHeight: 0.600598,
      heightToReferenceHeight: 0.418295,
      depthToReferenceHeight: 0.295601,
    }, { minRatio: 0.447768, maxRatio: 0.866063 }),
    slotGuide('forearm', {
      widthToReferenceHeight: 0.270748,
      heightToReferenceHeight: 0.114111,
      depthToReferenceHeight: 0.134953,
    }, { minRatio: 0.340424, maxRatio: 0.454535 }),
    slotGuide('hand', {
      widthToReferenceHeight: 0.293502,
      heightToReferenceHeight: 0.096147,
      depthToReferenceHeight: 0.153495,
    }, { minRatio: 0.250526, maxRatio: 0.346672 }),
    slotGuide('thigh', {
      widthToReferenceHeight: 0.231964,
      heightToReferenceHeight: 0.21019,
      depthToReferenceHeight: 0.173828,
    }, { minRatio: 0.24654, maxRatio: 0.45673 }),
    slotGuide('shin', {
      widthToReferenceHeight: 0.262666,
      heightToReferenceHeight: 0.070698,
      depthToReferenceHeight: 0.055968,
    }, { minRatio: 0.24644, maxRatio: 0.317138 }),
    slotGuide('foot', {
      widthToReferenceHeight: 0.376106,
      heightToReferenceHeight: 0.120292,
      depthToReferenceHeight: 0.200334,
    }, { minRatio: 0, maxRatio: 0.120292 }),
  ],
  summary: {
    ...guide.summary,
    slotCount: 11,
    objectCount: 11,
  },
} satisfies V3ReferenceFeatureGuide;

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

  assert.equal(report.ready, true);
  assert.equal(report.summary.targetWarningCount, 2);
  assert.equal(report.summary.bodyRebuildBlockerCount, 0);
  assert.equal(report.summary.segmentationReviewCount, 2);
  assert.equal(shin?.targetConfidence, 'needs-review');
  assert.deepEqual(shin?.targetWarnings.map((warning) => warning.axis).sort(), ['depth', 'height']);
  assert.equal(shin?.targetWarnings.every((warning) =>
    warning.diagnosticCategory === 'segmentation-review' &&
    warning.blocksBodyRebuild === false
  ), true);
  assert.equal(shin?.issues.some((issue) => issue.code === 'too-tall'), false);
  assert.match(formatV3ReferenceFitGapSummary(report), /Segmentation Review/);
  assert.match(formatV3ReferenceFitGapSummary(report), /2 reference targets need review/);
});

test('built-in exact-source V3 body reclassifies slot-family fit gaps as segmentation review diagnostics', () => {
  const report = analyzeV3ReferenceFitGaps(dashboardFitGuide);
  const forearm = report.slots.find((slot) => slot.slot === 'forearm');
  const hand = report.slots.find((slot) => slot.slot === 'hand');
  const helmet = report.slots.find((slot) => slot.slot === 'helmet');
  const shoulder = report.slots.find((slot) => slot.slot === 'shoulder');
  const chest = report.slots.find((slot) => slot.slot === 'chest');
  const upperArm = report.slots.find((slot) => slot.slot === 'upperArm');
  const shin = report.slots.find((slot) => slot.slot === 'shin');

  assert.equal(report.summary.targetWarningCount, 3, 'exported noisy guide targets should remain explicitly flagged');
  assert.equal(report.ready, true);
  assert.equal(report.summary.bodyRebuildBlockerCount, 0);
  assert.equal(report.summary.segmentationReviewCount, report.summary.issueCount);
  assert.ok(report.summary.modelIssueCount > 0, formatV3ReferenceFitGapSummary(report));
  assert.ok(
    forearm?.issues.some((issue) =>
      issue.axis === 'width' &&
      issue.direction === 'too-large' &&
      issue.diagnosticCategory === 'segmentation-review' &&
      issue.blocksBodyRebuild === false
    ),
    `forearm width gap should stay visible for Phase 38 diagnostics: ${forearm?.issues.map((issue) => issue.message).join('; ')}`
  );
  assert.ok(
    hand?.issues.some((issue) =>
      issue.axis === 'width' &&
      issue.direction === 'too-large' &&
      issue.diagnosticCategory === 'segmentation-review' &&
      issue.blocksBodyRebuild === false
    ),
    `hand width gap should stay visible for Phase 38 diagnostics: ${hand?.issues.map((issue) => issue.message).join('; ')}`
  );
  assert.ok(
    helmet?.issues.some((issue) =>
      issue.direction === 'too-small' &&
      issue.diagnosticCategory === 'segmentation-review' &&
      issue.blocksBodyRebuild === false
    ),
    `helmet fit gaps should stay visible for exact-source review diagnostics: ${helmet?.issues.map((issue) => issue.message).join('; ')}`
  );
  assert.ok(
    shoulder?.issues.some((issue) =>
      issue.direction === 'too-small' &&
      issue.diagnosticCategory === 'segmentation-review' &&
      issue.blocksBodyRebuild === false
    ),
    `shoulder undersized gaps should stay review-only: ${shoulder?.issues.map((issue) => issue.message).join('; ')}`
  );
  assert.ok(
    chest?.issues.some((issue) =>
      issue.diagnosticCategory === 'segmentation-review' &&
      issue.blocksBodyRebuild === false
    ),
    `chest fit gaps should stay review-only: ${chest?.issues.map((issue) => issue.message).join('; ')}`
  );
  assert.ok(
    upperArm?.targetWarnings.every((warning) =>
      warning.diagnosticCategory === 'segmentation-review' &&
      warning.blocksBodyRebuild === false
    ),
    `upperArm target warnings should be segmentation review diagnostics: ${upperArm?.targetWarnings.map((warning) => warning.message).join('; ')}`
  );
  assert.ok(
    shin?.targetWarnings.every((warning) =>
      warning.diagnosticCategory === 'segmentation-review' &&
      warning.blocksBodyRebuild === false
    ),
    `shin target warnings should be segmentation review diagnostics: ${shin?.targetWarnings.map((warning) => warning.message).join('; ')}`
  );
  const summary = formatV3ReferenceFitGapSummary(report);
  assert.match(summary, /Segmentation Review/);
  assert.doesNotMatch(summary, /blocked/i);
});
