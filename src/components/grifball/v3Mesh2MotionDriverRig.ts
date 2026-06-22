import * as THREE from 'three';
import type { V3CharacterSlotId } from '../v3/v3ModelTypes';
import { V3_MESH2MOTION_CLIP_SET } from './v3Mesh2MotionClips.generated';

export type V3Mesh2MotionDriverVec3Tuple = [number, number, number];
export type V3Mesh2MotionDriverQuatTuple = [number, number, number, number];

export interface V3Mesh2MotionDriverJointPose {
  position: V3Mesh2MotionDriverVec3Tuple;
  quaternion: V3Mesh2MotionDriverQuatTuple;
}

export interface V3Mesh2MotionDriverPose {
  sourceClipName: string;
  sourceNormalizedTime: number;
  joints: Record<string, V3Mesh2MotionDriverJointPose>;
}

export interface V3Mesh2MotionDriverJoint {
  name: string;
  parentName: string | null;
  object: THREE.Group;
  restLocalPosition: V3Mesh2MotionDriverVec3Tuple;
  restLocalQuaternion: V3Mesh2MotionDriverQuatTuple;
}

export interface V3Mesh2MotionPartBinding {
  slot: V3CharacterSlotId;
  sourceJointName: string;
  partGroup: THREE.Group;
  restLocalPosition: V3Mesh2MotionDriverVec3Tuple;
  restLocalQuaternion: V3Mesh2MotionDriverQuatTuple;
  restLocalScale: V3Mesh2MotionDriverVec3Tuple;
  bindMatrix: THREE.Matrix4;
}

export interface V3Mesh2MotionDriverRig {
  root: THREE.Group;
  ready: boolean;
  warnings: string[];
  joints: Record<string, V3Mesh2MotionDriverJoint>;
  partBindings: Partial<Record<V3CharacterSlotId, V3Mesh2MotionPartBinding>>;
}

export interface V3Mesh2MotionDriverApplyReport {
  ready: boolean;
  warnings: string[];
  jointCount: number;
  partBindingCount: number;
}

type GeneratedSkeletonJoint = {
  readonly name: string;
  readonly parent: string | null;
  readonly restLocalPosition?: readonly number[];
  readonly restLocalQuaternion?: readonly number[];
};

export const V3_MESH2MOTION_SLOT_DRIVER_JOINTS = {
  helmet: 'head',
  neck: 'neck_01',
  chest: 'spine_03',
  shoulderLeft: 'clavicle_l',
  shoulderRight: 'clavicle_r',
  upperArmLeft: 'upperarm_l',
  upperArmRight: 'upperarm_r',
  forearmLeft: 'lowerarm_l',
  forearmRight: 'lowerarm_r',
  handLeft: 'hand_l',
  handRight: 'hand_r',
  pelvis: 'pelvis',
  thighLeft: 'thigh_l',
  thighRight: 'thigh_r',
  shinLeft: 'calf_l',
  shinRight: 'calf_r',
  footLeft: 'foot_l',
  footRight: 'foot_r',
  back: 'spine_03',
} as const satisfies Record<V3CharacterSlotId, string>;

const ZERO_VEC3: V3Mesh2MotionDriverVec3Tuple = [0, 0, 0];
const ONE_VEC3: V3Mesh2MotionDriverVec3Tuple = [1, 1, 1];
const IDENTITY_QUATERNION: V3Mesh2MotionDriverQuatTuple = [0, 0, 0, 1];

const finiteTuple = (value: readonly number[] | undefined, length: number): boolean =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite);

const vec3Tuple = (
  value: readonly number[] | undefined,
  fallback: V3Mesh2MotionDriverVec3Tuple = ZERO_VEC3
): V3Mesh2MotionDriverVec3Tuple => finiteTuple(value, 3)
  ? [Number(value[0]), Number(value[1]), Number(value[2])]
  : [...fallback];

const quatTuple = (
  value: readonly number[] | undefined,
  fallback: V3Mesh2MotionDriverQuatTuple = IDENTITY_QUATERNION
): V3Mesh2MotionDriverQuatTuple => finiteTuple(value, 4)
  ? [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])]
  : [...fallback];

