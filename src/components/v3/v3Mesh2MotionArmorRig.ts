import * as THREE from 'three';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import {
  V3_MESH2MOTION_ARMOR_RIG_SCHEMA,
  V3_MESH2MOTION_ARMOR_SLOT_SPECS,
  V3_MESH2MOTION_PART_BINDING_SPECS,
  V3_MESH2MOTION_SLOT_DRIVER_JOINTS,
  type V3Mesh2MotionArmorRigArtifact,
  type V3Mesh2MotionArmorRigSkeletonJoint,
  type V3Mesh2MotionArmorSlotPlacement,
} from './v3Mesh2MotionArmorRigContract';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3QuatTuple,
  type V3Vec3Tuple,
} from './v3ModelTypes';

export {
  V3_MESH2MOTION_ARMOR_RIG_SCHEMA,
  V3_MESH2MOTION_ARMOR_SLOT_SPECS,
  V3_MESH2MOTION_PART_BINDING_SPECS,
  V3_MESH2MOTION_SLOT_DRIVER_JOINTS,
  type V3Mesh2MotionArmorRigArtifact,
  type V3Mesh2MotionArmorRigSkeletonJoint,
  type V3Mesh2MotionArmorSlotPlacement,
} from './v3Mesh2MotionArmorRigContract';

export interface V3Mesh2MotionArmorRigRuntimeJoint {
  name: string;
  parentName: string | null;
  object: THREE.Group;
  restLocalPosition: V3Vec3Tuple;
  restLocalQuaternion: V3QuatTuple;
  restWorldPosition: V3Vec3Tuple;
  restWorldQuaternion: V3QuatTuple;
}

export interface V3Mesh2MotionArmorRigRuntime {
  root: THREE.Group;
  skeletonRoot: THREE.Group;
  armorSlotRoot: THREE.Group;
  joints: Record<string, V3Mesh2MotionArmorRigRuntimeJoint>;
  slotPivots: Record<V3CharacterSlotId, THREE.Group>;
}

export interface V3Mesh2MotionArmorRigAnalysis {
  kind: 'v3-mesh2motion-armor-rig-analysis';
  version: 1;
  ready: boolean;
  slotCount: number;
  jointCount: number;
  issues: string[];
}

const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];
const ONE_VEC3: V3Vec3Tuple = [1, 1, 1];
const IDENTITY_QUATERNION: V3QuatTuple = [0, 0, 0, 1];

const finiteTuple = (value: readonly number[] | undefined, length: number): boolean =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite);

const vec3Tuple = (
  value: readonly number[] | undefined,
  fallback: V3Vec3Tuple = ZERO_VEC3
): V3Vec3Tuple => finiteTuple(value, 3)
  ? [Number(value[0]), Number(value[1]), Number(value[2])]
  : [...fallback] as V3Vec3Tuple;

const quatTuple = (
  value: readonly number[] | undefined,
  fallback: V3QuatTuple = IDENTITY_QUATERNION
): V3QuatTuple => finiteTuple(value, 4)
  ? [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])]
  : [...fallback] as V3QuatTuple;

