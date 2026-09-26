import type { V3CharacterSlotId } from '../v3/v3ModelTypes';
import type {
  V3Mesh2MotionCalibrationVec3,
  V3Mesh2MotionDriverJointName,
  V3Mesh2MotionTransformCalibration,
  V3Mesh2MotionWeaponSocketCalibration,
  V3Mesh2MotionWeaponSocketCalibrationName,
} from './v3Mesh2MotionCalibration';

export interface V3Mesh2MotionPartBindingCleanup extends V3Mesh2MotionTransformCalibration {
  scale?: V3Mesh2MotionCalibrationVec3;
}

export type V3Mesh2MotionCleanupDriverJoints = Partial<Record<
  V3Mesh2MotionDriverJointName,
  V3Mesh2MotionTransformCalibration
>>;

export type V3Mesh2MotionCleanupPartBindings = Partial<Record<
  V3CharacterSlotId,
  V3Mesh2MotionPartBindingCleanup
>>;

export type V3Mesh2MotionCleanupWeaponSockets = Partial<Record<
  V3Mesh2MotionWeaponSocketCalibrationName,
  V3Mesh2MotionWeaponSocketCalibration
>>;

export interface V3Mesh2MotionCleanupKeyframe {
  time: number;
  driverJoints?: V3Mesh2MotionCleanupDriverJoints;
  partBindings?: V3Mesh2MotionCleanupPartBindings;
  weaponSockets?: V3Mesh2MotionCleanupWeaponSockets;
}

export interface V3Mesh2MotionCleanupTrack {
  id: string;
  cleanClipId: string;
  sourceClipName: string;
  keyframes: readonly V3Mesh2MotionCleanupKeyframe[];
}

export interface V3Mesh2MotionCleanupSample {
  trackId: string;
  cleanClipId: string;
  sourceClipName: string;
  normalizedTime: number;
  driverJoints: V3Mesh2MotionCleanupDriverJoints;
  partBindings: V3Mesh2MotionCleanupPartBindings;
  weaponSockets: V3Mesh2MotionCleanupWeaponSockets;
  driverJointAdjustmentCount: number;
  partBindingAdjustmentCount: number;
  weaponSocketAdjustmentCount: number;
}

export interface V3Mesh2MotionCleanupTrackSampleOptions {
  tracks?: readonly V3Mesh2MotionCleanupTrack[];
}

const ZERO_VEC3: V3Mesh2MotionCalibrationVec3 = [0, 0, 0];
const ONE_VEC3: V3Mesh2MotionCalibrationVec3 = [1, 1, 1];
const EPSILON = 0.000001;

const identityTrack = (
  cleanClipId: string,
  sourceClipName: string
): V3Mesh2MotionCleanupTrack => ({
  id: `${cleanClipId}:${sourceClipName}`,
  cleanClipId,
  sourceClipName,
  keyframes: [
    { time: 0 },
    { time: 1 },
  ],
});

export const V3_MESH2MOTION_CLEANUP_TRACKS = [
  identityTrack('clean_sprint', 'Sprint_Loop'),
  identityTrack('clean_slide', 'Slide_Loop'),
  identityTrack('clean_sword_carry', 'Sword_Idle'),
  identityTrack('clean_sword_lunge', 'Sword_Dash_RM'),
  identityTrack('clean_sword_slash', 'Sword_Regular_B'),
] as const satisfies readonly V3Mesh2MotionCleanupTrack[];

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

