import * as THREE from 'three';
import type { V3CharacterSlotId } from '../v3/v3ModelTypes';
import { V3_MESH2MOTION_CLIP_SET } from './v3Mesh2MotionClips.generated';
import {
  getV3Mesh2MotionCalibration,
  type V3Mesh2MotionCalibration,
  type V3Mesh2MotionCalibrationVec3,
  type V3Mesh2MotionTransformCalibration,
} from './v3Mesh2MotionCalibration';

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

export type V3Mesh2MotionDriverWeaponSocketName = 'rightHandGrip' | 'leftHandGrip';

export interface V3Mesh2MotionDriverWeaponSocket {
  name: V3Mesh2MotionDriverWeaponSocketName;
  sourceJointName: string;
  slot: Extract<V3CharacterSlotId, 'handRight' | 'handLeft'>;
  object: THREE.Group;
  restLocalPosition: V3Mesh2MotionDriverVec3Tuple;
}

export interface V3Mesh2MotionDriverRig {
  root: THREE.Group;
  ready: boolean;
  warnings: string[];
  joints: Record<string, V3Mesh2MotionDriverJoint>;
  partBindings: Partial<Record<V3CharacterSlotId, V3Mesh2MotionPartBinding>>;
  weaponSockets: Record<V3Mesh2MotionDriverWeaponSocketName, V3Mesh2MotionDriverWeaponSocket>;
}

export interface V3Mesh2MotionDriverApplyReport {
  ready: boolean;
  warnings: string[];
  jointCount: number;
  partBindingCount: number;
}

export interface V3Mesh2MotionDriverCalibrationReport {
  calibrationVersion: V3Mesh2MotionCalibration['version'];
  armSpread: V3Mesh2MotionCalibration['armSpread'];
  calibratedJointOffsetCount: number;
  driverJointAdjustmentCount: number;
  partBindingAdjustmentCount: number;
  postBindPartAdjustments: number;
  weaponSocketAdjustmentCount: number;
}

export interface V3Mesh2MotionDriverWeaponSocketWorldTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
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

const V3_MESH2MOTION_DRIVER_WEAPON_SOCKETS = {
  rightHandGrip: { slot: 'handRight', sourceJointName: 'hand_r' },
  leftHandGrip: { slot: 'handLeft', sourceJointName: 'hand_l' },
} as const satisfies Record<
  V3Mesh2MotionDriverWeaponSocketName,
  { slot: Extract<V3CharacterSlotId, 'handRight' | 'handLeft'>; sourceJointName: string }
>;

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

const worldBoxCenter = (object: THREE.Object3D): THREE.Vector3 =>
  new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

const createDriverWeaponSockets = (
  joints: Record<string, V3Mesh2MotionDriverJoint>,
  partBindings: Partial<Record<V3CharacterSlotId, V3Mesh2MotionPartBinding>>,
  warnings: string[]
): Record<V3Mesh2MotionDriverWeaponSocketName, V3Mesh2MotionDriverWeaponSocket> => {
  const sockets = {} as Record<V3Mesh2MotionDriverWeaponSocketName, V3Mesh2MotionDriverWeaponSocket>;
  for (const [name, spec] of Object.entries(V3_MESH2MOTION_DRIVER_WEAPON_SOCKETS) as [
    V3Mesh2MotionDriverWeaponSocketName,
    (typeof V3_MESH2MOTION_DRIVER_WEAPON_SOCKETS)[V3Mesh2MotionDriverWeaponSocketName],
  ][]) {
    const joint = joints[spec.sourceJointName];
    const binding = partBindings[spec.slot];
    const socket = new THREE.Group();
    socket.name = `v3Mesh2MotionDriverSocket:${name}`;
    socket.userData.v3Mesh2MotionDriverWeaponSocket = name;
    if (!joint || !binding) {
      warnings.push(`V3 Mesh2Motion driver missing ${name} weapon socket binding`);
      sockets[name] = {
        name,
        sourceJointName: spec.sourceJointName,
        slot: spec.slot,
        object: socket,
        restLocalPosition: [...ZERO_VEC3],
      };
      continue;
    }
    joint.object.updateWorldMatrix(true, false);
    const centerWorld = worldBoxCenter(binding.partGroup);
    const restLocalPosition = tupleFromVector(joint.object.worldToLocal(centerWorld.clone()));
    socket.position.fromArray(restLocalPosition);
    joint.object.add(socket);
    sockets[name] = {
      name,
      sourceJointName: spec.sourceJointName,
      slot: spec.slot,
      object: socket,
      restLocalPosition,
    };
  }
  return sockets;
};

const addVec3Tuple = (
  value: THREE.Vector3,
  offset: V3Mesh2MotionCalibrationVec3
): void => {
  value.x += offset[0];
  value.y += offset[1];
  value.z += offset[2];
};

const quaternionFromRotationTuple = (rotation: V3Mesh2MotionCalibrationVec3): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, 'XYZ')).normalize();

const adjustmentMatrix = (adjustment: V3Mesh2MotionTransformCalibration): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    vec3FromTuple(adjustment.position),
    quaternionFromRotationTuple(adjustment.rotation),
    vec3FromTuple(ONE_VEC3)
  );

