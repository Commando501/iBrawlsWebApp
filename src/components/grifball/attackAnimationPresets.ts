import * as THREE from 'three';
import { type UniversalSettings } from '../../types';

export type AttackAnimationStyle = 'current' | 'highFidelity';
export type HammerAttackPhase = 'windup' | 'strike' | 'recover' | 'melee_swing' | 'melee_recover';
export type SwordAttackPhase = 'lunge' | 'slash' | 'recover';

export interface WeaponPose {
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface CombatantArmPose {
  rightArmRotation: [number, number, number];
  leftArmRotation: [number, number, number];
}

export const THIRD_PERSON_RIGHT_HAND_REST_OFFSET: [number, number, number] = [0.44, -0.06, -0.08];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeInCubic = (value: number): number => {
  const t = clamp01(value);
  return t * t * t;
};
const easeOutCubic = (value: number): number => {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
};
const easeInOutCubic = (value: number): number => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const lerp = THREE.MathUtils.lerp;

export const toThirdPersonHandPose = (pose: WeaponPose): WeaponPose => ({
  position: [
    pose.position[0] - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[0],
    pose.position[1] - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[1],
    pose.position[2] - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[2],
  ],
  rotation: pose.rotation,
});

const lerpRotation = (
  from: [number, number, number],
  to: [number, number, number],
  progress: number
): [number, number, number] => [
  lerp(from[0], to[0], progress),
  lerp(from[1], to[1], progress),
  lerp(from[2], to[2], progress),
];

export const getHammerAttackAnimationStyle = (settings: Partial<UniversalSettings>): AttackAnimationStyle =>
  settings.hammerAttackAnimation === 'highFidelity' ? 'highFidelity' : 'current';

export const getSwordAttackAnimationStyle = (settings: Partial<UniversalSettings>): AttackAnimationStyle =>
  settings.swordAttackAnimation === 'highFidelity' ? 'highFidelity' : 'current';

export function getFirstPersonHammerPose(
  phase: HammerAttackPhase,
  progress: number,
  idleYBob = 0
): WeaponPose {
  const pct = clamp01(progress);

  if (phase === 'windup') {
    const t = easeOutCubic(pct);
    const anticipation = Math.sin(pct * Math.PI) * 0.06;
    return {
      position: [
        lerp(0.35, 0.58, t),
        lerp(-0.38, -0.06, t) + idleYBob,
        lerp(-0.65, -0.32, t) + anticipation,
      ],
      rotation: [
        lerp(0.15, -1.38, t),
        lerp(-0.3, -0.72, t),
        lerp(-0.15, 0.28, t),
      ],
    };
  }

  if (phase === 'strike') {
    const t = easeInCubic(pct);
    const arc = Math.sin(pct * Math.PI) * 0.16;
    return {
      position: [
        lerp(0.58, -0.12, t),
        lerp(-0.06, -0.55, t) + idleYBob,
        lerp(-0.32, -1.02, t) - arc,
      ],
      rotation: [
        lerp(-1.38, 1.2, t),
        lerp(-0.72, 0.24, t),
        lerp(0.28, -0.5, t),
      ],
    };
  }

  if (phase === 'recover') {
    const t = easeOutCubic(pct);
    const settle = Math.sin(pct * Math.PI) * 0.08;
    return {
      position: [
        lerp(-0.12, 0.35, t),
        lerp(-0.55, -0.38, t) + idleYBob + settle * 0.25,
        lerp(-1.02, -0.65, t) + settle,
      ],
      rotation: [
        lerp(1.2, 0.15, t),
        lerp(0.24, -0.3, t),
        lerp(-0.5, -0.15, t),
      ],
    };
  }

  if (phase === 'melee_swing') {
    const t = easeInOutCubic(pct);
    const isWindup = pct < 0.28;
    const localPct = isWindup ? easeOutCubic(pct / 0.28) : easeInCubic((pct - 0.28) / 0.72);
    const arc = Math.sin(t * Math.PI) * 0.12;
    if (isWindup) {
      return {
        position: [
          lerp(0.35, 0.58, localPct),
          lerp(-0.38, -0.31, localPct) + idleYBob,
          lerp(-0.65, -0.52, localPct),
        ],
        rotation: [
          lerp(0.15, 0.26, localPct),
          lerp(-0.3, 0.3, localPct),
          lerp(-0.15, 0.22, localPct),
        ],
      };
    }
    return {
      position: [
        lerp(0.58, -0.58, localPct),
        lerp(-0.31, -0.22, localPct) + idleYBob,
        lerp(-0.52, -0.94, localPct) - arc,
      ],
      rotation: [
        lerp(0.26, 0.58, localPct),
        lerp(0.3, -2.16, localPct),
        lerp(0.22, -1.02, localPct),
      ],
    };
  }

  const t = easeOutCubic(pct);
  const settle = Math.sin(pct * Math.PI) * 0.05;
  return {
    position: [
      lerp(-0.58, 0.35, t),
      lerp(-0.22, -0.38, t) + idleYBob,
      lerp(-0.94, -0.65, t) + settle,
    ],
    rotation: [
      lerp(0.58, 0.15, t),
      lerp(-2.16, -0.3, t),
      lerp(-1.02, -0.15, t),
    ],
  };
}

export function getFirstPersonSwordLungePose(lungeTimer: number, idleYBob = 0): WeaponPose {
  const settle = easeOutCubic(Math.min(lungeTimer / 0.18, 1));
  const shimmer = Math.sin(lungeTimer * 28) * 0.035;
  return {
    position: [
      shimmer * 0.35,
      lerp(-0.22, -0.16, settle) + idleYBob,
      lerp(-0.7, -0.9, settle),
    ],
    rotation: [
      -Math.PI / 2 - lerp(0.15, 0.35, settle),
      shimmer,
      -shimmer * 0.8,
    ],
  };
}

export function getFirstPersonSwordSlashPose(
  phase: Extract<SwordAttackPhase, 'slash' | 'recover'>,
  progress: number,
  idleYBob = 0
): WeaponPose {
  const pct = clamp01(progress);
  if (phase === 'slash') {
    const t = easeInOutCubic(pct);
    const arc = Math.sin(pct * Math.PI);
    return {
      position: [
        lerp(-0.56, 0.54, t),
        lerp(-0.34, -0.24, t) + idleYBob + arc * 0.12,
        lerp(-0.36, -0.86, t) + (pct < 0.5 ? -0.16 * arc : 0.12 * arc),
      ],
      rotation: [
        -Math.PI / 2 + arc * 0.14,
        lerp(-1.45, 1.42, t),
        lerp(0.82, -1.78, t),
      ],
    };
  }

  const t = easeOutCubic(pct);
  const settle = Math.sin(pct * Math.PI) * 0.05;
  return {
    position: [
      lerp(0.54, 0.35, t),
      lerp(-0.24, -0.38, t) + idleYBob,
      lerp(-0.86, -0.5, t) + settle,
    ],
    rotation: [
      -Math.PI / 2,
      lerp(1.42, 0, t),
      lerp(-1.78, -Math.PI / 8, t),
    ],
  };
}

export function getThirdPersonHammerPose(phase: HammerAttackPhase, progress: number): WeaponPose {
  const pct = clamp01(progress);
  if (phase === 'windup') {
    const t = easeOutCubic(pct);
    return toThirdPersonHandPose({
      position: [
        lerp(0.48, 0.64, t),
        lerp(1.08, 2.05, t) - 0.64,
        lerp(-0.48, -0.08, t),
      ],
      rotation: [
        lerp(0.2, -1.55, t),
        lerp(0.1, -0.34, t),
        lerp(-0.15, 0.38, t),
      ],
    });
  }

  if (phase === 'strike') {
    const t = easeInCubic(pct);
    const arc = Math.sin(pct * Math.PI) * 0.12;
    return toThirdPersonHandPose({
      position: [
        lerp(0.64, 0.12, t),
        lerp(2.05, 0.48, t) - 0.64,
        lerp(-0.08, -1.04, t) - arc,
      ],
      rotation: [
        lerp(-1.55, 1.25, t),
        lerp(-0.34, 0.24, t),
        lerp(0.38, -0.44, t),
      ],
    });
  }

  if (phase === 'recover') {
    const t = easeOutCubic(pct);
    return toThirdPersonHandPose({
      position: [
        lerp(0.12, 0.48, t),
        lerp(0.48, 1.08, t) - 0.64,
        lerp(-1.04, -0.48, t),
      ],
      rotation: [
        lerp(1.25, 0.2, t),
        lerp(0.24, 0.1, t),
        lerp(-0.44, -0.15, t),
      ],
    });
  }

  if (phase === 'melee_swing') {
    const isWindup = pct < 0.35;
    const localPct = isWindup ? easeOutCubic(pct / 0.35) : easeInOutCubic((pct - 0.35) / 0.65);
    if (isWindup) {
      return toThirdPersonHandPose({
        position: [
          lerp(0.48, 0.66, localPct),
          lerp(1.08, 0.84, localPct) - 0.64,
          lerp(-0.48, -0.25, localPct),
        ],
        rotation: [
          lerp(0.2, 0.32, localPct),
          lerp(0.1, 0.48, localPct),
          lerp(-0.15, 0.28, localPct),
        ],
      });
    }
    return toThirdPersonHandPose({
      position: [
        lerp(0.66, 0.08, localPct),
        lerp(0.84, 1.24, localPct) - 0.64,
        lerp(-0.25, -0.9, localPct),
      ],
      rotation: [
        lerp(0.32, 0.62, localPct),
        lerp(0.48, -1.08, localPct),
        lerp(0.28, -0.68, localPct),
      ],
    });
  }

  const t = easeOutCubic(pct);
  return toThirdPersonHandPose({
    position: [
      lerp(0.08, 0.48, t),
      lerp(1.24, 1.08, t) - 0.64,
      lerp(-0.9, -0.48, t),
    ],
    rotation: [
      lerp(0.62, 0.2, t),
      lerp(-1.08, 0.1, t),
      lerp(-0.68, -0.15, t),
    ],
  });
}

export function getThirdPersonSwordLungePose(lungeTimer: number): WeaponPose {
  const settle = easeOutCubic(Math.min(lungeTimer / 0.18, 1));
  const shimmer = Math.sin(lungeTimer * 24) * 0.04;
  return toThirdPersonHandPose({
    position: [
      shimmer * 0.4,
      lerp(1.2, 1.28, settle) - 0.64,
      lerp(-0.75, -0.92, settle),
    ],
    rotation: [
      Math.PI / 2 + lerp(0.15, 0.34, settle),
      shimmer,
      -shimmer,
    ],
  });
}

export function getThirdPersonSwordSlashPose(
  phase: Extract<SwordAttackPhase, 'slash' | 'recover'>,
  progress: number
): WeaponPose {
  const pct = clamp01(progress);
  if (phase === 'slash') {
    const t = easeInOutCubic(pct);
    const arc = Math.sin(pct * Math.PI);
    return toThirdPersonHandPose({
      position: [
        lerp(0.68, 0.14, t),
        lerp(1.24, 0.86, t) - 0.64 + arc * 0.14,
        lerp(-0.1, -0.84, t),
      ],
      rotation: [
        Math.PI / 2 + arc * 0.12,
        lerp(0.7, -1.0, t),
        lerp(Math.PI / 3, -Math.PI / 2.7, t),
      ],
    });
  }

  const t = easeOutCubic(pct);
  return toThirdPersonHandPose({
    position: [
      lerp(0.14, 0.48, t),
      lerp(0.86, 1.08, t) - 0.64,
      lerp(-0.84, -0.32, t),
    ],
    rotation: [
      Math.PI / 2,
      lerp(-1.0, 0, t),
      lerp(-Math.PI / 2.7, -Math.PI / 8, t),
    ],
  });
}

export function getThirdPersonCombatantArmPose({
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging,
  settings,
}: {
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  settings: Partial<UniversalSettings>;
}): CombatantArmPose {
  const hammerReady: CombatantArmPose = {
    rightArmRotation: [0.18, -0.22, -0.34],
    leftArmRotation: [0.12, 0.2, 0.34],
  };
  const swordReady: CombatantArmPose = {
    rightArmRotation: [0.32, -0.14, -0.22],
    leftArmRotation: [-0.04, 0.04, 0.18],
  };
  const idle: CombatantArmPose = {
    rightArmRotation: [0, 0, 0],
    leftArmRotation: [0, 0, 0],
  };

  if (activeWeapon === 'hammer') {
    if (weaponState === 'swing_up') {
      const pct = easeOutCubic(weaponTimer / 0.28);
      return {
        rightArmRotation: lerpRotation(hammerReady.rightArmRotation, [-1.15, -0.48, -0.56], pct),
        leftArmRotation: lerpRotation(hammerReady.leftArmRotation, [-0.78, 0.34, 0.5], pct),
      };
    }

    if (weaponState === 'swing_down') {
      const pct = easeInCubic(weaponTimer / 0.12);
      return {
        rightArmRotation: lerpRotation([-1.15, -0.48, -0.56], [1.05, 0.18, -0.24], pct),
        leftArmRotation: lerpRotation([-0.78, 0.34, 0.5], [0.62, -0.08, 0.28], pct),
      };
    }

    if (weaponState === 'recovering') {
      const pct = easeOutCubic(weaponTimer / (settings.hammerReloadTime ?? 0.6));
      return {
        rightArmRotation: lerpRotation([1.05, 0.18, -0.24], hammerReady.rightArmRotation, pct),
        leftArmRotation: lerpRotation([0.62, -0.08, 0.28], hammerReady.leftArmRotation, pct),
      };
    }

    if (weaponState === 'melee_up' || weaponState === 'melee_swing' || weaponState === 'melee_down') {
      const meleeSpeed = settings.hammerMeleeSpeed ?? 0.24;
      const progress = weaponState === 'melee_down'
        ? Math.min(1, 0.4 + (weaponTimer / Math.max(meleeSpeed * 0.6, 0.001)) * 0.6)
        : Math.min(1, weaponTimer / Math.max(meleeSpeed, 0.001));
      const windup = progress < 0.35;
      const windupPct = easeOutCubic(progress / 0.35);
      const strikePct = easeInOutCubic((progress - 0.35) / 0.65);
      return {
        rightArmRotation: windup
          ? lerpRotation(hammerReady.rightArmRotation, [0.38, 0.42, -0.42], windupPct)
          : lerpRotation([0.38, 0.42, -0.42], [0.72, -1.08, -0.18], strikePct),
        leftArmRotation: windup
          ? lerpRotation(hammerReady.leftArmRotation, [0.24, -0.18, 0.44], windupPct)
          : lerpRotation([0.24, -0.18, 0.44], [0.46, 0.7, 0.14], strikePct),
      };
    }

    if (weaponState === 'melee_recover') {
      const pct = easeOutCubic(weaponTimer / (settings.hammerMeleeReload ?? 0.5));
      return {
        rightArmRotation: lerpRotation([0.72, -1.08, -0.18], hammerReady.rightArmRotation, pct),
        leftArmRotation: lerpRotation([0.46, 0.7, 0.14], hammerReady.leftArmRotation, pct),
      };
    }

    return hammerReady;
  }

  if (activeWeapon === 'sword') {
    if (isLunging) {
      const pulse = Math.sin(Math.min(weaponTimer, 0.18) * Math.PI * 5) * 0.06;
      return {
        rightArmRotation: [1.34, pulse, -0.18],
        leftArmRotation: [-0.24, 0.22, 0.38],
      };
    }

    if (weaponState === 'swing_up') {
      const windup = Math.max((settings.swordSlashSpeed ?? 0.22) * 0.5, 0.001);
      const pct = easeOutCubic(weaponTimer / windup);
      return {
        rightArmRotation: lerpRotation(swordReady.rightArmRotation, [0.58, 0.72, -0.28], pct),
        leftArmRotation: lerpRotation(swordReady.leftArmRotation, [0.08, -0.26, 0.28], pct),
      };
    }

    if (weaponState === 'swing_down' || weaponState === 'slashing') {
      const slash = settings.swordSlashSpeed ?? 0.22;
      const progress = weaponState === 'swing_down'
        ? 0.5 + Math.min(1, weaponTimer / Math.max(slash * 0.5, 0.001)) * 0.5
        : Math.min(1, weaponTimer / Math.max(slash, 0.001));
      const pct = easeInOutCubic(progress);
      return {
        rightArmRotation: lerpRotation([0.58, 0.72, -0.28], [0.9, -0.9, -0.22], pct),
        leftArmRotation: lerpRotation([0.08, -0.26, 0.28], [-0.08, 0.34, 0.24], pct),
      };
    }

    if (weaponState === 'recovering') {
      const pct = easeOutCubic(weaponTimer / (settings.swordSlashReload ?? 0.6));
      return {
        rightArmRotation: lerpRotation([0.9, -0.9, -0.22], swordReady.rightArmRotation, pct),
        leftArmRotation: lerpRotation([-0.08, 0.34, 0.24], swordReady.leftArmRotation, pct),
      };
    }

    return swordReady;
  }

  return idle;
}

export function applyWeaponPose(group: THREE.Group, pose: WeaponPose): void {
  group.position.set(...pose.position);
  group.rotation.set(...pose.rotation);
}
