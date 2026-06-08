import * as THREE from 'three';

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

export type CombatantRig = {
  root: THREE.Group;
  bones: Record<CombatantBoneName, THREE.Group>;
  attachments: CombatantAttachmentMap;
  segmentGroups: CombatantSegmentGroups;
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

  const attachments: CombatantAttachmentMap = {
    thirdPersonWeaponGrip: createAttachmentPoint(bones.upperTorso, 'thirdPersonWeaponGrip', 'upperTorso'),
    thirdPersonOffhandGrip: createAttachmentPoint(bones.upperTorso, 'thirdPersonOffhandGrip', 'upperTorso'),
    rightHandGrip: createAttachmentPoint(bones.rightArm, 'rightHandGrip', 'rightArm', [0, -0.62, -0.08]),
    leftHandGrip: createAttachmentPoint(bones.leftArm, 'leftHandGrip', 'leftArm', [0, -0.62, -0.08]),
    headCenter: createAttachmentPoint(bones.head, 'headCenter', 'head'),
    chestCenter: createAttachmentPoint(bones.upperTorso, 'chestCenter', 'upperTorso'),
  };

  const rig: CombatantRig = {
    root: model,
    bones,
    attachments,
    segmentGroups,
  };

  model.userData.combatantRig = rig;
  model.userData.bones = bones;
  model.userData.attachments = attachments;
  model.userData.segmentGroups = segmentGroups;
  model.userData.articulationMode = 'group-pivot';
  model.userData.lowerTorso = bones.lowerTorso;
  model.userData.upperTorso = bones.upperTorso;
  model.userData.head = bones.head;
  model.userData.leftArm = bones.leftArm;
  model.userData.rightArm = bones.rightArm;
  model.userData.leftLeg = bones.leftLeg;
  model.userData.rightLeg = bones.rightLeg;
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
  const attachment = rig.attachments[attachmentName];
  if (!attachment) {
    model.add(child);
    return model;
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
