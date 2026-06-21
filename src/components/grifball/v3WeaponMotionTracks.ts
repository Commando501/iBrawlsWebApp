import * as THREE from 'three';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
} from '../../game/hammerSlamTiming';
import type { V3SocketName, V3Vec3Tuple } from '../v3/v3ModelTypes';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import type { WeaponPose } from './attackAnimationPresets';
import type { V3WeaponReferenceClipId } from './v3WeaponReferenceClips';
import {
  fitV3RetargetedWeaponPoseFromReferenceSample,
  sampleV3RetargetedUpperBodyPose,
  type V3QuatTuple,
} from './v3MixamoRetarget';

export type V3AnimationWeaponId = 'hammer' | 'sword' | 'pistol';
export type V3AnimationTrackId =
  | 'hammer_windup'
  | 'hammer_strike'
  | 'hammer_recover'
  | 'hammer_melee'
  | 'hammer_melee_recover'
  | 'sword_lunge'
  | 'sword_slash'
  | 'sword_recover'
  | 'pistol_fire'
  | 'pistol_recover';

export interface V3UpperBodyPose {
  upperTorsoRotation: THREE.Vector3Tuple;
  headRotation: THREE.Vector3Tuple;
  leftArmRotation: THREE.Vector3Tuple;
  rightArmRotation: THREE.Vector3Tuple;
  detailBoneRotations?: Partial<Record<V3DetailBoneName, THREE.Vector3Tuple>>;
  detailBoneQuaternions?: Partial<Record<V3DetailBoneName, V3QuatTuple>>;
}

export interface V3GripConstraint {
  side: 'left' | 'right';
  socketName: Extract<V3SocketName, 'thirdPersonPrimaryGrip' | 'thirdPersonOffhandGrip'>;
  poleDirection: V3Vec3Tuple;
  maxDrift: number;
  required: boolean;
  mode?: 'lock' | 'cleanup';
  cleanupAlpha?: number;
}

export interface V3ArmIkHint {
  side: 'left' | 'right';
  poleDirection: V3Vec3Tuple;
}

export interface V3WeaponMotionReference {
  clipId: V3WeaponReferenceClipId;
  normalizedTime: number;
}

export interface V3WeaponMotionKeyframe {
  phase: number;
  label: string;
  weaponPose: WeaponPose;
  upperBodyPose: V3UpperBodyPose;
  gripConstraints?: readonly V3GripConstraint[];
  reference?: V3WeaponMotionReference;
}

export interface V3WeaponMotionTrack {
  id: V3AnimationTrackId;
  label: string;
  weapon: V3AnimationWeaponId;
  defaultDuration: number;
  keyframes: readonly V3WeaponMotionKeyframe[];
  ikHints: readonly V3ArmIkHint[];
}

export interface V3WeaponMotionTrackDefinition {
  id: V3AnimationTrackId;
  label: string;
  weapon: V3AnimationWeaponId;
  defaultDuration: number;
}

export interface V3WeaponMotionSample {
  weapon: V3AnimationWeaponId;
  trackId: V3AnimationTrackId | 'carry';
  trackSource: 'v3ConstrainedWeaponMotion' | 'v3MixamoWeaponReference';
  phase: number;
  weaponPose: WeaponPose;
  upperBodyPose: V3UpperBodyPose;
  gripConstraints: readonly V3GripConstraint[];
  ikHints: readonly V3ArmIkHint[];
  reference?: V3WeaponMotionReference;
}

const HAMMER_RIGHT_HAND_POLE: V3Vec3Tuple = [-1, 0.16, -0.18];
const HAMMER_LEFT_HAND_POLE: V3Vec3Tuple = [1, 0.16, -0.18];
const RIGHT_ONE_HAND_POLE: V3Vec3Tuple = [-1, 0.08, -0.12];

const rightPrimaryGrip = (
  poleDirection: V3Vec3Tuple = RIGHT_ONE_HAND_POLE,
  mode: V3GripConstraint['mode'] = 'lock'
): V3GripConstraint => ({
  side: 'right',
  socketName: 'thirdPersonPrimaryGrip',
  poleDirection,
  maxDrift: mode === 'cleanup' ? 0.12 : 0.035,
  required: true,
  mode,
  ...(mode === 'cleanup' ? { cleanupAlpha: 0.32 } : {}),
});

