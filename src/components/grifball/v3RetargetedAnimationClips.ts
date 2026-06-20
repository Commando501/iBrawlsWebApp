import * as THREE from 'three';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import { V3_MIXAMO_CLIP_ARTIFACT } from './v3MixamoClips.generated';

export type V3RetargetedClipId = keyof typeof V3_MIXAMO_CLIP_ARTIFACT.clips;
export type V3RetargetedClipSource = 'retargetedMixamo';

export const V3_RETARGETED_MIXAMO_CLIP_IDS = ['idle', 'walk', 'run'] as const satisfies readonly V3RetargetedClipId[];

export interface V3RetargetedJointSample {
  rotation: [number, number, number];
  offset?: [number, number, number];
}

export interface V3RetargetedClipSample {
  clipId: V3RetargetedClipId;
  clipSource: V3RetargetedClipSource;
  sourceHash: string;
  normalizedTime: number;
  elapsedSeconds: number;
  ready: boolean;
  joints: Partial<Record<V3DetailBoneName, V3RetargetedJointSample>>;
}

export interface V3RetargetedClipQualityReport {
  clipId: V3RetargetedClipId;
  source: 'mixamo';
  sourceHash: string;
  ready: boolean;
  durationSeconds: number;
  frameCount: number;
  mappedJointCount: number;
  motionRetention: V3RetargetedMotionRetentionReport;
  horizontalRootMotionStripped: boolean;
  issues: string[];
}

export interface V3RetargetedMotionRetentionJointReport {
  joint: V3DetailBoneName;
  axis: 'x';
  rawMaxRotation: number;
  appliedMaxRotation: number;
  retainedRatio: number;
  requiredMinAppliedRotation?: number;
  requiredMaxAppliedRotation?: number;
  ready: boolean;
}

export interface V3RetargetedMotionRetentionReport {
  clipId: V3RetargetedClipId;
  ready: boolean;
  sampleCount: number;
  joints: Partial<Record<V3DetailBoneName, V3RetargetedMotionRetentionJointReport>>;
  issues: string[];
}

export interface V3RetargetedClipApplyOptions {
  alpha?: number;
  lowerBodyOnly?: boolean;
  upperBodyOnly?: boolean;
}

type DetailBones = Partial<Record<V3DetailBoneName, THREE.Group>>;

const LOWER_BODY_JOINTS = new Set<V3DetailBoneName>([
  'pelvis',
  'thighLeft',
  'calfLeft',
  'footLeft',
  'toeLeft',
  'thighRight',
  'calfRight',
  'footRight',
  'toeRight',
]);

const UPPER_BODY_JOINTS = new Set<V3DetailBoneName>([
  'spine1',
  'spine2',
  'spine3',
  'chest',
  'neck',
  'head',
  'helmet',
  'clavicleLeft',
  'upperArmLeft',
  'forearmLeft',
  'handLeft',
  'clavicleRight',
  'upperArmRight',
  'forearmRight',
  'handRight',
]);

type V3JointRotationScaleMap = Partial<Record<V3DetailBoneName, [number, number, number]>>;

const JOINT_ROTATION_SCALE: V3JointRotationScaleMap = {
  pelvis: [0.28, 0.12, 0.22],
  spine1: [0.18, 0.14, 0.16],
  spine2: [0.2, 0.16, 0.18],
  chest: [0.22, 0.18, 0.2],
  neck: [0.16, 0.16, 0.16],
  head: [0.18, 0.18, 0.18],
  clavicleLeft: [0.12, 0.1, 0.16],
  upperArmLeft: [0.18, 0.16, 0.18],
  forearmLeft: [0.16, 0.12, 0.16],
  handLeft: [0.1, 0.08, 0.1],
  clavicleRight: [0.12, 0.1, 0.16],
  upperArmRight: [0.18, 0.16, 0.18],
  forearmRight: [0.16, 0.12, 0.16],
  handRight: [0.1, 0.08, 0.1],
  thighLeft: [0.32, 0.06, 0.08],
  calfLeft: [0, 0, 0],
  footLeft: [0, 0, 0],
  toeLeft: [0, 0, 0],
  thighRight: [0.32, 0.06, 0.08],
  calfRight: [0, 0, 0],
  footRight: [0, 0, 0],
  toeRight: [0, 0, 0],
};