const vec3FromTuple = (value: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);

const normalizedQuaternionFromTuple = (value: readonly number[]): THREE.Quaternion => {
  const quaternion = new THREE.Quaternion(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1);
  return quaternion.lengthSq() > 0.000001 ? quaternion.normalize() : new THREE.Quaternion();
};

const tupleFromVector = (value: THREE.Vector3): V3Mesh2MotionDriverVec3Tuple => [value.x, value.y, value.z];

const tupleFromQuaternion = (value: THREE.Quaternion): V3Mesh2MotionDriverQuatTuple => [
  value.x,
  value.y,
  value.z,
  value.w,
];

const restorePartBinding = (binding: V3Mesh2MotionPartBinding): void => {
  binding.partGroup.position.fromArray(binding.restLocalPosition);
  binding.partGroup.quaternion.fromArray(binding.restLocalQuaternion);
  binding.partGroup.rotation.setFromQuaternion(binding.partGroup.quaternion);
  binding.partGroup.scale.fromArray(binding.restLocalScale);
};

export function getV3Mesh2MotionDriverRig(model: THREE.Group): V3Mesh2MotionDriverRig {
  const cached = model.userData.v3Mesh2MotionDriverRig as V3Mesh2MotionDriverRig | undefined;
  if (cached?.root.parent === model) return cached;

  const warnings: string[] = [];
  const root = new THREE.Group();
  root.name = 'v3Mesh2MotionDriverRoot';
  root.visible = false;
  root.userData.v3Mesh2MotionDriverRoot = true;
  model.add(root);

  const generatedJoints = V3_MESH2MOTION_CLIP_SET.skeleton.joints as readonly GeneratedSkeletonJoint[];
  const joints: Record<string, V3Mesh2MotionDriverJoint> = {};
  for (const sourceJoint of generatedJoints) {
    const object = new THREE.Group();
    const restLocalPosition = vec3Tuple(sourceJoint.restLocalPosition);
    const restLocalQuaternion = quatTuple(sourceJoint.restLocalQuaternion);
    object.name = `v3Mesh2MotionDriverBone:${sourceJoint.name}`;
    object.userData.v3Mesh2MotionDriverJoint = sourceJoint.name;
    object.position.fromArray(restLocalPosition);
    object.quaternion.fromArray(restLocalQuaternion);
    object.rotation.setFromQuaternion(object.quaternion);
    joints[sourceJoint.name] = {
      name: sourceJoint.name,
      parentName: sourceJoint.parent,
      object,
      restLocalPosition,
      restLocalQuaternion,
    };
  }

  for (const sourceJoint of generatedJoints) {
    const joint = joints[sourceJoint.name];
    const parent = sourceJoint.parent ? joints[sourceJoint.parent]?.object : null;
    (parent ?? root).add(joint.object);
  }

  model.updateMatrixWorld(true);
  const partGroups = model.userData.v3PartGroups as Partial<Record<V3CharacterSlotId, THREE.Group>> | undefined;
  const partBindings: V3Mesh2MotionDriverRig['partBindings'] = {};
  for (const [slot, sourceJointName] of Object.entries(V3_MESH2MOTION_SLOT_DRIVER_JOINTS) as [V3CharacterSlotId, string][]) {
    const partGroup = partGroups?.[slot];
    const driverJoint = joints[sourceJointName];
    if (!partGroup) {
      warnings.push(`V3 Mesh2Motion driver missing part group ${slot}`);
      continue;
    }
    if (!driverJoint) {
      warnings.push(`V3 Mesh2Motion driver missing source joint ${sourceJointName} for ${slot}`);
      continue;
    }
    const bindMatrix = driverJoint.object.matrixWorld.clone().invert().multiply(partGroup.matrixWorld);
    partBindings[slot] = {
      slot,
      sourceJointName,
      partGroup,
      restLocalPosition: tupleFromVector(partGroup.position),
      restLocalQuaternion: tupleFromQuaternion(partGroup.quaternion),
      restLocalScale: tupleFromVector(partGroup.scale),
      bindMatrix,
    };
  }

  const rig: V3Mesh2MotionDriverRig = {
    root,
    ready: warnings.length === 0,
    warnings,
    joints,
    partBindings,
  };
  model.userData.v3Mesh2MotionDriverRig = rig;
  model.userData.v3Mesh2MotionDriverActive = false;
  return rig;
}

