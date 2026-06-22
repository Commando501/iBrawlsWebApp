import * as THREE from 'three';
import { getCharacterModelProfile } from '../../characterModelTypes';
import type { V3DetailBoneName } from '../v3/v3RigDetail';
import { getV3AttachmentOffset } from './combatantRigV3';
import { getV3CleanRig } from './v3CleanRig';

export const COMBATANT_BONE_NAMES = [
  'root',
  'lowerTorso',
  'upperTorso',
  'head',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
] as const;

export type CombatantBoneName = (typeof COMBATANT_BONE_NAMES)[number];

export const COMBATANT_ATTACHMENT_POINT_NAMES = [
  'thirdPersonWeaponGrip',
  'thirdPersonOffhandGrip',
  'rightHandGrip',
  'leftHandGrip',
  'firstPersonWeaponGrip',
  'firstPersonOffhandGrip',
  'headCenter',
  'chestCenter',
] as const;

export type CombatantAttachmentPointName = (typeof COMBATANT_ATTACHMENT_POINT_NAMES)[number];

export type CombatantAttachmentPoint = {
  name: CombatantAttachmentPointName;
  bone: CombatantBoneName;
  group: THREE.Group;
};

export type CombatantAttachmentMap = Partial<Record<CombatantAttachmentPointName, CombatantAttachmentPoint>>;

export type CombatantSegmentBoneName = Exclude<CombatantBoneName, 'root'>;

export type CombatantSegmentGroups = Record<CombatantSegmentBoneName, THREE.Group>;
export type CombatantDetailBoneMap = Partial<Record<V3DetailBoneName, THREE.Group>>;

export type CombatantRig = {
  root: THREE.Group;
  bones: Record<CombatantBoneName, THREE.Group>;
  attachments: CombatantAttachmentMap;
  segmentGroups: CombatantSegmentGroups;
  detailBones?: CombatantDetailBoneMap;
  v3WeaponMotionAnchor?: THREE.Group;
};

export type FirstPersonWeaponRig = {
  container: THREE.Group;
  attachments: Pick<
    Record<CombatantAttachmentPointName, CombatantAttachmentPoint>,
    'firstPersonWeaponGrip' | 'firstPersonOffhandGrip'
  >;
};

const getUserDataGroup = (
  model: THREE.Group,
  key: CombatantSegmentBoneName,
  fallback: THREE.Group
): THREE.Group => {
  const candidate = model.userData?.[key];
  return candidate instanceof THREE.Group ? candidate : fallback;
};

const createArticulationController = (
  segment: THREE.Group,
  boneName: CombatantSegmentBoneName
): THREE.Group => {
  const existing = segment.userData?.articulationController;
  if (existing instanceof THREE.Group) return existing;

  const parent = segment.parent;
  if (!parent) return segment;

  const controller = new THREE.Group();
  controller.name = `bone:${boneName}`;
  controller.userData.boneName = boneName;
  controller.userData.segmentGroup = segment;
  controller.userData.articulationController = true;

  controller.position.copy(segment.position);
  controller.quaternion.copy(segment.quaternion);
  controller.scale.copy(segment.scale);

  parent.add(controller);
  parent.updateWorldMatrix(true, false);
  controller.updateWorldMatrix(true, false);
  controller.attach(segment);

  segment.name = segment.name || `segment:${boneName}`;
  segment.userData.boneName = boneName;
  segment.userData.articulationController = controller;

  return controller;
};

const captureV3AnimationRestPosition = (group: THREE.Group): void => {
  group.userData.v3AnimationRestPosition = [
    group.position.x,
    group.position.y,
    group.position.z,
  ];
};

const createAttachmentPoint = (
  parent: THREE.Object3D,
  name: CombatantAttachmentPointName,
  bone: CombatantBoneName,
  localPosition?: THREE.Vector3Tuple
): CombatantAttachmentPoint => {
  const group = new THREE.Group();
  group.name = `lock:${name}`;
  group.userData.lockPointName = name;
  group.userData.boneName = bone;
  if (localPosition) group.position.fromArray(localPosition);
  parent.add(group);
  return { name, bone, group };
};

export const getCombatantRig = (model: THREE.Group): CombatantRig | undefined => {
  const rig = model.userData?.combatantRig;
  return rig && typeof rig === 'object' ? rig as CombatantRig : undefined;
};