const normalizedQuaternionTuple = (value: readonly number[] | undefined): V3QuatTuple => {
  const quaternion = new THREE.Quaternion(...quatTuple(value));
  if (quaternion.lengthSq() <= 0.000001) return [...IDENTITY_QUATERNION];
  quaternion.normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

const applyTupleTransform = (
  object: THREE.Object3D,
  position: readonly number[] | undefined,
  quaternion: readonly number[] | undefined,
  scale: readonly number[] | undefined = ONE_VEC3
): void => {
  object.position.fromArray(vec3Tuple(position));
  object.quaternion.fromArray(normalizedQuaternionTuple(quaternion));
  object.rotation.setFromQuaternion(object.quaternion);
  object.scale.fromArray(vec3Tuple(scale, ONE_VEC3));
};

export function buildV3Mesh2MotionArmorRig(
  artifact: V3Mesh2MotionArmorRigArtifact = V3_MESH2MOTION_ARMOR_RIG
): V3Mesh2MotionArmorRigRuntime {
  const root = new THREE.Group();
  root.name = 'v3Mesh2MotionArmorRigRoot';
  root.userData.v3Mesh2MotionArmorRigRoot = true;

  const skeletonRoot = new THREE.Group();
  skeletonRoot.name = 'v3Mesh2MotionSkeletonRoot';
  skeletonRoot.visible = false;
  skeletonRoot.userData.v3Mesh2MotionSkeletonRoot = true;

  const armorSlotRoot = new THREE.Group();
  armorSlotRoot.name = 'v3ArmorSlotRoot';
  armorSlotRoot.userData.v3ArmorSlotRoot = true;

  root.add(skeletonRoot, armorSlotRoot);

  const joints: Record<string, V3Mesh2MotionArmorRigRuntimeJoint> = {};
  for (const sourceJoint of artifact.skeleton.joints) {
    const object = new THREE.Group();
    const restLocalPosition = vec3Tuple(sourceJoint.restLocalPosition);
    const restLocalQuaternion = normalizedQuaternionTuple(sourceJoint.restLocalQuaternion);
    object.name = `v3Mesh2MotionJoint:${sourceJoint.name}`;
    object.userData.v3Mesh2MotionJoint = sourceJoint.name;
    applyTupleTransform(object, restLocalPosition, restLocalQuaternion);
    joints[sourceJoint.name] = {
      name: sourceJoint.name,
      parentName: sourceJoint.parent,
      object,
      restLocalPosition,
      restLocalQuaternion,
      restWorldPosition: vec3Tuple(sourceJoint.restWorldPosition),
      restWorldQuaternion: normalizedQuaternionTuple(sourceJoint.restWorldQuaternion),
    };
  }

  for (const sourceJoint of artifact.skeleton.joints) {
    const joint = joints[sourceJoint.name];
    const parent = sourceJoint.parent ? joints[sourceJoint.parent]?.object : null;
    (parent ?? skeletonRoot).add(joint.object);
  }

  const slotPivots = {} as Record<V3CharacterSlotId, THREE.Group>;
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const placement = artifact.slots[slot];
    const pivot = new THREE.Group();
    pivot.name = `v3:${slot}`;
    pivot.userData.v3Slot = slot;
    pivot.userData.v3Mesh2MotionSlotPivot = true;
    pivot.userData.v3Mesh2MotionSourceJointName = placement.sourceJointName;
    pivot.userData.v3Mesh2MotionEndJointName = placement.endJointName;
    pivot.userData.v3Mesh2MotionCenterJointNames = [...placement.centerJointNames];
    pivot.userData.v3Mesh2MotionSlotBasis = placement.basis;
    pivot.userData.v3Mesh2MotionSlotPlacement = placement;
    applyTupleTransform(pivot, placement.pivotWorldPosition, placement.pivotWorldQuaternion);
    armorSlotRoot.add(pivot);
    slotPivots[slot] = pivot;
  }

  root.userData.v3Mesh2MotionArmorRig = artifact;
  root.userData.v3Mesh2MotionJoints = joints;
  root.userData.v3Mesh2MotionSlotPivots = slotPivots;
  root.updateMatrixWorld(true);

  return {
    root,
    skeletonRoot,
    armorSlotRoot,
    joints,
    slotPivots,
  };
}

