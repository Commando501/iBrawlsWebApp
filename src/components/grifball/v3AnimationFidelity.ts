import * as THREE from 'three';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { UniversalSettings } from '../../types';
import type { WeaponPose } from './attackAnimationPresets';
import {
  V3_WEAPON_MOTION_TRACKS,
  getV3WeaponMotionTrackDefinition,
  sampleV3WeaponMotionCarry,
  sampleV3WeaponMotionTrack,
  type V3AnimationTrackId,
  type V3AnimationWeaponId,
  type V3UpperBodyPose,
  type V3WeaponMotionSample,
  type V3WeaponMotionTrackDefinition,
} from './v3WeaponMotionTracks';

export const V3_ANIMATION_PROFILE_VERSION = 2;

export type {
  V3AnimationTrackId,
  V3AnimationWeaponId,
  V3UpperBodyPose,
};

export type V3AnimationTrackDefinition = V3WeaponMotionTrackDefinition;

export interface V3WeaponPoseSampleInput {
  activeWeapon: V3AnimationWeaponId;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  settings: Partial<UniversalSettings>;
}

export interface V3WeaponCarryPoseSample {
  weapon: V3AnimationWeaponId;
  trackSource: 'v3ProceduralCarry';
  weaponPose: WeaponPose;
  upperBodyPose: V3UpperBodyPose;
}

export interface V3ProceduralWeaponTrackPoseSample {
  weapon: V3AnimationWeaponId;
  trackId: V3AnimationTrackId;
  trackSource: 'v3ProceduralWeaponTrack';
  phase: number;
  weaponPose: WeaponPose;
  upperBodyPose: V3UpperBodyPose;
}

export const V3_ANIMATION_TRACKS: readonly V3AnimationTrackDefinition[] =
  V3_WEAPON_MOTION_TRACKS.map((track) => ({
    id: track.id,
    label: track.label,
    weapon: track.weapon,
    defaultDuration: track.defaultDuration,
  }));

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const easeOutCubic = (value: number): number => {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
};

export const easeInOutCubic = (value: number): number => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export function getV3AnimationTrackDefinition(id: V3AnimationTrackId): V3AnimationTrackDefinition {
  return getV3WeaponMotionTrackDefinition(id);
}

const isHammerMeleeState = (state: string): boolean =>
  state === 'melee_swing' || state === 'melee_up' || state === 'melee_down';

const isPistolFiringState = (state: string): boolean =>
  state === 'firing' || state === 'fire' || state === 'shooting';

const isSwordSlashState = (state: string): boolean =>
  state === 'swing_up' || state === 'slashing' || state === 'swing_down';

const poseOnly = (sample: V3WeaponMotionSample): WeaponPose => sample.weaponPose;

export function sampleV3WeaponCarryMotion(weapon: V3AnimationWeaponId): V3WeaponMotionSample {
  return sampleV3WeaponMotionCarry(weapon);
}

export function sampleV3ProceduralWeaponTrackMotion(
  trackId: V3AnimationTrackId,
  phase: number
): V3WeaponMotionSample {
  return sampleV3WeaponMotionTrack(trackId, phase);
}

export function sampleV3WeaponCarryPose(weapon: V3AnimationWeaponId): V3WeaponCarryPoseSample {
  const sample = sampleV3WeaponCarryMotion(weapon);
  return {
    weapon,
    trackSource: 'v3ProceduralCarry',
    weaponPose: sample.weaponPose,
    upperBodyPose: sample.upperBodyPose,
  };
}

export function sampleV3ProceduralWeaponTrackPose(
  trackId: V3AnimationTrackId,
  phase: number
): V3ProceduralWeaponTrackPoseSample {
  const sample = sampleV3ProceduralWeaponTrackMotion(trackId, phase);
  return {
    weapon: sample.weapon,
    trackId,
    trackSource: 'v3ProceduralWeaponTrack',
    phase: sample.phase,
    weaponPose: sample.weaponPose,
    upperBodyPose: sample.upperBodyPose,
  };
}

const sampleHammerFirstPersonPose = ({
  weaponState,
  weaponTimer,
  settings,
}: V3WeaponPoseSampleInput): WeaponPose => {
  const timing = resolveHammerSlamTiming(settings);
  const windup = weaponState === 'swing_up'
    ? easeOutCubic(weaponTimer / timing.windupTime)
    : 0;
  const strike = weaponState === 'swing_down'
    ? easeInOutCubic(weaponTimer / timing.attackTime)
    : 0;
  const melee = isHammerMeleeState(weaponState)
    ? easeInOutCubic(weaponTimer / Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001))
    : 0;
  const recover = weaponState === 'recovering'
    ? easeOutCubic(weaponTimer / Math.max(settings.hammerReloadTime ?? 0.6, 0.001))
    : 0;
  const meleeRecover = weaponState === 'melee_recover'
    ? easeOutCubic(weaponTimer / Math.max(settings.hammerMeleeReload ?? 0.5, 0.001))
    : 0;

  return {
    position: [
      0.35 + windup * 0.2 - strike * 0.42 - melee * 0.23 + recover * 0.08 + meleeRecover * 0.06,
      -0.38 + windup * 0.28 - strike * 0.16 + melee * 0.12 - meleeRecover * 0.04,
      -0.65 + windup * 0.26 - strike * 0.42 - melee * 0.18 + recover * 0.12 + meleeRecover * 0.08,
    ],
    rotation: [
      0.15 - windup * 1.5 + strike * 2.3 + melee * 0.55 - recover * 0.2 - meleeRecover * 0.18,
      -0.3 - windup * 0.32 + strike * 0.52 - melee * 0.48 + meleeRecover * 0.2,
      -0.15 + windup * 0.42 - strike * 0.72 - melee * 0.42 + meleeRecover * 0.16,
    ],
  };
};

