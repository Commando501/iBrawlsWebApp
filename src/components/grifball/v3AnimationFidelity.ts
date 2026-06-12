import * as THREE from 'three';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { UniversalSettings } from '../../types';
import type { WeaponPose } from './attackAnimationPresets';

export const V3_ANIMATION_PROFILE_VERSION = 1;

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

export interface V3AnimationTrackDefinition {
  id: V3AnimationTrackId;
  label: string;
  weapon: V3AnimationWeaponId;
  defaultDuration: number;
}

export interface V3WeaponPoseSampleInput {
  activeWeapon: V3AnimationWeaponId;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  settings: Partial<UniversalSettings>;
}

export interface V3UpperBodyPose {
  upperTorsoRotation: THREE.Vector3Tuple;
  headRotation: THREE.Vector3Tuple;
  leftArmRotation: THREE.Vector3Tuple;
  rightArmRotation: THREE.Vector3Tuple;
}

export const V3_ANIMATION_TRACKS: readonly V3AnimationTrackDefinition[] = [
  { id: 'hammer_windup', label: 'Hammer windup', weapon: 'hammer', defaultDuration: DEFAULT_HAMMER_SLAM_WINDUP_TIME },
  { id: 'hammer_strike', label: 'Hammer strike', weapon: 'hammer', defaultDuration: DEFAULT_HAMMER_SLAM_ATTACK_TIME },
  { id: 'hammer_recover', label: 'Hammer recover', weapon: 'hammer', defaultDuration: 0.6 },
  { id: 'hammer_melee', label: 'Hammer melee swing', weapon: 'hammer', defaultDuration: 0.24 },
  { id: 'hammer_melee_recover', label: 'Hammer melee recover', weapon: 'hammer', defaultDuration: 0.5 },
  { id: 'sword_lunge', label: 'Sword lunge', weapon: 'sword', defaultDuration: 0.18 },
  { id: 'sword_slash', label: 'Sword slash', weapon: 'sword', defaultDuration: 0.22 },
  { id: 'sword_recover', label: 'Sword recover', weapon: 'sword', defaultDuration: 0.6 },
  { id: 'pistol_fire', label: 'Pistol fire', weapon: 'pistol', defaultDuration: 0.18 },
  { id: 'pistol_recover', label: 'Pistol recover', weapon: 'pistol', defaultDuration: 0.18 },
];

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
  const track = V3_ANIMATION_TRACKS.find((candidate) => candidate.id === id);
  if (!track) throw new Error(`Unknown V3 animation track: ${id}`);
  return track;
}

const lerp = THREE.MathUtils.lerp;

const isHammerMeleeState = (state: string): boolean =>
  state === 'melee_swing' || state === 'melee_up' || state === 'melee_down';

const isPistolFiringState = (state: string): boolean =>
  state === 'firing' || state === 'fire' || state === 'shooting';

const isSwordSlashState = (state: string): boolean =>
  state === 'swing_up' || state === 'slashing' || state === 'swing_down';

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

const sampleHammerThirdPersonPose = ({
  weaponState,
  weaponTimer,
  settings,
}: V3WeaponPoseSampleInput): WeaponPose => {
  const timing = resolveHammerSlamTiming(settings);

  if (weaponState === 'swing_up') {
    const pct = easeOutCubic(weaponTimer / timing.windupTime);
    return {
      position: [lerp(0.04, -0.02, pct), lerp(-0.02, 0.16, pct), lerp(-0.08, -0.02, pct)],
      rotation: [lerp(0.28, -1.22, pct), 0.08, lerp(-0.12, -0.32, pct)],
    };
  }

  if (weaponState === 'swing_down') {
    const pct = easeInOutCubic(weaponTimer / timing.attackTime);
    return {
      position: [lerp(-0.02, -0.12, pct), lerp(0.16, -0.1, pct), lerp(-0.02, -0.24, pct)],
      rotation: [lerp(-1.22, 1.08, pct), 0.08, lerp(-0.32, -0.04, pct)],
    };
  }

  if (weaponState === 'recovering') {
    const pct = easeOutCubic(weaponTimer / Math.max(settings.hammerReloadTime ?? 0.6, 0.001));
    return {
      position: [lerp(-0.12, 0.04, pct), lerp(-0.1, -0.02, pct), lerp(-0.24, -0.08, pct)],
      rotation: [lerp(1.08, 0.28, pct), 0.08, lerp(-0.04, -0.12, pct)],
    };
  }

  if (isHammerMeleeState(weaponState)) {
    const pct = easeInOutCubic(weaponTimer / Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001));
    return {
      position: [lerp(0.05, -0.18, pct), lerp(-0.04, 0.08, pct), lerp(-0.1, -0.26, pct)],
      rotation: [lerp(0.32, 0.72, pct), lerp(0.12, -0.78, pct), lerp(-0.16, -0.46, pct)],
    };
  }

  if (weaponState === 'melee_recover') {
    const pct = easeOutCubic(weaponTimer / Math.max(settings.hammerMeleeReload ?? 0.5, 0.001));
    return {
      position: [lerp(-0.18, 0.04, pct), lerp(0.08, -0.02, pct), lerp(-0.26, -0.08, pct)],
      rotation: [lerp(0.72, 0.28, pct), lerp(-0.78, 0.08, pct), lerp(-0.46, -0.12, pct)],
    };
  }

  return {
    position: [0.04, -0.02, -0.08],
    rotation: [0.28, 0.08, -0.12],
  };
};

