import * as THREE from 'three';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import type { WeaponPose } from './attackAnimationPresets';
import { V3_MIXAMO_WEAPON_REFERENCE_SET } from './v3MixamoWeaponReferences.generated';

export const V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS = [
  'hammer_2hand_idle',
  'hammer_heavy_swing',
  'hammer_melee_advance',
  'sword_outward_slash',
  'hammer_smash_reference',
] as const;

export type V3WeaponReferenceClipId = (typeof V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS)[number];
export type V3WeaponReferenceRuntimeRole = 'runtimeReference' | 'analysisOnly';

export interface V3WeaponReferenceJointSample {
  rotation: [number, number, number];
  position: [number, number, number];
}

export interface V3WeaponReferenceClipMetrics {
  sourceTrackCount: number;
  sourceFrameCount: number;
  mappedJointCount: number;
  droppedTrackCount: number;
  handPathDistance: {
    left: number;
    right: number;
  };
  handSeparation: {
    min: number;
    max: number;
    mean: number;
  };
  shoulderMotion: {
    left: number;
    right: number;
  };
  forwardSweep: number;
  upSweep: number;
  nonFiniteTransformCount: number;
}

export interface V3WeaponReferenceCalibration {
  sourceRestClip: 'T-Pose.fbx';
  space: 'v3Chest';
  scale: [number, number, number];
  shoulderSpan: number;
  handSpan: number;
}

export interface V3WeaponReferenceClip {
  schemaVersion: string;
  clipId: V3WeaponReferenceClipId;
  label: string;
  runtimeRole: V3WeaponReferenceRuntimeRole;
  source: {
    fileName: string;
    sha256: string;
    byteLength: number;
  };
  duration: number;
  fps: number;
  frameCount: number;
  calibration?: V3WeaponReferenceCalibration;
  normalizedTimes: readonly number[];
  keyframes: readonly {
    normalizedTime: number;
    elapsedSeconds: number;
    joints: Partial<Record<V3DetailBoneName, V3WeaponReferenceJointSample>>;
  }[];
  metrics: V3WeaponReferenceClipMetrics;
}

export type V3WeaponReferenceJointName = keyof V3WeaponReferenceClip['keyframes'][number]['joints'] & V3DetailBoneName;

const V3_WEAPON_REFERENCE_SET = V3_MIXAMO_WEAPON_REFERENCE_SET as unknown as {
  clips: readonly V3WeaponReferenceClip[];
};

export interface V3WeaponReferenceSample {
  clipId: V3WeaponReferenceClipId;
  runtimeRole: V3WeaponReferenceRuntimeRole;
  sourceHash: string;
  normalizedTime: number;
  elapsedSeconds: number;
  ready: boolean;
  joints: Partial<Record<V3DetailBoneName, V3WeaponReferenceJointSample>>;
}

export interface V3WeaponReferenceAnalysis {
  clipId: V3WeaponReferenceClipId;
  runtimeRole: V3WeaponReferenceRuntimeRole;
  sourceHash: string;
  ready: boolean;
  duration: number;
  frameCount: number;
  metrics: V3WeaponReferenceClipMetrics;
  issues?: string[];
}

export interface V3WeaponReferencePoseFit {
  clipId: V3WeaponReferenceClipId;
  normalizedTime: number;
  primaryHandPosition: [number, number, number];
  offhandPosition?: [number, number, number];
  weaponPose: WeaponPose;
}

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const DEFAULT_REFERENCE_CALIBRATION: V3WeaponReferenceCalibration = {
  sourceRestClip: 'T-Pose.fbx',
  space: 'v3Chest',
  scale: [1.15, 1.25, 0.55],
  shoulderSpan: 0.94,
  handSpan: 0.94,
};

const WEAPON_REFERENCE_SCALE: Record<'hammer' | 'sword', [number, number, number]> = {
  hammer: DEFAULT_REFERENCE_CALIBRATION.scale,
  sword: [1.15, 1.55, 0.75],
};

const CANONICAL_FORWARD = new THREE.Vector3(0, 0, -1);
const CANONICAL_UP = new THREE.Vector3(0, 1, 0);

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const cloneTuple = (value: readonly [number, number, number]): [number, number, number] => [
  value[0],
  value[1],
  value[2],
];

const lerpTuple = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  amount: number
): [number, number, number] => [
  roundMetric(left[0] + (right[0] - left[0]) * amount),
  roundMetric(left[1] + (right[1] - left[1]) * amount),
  roundMetric(left[2] + (right[2] - left[2]) * amount),
];

const finiteTuple = (value: readonly number[] | undefined): boolean => (
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
);

const hasClipId = (id: string): id is V3WeaponReferenceClipId => (
  (V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS as readonly string[]).includes(id)
);

export function getV3WeaponReferenceClip(id: V3WeaponReferenceClipId): V3WeaponReferenceClip {
  const clip = V3_WEAPON_REFERENCE_SET.clips.find((candidate) => candidate.clipId === id);
  if (!clip) throw new Error(`Unknown V3 Mixamo weapon reference clip: ${id}`);
  return {
    ...clip,
    calibration: clip.calibration ?? DEFAULT_REFERENCE_CALIBRATION,
  };
}

