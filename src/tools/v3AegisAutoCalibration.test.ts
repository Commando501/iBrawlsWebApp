import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { V3ReferenceScaffold } from './v3ReferenceScaffold';
import {
  applyV3AegisCalibrationCandidate,
  buildV3AegisCalibrationCandidates,
  formatV3AegisCalibrationReport,
  scoreV3AegisCalibrationCandidate,
} from './v3AegisAutoCalibration';
import { V3_AEGIS_PART_SPECS } from '../components/v3/v3AegisSuitParts';
import {
  V3_OBJ_REFERENCE_PROPORTION_TARGETS,
  V3_REFERENCE_PROPORTION_BANDS,
  type V3ReferenceProportionTargets,
} from '../components/v3/v3ReferenceProportions';

const makeTargets = (
  widthRatio: number,
  depthRatio: number
): V3ReferenceProportionTargets => ({
  ...V3_OBJ_REFERENCE_PROPORTION_TARGETS,
  sourceLabel: 'synthetic-wide-blocky.obj',
  sourceKind: 'obj',
  global: {
    front: { widthRatio, heightRatio: 1, areaRatio: widthRatio },
    side: { widthRatio: depthRatio, heightRatio: 1, areaRatio: depthRatio },
  },
  bands: Object.fromEntries(V3_REFERENCE_PROPORTION_BANDS.map((band) => [
    band,
    { widthRatio, depthRatio },
  ])) as V3ReferenceProportionTargets['bands'],
});

const makeScaffold = (
  targets = makeTargets(0.42, 0.18),
  overrides: Record<string, unknown> = {}
): V3ReferenceScaffold => ({
  sourceLabel: targets.sourceLabel,
  sourceKind: targets.sourceKind,
  metadata: {
    fileName: targets.sourceLabel,
    kind: targets.sourceKind,
  },
  proportionTargets: targets,
  rawText: 'SECRET OBJ PAYLOAD',
  parsedObject: { privateSceneGraph: true },
  payload: new Uint8Array([1, 2, 3]),
  ...overrides,
} as unknown as V3ReferenceScaffold);

const makeNativeScaffold = (
  widthRatio = 0.42,
  depthRatio = 0.18
): V3ReferenceScaffold => ({
  schemaVersion: 'v3-reference-scaffold/v1',
  version: 1,
  source: {
    kind: 'obj',
    canonicalKind: 'obj',
    fileName: 'synthetic-wide-blocky.obj',
    label: 'synthetic-wide-blocky.obj',
    calibrationAllowed: true,
    inspectionOnly: false,
    issues: [],
    metadata: {
      objectCount: 1,
      materialCount: 1,
      materialLibraryCount: 0,
      vertexCount: 8,
      faceCount: 6,
      triangleCountEstimate: 12,
      bounds: null,
      dimensions: { width: widthRatio, height: 1, depth: depthRatio },
    },
  },
  globalRatios: {
    widthToHeight: widthRatio,
    depthToHeight: depthRatio,
    widthToDepth: widthRatio / depthRatio,
    heightRatio: 1,
    centerXToHeight: 0,
    centerZToHeight: 0,
  },
  verticalBands: V3_REFERENCE_PROPORTION_BANDS.map((band, index) => ({
    id: band,
    yRange: {
      minRatio: index / V3_REFERENCE_PROPORTION_BANDS.length,
      maxRatio: (index + 1) / V3_REFERENCE_PROPORTION_BANDS.length,
    },
    widthRatio,
    depthRatio,
    occupancyRatio: 1,
    objectCount: 1,
    families: [],
  })),
  slotFamilyEnvelopes: [],
  centerlineHints: {
    xCenterOffsetRatio: 0,
    zCenterOffsetRatio: 0,
    leftRightBalance: 0,
    frontBackBalance: 0,
  },
  occupancySummary: {
    occupiedBandCount: V3_REFERENCE_PROPORTION_BANDS.length,
    occupiedBandRatio: 1,
    emptyBands: [],
    objectCoverageRatio: 1,
    familyObjectCounts: {
      helmet: 0,
      torso: 0,
      arms: 0,
      hands: 0,
      legs: 0,
      feet: 0,
      equipment: 0,
      unknown: 0,
    },
  },
});

