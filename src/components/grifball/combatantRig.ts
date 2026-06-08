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

export type CombatantRig = {
  root: THREE.Group;
  bones: Record<CombatantBoneName, THREE.Group>;
  attachments: CombatantAttachmentMap;
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
  key: CombatantBoneName,
  fallback: THREE.Group
): THREE.Group => {
  const candidate = model.userData?.[key];
  return candidate instanceof THREE.Group ? candidate : fallback;
};

const createAttachmentPoint = (
  parent: THREE.Object3D,
  name: CombatantAttachmentPointName,
  bone: CombatantBoneName
): CombatantAttachmentPoint => {
  const group = new THREE.Group();
  group.name = `lock:${name}`;
  group.userData.lockPointName = name;
  group.userData.boneName = bone;
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

  const lowerTorso = getUserDataGroup(model, 'lowerTorso', model);
  const upperTorso = getUserDataGroup(model, 'upperTorso', model);
  const head = getUserDataGroup(model, 'head', upperTorso);

  const bones: Record<CombatantBoneName, THREE.Group> = {
    root: model,
    lowerTorso,
    upperTorso,
    head,
    leftArm: getUserDataGroup(model, 'leftArm', upperTorso),
    rightArm: getUserDataGroup(model, 'rightArm', upperTorso),
    leftLeg: getUserDataGroup(model, 'leftLeg', lowerTorso),
    rightLeg: getUserDataGroup(model, 'rightLeg', lowerTorso),
  };

  const attachments: CombatantAttachmentMap = {
    thirdPersonWeaponGrip: createAttachmentPoint(upperTorso, 'thirdPersonWeaponGrip', 'upperTorso'),
    thirdPersonOffhandGrip: createAttachmentPoint(upperTorso, 'thirdPersonOffhandGrip', 'upperTorso'),
    headCenter: createAttachmentPoint(head, 'headCenter', 'head'),
    chestCenter: createAttachmentPoint(upperTorso, 'chestCenter', 'upperTorso'),
  };

  const rig: CombatantRig = {
    root: model,
    bones,
    attachments,
  };

  model.userData.combatantRig = rig;
  model.userData.bones = bones;
  model.userData.attachments = attachments;
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