const applyDriverCalibration = (
  model: THREE.Group,
  rig: V3Mesh2MotionDriverRig,
  pose: V3Mesh2MotionDriverPose,
  calibration: V3Mesh2MotionCalibration
): V3Mesh2MotionDriverCalibrationReport => {
  const report: V3Mesh2MotionDriverCalibrationReport = {
    calibrationVersion: calibration.version,
    armSpread: { ...calibration.armSpread },
    calibratedJointOffsetCount: 0,
    driverJointAdjustmentCount: 0,
    partBindingAdjustmentCount: 0,
    postBindPartAdjustments: 0,
    weaponSocketAdjustmentCount: 0,
  };
  if (pose.sourceClipName === 'TPose') return report;

  const modelRight = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  const applyOutwardChainSpread = (
    joint: V3Mesh2MotionDriverJoint | undefined,
    amount: number,
    side: 1 | -1
  ): void => {
    if (!joint?.object.parent) return;
    joint.object.parent.updateWorldMatrix(true, false);
    const parentWorldQuaternion = joint.object.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const localDelta = modelRight.clone()
      .multiplyScalar(amount * side)
      .applyQuaternion(parentWorldQuaternion);
    joint.object.position.add(localDelta);
  };

  const leftClavicle = rig.joints.clavicle_l;
  const rightClavicle = rig.joints.clavicle_r;
  applyOutwardChainSpread(leftClavicle, calibration.armSpread.left, 1);
  applyOutwardChainSpread(rightClavicle, calibration.armSpread.right, -1);

  for (const [jointName, adjustment] of Object.entries(calibration.driverJoints)) {
    const joint = rig.joints[jointName];
    if (!joint || !adjustment) continue;
    addVec3Tuple(joint.object.position, adjustment.position);
    joint.object.quaternion.multiply(quaternionFromRotationTuple(adjustment.rotation)).normalize();
    joint.object.rotation.setFromQuaternion(joint.object.quaternion);
    report.calibratedJointOffsetCount += 1;
    report.driverJointAdjustmentCount += 1;
  }
  return report;
};

const applyDriverWeaponSocketCalibration = (
  rig: V3Mesh2MotionDriverRig,
  calibration: V3Mesh2MotionCalibration
): number => {
  let count = 0;
  for (const [socketName, socket] of Object.entries(rig.weaponSockets) as [
    V3Mesh2MotionDriverWeaponSocketName,
    V3Mesh2MotionDriverWeaponSocket,
  ][]) {
    const adjustment = calibration.weaponSockets[socketName];
    socket.object.position.fromArray(socket.restLocalPosition);
    socket.object.quaternion.identity();
    if (!adjustment) {
      socket.object.rotation.setFromQuaternion(socket.object.quaternion);
      continue;
    }
    addVec3Tuple(socket.object.position, adjustment.position);
    socket.object.quaternion.copy(quaternionFromRotationTuple(adjustment.rotation));
    socket.object.rotation.setFromQuaternion(socket.object.quaternion);
    count += 1;
  }
  return count;
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
  const weaponSockets = createDriverWeaponSockets(joints, partBindings, warnings);

  const rig: V3Mesh2MotionDriverRig = {
    root,
    ready: warnings.length === 0,
    warnings,
    joints,
    partBindings,
    weaponSockets,
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
  for (const socket of Object.values(rig.weaponSockets)) {
    socket.object.position.fromArray(socket.restLocalPosition);
    socket.object.quaternion.identity();
    socket.object.scale.set(1, 1, 1);
  }
  for (const binding of Object.values(rig.partBindings)) {
    if (binding) restorePartBinding(binding);
  }
  model.userData.v3Mesh2MotionDriverActive = false;
  delete model.userData.v3Mesh2MotionDriverCalibrationReport;
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
  const calibration = getV3Mesh2MotionCalibration();

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
  const calibrationReport = applyDriverCalibration(model, rig, pose, calibration);
  calibrationReport.weaponSocketAdjustmentCount = applyDriverWeaponSocketCalibration(rig, calibration);

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
    const bindingAdjustment = calibration.partBindings[binding.slot];
    if (bindingAdjustment) {
      targetWorldMatrix.multiply(adjustmentMatrix(bindingAdjustment));
      calibrationReport.partBindingAdjustmentCount += 1;
      calibrationReport.postBindPartAdjustments += 1;
    }
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

  model.updateMatrixWorld(true);
  model.userData.v3Mesh2MotionDriverActive = true;
  model.userData.v3Mesh2MotionDriverPose = pose;
  model.userData.v3Mesh2MotionDriverCalibrationReport = calibrationReport;
  model.updateMatrixWorld(true);

  return {
    ready: rig.ready && warnings.length === 0,
    warnings,
    jointCount: Object.keys(rig.joints).length,
    partBindingCount: Object.keys(rig.partBindings).length,
  };
}

export function getV3Mesh2MotionDriverWeaponSocketWorldPosition(
  model: THREE.Group,
  socketName: V3Mesh2MotionDriverWeaponSocketName
): THREE.Vector3 | null {
  return getV3Mesh2MotionDriverWeaponSocketWorldTransform(model, socketName)?.position ?? null;
}

export function getV3Mesh2MotionDriverWeaponSocketWorldTransform(
  model: THREE.Group,
  socketName: V3Mesh2MotionDriverWeaponSocketName
): V3Mesh2MotionDriverWeaponSocketWorldTransform | null {
  const rig = getV3Mesh2MotionDriverRig(model);
  const socket = rig.weaponSockets[socketName];
  if (!socket) return null;
  model.updateMatrixWorld(true);
  socket.object.updateWorldMatrix(true, false);
  return {
    position: socket.object.getWorldPosition(new THREE.Vector3()),
    quaternion: socket.object.getWorldQuaternion(new THREE.Quaternion()).normalize(),
  };
}