export const getV3WeaponMotionAnchor = (model: THREE.Group): THREE.Group | null => {
  const anchor = model.userData?.v3WeaponMotionAnchor;
  return anchor instanceof THREE.Group ? anchor : null;
};

const createV3WeaponMotionAnchor = (
  model: THREE.Group,
  bones: Record<CombatantBoneName, THREE.Group>,
  detailBones?: CombatantDetailBoneMap
): THREE.Group | undefined => {
  if (model.userData.modelSystem !== 'v3') return undefined;
  const existing = getV3WeaponMotionAnchor(model);
  if (existing) return existing;

  const parent = detailBones?.chest ?? bones.upperTorso;
  const anchor = new THREE.Group();
  anchor.name = 'v3WeaponMotionAnchor';
  anchor.userData.v3WeaponMotionAnchor = true;
  parent.add(anchor);
  model.userData.v3WeaponMotionAnchor = anchor;
  return anchor;
};

export const buildCombatantRigForModel = (model: THREE.Group): CombatantRig => {
  const existing = getCombatantRig(model);
  if (existing) return existing;

  const lowerTorsoSegment = getUserDataGroup(model, 'lowerTorso', model);
  const upperTorsoSegment = getUserDataGroup(model, 'upperTorso', model);
  const segmentGroups: CombatantSegmentGroups = {
    lowerTorso: lowerTorsoSegment,
    upperTorso: upperTorsoSegment,
    head: getUserDataGroup(model, 'head', upperTorsoSegment),
    leftArm: getUserDataGroup(model, 'leftArm', upperTorsoSegment),
    rightArm: getUserDataGroup(model, 'rightArm', upperTorsoSegment),
    leftLeg: getUserDataGroup(model, 'leftLeg', lowerTorsoSegment),
    rightLeg: getUserDataGroup(model, 'rightLeg', lowerTorsoSegment),
  };

  const bones: Record<CombatantBoneName, THREE.Group> = {
    root: model,
    lowerTorso: createArticulationController(segmentGroups.lowerTorso, 'lowerTorso'),
    upperTorso: createArticulationController(segmentGroups.upperTorso, 'upperTorso'),
    head: createArticulationController(segmentGroups.head, 'head'),
    leftArm: createArticulationController(segmentGroups.leftArm, 'leftArm'),
    rightArm: createArticulationController(segmentGroups.rightArm, 'rightArm'),
    leftLeg: createArticulationController(segmentGroups.leftLeg, 'leftLeg'),
    rightLeg: createArticulationController(segmentGroups.rightLeg, 'rightLeg'),
  };

  const isV2 = model.userData.modelSystem === 'v2';
  const isV3 = model.userData.modelSystem === 'v3';
  const rightWeaponBone = isV3
    ? (model.userData.handRight || model.userData.hand_r || bones.rightArm)
    : isV2 ? (model.userData.hand_r || bones.rightArm) : bones.rightArm;
  const leftWeaponBone = isV3
    ? (model.userData.handLeft || model.userData.hand_l || bones.leftArm)
    : isV2 ? (model.userData.hand_l || bones.leftArm) : bones.leftArm;
  const profile = isV2 ? getCharacterModelProfile(model.userData.modelType, 'v2') : undefined;
  const defaultRightGripOffset: THREE.Vector3Tuple = isV2 ? profile!.thirdPersonWeaponGripOffset : [0, -0.35, -0.045];
  const defaultLeftGripOffset: THREE.Vector3Tuple = isV2 ? profile!.thirdPersonOffhandGripOffset : [0, -0.35, -0.045];
  const rightGripOffset: THREE.Vector3Tuple = isV3
    ? (getV3AttachmentOffset(model, 'thirdPersonWeaponGrip') ?? defaultRightGripOffset)
    : defaultRightGripOffset;
  const leftGripOffset: THREE.Vector3Tuple = isV3
    ? (getV3AttachmentOffset(model, 'thirdPersonOffhandGrip') ?? defaultLeftGripOffset)
    : defaultLeftGripOffset;
  const rightHandGripOffset: THREE.Vector3Tuple = isV3
    ? (getV3AttachmentOffset(model, 'rightHandGrip') ?? rightGripOffset)
    : rightGripOffset;
  const leftHandGripOffset: THREE.Vector3Tuple = isV3
    ? (getV3AttachmentOffset(model, 'leftHandGrip') ?? leftGripOffset)
    : leftGripOffset;
  const detailBones = isV3 && model.userData.v3DetailBones && typeof model.userData.v3DetailBones === 'object'
    ? model.userData.v3DetailBones as CombatantDetailBoneMap
    : undefined;
  const v3WeaponMotionAnchor = createV3WeaponMotionAnchor(model, bones, detailBones);

  const attachments: CombatantAttachmentMap = {
    thirdPersonWeaponGrip: createAttachmentPoint(rightWeaponBone, 'thirdPersonWeaponGrip', 'rightArm', rightGripOffset),
    thirdPersonOffhandGrip: createAttachmentPoint(leftWeaponBone, 'thirdPersonOffhandGrip', 'leftArm', leftGripOffset),
    rightHandGrip: createAttachmentPoint(rightWeaponBone, 'rightHandGrip', 'rightArm', rightHandGripOffset),
    leftHandGrip: createAttachmentPoint(leftWeaponBone, 'leftHandGrip', 'leftArm', leftHandGripOffset),
    headCenter: createAttachmentPoint(bones.head, 'headCenter', 'head'),
    chestCenter: createAttachmentPoint(bones.upperTorso, 'chestCenter', 'upperTorso'),
  };

  const rig: CombatantRig = {
    root: model,
    bones,
    attachments,
    segmentGroups,
    detailBones,
    v3WeaponMotionAnchor,
  };

  model.userData.combatantRig = rig;
  model.userData.bones = bones;
  model.userData.attachments = attachments;
  model.userData.segmentGroups = segmentGroups;
  if (detailBones) {
    model.userData.detailBones = detailBones;
  }
  model.userData.articulationMode = 'group-pivot';
  model.userData.lowerTorso = bones.lowerTorso;
  model.userData.upperTorso = bones.upperTorso;
  model.userData.head = bones.head;
  model.userData.leftArm = bones.leftArm;
  model.userData.rightArm = bones.rightArm;
  model.userData.leftLeg = bones.leftLeg;
  model.userData.rightLeg = bones.rightLeg;
  if (isV3) {
    for (const [name, bone] of Object.entries(bones)) {
      if (name !== 'root') {
        captureV3AnimationRestPosition(bone);
      }
    }
    getV3CleanRig(model);
  }
  return rig;
};