const CLIP_LOWER_BODY_ROTATION_SCALE: Record<V3RetargetedClipId, V3JointRotationScaleMap> = {
  idle: {
    calfLeft: [0, 0, 0],
    calfRight: [0, 0, 0],
    footLeft: [0, 0, 0],
    footRight: [0, 0, 0],
    toeLeft: [0, 0, 0],
    toeRight: [0, 0, 0],
  },
  walk: {
    pelvis: [0.32, 0.12, 0.18],
    thighLeft: [0.45, 0.06, 0.08],
    thighRight: [0.48, 0.06, 0.08],
    calfLeft: [0.25, 0.03, 0.03],
    calfRight: [0.25, 0.03, 0.03],
    footLeft: [0.28, 0.03, 0.03],
    footRight: [0.28, 0.03, 0.03],
    toeLeft: [0.1, 0.02, 0.02],
    toeRight: [0.1, 0.02, 0.02],
  },
  run: {
    pelvis: [0.32, 0.1, 0.16],
    thighLeft: [0.32, 0.05, 0.07],
    thighRight: [0.32, 0.05, 0.07],
    calfLeft: [0.18, 0.03, 0.03],
    calfRight: [0.18, 0.03, 0.03],
    footLeft: [0.32, 0.03, 0.03],
    footRight: [0.22, 0.03, 0.03],
    toeLeft: [0.08, 0.02, 0.02],
    toeRight: [0.08, 0.02, 0.02],
  },
};

const BROAD_LEG_SCALE = 0;
const RUN_BROAD_LEG_BOOST = 1.18;
const PELVIS_VERTICAL_SCALE = 0.18;
const PELVIS_VERTICAL_LIMIT = 0.012;
const RETENTION_SAMPLE_TIMES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] as const;

const MOTION_RETENTION_REQUIREMENTS: Record<
  V3RetargetedClipId,
  Partial<Record<V3DetailBoneName, { minApplied?: number; maxApplied?: number }>>
> = {
  idle: {
    calfLeft: { maxApplied: 0.03 },
    calfRight: { maxApplied: 0.03 },
    footLeft: { maxApplied: 0.03 },
    footRight: { maxApplied: 0.03 },
  },
  walk: {
    thighLeft: { minApplied: 0.24 },
    thighRight: { minApplied: 0.24 },
    calfLeft: { minApplied: 0.18 },
    calfRight: { minApplied: 0.18 },
    footLeft: { minApplied: 0.08 },
    footRight: { minApplied: 0.08 },
  },
  run: {
    thighLeft: { minApplied: 0.32 },
    thighRight: { minApplied: 0.32 },
    calfLeft: { minApplied: 0.28 },
    calfRight: { minApplied: 0.28 },
    footLeft: { minApplied: 0.12 },
    footRight: { minApplied: 0.12 },
  },
};

const clampRotation = (value: number, limit: number): number => (
  THREE.MathUtils.clamp(value, -limit, limit)
);

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const loop01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

const getDetailBones = (model: THREE.Group): DetailBones | undefined => {
  const detailBones = model.userData.v3DetailBones ?? model.userData.detailBones;
  return detailBones && typeof detailBones === 'object'
    ? detailBones as DetailBones
    : undefined;
};

const getRestPosition = (group: THREE.Group): THREE.Vector3Tuple => {
  const rest = group.userData.v3AnimationRestPosition;
  if (Array.isArray(rest) && rest.length === 3) {
    return [Number(rest[0]) || 0, Number(rest[1]) || 0, Number(rest[2]) || 0];
  }
  const captured: THREE.Vector3Tuple = [group.position.x, group.position.y, group.position.z];
  group.userData.v3AnimationRestPosition = captured;
  return captured;
};

