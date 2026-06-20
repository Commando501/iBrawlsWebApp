import type { V3PoseClearanceCaseId } from './v3PoseClearance';
import {
  analyzeV3RetargetedClipQuality,
  getV3RetargetedClip,
  type V3RetargetedClipId,
  type V3RetargetedClipSource,
} from './v3RetargetedAnimationClips';

export interface V3AnimationClipMetadata {
  clipSource: V3RetargetedClipSource;
  clipId: V3RetargetedClipId;
  sourceHash: string;
  ready: boolean;
  readiness: 'ready' | 'blocked';
  label: string;
}

const CASE_TO_CLIP_ID: Partial<Record<V3PoseClearanceCaseId, V3RetargetedClipId>> = {
  idle: 'idle',
  walk: 'walk',
  sprint: 'run',
};

export function getV3AnimationClipMetadataForCase(
  caseId: V3PoseClearanceCaseId
): V3AnimationClipMetadata | null {
  const clipId = CASE_TO_CLIP_ID[caseId];
  if (!clipId) return null;
  const clip = getV3RetargetedClip(clipId);
  const quality = analyzeV3RetargetedClipQuality(clipId);
  return {
    clipSource: 'retargetedMixamo',
    clipId,
    sourceHash: clip.sourceHash,
    ready: quality.ready,
    readiness: quality.ready ? 'ready' : 'blocked',
    label: 'retargeted Mixamo',
  };
}

export function buildV3RetargetedMotionClipEvidence() {
  const clipIds = ['idle', 'walk', 'run'] as const satisfies readonly V3RetargetedClipId[];
  const reports = clipIds.map((clipId) => analyzeV3RetargetedClipQuality(clipId));
  const issues = reports.flatMap((report) => (
    report.issues.map((issue) => `${report.clipId}: ${issue}`)
  ));
  return {
    ready: reports.every((report) => report.ready),
    issues,
    summary: {
      source: 'retargeted Mixamo',
      clipCount: reports.length,
      readyClipCount: reports.filter((report) => report.ready).length,
      clips: reports.map((report) => ({
        clipId: report.clipId,
        sourceHash: report.sourceHash,
        durationSeconds: report.durationSeconds,
        frameCount: report.frameCount,
        mappedJointCount: report.mappedJointCount,
        horizontalRootMotionStripped: report.horizontalRootMotionStripped,
        ready: report.ready,
      })),
    },
  };
}
