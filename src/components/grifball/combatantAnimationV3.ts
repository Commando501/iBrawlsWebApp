import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import type { UniversalSettings } from '../../types';
import type { V3QualityTier, V3WeaponId } from '../v3/v3ModelTypes';
import { normalizeV3QualityTier } from '../v3/v3QualityTiers';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import type { WeaponPose } from './attackAnimationPresets';
import { consumeV3AnimationThrottle } from './v3AnimationThrottle';
import type { GrifballThreeRefs } from './threeRefs';
import {
  clamp01,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponMotion,
  sampleV3UpperBodyWeaponPose,
  sampleV3WeaponCarryPose,
} from './v3AnimationFidelity';
import { sampleV3LowerBodyWalkPose } from './v3LowerBodyChain';
import {
  setV3LowerBodyJointBridgesVisible,
  updateV3LowerBodyJointBridges,
} from './v3LowerBodyJointBridges';
import {
  setV3UpperBodyJointBridgesVisible,
  updateV3UpperBodyJointBridges,
} from './v3UpperBodyJointBridges';
import {
  setV3UpperBodyUndersuitFillVisible,
  updateV3UpperBodyUndersuitFill,
} from './v3UpperBodyUndersuitFill';
import {
  setV3RigFittedBaseBodyVisible,
  updateV3RigFittedBaseBody,
} from './v3RigFittedBaseBody';
import {
  applyV3RetargetedClipPose,
  sampleV3RetargetedClip,
  type V3RetargetedClipId,
} from './v3RetargetedAnimationClips';
import {
  applyV3WeaponSocketBasis,
  getV3WeaponSocketWorldPosition,
} from './v3WeaponSocketBasis';
import { applyV3WeaponGripConstraints } from './v3ArmIk';
import {
  applyV3CleanRigPose,
  type V3AnimationAuthority,
} from './v3CleanRig';
import { getV3Mesh2MotionDriverWeaponSocketWorldTransform } from './v3Mesh2MotionDriverRig';
import {
  mapV3RuntimeStateToAuthoredClip,
  sampleV3AuthoredClip,
  type V3AuthoredAnimationSample,
  type V3AuthoredClipId,
} from './v3AuthoredAnimationClips';

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
  v3PoseAlphaOverride?: number;
  v3AnimationAuthority?: V3AnimationAuthority;
  v3AuthoredClipId?: V3AuthoredClipId;
  v3AuthoredNormalizedTime?: number;
  v3AuthoredSampleOverride?: V3AuthoredAnimationSample;
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
  combatantModel?: THREE.Group | null;
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  dt: number;
  settings: Partial<UniversalSettings>;
  v3AnimationAuthority?: V3AnimationAuthority;
  v3AuthoredClipId?: V3AuthoredClipId;
  v3AuthoredNormalizedTime?: number;
  v3AuthoredSampleOverride?: V3AuthoredAnimationSample;
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

const ensureV3WeaponSocketBasis = (
  group: THREE.Group,
  weapon: V3WeaponId
): void => {
  const socketName = group.userData.v3View === 'firstPerson'
    ? 'firstPersonPrimaryGrip'
    : 'thirdPersonPrimaryGrip';
  const current = group.userData.v3WeaponSocketBasis as { socketName?: string } | undefined;
  if (current?.socketName !== socketName) {
    applyV3WeaponSocketBasis(group, weapon, socketName);
  }
};

const alignV3WeaponToMesh2MotionDriverHand = (
  combatantModel: THREE.Group | undefined,
  weaponModel: THREE.Group,
): void => {
  if (!combatantModel || combatantModel.userData.v3Mesh2MotionDriverActive !== true) return;
  const target = getV3Mesh2MotionDriverWeaponSocketWorldTransform(combatantModel, 'rightHandGrip');
  const parent = weaponModel.parent;
  if (!target || !parent) return;

  parent.updateMatrixWorld(true);
  const parentQuaternion = parent.getWorldQuaternion(new THREE.Quaternion());
  weaponModel.quaternion.copy(parentQuaternion.invert().multiply(target.quaternion)).normalize();
  weaponModel.rotation.setFromQuaternion(weaponModel.quaternion);
  weaponModel.updateMatrixWorld(true);

  const socket = getV3WeaponSocketWorldPosition(weaponModel, 'thirdPersonPrimaryGrip');
  if (!socket) return;

  const currentWeaponWorld = weaponModel.getWorldPosition(new THREE.Vector3());
  const desiredWeaponWorld = currentWeaponWorld.add(target.position.clone().sub(socket));
  weaponModel.position.copy(parent.worldToLocal(desiredWeaponWorld));
  weaponModel.updateMatrixWorld(true);
};