const sampleSwordThirdPersonPose = ({
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: V3WeaponPoseSampleInput): WeaponPose => {
  if (isLunging) {
    const pct = easeOutCubic(weaponTimer / 0.18);
    return {
      position: [0.02 + pct * 0.04, -0.02, -0.18 - pct * 0.18],
      rotation: [-Math.PI / 2 - pct * 0.24, 0.02, -Math.PI / 8],
    };
  }

  if (isSwordSlashState(weaponState)) {
    const pct = easeInOutCubic(weaponTimer / Math.max(settings.swordSlashSpeed ?? 0.22, 0.001));
    return {
      position: [lerp(0.04, -0.12, pct), lerp(-0.02, 0.08, pct), lerp(-0.1, -0.22, pct)],
      rotation: [-Math.PI / 2, lerp(-0.42, 0.64, pct), lerp(-Math.PI / 8, -0.72, pct)],
    };
  }

  if (weaponState === 'recovering') {
    const pct = easeOutCubic(weaponTimer / Math.max(settings.swordSlashReload ?? 0.6, 0.001));
    return {
      position: [lerp(-0.12, 0.04, pct), lerp(0.08, -0.02, pct), lerp(-0.22, -0.1, pct)],
      rotation: [-Math.PI / 2, lerp(0.64, -0.42, pct), lerp(-0.72, -Math.PI / 8, pct)],
    };
  }

  return {
    position: [0.04, -0.02, -0.1],
    rotation: [-Math.PI / 2, -0.42, -Math.PI / 8],
  };
};

const samplePistolThirdPersonPose = ({
  weaponState,
  weaponTimer,
}: V3WeaponPoseSampleInput): WeaponPose => {
  const recoil = isPistolFiringState(weaponState) ? 1 - clamp01(weaponTimer / 0.18) : 0;

  return {
    position: [0.08, -0.04 + recoil * 0.02, -0.18 + recoil * 0.1],
    rotation: [-0.04 - recoil * 0.32, 0.02 + recoil * 0.02, -0.06],
  };
};

export function sampleV3ThirdPersonWeaponPose(input: V3WeaponPoseSampleInput): WeaponPose {
  if (input.activeWeapon === 'sword') return sampleSwordThirdPersonPose(input);
  if (input.activeWeapon === 'pistol') return samplePistolThirdPersonPose(input);
  return sampleHammerThirdPersonPose(input);
}

const readyUpperBodyPose = (): V3UpperBodyPose => ({
  upperTorsoRotation: [0, 0, 0],
  headRotation: [0, 0, 0],
  leftArmRotation: [-0.12, 0, 0.08],
  rightArmRotation: [-0.12, 0, -0.08],
});

const sampleHammerUpperBodyPose = ({
  weaponState,
  weaponTimer,
  settings,
}: V3WeaponPoseSampleInput): V3UpperBodyPose => {
  const timing = resolveHammerSlamTiming(settings);

  if (weaponState === 'swing_up') {
    const pct = easeOutCubic(weaponTimer / timing.windupTime);
    return {
      upperTorsoRotation: [-0.12, lerp(0, -0.34, pct), 0.08 + pct * 0.06],
      headRotation: [-0.02 * pct, -0.1 * pct, -0.03 * pct],
      rightArmRotation: [lerp(-0.24, -1.35, pct), 0.16, -0.24 - pct * 0.08],
      leftArmRotation: [lerp(-0.18, -0.88, pct), -0.18 - pct * 0.05, 0.26 + pct * 0.06],
    };
  }

  if (weaponState === 'swing_down') {
    const pct = easeInOutCubic(weaponTimer / timing.attackTime);
    const recover = clamp01(weaponTimer / Math.max(timing.attackTime, 0.001));
    return {
      upperTorsoRotation: [lerp(-0.12, 0.3, pct), 0.42 * (1 - recover * 0.25), -0.12 - pct * 0.06],
      headRotation: [0.03 * pct, 0.12 * pct, -0.03 * pct],
      rightArmRotation: [lerp(-1.35, -0.08, pct), -0.12, 0.14],
      leftArmRotation: [lerp(-0.88, -0.08, pct), 0.12, -0.14],
    };
  }

  if (isHammerMeleeState(weaponState)) {
    return {
      upperTorsoRotation: [0.04, 0.5, 0.12],
      headRotation: [0, 0.08, -0.02],
      rightArmRotation: [-0.34, -0.2, -0.48],
      leftArmRotation: [-0.22, 0.18, 0.32],
    };
  }

  if (weaponState === 'recovering' || weaponState === 'melee_recover') {
    const duration = weaponState === 'melee_recover'
      ? Math.max(settings.hammerMeleeReload ?? 0.5, 0.001)
      : Math.max(settings.hammerReloadTime ?? 0.6, 0.001);
    const pct = clamp01(weaponTimer / duration);
    return {
      upperTorsoRotation: [0, lerp(0.32, 0, pct), 0],
      headRotation: [0, lerp(0.06, 0, pct), 0],
      rightArmRotation: [lerp(-0.42, -0.12, pct), 0, -0.08],
      leftArmRotation: [lerp(-0.28, -0.12, pct), 0, 0.08],
    };
  }

  return readyUpperBodyPose();
};

const sampleSwordUpperBodyPose = ({
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: V3WeaponPoseSampleInput): V3UpperBodyPose => {
  if (isLunging) {
    const pct = easeOutCubic(weaponTimer / 0.18);
    return {
      upperTorsoRotation: [0.18 + pct * 0.08, 0, lerp(0, -0.12, pct)],
      headRotation: [0.03, 0.04 * pct, -0.02 * pct],
      rightArmRotation: [-0.72 - pct * 0.08, 0.04, -0.04],
      leftArmRotation: [-0.24, -0.24 - pct * 0.08, 0.18 + pct * 0.06],
    };
  }

  if (isSwordSlashState(weaponState)) {
    const pct = easeInOutCubic(weaponTimer / Math.max(settings.swordSlashSpeed ?? 0.22, 0.001));
    return {
      upperTorsoRotation: [0.04, lerp(-0.32, 0.34, pct), 0.08],
      headRotation: [0, lerp(-0.08, 0.1, pct), 0.02],
      rightArmRotation: [-0.64, lerp(-0.28, 0.32, pct), -0.12],
      leftArmRotation: [-0.18, -0.16, 0.2],
    };
  }

  if (weaponState === 'recovering') {
    const pct = clamp01(weaponTimer / Math.max(settings.swordSlashReload ?? 0.6, 0.001));
    return {
      upperTorsoRotation: [0, lerp(0.18, 0, pct), 0],
      headRotation: [0, lerp(0.04, 0, pct), 0],
      rightArmRotation: [lerp(-0.64, -0.12, pct), 0, -0.08],
      leftArmRotation: [lerp(-0.18, -0.12, pct), 0, 0.08],
    };
  }

  return readyUpperBodyPose();
};

const samplePistolUpperBodyPose = ({
  weaponState,
  weaponTimer,
}: V3WeaponPoseSampleInput): V3UpperBodyPose => {
  const recoil = isPistolFiringState(weaponState) ? 1 - clamp01(weaponTimer / 0.18) : 0;

  return {
    upperTorsoRotation: [-0.04 - recoil * 0.14, 0.08 + recoil * 0.04, 0],
    headRotation: [-recoil * 0.03, recoil * 0.03, 0],
    rightArmRotation: [-0.42 - recoil * 0.42, 0.04, -0.08],
    leftArmRotation: [-0.16, -0.12, 0.12],
  };
};

export function sampleV3UpperBodyWeaponPose(input: V3WeaponPoseSampleInput): V3UpperBodyPose {
  if (input.activeWeapon === 'sword') return sampleSwordUpperBodyPose(input);
  if (input.activeWeapon === 'pistol') return samplePistolUpperBodyPose(input);
  return sampleHammerUpperBodyPose(input);
}
