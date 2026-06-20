import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import type { UniversalSettings } from '../../types';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { normalizeV3QualityTier } from '../v3/v3QualityTiers';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import type { WeaponPose } from './attackAnimationPresets';
import { consumeV3AnimationThrottle } from './v3AnimationThrottle';
import type { GrifballThreeRefs } from './threeRefs';
import {
  clamp01,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
} from './v3AnimationFidelity';
import { sampleV3LowerBodyWalkPose } from './v3LowerBodyChain';
import {
  setV3LowerBodyJointBridgesVisible,
  updateV3LowerBodyJointBridges,
} from './v3LowerBodyJointBridges';

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
type V3DetailGroups = Partial<Record<V3DetailBoneName, THREE.Group>>;

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

const getRestPosition = (group: THREE.Group): THREE.Vector3Tuple => {
  const rest = group.userData.v3AnimationRestPosition;
  if (Array.isArray(rest) && rest.length === 3) {
    return [Number(rest[0]) || 0, Number(rest[1]) || 0, Number(rest[2]) || 0];
  }
  const captured: THREE.Vector3Tuple = [group.position.x, group.position.y, group.position.z];
  group.userData.v3AnimationRestPosition = captured;
  return captured;
};

const setFromRestPosition = (
  group: THREE.Group,
  offset: THREE.Vector3Tuple = [0, 0, 0]
): void => {
  const rest = getRestPosition(group);
  group.position.set(rest[0] + offset[0], rest[1] + offset[1], rest[2] + offset[2]);
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

const lerpDetailRotation = (
  detailBones: V3DetailGroups | undefined,
  boneName: V3DetailBoneName,
  target: THREE.Vector3Tuple,
  alpha: number
): void => {
  const bone = detailBones?.[boneName];
  if (bone) {
    lerpRotation(bone, target, alpha);
  }
};

const scaledRotation = (
  rotation: THREE.Vector3Tuple,
  xScale: number,
  yScale: number,
  zScale: number
): THREE.Vector3Tuple => [
  rotation[0] * xScale,
  rotation[1] * yScale,
  rotation[2] * zScale,
];

const applyV3UpperBodyPose = (
  groups: V3BroadGroups,
  pose: ReturnType<typeof sampleV3UpperBodyWeaponPose>,
  alpha: number,
  detailBones?: V3DetailGroups
): void => {
  lerpRotation(groups.upperTorso, pose.upperTorsoRotation, alpha);
  lerpRotation(groups.head, pose.headRotation, alpha);
  lerpRotation(groups.leftArm, pose.leftArmRotation, alpha);
  lerpRotation(groups.rightArm, pose.rightArmRotation, alpha);

  lerpDetailRotation(detailBones, 'spine1', scaledRotation(pose.upperTorsoRotation, 0.2, 0.2, 0.15), alpha);
  lerpDetailRotation(detailBones, 'spine2', scaledRotation(pose.upperTorsoRotation, 0.35, 0.35, 0.3), alpha);
  lerpDetailRotation(detailBones, 'spine3', scaledRotation(pose.upperTorsoRotation, 0.45, 0.45, 0.4), alpha);
  lerpDetailRotation(detailBones, 'chest', scaledRotation(pose.upperTorsoRotation, 0.5, 0.55, 0.5), alpha);
  lerpDetailRotation(detailBones, 'neck', scaledRotation(pose.headRotation, 0.3, 0.3, 0.25), alpha);
  lerpDetailRotation(detailBones, 'head', scaledRotation(pose.headRotation, 0.7, 0.7, 0.7), alpha);
  lerpDetailRotation(detailBones, 'helmet', scaledRotation(pose.headRotation, 0.7, 0.7, 0.7), alpha);
  lerpDetailRotation(detailBones, 'clavicleLeft', scaledRotation(pose.leftArmRotation, 0.2, 0.2, 0.45), alpha);
  lerpDetailRotation(detailBones, 'upperArmLeft', scaledRotation(pose.leftArmRotation, 0.65, 0.7, 0.7), alpha);
  lerpDetailRotation(detailBones, 'forearmLeft', scaledRotation(pose.leftArmRotation, 0.35, 0.25, 0.25), alpha);
  lerpDetailRotation(detailBones, 'handLeft', scaledRotation(pose.leftArmRotation, 0.18, 0.12, 0.2), alpha);
  lerpDetailRotation(detailBones, 'gripLeft', scaledRotation(pose.leftArmRotation, 0.18, 0.12, 0.2), alpha);
  lerpDetailRotation(detailBones, 'clavicleRight', scaledRotation(pose.rightArmRotation, 0.2, 0.2, 0.45), alpha);
  lerpDetailRotation(detailBones, 'upperArmRight', scaledRotation(pose.rightArmRotation, 0.65, 0.7, 0.7), alpha);
  lerpDetailRotation(detailBones, 'forearmRight', scaledRotation(pose.rightArmRotation, 0.35, 0.25, 0.25), alpha);
  lerpDetailRotation(detailBones, 'handRight', scaledRotation(pose.rightArmRotation, 0.18, 0.12, 0.2), alpha);
  lerpDetailRotation(detailBones, 'gripRight', scaledRotation(pose.rightArmRotation, 0.18, 0.12, 0.2), alpha);
};

const getV3BroadGroups = (mesh: THREE.Group): V3BroadGroups | undefined => {
  const groups = Object.fromEntries(
    V3_BODY_MASKS.death.map((name) => [name, mesh.userData[name]])
  ) as Partial<V3BroadGroups>;

  return V3_BODY_MASKS.death.every((name) => groups[name] instanceof THREE.Group)
    ? groups as V3BroadGroups
    : undefined;
};

const getV3DetailBones = (mesh: THREE.Group): V3DetailGroups | undefined => {
  const detailBones = mesh.userData.v3DetailBones ?? mesh.userData.detailBones;
  return detailBones && typeof detailBones === 'object'
    ? detailBones as V3DetailGroups
    : undefined;
};

export function getV3BodyMaskForLayer(layer: V3AnimationLayerName): readonly V3BroadBodyGroupName[] {
  return V3_BODY_MASKS[layer];
}

const resetV3BroadGroups = (groups: V3BroadGroups): void => {
  for (const name of V3_BODY_MASKS.death) {
    setRotation(groups[name], [0, 0, 0]);
  }
  setFromRestPosition(groups.lowerTorso);
  setFromRestPosition(groups.leftLeg);
  setFromRestPosition(groups.rightLeg);
};

const resetV3DetailBones = (detailBones: V3DetailGroups | undefined): void => {
  if (!detailBones) return;
  for (const bone of Object.values(detailBones)) {
    if (bone instanceof THREE.Group) {
      bone.rotation.set(0, 0, 0);
    }
  }
};

const applyV3FineLocomotion = ({
  detailBones,
  phase,
  isSliding,
  isSprinting,
  speed,
  alpha,
}: {
  detailBones?: V3DetailGroups;
  phase: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  speed: number;
  alpha: number;
}): void => {
  if (!detailBones) return;

  if (isSliding) {
    lerpDetailRotation(detailBones, 'thighLeft', [-0.24, 0, -0.02], alpha);
    lerpDetailRotation(detailBones, 'calfLeft', [0.32, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'footLeft', [0, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'toeLeft', [0, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'thighRight', [-0.12, 0, 0.02], alpha);
    lerpDetailRotation(detailBones, 'calfRight', [0.12, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'footRight', [0, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'toeRight', [0, 0, 0], alpha);
    return;
  }

  if (speed > 0.15) {
    const leftStep = Math.sin(phase);
    const rightStep = -leftStep;
    const stride = isSprinting ? 0.18 : 0.12;
    const knee = isSprinting ? 0.32 : 0.18;
    lerpDetailRotation(detailBones, 'thighLeft', [leftStep * stride, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'thighRight', [rightStep * stride, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'calfLeft', [leftStep < 0 ? -leftStep * knee : 0.04, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'calfRight', [rightStep < 0 ? -rightStep * knee : 0.04, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'footLeft', [0, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'footRight', [0, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'toeLeft', [0, 0, 0], alpha);
    lerpDetailRotation(detailBones, 'toeRight', [0, 0, 0], alpha);
    return;
  }

  for (const boneName of ['thighLeft', 'calfLeft', 'footLeft', 'toeLeft', 'thighRight', 'calfRight', 'footRight', 'toeRight'] as const) {
    lerpDetailRotation(detailBones, boneName, [0, 0, 0], alpha);
  }
};

const hasV3SingleChainLowerBody = (
  mesh: THREE.Group,
  detailBones?: V3DetailGroups
): detailBones is V3DetailGroups => (
  mesh.userData.v3LowerBodyChainMode === 'single-chain' &&
  detailBones?.thighLeft instanceof THREE.Group &&
  detailBones.thighRight instanceof THREE.Group &&
  detailBones.calfLeft instanceof THREE.Group &&
  detailBones.calfRight instanceof THREE.Group
);

const applyV3SingleChainWalk = ({
  groups,
  detailBones,
  phase,
  speed,
  alpha,
}: {
  groups: V3BroadGroups;
  detailBones: V3DetailGroups;
  phase: number;
  speed: number;
  alpha: number;
}): void => {
  const pose = sampleV3LowerBodyWalkPose({ phase, speed, isSprinting: false });
  setFromRestPosition(groups.leftLeg);
  setFromRestPosition(groups.rightLeg);
  setFromRestPosition(groups.lowerTorso, pose.pelvisOffset);

  groups.lowerTorso.rotation.x = THREE.MathUtils.lerp(groups.lowerTorso.rotation.x, pose.pelvisRotation[0], alpha);
  groups.lowerTorso.rotation.z = THREE.MathUtils.lerp(groups.lowerTorso.rotation.z, pose.pelvisRotation[2], alpha);
  lerpDetailRotation(detailBones, 'pelvis', pose.pelvisRotation, alpha);
  lerpRotation(groups.leftLeg, pose.sides.left.thighRotation, alpha);
  lerpRotation(groups.rightLeg, pose.sides.right.thighRotation, alpha);
  lerpDetailRotation(detailBones, 'calfLeft', pose.sides.left.calfRotation, alpha);
  lerpDetailRotation(detailBones, 'calfRight', pose.sides.right.calfRotation, alpha);
  lerpDetailRotation(detailBones, 'footLeft', pose.sides.left.footRotation, alpha);
  lerpDetailRotation(detailBones, 'footRight', pose.sides.right.footRotation, alpha);
  lerpDetailRotation(detailBones, 'toeLeft', pose.sides.left.toeRotation, alpha);
  lerpDetailRotation(detailBones, 'toeRight', pose.sides.right.toeRotation, alpha);
};

const applyV3LocomotionLayer = ({
  groups,
  mesh,
  vel,
  yaw,
  dt,
  isSliding,
  isSprinting,
  detailBones,
}: {
  groups: V3BroadGroups;
  mesh: THREE.Group;
  vel: THREE.Vector3;
  yaw: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  detailBones?: V3DetailGroups;
}): void => {
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const alpha = dt > 0 ? Math.min(1, dt * 10) : 1;
  const useSingleChainWalk = (
    speed > 0.15 &&
    !isSliding &&
    !isSprinting &&
    hasV3SingleChainLowerBody(mesh, detailBones)
  );
  mesh.userData.v3LowerBodyBridgeActive = useSingleChainWalk;

  if (isSliding) {
    setFromRestPosition(groups.leftLeg, [0.06, 0, 0]);
    setFromRestPosition(groups.rightLeg, [-0.06, 0, 0]);
    setFromRestPosition(groups.lowerTorso, [0, 0.03, 0]);
    lerpRotation(groups.lowerTorso, [-0.08, groups.lowerTorso.rotation.y, 0], alpha);
    lerpRotation(groups.leftLeg, [-0.24, 0, -0.03], alpha);
    lerpRotation(groups.rightLeg, [-0.12, 0, 0.03], alpha);
    applyV3FineLocomotion({ detailBones, phase: 0, isSliding, isSprinting, speed, alpha });
    return;
  }

  if (speed > 0.15) {
    const strideScale = isSprinting ? 1.25 : 1;
    const frequency = (isSprinting ? 6.8 : 4.4) * Math.max(0.35, speed / 4);
    const nextPhase = Number(mesh.userData.v3WalkPhase ?? 0) + dt * frequency;
    mesh.userData.v3WalkPhase = nextPhase;

    const phase = nextPhase;
    const swing = (isSprinting ? 0.2 : 0.14) * strideScale;
    const side = isSprinting ? 0.08 : 0.05;
    if (useSingleChainWalk) {
      applyV3SingleChainWalk({ groups, detailBones, phase, speed, alpha });
    } else {
      setFromRestPosition(groups.leftLeg, [0.06, 0, 0]);
      setFromRestPosition(groups.rightLeg, [-0.06, 0, 0]);
      setFromRestPosition(groups.lowerTorso, [0, 0.03, 0]);
      groups.leftLeg.rotation.x = Math.sin(phase) * swing;
      groups.rightLeg.rotation.x = -Math.sin(phase) * swing;
      groups.leftLeg.rotation.z = Math.cos(phase) * side;
      groups.rightLeg.rotation.z = -Math.cos(phase) * side;
      groups.lowerTorso.rotation.x = THREE.MathUtils.lerp(groups.lowerTorso.rotation.x, isSprinting ? 0.06 : 0, alpha);
      applyV3FineLocomotion({ detailBones, phase, isSliding, isSprinting, speed, alpha });
    }
  } else {
    mesh.userData.v3WalkPhase = 0;
    setFromRestPosition(groups.leftLeg);
    setFromRestPosition(groups.rightLeg);
    setFromRestPosition(groups.lowerTorso);
    groups.lowerTorso.rotation.x = THREE.MathUtils.lerp(groups.lowerTorso.rotation.x, 0, alpha);
    lerpRotation(groups.leftLeg, [0, 0, 0], alpha);
    lerpRotation(groups.rightLeg, [0, 0, 0], alpha);
    applyV3FineLocomotion({ detailBones, phase: 0, isSliding, isSprinting, speed, alpha });
  }

  let targetYaw = 0;
  if (speed > 0.15 && !useSingleChainWalk) {
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
  detailBones,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  hammerSlamWindupTime?: number;
  hammerSlamAttackTime?: number;
  settings: Partial<UniversalSettings>;
  alpha: number;
  detailBones?: V3DetailGroups;
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
  }), alpha, detailBones);
};

const applyV3SwordLayer = ({
  groups,
  weaponState,
  weaponTimer,
  isLunging,
  settings,
  alpha,
  detailBones,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  isLunging?: boolean;
  settings: Partial<UniversalSettings>;
  alpha: number;
  detailBones?: V3DetailGroups;
}): void => {
  applyV3UpperBodyPose(groups, sampleV3UpperBodyWeaponPose({
    activeWeapon: 'sword',
    weaponState,
    weaponTimer,
    isLunging: Boolean(isLunging),
    settings,
  }), alpha, detailBones);
};

const applyV3PistolLayer = ({
  groups,
  weaponState,
  weaponTimer,
  settings,
  alpha,
  detailBones,
}: {
  groups: V3BroadGroups;
  weaponState: string;
  weaponTimer: number;
  settings: Partial<UniversalSettings>;
  alpha: number;
  detailBones?: V3DetailGroups;
}): void => {
  applyV3UpperBodyPose(groups, sampleV3UpperBodyWeaponPose({
    activeWeapon: 'pistol',
    weaponState,
    weaponTimer,
    isLunging: false,
    settings,
  }), alpha, detailBones);
};

const settleV3UpperBody = (
  groups: V3BroadGroups,
  alpha: number,
  breathingPhase: number,
  detailBones?: V3DetailGroups
): void => {
  const breathe = Math.sin(breathingPhase) * 0.018;
  lerpRotation(groups.upperTorso, [breathe, 0, 0], alpha);
  lerpRotation(groups.head, [-breathe * 0.5, 0, 0], alpha);
  lerpRotation(groups.leftArm, [-0.12, 0, 0.08], alpha);
  lerpRotation(groups.rightArm, [-0.12, 0, -0.08], alpha);
  lerpDetailRotation(detailBones, 'spine1', [breathe * 0.25, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'spine2', [breathe * 0.5, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'spine3', [breathe * 0.6, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'chest', [breathe * 0.5, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'neck', [-breathe * 0.2, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'head', [-breathe * 0.4, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'helmet', [-breathe * 0.4, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'upperArmLeft', [-0.08, 0, 0.04], alpha);
  lerpDetailRotation(detailBones, 'forearmLeft', [-0.04, 0, 0.02], alpha);
  lerpDetailRotation(detailBones, 'handLeft', [0, 0, 0], alpha);
  lerpDetailRotation(detailBones, 'upperArmRight', [-0.08, 0, -0.04], alpha);
  lerpDetailRotation(detailBones, 'forearmRight', [-0.04, 0, -0.02], alpha);
  lerpDetailRotation(detailBones, 'handRight', [0, 0, 0], alpha);
};

const applyV3AdditiveLayer = ({
  groups,
  detailBones,
  alpha,
  hitReactTimer,
  lookYawOffset = 0,
  lookPitch = 0,
}: {
  groups: V3BroadGroups;
  detailBones?: V3DetailGroups;
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
    lerpDetailRotation(detailBones, 'spine3', [
      (detailBones?.spine3?.rotation.x ?? 0) - hit * 0.03,
      detailBones?.spine3?.rotation.y ?? 0,
      (detailBones?.spine3?.rotation.z ?? 0) + hit * 0.08,
    ], alpha);
    lerpDetailRotation(detailBones, 'head', [
      (detailBones?.head?.rotation.x ?? 0) - hit * 0.06,
      (detailBones?.head?.rotation.y ?? 0) - hit * 0.04,
      (detailBones?.head?.rotation.z ?? 0) + hit * 0.04,
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
    lerpDetailRotation(detailBones, 'neck', [
      (detailBones?.neck?.rotation.x ?? 0) + safeLookPitch * 0.25,
      (detailBones?.neck?.rotation.y ?? 0) + safeLookYaw * 0.2,
      detailBones?.neck?.rotation.z ?? 0,
    ], alpha);
    lerpDetailRotation(detailBones, 'head', [
      (detailBones?.head?.rotation.x ?? 0) + safeLookPitch * 0.55,
      (detailBones?.head?.rotation.y ?? 0) + safeLookYaw * 0.55,
      detailBones?.head?.rotation.z ?? 0,
    ], alpha);
    lerpDetailRotation(detailBones, 'helmet', [
      (detailBones?.helmet?.rotation.x ?? 0) + safeLookPitch * 0.55,
      (detailBones?.helmet?.rotation.y ?? 0) + safeLookYaw * 0.55,
      detailBones?.helmet?.rotation.z ?? 0,
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
  const detailBones = getV3DetailBones(mesh);
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
    resetV3DetailBones(detailBones);
    mesh.userData.v3LowerBodyBridgeActive = false;
    setV3LowerBodyJointBridgesVisible(mesh, false);
    return true;
  }

  if (hp < previousHp) {
    mesh.userData.v3HitReactTimer = 0.18;
  }
  mesh.userData.v3LastHp = hp;

  const alpha = dt > 0 ? Math.min(1, dt * 12) : 1;
  applyV3LocomotionLayer({ groups, mesh, vel, yaw, dt, isSliding, isSprinting, detailBones });

  const breathingPhase = Number(mesh.userData.v3BreathingPhase ?? 0) + dt * 2.1;
  mesh.userData.v3BreathingPhase = breathingPhase;
  settleV3UpperBody(groups, alpha, breathingPhase, detailBones);

  if (activeWeapon === 'sword') {
    applyV3SwordLayer({ groups, weaponState, weaponTimer, isLunging, settings, alpha, detailBones });
  } else if (activeWeapon === 'pistol') {
    applyV3PistolLayer({ groups, weaponState, weaponTimer, settings, alpha, detailBones });
  } else {
    applyV3HammerLayer({
      groups,
      weaponState,
      weaponTimer,
      hammerSlamWindupTime,
      hammerSlamAttackTime,
      settings,
      alpha,
      detailBones,
    });
  }

  const hitReactTimer = Math.max(0, Number(mesh.userData.v3HitReactTimer ?? 0));
  applyV3AdditiveLayer({
    groups,
    detailBones,
    alpha,
    hitReactTimer,
    lookYawOffset,
    lookPitch,
  });
  mesh.userData.v3HitReactTimer = Math.max(0, hitReactTimer - dt);
  updateV3LowerBodyJointBridges(mesh, mesh.userData.v3LowerBodyBridgeActive === true);

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
