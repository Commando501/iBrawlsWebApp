import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import type { UniversalSettings } from '../../types';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { normalizeV3QualityTier } from '../v3/v3QualityTiers';
import type { WeaponPose } from './attackAnimationPresets';
import { consumeV3AnimationThrottle } from './v3AnimationThrottle';
import type { GrifballThreeRefs } from './threeRefs';
import {
  clamp01,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
} from './v3AnimationFidelity';

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
  lookYawOffset?: number;
  lookPitch?: number;
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

const setRotation = (group: THREE.Group, rotation: THREE.Vector3Tuple): void => {
  group.rotation.set(rotation[0], rotation[1], rotation[2]);
};

const setWeaponMeshPose = (group: THREE.Group, pose: WeaponPose): void => {
  group.position.set(...pose.position);
  group.rotation.set(...pose.rotation);
};

const applyV3FirstPersonWeaponSway = (
  group: THREE.Group,
  weaponState: string,
  dt: number
): void => {
  const nextPhase = Number(group.userData.v3FirstPersonSwayPhase ?? 0) + Math.max(0, dt) * 1.8;
  group.userData.v3FirstPersonSwayPhase = nextPhase;
  const isReady = weaponState === 'ready';
  const swayScale = isReady ? 1 : 0.35;

  group.position.x += Math.cos(nextPhase * 0.7) * 0.006 * swayScale;
  group.position.y += Math.sin(nextPhase) * 0.012 * swayScale;
  group.rotation.z += Math.sin(nextPhase * 0.8) * 0.012 * swayScale;
};

