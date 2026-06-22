import * as THREE from 'three';
import type { V3PoseClearanceCaseId } from './v3PoseClearance';
import {
  type V3AnimationAuthority,
  type V3CleanJointName,
  type V3CleanRigPose,
  type V3CleanRigWeaponPose,
  type V3QuatTuple,
  type V3Vec3Tuple,
} from './v3CleanRig';
import {
  sampleV3CleanMixamoClip,
  type V3CleanMixamoClipId,
  type V3CleanMixamoMotionSource,
} from './v3CleanMixamoClips';
import { V3_DETAIL_BONE_NAMES } from '../v3/v3RigDetail';
import { V3_MANUAL_AUTHORED_ANIMATION_CLIPS } from './v3ManualAuthoredAnimationClips.generated';

export const ATLAS_EDITOR_EXPORT_VERSION = 1;

export const V3_AUTHORED_ANIMATION_CLIP_IDS = [
  'clean_idle',
  'clean_walk',
  'clean_sprint',
  'clean_slide',
  'clean_hammer_carry',
  'clean_hammer_windup',
  'clean_hammer_strike',
  'clean_hammer_recover',
  'clean_hammer_melee',
  'clean_hammer_melee_recover',
  'clean_sword_carry',
  'clean_sword_lunge',
  'clean_sword_slash',
  'clean_sword_recover',
  'clean_pistol_carry',
  'clean_pistol_fire',
  'clean_hit_react',
] as const;

export type V3AuthoredClipId = (typeof V3_AUTHORED_ANIMATION_CLIP_IDS)[number];

export interface V3AuthoredKeyframe {
  frame: number;
  label?: string;
  rootOffset?: V3Vec3Tuple;
  jointQuaternions: Partial<Record<V3CleanJointName, V3QuatTuple>>;
  weaponPose?: V3CleanRigWeaponPose;
  socketLockMarkers?: {
    primary?: V3Vec3Tuple;
    offhand?: V3Vec3Tuple;
  };
}

export interface V3AuthoredJointTrack {
  joint: V3CleanJointName;
  keyframes: Array<{
    frame: number;
    quaternion: V3QuatTuple;
  }>;
}

export interface V3AuthoredWeaponTrack {
  weapon: 'hammer' | 'sword' | 'pistol';
  keyframes: Array<{
    frame: number;
    position: V3Vec3Tuple;
    rotation: V3Vec3Tuple;
  }>;
}

export interface V3AuthoredAnimationClip {
  id: V3AuthoredClipId;
  label: string;
  source: 'atlasEditor';
  fps: 60;
  durationFrames: number;
  loop: boolean;
  animationAuthority: Extract<V3AnimationAuthority, 'cleanRig'>;
  keyframes: readonly V3AuthoredKeyframe[];
  jointTracks?: readonly V3AuthoredJointTrack[];
  weaponTrack?: V3AuthoredWeaponTrack;
  metadata: {
    authoringSurface: 'v3AnimationAtlasCleanRigEditor';
    sanitized: true;
    mixamoRuntimeAuthority: false;
  };
}

export interface V3AuthoredAnimationSample {
  clip: V3AuthoredAnimationClip;
  clipId: V3AuthoredClipId;
  frame: number;
  normalizedTime: number;
  pose: V3CleanRigPose;
  weaponPose?: V3CleanRigWeaponPose;
  motionSource: V3CleanMixamoMotionSource | 'atlasAuthored';
  mixamoClipId?: V3CleanMixamoClipId;
  sourceNormalizedTime?: number;
}

export interface V3AuthoredClipExport {
  version: typeof ATLAS_EDITOR_EXPORT_VERSION;
  id: V3AuthoredClipId;
  label: string;
  durationFrames: number;
  fps: 60;
  loop: boolean;
  animationAuthority: 'cleanRig';
  keyframes: V3AuthoredKeyframe[];
  metadata: V3AuthoredAnimationClip['metadata'];
}

const CLEAN_IDENTITY_QUAT: V3QuatTuple = [0, 0, 0, 1];
const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];
const V3_CLEAN_JOINT_NAME_SET = new Set<string>(V3_DETAIL_BONE_NAMES);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const q = (x = 0, y = 0, z = 0): V3QuatTuple => {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).normalize();
  return [quat.x, quat.y, quat.z, quat.w];
};

const normalizeQuatTuple = (value: readonly number[] | undefined): V3QuatTuple => {
  const quat = new THREE.Quaternion(
    Number.isFinite(value?.[0]) ? Number(value?.[0]) : 0,
    Number.isFinite(value?.[1]) ? Number(value?.[1]) : 0,
    Number.isFinite(value?.[2]) ? Number(value?.[2]) : 0,
    Number.isFinite(value?.[3]) ? Number(value?.[3]) : 1
  );
  if (quat.lengthSq() < 0.000001) return [...CLEAN_IDENTITY_QUAT];
  quat.normalize();
  return [quat.x, quat.y, quat.z, quat.w].map((component) => Number(component.toFixed(9))) as V3QuatTuple;
};

const sanitizeQuatTuple = (value: readonly number[] | undefined): V3QuatTuple => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    return [...CLEAN_IDENTITY_QUAT];
  }
  return value.map((component) => Number(component)) as V3QuatTuple;
};