export function analyzeV3Mesh2MotionArmorRig(
  artifact: V3Mesh2MotionArmorRigArtifact = V3_MESH2MOTION_ARMOR_RIG
): V3Mesh2MotionArmorRigAnalysis {
  const issues: string[] = [];
  if (artifact.schemaVersion !== V3_MESH2MOTION_ARMOR_RIG_SCHEMA) {
    issues.push(`schemaVersion must be ${V3_MESH2MOTION_ARMOR_RIG_SCHEMA}`);
  }
  if (artifact.version !== 1) issues.push('version must be 1');
  if (!artifact.source?.fileName) issues.push('source fileName is missing');
  if (!/^[a-f0-9]{64}$/.test(artifact.source?.sha256 ?? '')) issues.push('source sha256 is invalid');

  const joints = artifact.skeleton?.joints ?? [];
  const jointNames = new Set(joints.map((joint) => joint.name));
  for (const joint of joints) {
    if (!joint.name) issues.push('skeleton joint is missing a name');
    if (joint.parent && !jointNames.has(joint.parent)) {
      const isSceneParent = joint.name === 'root';
      if (!isSceneParent) issues.push(`${joint.name} parent ${joint.parent} is missing`);
    }
    if (!finiteTuple(joint.restLocalPosition, 3)) issues.push(`${joint.name} restLocalPosition is invalid`);
    if (!finiteTuple(joint.restWorldPosition, 3)) issues.push(`${joint.name} restWorldPosition is invalid`);
    if (!finiteTuple(joint.restLocalQuaternion, 4)) issues.push(`${joint.name} restLocalQuaternion is invalid`);
    if (!finiteTuple(joint.restWorldQuaternion, 4)) issues.push(`${joint.name} restWorldQuaternion is invalid`);
  }

  let slotCount = 0;
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const spec = V3_MESH2MOTION_ARMOR_SLOT_SPECS[slot];
    const placement = artifact.slots?.[slot];
    if (!placement) {
      issues.push(`${slot} placement is missing`);
      continue;
    }
    slotCount += 1;
    if (placement.slot !== slot) issues.push(`${slot} placement has mismatched slot ${placement.slot}`);
    if (placement.sourceJointName !== spec.sourceJointName) {
      issues.push(`${slot} source joint ${placement.sourceJointName} does not match ${spec.sourceJointName}`);
    }
    if (placement.endJointName !== spec.endJointName) {
      issues.push(`${slot} end joint ${placement.endJointName ?? 'none'} does not match ${spec.endJointName ?? 'none'}`);
    }
    if (!jointNames.has(placement.sourceJointName)) {
      issues.push(`${slot} source joint ${placement.sourceJointName} is missing from skeleton`);
    }
    if (placement.endJointName && !jointNames.has(placement.endJointName)) {
      issues.push(`${slot} end joint ${placement.endJointName} is missing from skeleton`);
    }
    for (const centerJointName of placement.centerJointNames) {
      if (!jointNames.has(centerJointName)) issues.push(`${slot} center joint ${centerJointName} is missing from skeleton`);
    }
    if (!finiteTuple(placement.pivotCenter, 3)) issues.push(`${slot} pivotCenter is invalid`);
    if (!finiteTuple(placement.pivotWorldPosition, 3)) issues.push(`${slot} pivotWorldPosition is invalid`);
    if (!finiteTuple(placement.pivotWorldQuaternion, 4)) issues.push(`${slot} pivotWorldQuaternion is invalid`);
    const pivotQuaternion = new THREE.Quaternion(...quatTuple(placement.pivotWorldQuaternion));
    if (Math.abs(pivotQuaternion.length() - 1) > 0.000001) {
      issues.push(`${slot} pivotWorldQuaternion is not normalized`);
    }
    if (!finiteTuple(placement.basis?.xAxis, 3)) issues.push(`${slot} basis xAxis is invalid`);
    if (!finiteTuple(placement.basis?.yAxis, 3)) issues.push(`${slot} basis yAxis is invalid`);
    if (!finiteTuple(placement.basis?.zAxis, 3)) issues.push(`${slot} basis zAxis is invalid`);
    if (!finiteTuple(placement.basis?.quaternion, 4)) issues.push(`${slot} basis quaternion is invalid`);
    const basisQuaternion = new THREE.Quaternion(...quatTuple(placement.basis?.quaternion));
    if (Math.abs(basisQuaternion.length() - 1) > 0.000001) {
      issues.push(`${slot} basis quaternion is not normalized`);
    }
    if (!finiteTuple(placement.geometry.position, 3)) issues.push(`${slot} geometry position is invalid`);
    if (!finiteTuple(placement.geometry.rotation, 3)) issues.push(`${slot} geometry rotation is invalid`);
    if (!finiteTuple(placement.geometry.scale, 3)) issues.push(`${slot} geometry scale is invalid`);
  }

  return {
    kind: 'v3-mesh2motion-armor-rig-analysis',
    version: 1,
    ready: issues.length === 0,
    slotCount,
    jointCount: joints.length,
    issues,
  };
}
