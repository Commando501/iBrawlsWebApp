import type * as THREE from 'three';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import type { V3ExactSource } from './v3ExactSourceLod';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3Vec3Tuple,
} from './v3ModelTypes';
import {
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';

type V3ExactSourceSlotBounds = V3ExactSource['slots'][V3CharacterSlotId]['bounds'];

export const V3_CANONICAL_JOINT_NAMES = [
  'root',
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderLeft',
  'elbowLeft',
  'wristLeft',
  'gripLeft',
  'shoulderRight',
  'elbowRight',
  'wristRight',
  'gripRight',
  'hipLeft',
  'kneeLeft',
  'ankleLeft',
  'toeLeft',
  'hipRight',
  'kneeRight',
  'ankleRight',
  'toeRight',
  'backMount',
] as const;

export type V3CanonicalJointName = (typeof V3_CANONICAL_JOINT_NAMES)[number];

export interface V3CanonicalJoint {
  name: V3CanonicalJointName;
  position: V3Vec3Tuple;
  sourceSlots: readonly V3CharacterSlotId[];
}

export interface V3CanonicalSlotPivot {
  slot: V3CharacterSlotId;
  detailBone: V3DetailBoneName;
  position: V3Vec3Tuple;
  bounds: {
    min: V3Vec3Tuple;
    max: V3Vec3Tuple;
    size: V3Vec3Tuple;
  };
}

export interface V3CanonicalSlotGeometryOffset {
  slot: V3CharacterSlotId;
  pivot: V3Vec3Tuple;
  geometryCenter: V3Vec3Tuple;
  offsetFromPivot: V3Vec3Tuple;
}

export interface V3CanonicalRigContract {
  kind: 'v3-canonical-rig-contract';
  version: 1;
  sourceHash: string;
  voxelScale: number;
  sourcePivot: V3Vec3Tuple;
  joints: Record<V3CanonicalJointName, V3CanonicalJoint>;
  slotPivots: Record<V3CharacterSlotId, V3CanonicalSlotPivot>;
  slotGeometryOffsets: Record<V3CharacterSlotId, V3CanonicalSlotGeometryOffset>;
}

export interface V3CanonicalRigContractSlotReport {
  slot: V3CharacterSlotId;
  ready: boolean;
  issues: string[];
}

export interface V3CanonicalRigContractReport {
  kind: 'v3-canonical-rig-contract-analysis';
  version: 1;
  ready: boolean;
  sourceHash: string | null;
  boundSlotCount: number;
  issues: string[];
  slots: Record<V3CharacterSlotId, V3CanonicalRigContractSlotReport>;
}

type V3PartGroupMap = Partial<Record<V3CharacterSlotId, THREE.Object3D>>;

const roundFinite = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(6));
};

const cloneVec3 = (value: readonly number[]): V3Vec3Tuple => [
  roundFinite(value[0] ?? 0),
  roundFinite(value[1] ?? 0),
  roundFinite(value[2] ?? 0),
];

const cloneBounds = (bounds: V3ExactSourceSlotBounds): V3CanonicalSlotPivot['bounds'] => ({
  min: cloneVec3(bounds.min),
  max: cloneVec3(bounds.max),
  size: cloneVec3(bounds.size),
});

const subtractVec3 = (left: readonly number[], right: readonly number[]): V3Vec3Tuple => [
  roundFinite(left[0] - right[0]),
  roundFinite(left[1] - right[1]),
  roundFinite(left[2] - right[2]),
];

const midpoint = (left: readonly number[], right: readonly number[]): V3Vec3Tuple => [
  roundFinite((left[0] + right[0]) / 2),
  roundFinite((left[1] + right[1]) / 2),
  roundFinite((left[2] + right[2]) / 2),
];

const sortedSlots = (): V3CharacterSlotId[] =>
  [...V3_CHARACTER_SLOT_IDS].sort((left, right) => left.localeCompare(right));

const sortedJointNames = (): V3CanonicalJointName[] =>
  [...V3_CANONICAL_JOINT_NAMES].sort((left, right) => left.localeCompare(right));

