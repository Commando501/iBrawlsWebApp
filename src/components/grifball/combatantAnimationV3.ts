import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { UniversalSettings } from '../../types';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { normalizeV3QualityTier } from '../v3/v3QualityTiers';
import type { WeaponPose } from './attackAnimationPresets';
import { consumeV3AnimationThrottle } from './v3AnimationThrottle';
import type { GrifballThreeRefs } from './threeRefs';

export type V3AnimationLayerName = 'locomotion' | 'weapon' | 'additive' | 'death';
export type V3BroadBodyGroupName =
  | 'lowerTorso'
  | 'upperTorso'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg';

export interface V3CombatantAnimationInput {
  refs: GrifballThreeRefs;
  mesh: THREE.Group | null | undefined;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  activeWeapon?: string;
  weaponState: string;
  weaponTimer: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
  hammerSlamWindupTime?: number;
  hammerSlamAttackTime?: number;
  settings?: Partial<UniversalSettings>;
  v3QualityTier?: V3QualityTier;
  isLocalV3Animation?: boolean;
  animationClockMs?: number;
}

export interface V3FirstPersonWeaponPoseInput {
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  weaponState: string;
  weaponTimer: number;
  isLunging?: boolean;
  settings?: Partial<UniversalSettings>;
}

export interface V3WeaponMeshAnimationInput {
  hammerModel?: THREE.Group | null;
  swordModel?: THREE.Group | null;
  pistolModel?: THREE.Group | null;
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  dt: number;
  settings: Partial<UniversalSettings>;
}

type V3BroadGroups = Record<V3BroadBodyGroupName, THREE.Group>;

const V3_BODY_MASKS: Record<V3AnimationLayerName, readonly V3BroadBodyGroupName[]> = {
  locomotion: ['lowerTorso', 'leftLeg', 'rightLeg'],
  weapon: ['upperTorso', 'head', 'leftArm', 'rightArm'],
  additive: ['upperTorso', 'head'],
  death: ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'],
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number): number => {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
};
const easeInOutCubic = (value: number): number => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const setRotation = (group: THREE.Group, rotation: THREE.Vector3Tuple): void => {
  group.rotation.set(rotation[0], rotation[1], rotation[2]);
};

const setWeaponMeshPose = (group: THREE.Group, pose: WeaponPose): void => {
  group.position.set(...pose.position);
  group.rotation.set(...pose.rotation);
};

const lerpRotation = (
  group: THREE.Group,
  target: THREE.Vector3Tuple,
  alpha: number
): void => {
  group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, target[0], alpha);
  group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, target[1], alpha);
  group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, target[2], alpha);
};

const getV3BroadGroups = (mesh: THREE.Group): V3BroadGroups | undefined => {
  const groups = Object.fromEntries(
    V3_BODY_MASKS.death.map((name) => [name, mesh.userData[name]])
  ) as Partial<V3BroadGroups>;

  return V3_BODY_MASKS.death.every((name) => groups[name] instanceof THREE.Group)
    ? groups as V3BroadGroups
    : undefined;
};

export function getV3BodyMaskForLayer(layer: V3AnimationLayerName): readonly V3BroadBodyGroupName[] {
  return V3_BODY_MASKS[layer];
}

const resetV3BroadGroups = (groups: V3BroadGroups): void => {
  for (const name of V3_BODY_MASKS.death) {
    setRotation(groups[name], [0, 0, 0]);
  }
  groups.lowerTorso.position.y = 0;
};