const authoredNormalizedTime = (
  explicit: number | undefined,
  animationClockMs: number | undefined,
  weaponTimer: number
): number => {
  if (Number.isFinite(explicit)) return clamp01(Number(explicit));
  if (Number.isFinite(weaponTimer) && weaponTimer > 0) return clamp01(weaponTimer);
  const seconds = Number.isFinite(animationClockMs) ? Number(animationClockMs) / 1000 : 0;
  return clamp01(seconds - Math.floor(seconds));
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

const lerpDetailQuaternion = (
  detailBones: V3DetailGroups | undefined,
  boneName: V3DetailBoneName,
  target: readonly [number, number, number, number],
  alpha: number
): void => {
  const bone = detailBones?.[boneName];
  if (!bone) return;
  const targetQuaternion = new THREE.Quaternion(target[0], target[1], target[2], target[3]).normalize();
  if (alpha >= 1) {
    bone.quaternion.copy(targetQuaternion);
  } else {
    bone.quaternion.slerp(targetQuaternion, Math.max(0, Math.min(1, alpha)));
  }
};

const lerpDetailRotationIfDistinct = (
  detailBones: V3DetailGroups | undefined,
  boneName: V3DetailBoneName,
  target: THREE.Vector3Tuple,
  alpha: number,
  distinctFrom: readonly (THREE.Group | undefined)[]
): void => {
  const bone = detailBones?.[boneName];
  if (!bone || distinctFrom.includes(bone)) return;
  lerpRotation(bone, target, alpha);
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
  if (pose.detailBoneQuaternions && detailBones) {
    if (groups.upperTorso !== detailBones.chest) lerpRotation(groups.upperTorso, [0, 0, 0], alpha);
    if (groups.head !== detailBones.head) lerpRotation(groups.head, [0, 0, 0], alpha);
    if (groups.leftArm !== detailBones.upperArmLeft) lerpRotation(groups.leftArm, [0, 0, 0], alpha);
    if (groups.rightArm !== detailBones.upperArmRight) lerpRotation(groups.rightArm, [0, 0, 0], alpha);

    for (const [jointName, quaternion] of Object.entries(pose.detailBoneQuaternions)) {
      if (!quaternion) continue;
      lerpDetailQuaternion(detailBones, jointName as V3DetailBoneName, quaternion as [number, number, number, number], alpha);
    }
    return;
  }

  if (pose.detailBoneRotations && detailBones) {
    if (groups.upperTorso !== detailBones.chest) lerpRotation(groups.upperTorso, pose.upperTorsoRotation, alpha);
    if (groups.head !== detailBones.head) lerpRotation(groups.head, pose.headRotation, alpha);
    if (groups.leftArm !== detailBones.upperArmLeft) lerpRotation(groups.leftArm, pose.leftArmRotation, alpha);
    if (groups.rightArm !== detailBones.upperArmRight) lerpRotation(groups.rightArm, pose.rightArmRotation, alpha);

    for (const [jointName, rotation] of Object.entries(pose.detailBoneRotations)) {
      if (!rotation) continue;
      lerpDetailRotation(detailBones, jointName as V3DetailBoneName, rotation, alpha);
    }
    return;
  }

  lerpRotation(groups.upperTorso, pose.upperTorsoRotation, alpha);
  lerpRotation(groups.head, pose.headRotation, alpha);
  lerpRotation(groups.leftArm, pose.leftArmRotation, alpha);
  lerpRotation(groups.rightArm, pose.rightArmRotation, alpha);

  lerpDetailRotationIfDistinct(detailBones, 'spine1', scaledRotation(pose.upperTorsoRotation, 0.2, 0.2, 0.15), alpha, [groups.upperTorso]);
  lerpDetailRotationIfDistinct(detailBones, 'spine2', scaledRotation(pose.upperTorsoRotation, 0.35, 0.35, 0.3), alpha, [groups.upperTorso]);
  lerpDetailRotationIfDistinct(detailBones, 'spine3', scaledRotation(pose.upperTorsoRotation, 0.45, 0.45, 0.4), alpha, [groups.upperTorso]);
  lerpDetailRotationIfDistinct(detailBones, 'chest', scaledRotation(pose.upperTorsoRotation, 0.5, 0.55, 0.5), alpha, [groups.upperTorso]);
  lerpDetailRotationIfDistinct(detailBones, 'neck', scaledRotation(pose.headRotation, 0.3, 0.3, 0.25), alpha, [groups.head]);
  lerpDetailRotationIfDistinct(detailBones, 'head', scaledRotation(pose.headRotation, 0.7, 0.7, 0.7), alpha, [groups.head]);
  lerpDetailRotation(detailBones, 'helmet', scaledRotation(pose.headRotation, 0.7, 0.7, 0.7), alpha);
  lerpDetailRotationIfDistinct(detailBones, 'clavicleLeft', scaledRotation(pose.leftArmRotation, 0.2, 0.2, 0.45), alpha, [groups.leftArm]);
  lerpDetailRotationIfDistinct(detailBones, 'upperArmLeft', scaledRotation(pose.leftArmRotation, 0.65, 0.7, 0.7), alpha, [groups.leftArm]);
  lerpDetailRotation(detailBones, 'forearmLeft', scaledRotation(pose.leftArmRotation, 0.35, 0.25, 0.25), alpha);
  lerpDetailRotation(detailBones, 'handLeft', scaledRotation(pose.leftArmRotation, 0.18, 0.12, 0.2), alpha);
  lerpDetailRotation(detailBones, 'gripLeft', scaledRotation(pose.leftArmRotation, 0.18, 0.12, 0.2), alpha);
  lerpDetailRotationIfDistinct(detailBones, 'clavicleRight', scaledRotation(pose.rightArmRotation, 0.2, 0.2, 0.45), alpha, [groups.rightArm]);
  lerpDetailRotationIfDistinct(detailBones, 'upperArmRight', scaledRotation(pose.rightArmRotation, 0.65, 0.7, 0.7), alpha, [groups.rightArm]);
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
  isLunging,
  detailBones,
  animationClockMs,
}: {
  groups: V3BroadGroups;
  mesh: THREE.Group;
  vel: THREE.Vector3;
  yaw: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
  detailBones?: V3DetailGroups;
  animationClockMs?: number;
}): void => {
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const alpha = dt > 0 ? Math.min(1, dt * 10) : 1;
  const hasClockPhase = Number.isFinite(animationClockMs);
  const elapsedSeconds = hasClockPhase
    ? Number(animationClockMs) / 1000
    : Number(mesh.userData.v3RetargetedLocomotionSeconds ?? 0) + Math.max(0, dt);
  mesh.userData.v3RetargetedLocomotionSeconds = elapsedSeconds;
  const retargetClipId: V3RetargetedClipId | null = isSliding || isLunging
    ? null
    : speed > 0.15
      ? isSprinting ? 'run' : 'walk'
      : 'idle';
  if (retargetClipId) {
    const playbackRate = retargetClipId === 'run'
      ? Math.max(0.75, Math.min(1.55, speed / 4.4))
      : retargetClipId === 'walk'
        ? Math.max(0.72, Math.min(1.35, speed / 2.4))
        : 1;
    const sample = sampleV3RetargetedClip(retargetClipId, {
      elapsedSeconds: elapsedSeconds * playbackRate,
    });
    const applied = applyV3RetargetedClipPose(mesh, sample, {
      alpha: hasClockPhase ? 1 : alpha,
    });
    if (applied) {
      if (speed <= 0.15) {
        setFromRestPosition(groups.leftLeg);
        setFromRestPosition(groups.rightLeg);
        groups.leftLeg.rotation.x = THREE.MathUtils.lerp(groups.leftLeg.rotation.x, 0, alpha);
        groups.rightLeg.rotation.x = THREE.MathUtils.lerp(groups.rightLeg.rotation.x, 0, alpha);
      }
      groups.lowerTorso.rotation.y = THREE.MathUtils.lerp(groups.lowerTorso.rotation.y, 0, alpha);
      if (retargetClipId === 'idle') {
        mesh.userData.v3LowerBodyBridgeActive = false;
      }
      return;
    }
  }
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
    const nextPhase = hasClockPhase
      ? (Number(animationClockMs) / 1000) * frequency
      : Number(mesh.userData.v3WalkPhase ?? 0) + dt * frequency;
    mesh.userData.v3WalkPhase = nextPhase;

    const phase = nextPhase;
    const swing = (isSprinting ? 0.2 : 0.14) * strideScale;
    const side = isSprinting ? 0.08 : 0.05;
    if (useSingleChainWalk) {
      const chainSpeed = isLunging ? Math.min(speed, 1.6) : speed;
      applyV3SingleChainWalk({ groups, detailBones, phase, speed: chainSpeed, alpha: hasClockPhase ? 1 : alpha });
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
  const timingSettings: Partial<UniversalSettings> = {
    ...settings,
    ...(Number.isFinite(hammerSlamWindupTime) ? { hammerSlamWindupTime } : {}),
    ...(Number.isFinite(hammerSlamAttackTime) ? { hammerSlamAttackTime } : {}),
  };
  applyV3UpperBodyPose(groups, sampleV3UpperBodyWeaponPose({
    activeWeapon: 'hammer',
    weaponState,
    weaponTimer,
    isLunging: false,
    settings: timingSettings,
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
  v3PoseAlphaOverride,
  v3AnimationAuthority = 'legacyLayered',
  v3AuthoredClipId,
  v3AuthoredNormalizedTime,
  v3AuthoredSampleOverride,
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
    setV3UpperBodyJointBridgesVisible(mesh, false);
    setV3UpperBodyUndersuitFillVisible(mesh, false);
    setV3RigFittedBaseBodyVisible(mesh, false);
    return true;
  }

  if (hp < previousHp) {
    mesh.userData.v3HitReactTimer = 0.18;
  }
  mesh.userData.v3LastHp = hp;

  const alpha = Number.isFinite(v3PoseAlphaOverride)
    ? clamp01(Number(v3PoseAlphaOverride))
    : dt > 0 ? Math.min(1, dt * 12) : 1;

  if (v3AnimationAuthority === 'cleanRig') {
    const clipId = v3AuthoredClipId ?? mapV3RuntimeStateToAuthoredClip({
      activeWeapon,
      weaponState,
      isSliding,
      isSprinting,
      isLunging,
      velocityLength: vel.length(),
    });
    const normalizedTime = authoredNormalizedTime(v3AuthoredNormalizedTime, animationClockMs, weaponTimer);
    const authoredSample = v3AuthoredSampleOverride?.clipId === clipId
      ? v3AuthoredSampleOverride
      : sampleV3AuthoredClip(clipId, { normalizedTime });
    applyV3CleanRigPose(mesh, authoredSample.pose, { alpha });
    mesh.userData.v3LastHp = hp;
    mesh.userData.v3HitReactTimer = 0;
    mesh.userData.v3CleanMotionSource = authoredSample.motionSource;
    if (authoredSample.mixamoClipId) {
      mesh.userData.v3CleanMixamoClipId = authoredSample.mixamoClipId;
      mesh.userData.v3CleanSourceNormalizedTime = authoredSample.sourceNormalizedTime;
    } else {
      delete mesh.userData.v3CleanMixamoClipId;
      delete mesh.userData.v3CleanSourceNormalizedTime;
    }
    mesh.userData.v3LowerBodyBridgeActive = false;
    setV3LowerBodyJointBridgesVisible(mesh, false);
    updateV3RigFittedBaseBody(mesh, true);
    updateV3UpperBodyUndersuitFill(mesh, true);
    setV3UpperBodyUndersuitFillVisible(mesh, false);
    updateV3UpperBodyJointBridges(mesh, true);
    setV3UpperBodyJointBridgesVisible(mesh, false);
    if (authoredSample.weaponPose) {
      mesh.userData.v3WeaponCarry = {
        weapon: authoredSample.weaponPose.weapon,
        trackSource: authoredSample.motionSource === 'mixamoWeaponReference'
          ? 'v3CleanMixamoReferenceClip'
          : 'v3CleanAuthoredClip',
      };
    } else {
      delete mesh.userData.v3WeaponCarry;
    }
    return true;
  }

  applyV3LocomotionLayer({ groups, mesh, vel, yaw, dt, isSliding, isSprinting, isLunging, detailBones, animationClockMs });

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
  if (activeWeapon === 'hammer' || activeWeapon === 'sword' || activeWeapon === 'pistol') {
    const carry = sampleV3WeaponCarryPose(activeWeapon);
    mesh.userData.v3WeaponCarry = {
      weapon: activeWeapon,
      trackSource: carry.trackSource,
    };
  } else {
    delete mesh.userData.v3WeaponCarry;
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
  updateV3RigFittedBaseBody(mesh, true);
  updateV3UpperBodyUndersuitFill(mesh, true);
  setV3UpperBodyUndersuitFillVisible(mesh, false);
  updateV3UpperBodyJointBridges(mesh, true);
  setV3UpperBodyJointBridgesVisible(mesh, false);

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
  combatantModel,
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging,
  dt,
  settings,
  v3AnimationAuthority = 'legacyLayered',
  v3AuthoredClipId,
  v3AuthoredNormalizedTime,
  v3AuthoredSampleOverride,
}: V3WeaponMeshAnimationInput): void {
  if (hammerModel) hammerModel.visible = activeWeapon === 'hammer';
  if (swordModel) swordModel.visible = activeWeapon === 'sword';
  if (pistolModel) pistolModel.visible = activeWeapon === 'pistol';

  if (v3AnimationAuthority === 'cleanRig') {
    const clipId = v3AuthoredClipId ?? mapV3RuntimeStateToAuthoredClip({
      activeWeapon,
      weaponState,
      isLunging,
    });
    const sample = sampleV3AuthoredClip(clipId, {
      normalizedTime: authoredNormalizedTime(v3AuthoredNormalizedTime, undefined, weaponTimer),
    });
    const resolvedSample = v3AuthoredSampleOverride?.clipId === clipId ? v3AuthoredSampleOverride : sample;
    const pose = resolvedSample.weaponPose;
    const applyCleanWeapon = (
      model: THREE.Group | null | undefined,
      weapon: V3WeaponId
    ): void => {
      if (!model || model.userData.modelSystem !== 'v3' || activeWeapon !== weapon || pose?.weapon !== weapon) return;
      ensureV3WeaponSocketBasis(model, weapon);
      applyV3WeaponMeshPose(model, pose, weaponState, dt);
      if (resolvedSample.pose.mesh2MotionDriverPose) {
        alignV3WeaponToMesh2MotionDriverHand(combatantModel, model);
      }
      model.userData.v3CleanAuthoredClip = clipId;
      model.userData.v3AnimationAuthority = 'cleanRig';
      model.userData.v3CleanMotionSource = resolvedSample.motionSource;
      if (resolvedSample.mixamoClipId) {
        model.userData.v3CleanMixamoClipId = resolvedSample.mixamoClipId;
        model.userData.v3CleanSourceNormalizedTime = resolvedSample.sourceNormalizedTime;
      } else {
        delete model.userData.v3CleanMixamoClipId;
        delete model.userData.v3CleanSourceNormalizedTime;
      }
    };
    applyCleanWeapon(hammerModel, 'hammer');
    applyCleanWeapon(swordModel, 'sword');
    applyCleanWeapon(pistolModel, 'pistol');
    return;
  }

  if (hammerModel?.userData.modelSystem === 'v3' && activeWeapon === 'hammer') {
    ensureV3WeaponSocketBasis(hammerModel, 'hammer');
    const input = {
      activeWeapon: 'hammer',
      weaponState,
      weaponTimer,
      isLunging,
      settings,
    } as const;
    if (hammerModel.userData.v3View === 'firstPerson') {
      applyV3WeaponMeshPose(hammerModel, sampleV3FirstPersonWeaponPose(input), weaponState, dt);
    } else {
      const sample = sampleV3ThirdPersonWeaponMotion(input);
      applyV3WeaponMeshPose(hammerModel, sample.weaponPose, weaponState, dt);
      applyV3WeaponGripConstraints(combatantModel, hammerModel, sample.gripConstraints);
    }
  }

  if (swordModel?.userData.modelSystem === 'v3' && activeWeapon === 'sword') {
    ensureV3WeaponSocketBasis(swordModel, 'sword');
    const input = {
      activeWeapon: 'sword',
      weaponState,
      weaponTimer,
      isLunging,
      settings,
    } as const;
    if (swordModel.userData.v3View === 'firstPerson') {
      applyV3WeaponMeshPose(swordModel, sampleV3FirstPersonWeaponPose(input), weaponState, dt);
    } else {
      const sample = sampleV3ThirdPersonWeaponMotion(input);
      applyV3WeaponMeshPose(swordModel, sample.weaponPose, weaponState, dt);
      applyV3WeaponGripConstraints(combatantModel, swordModel, sample.gripConstraints);
    }
  }

  if (pistolModel?.userData.modelSystem === 'v3' && activeWeapon === 'pistol') {
    ensureV3WeaponSocketBasis(pistolModel, 'pistol');
    const input = {
      activeWeapon: 'pistol',
      weaponState,
      weaponTimer,
      isLunging,
      settings,
    } as const;
    if (pistolModel.userData.v3View === 'firstPerson') {
      applyV3WeaponMeshPose(pistolModel, sampleV3FirstPersonWeaponPose(input), weaponState, dt);
    } else {
      const sample = sampleV3ThirdPersonWeaponMotion(input);
      applyV3WeaponMeshPose(pistolModel, sample.weaponPose, weaponState, dt);
      applyV3WeaponGripConstraints(combatantModel, pistolModel, sample.gripConstraints);
    }
  }
}