const sampleFrame = (
  clip: V3WeaponReferenceClip,
  normalizedTime: number
): V3WeaponReferenceSample['joints'] => {
  if (clip.keyframes.length === 0) return {};
  if (clip.keyframes.length === 1) {
    return Object.fromEntries(
      Object.entries(clip.keyframes[0].joints).map(([joint, sample]) => [
        joint,
        {
          rotation: cloneTuple(sample.rotation),
          position: cloneTuple(sample.position),
        },
      ])
    ) as V3WeaponReferenceSample['joints'];
  }

  const t = clamp01(normalizedTime);
  let nextIndex = clip.keyframes.findIndex((frame) => frame.normalizedTime >= t);
  if (nextIndex <= 0) nextIndex = 1;
  const previous = clip.keyframes[nextIndex - 1] ?? clip.keyframes[0];
  const next = clip.keyframes[nextIndex] ?? clip.keyframes[clip.keyframes.length - 1];
  const span = Math.max(0.000001, next.normalizedTime - previous.normalizedTime);
  const amount = clamp01((t - previous.normalizedTime) / span);
  const joints: V3WeaponReferenceSample['joints'] = {};

  for (const jointName of new Set([...Object.keys(previous.joints), ...Object.keys(next.joints)])) {
    const previousJoint = previous.joints[jointName as V3DetailBoneName];
    const nextJoint = next.joints[jointName as V3DetailBoneName];
    const source = previousJoint ?? nextJoint;
    if (!source) continue;
    joints[jointName as V3DetailBoneName] = {
      rotation: previousJoint && nextJoint
        ? lerpTuple(previousJoint.rotation, nextJoint.rotation, amount)
        : cloneTuple(source.rotation),
      position: previousJoint && nextJoint
        ? lerpTuple(previousJoint.position, nextJoint.position, amount)
        : cloneTuple(source.position),
    };
  }

  return joints;
};

export function sampleV3WeaponReferenceClip(
  id: V3WeaponReferenceClipId,
  input: { normalizedTime?: number; elapsedSeconds?: number }
): V3WeaponReferenceSample {
  const clip = getV3WeaponReferenceClip(id);
  const normalizedTime = typeof input.normalizedTime === 'number'
    ? clamp01(input.normalizedTime)
    : clamp01((input.elapsedSeconds ?? 0) / Math.max(0.000001, clip.duration));
  const elapsedSeconds = typeof input.elapsedSeconds === 'number'
    ? roundMetric(input.elapsedSeconds)
    : roundMetric(normalizedTime * clip.duration);
  const joints = sampleFrame(clip, normalizedTime);

  return {
    clipId: id,
    runtimeRole: clip.runtimeRole,
    sourceHash: clip.source.sha256,
    normalizedTime: roundMetric(normalizedTime),
    elapsedSeconds,
    ready: clip.metrics.nonFiniteTransformCount === 0,
    joints,
  };
}

export function analyzeV3WeaponReferenceClip(id: V3WeaponReferenceClipId): V3WeaponReferenceAnalysis {
  const clip = getV3WeaponReferenceClip(id);
  const issues: string[] = [];
  if (clip.duration <= 0) issues.push('duration is empty');
  if (clip.frameCount <= 1) issues.push('frame count is too low');
  if (clip.metrics.mappedJointCount < 6) issues.push('mapped upper-body joint count is too low');
  if (clip.metrics.nonFiniteTransformCount > 0) issues.push('non-finite reference transform');
  if (!/^[0-9a-f]{64}$/.test(clip.source.sha256)) issues.push('source hash is invalid');

  for (const time of [0, 0.25, 0.5, 0.75, 1]) {
    const sample = sampleV3WeaponReferenceClip(id, { normalizedTime: time });
    for (const [jointName, joint] of Object.entries(sample.joints)) {
      if (!finiteTuple(joint?.position)) issues.push(`${jointName} has invalid position`);
      if (!finiteTuple(joint?.rotation)) issues.push(`${jointName} has invalid rotation`);
    }
  }

  return {
    clipId: id,
    runtimeRole: clip.runtimeRole,
    sourceHash: clip.source.sha256,
    ready: issues.length === 0,
    duration: clip.duration,
    frameCount: clip.frameCount,
    metrics: clip.metrics,
    ...(issues.length > 0 ? { issues } : {}),
  };
}

export function hasV3WeaponReferenceClip(id: string): id is V3WeaponReferenceClipId {
  return hasClipId(id);
}

const referenceHandToV3ChestSpace = (
  hand: readonly [number, number, number],
  scale: number | readonly [number, number, number] = 1
): [number, number, number] => {
  const scaleTuple: readonly [number, number, number] = typeof scale === 'number'
    ? [
      DEFAULT_REFERENCE_CALIBRATION.scale[0] * scale,
      DEFAULT_REFERENCE_CALIBRATION.scale[1] * scale,
      DEFAULT_REFERENCE_CALIBRATION.scale[2] * scale,
    ]
    : scale;
  return [
    roundMetric(hand[0] * scaleTuple[0]),
    roundMetric(hand[1] * scaleTuple[1]),
    roundMetric(hand[2] * scaleTuple[2]),
  ];
};

