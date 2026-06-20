import { V3_ANIMATION_PROFILE_VERSION } from './v3AnimationFidelity';
import type { V3SourceFidelity } from '../v3/v3QualityTiers';
import { getV3AnimationClipMetadataForCase } from './v3AnimationClipMetadata';
import type { V3RetargetedClipId, V3RetargetedClipSource } from './v3RetargetedAnimationClips';
import {
  V3_POSE_CLEARANCE_CASES,
  analyzeV3BuiltInPoseClearance,
  analyzeV3PoseClearance,
  type V3PoseClearanceCaseId,
  type V3PoseClearanceCaseReport,
  type V3PoseClearanceIssue,
  type V3PoseClearanceIssueCode,
  type V3PoseClearanceOptions,
  type V3PoseClearanceReport,
} from './v3PoseClearance';

export const V3_MOTION_RETARGET_EXPECTED_PROFILE_VERSION = 2;

export type V3MotionRetargetIssueCode =
  | V3PoseClearanceIssueCode
  | 'death-burst-missing'
  | 'retargeted-clip-not-ready'
  | 'profile-version-mismatch';

export interface V3MotionRetargetIssue {
  code: V3MotionRetargetIssueCode;
  message: string;
  caseId: V3PoseClearanceCaseId | null;
  value: number | null;
  threshold: number | null;
}

export interface V3MotionRetargetCaseReport {
  caseId: V3PoseClearanceCaseId;
  ready: boolean;
  clipSource?: V3RetargetedClipSource;
  clipId?: V3RetargetedClipId;
  sourceHash?: string;
  clipReady?: boolean;
  weaponGripDrift: number | null;
  footFloorPenetration: number;
  footLift: number;
  upperLowerCoupling: number;
  issueCodes: V3MotionRetargetIssueCode[];
}

export interface V3MotionRetargetSummary {
  caseCount: number;
  readyCaseCount: number;
  poseReadyCaseCount: number;
  issueCount: number;
  sourceFidelity: V3SourceFidelity;
  profileVersion: number;
  expectedProfileVersion: number;
  deathBurstReady: boolean;
  retargetedClipCount: number;
  readyRetargetedClipCount: number;
  maxWeaponGripDrift: number;
  maxFootFloorPenetration: number;
  maxFootLift: number;
  maxUpperLowerCoupling: number;
}

export interface V3MotionRetargetReport {
  ready: boolean;
  cases: V3MotionRetargetCaseReport[];
  summary: V3MotionRetargetSummary;
  issues: V3MotionRetargetIssue[];
}

export interface V3MotionRetargetOptions {
  caseIds?: readonly V3PoseClearanceCaseId[];
  deathBurstReady?: boolean;
  poseClearanceOptions?: V3PoseClearanceOptions;
}

const ALL_CASE_IDS = V3_POSE_CLEARANCE_CASES.map((testCase) => testCase.id);

const normalizePoseClearanceOptions = (
  options: V3PoseClearanceOptions | undefined
): V3PoseClearanceOptions => {
  const v3Options = options?.v3Options ?? {};
  return {
    ...(options ?? {}),
    v3Options: {
      ...v3Options,
      v3SourceFidelity: v3Options.v3SourceFidelity ?? 'exact',
    },
  };
};

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const toIssue = (issue: V3PoseClearanceIssue): V3MotionRetargetIssue => ({
  code: issue.code,
  message: issue.message,
  caseId: issue.caseId,
  value: typeof issue.value === 'number' ? roundMetric(issue.value) : null,
  threshold: typeof issue.threshold === 'number' ? roundMetric(issue.threshold) : null,
});

const profileVersionIssue = (): V3MotionRetargetIssue => ({
  code: 'profile-version-mismatch',
  message: 'V3 motion-retarget atlas requires animation profile version 2',
  caseId: null,
  value: V3_ANIMATION_PROFILE_VERSION,
  threshold: V3_MOTION_RETARGET_EXPECTED_PROFILE_VERSION,
});

const deathBurstIssue = (): V3MotionRetargetIssue => ({
  code: 'death-burst-missing',
  message: 'V3 death-burst retarget readiness has not been provided by integration evidence',
  caseId: 'death',
  value: null,
  threshold: null,
});

const clipReadinessIssue = (
  caseId: V3PoseClearanceCaseId,
  clipId: V3RetargetedClipId
): V3MotionRetargetIssue => ({
  code: 'retargeted-clip-not-ready',
  message: `Retargeted Mixamo clip ${clipId} is not ready for ${caseId}.`,
  caseId,
  value: null,
  threshold: null,
});