const lerpVector = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number
): [number, number, number] => [
  roundMetric(THREE.MathUtils.lerp(a[0], b[0], t)),
  roundMetric(THREE.MathUtils.lerp(a[1], b[1], t)),
  roundMetric(THREE.MathUtils.lerp(a[2], b[2], t)),
];

const sampleKeyframes = (
  keyframes: readonly {
    t: number;
    rotation: readonly [number, number, number];
    offset?: readonly [number, number, number];
  }[],
  normalizedTime: number
): V3RetargetedJointSample => {
  if (keyframes.length === 0) return { rotation: [0, 0, 0] };
  if (keyframes.length === 1) {
    return {
      rotation: [...keyframes[0].rotation] as [number, number, number],
      ...(keyframes[0].offset ? { offset: [...keyframes[0].offset] as [number, number, number] } : {}),
    };
  }
  const t = loop01(normalizedTime);
  let nextIndex = keyframes.findIndex((frame) => frame.t >= t);
  if (nextIndex <= 0) nextIndex = 1;
  const previous = keyframes[nextIndex - 1] ?? keyframes[keyframes.length - 1];
  const next = keyframes[nextIndex] ?? keyframes[0];
  const span = Math.max(0.000001, next.t - previous.t);
  const alpha = clamp01((t - previous.t) / span);
  const sample: V3RetargetedJointSample = {
    rotation: lerpVector(previous.rotation, next.rotation, alpha),
  };
  if (previous.offset || next.offset) {
    sample.offset = lerpVector(
      previous.offset ?? [0, 0, 0],
      next.offset ?? [0, 0, 0],
      alpha
    );
  }
  return sample;
};

const scaleRotation = (
  clipId: V3RetargetedClipId,
  joint: V3DetailBoneName,
  rotation: readonly [number, number, number]
): [number, number, number] => {
  const scale = CLIP_LOWER_BODY_ROTATION_SCALE[clipId][joint] ?? JOINT_ROTATION_SCALE[joint] ?? [0.12, 0.12, 0.12];
  return [
    roundMetric(clampRotation(rotation[0] * scale[0], 0.65)),
    roundMetric(clampRotation(rotation[1] * scale[1], 0.35)),
    roundMetric(clampRotation(rotation[2] * scale[2], 0.42)),
  ];
};

export function getV3RetargetedClip(id: V3RetargetedClipId) {
  return V3_MIXAMO_CLIP_ARTIFACT.clips[id];
}

export function sampleV3RetargetedClip(
  id: V3RetargetedClipId,
  input: { normalizedTime?: number; elapsedSeconds?: number }
): V3RetargetedClipSample {
  const clip = getV3RetargetedClip(id);
  const normalizedTime = typeof input.normalizedTime === 'number'
    ? loop01(input.normalizedTime)
    : loop01((input.elapsedSeconds ?? 0) / Math.max(0.000001, clip.durationSeconds));
  const elapsedSeconds = typeof input.elapsedSeconds === 'number'
    ? input.elapsedSeconds
    : normalizedTime * clip.durationSeconds;
  const joints: V3RetargetedClipSample['joints'] = {};
  for (const [jointName, track] of Object.entries(clip.joints)) {
    if (!track) continue;
    const joint = jointName as V3DetailBoneName;
    const sampled = sampleKeyframes(track.keyframes, normalizedTime);
    joints[joint] = {
      rotation: scaleRotation(id, joint, sampled.rotation),
      ...(sampled.offset ? { offset: sampled.offset } : {}),
    };
  }
  return {
    clipId: id,
    clipSource: 'retargetedMixamo',
    sourceHash: clip.sourceHash,
    normalizedTime: roundMetric(normalizedTime),
    elapsedSeconds: roundMetric(elapsedSeconds),
    ready: true,
    joints,
  };
}

const shouldApplyJoint = (
  joint: V3DetailBoneName,
  options: V3RetargetedClipApplyOptions
): boolean => {
  if (options.lowerBodyOnly) return LOWER_BODY_JOINTS.has(joint);
  if (options.upperBodyOnly) return UPPER_BODY_JOINTS.has(joint);
  return LOWER_BODY_JOINTS.has(joint) || UPPER_BODY_JOINTS.has(joint);
};