const leftOffhandGrip = (
  poleDirection: V3Vec3Tuple = HAMMER_LEFT_HAND_POLE,
  mode: V3GripConstraint['mode'] = 'lock'
): V3GripConstraint => ({
  side: 'left',
  socketName: 'thirdPersonOffhandGrip',
  poleDirection,
  maxDrift: mode === 'cleanup' ? 0.2 : 0.05,
  required: true,
  mode,
  ...(mode === 'cleanup' ? { cleanupAlpha: 0.32 } : {}),
});

const HAMMER_GRIP_CONSTRAINTS = [
  rightPrimaryGrip(HAMMER_RIGHT_HAND_POLE, 'cleanup'),
  leftOffhandGrip(HAMMER_LEFT_HAND_POLE, 'cleanup'),
] as const;
const SWORD_GRIP_CONSTRAINTS = [rightPrimaryGrip([-1, 0.08, -0.18], 'cleanup')] as const;
const PISTOL_GRIP_CONSTRAINTS = [rightPrimaryGrip([-1, 0.04, -0.08])] as const;

const HAMMER_CARRY_POSE: WeaponPose = {
  position: [-0.49, -0.3, 0.12],
  rotation: [0.34, 0.08, -0.12],
};

const SWORD_CARRY_POSE: WeaponPose = {
  position: [-0.49, -0.29, 0.02],
  rotation: [0.35, -0.2, -Math.PI / 9],
};

const PISTOL_CARRY_POSE: WeaponPose = {
  position: [-0.49, -0.29, -0.02],
  rotation: [-0.04, 0.02, -0.06],
};

const HAMMER_CARRY_UPPER: V3UpperBodyPose = {
  upperTorsoRotation: [0.015, -0.035, 0.01],
  headRotation: [0, -0.015, 0],
  rightArmRotation: [-0.38, 0.08, -0.16],
  leftArmRotation: [-0.34, -0.08, 0.16],
};

const SWORD_CARRY_UPPER: V3UpperBodyPose = {
  upperTorsoRotation: [0.025, 0.035, -0.02],
  headRotation: [0, 0.018, 0],
  rightArmRotation: [-0.56, 0.04, -0.12],
  leftArmRotation: [-0.16, -0.14, 0.16],
};

const PISTOL_CARRY_UPPER: V3UpperBodyPose = {
  upperTorsoRotation: [-0.04, 0.08, 0],
  headRotation: [0, 0.025, 0],
  rightArmRotation: [-0.42, 0.04, -0.08],
  leftArmRotation: [-0.16, -0.12, 0.12],
};

const reference = (
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number
): V3WeaponMotionReference => ({
  clipId,
  normalizedTime,
});

const CARRY_KEYFRAMES: Record<V3AnimationWeaponId, V3WeaponMotionKeyframe> = {
  hammer: {
    phase: 0,
    label: 'two-hand carry',
    weaponPose: HAMMER_CARRY_POSE,
    upperBodyPose: HAMMER_CARRY_UPPER,
    gripConstraints: HAMMER_GRIP_CONSTRAINTS,
    reference: reference('hammer_2hand_idle', 0),
  },
  sword: {
    phase: 0,
    label: 'one-hand carry',
    weaponPose: SWORD_CARRY_POSE,
    upperBodyPose: SWORD_CARRY_UPPER,
    gripConstraints: SWORD_GRIP_CONSTRAINTS,
    reference: reference('sword_outward_slash', 0),
  },
  pistol: {
    phase: 0,
    label: 'one-hand aim carry',
    weaponPose: PISTOL_CARRY_POSE,
    upperBodyPose: PISTOL_CARRY_UPPER,
    gripConstraints: PISTOL_GRIP_CONSTRAINTS,
  },
};

const keyframe = (
  phase: number,
  label: string,
  weaponPose: WeaponPose,
  upperBodyPose: V3UpperBodyPose,
  gripConstraints?: readonly V3GripConstraint[],
  sourceReference?: V3WeaponMotionReference
): V3WeaponMotionKeyframe => ({
  phase,
  label,
  weaponPose,
  upperBodyPose,
  gripConstraints,
  ...(sourceReference ? { reference: sourceReference } : {}),
});