const normalizeImportedQuatTuple = (value: readonly number[] | undefined): V3QuatTuple => {
  const sanitized = sanitizeQuatTuple(value);
  const length = Math.hypot(sanitized[0], sanitized[1], sanitized[2], sanitized[3]);
  return Math.abs(length - 1) < 0.000001 ? sanitized : normalizeQuatTuple(sanitized);
};

const sanitizeVec3Tuple = (
  value: readonly number[] | undefined,
  fallback: V3Vec3Tuple = ZERO_VEC3
): V3Vec3Tuple => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    return [...fallback];
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
};

const isV3CleanJointName = (value: string): value is V3CleanJointName =>
  V3_CLEAN_JOINT_NAME_SET.has(value);

const slerpQuat = (from: V3QuatTuple, to: V3QuatTuple, amount: number): V3QuatTuple => {
  const quat = new THREE.Quaternion(...from).normalize()
    .slerp(new THREE.Quaternion(...to).normalize(), clamp01(amount))
    .normalize();
  return [quat.x, quat.y, quat.z, quat.w];
};

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const shortestAngleDelta = (from: number, to: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const lerpAngle = (from: number, to: number, amount: number): number =>
  from + shortestAngleDelta(from, to) * amount;

const lerpVec3 = (from: V3Vec3Tuple = ZERO_VEC3, to: V3Vec3Tuple = ZERO_VEC3, amount: number): V3Vec3Tuple => [
  lerp(from[0], to[0], amount),
  lerp(from[1], to[1], amount),
  lerp(from[2], to[2], amount),
];

const lerpEulerTuple = (from: V3Vec3Tuple, to: V3Vec3Tuple, amount: number): V3Vec3Tuple => [
  lerpAngle(from[0], to[0], amount),
  lerpAngle(from[1], to[1], amount),
  lerpAngle(from[2], to[2], amount),
];

const weaponPose = (
  weapon: V3CleanRigWeaponPose['weapon'],
  position: V3Vec3Tuple,
  rotation: V3Vec3Tuple,
  primarySocketMarker?: V3Vec3Tuple,
  offhandSocketMarker?: V3Vec3Tuple
): V3CleanRigWeaponPose => ({
  weapon,
  position,
  rotation,
  source: 'authoredCleanClip',
  ...(primarySocketMarker ? { primarySocketMarker } : {}),
  ...(offhandSocketMarker ? { offhandSocketMarker } : {}),
});

const cleanKeyframe = (
  frame: number,
  jointQuaternions: V3AuthoredKeyframe['jointQuaternions'] = {},
  options: Omit<V3AuthoredKeyframe, 'frame' | 'jointQuaternions'> = {}
): V3AuthoredKeyframe => ({
  frame,
  jointQuaternions,
  ...options,
});

const clip = (
  id: V3AuthoredClipId,
  label: string,
  durationFrames: number,
  keyframes: readonly V3AuthoredKeyframe[],
  loop = false
): V3AuthoredAnimationClip => ({
  id,
  label,
  source: 'atlasEditor',
  fps: 60,
  durationFrames,
  loop,
  animationAuthority: 'cleanRig',
  keyframes,
  metadata: {
    authoringSurface: 'v3AnimationAtlasCleanRigEditor',
    sanitized: true,
    mixamoRuntimeAuthority: false,
  },
});

const WALK_LEFT_FORWARD = {
  chest: q(0.04, -0.05, 0.02),
  thighLeft: q(-0.58, 0, 0.04),
  calfLeft: q(0.28, 0, 0),
  footLeft: q(0.18, 0, 0),
  thighRight: q(0.52, 0, -0.04),
  calfRight: q(-0.24, 0, 0),
  footRight: q(-0.08, 0, 0),
  upperArmLeft: q(0.18, 0, 0.04),
  upperArmRight: q(-0.16, 0, -0.04),
} satisfies V3AuthoredKeyframe['jointQuaternions'];

const WALK_RIGHT_FORWARD = {
  chest: q(0.04, 0.05, -0.02),
  thighLeft: q(0.52, 0, 0.04),
  calfLeft: q(-0.24, 0, 0),
  footLeft: q(-0.08, 0, 0),
  thighRight: q(-0.58, 0, -0.04),
  calfRight: q(0.28, 0, 0),
  footRight: q(0.18, 0, 0),
  upperArmLeft: q(-0.16, 0, 0.04),
  upperArmRight: q(0.18, 0, -0.04),
} satisfies V3AuthoredKeyframe['jointQuaternions'];

const HAMMER_CARRY_WEAPON = weaponPose('hammer', [-0.49, -0.3, 0.12], [0.34, 0.08, -0.12], [0, 0, 0], [-0.24, 0.04, 0.02]);
const SWORD_CARRY_WEAPON = weaponPose('sword', [-0.49, -0.29, 0.02], [0.35, -0.2, -Math.PI / 9], [0, 0, 0]);
const PISTOL_CARRY_WEAPON = weaponPose('pistol', [-0.49, -0.29, -0.02], [-0.04, 0.02, -0.06], [0, 0, 0]);

const HAMMER_CARRY_JOINTS = {
  chest: q(0.02, -0.04, 0.01),
  clavicleRight: q(0.05, 0.02, -0.16),
  upperArmRight: q(-0.34, 0.08, -0.18),
  forearmRight: q(-0.38, -0.08, -0.04),
  handRight: q(-0.08, 0.02, -0.06),
  clavicleLeft: q(0.04, -0.02, 0.16),
  upperArmLeft: q(-0.32, -0.08, 0.2),
  forearmLeft: q(-0.38, 0.08, 0.04),
  handLeft: q(-0.06, -0.02, 0.06),
} satisfies V3AuthoredKeyframe['jointQuaternions'];

const SWORD_CARRY_JOINTS = {
  chest: q(0.03, 0.04, -0.02),
  clavicleRight: q(0.04, 0.02, -0.12),
  upperArmRight: q(-0.56, 0.04, -0.14),
  forearmRight: q(-0.26, 0.02, -0.04),
  handRight: q(-0.08, 0.02, -0.08),
  upperArmLeft: q(-0.06, -0.12, 0.12),
  forearmLeft: q(0.04, 0, 0.08),
} satisfies V3AuthoredKeyframe['jointQuaternions'];

const PISTOL_CARRY_JOINTS = {
  chest: q(-0.04, 0.08, 0),
  clavicleRight: q(0.04, 0.03, -0.08),
  upperArmRight: q(-0.46, 0.04, -0.08),
  forearmRight: q(-0.18, 0.02, -0.04),
  handRight: q(-0.04, 0.02, -0.04),
  upperArmLeft: q(-0.08, -0.08, 0.1),
} satisfies V3AuthoredKeyframe['jointQuaternions'];

const CLIPS: Record<V3AuthoredClipId, V3AuthoredAnimationClip> = {
  clean_idle: clip('clean_idle', 'Clean Idle', 120, [
    cleanKeyframe(0, {}),
    cleanKeyframe(120, {}),
  ], true),
  clean_walk: clip('clean_walk', 'Clean Walk', 90, [
    cleanKeyframe(0, WALK_RIGHT_FORWARD),
    cleanKeyframe(18, WALK_LEFT_FORWARD),
    cleanKeyframe(45, WALK_RIGHT_FORWARD),
    cleanKeyframe(67, WALK_LEFT_FORWARD),
    cleanKeyframe(90, WALK_RIGHT_FORWARD),
  ], true),
  clean_sprint: clip('clean_sprint', 'Clean Sprint', 90, [
    cleanKeyframe(0, {
      ...WALK_RIGHT_FORWARD,
      chest: q(0.12, 0.08, -0.04),
      thighLeft: q(0.68, 0, 0.05),
      thighRight: q(-0.78, 0, -0.05),
    }),
    cleanKeyframe(12, {
      ...WALK_LEFT_FORWARD,
      chest: q(0.12, -0.08, 0.04),
      thighLeft: q(-0.78, 0, 0.05),
      thighRight: q(0.68, 0, -0.05),
    }),
    cleanKeyframe(45, {
      ...WALK_RIGHT_FORWARD,
      chest: q(0.12, 0.08, -0.04),
      thighLeft: q(0.68, 0, 0.05),
      thighRight: q(-0.78, 0, -0.05),
    }),
    cleanKeyframe(67, {
      ...WALK_LEFT_FORWARD,
      chest: q(0.12, -0.08, 0.04),
      thighLeft: q(-0.78, 0, 0.05),
      thighRight: q(0.68, 0, -0.05),
    }),
    cleanKeyframe(90, {
      ...WALK_RIGHT_FORWARD,
      chest: q(0.12, 0.08, -0.04),
      thighLeft: q(0.68, 0, 0.05),
      thighRight: q(-0.78, 0, -0.05),
    }),
  ], true),
  clean_slide: clip('clean_slide', 'Clean Slide', 72, [
    cleanKeyframe(0, {}),
    cleanKeyframe(36, {
      pelvis: q(-0.08, 0, 0),
      chest: q(-0.18, 0, 0.02),
      thighLeft: q(0.8, 0, 0.08),
      calfLeft: q(-0.55, 0, 0),
      thighRight: q(0.62, 0, -0.08),
      calfRight: q(-0.42, 0, 0),
      upperArmLeft: q(-0.18, -0.06, 0.1),
      upperArmRight: q(-0.18, 0.06, -0.1),
    }, { rootOffset: [0, -0.08, 0.05] }),
    cleanKeyframe(72, {}),
  ]),
  clean_hammer_carry: clip('clean_hammer_carry', 'Clean Hammer Carry', 90, [
    cleanKeyframe(0, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
    cleanKeyframe(90, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
  ], true),
  clean_hammer_windup: clip('clean_hammer_windup', 'Clean Hammer Windup', 60, [
    cleanKeyframe(0, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
    cleanKeyframe(60, {
      ...HAMMER_CARRY_JOINTS,
      chest: q(-0.12, -0.22, 0.12),
      upperArmRight: q(-1.05, 0.22, -0.28),
      forearmRight: q(-0.72, -0.08, -0.08),
      upperArmLeft: q(-0.9, 0.06, 0.34),
      forearmLeft: q(-0.58, 0.08, 0.1),
    }, {
      weaponPose: weaponPose('hammer', [-0.58, -0.04, 0.34], [-1.18, 0.16, -0.3], [0, 0, 0], [-0.24, 0.04, 0.02]),
    }),
  ]),
  clean_hammer_strike: clip('clean_hammer_strike', 'Clean Hammer Strike', 48, [
    cleanKeyframe(0, {
      ...HAMMER_CARRY_JOINTS,
      chest: q(-0.1, -0.18, 0.1),
      upperArmRight: q(-1.0, 0.18, -0.26),
      upperArmLeft: q(-0.84, 0.08, 0.28),
    }, {
      weaponPose: weaponPose('hammer', [-0.54, -0.08, 0.3], [-0.92, 0.14, -0.25], [0, 0, 0], [-0.24, 0.04, 0.02]),
    }),
    cleanKeyframe(28, {
      ...HAMMER_CARRY_JOINTS,
      chest: q(0.22, 0.12, -0.04),
      upperArmRight: q(0.16, -0.32, -0.16),
      forearmRight: q(-0.38, 0.02, -0.08),
      upperArmLeft: q(-0.32, -0.18, -0.28),
      forearmLeft: q(-0.34, 0.04, 0.08),
    }, {
      weaponPose: weaponPose('hammer', [-0.41, -0.47, -0.08], [1.22, 0.12, -0.02], [0, 0, 0], [-0.24, 0.04, 0.02]),
    }),
    cleanKeyframe(48, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
  ]),
  clean_hammer_recover: clip('clean_hammer_recover', 'Clean Hammer Recover', 60, [
    cleanKeyframe(0, {
      ...HAMMER_CARRY_JOINTS,
      chest: q(0.2, 0.1, -0.04),
      upperArmRight: q(0.14, -0.28, -0.14),
      upperArmLeft: q(-0.3, -0.16, -0.24),
    }, {
      weaponPose: weaponPose('hammer', [-0.41, -0.47, -0.08], [1.22, 0.12, -0.02], [0, 0, 0], [-0.24, 0.04, 0.02]),
    }),
    cleanKeyframe(60, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
  ]),
  clean_hammer_melee: clip('clean_hammer_melee', 'Clean Hammer Melee', 36, [
    cleanKeyframe(0, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
    cleanKeyframe(36, {
      ...HAMMER_CARRY_JOINTS,
      chest: q(0.03, 0.56, 0.16),
      upperArmRight: q(-0.18, 0.28, -0.58),
      forearmRight: q(-0.28, 0.04, -0.1),
      upperArmLeft: q(-0.54, 0.12, 0.46),
    }, {
      weaponPose: weaponPose('hammer', [-0.08, -0.27, -0.04], [0.58, -0.94, -0.58], [0, 0, 0], [-0.24, 0.04, 0.02]),
    }),
  ]),
  clean_hammer_melee_recover: clip('clean_hammer_melee_recover', 'Clean Hammer Melee Recover', 60, [
    cleanKeyframe(0, {
      ...HAMMER_CARRY_JOINTS,
      chest: q(0.03, 0.56, 0.16),
      upperArmRight: q(-0.18, 0.28, -0.58),
      upperArmLeft: q(-0.54, 0.12, 0.46),
    }, {
      weaponPose: weaponPose('hammer', [-0.08, -0.27, -0.04], [0.58, -0.94, -0.58], [0, 0, 0], [-0.24, 0.04, 0.02]),
    }),
    cleanKeyframe(60, HAMMER_CARRY_JOINTS, { weaponPose: HAMMER_CARRY_WEAPON }),
  ]),
  clean_sword_carry: clip('clean_sword_carry', 'Clean Sword Carry', 90, [
    cleanKeyframe(0, SWORD_CARRY_JOINTS, { weaponPose: SWORD_CARRY_WEAPON }),
    cleanKeyframe(90, SWORD_CARRY_JOINTS, { weaponPose: SWORD_CARRY_WEAPON }),
  ], true),
  clean_sword_lunge: clip('clean_sword_lunge', 'Clean Sword Lunge', 60, [
    cleanKeyframe(0, SWORD_CARRY_JOINTS, { weaponPose: SWORD_CARRY_WEAPON }),
    cleanKeyframe(60, {
      ...SWORD_CARRY_JOINTS,
      chest: q(0.22, 0.02, -0.12),
      upperArmRight: q(-0.78, 0.04, -0.06),
      forearmRight: q(-0.18, 0.02, -0.04),
    }, {
      weaponPose: weaponPose('sword', [-0.5, -0.28, -0.18], [-Math.PI / 2 - 0.22, 0.02, -Math.PI / 9], [0, 0, 0]),
    }),
  ]),
  clean_sword_slash: clip('clean_sword_slash', 'Clean Sword Slash', 60, [
    cleanKeyframe(0, SWORD_CARRY_JOINTS, { weaponPose: SWORD_CARRY_WEAPON }),
    cleanKeyframe(30, {
      ...SWORD_CARRY_JOINTS,
      chest: q(0.02, 0.42, 0.12),
      upperArmRight: q(-0.72, 0.34, -0.52),
      forearmRight: q(-0.26, 0.04, -0.08),
      handRight: q(-0.08, 0.04, -0.2),
    }, {
      weaponPose: weaponPose('sword', [-0.12, -0.27, -0.08], [-Math.PI / 2, 0.82, -0.84], [0, 0, 0]),
    }),
    cleanKeyframe(60, SWORD_CARRY_JOINTS, { weaponPose: SWORD_CARRY_WEAPON }),
  ]),
  clean_sword_recover: clip('clean_sword_recover', 'Clean Sword Recover', 60, [
    cleanKeyframe(0, {
      ...SWORD_CARRY_JOINTS,
      chest: q(0.02, 0.42, 0.12),
      upperArmRight: q(-0.72, 0.34, -0.52),
    }, {
      weaponPose: weaponPose('sword', [-0.12, -0.27, -0.08], [-Math.PI / 2, 0.82, -0.84], [0, 0, 0]),
    }),
    cleanKeyframe(60, SWORD_CARRY_JOINTS, { weaponPose: SWORD_CARRY_WEAPON }),
  ]),
  clean_pistol_carry: clip('clean_pistol_carry', 'Clean Pistol Carry', 90, [
    cleanKeyframe(0, PISTOL_CARRY_JOINTS, { weaponPose: PISTOL_CARRY_WEAPON }),
    cleanKeyframe(90, PISTOL_CARRY_JOINTS, { weaponPose: PISTOL_CARRY_WEAPON }),
  ], true),
  clean_pistol_fire: clip('clean_pistol_fire', 'Clean Pistol Fire', 42, [
    cleanKeyframe(0, PISTOL_CARRY_JOINTS, { weaponPose: PISTOL_CARRY_WEAPON }),
    cleanKeyframe(10, {
      ...PISTOL_CARRY_JOINTS,
      chest: q(-0.16, 0.12, 0),
      upperArmRight: q(-0.74, 0.04, -0.08),
      forearmRight: q(-0.24, 0.02, -0.04),
    }, {
      weaponPose: weaponPose('pistol', [-0.49, -0.255, 0.06], [-0.36, 0.04, -0.06], [0, 0, 0]),
    }),
    cleanKeyframe(42, PISTOL_CARRY_JOINTS, { weaponPose: PISTOL_CARRY_WEAPON }),
  ]),
  clean_hit_react: clip('clean_hit_react', 'Clean Hit React', 60, [
    cleanKeyframe(0, {}),
    cleanKeyframe(12, {
      chest: q(-0.18, -0.18, 0.12),
      head: q(-0.08, -0.08, 0.04),
      upperArmLeft: q(-0.08, -0.08, 0.12),
      upperArmRight: q(-0.08, 0.08, -0.12),
    }),
    cleanKeyframe(60, {}),
  ]),
};

const clipForId = (clipId: V3AuthoredClipId): V3AuthoredAnimationClip => {
  const manualClip = V3_MANUAL_AUTHORED_ANIMATION_CLIPS[clipId];
  if (manualClip) return manualClip;
  const authoredClip = CLIPS[clipId];
  if (!authoredClip) throw new Error(`Unknown V3 authored clip: ${clipId}`);
  return authoredClip;
};

const manualClipForId = (clipId: V3AuthoredClipId): V3AuthoredAnimationClip | undefined =>
  V3_MANUAL_AUTHORED_ANIMATION_CLIPS[clipId];

const keyframeAtOrBefore = (keyframes: readonly V3AuthoredKeyframe[], frame: number): V3AuthoredKeyframe =>
  [...keyframes].reverse().find((keyframe) => keyframe.frame <= frame) ?? keyframes[0];

const keyframeAtOrAfter = (keyframes: readonly V3AuthoredKeyframe[], frame: number): V3AuthoredKeyframe =>
  keyframes.find((keyframe) => keyframe.frame >= frame) ?? keyframes[keyframes.length - 1];

const interpolateWeaponPose = (
  from: V3CleanRigWeaponPose | undefined,
  to: V3CleanRigWeaponPose | undefined,
  amount: number
): V3CleanRigWeaponPose | undefined => {
  const source = to ?? from;
  if (!source) return undefined;
  const start = from ?? source;
  const end = to ?? source;
  return {
    weapon: source.weapon,
    source: 'authoredCleanClip',
    position: lerpVec3(start.position, end.position, amount),
    rotation: lerpEulerTuple(start.rotation, end.rotation, amount),
    ...(source.primarySocketMarker ? { primarySocketMarker: [...source.primarySocketMarker] as V3Vec3Tuple } : {}),
    ...(source.offhandSocketMarker ? { offhandSocketMarker: [...source.offhandSocketMarker] as V3Vec3Tuple } : {}),
  };
};

const interpolateKeyframes = (
  clipId: V3AuthoredClipId,
  normalizedTime: number,
  previous: V3AuthoredKeyframe,
  next: V3AuthoredKeyframe,
  frame: number
): V3CleanRigPose => {
  const span = Math.max(1, next.frame - previous.frame);
  const amount = previous === next ? 0 : clamp01((frame - previous.frame) / span);
  const joints = new Set<V3CleanJointName>([
    ...Object.keys(previous.jointQuaternions) as V3CleanJointName[],
    ...Object.keys(next.jointQuaternions) as V3CleanJointName[],
  ]);
  const jointQuaternions = Object.fromEntries([...joints].map((joint) => [
    joint,
    slerpQuat(
      normalizeQuatTuple(previous.jointQuaternions[joint] ?? CLEAN_IDENTITY_QUAT),
      normalizeQuatTuple(next.jointQuaternions[joint] ?? CLEAN_IDENTITY_QUAT),
      amount
    ),
  ])) as Partial<Record<V3CleanJointName, V3QuatTuple>>;
  const weapon = interpolateWeaponPose(previous.weaponPose, next.weaponPose, amount);
  return {
    clipId,
    animationAuthority: 'cleanRig',
    normalizedTime,
    jointQuaternions,
    ...(previous.rootOffset || next.rootOffset ? {
      rootOffset: lerpVec3(previous.rootOffset ?? ZERO_VEC3, next.rootOffset ?? ZERO_VEC3, amount),
    } : {}),
    ...(weapon ? { weaponPose: weapon } : {}),
  };
};

const sanitizeWeaponPose = (
  weaponPoseValue: V3AuthoredKeyframe['weaponPose']
): V3CleanRigWeaponPose | undefined => {
  if (!weaponPoseValue) return undefined;
  const weapon = weaponPoseValue.weapon;
  if (weapon !== 'hammer' && weapon !== 'sword' && weapon !== 'pistol') return undefined;
  return {
    weapon,
    position: sanitizeVec3Tuple(weaponPoseValue.position),
    rotation: sanitizeVec3Tuple(weaponPoseValue.rotation),
    source: 'authoredCleanClip',
    ...(weaponPoseValue.primarySocketMarker ? {
      primarySocketMarker: sanitizeVec3Tuple(weaponPoseValue.primarySocketMarker),
    } : {}),
    ...(weaponPoseValue.offhandSocketMarker ? {
      offhandSocketMarker: sanitizeVec3Tuple(weaponPoseValue.offhandSocketMarker),
    } : {}),
  };
};

const sanitizeSocketLockMarkers = (
  markers: V3AuthoredKeyframe['socketLockMarkers']
): V3AuthoredKeyframe['socketLockMarkers'] | undefined => {
  if (!markers) return undefined;
  return {
    ...(markers.primary ? { primary: sanitizeVec3Tuple(markers.primary) } : {}),
    ...(markers.offhand ? { offhand: sanitizeVec3Tuple(markers.offhand) } : {}),
  };
};

const normalizeAuthoredKeyframes = (
  keyframes: V3AuthoredKeyframe[] | readonly V3AuthoredKeyframe[] | undefined,
  durationFrames: number
): V3AuthoredKeyframe[] => {
  const keyedByFrame = new Map<number, V3AuthoredKeyframe>();
  for (const rawKeyframe of keyframes ?? []) {
    const frame = Math.max(0, Math.min(durationFrames, Math.floor(Number(rawKeyframe.frame) || 0)));
    const jointQuaternions: Partial<Record<V3CleanJointName, V3QuatTuple>> = {};
    for (const [jointName, quaternion] of Object.entries(rawKeyframe.jointQuaternions ?? {})) {
      if (!isV3CleanJointName(jointName)) {
        throw new Error(`Unknown V3 clean rig joint in authored clip import: ${jointName}`);
      }
      jointQuaternions[jointName] = normalizeImportedQuatTuple(quaternion as V3QuatTuple);
    }
    keyedByFrame.set(frame, {
      frame,
      ...(rawKeyframe.label ? { label: String(rawKeyframe.label) } : {}),
      ...(rawKeyframe.rootOffset ? { rootOffset: sanitizeVec3Tuple(rawKeyframe.rootOffset) } : {}),
      jointQuaternions,
      ...(rawKeyframe.weaponPose ? { weaponPose: sanitizeWeaponPose(rawKeyframe.weaponPose) } : {}),
      ...(rawKeyframe.socketLockMarkers ? {
        socketLockMarkers: sanitizeSocketLockMarkers(rawKeyframe.socketLockMarkers),
      } : {}),
    });
  }

  if (keyedByFrame.size === 0) {
    keyedByFrame.set(0, { frame: 0, jointQuaternions: {} });
  }
  return [...keyedByFrame.values()].sort((a, b) => a.frame - b.frame);
};

export function normalizeV3AuthoredClipExport(input: unknown): V3AuthoredClipExport {
  const parsed = typeof input === 'string' ? JSON.parse(input) as Partial<V3AuthoredClipExport> : input as Partial<V3AuthoredClipExport>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('V3 authored clip export must be an object');
  }
  if (parsed.version !== ATLAS_EDITOR_EXPORT_VERSION) {
    throw new Error(`Unsupported V3 authored clip export version: ${String(parsed.version)}`);
  }
  if (!parsed.id || !V3_AUTHORED_ANIMATION_CLIP_IDS.includes(parsed.id)) {
    throw new Error(`Unknown V3 authored clip id: ${String(parsed.id)}`);
  }
  if (parsed.animationAuthority !== 'cleanRig') {
    throw new Error('V3 authored clip export must use cleanRig authority');
  }
  const durationFrames = Math.max(1, Math.floor(Number(parsed.durationFrames) || 1));
  return {
    version: ATLAS_EDITOR_EXPORT_VERSION,
    id: parsed.id,
    label: String(parsed.label ?? parsed.id),
    durationFrames,
    fps: 60,
    loop: Boolean(parsed.loop),
    animationAuthority: 'cleanRig',
    keyframes: normalizeAuthoredKeyframes(parsed.keyframes as V3AuthoredKeyframe[] | undefined, durationFrames),
    metadata: {
      authoringSurface: 'v3AnimationAtlasCleanRigEditor',
      sanitized: true,
      mixamoRuntimeAuthority: false,
    },
  };
}

export function buildV3AuthoredClipFromExport(exportJson: V3AuthoredClipExport | string): V3AuthoredAnimationClip {
  const normalized = normalizeV3AuthoredClipExport(exportJson);
  return {
    id: normalized.id,
    label: normalized.label,
    source: 'atlasEditor',
    fps: 60,
    durationFrames: normalized.durationFrames,
    loop: normalized.loop,
    animationAuthority: 'cleanRig',
    keyframes: normalized.keyframes,
    metadata: normalized.metadata,
  };
}

const sampleV3AuthoredClipObject = (
  authoredClip: V3AuthoredAnimationClip,
  options: { frame?: number; normalizedTime?: number } = {}
): V3AuthoredAnimationSample => {
  const normalizedTime = typeof options.normalizedTime === 'number'
    ? clamp01(options.normalizedTime)
    : clamp01((options.frame ?? 0) / Math.max(1, authoredClip.durationFrames));
  const frame = Math.max(0, Math.min(
    authoredClip.durationFrames,
    Math.round(typeof options.frame === 'number' ? options.frame : normalizedTime * authoredClip.durationFrames)
  ));
  const keyframes = authoredClip.keyframes.length > 0
    ? authoredClip.keyframes
    : [{ frame: 0, jointQuaternions: {} }];
  const previous = keyframeAtOrBefore(keyframes, frame);
  const next = keyframeAtOrAfter(keyframes, frame);
  const pose = interpolateKeyframes(authoredClip.id, normalizedTime, previous, next, frame);
  return {
    clip: authoredClip,
    clipId: authoredClip.id,
    frame,
    normalizedTime,
    pose,
    ...(pose.weaponPose ? { weaponPose: pose.weaponPose } : {}),
    motionSource: 'atlasAuthored',
  };
};

export function sampleV3AuthoredClipData(
  clipOrExport: V3AuthoredAnimationClip | V3AuthoredClipExport,
  options: { frame?: number; normalizedTime?: number; useMixamoFallback?: boolean } = {}
): V3AuthoredAnimationSample {
  const authoredClip = 'source' in clipOrExport && clipOrExport.source === 'atlasEditor'
    ? clipOrExport
    : buildV3AuthoredClipFromExport(clipOrExport as V3AuthoredClipExport);
  if (options.useMixamoFallback) {
    const mixamoSample = sampleV3CleanMixamoClip(authoredClip.id, options.normalizedTime ?? (
      (options.frame ?? 0) / Math.max(1, authoredClip.durationFrames)
    ));
    if (mixamoSample) {
      const frame = Math.max(0, Math.min(
        authoredClip.durationFrames,
        Math.round(typeof options.frame === 'number'
          ? options.frame
          : clamp01(options.normalizedTime ?? 0) * authoredClip.durationFrames)
      ));
      return {
        clip: authoredClip,
        clipId: authoredClip.id,
        frame,
        normalizedTime: typeof options.normalizedTime === 'number'
          ? clamp01(options.normalizedTime)
          : clamp01((options.frame ?? 0) / Math.max(1, authoredClip.durationFrames)),
        pose: mixamoSample.pose,
        ...(mixamoSample.weaponPose ? { weaponPose: mixamoSample.weaponPose } : {}),
        motionSource: mixamoSample.motionSource,
        mixamoClipId: mixamoSample.mixamoClipId,
        sourceNormalizedTime: mixamoSample.sourceNormalizedTime,
      };
    }
  }
  return sampleV3AuthoredClipObject(authoredClip, options);
}

export function getV3AuthoredAnimationClip(clipId: V3AuthoredClipId): V3AuthoredAnimationClip {
  return clipForId(clipId);
}

export function sampleV3AuthoredClip(
  clipId: V3AuthoredClipId,
  options: { frame?: number; normalizedTime?: number } = {}
): V3AuthoredAnimationSample {
  const manualClip = manualClipForId(clipId);
  if (manualClip) return sampleV3AuthoredClipObject(manualClip, options);

  const authoredClip = clipForId(clipId);
  const normalizedTime = typeof options.normalizedTime === 'number'
    ? clamp01(options.normalizedTime)
    : clamp01((options.frame ?? 0) / Math.max(1, authoredClip.durationFrames));
  const frame = Math.max(0, Math.min(
    authoredClip.durationFrames,
    Math.round(typeof options.frame === 'number' ? options.frame : normalizedTime * authoredClip.durationFrames)
  ));
  const previous = keyframeAtOrBefore(authoredClip.keyframes, frame);
  const next = keyframeAtOrAfter(authoredClip.keyframes, frame);
  const mixamoSample = sampleV3CleanMixamoClip(clipId, normalizedTime);
  if (mixamoSample) {
    return {
      clip: authoredClip,
      clipId,
      frame,
      normalizedTime,
      pose: mixamoSample.pose,
      ...(mixamoSample.weaponPose ? { weaponPose: mixamoSample.weaponPose } : {}),
      motionSource: mixamoSample.motionSource,
      mixamoClipId: mixamoSample.mixamoClipId,
      sourceNormalizedTime: mixamoSample.sourceNormalizedTime,
    };
  }
  const pose = interpolateKeyframes(clipId, normalizedTime, previous, next, frame);
  return {
    clip: authoredClip,
    clipId,
    frame,
    normalizedTime,
    pose,
    ...(pose.weaponPose ? { weaponPose: pose.weaponPose } : {}),
    motionSource: 'atlasAuthored',
  };
}

export function mapV3AtlasCaseToAuthoredClip(
  caseId: V3PoseClearanceCaseId,
  carryWeapon?: 'hammer' | 'sword' | 'pistol' | null
): V3AuthoredClipId {
  if (carryWeapon === 'hammer') return 'clean_hammer_carry';
  if (carryWeapon === 'sword') return 'clean_sword_carry';
  if (carryWeapon === 'pistol') return 'clean_pistol_carry';
  switch (caseId) {
    case 'walk': return 'clean_walk';
    case 'sprint': return 'clean_sprint';
    case 'slide': return 'clean_slide';
    case 'hammerWindup': return 'clean_hammer_windup';
    case 'hammerStrike': return 'clean_hammer_strike';
    case 'hammerRecover': return 'clean_hammer_recover';
    case 'hammerMelee': return 'clean_hammer_melee';
    case 'hammerMeleeRecover': return 'clean_hammer_melee_recover';
    case 'swordLunge': return 'clean_sword_lunge';
    case 'swordSlash': return 'clean_sword_slash';
    case 'pistolFire': return 'clean_pistol_fire';
    case 'hitReact': return 'clean_hit_react';
    case 'death':
    case 'idle':
    default:
      return 'clean_idle';
  }
}

export function mapV3RuntimeStateToAuthoredClip(input: {
  activeWeapon?: string;
  weaponState?: string;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
  velocityLength?: number;
}): V3AuthoredClipId {
  if (input.isSliding) return 'clean_slide';
  if (input.activeWeapon === 'hammer') {
    if (input.weaponState === 'swing_up') return 'clean_hammer_windup';
    if (input.weaponState === 'swing_down') return 'clean_hammer_strike';
    if (input.weaponState === 'melee_swing' || input.weaponState === 'melee_up' || input.weaponState === 'melee_down') {
      return 'clean_hammer_melee';
    }
    if (input.weaponState === 'melee_recover') return 'clean_hammer_melee_recover';
    if (input.weaponState === 'recovering') return 'clean_hammer_recover';
    return 'clean_hammer_carry';
  }
  if (input.activeWeapon === 'sword') {
    if (input.isLunging) return 'clean_sword_lunge';
    if (input.weaponState === 'swing_up' || input.weaponState === 'swing_down' || input.weaponState === 'slashing') {
      return 'clean_sword_slash';
    }
    if (input.weaponState === 'recovering') return 'clean_sword_recover';
    return 'clean_sword_carry';
  }
  if (input.activeWeapon === 'pistol') {
    if (input.weaponState === 'firing' || input.weaponState === 'fire' || input.weaponState === 'shooting') {
      return 'clean_pistol_fire';
    }
    return 'clean_pistol_carry';
  }
  if (input.isSprinting) return 'clean_sprint';
  if ((input.velocityLength ?? 0) > 0.1) return 'clean_walk';
  return 'clean_idle';
}

export function exportV3AuthoredClipToJson(clipId: V3AuthoredClipId): V3AuthoredClipExport {
  const authoredClip = clipForId(clipId);
  return {
    version: ATLAS_EDITOR_EXPORT_VERSION,
    id: authoredClip.id,
    label: authoredClip.label,
    durationFrames: authoredClip.durationFrames,
    fps: authoredClip.fps,
    loop: authoredClip.loop,
    animationAuthority: 'cleanRig',
    keyframes: authoredClip.keyframes.map((keyframe) => ({
      ...keyframe,
      jointQuaternions: Object.fromEntries(
        Object.entries(keyframe.jointQuaternions).map(([joint, quaternion]) => [
          joint,
          normalizeQuatTuple(quaternion),
        ])
      ) as Partial<Record<V3CleanJointName, V3QuatTuple>>,
      ...(keyframe.weaponPose ? {
        weaponPose: {
          ...keyframe.weaponPose,
          position: [...keyframe.weaponPose.position] as V3Vec3Tuple,
          rotation: [...keyframe.weaponPose.rotation] as V3Vec3Tuple,
        },
      } : {}),
    })),
    metadata: authoredClip.metadata,
  };
}

export function parseV3AuthoredClipJson(json: string): V3AuthoredClipExport {
  return normalizeV3AuthoredClipExport(json);
}