const pointInSlotBounds = (
  source: V3ExactSource,
  slot: V3CharacterSlotId,
  xRatio: number,
  yRatio: number,
  zRatio: number
): V3Vec3Tuple => {
  const bounds = source.slots[slot].bounds;
  const pivot = source.coordinateSystem.pivot;
  const scale = source.coordinateSystem.voxelScale;
  const x = bounds.min[0] + (bounds.max[0] - bounds.min[0]) * xRatio;
  const y = bounds.min[1] + (bounds.max[1] - bounds.min[1]) * yRatio;
  const z = bounds.min[2] + (bounds.max[2] - bounds.min[2]) * zRatio;

  return [
    roundFinite((x - pivot[0]) * scale),
    roundFinite(y * scale),
    roundFinite((z - pivot[2]) * scale),
  ];
};

const slotCenterWorld = (source: V3ExactSource, slot: V3CharacterSlotId): V3Vec3Tuple =>
  pointInSlotBounds(source, slot, 0.5, 0.5, 0.5);

const makeJoint = (
  name: V3CanonicalJointName,
  position: V3Vec3Tuple,
  sourceSlots: readonly V3CharacterSlotId[]
): V3CanonicalJoint => ({
  name,
  position: cloneVec3(position),
  sourceSlots: [...sourceSlots].sort((left, right) => left.localeCompare(right)),
});

const verticalSeam = (
  source: V3ExactSource,
  upperSlot: V3CharacterSlotId,
  lowerSlot: V3CharacterSlotId
): V3Vec3Tuple => midpoint(
  pointInSlotBounds(source, upperSlot, 0.5, 0, 0.5),
  pointInSlotBounds(source, lowerSlot, 0.5, 1, 0.5)
);

const sideSeam = (
  source: V3ExactSource,
  centerSlot: V3CharacterSlotId,
  sideSlot: V3CharacterSlotId,
  side: 'left' | 'right'
): V3Vec3Tuple => midpoint(
  pointInSlotBounds(source, centerSlot, side === 'left' ? 0 : 1, 0.75, 0.5),
  slotCenterWorld(source, sideSlot)
);

const deriveJoints = (
  source: V3ExactSource
): Record<V3CanonicalJointName, V3CanonicalJoint> => {
  const joints = {} as Record<V3CanonicalJointName, V3CanonicalJoint>;
  const setJoint = (
    name: V3CanonicalJointName,
    position: V3Vec3Tuple,
    sourceSlots: readonly V3CharacterSlotId[]
  ) => {
    joints[name] = makeJoint(name, position, sourceSlots);
  };

  setJoint('root', slotCenterWorld(source, 'pelvis'), ['pelvis']);
  setJoint('pelvis', slotCenterWorld(source, 'pelvis'), ['pelvis']);
  setJoint('spine', verticalSeam(source, 'chest', 'pelvis'), ['chest', 'pelvis']);
  setJoint('chest', slotCenterWorld(source, 'chest'), ['chest']);
  setJoint('neck', verticalSeam(source, 'neck', 'chest'), ['chest', 'neck']);
  setJoint('head', verticalSeam(source, 'helmet', 'neck'), ['helmet', 'neck']);
  setJoint('backMount', slotCenterWorld(source, 'back'), ['back']);

  setJoint('shoulderLeft', sideSeam(source, 'chest', 'shoulderLeft', 'left'), ['chest', 'shoulderLeft']);
  setJoint('elbowLeft', verticalSeam(source, 'upperArmLeft', 'forearmLeft'), ['forearmLeft', 'upperArmLeft']);
  setJoint('wristLeft', verticalSeam(source, 'forearmLeft', 'handLeft'), ['forearmLeft', 'handLeft']);
  setJoint('gripLeft', slotCenterWorld(source, 'handLeft'), ['handLeft']);
  setJoint('hipLeft', verticalSeam(source, 'pelvis', 'thighLeft'), ['pelvis', 'thighLeft']);
  setJoint('kneeLeft', verticalSeam(source, 'thighLeft', 'shinLeft'), ['shinLeft', 'thighLeft']);
  setJoint('ankleLeft', verticalSeam(source, 'shinLeft', 'footLeft'), ['footLeft', 'shinLeft']);
  setJoint('toeLeft', pointInSlotBounds(source, 'footLeft', 0.5, 0, 1), ['footLeft']);

  setJoint('shoulderRight', sideSeam(source, 'chest', 'shoulderRight', 'right'), ['chest', 'shoulderRight']);
  setJoint('elbowRight', verticalSeam(source, 'upperArmRight', 'forearmRight'), ['forearmRight', 'upperArmRight']);
  setJoint('wristRight', verticalSeam(source, 'forearmRight', 'handRight'), ['forearmRight', 'handRight']);
  setJoint('gripRight', slotCenterWorld(source, 'handRight'), ['handRight']);
  setJoint('hipRight', verticalSeam(source, 'pelvis', 'thighRight'), ['pelvis', 'thighRight']);
  setJoint('kneeRight', verticalSeam(source, 'thighRight', 'shinRight'), ['shinRight', 'thighRight']);
  setJoint('ankleRight', verticalSeam(source, 'shinRight', 'footRight'), ['footRight', 'shinRight']);
  setJoint('toeRight', pointInSlotBounds(source, 'footRight', 0.5, 0, 1), ['footRight']);

  return Object.fromEntries(sortedJointNames().map((name) => [name, joints[name]])) as Record<
    V3CanonicalJointName,
    V3CanonicalJoint
  >;
};