const applyV3LocomotionLayer = ({
  groups,
  mesh,
  vel,
  yaw,
  dt,
  isSliding,
  isSprinting,
}: {
  groups: V3BroadGroups;
  mesh: THREE.Group;
  vel: THREE.Vector3;
  yaw: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
}): void => {
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const alpha = dt > 0 ? Math.min(1, dt * 10) : 1;

  if (isSliding) {
    groups.lowerTorso.position.y = THREE.MathUtils.lerp(groups.lowerTorso.position.y, -0.18, alpha);
    lerpRotation(groups.lowerTorso, [-0.24, groups.lowerTorso.rotation.y, 0], alpha);
    lerpRotation(groups.leftLeg, [-1.05, 0, -0.14], alpha);
    lerpRotation(groups.rightLeg, [-0.58, 0, 0.14], alpha);
    return;
  }

  if (speed > 0.15) {
    const strideScale = isSprinting ? 1.25 : 1;
    const frequency = (isSprinting ? 6.8 : 4.4) * Math.max(0.35, speed / 4);
    const nextPhase = Number(mesh.userData.v3WalkPhase ?? 0) + dt * frequency;
    mesh.userData.v3WalkPhase = nextPhase;

    const phase = nextPhase;
    const swing = (isSprinting ? 0.72 : 0.5) * strideScale;
    const side = isSprinting ? 0.08 : 0.05;
    groups.leftLeg.rotation.x = Math.sin(phase) * swing;
    groups.rightLeg.rotation.x = -Math.sin(phase) * swing;
    groups.leftLeg.rotation.z = Math.cos(phase) * side;
    groups.rightLeg.rotation.z = -Math.cos(phase) * side;
    groups.lowerTorso.position.y = -Math.abs(Math.sin(phase)) * (isSprinting ? 0.06 : 0.04);
    groups.lowerTorso.rotation.x = THREE.MathUtils.lerp(groups.lowerTorso.rotation.x, isSprinting ? 0.16 : 0, alpha);
  } else {
    mesh.userData.v3WalkPhase = 0;
    groups.lowerTorso.position.y = THREE.MathUtils.lerp(groups.lowerTorso.position.y, 0, alpha);
    groups.lowerTorso.rotation.x = THREE.MathUtils.lerp(groups.lowerTorso.rotation.x, 0, alpha);
    lerpRotation(groups.leftLeg, [0, 0, 0], alpha);
    lerpRotation(groups.rightLeg, [0, 0, 0], alpha);
  }

  let targetYaw = 0;
  if (speed > 0.15) {
    const moveYaw = getYawForHeading(vel.x, vel.z);
    const diff = Math.atan2(Math.sin(moveYaw - yaw), Math.cos(moveYaw - yaw));
    targetYaw = THREE.MathUtils.clamp(diff, -Math.PI / 3, Math.PI / 3);
  }
  groups.lowerTorso.rotation.y = THREE.MathUtils.lerp(groups.lowerTorso.rotation.y, targetYaw, alpha);
};

const applyV3HammerLayer = ({
  groups,
  weaponState,
  weaponTimer,
  hammerSlamWindupTime = DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  hammerSlamAttackTime = DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  settings,
  alpha,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  hammerSlamWindupTime?: number;
  hammerSlamAttackTime?: number;
  settings: Partial<UniversalSettings>;
  alpha: number;
}): void => {
  const timing = resolveHammerSlamTiming({
    ...settings,
    hammerSlamWindupTime,
    hammerSlamAttackTime,
  });

  if (weaponState === 'swing_up') {
    const pct = easeOutCubic(weaponTimer / timing.windupTime);
    lerpRotation(groups.upperTorso, [-0.12, THREE.MathUtils.lerp(0, -0.34, pct), 0.08], alpha);
    lerpRotation(groups.rightArm, [THREE.MathUtils.lerp(-0.24, -1.35, pct), 0.16, -0.24], alpha);
    lerpRotation(groups.leftArm, [THREE.MathUtils.lerp(-0.18, -0.88, pct), -0.18, 0.26], alpha);
    return;
  }

  if (weaponState === 'swing_down') {
    const pct = easeInOutCubic(weaponTimer / timing.attackTime);
    lerpRotation(groups.upperTorso, [THREE.MathUtils.lerp(-0.12, 0.24, pct), 0.42, -0.12], alpha);
    lerpRotation(groups.rightArm, [THREE.MathUtils.lerp(-1.35, -0.08, pct), -0.12, 0.14], alpha);
    lerpRotation(groups.leftArm, [THREE.MathUtils.lerp(-0.88, -0.08, pct), 0.12, -0.14], alpha);
    return;
  }

  if (weaponState === 'melee_swing' || weaponState === 'melee_up') {
    lerpRotation(groups.upperTorso, [0.04, 0.5, 0.12], alpha);
    lerpRotation(groups.rightArm, [-0.34, -0.2, -0.48], alpha);
    lerpRotation(groups.leftArm, [-0.22, 0.18, 0.32], alpha);
    return;
  }

  if (weaponState === 'recovering' || weaponState === 'melee_recover' || weaponState === 'melee_down') {
    const pct = clamp01(weaponTimer / 0.6);
    lerpRotation(groups.upperTorso, [0, THREE.MathUtils.lerp(0.32, 0, pct), 0], alpha);
    lerpRotation(groups.rightArm, [THREE.MathUtils.lerp(-0.42, -0.12, pct), 0, 0], alpha);
    lerpRotation(groups.leftArm, [THREE.MathUtils.lerp(-0.28, -0.12, pct), 0, 0], alpha);
  }
};

