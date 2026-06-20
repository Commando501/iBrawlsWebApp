import * as THREE from 'three';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { UniversalSettings } from '../../types';
import type { WeaponPose } from './attackAnimationPresets';

export const V3_ANIMATION_PROFILE_VERSION = 2;

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

const lerpTuple = (
  a: THREE.Vector3Tuple,
  b: THREE.Vector3Tuple,
  t: number
): THREE.Vector3Tuple => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

const lerpWeaponPose = (a: WeaponPose, b: WeaponPose, t: number): WeaponPose => ({
  position: lerpTuple(a.position, b.position, t),
  rotation: lerpTuple(a.rotation, b.rotation, t),
});

const lerpUpperBodyPose = (a: V3UpperBodyPose, b: V3UpperBodyPose, t: number): V3UpperBodyPose => ({
  upperTorsoRotation: lerpTuple(a.upperTorsoRotation, b.upperTorsoRotation, t),
  headRotation: lerpTuple(a.headRotation, b.headRotation, t),
  leftArmRotation: lerpTuple(a.leftArmRotation, b.leftArmRotation, t),
  rightArmRotation: lerpTuple(a.rightArmRotation, b.rightArmRotation, t),
});

const isHammerMeleeState = (state: string): boolean =>
  state === 'melee_swing' || state === 'melee_up' || state === 'melee_down';

const isPistolFiringState = (state: string): boolean =>
  state === 'firing' || state === 'fire' || state === 'shooting';

const isSwordSlashState = (state: string): boolean =>
  state === 'swing_up' || state === 'slashing' || state === 'swing_down';

const V3_WEAPON_CARRY_POSES: Record<V3AnimationWeaponId, {
  weaponPose: WeaponPose;
  upperBodyPose: V3UpperBodyPose;
}> = {
  hammer: {
    weaponPose: {
      position: [0.02, -0.02, -0.055],
      rotation: [0.34, 0.08, -0.12],
    },
    upperBodyPose: {
      upperTorsoRotation: [0.015, -0.035, 0.01],
      headRotation: [0, -0.015, 0],
      rightArmRotation: [-0.38, 0.08, -0.16],
      leftArmRotation: [-0.32, -0.12, 0.18],
    },
  },
  sword: {
    weaponPose: {
      position: [0.018, -0.012, -0.055],
      rotation: [-Math.PI / 2, -0.28, -Math.PI / 9],
    },
    upperBodyPose: {
      upperTorsoRotation: [0.025, 0.035, -0.02],
      headRotation: [0, 0.018, 0],
      rightArmRotation: [-0.56, 0.04, -0.12],
      leftArmRotation: [-0.16, -0.14, 0.16],
    },
  },
  pistol: {
    weaponPose: {
      position: [0.04, -0.02, -0.08],
      rotation: [-0.04, 0.02, -0.06],
    },
    upperBodyPose: {
      upperTorsoRotation: [-0.04, 0.08, 0],
      headRotation: [0, 0.025, 0],
      rightArmRotation: [-0.42, 0.04, -0.08],
      leftArmRotation: [-0.16, -0.12, 0.12],
    },
  },
};

const V3_PROCEDURAL_TRACK_PEAKS: Record<Exclude<V3AnimationTrackId,
  | 'hammer_recover'
  | 'hammer_melee_recover'
  | 'sword_recover'
  | 'pistol_recover'
>, {
  weapon: V3AnimationWeaponId;
  weaponPose: WeaponPose;
  upperBodyPose: V3UpperBodyPose;
}> = {
  hammer_windup: {
    weapon: 'hammer',
    weaponPose: {
      position: [-0.01, 0.085, -0.018],
      rotation: [-1.18, 0.1, -0.32],
    },
    upperBodyPose: {
      upperTorsoRotation: [-0.08, -0.12, 0.05],
      headRotation: [-0.025, -0.04, -0.01],
      rightArmRotation: [-1.05, 0.04, -0.12],
      leftArmRotation: [-0.52, -0.08, 0.18],
    },
  },
  hammer_strike: {
    weapon: 'hammer',
    weaponPose: {
      position: [-0.035, -0.045, -0.095],
      rotation: [1.04, 0.1, -0.04],
    },
    upperBodyPose: {
      upperTorsoRotation: [0.16, 0.04, -0.03],
      headRotation: [0.025, 0.04, -0.01],
      rightArmRotation: [-0.06, -0.02, 0.04],
      leftArmRotation: [-0.06, 0.02, -0.04],
    },
  },
  hammer_melee: {
    weapon: 'hammer',
    weaponPose: {
      position: [-0.08, 0.04, -0.11],
      rotation: [0.72, -0.78, -0.46],
    },
    upperBodyPose: {
      upperTorsoRotation: [0.04, 0.5, 0.12],
      headRotation: [0, 0.08, -0.02],
      rightArmRotation: [-0.34, -0.2, -0.48],
      leftArmRotation: [-0.22, 0.18, 0.32],
    },
  },
  sword_lunge: {
    weapon: 'sword',
    weaponPose: {
      position: [0.028, -0.01, -0.115],
      rotation: [-Math.PI / 2 - 0.22, 0.02, -Math.PI / 9],
    },
    upperBodyPose: {
      upperTorsoRotation: [0.24, 0.02, -0.12],
      headRotation: [0.03, 0.04, -0.02],
      rightArmRotation: [-0.76, 0.04, -0.06],
      leftArmRotation: [-0.24, -0.28, 0.22],
    },
  },
  sword_slash: {
    weapon: 'sword',
    weaponPose: {
      position: [-0.06, 0.04, -0.1],
      rotation: [-Math.PI / 2, 0.64, -0.72],
    },
    upperBodyPose: {
      upperTorsoRotation: [0.035, 0.28, 0.06],
      headRotation: [0, 0.085, 0.015],
      rightArmRotation: [-0.58, 0.26, -0.1],
      leftArmRotation: [-0.16, -0.14, 0.18],
    },
  },
  pistol_fire: {
    weapon: 'pistol',
    weaponPose: {
      position: [0.04, -0.01, -0.04],
      rotation: [-0.36, 0.04, -0.06],
    },
    upperBodyPose: {
      upperTorsoRotation: [-0.18, 0.12, 0],
      headRotation: [-0.03, 0.055, 0],
      rightArmRotation: [-0.84, 0.04, -0.08],
      leftArmRotation: [-0.16, -0.12, 0.12],
    },
  },
};