const applyJointRotation = (
  bone: THREE.Group | undefined,
  target: readonly [number, number, number],
  alpha: number
): void => {
  if (!bone) return;
  bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, target[0], alpha);
  bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, target[1], alpha);
  bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, target[2], alpha);
};

function applyPelvisOffset(
  model: THREE.Group,
  offset: readonly [number, number, number] | undefined,
  alpha: number
): void {
  const lowerTorso = model.userData.lowerTorso;
  if (!(lowerTorso instanceof THREE.Group)) return;
  const rest = getRestPosition(lowerTorso);
  const safeOffset = offset ?? [0, 0, 0];
  const verticalOffset = THREE.MathUtils.clamp(
    Math.max(0, safeOffset[1]) * PELVIS_VERTICAL_SCALE,
    0,
    PELVIS_VERTICAL_LIMIT
  );
  lowerTorso.position.x = THREE.MathUtils.lerp(lowerTorso.position.x, rest[0], alpha);
  lowerTorso.position.y = THREE.MathUtils.lerp(lowerTorso.position.y, rest[1] + verticalOffset, alpha);
  lowerTorso.position.z = THREE.MathUtils.lerp(lowerTorso.position.z, rest[2], alpha);
}

function applyBroadLegMotion(
  model: THREE.Group,
  sample: V3RetargetedClipSample,
  alpha: number
): void {
  const leftLeg = model.userData.leftLeg;
  const rightLeg = model.userData.rightLeg;
  const boost = sample.clipId === 'run' ? RUN_BROAD_LEG_BOOST : 1;
  if (leftLeg instanceof THREE.Group) {
    const target = (sample.joints.thighLeft?.rotation[0] ?? 0) * BROAD_LEG_SCALE * boost;
    leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, target, alpha);
    leftLeg.rotation.z = THREE.MathUtils.lerp(leftLeg.rotation.z, 0, alpha);
  }
  if (rightLeg instanceof THREE.Group) {
    const target = (sample.joints.thighRight?.rotation[0] ?? 0) * BROAD_LEG_SCALE * boost;
    rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, target, alpha);
    rightLeg.rotation.z = THREE.MathUtils.lerp(rightLeg.rotation.z, 0, alpha);
  }
}

export function applyV3RetargetedClipPose(
  model: THREE.Group,
  sample: V3RetargetedClipSample,
  options: V3RetargetedClipApplyOptions = {}
): boolean {
  const detailBones = getDetailBones(model);
  if (!detailBones) return false;
  const alpha = typeof options.alpha === 'number' ? clamp01(options.alpha) : 1;
  for (const [jointName, jointSample] of Object.entries(sample.joints)) {
    const joint = jointName as V3DetailBoneName;
    if (!jointSample || !shouldApplyJoint(joint, options)) continue;
    applyJointRotation(detailBones[joint], jointSample.rotation, alpha);
  }
  if (!options.upperBodyOnly) {
    applyPelvisOffset(model, sample.joints.pelvis?.offset, alpha);
    applyBroadLegMotion(model, sample, alpha);
    model.userData.v3LowerBodyBridgeActive = sample.clipId === 'walk' || sample.clipId === 'run';
  }
  model.userData.v3RetargetedClip = {
    clipId: sample.clipId,
    clipSource: sample.clipSource,
    sourceHash: sample.sourceHash,
    normalizedTime: sample.normalizedTime,
  };
  return true;
}