const applyV3SwordLayer = ({
  groups,
  weaponState,
  weaponTimer,
  isLunging,
  alpha,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  isLunging?: boolean;
  alpha: number;
}): void => {
  if (isLunging) {
    const pct = easeOutCubic(Math.min(weaponTimer / 0.18, 1));
    lerpRotation(groups.upperTorso, [0.18, 0, THREE.MathUtils.lerp(0, -0.12, pct)], alpha);
    lerpRotation(groups.rightArm, [-0.72, 0.04, -0.04], alpha);
    lerpRotation(groups.leftArm, [-0.24, -0.24, 0.18], alpha);
    return;
  }

  if (weaponState === 'swing_up' || weaponState === 'slashing' || weaponState === 'swing_down') {
    const pct = easeInOutCubic(Math.min(weaponTimer / 0.22, 1));
    lerpRotation(groups.upperTorso, [0.04, THREE.MathUtils.lerp(-0.32, 0.34, pct), 0.08], alpha);
    lerpRotation(groups.rightArm, [-0.64, THREE.MathUtils.lerp(-0.28, 0.32, pct), -0.12], alpha);
    lerpRotation(groups.leftArm, [-0.18, -0.16, 0.2], alpha);
  }
};

const applyV3PistolLayer = ({
  groups,
  weaponState,
  weaponTimer,
  alpha,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  alpha: number;
}): void => {
  const isFiring = weaponState === 'firing' || weaponState === 'fire' || weaponState === 'shooting';
  const recoil = isFiring ? 1 - clamp01(weaponTimer / 0.18) : 0;
  lerpRotation(groups.upperTorso, [-0.04 - recoil * 0.12, 0.08, 0], alpha);
  lerpRotation(groups.rightArm, [-0.42 - recoil * 0.36, 0.04, -0.08], alpha);
  lerpRotation(groups.leftArm, [-0.16, -0.12, 0.12], alpha);
};

const settleV3UpperBody = (groups: V3BroadGroups, alpha: number, breathingPhase: number): void => {
  const breathe = Math.sin(breathingPhase) * 0.018;
  lerpRotation(groups.upperTorso, [breathe, 0, 0], alpha);
  lerpRotation(groups.head, [-breathe * 0.5, 0, 0], alpha);
  lerpRotation(groups.leftArm, [-0.12, 0, 0.08], alpha);
  lerpRotation(groups.rightArm, [-0.12, 0, -0.08], alpha);
};

export function animateV3CombatantModel({
  refs: _refs,
  mesh,
  vel,
  yaw,
  hp,
  activeWeapon = 'hammer',
  weaponState,
  weaponTimer,
  dt,
  isSliding = false,
  isSprinting = false,
  isLunging = false,
  hammerSlamWindupTime,
  hammerSlamAttackTime,
  settings = {},
  v3QualityTier,
  isLocalV3Animation = false,
  animationClockMs,
}: V3CombatantAnimationInput): boolean {
  if (!mesh) return false;
  const groups = getV3BroadGroups(mesh);
  if (!groups) return false;
  const fallbackNowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const throttle = consumeV3AnimationThrottle({
    mesh,
    qualityTier: normalizeV3QualityTier(v3QualityTier),
    isLocal: isLocalV3Animation,
    nowMs: Number.isFinite(animationClockMs) ? animationClockMs ?? 0 : fallbackNowMs,
    dt,
  });
  if (!throttle.shouldAnimate) return false;
  dt = throttle.dt;

  if (hp <= 0) {
    resetV3BroadGroups(groups);
    return true;
  }

  const alpha = dt > 0 ? Math.min(1, dt * 12) : 1;
  applyV3LocomotionLayer({ groups, mesh, vel, yaw, dt, isSliding, isSprinting });

  const breathingPhase = Number(mesh.userData.v3BreathingPhase ?? 0) + dt * 2.1;
  mesh.userData.v3BreathingPhase = breathingPhase;
  settleV3UpperBody(groups, alpha, breathingPhase);

  if (activeWeapon === 'sword') {
    applyV3SwordLayer({ groups, weaponState, weaponTimer, isLunging, alpha });
  } else if (activeWeapon === 'pistol') {
    applyV3PistolLayer({ groups, weaponState, weaponTimer, alpha });
  } else {
    applyV3HammerLayer({
      groups,
      weaponState,
      weaponTimer,
      hammerSlamWindupTime,
      hammerSlamAttackTime,
      settings,
      alpha,
    });
  }
  return true;
}