const V3_RECOVER_TRACK_STARTS: Record<Extract<V3AnimationTrackId,
  | 'hammer_recover'
  | 'hammer_melee_recover'
  | 'sword_recover'
  | 'pistol_recover'
>, keyof typeof V3_PROCEDURAL_TRACK_PEAKS> = {
  hammer_recover: 'hammer_strike',
  hammer_melee_recover: 'hammer_melee',
  sword_recover: 'sword_slash',
  pistol_recover: 'pistol_fire',
};

export function sampleV3WeaponCarryPose(weapon: V3AnimationWeaponId): V3WeaponCarryPoseSample {
  const carry = V3_WEAPON_CARRY_POSES[weapon];
  return {
    weapon,
    trackSource: 'v3ProceduralCarry',
    weaponPose: {
      position: [...carry.weaponPose.position] as THREE.Vector3Tuple,
      rotation: [...carry.weaponPose.rotation] as THREE.Vector3Tuple,
    },
    upperBodyPose: {
      upperTorsoRotation: [...carry.upperBodyPose.upperTorsoRotation] as THREE.Vector3Tuple,
      headRotation: [...carry.upperBodyPose.headRotation] as THREE.Vector3Tuple,
      leftArmRotation: [...carry.upperBodyPose.leftArmRotation] as THREE.Vector3Tuple,
      rightArmRotation: [...carry.upperBodyPose.rightArmRotation] as THREE.Vector3Tuple,
    },
  };
}

export function sampleV3ProceduralWeaponTrackPose(
  trackId: V3AnimationTrackId,
  phase: number
): V3ProceduralWeaponTrackPoseSample {
  const safePhase = clamp01(phase);
  const recoverStartTrack = V3_RECOVER_TRACK_STARTS[trackId as keyof typeof V3_RECOVER_TRACK_STARTS];
  const peak = recoverStartTrack
    ? V3_PROCEDURAL_TRACK_PEAKS[recoverStartTrack]
    : V3_PROCEDURAL_TRACK_PEAKS[trackId as keyof typeof V3_PROCEDURAL_TRACK_PEAKS];
  const carry = sampleV3WeaponCarryPose(peak.weapon);
  const from = recoverStartTrack ? peak : {
    weapon: peak.weapon,
    weaponPose: carry.weaponPose,
    upperBodyPose: carry.upperBodyPose,
  };
  const to = recoverStartTrack ? {
    weapon: peak.weapon,
    weaponPose: carry.weaponPose,
    upperBodyPose: carry.upperBodyPose,
  } : peak;
  const eased = trackId.endsWith('_recover') ? easeOutCubic(safePhase) : easeInOutCubic(safePhase);
  return {
    weapon: peak.weapon,
    trackId,
    trackSource: 'v3ProceduralWeaponTrack',
    phase: safePhase,
    weaponPose: lerpWeaponPose(from.weaponPose, to.weaponPose, eased),
    upperBodyPose: lerpUpperBodyPose(from.upperBodyPose, to.upperBodyPose, eased),
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

const sampleHammerThirdPersonPose = ({
  weaponState,
  weaponTimer,
  settings,
}: V3WeaponPoseSampleInput): WeaponPose => {
  const timing = resolveHammerSlamTiming(settings);

  if (weaponState === 'swing_up') {
    return sampleV3ProceduralWeaponTrackPose('hammer_windup', weaponTimer / timing.windupTime).weaponPose;
  }

  if (weaponState === 'swing_down') {
    return sampleV3ProceduralWeaponTrackPose('hammer_strike', weaponTimer / timing.attackTime).weaponPose;
  }

  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackPose(
      'hammer_recover',
      weaponTimer / Math.max(settings.hammerReloadTime ?? 0.6, 0.001)
    ).weaponPose;
  }

  if (isHammerMeleeState(weaponState)) {
    return sampleV3ProceduralWeaponTrackPose(
      'hammer_melee',
      weaponTimer / Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001)
    ).weaponPose;
  }

  if (weaponState === 'melee_recover') {
    return sampleV3ProceduralWeaponTrackPose(
      'hammer_melee_recover',
      weaponTimer / Math.max(settings.hammerMeleeReload ?? 0.5, 0.001)
    ).weaponPose;
  }

  return sampleV3WeaponCarryPose('hammer').weaponPose;
};

