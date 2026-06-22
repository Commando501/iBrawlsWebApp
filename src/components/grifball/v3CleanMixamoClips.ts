import * as THREE from 'three';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import {
  fitV3RetargetedWeaponPoseFromReferenceSample,
  sampleV3RetargetedUpperBodyPose,
} from './v3MixamoRetarget';
import {
  sampleV3RetargetedClip,
  type V3RetargetedClipId,
} from './v3RetargetedAnimationClips';
import type {
  V3CleanRigPose,
  V3CleanRigWeaponPose,
  V3CleanJointName,
  V3QuatTuple,
  V3Vec3Tuple,
} from './v3CleanRig';
import type { V3WeaponReferenceClipId } from './v3WeaponReferenceClips';

export type V3CleanMixamoMotionSource = 'retargetedMixamo' | 'mixamoWeaponReference';
export type V3CleanMixamoClipId = V3RetargetedClipId | V3WeaponReferenceClipId;

export interface V3CleanMixamoClipSample {
  pose: V3CleanRigPose;
  weaponPose?: V3CleanRigWeaponPose;
  motionSource: V3CleanMixamoMotionSource;
  mixamoClipId: V3CleanMixamoClipId;
  sourceNormalizedTime: number;
}

export interface V3CleanMixamoClipBinding {
  motionSource: V3CleanMixamoMotionSource;
  mixamoClipId: V3CleanMixamoClipId;
}

type WeaponBinding = {
  clipId: V3WeaponReferenceClipId;
  weapon: 'hammer' | 'sword';
  sourceTime: (normalizedTime: number) => number;
};

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const easeInOutCubic = (value: number): number => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const windowedTime = (from: number, to: number) => (normalizedTime: number): number =>
  roundMetric(from + (to - from) * easeInOutCubic(normalizedTime));

const eulerToQuatTuple = (rotation: readonly [number, number, number]): V3QuatTuple => {
  const quaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'))
    .normalize();
  return [
    roundMetric(quaternion.x),
    roundMetric(quaternion.y),
    roundMetric(quaternion.z),
    roundMetric(quaternion.w),
  ];
};

const vec3 = (value: readonly [number, number, number]): V3Vec3Tuple => [
  roundMetric(value[0]),
  roundMetric(value[1]),
  roundMetric(value[2]),
];

const locomotionClipForCleanClip = (clipId: string): V3RetargetedClipId | null => {
  if (clipId === 'clean_idle') return 'idle';
  if (clipId === 'clean_walk') return 'walk';
  if (clipId === 'clean_sprint') return 'run';
  return null;
};

const WEAPON_BINDINGS: Partial<Record<string, WeaponBinding>> = {
  clean_hammer_carry: {
    clipId: 'hammer_2hand_idle',
    weapon: 'hammer',
    sourceTime: (normalizedTime) => roundMetric(clamp01(normalizedTime)),
  },
  clean_hammer_windup: {
    clipId: 'hammer_heavy_swing',
    weapon: 'hammer',
    sourceTime: windowedTime(0.02, 0.25),
  },
  clean_hammer_strike: {
    clipId: 'hammer_heavy_swing',
    weapon: 'hammer',
    sourceTime: windowedTime(0.25, 0.5),
  },
  clean_hammer_recover: {
    clipId: 'hammer_heavy_swing',
    weapon: 'hammer',
    sourceTime: windowedTime(0.5, 1),
  },
  clean_hammer_melee: {
    clipId: 'hammer_melee_advance',
    weapon: 'hammer',
    sourceTime: windowedTime(0.02, 0.56),
  },
  clean_hammer_melee_recover: {
    clipId: 'hammer_melee_advance',
    weapon: 'hammer',
    sourceTime: windowedTime(0.56, 1),
  },
  clean_sword_carry: {
    clipId: 'sword_outward_slash',
    weapon: 'sword',
    sourceTime: () => 0,
  },
  clean_sword_lunge: {
    clipId: 'sword_outward_slash',
    weapon: 'sword',
    sourceTime: windowedTime(0.18, 0.5),
  },
  clean_sword_slash: {
    clipId: 'sword_outward_slash',
    weapon: 'sword',
    sourceTime: windowedTime(0.5, 0.64),
  },
  clean_sword_recover: {
    clipId: 'sword_outward_slash',
    weapon: 'sword',
    sourceTime: windowedTime(0.64, 1),
  },
};