export const attachToAttachmentPoint = (
  attachment: CombatantAttachmentPoint,
  child: THREE.Object3D
): THREE.Group => {
  attachment.group.add(child);
  return attachment.group;
};

export const attachToCombatantAttachment = (
  model: THREE.Group,
  attachmentName: CombatantAttachmentPointName,
  child: THREE.Object3D
): THREE.Group => {
  const rig = buildCombatantRigForModel(model);
  if (
    model.userData.modelSystem === 'v3' &&
    attachmentName === 'thirdPersonWeaponGrip' &&
    child.userData.modelSystem === 'v3'
  ) {
    const anchor = rig.v3WeaponMotionAnchor ?? getV3WeaponMotionAnchor(model);
    if (anchor) {
      anchor.add(child);
      return anchor;
    }
  }
  const attachment = rig.attachments[attachmentName];
  if (!attachment) {
    model.add(child);
    return model;
  }

  // Adjust child position/rotation for V2 if it is a weapon grip attachment
  if (model.userData.modelSystem === 'v2') {
    if (attachmentName === 'thirdPersonWeaponGrip') {
      const weaponType = child.userData.weaponType;
      if (weaponType === 'hammer') {
        child.position.set(0, 0, 0);
        child.rotation.set(Math.PI / 2, 0, 0);
      } else if (weaponType === 'sword') {
        child.position.set(0, 0, 0);
        child.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
      } else if (weaponType === 'pistol') {
        child.position.set(0, 0, 0);
        child.rotation.set(Math.PI / 2, 0, 0);
      }
    } else if (attachmentName === 'thirdPersonOffhandGrip') {
      child.position.set(0, 0, 0);
    }
  }

  return attachToAttachmentPoint(attachment, child);
};

export const createFirstPersonWeaponRig = (parent: THREE.Object3D): FirstPersonWeaponRig => {
  const container = new THREE.Group();
  container.name = 'firstPersonWeaponRig';
  parent.add(container);

  const attachments = {
    firstPersonWeaponGrip: createAttachmentPoint(container, 'firstPersonWeaponGrip', 'root'),
    firstPersonOffhandGrip: createAttachmentPoint(container, 'firstPersonOffhandGrip', 'root'),
  };

  container.userData.attachments = attachments;
  return { container, attachments };
};