export function resetV3Mesh2MotionDriverRigPose(model: THREE.Group): void {
  const rig = model.userData.v3Mesh2MotionDriverRig as V3Mesh2MotionDriverRig | undefined;
  if (!rig) {
    model.userData.v3Mesh2MotionDriverActive = false;
    return;
  }
  for (const joint of Object.values(rig.joints)) {
    joint.object.position.fromArray(joint.restLocalPosition);
    joint.object.quaternion.fromArray(joint.restLocalQuaternion);
    joint.object.rotation.setFromQuaternion(joint.object.quaternion);
    joint.object.scale.set(1, 1, 1);
  }
  for (const binding of Object.values(rig.partBindings)) {
    if (binding) restorePartBinding(binding);
  }
  model.userData.v3Mesh2MotionDriverActive = false;
  model.updateMatrixWorld(true);
}

export function applyV3Mesh2MotionDriverRigPose(
  model: THREE.Group,
  pose: V3Mesh2MotionDriverPose,
  options: { alpha?: number } = {}
): V3Mesh2MotionDriverApplyReport {
  const rig = getV3Mesh2MotionDriverRig(model);
  const alpha = Number.isFinite(options.alpha) ? Math.max(0, Math.min(1, Number(options.alpha))) : 1;
  const warnings = [...rig.warnings];

  for (const joint of Object.values(rig.joints)) {
    const jointPose = pose.joints[joint.name];
    const targetPosition = vec3FromTuple(jointPose?.position ?? joint.restLocalPosition);
    const targetQuaternion = normalizedQuaternionFromTuple(jointPose?.quaternion ?? joint.restLocalQuaternion);
    const restPosition = vec3FromTuple(joint.restLocalPosition);
    const restQuaternion = normalizedQuaternionFromTuple(joint.restLocalQuaternion);

    if (alpha >= 1) {
      joint.object.position.copy(targetPosition);
      joint.object.quaternion.copy(targetQuaternion);
    } else {
      joint.object.position.copy(restPosition).lerp(targetPosition, alpha);
      joint.object.quaternion.copy(restQuaternion).slerp(targetQuaternion, alpha).normalize();
    }
    joint.object.rotation.setFromQuaternion(joint.object.quaternion);
    joint.object.scale.fromArray(ONE_VEC3);
  }

  model.updateMatrixWorld(true);
  for (const binding of Object.values(rig.partBindings)) {
    if (!binding) continue;
    const joint = rig.joints[binding.sourceJointName];
    const parent = binding.partGroup.parent;
    if (!joint || !parent) {
      warnings.push(`V3 Mesh2Motion driver cannot apply ${binding.slot}; missing joint or parent`);
      continue;
    }
    parent.updateMatrixWorld(true);
    const targetWorldMatrix = joint.object.matrixWorld.clone().multiply(binding.bindMatrix);
    const localMatrix = parent.matrixWorld.clone().invert().multiply(targetWorldMatrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    localMatrix.decompose(position, quaternion, scale);
    binding.partGroup.position.copy(position);
    binding.partGroup.quaternion.copy(quaternion.normalize());
    binding.partGroup.rotation.setFromQuaternion(binding.partGroup.quaternion);
    binding.partGroup.scale.copy(scale);
    binding.partGroup.updateMatrixWorld(true);
  }

  model.userData.v3Mesh2MotionDriverActive = true;
  model.userData.v3Mesh2MotionDriverPose = pose;
  model.updateMatrixWorld(true);

  return {
    ready: rig.ready && warnings.length === 0,
    warnings,
    jointCount: Object.keys(rig.joints).length,
    partBindingCount: Object.keys(rig.partBindings).length,
  };
}