const shortestAngleDelta = (from: number, to: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const lerpAngle = (from: number, to: number, amount: number): number =>
  from + shortestAngleDelta(from, to) * amount;

const vec3 = (
  value: readonly number[] | undefined,
  fallback: V3Mesh2MotionCalibrationVec3
): V3Mesh2MotionCalibrationVec3 => [
  Number.isFinite(value?.[0]) ? Number(value?.[0]) : fallback[0],
  Number.isFinite(value?.[1]) ? Number(value?.[1]) : fallback[1],
  Number.isFinite(value?.[2]) ? Number(value?.[2]) : fallback[2],
];

const lerpVec3 = (
  from: V3Mesh2MotionCalibrationVec3,
  to: V3Mesh2MotionCalibrationVec3,
  amount: number
): V3Mesh2MotionCalibrationVec3 => [
  roundMetric(lerp(from[0], to[0], amount)),
  roundMetric(lerp(from[1], to[1], amount)),
  roundMetric(lerp(from[2], to[2], amount)),
];

const lerpRotation = (
  from: V3Mesh2MotionCalibrationVec3,
  to: V3Mesh2MotionCalibrationVec3,
  amount: number
): V3Mesh2MotionCalibrationVec3 => [
  roundMetric(lerpAngle(from[0], to[0], amount)),
  roundMetric(lerpAngle(from[1], to[1], amount)),
  roundMetric(lerpAngle(from[2], to[2], amount)),
];

const hasNonIdentityTransform = (
  transform: V3Mesh2MotionPartBindingCleanup,
  includeScale: boolean
): boolean => (
  transform.position.some((component) => Math.abs(component) > EPSILON) ||
  transform.rotation.some((component) => Math.abs(component) > EPSILON) ||
  (includeScale && (transform.scale ?? ONE_VEC3).some((component, index) => Math.abs(component - ONE_VEC3[index]) > EPSILON))
);

const sampleTransform = (
  from: V3Mesh2MotionPartBindingCleanup | undefined,
  to: V3Mesh2MotionPartBindingCleanup | undefined,
  amount: number,
  includeScale: boolean
): V3Mesh2MotionPartBindingCleanup | null => {
  const sampled: V3Mesh2MotionPartBindingCleanup = {
    position: lerpVec3(
      vec3(from?.position, ZERO_VEC3),
      vec3(to?.position, ZERO_VEC3),
      amount
    ),
    rotation: lerpRotation(
      vec3(from?.rotation, ZERO_VEC3),
      vec3(to?.rotation, ZERO_VEC3),
      amount
    ),
  };
  if (includeScale || from?.scale || to?.scale) {
    sampled.scale = lerpVec3(
      vec3(from?.scale, ONE_VEC3),
      vec3(to?.scale, ONE_VEC3),
      amount
    );
  }
  return hasNonIdentityTransform(sampled, includeScale || Boolean(from?.scale || to?.scale))
    ? sampled
    : null;
};

const frameSpan = (
  keyframes: readonly V3Mesh2MotionCleanupKeyframe[],
  normalizedTime: number
): { previous: V3Mesh2MotionCleanupKeyframe; next: V3Mesh2MotionCleanupKeyframe; amount: number } | null => {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => clamp01(a.time) - clamp01(b.time));
  const first = sorted[0];
  if (normalizedTime <= clamp01(first.time)) return { previous: first, next: first, amount: 0 };
  const last = sorted[sorted.length - 1];
  if (normalizedTime >= clamp01(last.time)) return { previous: last, next: last, amount: 0 };
  const nextIndex = sorted.findIndex((keyframe) => clamp01(keyframe.time) >= normalizedTime);
  const previous = sorted[Math.max(0, nextIndex - 1)];
  const next = sorted[nextIndex] ?? previous;
  const from = clamp01(previous.time);
  const to = clamp01(next.time);
  return {
    previous,
    next,
    amount: to === from ? 0 : clamp01((normalizedTime - from) / (to - from)),
  };
};

const sampleTransformMap = <Key extends string>(
  from: Partial<Record<Key, V3Mesh2MotionPartBindingCleanup>> | undefined,
  to: Partial<Record<Key, V3Mesh2MotionPartBindingCleanup>> | undefined,
  amount: number,
  includeScale: boolean
): Partial<Record<Key, V3Mesh2MotionPartBindingCleanup>> => {
  const keys = new Set<Key>([
    ...(Object.keys(from ?? {}) as Key[]),
    ...(Object.keys(to ?? {}) as Key[]),
  ]);
  const sampled: Partial<Record<Key, V3Mesh2MotionPartBindingCleanup>> = {};
  for (const key of keys) {
    const transform = sampleTransform(from?.[key], to?.[key], amount, includeScale);
    if (transform) sampled[key] = transform;
  }
  return sampled;
};

export function sampleV3Mesh2MotionCleanupTrack(
  cleanClipId: string,
  sourceClipName: string,
  normalizedTime: number,
  options: V3Mesh2MotionCleanupTrackSampleOptions = {}
): V3Mesh2MotionCleanupSample | null {
  const track = (options.tracks ?? V3_MESH2MOTION_CLEANUP_TRACKS).find((candidate) => (
    candidate.cleanClipId === cleanClipId &&
    candidate.sourceClipName === sourceClipName
  ));
  if (!track) return null;

  const safeTime = clamp01(normalizedTime);
  const span = frameSpan(track.keyframes, safeTime);
  const driverJoints = span
    ? sampleTransformMap(span.previous.driverJoints, span.next.driverJoints, span.amount, false)
    : {};
  const partBindings = span
    ? sampleTransformMap(span.previous.partBindings, span.next.partBindings, span.amount, true)
    : {};
  const weaponSockets = span
    ? sampleTransformMap(span.previous.weaponSockets, span.next.weaponSockets, span.amount, false)
    : {};

  return {
    trackId: track.id,
    cleanClipId: track.cleanClipId,
    sourceClipName: track.sourceClipName,
    normalizedTime: safeTime,
    driverJoints,
    partBindings,
    weaponSockets,
    driverJointAdjustmentCount: Object.keys(driverJoints).length,
    partBindingAdjustmentCount: Object.keys(partBindings).length,
    weaponSocketAdjustmentCount: Object.keys(weaponSockets).length,
  };
}
