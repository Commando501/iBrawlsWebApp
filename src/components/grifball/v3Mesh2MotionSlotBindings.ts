import type { V3CharacterSlotId } from '../v3/v3ModelTypes';

export interface V3Mesh2MotionPartBindingSpec {
  slot: V3CharacterSlotId;
  sourceJointName: string;
  centerJointNames: readonly string[];
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

export const V3_MESH2MOTION_PART_BINDING_SPECS = {
  helmet: {
    slot: 'helmet',
    sourceJointName: 'head',
    centerJointNames: ['head', 'head_leaf'],
  },
  neck: {
    slot: 'neck',
    sourceJointName: 'neck_01',
    centerJointNames: ['neck_01', 'head'],
  },
  chest: {
    slot: 'chest',
    sourceJointName: 'spine_03',
    centerJointNames: ['spine_03', 'neck_01'],
  },
  shoulderLeft: {
    slot: 'shoulderLeft',
    sourceJointName: 'clavicle_l',
    centerJointNames: ['clavicle_l', 'upperarm_l'],
  },
  shoulderRight: {
    slot: 'shoulderRight',
    sourceJointName: 'clavicle_r',
    centerJointNames: ['clavicle_r', 'upperarm_r'],
  },
  upperArmLeft: {
    slot: 'upperArmLeft',
    sourceJointName: 'upperarm_l',
    centerJointNames: ['upperarm_l', 'lowerarm_l'],
  },
  upperArmRight: {
    slot: 'upperArmRight',
    sourceJointName: 'upperarm_r',
    centerJointNames: ['upperarm_r', 'lowerarm_r'],
  },
  forearmLeft: {
    slot: 'forearmLeft',
    sourceJointName: 'lowerarm_l',
    centerJointNames: ['lowerarm_l', 'hand_l'],
  },
  forearmRight: {
    slot: 'forearmRight',
    sourceJointName: 'lowerarm_r',
    centerJointNames: ['lowerarm_r', 'hand_r'],
  },
  handLeft: {
    slot: 'handLeft',
    sourceJointName: 'hand_l',
    centerJointNames: ['hand_l', 'index_01_l', 'middle_01_l', 'ring_01_l', 'pinky_01_l', 'thumb_01_l'],
  },
  handRight: {
    slot: 'handRight',
    sourceJointName: 'hand_r',
    centerJointNames: ['hand_r', 'index_01_r', 'middle_01_r', 'ring_01_r', 'pinky_01_r', 'thumb_01_r'],
  },
  pelvis: {
    slot: 'pelvis',
    sourceJointName: 'pelvis',
    centerJointNames: ['pelvis', 'spine_01'],
  },
  thighLeft: {
    slot: 'thighLeft',
    sourceJointName: 'thigh_l',
    centerJointNames: ['thigh_l', 'calf_l'],
  },
  thighRight: {
    slot: 'thighRight',
    sourceJointName: 'thigh_r',
    centerJointNames: ['thigh_r', 'calf_r'],
  },
  shinLeft: {
    slot: 'shinLeft',
    sourceJointName: 'calf_l',
    centerJointNames: ['calf_l', 'foot_l'],
  },
  shinRight: {
    slot: 'shinRight',
    sourceJointName: 'calf_r',
    centerJointNames: ['calf_r', 'foot_r'],
  },
  footLeft: {
    slot: 'footLeft',
    sourceJointName: 'foot_l',
    centerJointNames: ['foot_l', 'ball_l'],
  },
  footRight: {
    slot: 'footRight',
    sourceJointName: 'foot_r',
    centerJointNames: ['foot_r', 'ball_r'],
  },
  back: {
    slot: 'back',
    sourceJointName: 'spine_03',
    centerJointNames: ['spine_03'],
  },
} as const satisfies Record<V3CharacterSlotId, V3Mesh2MotionPartBindingSpec>;