describe('V3 Aegis auto-calibration solver', () => {
  it('builds deterministic candidates that improve synthetic wide/blocky Aegis proportions', () => {
    const firstReport = buildV3AegisCalibrationCandidates(makeNativeScaffold(), { maxCandidates: 4 });
    const secondReport = buildV3AegisCalibrationCandidates(makeNativeScaffold(), { maxCandidates: 4 });
    const accepted = firstReport.candidates.find((candidate) => (
      candidate.hardGateStatus === 'accepted'
    ));

    assert.ok(accepted, 'expected at least one accepted candidate');
    assert.ok(accepted.improvement > 0);
    assert.ok(accepted.scoreAfter < accepted.scoreBefore);
    assert.equal(accepted.id.startsWith('base-envelope-'), true);
    assert.deepEqual(
      firstReport.candidates.map((candidate) => candidate.id),
      secondReport.candidates.map((candidate) => candidate.id)
    );
    assert.deepEqual(
      firstReport.candidates.map((candidate) => candidate.patch),
      secondReport.candidates.map((candidate) => candidate.patch)
    );
  });

  it('returns sanitized reports and patch data without raw scaffold payloads', () => {
    const report = buildV3AegisCalibrationCandidates(makeScaffold(makeTargets(0.42, 0.18), {
      sourceLabel: 'C:\\Private\\Reference\\private-reference.obj',
      metadata: {
        fileName: 'C:\\Private\\Reference\\private-reference.obj',
        kind: 'obj',
      },
      proportionTargets: {
        ...makeTargets(0.42, 0.18),
        sourceLabel: 'C:\\Private\\Reference\\private-reference.obj',
      },
    }), { maxCandidates: 2 });
    const serialized = JSON.stringify(report);
    const accepted = report.candidates.find((candidate) => (
      candidate.hardGateStatus === 'accepted'
    ));

    assert.ok(accepted, 'expected accepted candidate');
    assert.equal(serialized.includes('SECRET OBJ PAYLOAD'), false);
    assert.equal(serialized.includes('privateSceneGraph'), false);
    assert.equal(serialized.includes('C:\\Private'), false);
    assert.equal(serialized.includes('rawText'), false);
    assert.equal(report.sourceLabel, 'private-reference.obj');
    const patchedSlot = Object.values(accepted.patch.slots)[0];
    assert.ok(patchedSlot, 'expected at least one patched slot');
    assert.equal(
      Object.keys(patchedSlot).every((key) => (
        key === 'dimensions' || key === 'position'
      )),
      true
    );
    assert.equal('segment' in patchedSlot, false);
  });

  it('orders accepted candidates by best score improvement before applying maxCandidates', () => {
    const fullReport = buildV3AegisCalibrationCandidates(makeNativeScaffold(), { maxCandidates: 12 });
    const accepted = fullReport.candidates.filter((candidate) => (
      candidate.hardGateStatus === 'accepted'
    ));
    assert.ok(accepted.length >= 2, 'expected multiple accepted candidates for score ordering');
    for (let index = 1; index < accepted.length; index += 1) {
      assert.ok(
        accepted[index - 1].improvement >= accepted[index].improvement,
        `${accepted[index - 1].id} should score at least ${accepted[index].id}`
      );
    }

    const limitedReport = buildV3AegisCalibrationCandidates(makeNativeScaffold(), { maxCandidates: 1 });
    assert.equal(limitedReport.candidates[0].id, accepted[0].id);
    assert.equal(limitedReport.improvement, accepted[0].improvement);
  });

  it('hard rejects collapsed, out-of-bounds, asymmetric, and no-improvement candidates', () => {
    const scaffold = makeScaffold();
    const collapsed = scoreV3AegisCalibrationCandidate({
      id: 'manual-collapsed-limb',
      scope: 'manual',
      patch: {
        slots: {
          upperArmLeft: { dimensions: [1, 9, 4] },
          upperArmRight: { dimensions: [1, 9, 4] },
        },
      },
    }, scaffold);
    const outOfBounds = scoreV3AegisCalibrationCandidate({
      id: 'manual-out-of-bounds',
      scope: 'manual',
      patch: {
        slots: {
          helmet: { dimensions: [99, 8, 6] },
        },
      },
    }, scaffold);
    const asymmetric = scoreV3AegisCalibrationCandidate({
      id: 'manual-asymmetric-limbs',
      scope: 'manual',
      patch: {
        slots: {
          forearmLeft: { dimensions: [5, 9, 4] },
          forearmRight: { dimensions: [4, 9, 4] },
        },
      },
    }, scaffold);
    const noImprovement = scoreV3AegisCalibrationCandidate({
      id: 'manual-no-improvement',
      scope: 'manual',
      patch: {
        slots: {
          chest: { dimensions: [...V3_AEGIS_PART_SPECS.chest.dimensions] },
        },
      },
    }, scaffold);

    assert.equal(collapsed.hardGateStatus, 'rejected');
    assert.ok(collapsed.rejectionReasons.some((reason) => reason.includes('collapsed limb')));
    assert.equal(outOfBounds.hardGateStatus, 'rejected');
    assert.ok(outOfBounds.rejectionReasons.some((reason) => reason.includes('outside V3 fit bounds')));
    assert.equal(asymmetric.hardGateStatus, 'rejected');
    assert.ok(asymmetric.rejectionReasons.some((reason) => reason.includes('left/right asymmetry')));
    assert.equal(noImprovement.hardGateStatus, 'rejected');
    assert.ok(noImprovement.rejectionReasons.some((reason) => reason.includes('does not improve')));
  });

  it('hard rejects canonical OBJ candidates that fail the rendered proportion gate', () => {
    const report = buildV3AegisCalibrationCandidates(makeNativeScaffold(
      V3_OBJ_REFERENCE_PROPORTION_TARGETS.global.front.widthRatio,
      V3_OBJ_REFERENCE_PROPORTION_TARGETS.global.side.widthRatio
    ), { maxCandidates: 5 });
    const globalCandidate = report.candidates.find((candidate) => candidate.id === 'base-envelope-global');

    assert.ok(globalCandidate, 'expected the global candidate to be generated');
    assert.equal(globalCandidate.hardGateStatus, 'rejected');
    assert.ok(globalCandidate.rejectionReasons.some((reason) => (
      reason.includes('rendered OBJ proportion gate failed')
    )));
  });

  it('hard rejects missing and non-OBJ scaffolds', () => {
    const missingReport = buildV3AegisCalibrationCandidates(undefined as unknown as V3ReferenceScaffold);
    const nonObjReport = buildV3AegisCalibrationCandidates(makeScaffold(makeTargets(0.42, 0.18), {
      sourceKind: 'manual',
      metadata: { fileName: 'manual.json', kind: 'manual' },
    }));

    assert.equal(missingReport.hardGateStatus, 'rejected');
    assert.ok(missingReport.rejectionReasons.some((reason) => reason.includes('missing scaffold')));
    assert.equal(nonObjReport.hardGateStatus, 'rejected');
    assert.ok(nonObjReport.rejectionReasons.some((reason) => reason.includes('non-OBJ scaffold')));
  });

  it('applies an accepted candidate in memory and formats the report', () => {
    const report = buildV3AegisCalibrationCandidates(makeScaffold(), { maxCandidates: 3 });
    const candidate = report.candidates.find((entry) => entry.hardGateStatus === 'accepted');
    assert.ok(candidate, 'expected accepted candidate');
    const originalChestDimensions = [...V3_AEGIS_PART_SPECS.chest.dimensions];

    const applied = applyV3AegisCalibrationCandidate(candidate);
    const formatted = formatV3AegisCalibrationReport(report);

    assert.ok(
      Object.entries(candidate.patch.slots).some(([slot, patch]) => (
        patch.dimensions !== undefined &&
        patch.dimensions.some((value, index) => (
          value !== V3_AEGIS_PART_SPECS[slot as keyof typeof V3_AEGIS_PART_SPECS].dimensions[index]
        ))
      )),
      'expected accepted candidate to change at least one built-in part dimension'
    );
    assert.deepEqual(V3_AEGIS_PART_SPECS.chest.dimensions, originalChestDimensions);
    assert.deepEqual(applied.patch, candidate.patch);
    assert.match(formatted, /V3 Aegis auto-calibration/);
    assert.match(formatted, /synthetic-wide-blocky\.obj/);
    assert.match(formatted, /improvement/);
    assert.match(formatted, /accepted/);
  });
});
