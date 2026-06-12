import type { V3CharacterSlotId } from './v3ModelTypes';

export const V3_DETAIL_BONE_NAMES = [
  'pelvis',
  'spine1',
  'spine2',
  'spine3',
  'chest',
  'neck',
  'head',
  'helmet',
  'collar',
  'backpack',
  'clavicleLeft',
  'upperArmLeft',
  'forearmLeft',
  'handLeft',
  'gripLeft',
  'clavicleRight',
  'upperArmRight',
  'forearmRight',
  'handRight',
  'gripRight',
  'thighLeft',
  'calfLeft',
  'footLeft',
  'toeLeft',
  'thighRight',
  'calfRight',
  'footRight',
  'toeRight',
] as const;

export type V3DetailBoneName = (typeof V3_DETAIL_BONE_NAMES)[number];

export type V3DetailRigSegment =
  | 'lowerTorso'
  | 'upperTorso'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg';

export interface V3DetailBoneSpec {
  segment: V3DetailRigSegment;
  parent?: V3DetailBoneName;
  referenceBone: string;
  position: [number, number, number];
}

export const V3_DETAIL_BONE_SPECS: Record<V3DetailBoneName, V3DetailBoneSpec> = {
  pelvis: { segment: 'lowerTorso', referenceBone: 'b_pelvis', position: [-0.02, 0.82, -0.18] },
  spine1: { segment: 'upperTorso', referenceBone: 'b_spine1', position: [-0.02, 0.9, -0.18] },
  spine2: { segment: 'upperTorso', parent: 'spine1', referenceBone: 'b_spine2', position: [-0.02, 1.04, -0.18] },
  spine3: { segment: 'upperTorso', parent: 'spine2', referenceBone: 'b_spine3', position: [-0.02, 1.18, -0.18] },
  chest: { segment: 'upperTorso', parent: 'spine3', referenceBone: 'b_torso', position: [-0.02, 1.2, -0.18] },
  neck: { segment: 'upperTorso', parent: 'chest', referenceBone: 'b_neck0', position: [-0.02, 1.42, -0.16] },
  head: { segment: 'head', parent: 'neck', referenceBone: 'b_head', position: [-0.02, 1.56, -0.16] },
  helmet: { segment: 'head', parent: 'head', referenceBone: 'b_helmet', position: [-0.02, 1.58, -0.16] },
  collar: { segment: 'upperTorso', parent: 'chest', referenceBone: 'b_collar', position: [-0.02, 1.38, -0.16] },
  backpack: { segment: 'upperTorso', parent: 'chest', referenceBone: 'b_backpack', position: [-0.02, 1.18, -0.42] },
  clavicleLeft: { segment: 'leftArm', parent: 'chest', referenceBone: 'b_l_clav', position: [-0.44, 1.36, -0.16] },
  upperArmLeft: { segment: 'leftArm', parent: 'clavicleLeft', referenceBone: 'b_l_upperarm', position: [-0.58, 1.04, -0.14] },
  forearmLeft: { segment: 'leftArm', parent: 'upperArmLeft', referenceBone: 'b_l_forearm', position: [-0.58, 0.64, -0.14] },
  handLeft: { segment: 'leftArm', parent: 'forearmLeft', referenceBone: 'b_l_hand', position: [-0.58, 0.34, -0.12] },
  gripLeft: { segment: 'leftArm', parent: 'handLeft', referenceBone: 'b_l_grip', position: [-0.66, 0.26, -0.1] },
  clavicleRight: { segment: 'rightArm', parent: 'chest', referenceBone: 'b_r_clav', position: [0.16, 1.36, -0.16] },
  upperArmRight: { segment: 'rightArm', parent: 'clavicleRight', referenceBone: 'b_r_upperarm', position: [0.31, 1.04, -0.14] },
  forearmRight: { segment: 'rightArm', parent: 'upperArmRight', referenceBone: 'b_r_forearm', position: [0.31, 0.64, -0.14] },
  handRight: { segment: 'rightArm', parent: 'forearmRight', referenceBone: 'b_r_hand', position: [0.31, 0.34, -0.12] },
  gripRight: { segment: 'rightArm', parent: 'handRight', referenceBone: 'b_r_grip', position: [0.39, 0.26, -0.1] },
  thighLeft: { segment: 'leftLeg', parent: 'pelvis', referenceBone: 'b_l_thigh', position: [-0.32, 0.42, -0.14] },
  calfLeft: { segment: 'leftLeg', parent: 'thighLeft', referenceBone: 'b_l_calf', position: [-0.32, 0.08, -0.14] },
  footLeft: { segment: 'leftLeg', parent: 'calfLeft', referenceBone: 'b_l_foot', position: [-0.32, -0.05, -0.08] },
  toeLeft: { segment: 'leftLeg', parent: 'footLeft', referenceBone: 'b_l_toe', position: [-0.32, -0.06, 0.12] },
  thighRight: { segment: 'rightLeg', parent: 'pelvis', referenceBone: 'b_r_thigh', position: [0.04, 0.42, -0.14] },
  calfRight: { segment: 'rightLeg', parent: 'thighRight', referenceBone: 'b_r_calf', position: [0.04, 0.08, -0.14] },
  footRight: { segment: 'rightLeg', parent: 'calfRight', referenceBone: 'b_r_foot', position: [0.04, -0.05, -0.08] },
  toeRight: { segment: 'rightLeg', parent: 'footRight', referenceBone: 'b_r_toe', position: [0.04, -0.06, 0.12] },
};

export const V3_SLOT_DETAIL_BONES: Record<V3CharacterSlotId, V3DetailBoneName> = {
  helmet: 'helmet',
  neck: 'collar',
  chest: 'chest',
  shoulderLeft: 'clavicleLeft',
  shoulderRight: 'clavicleRight',
  upperArmLeft: 'upperArmLeft',
  upperArmRight: 'upperArmRight',
  forearmLeft: 'forearmLeft',
  forearmRight: 'forearmRight',
  handLeft: 'handLeft',
  handRight: 'handRight',
  pelvis: 'pelvis',
  thighLeft: 'thighLeft',
  thighRight: 'thighRight',
  shinLeft: 'calfLeft',
  shinRight: 'calfRight',
  footLeft: 'footLeft',
  footRight: 'footRight',
  back: 'backpack',
};