const safeUnit = (value: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 => {
  if (value.lengthSq() > 1e-8) return value.clone().normalize();
  return fallback.clone().normalize();
};

const projectOnPlane = (value: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 =>
  value.clone().sub(normal.clone().multiplyScalar(value.dot(normal)));

const quaternionFromForwardUp = (
  sourceForward: THREE.Vector3,
  sourceUp: THREE.Vector3,
  targetForward: THREE.Vector3,
  targetUp: THREE.Vector3
): THREE.Quaternion => {
  const sourceForwardUnit = safeUnit(sourceForward, CANONICAL_FORWARD);
  const targetForwardUnit = safeUnit(targetForward, CANONICAL_FORWARD);
  const forwardRotation = new THREE.Quaternion().setFromUnitVectors(sourceForwardUnit, targetForwardUnit);
  const rotatedUp = sourceUp.clone().normalize().applyQuaternion(forwardRotation);
  const sourceUpProjected = safeUnit(projectOnPlane(rotatedUp, targetForwardUnit), CANONICAL_UP);
  const targetUpProjected = safeUnit(projectOnPlane(targetUp.clone().normalize(), targetForwardUnit), CANONICAL_UP);
  const upRotation = new THREE.Quaternion().setFromUnitVectors(sourceUpProjected, targetUpProjected);
  return upRotation.multiply(forwardRotation).normalize();
};

const eulerTupleFromForwardUp = (
  targetForward: THREE.Vector3,
  targetUp: THREE.Vector3 = CANONICAL_UP
): [number, number, number] => {
  const quaternion = quaternionFromForwardUp(CANONICAL_FORWARD, CANONICAL_UP, targetForward, targetUp);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [roundMetric(euler.x), roundMetric(euler.y), roundMetric(euler.z)];
};

const vectorFromTuple = (value: readonly [number, number, number]): THREE.Vector3 =>
  new THREE.Vector3(value[0], value[1], value[2]);

const fitHammerRotation = (
  primary: readonly [number, number, number],
  offhand: readonly [number, number, number] | undefined
): [number, number, number] => {
  if (!offhand) return [0, 0, 0];
  const targetForward = vectorFromTuple(offhand).sub(vectorFromTuple(primary));
  const targetUp = new THREE.Vector3(0, 1, 0.15);
  return eulerTupleFromForwardUp(targetForward, targetUp);
};

const fitSwordRotation = (
  primary: readonly [number, number, number],
  forearm: readonly [number, number, number] | undefined,
  sample: V3WeaponReferenceSample,
  scale: readonly [number, number, number]
): [number, number, number] => {
  const previous = sampleV3WeaponReferenceClip(sample.clipId, {
    normalizedTime: Math.max(0, sample.normalizedTime - 0.08),
  }).joints.handRight?.position;
  const handVector = forearm
    ? vectorFromTuple(primary).sub(vectorFromTuple(referenceHandToV3ChestSpace(forearm, scale)))
    : new THREE.Vector3();
  const motionVector = previous
    ? vectorFromTuple(primary).sub(vectorFromTuple(referenceHandToV3ChestSpace(previous, scale)))
    : new THREE.Vector3();
  const targetForward = handVector.multiplyScalar(0.65)
    .add(motionVector.multiplyScalar(0.35))
    .add(new THREE.Vector3(0, 0, -0.25));
  return eulerTupleFromForwardUp(targetForward, CANONICAL_UP);
};

export function fitV3WeaponPoseFromReferenceSample(
  clipId: V3WeaponReferenceClipId,
  input: {
    normalizedTime: number;
    weapon: 'hammer' | 'sword';
    scale?: number;
    rotation?: [number, number, number];
  }
): V3WeaponReferencePoseFit {
  const sample = sampleV3WeaponReferenceClip(clipId, { normalizedTime: input.normalizedTime });
  const multiplier = input.scale ?? 1;
  const baseScale = WEAPON_REFERENCE_SCALE[input.weapon];
  const scale: [number, number, number] = [
    baseScale[0] * multiplier,
    baseScale[1] * multiplier,
    baseScale[2] * multiplier,
  ];
  const primary = referenceHandToV3ChestSpace(sample.joints.handRight?.position ?? [0, -0.35, 0], scale);
  const offhand = sample.joints.handLeft?.position
    ? referenceHandToV3ChestSpace(sample.joints.handLeft.position, scale)
    : undefined;
  const forearm = sample.joints.forearmRight?.position;
  const rotation = input.rotation ?? (
    input.weapon === 'hammer'
      ? fitHammerRotation(primary, offhand)
      : fitSwordRotation(primary, forearm, sample, scale)
  );

  return {
    clipId,
    normalizedTime: sample.normalizedTime,
    primaryHandPosition: primary,
    ...(offhand ? { offhandPosition: offhand } : {}),
    weaponPose: {
      position: primary,
      rotation,
    },
  };
}