const slotPivotFromJoints = (
  slot: V3CharacterSlotId,
  joints: Record<V3CanonicalJointName, V3CanonicalJoint>
): V3Vec3Tuple => {
  switch (slot) {
    case 'helmet':
      return cloneVec3(joints.head.position);
    case 'neck':
      return cloneVec3(joints.neck.position);
    case 'chest':
      return cloneVec3(joints.chest.position);
    case 'back':
      return cloneVec3(joints.backMount.position);
    case 'shoulderLeft':
    case 'upperArmLeft':
      return cloneVec3(joints.shoulderLeft.position);
    case 'shoulderRight':
    case 'upperArmRight':
      return cloneVec3(joints.shoulderRight.position);
    case 'forearmLeft':
      return cloneVec3(joints.elbowLeft.position);
    case 'forearmRight':
      return cloneVec3(joints.elbowRight.position);
    case 'handLeft':
      return cloneVec3(joints.wristLeft.position);
    case 'handRight':
      return cloneVec3(joints.wristRight.position);
    case 'pelvis':
      return cloneVec3(joints.pelvis.position);
    case 'thighLeft':
      return cloneVec3(joints.hipLeft.position);
    case 'thighRight':
      return cloneVec3(joints.hipRight.position);
    case 'shinLeft':
      return cloneVec3(joints.kneeLeft.position);
    case 'shinRight':
      return cloneVec3(joints.kneeRight.position);
    case 'footLeft':
      return cloneVec3(joints.ankleLeft.position);
    case 'footRight':
      return cloneVec3(joints.ankleRight.position);
  }
};

function findPartGroup(model: THREE.Object3D, slot: V3CharacterSlotId): THREE.Object3D | undefined {
  const partGroups = model.userData.v3PartGroups as V3PartGroupMap | undefined;
  if (partGroups?.[slot]) return partGroups[slot];

  let found: THREE.Object3D | undefined;
  model.traverse((object) => {
    if (!found && object.userData.v3Slot === slot) {
      found = object;
    }
  });
  return found;
}