const sampleSwordThirdPersonPose = ({
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: V3WeaponPoseSampleInput): WeaponPose => {
  if (isLunging) {
    return sampleV3ProceduralWeaponTrackPose('sword_lunge', weaponTimer / 0.18).weaponPose;
  }

  if (isSwordSlashState(weaponState)) {
    return sampleV3ProceduralWeaponTrackPose(
      'sword_slash',
      weaponTimer / Math.max(settings.swordSlashSpeed ?? 0.22, 0.001)
    ).weaponPose;
  }

  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackPose(
      'sword_recover',
      weaponTimer / Math.max(settings.swordSlashReload ?? 0.6, 0.001)
    ).weaponPose;
  }

  return sampleV3WeaponCarryPose('sword').weaponPose;
};

const samplePistolThirdPersonPose = ({
  weaponState,
  weaponTimer,
}: V3WeaponPoseSampleInput): WeaponPose => {
  if (isPistolFiringState(weaponState)) {
    return sampleV3ProceduralWeaponTrackPose('pistol_fire', 1 - clamp01(weaponTimer / 0.18)).weaponPose;
  }
  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackPose('pistol_recover', weaponTimer / 0.18).weaponPose;
  }
  return sampleV3WeaponCarryPose('pistol').weaponPose;
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
    return sampleV3ProceduralWeaponTrackPose('hammer_windup', weaponTimer / timing.windupTime).upperBodyPose;
  }

  if (weaponState === 'swing_down') {
    return sampleV3ProceduralWeaponTrackPose('hammer_strike', weaponTimer / timing.attackTime).upperBodyPose;
  }

  if (isHammerMeleeState(weaponState)) {
    return sampleV3ProceduralWeaponTrackPose(
      'hammer_melee',
      weaponTimer / Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001)
    ).upperBodyPose;
  }

  if (weaponState === 'recovering' || weaponState === 'melee_recover') {
    const duration = weaponState === 'melee_recover'
      ? Math.max(settings.hammerMeleeReload ?? 0.5, 0.001)
      : Math.max(settings.hammerReloadTime ?? 0.6, 0.001);
    return sampleV3ProceduralWeaponTrackPose(
      weaponState === 'melee_recover' ? 'hammer_melee_recover' : 'hammer_recover',
      weaponTimer / duration
    ).upperBodyPose;
  }

  return sampleV3WeaponCarryPose('hammer').upperBodyPose;
};

const sampleSwordUpperBodyPose = ({
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: V3WeaponPoseSampleInput): V3UpperBodyPose => {
  if (isLunging) {
    return sampleV3ProceduralWeaponTrackPose('sword_lunge', weaponTimer / 0.18).upperBodyPose;
  }

  if (isSwordSlashState(weaponState)) {
    return sampleV3ProceduralWeaponTrackPose(
      'sword_slash',
      weaponTimer / Math.max(settings.swordSlashSpeed ?? 0.22, 0.001)
    ).upperBodyPose;
  }

  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackPose(
      'sword_recover',
      weaponTimer / Math.max(settings.swordSlashReload ?? 0.6, 0.001)
    ).upperBodyPose;
  }

  return sampleV3WeaponCarryPose('sword').upperBodyPose;
};

const samplePistolUpperBodyPose = ({
  weaponState,
  weaponTimer,
}: V3WeaponPoseSampleInput): V3UpperBodyPose => {
  if (isPistolFiringState(weaponState)) {
    return sampleV3ProceduralWeaponTrackPose('pistol_fire', 1 - clamp01(weaponTimer / 0.18)).upperBodyPose;
  }
  if (weaponState === 'recovering') {
    return sampleV3ProceduralWeaponTrackPose('pistol_recover', weaponTimer / 0.18).upperBodyPose;
  }
  return sampleV3WeaponCarryPose('pistol').upperBodyPose;
};

export function sampleV3UpperBodyWeaponPose(input: V3WeaponPoseSampleInput): V3UpperBodyPose {
  if (input.activeWeapon === 'sword') return sampleSwordUpperBodyPose(input);
  if (input.activeWeapon === 'pistol') return samplePistolUpperBodyPose(input);
  return sampleHammerUpperBodyPose(input);
}