const pelvisOffsetFromRetarget = (
  offset: readonly [number, number, number] | undefined
): V3Vec3Tuple | undefined => {
  if (!offset) return undefined;
  const verticalOffset = THREE.MathUtils.clamp(Math.max(0, offset[1]) * 0.18, 0, 0.012);
  if (verticalOffset <= 0) return undefined;
  return [0, roundMetric(verticalOffset), 0];
};

const sampleCleanLocomotionClip = (
  cleanClipId: string,
  mixamoClipId: V3RetargetedClipId,
  normalizedTime: number
): V3CleanMixamoClipSample => {
  const sample = sampleV3RetargetedClip(mixamoClipId, { normalizedTime });
  const jointQuaternions = Object.fromEntries(
    Object.entries(sample.joints).map(([jointName, joint]) => [
      jointName,
      eulerToQuatTuple(joint?.rotation ?? [0, 0, 0]),
    ])
  ) as Partial<Record<V3CleanJointName, V3QuatTuple>>;
  const rootOffset = pelvisOffsetFromRetarget(sample.joints.pelvis?.offset);
  const pose: V3CleanRigPose = {
    clipId: cleanClipId,
    animationAuthority: 'cleanRig',
    normalizedTime: sample.normalizedTime,
    jointQuaternions,
    ...(rootOffset ? { rootOffset } : {}),
  };

  return {
    pose,
    motionSource: 'retargetedMixamo',
    mixamoClipId,
    sourceNormalizedTime: sample.normalizedTime,
  };
};

const sampleCleanWeaponClip = (
  cleanClipId: string,
  binding: WeaponBinding,
  normalizedTime: number
): V3CleanMixamoClipSample => {
  const sourceNormalizedTime = binding.sourceTime(normalizedTime);
  const upperBody = sampleV3RetargetedUpperBodyPose(binding.clipId, sourceNormalizedTime);
  const fit = fitV3RetargetedWeaponPoseFromReferenceSample(binding.clipId, {
    normalizedTime: sourceNormalizedTime,
    weapon: binding.weapon,
  });
  const weaponPose: V3CleanRigWeaponPose = {
    weapon: binding.weapon,
    position: vec3(fit.weaponPose.position),
    rotation: vec3(fit.weaponPose.rotation),
    source: 'mixamoReferenceClip',
    primarySocketMarker: vec3(fit.primaryHandPosition),
    ...(fit.offhandPosition ? { offhandSocketMarker: vec3(fit.offhandPosition) } : {}),
  };
  const jointQuaternions = Object.fromEntries(
    Object.entries(upperBody.detailBoneQuaternions).map(([jointName, quaternion]) => [
      jointName,
      quaternion,
    ])
  ) as Partial<Record<V3CleanJointName, V3QuatTuple>>;
  const pose: V3CleanRigPose = {
    clipId: cleanClipId,
    animationAuthority: 'cleanRig',
    normalizedTime,
    jointQuaternions,
    weaponPose,
  };

  return {
    pose,
    weaponPose,
    motionSource: 'mixamoWeaponReference',
    mixamoClipId: binding.clipId,
    sourceNormalizedTime,
  };
};

export function getV3CleanMixamoClipBinding(cleanClipId: string): V3CleanMixamoClipBinding | null {
  const locomotion = locomotionClipForCleanClip(cleanClipId);
  if (locomotion) {
    return {
      motionSource: 'retargetedMixamo',
      mixamoClipId: locomotion,
    };
  }
  const weapon = WEAPON_BINDINGS[cleanClipId];
  if (!weapon) return null;
  return {
    motionSource: 'mixamoWeaponReference',
    mixamoClipId: weapon.clipId,
  };
}

export function sampleV3CleanMixamoClip(
  cleanClipId: string,
  normalizedTime: number
): V3CleanMixamoClipSample | null {
  const safeTime = clamp01(normalizedTime);
  const locomotion = locomotionClipForCleanClip(cleanClipId);
  if (locomotion) return sampleCleanLocomotionClip(cleanClipId, locomotion, safeTime);
  const weapon = WEAPON_BINDINGS[cleanClipId];
  if (weapon) return sampleCleanWeaponClip(cleanClipId, weapon, safeTime);
  return null;
}
