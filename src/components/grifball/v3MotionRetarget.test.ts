import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_POSE_CLEARANCE_CASES,
  type V3PoseClearanceCaseId,
} from './v3PoseClearance';
import {
  analyzeV3MotionRetargetAtlas,
} from './v3MotionRetarget';

const CASE_IDS = V3_POSE_CLEARANCE_CASES.map((testCase) => testCase.id);

const getCase = (
  report: ReturnType<typeof analyzeV3MotionRetargetAtlas>,
  caseId: V3PoseClearanceCaseId
) => {
  const testCase = report.cases.find((candidate) => candidate.caseId === caseId);
  assert.ok(testCase, `missing motion-retarget case ${caseId}`);
  return testCase;
};

describe('analyzeV3MotionRetargetAtlas', () => {
  it('represents every V3 pose-clearance case with deterministic JSON-safe output', () => {
    const first = analyzeV3MotionRetargetAtlas({ deathBurstReady: true });
    const second = analyzeV3MotionRetargetAtlas({ deathBurstReady: true });

    assert.deepEqual(first, second);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
    assert.deepEqual(first.cases.map((testCase) => testCase.caseId), CASE_IDS);
    assert.equal(first.summary.caseCount, CASE_IDS.length);
  });

  it('fails synthetic active weapon cases under a stricter third-person weapon drift threshold', () => {
    const report = analyzeV3MotionRetargetAtlas({
      deathBurstReady: true,
      poseClearanceOptions: {
        thresholds: { maxWeaponGripDrift: 0.01 },
      },
      caseIds: ['hammerWindup'],
    });
    const testCase = getCase(report, 'hammerWindup');

    assert.equal(report.ready, false);
    assert.equal(testCase.ready, false);
    assert.equal(testCase.issueCodes.includes('weapon-drift-high'), true);
    assert.equal(testCase.weaponGripDrift > 0.01, true);
  });

  it('includes death-burst readiness in report readiness', () => {
    const missing = analyzeV3MotionRetargetAtlas();
    const provided = analyzeV3MotionRetargetAtlas({ deathBurstReady: true });
    const deathCase = getCase(missing, 'death');

    assert.equal(missing.summary.deathBurstReady, false);
    assert.equal(missing.ready, false);
    assert.equal(deathCase.ready, false);
    assert.equal(deathCase.issueCodes.includes('death-burst-missing'), true);
    assert.equal(missing.issues.some((issue) => issue.code === 'death-burst-missing'), true);

    assert.equal(provided.summary.deathBurstReady, true);
    assert.equal(provided.ready, true, provided.issues.map((issue) => issue.code).join(', '));
    assert.equal(getCase(provided, 'death').ready, true);
  });

  it('defaults pose-clearance evidence to the accepted exact OBJ source', () => {
    const defaultReport = analyzeV3MotionRetargetAtlas({
      deathBurstReady: true,
      caseIds: ['walk'],
    });
    const exactReport = analyzeV3MotionRetargetAtlas({
      deathBurstReady: true,
      caseIds: ['walk'],
      poseClearanceOptions: {
        v3Options: { v3SourceFidelity: 'exact' },
      },
    });
    const runtimeLodReport = analyzeV3MotionRetargetAtlas({
      deathBurstReady: true,
      caseIds: ['walk'],
      poseClearanceOptions: {
        v3Options: { v3SourceFidelity: 'runtimeLod' },
      },
    });

    assert.equal(defaultReport.summary.sourceFidelity, 'exact');
    assert.equal(exactReport.summary.sourceFidelity, 'exact');
    assert.equal(runtimeLodReport.summary.sourceFidelity, 'runtimeLod');
    assert.deepEqual(defaultReport.cases[0], exactReport.cases[0]);
  });

  it('treats explicitly undefined source fidelity as exact-source evidence', () => {
    const undefinedSourceReport = analyzeV3MotionRetargetAtlas({
      deathBurstReady: true,
      caseIds: ['walk'],
      poseClearanceOptions: {
        v3Options: { v3SourceFidelity: undefined } as any,
      },
    });
    const exactReport = analyzeV3MotionRetargetAtlas({
      deathBurstReady: true,
      caseIds: ['walk'],
      poseClearanceOptions: {
        v3Options: { v3SourceFidelity: 'exact' },
      },
    });

    assert.equal(undefinedSourceReport.summary.sourceFidelity, 'exact');
    assert.deepEqual(undefinedSourceReport.cases[0], exactReport.cases[0]);
  });

  it('keeps every built-in pose-clearance case ready by default except death burst evidence', () => {
    const report = analyzeV3MotionRetargetAtlas();
    const unexpectedPoseFailures = report.cases.filter((testCase) => (
      testCase.caseId !== 'death'
      && !testCase.ready
    ));

    assert.equal(report.summary.poseReadyCaseCount, CASE_IDS.length);
    assert.deepEqual(unexpectedPoseFailures, []);
    assert.equal(getCase(report, 'death').issueCodes.includes('death-burst-missing'), true);
    assert.equal(report.ready, false);
  });
});