export function getFirstPersonV3WeaponPose({
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging = false,
  settings = {},
}: V3FirstPersonWeaponPoseInput): WeaponPose {
  if (activeWeapon === 'sword') {
    const lunge = isLunging ? easeOutCubic(Math.min(weaponTimer / 0.18, 1)) : 0;
    const slash = weaponState === 'slashing' || weaponState === 'swing_down'
      ? easeInOutCubic(Math.min(weaponTimer / 0.22, 1))
      : 0;
    return {
      position: [0.28 + slash * 0.16, -0.3 + lunge * 0.08, -0.58 - lunge * 0.24],
      rotation: [-Math.PI / 2 - lunge * 0.24, slash * 0.62, -Math.PI / 8 - slash * 0.5],
    };
  }

  if (activeWeapon === 'pistol') {
    const isFiring = weaponState === 'firing' || weaponState === 'fire' || weaponState === 'shooting';
    const recoil = isFiring ? 1 - clamp01(weaponTimer / 0.18) : 0;
    return {
      position: [0.24, -0.26 + recoil * 0.02, -0.4 + recoil * 0.08],
      rotation: [-recoil * 0.18, 0.02, 0],
    };
  }

  const timing = resolveHammerSlamTiming(settings);
  const windup = weaponState === 'swing_up'
    ? easeOutCubic(weaponTimer / timing.windupTime)
    : 0;
  const strike = weaponState === 'swing_down'
    ? easeInOutCubic(weaponTimer / timing.attackTime)
    : 0;
  return {
    position: [0.35 + windup * 0.2 - strike * 0.42, -0.38 + windup * 0.28 - strike * 0.16, -0.65 + windup * 0.26 - strike * 0.42],
    rotation: [0.15 - windup * 1.5 + strike * 2.3, -0.3 - windup * 0.32 + strike * 0.52, -0.15 + windup * 0.42 - strike * 0.72],
  };
}