const getPoseClearanceReport = (
  caseIds: readonly V3PoseClearanceCaseId[],
  options: V3PoseClearanceOptions
): V3PoseClearanceReport => {
  if (caseIds.length === ALL_CASE_IDS.length && caseIds.every((caseId, index) => caseId === ALL_CASE_IDS[index])) {
    return analyzeV3BuiltInPoseClearance(options);
  }

  const cases = caseIds.map((caseId) => analyzeV3PoseClearance(caseId, options).cases[0]);
  const issues = cases.flatMap((testCase) => testCase.issues);
  const limbGaps = cases.map((testCase) => testCase.metrics.limbGap);
  return {
    ready: issues.length === 0,
    cases,
    summary: {
      caseCount: cases.length,
      readyCaseCount: cases.filter((testCase) => testCase.ready).length,
      issueCount: issues.length,
      maxPartOverlapRatio: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.partOverlapRatio))),
      minLimbGap: roundMetric(limbGaps.length > 0 ? Math.min(...limbGaps) : 0),
      maxWeaponGripDrift: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.weapon?.gripDrift ?? 0))),
      maxFootFloorPenetration: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.footFloorPenetration))),
      maxFootLift: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.footLift))),
      maxUpperLowerCoupling: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.upperLowerCoupling))),
    },
    issues,
  };
};

const buildCaseReport = (
  testCase: V3PoseClearanceCaseReport,
  deathBurstReady: boolean
): V3MotionRetargetCaseReport => {
  const issueCodes: V3MotionRetargetIssueCode[] = testCase.issues.map((issue) => issue.code);
  const clipMetadata = getV3AnimationClipMetadataForCase(testCase.id);
  if (testCase.id === 'death' && !deathBurstReady) issueCodes.push('death-burst-missing');
  if (clipMetadata && !clipMetadata.ready) issueCodes.push('retargeted-clip-not-ready');

  return {
    caseId: testCase.id,
    ready: testCase.ready && (testCase.id !== 'death' || deathBurstReady) && (clipMetadata?.ready ?? true),
    ...(clipMetadata ? {
      clipSource: clipMetadata.clipSource,
      clipId: clipMetadata.clipId,
      sourceHash: clipMetadata.sourceHash,
      clipReady: clipMetadata.ready,
    } : {}),
    weaponGripDrift: typeof testCase.metrics.weapon?.gripDrift === 'number'
      ? roundMetric(testCase.metrics.weapon.gripDrift)
      : null,
    footFloorPenetration: roundMetric(testCase.metrics.footFloorPenetration),
    footLift: roundMetric(testCase.metrics.footLift),
    upperLowerCoupling: roundMetric(testCase.metrics.upperLowerCoupling),
    issueCodes,
  };
};

export function analyzeV3MotionRetargetAtlas(
  options: V3MotionRetargetOptions = {}
): V3MotionRetargetReport {
  const caseIds = [...(options.caseIds ?? ALL_CASE_IDS)];
  const deathBurstReady = options.deathBurstReady === true;
  const poseClearanceOptions = normalizePoseClearanceOptions(options.poseClearanceOptions);
  const poseReport = getPoseClearanceReport(caseIds, poseClearanceOptions);
  const cases = poseReport.cases.map((testCase) => buildCaseReport(testCase, deathBurstReady));
  const issues: V3MotionRetargetIssue[] = poseReport.issues.map(toIssue);
  for (const testCase of cases) {
    if (testCase.clipId && testCase.clipReady === false) {
      issues.push(clipReadinessIssue(testCase.caseId, testCase.clipId));
    }
  }

  if (V3_ANIMATION_PROFILE_VERSION !== V3_MOTION_RETARGET_EXPECTED_PROFILE_VERSION) {
    issues.push(profileVersionIssue());
  }
  if (!deathBurstReady && caseIds.includes('death')) {
    issues.push(deathBurstIssue());
  }

  const summary: V3MotionRetargetSummary = {
    caseCount: cases.length,
    readyCaseCount: cases.filter((testCase) => testCase.ready).length,
    poseReadyCaseCount: poseReport.summary.readyCaseCount,
    issueCount: issues.length,
    sourceFidelity: poseClearanceOptions.v3Options?.v3SourceFidelity ?? 'exact',
    profileVersion: V3_ANIMATION_PROFILE_VERSION,
    expectedProfileVersion: V3_MOTION_RETARGET_EXPECTED_PROFILE_VERSION,
    deathBurstReady,
    retargetedClipCount: cases.filter((testCase) => testCase.clipSource === 'retargetedMixamo').length,
    readyRetargetedClipCount: cases.filter((testCase) => (
      testCase.clipSource === 'retargetedMixamo' && testCase.clipReady === true
    )).length,
    maxWeaponGripDrift: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.weaponGripDrift ?? 0))),
    maxFootFloorPenetration: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.footFloorPenetration))),
    maxFootLift: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.footLift))),
    maxUpperLowerCoupling: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.upperLowerCoupling))),
  };

  return {
    ready: issues.length === 0 && cases.every((testCase) => testCase.ready),
    cases,
    summary,
    issues,
  };
}