export function analyzeV3RetargetedClipQuality(
  id: V3RetargetedClipId
): V3RetargetedClipQualityReport {
  const clip = getV3RetargetedClip(id);
  const issues: string[] = [];
  const motionRetention = analyzeV3RetargetedMotionRetention(id);
  if (clip.durationSeconds <= 0) issues.push('duration is empty');
  if (clip.frameCount <= 1) issues.push('frame count is too low');
  if (clip.rootMotion.horizontalStripped !== true) issues.push('horizontal root motion was not stripped');
  if (!/^sha256:[0-9a-f]{64}$/.test(clip.sourceHash)) issues.push('source hash is invalid');
  if (!motionRetention.ready) issues.push(...motionRetention.issues);
  for (const time of [0, 0.5, 1]) {
    const sample = sampleV3RetargetedClip(id, { normalizedTime: time });
    for (const [jointName, joint] of Object.entries(sample.joints)) {
      if (!joint?.rotation.every(Number.isFinite)) issues.push(`${jointName} has non-finite rotation`);
      if (joint?.offset && !joint.offset.every(Number.isFinite)) issues.push(`${jointName} has non-finite offset`);
    }
  }
  return {
    clipId: id,
    source: clip.source,
    sourceHash: clip.sourceHash,
    ready: issues.length === 0,
    durationSeconds: clip.durationSeconds,
    frameCount: clip.frameCount,
    mappedJointCount: clip.metrics.mappedJointCount,
    motionRetention,
    horizontalRootMotionStripped: clip.rootMotion.horizontalStripped,
    issues,
  };
}

const maxAbsXRotation = (rotations: readonly (readonly [number, number, number])[]): number => (
  roundMetric(Math.max(0, ...rotations.map((rotation) => Math.abs(rotation[0]))))
);

export function analyzeV3RetargetedMotionRetention(
  id: V3RetargetedClipId
): V3RetargetedMotionRetentionReport {
  const clip = getV3RetargetedClip(id);
  const requirements = MOTION_RETENTION_REQUIREMENTS[id];
  const joints = {} as Partial<Record<V3DetailBoneName, V3RetargetedMotionRetentionJointReport>>;
  const issues: string[] = [];

  for (const [jointName, requirement] of Object.entries(requirements) as [
    V3DetailBoneName,
    { minApplied?: number; maxApplied?: number }
  ][]) {
    const track = clip.joints[jointName];
    const rawRotations = RETENTION_SAMPLE_TIMES.map((normalizedTime) => (
      track ? sampleKeyframes(track.keyframes, normalizedTime).rotation : [0, 0, 0] as [number, number, number]
    ));
    const appliedRotations = RETENTION_SAMPLE_TIMES.map((normalizedTime) => (
      sampleV3RetargetedClip(id, { normalizedTime }).joints[jointName]?.rotation ?? [0, 0, 0] as [number, number, number]
    ));
    const rawMaxRotation = maxAbsXRotation(rawRotations);
    const appliedMaxRotation = maxAbsXRotation(appliedRotations);
    const retainedRatio = rawMaxRotation > 0
      ? roundMetric(appliedMaxRotation / rawMaxRotation)
      : 0;
    const minReady = requirement.minApplied === undefined || appliedMaxRotation >= requirement.minApplied;
    const maxReady = requirement.maxApplied === undefined || appliedMaxRotation <= requirement.maxApplied;
    const ready = minReady && maxReady;
    if (!minReady) {
      issues.push(
        `retargeted-motion-too-low: ${id} ${jointName} applied ${appliedMaxRotation.toFixed(3)} < ${requirement.minApplied?.toFixed(3)}`
      );
    }
    if (!maxReady) {
      issues.push(
        `retargeted-motion-too-high: ${id} ${jointName} applied ${appliedMaxRotation.toFixed(3)} > ${requirement.maxApplied?.toFixed(3)}`
      );
    }
    joints[jointName] = {
      joint: jointName,
      axis: 'x',
      rawMaxRotation,
      appliedMaxRotation,
      retainedRatio,
      ...(requirement.minApplied !== undefined ? { requiredMinAppliedRotation: requirement.minApplied } : {}),
      ...(requirement.maxApplied !== undefined ? { requiredMaxAppliedRotation: requirement.maxApplied } : {}),
      ready,
    };
  }

  return {
    clipId: id,
    ready: issues.length === 0,
    sampleCount: RETENTION_SAMPLE_TIMES.length,
    joints,
    issues,
  };
}

export function hasV3RetargetedClip(id: string): id is V3RetargetedClipId {
  return Object.prototype.hasOwnProperty.call(V3_MIXAMO_CLIP_ARTIFACT.clips, id);
}