export function deriveV3CanonicalRigContract(
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3CanonicalRigContract {
  const joints = deriveJoints(source);
  const slotPivots = {} as Record<V3CharacterSlotId, V3CanonicalSlotPivot>;
  const slotGeometryOffsets = {} as Record<V3CharacterSlotId, V3CanonicalSlotGeometryOffset>;

  for (const slot of sortedSlots()) {
    const position = slotPivotFromJoints(slot, joints);
    const geometryCenter = slotCenterWorld(source, slot);
    slotPivots[slot] = {
      slot,
      detailBone: V3_SLOT_DETAIL_BONES[slot],
      position,
      bounds: cloneBounds(source.slots[slot].bounds),
    };
    slotGeometryOffsets[slot] = {
      slot,
      pivot: position,
      geometryCenter,
      offsetFromPivot: subtractVec3(geometryCenter, position),
    };
  }

  return {
    kind: 'v3-canonical-rig-contract',
    version: 1,
    sourceHash: source.source.hash,
    voxelScale: roundFinite(source.coordinateSystem.voxelScale),
    sourcePivot: cloneVec3(source.coordinateSystem.pivot),
    joints,
    slotPivots,
    slotGeometryOffsets,
  };
}

export function applyV3CanonicalRigContract(
  model: THREE.Object3D,
  contract: V3CanonicalRigContract = deriveV3CanonicalRigContract()
): V3CanonicalRigContract {
  model.userData.v3CanonicalRigContract = contract;
  model.userData.v3SlotPivots = contract.slotPivots;
  model.userData.v3SlotGeometryOffsets = contract.slotGeometryOffsets;

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const partGroup = findPartGroup(model, slot);
    if (!partGroup) continue;
    partGroup.userData.v3CanonicalRigContract = contract;
    partGroup.userData.v3CanonicalSlotPivot = contract.slotPivots[slot];
    partGroup.userData.v3CanonicalSlotGeometryOffset = contract.slotGeometryOffsets[slot];
  }

  return contract;
}

export function analyzeV3CanonicalRigContract(
  model: THREE.Object3D
): V3CanonicalRigContractReport {
  const contract = model.userData.v3CanonicalRigContract as V3CanonicalRigContract | undefined;
  const slotPivots = model.userData.v3SlotPivots as V3CanonicalRigContract['slotPivots'] | undefined;
  const slotGeometryOffsets = model.userData.v3SlotGeometryOffsets as
    V3CanonicalRigContract['slotGeometryOffsets'] | undefined;
  const partGroups = model.userData.v3PartGroups as V3PartGroupMap | undefined;
  const issues: string[] = [];
  const slots = {} as Record<V3CharacterSlotId, V3CanonicalRigContractSlotReport>;
  let boundSlotCount = 0;

  if (!contract) issues.push('model is missing v3CanonicalRigContract metadata');
  if (!slotPivots) issues.push('model is missing v3SlotPivots metadata');
  if (!slotGeometryOffsets) issues.push('model is missing v3SlotGeometryOffsets metadata');
  if (!partGroups) issues.push('model is missing v3PartGroups metadata');

  for (const slot of sortedSlots()) {
    const slotIssues: string[] = [];
    const partGroup = findPartGroup(model, slot);
    const slotPivot = slotPivots?.[slot];
    const slotOffset = slotGeometryOffsets?.[slot];

    if (!contract?.slotPivots[slot]) slotIssues.push(`${slot} is missing canonical slot pivot`);
    if (!contract?.slotGeometryOffsets[slot]) slotIssues.push(`${slot} is missing canonical geometry offset`);
    if (!slotPivot) slotIssues.push(`${slot} is missing v3SlotPivots entry`);
    if (!slotOffset) slotIssues.push(`${slot} is missing v3SlotGeometryOffsets entry`);
    if (!partGroup) slotIssues.push(`${slot} is missing part group`);
    if (partGroup && contract && partGroup.userData.v3CanonicalRigContract !== contract) {
      slotIssues.push(`${slot} part group is not linked to the canonical contract`);
    }
    if (partGroup && slotPivot && partGroup.userData.v3CanonicalSlotPivot !== slotPivot) {
      slotIssues.push(`${slot} part group is not linked to its canonical pivot`);
    }
    if (partGroup && slotOffset && partGroup.userData.v3CanonicalSlotGeometryOffset !== slotOffset) {
      slotIssues.push(`${slot} part group is not linked to its canonical geometry offset`);
    }

    if (slotIssues.length === 0) boundSlotCount += 1;
    slots[slot] = {
      slot,
      ready: slotIssues.length === 0,
      issues: slotIssues,
    };
    issues.push(...slotIssues);
  }

  return {
    kind: 'v3-canonical-rig-contract-analysis',
    version: 1,
    ready: issues.length === 0,
    sourceHash: contract?.sourceHash ?? null,
    boundSlotCount,
    issues,
    slots,
  };
}