export function animateV3WeaponMeshes({
  hammerModel,
  swordModel,
  pistolModel,
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging,
  dt: _dt,
  settings,
}: V3WeaponMeshAnimationInput): void {
  if (hammerModel) hammerModel.visible = activeWeapon === 'hammer';
  if (swordModel) swordModel.visible = activeWeapon === 'sword';
  if (pistolModel) pistolModel.visible = activeWeapon === 'pistol';

  if (hammerModel?.userData.modelSystem === 'v3' && activeWeapon === 'hammer') {
    const timing = resolveHammerSlamTiming(settings);
    if (weaponState === 'swing_up') {
      const pct = easeOutCubic(weaponTimer / timing.windupTime);
      setWeaponMeshPose(hammerModel, {
        position: [THREE.MathUtils.lerp(0.04, -0.02, pct), THREE.MathUtils.lerp(-0.02, 0.16, pct), THREE.MathUtils.lerp(-0.08, -0.02, pct)],
        rotation: [THREE.MathUtils.lerp(0.28, -1.22, pct), 0.08, THREE.MathUtils.lerp(-0.12, -0.32, pct)],
      });
      return;
    }

    if (weaponState === 'swing_down') {
      const pct = easeInOutCubic(weaponTimer / timing.attackTime);
      setWeaponMeshPose(hammerModel, {
        position: [THREE.MathUtils.lerp(-0.02, -0.12, pct), THREE.MathUtils.lerp(0.16, -0.1, pct), THREE.MathUtils.lerp(-0.02, -0.24, pct)],
        rotation: [THREE.MathUtils.lerp(-1.22, 1.08, pct), 0.08, THREE.MathUtils.lerp(-0.32, -0.04, pct)],
      });
      return;
    }

    if (weaponState === 'recovering') {
      const pct = easeOutCubic(weaponTimer / (settings.hammerReloadTime ?? 0.6));
      setWeaponMeshPose(hammerModel, {
        position: [THREE.MathUtils.lerp(-0.12, 0.04, pct), THREE.MathUtils.lerp(-0.1, -0.02, pct), THREE.MathUtils.lerp(-0.24, -0.08, pct)],
        rotation: [THREE.MathUtils.lerp(1.08, 0.28, pct), 0.08, THREE.MathUtils.lerp(-0.04, -0.12, pct)],
      });
      return;
    }

    if (weaponState === 'melee_up' || weaponState === 'melee_swing' || weaponState === 'melee_down') {
      const meleeSpeed = Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001);
      const pct = easeInOutCubic(Math.min(1, weaponTimer / meleeSpeed));
      setWeaponMeshPose(hammerModel, {
        position: [THREE.MathUtils.lerp(0.05, -0.18, pct), THREE.MathUtils.lerp(-0.04, 0.08, pct), THREE.MathUtils.lerp(-0.1, -0.26, pct)],
        rotation: [THREE.MathUtils.lerp(0.32, 0.72, pct), THREE.MathUtils.lerp(0.12, -0.78, pct), THREE.MathUtils.lerp(-0.16, -0.46, pct)],
      });
      return;
    }

    if (weaponState === 'melee_recover') {
      const pct = easeOutCubic(weaponTimer / (settings.hammerMeleeReload ?? 0.5));
      setWeaponMeshPose(hammerModel, {
        position: [THREE.MathUtils.lerp(-0.18, 0.04, pct), THREE.MathUtils.lerp(0.08, -0.02, pct), THREE.MathUtils.lerp(-0.26, -0.08, pct)],
        rotation: [THREE.MathUtils.lerp(0.72, 0.28, pct), THREE.MathUtils.lerp(-0.78, 0.08, pct), THREE.MathUtils.lerp(-0.46, -0.12, pct)],
      });
      return;
    }

    setWeaponMeshPose(hammerModel, {
      position: [0.04, -0.02, -0.08],
      rotation: [0.28, 0.08, -0.12],
    });
  }

  if (swordModel?.userData.modelSystem === 'v3' && activeWeapon === 'sword') {
    if (isLunging) {
      const pct = easeOutCubic(Math.min(weaponTimer / 0.18, 1));
      setWeaponMeshPose(swordModel, {
        position: [0.02 + pct * 0.04, -0.02, -0.18 - pct * 0.18],
        rotation: [-Math.PI / 2 - pct * 0.24, 0.02, -Math.PI / 8],
      });
      return;
    }

    if (weaponState === 'swing_up' || weaponState === 'slashing' || weaponState === 'swing_down') {
      const slash = Math.max(settings.swordSlashSpeed ?? 0.22, 0.001);
      const pct = easeInOutCubic(Math.min(weaponTimer / slash, 1));
      setWeaponMeshPose(swordModel, {
        position: [THREE.MathUtils.lerp(0.04, -0.12, pct), THREE.MathUtils.lerp(-0.02, 0.08, pct), THREE.MathUtils.lerp(-0.1, -0.22, pct)],
        rotation: [-Math.PI / 2, THREE.MathUtils.lerp(-0.42, 0.64, pct), THREE.MathUtils.lerp(-Math.PI / 8, -0.72, pct)],
      });
      return;
    }

    if (weaponState === 'recovering') {
      const pct = easeOutCubic(weaponTimer / (settings.swordSlashReload ?? 0.6));
      setWeaponMeshPose(swordModel, {
        position: [THREE.MathUtils.lerp(-0.12, 0.04, pct), THREE.MathUtils.lerp(0.08, -0.02, pct), THREE.MathUtils.lerp(-0.22, -0.1, pct)],
        rotation: [-Math.PI / 2, THREE.MathUtils.lerp(0.64, -0.42, pct), THREE.MathUtils.lerp(-0.72, -Math.PI / 8, pct)],
      });
      return;
    }

    setWeaponMeshPose(swordModel, {
      position: [0.04, -0.02, -0.1],
      rotation: [-Math.PI / 2, -0.42, -Math.PI / 8],
    });
  }

  if (pistolModel?.userData.modelSystem === 'v3' && activeWeapon === 'pistol') {
    const isFiring = weaponState === 'firing' || weaponState === 'fire' || weaponState === 'shooting';
    const recoil = isFiring ? 1 - clamp01(weaponTimer / 0.18) : 0;
    setWeaponMeshPose(pistolModel, {
      position: [0.08, -0.04 + recoil * 0.02, -0.18 + recoil * 0.1],
      rotation: [-0.04 - recoil * 0.28, 0.02, -0.06],
    });
  }
}
