import type {
  V3CharacterSlotId,
  V3QuatTuple,
  V3Vec3Tuple,
} from './v3ModelTypes';

export const V3_MESH2MOTION_ARMOR_RIG_SCHEMA = 'v3-mesh2motion-armor-rig/v1';

export interface V3Mesh2MotionArmorRigSourceSummary {
  kind: 'mesh2motion-glb';
  fileName: string;
  sha256: string;
  generator: string | null;
}

export interface V3Mesh2MotionArmorRigSkeletonJoint {
  name: string;
  parent: string | null;
  restLocalPosition: V3Vec3Tuple;
  restWorldPosition: V3Vec3Tuple;
  restWorldQuaternion: V3QuatTuple;
  restLocalQuaternion: V3QuatTuple;
}

export interface V3Mesh2MotionArmorRigSkeleton {
  sourceJointCount: number;
  joints: readonly V3Mesh2MotionArmorRigSkeletonJoint[];
}

export interface V3Mesh2MotionArmorRigCalibration {
  sourceToTargetScale: number;
}

export interface V3Mesh2MotionArmorSlotSpec {
  slot: V3CharacterSlotId;
  sourceJointName: string;
  endJointName: string | null;
  centerJointNames: readonly string[];
}

export interface V3Mesh2MotionArmorSlotBasis {
  xAxis: V3Vec3Tuple;
  yAxis: V3Vec3Tuple;
  zAxis: V3Vec3Tuple;
  quaternion: V3QuatTuple;
}

export interface V3Mesh2MotionArmorSlotPlacement {
  slot: V3CharacterSlotId;
  sourceJointName: string;
  endJointName: string | null;
  centerJointNames: readonly string[];
  pivotCenter: V3Vec3Tuple;
  pivotWorldPosition: V3Vec3Tuple;
  pivotWorldQuaternion: V3QuatTuple;
  basis: V3Mesh2MotionArmorSlotBasis;
  geometry: {
    position: V3Vec3Tuple;
    rotation: V3Vec3Tuple;
    scale: V3Vec3Tuple;
  };
}

export interface V3Mesh2MotionArmorRigArtifact {
  schemaVersion: typeof V3_MESH2MOTION_ARMOR_RIG_SCHEMA;
  version: 1;
  source: V3Mesh2MotionArmorRigSourceSummary;
  calibration: V3Mesh2MotionArmorRigCalibration;
  skeleton: V3Mesh2MotionArmorRigSkeleton;
  slots: Readonly<Record<V3CharacterSlotId, V3Mesh2MotionArmorSlotPlacement>>;
}

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

export const V3_MESH2MOTION_ARMOR_SLOT_SPECS = {
  helmet: {
    slot: 'helmet',
    sourceJointName: 'head',
    endJointName: 'head_leaf',
    centerJointNames: ['head', 'head_leaf'],
  },
  neck: {
    slot: 'neck',
    sourceJointName: 'neck_01',
    endJointName: 'head',
    centerJointNames: ['neck_01', 'head'],
  },
  chest: {
    slot: 'chest',
    sourceJointName: 'spine_03',
    endJointName: 'neck_01',
    centerJointNames: ['spine_03', 'neck_01'],
  },
  shoulderLeft: {
    slot: 'shoulderLeft',
    sourceJointName: 'clavicle_l',
    endJointName: 'upperarm_l',
    centerJointNames: ['clavicle_l', 'upperarm_l'],
  },
  shoulderRight: {
    slot: 'shoulderRight',
    sourceJointName: 'clavicle_r',
    endJointName: 'upperarm_r',
    centerJointNames: ['clavicle_r', 'upperarm_r'],
  },
  upperArmLeft: {
    slot: 'upperArmLeft',
    sourceJointName: 'upperarm_l',
    endJointName: 'lowerarm_l',
    centerJointNames: ['upperarm_l', 'lowerarm_l'],
  },
  upperArmRight: {
    slot: 'upperArmRight',
    sourceJointName: 'upperarm_r',
    endJointName: 'lowerarm_r',
    centerJointNames: ['upperarm_r', 'lowerarm_r'],
  },
  forearmLeft: {
    slot: 'forearmLeft',
    sourceJointName: 'lowerarm_l',
    endJointName: 'hand_l',
    centerJointNames: ['lowerarm_l', 'hand_l'],
  },
  forearmRight: {
    slot: 'forearmRight',
    sourceJointName: 'lowerarm_r',
    endJointName: 'hand_r',
    centerJointNames: ['lowerarm_r', 'hand_r'],
  },
  handLeft: {
    slot: 'handLeft',
    sourceJointName: 'hand_l',
    endJointName: 'index_01_l',
    centerJointNames: ['hand_l', 'index_01_l', 'middle_01_l', 'ring_01_l', 'pinky_01_l', 'thumb_01_l'],
  },
  handRight: {
    slot: 'handRight',
    sourceJointName: 'hand_r',
    endJointName: 'index_01_r',
    centerJointNames: ['hand_r', 'index_01_r', 'middle_01_r', 'ring_01_r', 'pinky_01_r', 'thumb_01_r'],
  },
  pelvis: {
    slot: 'pelvis',
    sourceJointName: 'pelvis',
    endJointName: 'spine_01',
    centerJointNames: ['pelvis', 'spine_01'],
  },
  thighLeft: {
    slot: 'thighLeft',
    sourceJointName: 'thigh_l',
    endJointName: 'calf_l',
    centerJointNames: ['thigh_l', 'calf_l'],
  },
  thighRight: {
    slot: 'thighRight',
    sourceJointName: 'thigh_r',
    endJointName: 'calf_r',
    centerJointNames: ['thigh_r', 'calf_r'],
  },
  shinLeft: {
    slot: 'shinLeft',
    sourceJointName: 'calf_l',
    endJointName: 'foot_l',
    centerJointNames: ['calf_l', 'foot_l'],
  },
  shinRight: {
    slot: 'shinRight',
    sourceJointName: 'calf_r',
    endJointName: 'foot_r',
    centerJointNames: ['calf_r', 'foot_r'],
  },
  footLeft: {
    slot: 'footLeft',
    sourceJointName: 'foot_l',
    endJointName: 'ball_l',
    centerJointNames: ['foot_l', 'ball_l'],
  },
  footRight: {
    slot: 'footRight',
    sourceJointName: 'foot_r',
    endJointName: 'ball_r',
    centerJointNames: ['foot_r', 'ball_r'],
  },
  back: {
    slot: 'back',
    sourceJointName: 'spine_03',
    endJointName: null,
    centerJointNames: ['spine_03'],
  },
} as const satisfies Record<V3CharacterSlotId, V3Mesh2MotionArmorSlotSpec>;

export const V3_MESH2MOTION_PART_BINDING_SPECS = V3_MESH2MOTION_ARMOR_SLOT_SPECS;

export const V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOTS = [
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'handLeft',
  'handRight',
] as const satisfies readonly V3CharacterSlotId[];

const V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOT_SET = new Set<V3CharacterSlotId>(
  V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOTS
);

export const isV3Mesh2MotionNativeArmChainSlot = (slot: V3CharacterSlotId): boolean =>
  V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOT_SET.has(slot);

export const V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS = [
  ...V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOTS,
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
  'footLeft',
  'footRight',
] as const satisfies readonly V3CharacterSlotId[];

const V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOT_SET = new Set<V3CharacterSlotId>(
  V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS
);

export const isV3Mesh2MotionNativeLimbChainSlot = (slot: V3CharacterSlotId): boolean =>
  V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOT_SET.has(slot);