const sampleSwordFirstPersonPose = ({
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: V3WeaponPoseSampleInput): WeaponPose => {
  const lunge = isLunging ? easeOutCubic(weaponTimer / 0.18) : 0;
  const slash = isSwordSlashState(weaponState)
    ? easeInOutCubic(weaponTimer / Math.max(settings.swordSlashSpeed ?? 0.22, 0.001))
    : 0;
  const recover = weaponState === 'recovering'
    ? easeOutCubic(weaponTimer / Math.max(settings.swordSlashReload ?? 0.6, 0.001))
    : 0;

  return {
    position: [
      0.28 + slash * 0.16 - recover * 0.04,
      -0.3 + lunge * 0.08 + slash * 0.04 - recover * 0.02,
      -0.58 - lunge * 0.3 - slash * 0.12 + recover * 0.08,
    ],
    rotation: [
      -Math.PI / 2 - lunge * 0.28,
      slash * 0.72 - recover * 0.18,
      -Math.PI / 8 - slash * 0.55 + recover * 0.08,
    ],
  };
};

const samplePistolFirstPersonPose = ({
  weaponState,
  weaponTimer,
}: V3WeaponPoseSampleInput): WeaponPose => {
  const recoil = isPistolFiringState(weaponState) ? 1 - clamp01(weaponTimer / 0.18) : 0;

  return {
    position: [0.24, -0.26 + recoil * 0.025, -0.4 + recoil * 0.1],
    rotation: [-recoil * 0.22, 0.02 + recoil * 0.015, recoil * 0.02],
  };
};

export function sampleV3FirstPersonWeaponPose(input: V3WeaponPoseSampleInput): WeaponPose {
  if (input.activeWeapon === 'sword') return sampleSwordFirstPersonPose(input);
  if (input.activeWeapon === 'pistol') return samplePistolFirstPersonPose(input);
  return sampleHammerFirstPersonPose(input);
}

const sampleHammerThirdPersonMotion = ({
  weaponState,
  weaponTimer,
  settings,
}: V3WeaponPoseSampleInput): V3WeaponMotionSample => {
  const timing = resolveHammerSlamTiming(settings);

  if (weaponState === 'swing_up') {
    return sampleV3ProceduralWeaponTrackMotion('hammer_windup', weaponTimer / timing.windupTime);
  }
  if (weaponState === 'swing_down') {
    return sampleV3ProceduralWeaponTrackMotion('hammer_strike', weaponTimer / timing.attackTime);
  }
  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackMotion(
      'hammer_recover',
      weaponTimer / Math.max(settings.hammerReloadTime ?? 0.6, 0.001)
    );
  }
  if (isHammerMeleeState(weaponState)) {
    return sampleV3ProceduralWeaponTrackMotion(
      'hammer_melee',
      weaponTimer / Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001)
    );
  }
  if (weaponState === 'melee_recover') {
    return sampleV3ProceduralWeaponTrackMotion(
      'hammer_melee_recover',
      weaponTimer / Math.max(settings.hammerMeleeReload ?? 0.5, 0.001)
    );
  }

  return sampleV3WeaponCarryMotion('hammer');
};

const sampleSwordThirdPersonMotion = ({
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: V3WeaponPoseSampleInput): V3WeaponMotionSample => {
  if (isLunging) {
    return sampleV3ProceduralWeaponTrackMotion('sword_lunge', weaponTimer / 0.18);
  }
  if (isSwordSlashState(weaponState)) {
    return sampleV3ProceduralWeaponTrackMotion(
      'sword_slash',
      weaponTimer / Math.max(settings.swordSlashSpeed ?? 0.22, 0.001)
    );
  }
  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackMotion(
      'sword_recover',
      weaponTimer / Math.max(settings.swordSlashReload ?? 0.6, 0.001)
    );
  }

  return sampleV3WeaponCarryMotion('sword');
};

const samplePistolThirdPersonMotion = ({
  weaponState,
  weaponTimer,
}: V3WeaponPoseSampleInput): V3WeaponMotionSample => {
  if (isPistolFiringState(weaponState)) {
    return sampleV3ProceduralWeaponTrackMotion('pistol_fire', 1 - clamp01(weaponTimer / 0.18));
  }
  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackMotion('pistol_recover', weaponTimer / 0.18);
  }
  return sampleV3WeaponCarryMotion('pistol');
};

export function sampleV3ThirdPersonWeaponMotion(input: V3WeaponPoseSampleInput): V3WeaponMotionSample {
  if (input.activeWeapon === 'sword') return sampleSwordThirdPersonMotion(input);
  if (input.activeWeapon === 'pistol') return samplePistolThirdPersonMotion(input);
  return sampleHammerThirdPersonMotion(input);
}

export function sampleV3ThirdPersonWeaponPose(input: V3WeaponPoseSampleInput): WeaponPose {
  return poseOnly(sampleV3ThirdPersonWeaponMotion(input));
}

export function sampleV3UpperBodyWeaponPose(input: V3WeaponPoseSampleInput): V3UpperBodyPose {
  return sampleV3ThirdPersonWeaponMotion(input).upperBodyPose;
}

export const DEFAULT_V3_HAMMER_WINDUP_DURATION = DEFAULT_HAMMER_SLAM_WINDUP_TIME;
export const DEFAULT_V3_HAMMER_STRIKE_DURATION = DEFAULT_HAMMER_SLAM_ATTACK_TIME;