export const V3_WEAPON_MOTION_TRACKS: readonly V3WeaponMotionTrack[] = [
  {
    id: 'hammer_windup',
    label: 'Hammer windup',
    weapon: 'hammer',
    defaultDuration: DEFAULT_HAMMER_SLAM_WINDUP_TIME,
    ikHints: [
      { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
      { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
    ],
    keyframes: [
      CARRY_KEYFRAMES.hammer,
      keyframe(1, 'pickaxe windup', {
        position: [-0.58, -0.04, 0.34],
        rotation: [-1.18, 0.16, -0.3],
      }, {
        upperTorsoRotation: [-0.08, -0.18, 0.1],
        headRotation: [-0.03, -0.055, -0.015],
        rightArmRotation: [-1.2, 0.22, -0.22],
        leftArmRotation: [-0.92, 0.06, 0.34],
      }, HAMMER_GRIP_CONSTRAINTS, reference('hammer_heavy_swing', 0.34)),
    ],
  },
  {
    id: 'hammer_strike',
    label: 'Hammer strike',
    weapon: 'hammer',
    defaultDuration: DEFAULT_HAMMER_SLAM_ATTACK_TIME,
    ikHints: [
      { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
      { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
    ],
    keyframes: [
      CARRY_KEYFRAMES.hammer,
      keyframe(0.45, 'overhead transition', {
        position: [-0.45, -0.04, 0.22],
        rotation: [0.14, 0.12, -0.18],
      }, {
        upperTorsoRotation: [0.04, -0.08, 0.06],
        headRotation: [0, -0.02, 0],
        rightArmRotation: [-0.72, 0.12, -0.2],
        leftArmRotation: [-0.62, 0.02, 0.22],
      }, HAMMER_GRIP_CONSTRAINTS, reference('hammer_heavy_swing', 0.42)),
      keyframe(1, 'ground contact', {
        position: [-0.41, -0.47, -0.08],
        rotation: [1.22, 0.12, -0.02],
      }, {
        upperTorsoRotation: [0.22, 0.12, -0.04],
        headRotation: [0.035, 0.05, -0.015],
        rightArmRotation: [0.18, -0.36, -0.16],
        leftArmRotation: [-0.32, -0.18, -0.32],
      }, HAMMER_GRIP_CONSTRAINTS, reference('hammer_heavy_swing', 0.62)),
    ],
  },
  {
    id: 'hammer_recover',
    label: 'Hammer recover',
    weapon: 'hammer',
    defaultDuration: 0.6,
    ikHints: [
      { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
      { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
    ],
    keyframes: [
      keyframe(0, 'ground contact', {
        position: [-0.41, -0.47, -0.08],
        rotation: [1.22, 0.12, -0.02],
      }, {
        upperTorsoRotation: [0.22, 0.12, -0.04],
        headRotation: [0.035, 0.05, -0.015],
        rightArmRotation: [0.18, -0.36, -0.16],
        leftArmRotation: [-0.32, -0.18, -0.32],
      }, HAMMER_GRIP_CONSTRAINTS, reference('hammer_heavy_swing', 0.62)),
      { ...CARRY_KEYFRAMES.hammer, phase: 1, label: 'carry recover' },
    ],
  },
  {
    id: 'hammer_melee',
    label: 'Hammer melee swing',
    weapon: 'hammer',
    defaultDuration: 0.24,
    ikHints: [
      { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
      { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
    ],
    keyframes: [
      CARRY_KEYFRAMES.hammer,
      keyframe(1, 'right-to-left sweep', {
        position: [-0.08, -0.27, -0.04],
        rotation: [0.58, -0.94, -0.58],
      }, {
        upperTorsoRotation: [0.02, 0.58, 0.16],
        headRotation: [0, 0.1, -0.025],
        rightArmRotation: [-0.2, 0.28, -0.58],
        leftArmRotation: [-0.54, 0.12, 0.46],
      }, HAMMER_GRIP_CONSTRAINTS, reference('hammer_melee_advance', 0.5)),
    ],
  },
  {
    id: 'hammer_melee_recover',
    label: 'Hammer melee recover',
    weapon: 'hammer',
    defaultDuration: 0.5,
    ikHints: [
      { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
      { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
    ],
    keyframes: [
      keyframe(0, 'right-to-left sweep', {
        position: [-0.08, -0.27, -0.04],
        rotation: [0.58, -0.94, -0.58],
      }, {
        upperTorsoRotation: [0.02, 0.58, 0.16],
        headRotation: [0, 0.1, -0.025],
        rightArmRotation: [-0.2, 0.28, -0.58],
        leftArmRotation: [-0.54, 0.12, 0.46],
      }, HAMMER_GRIP_CONSTRAINTS, reference('hammer_melee_advance', 0.5)),
      { ...CARRY_KEYFRAMES.hammer, phase: 1, label: 'carry recover' },
    ],
  },
  {
    id: 'sword_lunge',
    label: 'Sword lunge',
    weapon: 'sword',
    defaultDuration: 0.18,
    ikHints: [{ side: 'right', poleDirection: [-1, 0.08, -0.18] }],
    keyframes: [
      CARRY_KEYFRAMES.sword,
      keyframe(1, 'thrust extension', {
        position: [-0.5, -0.28, -0.18],
        rotation: [-Math.PI / 2 - 0.22, 0.02, -Math.PI / 9],
      }, {
        upperTorsoRotation: [0.24, 0.02, -0.12],
        headRotation: [0.03, 0.04, -0.02],
        rightArmRotation: [-0.76, 0.04, -0.06],
        leftArmRotation: [-0.24, -0.28, 0.22],
      }, SWORD_GRIP_CONSTRAINTS),
    ],
  },
  {
    id: 'sword_slash',
    label: 'Sword slash',
    weapon: 'sword',
    defaultDuration: 0.22,
    ikHints: [{ side: 'right', poleDirection: [-1, 0.08, -0.18] }],
    keyframes: [
      CARRY_KEYFRAMES.sword,
      keyframe(1, 'horizontal right-to-left slash', {
        position: [-0.12, -0.27, -0.08],
        rotation: [-Math.PI / 2, 0.82, -0.84],
      }, {
        upperTorsoRotation: [0.02, 0.42, 0.12],
        headRotation: [0, 0.1, 0.02],
        rightArmRotation: [-0.72, 0.34, -0.52],
        leftArmRotation: [0.02, -0.12, 0.12],
      }, SWORD_GRIP_CONSTRAINTS, reference('sword_outward_slash', 0.58)),
    ],
  },
  {
    id: 'sword_recover',
    label: 'Sword recover',
    weapon: 'sword',
    defaultDuration: 0.6,
    ikHints: [{ side: 'right', poleDirection: [-1, 0.08, -0.18] }],
    keyframes: [
      keyframe(0, 'horizontal right-to-left slash', {
        position: [-0.12, -0.27, -0.08],
        rotation: [-Math.PI / 2, 0.82, -0.84],
      }, {
        upperTorsoRotation: [0.02, 0.42, 0.12],
        headRotation: [0, 0.1, 0.02],
        rightArmRotation: [-0.72, 0.34, -0.52],
        leftArmRotation: [0.02, -0.12, 0.12],
      }, SWORD_GRIP_CONSTRAINTS, reference('sword_outward_slash', 0.58)),
      { ...CARRY_KEYFRAMES.sword, phase: 1, label: 'carry recover' },
    ],
  },
  {
    id: 'pistol_fire',
    label: 'Pistol fire',
    weapon: 'pistol',
    defaultDuration: 0.18,
    ikHints: [{ side: 'right', poleDirection: [-1, 0.04, -0.08] }],
    keyframes: [
      CARRY_KEYFRAMES.pistol,
      keyframe(1, 'recoil peak', {
        position: [-0.49, -0.255, 0.06],
        rotation: [-0.36, 0.04, -0.06],
      }, {
        upperTorsoRotation: [-0.18, 0.12, 0],
        headRotation: [-0.03, 0.055, 0],
        rightArmRotation: [-0.84, 0.04, -0.08],
        leftArmRotation: [-0.16, -0.12, 0.12],
      }, PISTOL_GRIP_CONSTRAINTS),
    ],
  },
  {
    id: 'pistol_recover',
    label: 'Pistol recover',
    weapon: 'pistol',
    defaultDuration: 0.18,
    ikHints: [{ side: 'right', poleDirection: [-1, 0.04, -0.08] }],
    keyframes: [
      keyframe(0, 'recoil peak', {
        position: [-0.49, -0.255, 0.06],
        rotation: [-0.36, 0.04, -0.06],
      }, {
        upperTorsoRotation: [-0.18, 0.12, 0],
        headRotation: [-0.03, 0.055, 0],
        rightArmRotation: [-0.84, 0.04, -0.08],
        leftArmRotation: [-0.16, -0.12, 0.12],
      }, PISTOL_GRIP_CONSTRAINTS),
      { ...CARRY_KEYFRAMES.pistol, phase: 1, label: 'carry recover' },
    ],
  },
] as const;

export const clampV3MotionPhase = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const lerp = THREE.MathUtils.lerp;

const easeInOutCubic = (value: number): number => {
  const t = clampV3MotionPhase(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const easeOutCubic = (value: number): number => {
  const t = 1 - clampV3MotionPhase(value);
  return 1 - t * t * t;
};

const shortestAngleDelta = (start: number, end: number): number => {
  let delta = (end - start) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const normalizeAngle = (angle: number): number => {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
};

const lerpAngle = (start: number, end: number, t: number): number =>
  normalizeAngle(t <= 0 ? start : t >= 1 ? end : start + shortestAngleDelta(start, end) * t);

const cloneTuple = (value: THREE.Vector3Tuple): THREE.Vector3Tuple => [value[0], value[1], value[2]];

const cloneQuatTuple = (value: V3QuatTuple): V3QuatTuple => [value[0], value[1], value[2], value[3]];

const lerpTuple = (
  from: THREE.Vector3Tuple,
  to: THREE.Vector3Tuple,
  amount: number,
  angular = false
): THREE.Vector3Tuple => [
  angular ? lerpAngle(from[0], to[0], amount) : lerp(from[0], to[0], amount),
  angular ? lerpAngle(from[1], to[1], amount) : lerp(from[1], to[1], amount),
  angular ? lerpAngle(from[2], to[2], amount) : lerp(from[2], to[2], amount),
];

const lerpQuatTuple = (
  from: V3QuatTuple,
  to: V3QuatTuple,
  amount: number
): V3QuatTuple => {
  const quaternion = new THREE.Quaternion(from[0], from[1], from[2], from[3])
    .normalize()
    .slerp(new THREE.Quaternion(to[0], to[1], to[2], to[3]).normalize(), amount)
    .normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

const cloneWeaponPose = (pose: WeaponPose): WeaponPose => ({
  position: cloneTuple(pose.position),
  rotation: cloneTuple(pose.rotation),
});

const cloneUpperBodyPose = (pose: V3UpperBodyPose): V3UpperBodyPose => ({
  upperTorsoRotation: cloneTuple(pose.upperTorsoRotation),
  headRotation: cloneTuple(pose.headRotation),
  leftArmRotation: cloneTuple(pose.leftArmRotation),
  rightArmRotation: cloneTuple(pose.rightArmRotation),
  ...(pose.detailBoneRotations ? {
    detailBoneRotations: Object.fromEntries(
      Object.entries(pose.detailBoneRotations).map(([joint, rotation]) => [
        joint,
        cloneTuple(rotation as THREE.Vector3Tuple),
      ])
    ) as Partial<Record<V3DetailBoneName, THREE.Vector3Tuple>>,
  } : {}),
  ...(pose.detailBoneQuaternions ? {
    detailBoneQuaternions: Object.fromEntries(
      Object.entries(pose.detailBoneQuaternions).map(([joint, quaternion]) => [
        joint,
        cloneQuatTuple(quaternion as V3QuatTuple),
      ])
    ) as Partial<Record<V3DetailBoneName, V3QuatTuple>>,
  } : {}),
});

const lerpDetailBoneRotations = (
  from: V3UpperBodyPose['detailBoneRotations'],
  to: V3UpperBodyPose['detailBoneRotations'],
  amount: number
): V3UpperBodyPose['detailBoneRotations'] | undefined => {
  if (!from && !to) return undefined;
  const joints = new Set<V3DetailBoneName>([
    ...Object.keys(from ?? {}) as V3DetailBoneName[],
    ...Object.keys(to ?? {}) as V3DetailBoneName[],
  ]);
  return Object.fromEntries([...joints].map((joint) => [
    joint,
    lerpTuple(
      from?.[joint] ?? [0, 0, 0],
      to?.[joint] ?? [0, 0, 0],
      amount,
      true
    ),
  ])) as Partial<Record<V3DetailBoneName, THREE.Vector3Tuple>>;
};

const lerpDetailBoneQuaternions = (
  from: V3UpperBodyPose['detailBoneQuaternions'],
  to: V3UpperBodyPose['detailBoneQuaternions'],
  amount: number
): V3UpperBodyPose['detailBoneQuaternions'] | undefined => {
  if (!from && !to) return undefined;
  const joints = new Set<V3DetailBoneName>([
    ...Object.keys(from ?? {}) as V3DetailBoneName[],
    ...Object.keys(to ?? {}) as V3DetailBoneName[],
  ]);
  return Object.fromEntries([...joints].map((joint) => [
    joint,
    lerpQuatTuple(
      from?.[joint] ?? [0, 0, 0, 1],
      to?.[joint] ?? [0, 0, 0, 1],
      amount
    ),
  ])) as Partial<Record<V3DetailBoneName, V3QuatTuple>>;
};

const lerpWeaponPose = (from: WeaponPose, to: WeaponPose, amount: number): WeaponPose => ({
  position: lerpTuple(from.position, to.position, amount),
  rotation: lerpTuple(from.rotation, to.rotation, amount, true),
});

const lerpUpperBodyPose = (
  from: V3UpperBodyPose,
  to: V3UpperBodyPose,
  amount: number
): V3UpperBodyPose => ({
  upperTorsoRotation: lerpTuple(from.upperTorsoRotation, to.upperTorsoRotation, amount, true),
  headRotation: lerpTuple(from.headRotation, to.headRotation, amount, true),
  leftArmRotation: lerpTuple(from.leftArmRotation, to.leftArmRotation, amount, true),
  rightArmRotation: lerpTuple(from.rightArmRotation, to.rightArmRotation, amount, true),
  ...(lerpDetailBoneRotations(from.detailBoneRotations, to.detailBoneRotations, amount)
    ? { detailBoneRotations: lerpDetailBoneRotations(from.detailBoneRotations, to.detailBoneRotations, amount) }
    : {}),
  ...(lerpDetailBoneQuaternions(from.detailBoneQuaternions, to.detailBoneQuaternions, amount)
    ? { detailBoneQuaternions: lerpDetailBoneQuaternions(from.detailBoneQuaternions, to.detailBoneQuaternions, amount) }
    : {}),
});

const cloneConstraints = (constraints: readonly V3GripConstraint[] = []): V3GripConstraint[] =>
  constraints.map((constraint) => ({
    ...constraint,
    poleDirection: [...constraint.poleDirection] as V3Vec3Tuple,
  }));

const cloneHints = (hints: readonly V3ArmIkHint[]): V3ArmIkHint[] =>
  hints.map((hint) => ({
    side: hint.side,
    poleDirection: [...hint.poleDirection] as V3Vec3Tuple,
  }));

const cloneReference = (sourceReference: V3WeaponMotionReference | undefined): V3WeaponMotionReference | undefined => (
  sourceReference
    ? {
      clipId: sourceReference.clipId,
      normalizedTime: sourceReference.normalizedTime,
    }
    : undefined
);

const referenceMotionSample = (
  weapon: Extract<V3AnimationWeaponId, 'hammer' | 'sword'>,
  trackId: V3WeaponMotionSample['trackId'],
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number,
  gripConstraints: readonly V3GripConstraint[],
  ikHints: readonly V3ArmIkHint[]
): V3WeaponMotionSample => {
  const fit = fitV3RetargetedWeaponPoseFromReferenceSample(clipId, {
    normalizedTime,
    weapon,
  });
  return {
    weapon,
    trackId,
    trackSource: 'v3MixamoWeaponReference',
    phase: trackId === 'carry' ? 0 : clampV3MotionPhase(normalizedTime),
    weaponPose: fit.weaponPose,
    upperBodyPose: sampleV3RetargetedUpperBodyPose(clipId, fit.normalizedTime),
    gripConstraints: cloneConstraints(gripConstraints),
    ikHints: cloneHints(ikHints),
    reference: reference(clipId, fit.normalizedTime),
  };
};

const mixamoCarrySample = (weapon: V3AnimationWeaponId): V3WeaponMotionSample | null => {
  if (weapon === 'hammer') {
    return referenceMotionSample(
      'hammer',
      'carry',
      'hammer_2hand_idle',
      0,
      HAMMER_GRIP_CONSTRAINTS,
      [
        { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
        { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
      ]
    );
  }
  if (weapon === 'sword') {
    return referenceMotionSample(
      'sword',
      'carry',
      'sword_outward_slash',
      0,
      SWORD_GRIP_CONSTRAINTS,
      [{ side: 'right', poleDirection: SWORD_GRIP_CONSTRAINTS[0].poleDirection }]
    );
  }
  return null;
};

const mixamoTrackReference = (
  trackId: V3AnimationTrackId,
  phase: number
): {
  weapon: Extract<V3AnimationWeaponId, 'hammer' | 'sword'>;
  clipId: V3WeaponReferenceClipId;
  normalizedTime: number;
  gripConstraints: readonly V3GripConstraint[];
  ikHints: readonly V3ArmIkHint[];
  recoverToCarry?: boolean;
} | null => {
  const t = clampV3MotionPhase(phase);
  if (trackId === 'hammer_windup') {
    return {
      weapon: 'hammer',
      clipId: 'hammer_heavy_swing',
      normalizedTime: lerp(0.02, 0.5, easeInOutCubic(t)),
      gripConstraints: HAMMER_GRIP_CONSTRAINTS,
      ikHints: [
        { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
        { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
      ],
    };
  }
  if (trackId === 'hammer_strike') {
    return {
      weapon: 'hammer',
      clipId: 'hammer_heavy_swing',
      normalizedTime: lerp(0.5, 0.64, easeInOutCubic(t)),
      gripConstraints: HAMMER_GRIP_CONSTRAINTS,
      ikHints: [
        { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
        { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
      ],
    };
  }
  if (trackId === 'hammer_recover') {
    return {
      weapon: 'hammer',
      clipId: 'hammer_heavy_swing',
      normalizedTime: 0.64,
      gripConstraints: HAMMER_GRIP_CONSTRAINTS,
      ikHints: [
        { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
        { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
      ],
      recoverToCarry: true,
    };
  }
  if (trackId === 'hammer_melee') {
    return {
      weapon: 'hammer',
      clipId: 'hammer_melee_advance',
      normalizedTime: lerp(0.02, 0.56, easeInOutCubic(t)),
      gripConstraints: HAMMER_GRIP_CONSTRAINTS,
      ikHints: [
        { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
        { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
      ],
    };
  }
  if (trackId === 'hammer_melee_recover') {
    return {
      weapon: 'hammer',
      clipId: 'hammer_melee_advance',
      normalizedTime: 0.56,
      gripConstraints: HAMMER_GRIP_CONSTRAINTS,
      ikHints: [
        { side: 'right', poleDirection: HAMMER_RIGHT_HAND_POLE },
        { side: 'left', poleDirection: HAMMER_LEFT_HAND_POLE },
      ],
      recoverToCarry: true,
    };
  }
  if (trackId === 'sword_slash') {
    return {
      weapon: 'sword',
      clipId: 'sword_outward_slash',
      normalizedTime: lerp(0, 0.64, easeInOutCubic(t)),
      gripConstraints: SWORD_GRIP_CONSTRAINTS,
      ikHints: [{ side: 'right', poleDirection: SWORD_GRIP_CONSTRAINTS[0].poleDirection }],
    };
  }
  if (trackId === 'sword_lunge') {
    return {
      weapon: 'sword',
      clipId: 'sword_outward_slash',
      normalizedTime: lerp(0, 0.18, easeInOutCubic(t)),
      gripConstraints: SWORD_GRIP_CONSTRAINTS,
      ikHints: [{ side: 'right', poleDirection: SWORD_GRIP_CONSTRAINTS[0].poleDirection }],
    };
  }
  if (trackId === 'sword_recover') {
    return {
      weapon: 'sword',
      clipId: 'sword_outward_slash',
      normalizedTime: 0.64,
      gripConstraints: SWORD_GRIP_CONSTRAINTS,
      ikHints: [{ side: 'right', poleDirection: SWORD_GRIP_CONSTRAINTS[0].poleDirection }],
      recoverToCarry: true,
    };
  }
  return null;
};

export function getV3WeaponMotionTrackDefinition(id: V3AnimationTrackId): V3WeaponMotionTrackDefinition {
  const track = V3_WEAPON_MOTION_TRACKS.find((candidate) => candidate.id === id);
  if (!track) throw new Error(`Unknown V3 weapon motion track: ${id}`);
  return {
    id: track.id,
    label: track.label,
    weapon: track.weapon,
    defaultDuration: track.defaultDuration,
  };
}

export function getV3WeaponMotionTrack(id: V3AnimationTrackId): V3WeaponMotionTrack {
  const track = V3_WEAPON_MOTION_TRACKS.find((candidate) => candidate.id === id);
  if (!track) throw new Error(`Unknown V3 weapon motion track: ${id}`);
  return track;
}

export function sampleV3WeaponMotionCarry(weapon: V3AnimationWeaponId): V3WeaponMotionSample {
  const mixamoSample = mixamoCarrySample(weapon);
  if (mixamoSample) return mixamoSample;

  const carry = CARRY_KEYFRAMES[weapon];
  const ikHints = weapon === 'hammer'
    ? [
      { side: 'right' as const, poleDirection: HAMMER_RIGHT_HAND_POLE },
      { side: 'left' as const, poleDirection: HAMMER_LEFT_HAND_POLE },
    ]
    : [{ side: 'right' as const, poleDirection: weapon === 'pistol' ? PISTOL_GRIP_CONSTRAINTS[0].poleDirection : SWORD_GRIP_CONSTRAINTS[0].poleDirection }];

  return {
    weapon,
    trackId: 'carry',
    trackSource: 'v3ConstrainedWeaponMotion',
    phase: 0,
    weaponPose: cloneWeaponPose(carry.weaponPose),
    upperBodyPose: cloneUpperBodyPose(carry.upperBodyPose),
    gripConstraints: cloneConstraints(carry.gripConstraints),
    ikHints: cloneHints(ikHints),
    ...(carry.reference ? { reference: cloneReference(carry.reference) } : {}),
  };
}

const sampleBetweenKeyframes = (
  previous: V3WeaponMotionKeyframe,
  next: V3WeaponMotionKeyframe,
  phase: number,
  easing: 'easeInOutCubic' | 'easeOutCubic'
): Pick<V3WeaponMotionSample, 'weaponPose' | 'upperBodyPose' | 'gripConstraints' | 'reference'> => {
  const span = Math.max(0.0001, next.phase - previous.phase);
  const localPhase = clampV3MotionPhase((phase - previous.phase) / span);
  const eased = easing === 'easeOutCubic' ? easeOutCubic(localPhase) : easeInOutCubic(localPhase);
  return {
    weaponPose: lerpWeaponPose(previous.weaponPose, next.weaponPose, eased),
    upperBodyPose: lerpUpperBodyPose(previous.upperBodyPose, next.upperBodyPose, eased),
    gripConstraints: cloneConstraints(next.gripConstraints ?? previous.gripConstraints),
    ...(next.reference ?? previous.reference ? { reference: cloneReference(next.reference ?? previous.reference) } : {}),
  };
};

export function sampleV3WeaponMotionTrack(
  trackId: V3AnimationTrackId,
  phase: number
): V3WeaponMotionSample {
  const track = getV3WeaponMotionTrack(trackId);
  const safePhase = clampV3MotionPhase(phase);
  if (
    safePhase <= 0 &&
    (trackId === 'hammer_windup' || trackId === 'hammer_melee' || trackId === 'sword_slash' || trackId === 'sword_lunge')
  ) {
    return {
      ...sampleV3WeaponMotionCarry(track.weapon),
      trackId,
      phase: safePhase,
    };
  }
  const referenceTrack = mixamoTrackReference(trackId, safePhase);
  if (referenceTrack) {
    const fromReference = referenceMotionSample(
      referenceTrack.weapon,
      trackId,
      referenceTrack.clipId,
      referenceTrack.normalizedTime,
      referenceTrack.gripConstraints,
      referenceTrack.ikHints
    );
    if (!referenceTrack.recoverToCarry) {
      return {
        ...fromReference,
        phase: safePhase,
        reference: reference(referenceTrack.clipId, referenceTrack.normalizedTime),
      };
    }
    const carry = sampleV3WeaponMotionCarry(referenceTrack.weapon);
    const eased = easeOutCubic(safePhase);
    return {
      ...fromReference,
      phase: safePhase,
      weaponPose: lerpWeaponPose(fromReference.weaponPose, carry.weaponPose, eased),
      upperBodyPose: lerpUpperBodyPose(fromReference.upperBodyPose, carry.upperBodyPose, eased),
      gripConstraints: cloneConstraints(referenceTrack.gripConstraints),
      ikHints: cloneHints(referenceTrack.ikHints),
      reference: reference(referenceTrack.clipId, referenceTrack.normalizedTime),
    };
  }
  const sorted = [...track.keyframes].sort((left, right) => left.phase - right.phase);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const easing = trackId.endsWith('_recover') ? 'easeOutCubic' : 'easeInOutCubic';

  let sampled: Pick<V3WeaponMotionSample, 'weaponPose' | 'upperBodyPose' | 'gripConstraints' | 'reference'>;
  if (safePhase <= first.phase) {
    sampled = {
      weaponPose: cloneWeaponPose(first.weaponPose),
      upperBodyPose: cloneUpperBodyPose(first.upperBodyPose),
      gripConstraints: cloneConstraints(first.gripConstraints),
      ...(first.reference ? { reference: cloneReference(first.reference) } : {}),
    };
  } else if (safePhase >= last.phase) {
    sampled = {
      weaponPose: cloneWeaponPose(last.weaponPose),
      upperBodyPose: cloneUpperBodyPose(last.upperBodyPose),
      gripConstraints: cloneConstraints(last.gripConstraints),
      ...(last.reference ? { reference: cloneReference(last.reference) } : {}),
    };
  } else {
    const nextIndex = sorted.findIndex((candidate) => candidate.phase >= safePhase);
    sampled = sampleBetweenKeyframes(sorted[nextIndex - 1], sorted[nextIndex], safePhase, easing);
  }

  return {
    weapon: track.weapon,
    trackId,
    trackSource: 'v3ConstrainedWeaponMotion',
    phase: safePhase,
    ...sampled,
    ikHints: cloneHints(track.ikHints),
  };
}