const applyV3WeaponMeshPose = (
  group: THREE.Group,
  pose: WeaponPose,
  weaponState: string,
  dt: number
): void => {
  setWeaponMeshPose(group, pose);
  if (group.userData.v3View === 'firstPerson') {
    applyV3FirstPersonWeaponSway(group, weaponState, dt);
  }
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

const applyV3UpperBodyPose = (
  groups: V3BroadGroups,
  pose: ReturnType<typeof sampleV3UpperBodyWeaponPose>,
  alpha: number
): void => {
  lerpRotation(groups.upperTorso, pose.upperTorsoRotation, alpha);
  lerpRotation(groups.head, pose.headRotation, alpha);
  lerpRotation(groups.leftArm, pose.leftArmRotation, alpha);
  lerpRotation(groups.rightArm, pose.rightArmRotation, alpha);
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
  hammerSlamWindupTime,
  hammerSlamAttackTime,
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
  applyV3UpperBodyPose(groups, sampleV3UpperBodyWeaponPose({
    activeWeapon: 'hammer',
    weaponState,
    weaponTimer,
    isLunging: false,
    settings: {
      ...settings,
      hammerSlamWindupTime,
      hammerSlamAttackTime,
    },
  }), alpha);
};

const applyV3SwordLayer = ({
  groups,
  weaponState,
  weaponTimer,
  isLunging,
  settings,
  alpha,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  isLunging?: boolean;
  settings: Partial<UniversalSettings>;
  alpha: number;
}): void => {
  applyV3UpperBodyPose(groups, sampleV3UpperBodyWeaponPose({
    activeWeapon: 'sword',
    weaponState,
    weaponTimer,
    isLunging: Boolean(isLunging),
    settings,
  }), alpha);
};

const applyV3PistolLayer = ({
  groups,
  weaponState,
  weaponTimer,
  settings,
  alpha,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  settings: Partial<UniversalSettings>;
  alpha: number;
}): void => {
  applyV3UpperBodyPose(groups, sampleV3UpperBodyWeaponPose({
    activeWeapon: 'pistol',
    weaponState,
    weaponTimer,
    isLunging: false,
    settings,
  }), alpha);
};

const settleV3UpperBody = (groups: V3BroadGroups, alpha: number, breathingPhase: number): void => {
  const breathe = Math.sin(breathingPhase) * 0.018;
  lerpRotation(groups.upperTorso, [breathe, 0, 0], alpha);
  lerpRotation(groups.head, [-breathe * 0.5, 0, 0], alpha);
  lerpRotation(groups.leftArm, [-0.12, 0, 0.08], alpha);
  lerpRotation(groups.rightArm, [-0.12, 0, -0.08], alpha);
};

const applyV3AdditiveLayer = ({
  groups,
  alpha,
  hitReactTimer,
  lookYawOffset = 0,
  lookPitch = 0,
}: {
  groups: V3BroadGroups;
  alpha: number;
  hitReactTimer: number;
  lookYawOffset?: number;
  lookPitch?: number;
}): void => {
  const hit = clamp01(hitReactTimer / 0.18);
  const safeLookYaw = THREE.MathUtils.clamp(lookYawOffset, -0.65, 0.65);
  const safeLookPitch = THREE.MathUtils.clamp(lookPitch, -0.45, 0.45);

  if (hit > 0) {
    lerpRotation(groups.upperTorso, [
      groups.upperTorso.rotation.x - hit * 0.05,
      groups.upperTorso.rotation.y,
      groups.upperTorso.rotation.z + hit * 0.16,
    ], alpha);
    lerpRotation(groups.head, [
      groups.head.rotation.x - hit * 0.08,
      groups.head.rotation.y - hit * 0.04,
      groups.head.rotation.z + hit * 0.05,
    ], alpha);
    lerpRotation(groups.leftArm, [
      groups.leftArm.rotation.x - hit * 0.1,
      groups.leftArm.rotation.y,
      groups.leftArm.rotation.z + hit * 0.05,
    ], alpha);
    lerpRotation(groups.rightArm, [
      groups.rightArm.rotation.x - hit * 0.08,
      groups.rightArm.rotation.y,
      groups.rightArm.rotation.z - hit * 0.05,
    ], alpha);
  }

  if (safeLookYaw !== 0 || safeLookPitch !== 0) {
    lerpRotation(groups.upperTorso, [
      groups.upperTorso.rotation.x + safeLookPitch * 0.15,
      groups.upperTorso.rotation.y + safeLookYaw * 0.25,
      groups.upperTorso.rotation.z,
    ], alpha);
    lerpRotation(groups.head, [
      groups.head.rotation.x + safeLookPitch * 0.75,
      groups.head.rotation.y + safeLookYaw * 0.75,
      groups.head.rotation.z,
    ], alpha);
  }
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
  lookYawOffset = 0,
  lookPitch = 0,
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

  const previousHp = Number.isFinite(mesh.userData.v3LastHp)
    ? Number(mesh.userData.v3LastHp)
    : hp;

  if (hp <= 0) {
    mesh.userData.v3LastHp = hp;
    mesh.userData.v3HitReactTimer = 0;
    resetV3BroadGroups(groups);
    return true;
  }

  if (hp < previousHp) {
    mesh.userData.v3HitReactTimer = 0.18;
  }
  mesh.userData.v3LastHp = hp;

  const alpha = dt > 0 ? Math.min(1, dt * 12) : 1;
  applyV3LocomotionLayer({ groups, mesh, vel, yaw, dt, isSliding, isSprinting });

  const breathingPhase = Number(mesh.userData.v3BreathingPhase ?? 0) + dt * 2.1;
  mesh.userData.v3BreathingPhase = breathingPhase;
  settleV3UpperBody(groups, alpha, breathingPhase);

  if (activeWeapon === 'sword') {
    applyV3SwordLayer({ groups, weaponState, weaponTimer, isLunging, settings, alpha });
  } else if (activeWeapon === 'pistol') {
    applyV3PistolLayer({ groups, weaponState, weaponTimer, settings, alpha });
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

  const hitReactTimer = Math.max(0, Number(mesh.userData.v3HitReactTimer ?? 0));
  applyV3AdditiveLayer({
    groups,
    alpha,
    hitReactTimer,
    lookYawOffset,
    lookPitch,
  });
  mesh.userData.v3HitReactTimer = Math.max(0, hitReactTimer - dt);

  return true;
}

export function getFirstPersonV3WeaponPose({
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging = false,
  settings = {},
}: V3FirstPersonWeaponPoseInput): WeaponPose {
  return sampleV3FirstPersonWeaponPose({
    activeWeapon,
    weaponState,
    weaponTimer,
    isLunging,
    settings,
  });
}

export function animateV3WeaponMeshes({
  hammerModel,
  swordModel,
  pistolModel,
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging,
  dt,
  settings,
}: V3WeaponMeshAnimationInput): void {
  if (hammerModel) hammerModel.visible = activeWeapon === 'hammer';
  if (swordModel) swordModel.visible = activeWeapon === 'sword';
  if (pistolModel) pistolModel.visible = activeWeapon === 'pistol';

  if (hammerModel?.userData.modelSystem === 'v3' && activeWeapon === 'hammer') {
    const sample = hammerModel.userData.v3View === 'firstPerson'
      ? sampleV3FirstPersonWeaponPose
      : sampleV3ThirdPersonWeaponPose;
    applyV3WeaponMeshPose(hammerModel, sample({
      activeWeapon: 'hammer',
      weaponState,
      weaponTimer,
      isLunging,
      settings,
    }), weaponState, dt);
  }

  if (swordModel?.userData.modelSystem === 'v3' && activeWeapon === 'sword') {
    const sample = swordModel.userData.v3View === 'firstPerson'
      ? sampleV3FirstPersonWeaponPose
      : sampleV3ThirdPersonWeaponPose;
    applyV3WeaponMeshPose(swordModel, sample({
      activeWeapon: 'sword',
      weaponState,
      weaponTimer,
      isLunging,
      settings,
    }), weaponState, dt);
  }

  if (pistolModel?.userData.modelSystem === 'v3' && activeWeapon === 'pistol') {
    const sample = pistolModel.userData.v3View === 'firstPerson'
      ? sampleV3FirstPersonWeaponPose
      : sampleV3ThirdPersonWeaponPose;
    applyV3WeaponMeshPose(pistolModel, sample({
      activeWeapon: 'pistol',
      weaponState,
      weaponTimer,
      isLunging,
      settings,
    }), weaponState, dt);
  }
}
