import * as THREE from 'three';
import type {
  V3CleanRigPose,
  V3QuatTuple,
  V3Vec3Tuple,
} from './v3CleanRig';
import type {
  V3Mesh2MotionDriverPose,
} from './v3Mesh2MotionDriverRig';
import { V3_MESH2MOTION_CLIP_SET } from './v3Mesh2MotionClips.generated';

export type V3Mesh2MotionClipId = (typeof V3_MESH2MOTION_CLIP_SET.clips)[number]['sourceClipName'];
export type V3Mesh2MotionMotionSource = 'mesh2Motion';

export interface V3CleanMesh2MotionClipSample {
  pose: V3CleanRigPose;
  motionSource: V3Mesh2MotionMotionSource;
  mixamoClipId: V3Mesh2MotionClipId;
  sourceNormalizedTime: number;
}

export interface V3CleanMesh2MotionClipBinding {
  motionSource: V3Mesh2MotionMotionSource;
  mixamoClipId: V3Mesh2MotionClipId;
}

type GeneratedClip = (typeof V3_MESH2MOTION_CLIP_SET.clips)[number];
type GeneratedJointOffsetTrack = {
  readonly joint: string;
  readonly offsets: readonly (readonly number[])[];
};
type GeneratedDriverJointTrack = {
  readonly joint: string;
  readonly positions: readonly (readonly number[])[];
  readonly quaternions: readonly (readonly number[])[];
};

const IDENTITY_QUATERNION: V3QuatTuple = [0, 0, 0, 1];
const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const quatTuple = (quaternion: THREE.Quaternion): V3QuatTuple => {
  const normalized = quaternion.lengthSq() > 0.000001
    ? quaternion.clone().normalize()
    : new THREE.Quaternion();
  return [
    roundMetric(normalized.x),
    roundMetric(normalized.y),
    roundMetric(normalized.z),
    roundMetric(normalized.w),
  ];
};

const findClipForCleanClip = (cleanClipId: string): GeneratedClip | null =>
  V3_MESH2MOTION_CLIP_SET.clips.find((clip) => (
    (clip.cleanClipIds as readonly string[]).includes(cleanClipId)
  )) ?? null;

const frameSpan = (
  normalizedTimes: readonly number[],
  normalizedTime: number
): { previousIndex: number; nextIndex: number; amount: number } => {
  if (normalizedTimes.length <= 1 || normalizedTime <= normalizedTimes[0]) {
    return { previousIndex: 0, nextIndex: 0, amount: 0 };
  }
  const lastIndex = normalizedTimes.length - 1;
  if (normalizedTime >= normalizedTimes[lastIndex]) {
    return { previousIndex: lastIndex, nextIndex: lastIndex, amount: 0 };
  }
  const nextIndex = normalizedTimes.findIndex((time) => time >= normalizedTime);
  const previousIndex = Math.max(0, nextIndex - 1);
  const from = normalizedTimes[previousIndex] ?? 0;
  const to = normalizedTimes[nextIndex] ?? from;
  return {
    previousIndex,
    nextIndex,
    amount: to === from ? 0 : clamp01((normalizedTime - from) / (to - from)),
  };
};

const sampleQuatTrack = (
  quaternions: readonly (readonly number[])[],
  span: { previousIndex: number; nextIndex: number; amount: number }
): V3QuatTuple => {
  const from = quaternions[span.previousIndex] ?? IDENTITY_QUATERNION;
  const to = quaternions[span.nextIndex] ?? from;
  return quatTuple(
    new THREE.Quaternion(from[0], from[1], from[2], from[3]).normalize()
      .slerp(new THREE.Quaternion(to[0], to[1], to[2], to[3]).normalize(), span.amount)
      .normalize()
  );
};

const sampleVec3Track = (
  vectors: readonly (readonly number[])[],
  span: { previousIndex: number; nextIndex: number; amount: number }
): V3Vec3Tuple => {
  const from = vectors[span.previousIndex] ?? ZERO_VEC3;
  const to = vectors[span.nextIndex] ?? from;
  return [
    roundMetric((from[0] ?? 0) + ((to[0] ?? 0) - (from[0] ?? 0)) * span.amount),
    roundMetric((from[1] ?? 0) + ((to[1] ?? 0) - (from[1] ?? 0)) * span.amount),
    roundMetric((from[2] ?? 0) + ((to[2] ?? 0) - (from[2] ?? 0)) * span.amount),
  ];
};

export function getV3CleanMesh2MotionClipBinding(cleanClipId: string): V3CleanMesh2MotionClipBinding | null {
  const clip = findClipForCleanClip(cleanClipId);
  if (!clip) return null;
  return {
    motionSource: 'mesh2Motion',
    mixamoClipId: clip.sourceClipName,
  };
}

export function sampleV3CleanMesh2MotionClip(
  cleanClipId: string,
  normalizedTime: number
): V3CleanMesh2MotionClipSample | null {
  const clip = findClipForCleanClip(cleanClipId);
  if (!clip) return null;

  const safeTime = clamp01(normalizedTime);
  const span = frameSpan(clip.normalizedTimes, safeTime);
  const jointQuaternions = Object.fromEntries(
    Object.entries(clip.joints).map(([jointName, track]) => [
      jointName,
      sampleQuatTrack(track.quaternions, span),
    ])
  ) as V3CleanRigPose['jointQuaternions'];
  const generatedOffsets = (
    'jointOffsets' in clip
      ? clip.jointOffsets as Partial<Record<string, GeneratedJointOffsetTrack>>
      : {}
  );
  const jointOffsets = Object.fromEntries(
    Object.entries(generatedOffsets).map(([jointName, track]) => [
      jointName,
      sampleVec3Track(track?.offsets ?? [], span),
    ])
  ) as V3CleanRigPose['jointOffsets'];
  const generatedDriverJoints = (
    'driverJoints' in clip
      ? clip.driverJoints as Record<string, GeneratedDriverJointTrack>
      : {}
  );
  const driverJoints = Object.fromEntries(
    Object.entries(generatedDriverJoints).map(([jointName, track]) => [
      jointName,
      {
        position: sampleVec3Track(track.positions, span),
        quaternion: sampleQuatTrack(track.quaternions, span),
      },
    ])
  ) as V3Mesh2MotionDriverPose['joints'];
  const rootOffset = sampleVec3Track(clip.rootOffsets, span);
  const hasRootOffset = rootOffset.some((component) => Math.abs(component) > 0.000001);
  const hasJointOffsets = Object.values(jointOffsets ?? {})
    .some((offset) => offset.some((component) => Math.abs(component) > 0.000001));
  const pose: V3CleanRigPose = {
    clipId: cleanClipId,
    animationAuthority: 'cleanRig',
    normalizedTime: safeTime,
    jointQuaternions,
    ...(hasRootOffset ? { rootOffset } : {}),
    ...(hasJointOffsets ? { jointOffsets } : {}),
    mesh2MotionDriverPose: {
      sourceClipName: clip.sourceClipName,
      sourceNormalizedTime: safeTime,
      joints: driverJoints,
    },
  };

  return {
    pose,
    motionSource: 'mesh2Motion',
    mixamoClipId: clip.sourceClipName,
    sourceNormalizedTime: safeTime,
  };
}
