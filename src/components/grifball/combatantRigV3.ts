import type * as THREE from 'three';
import type { V3SocketDefinition, V3SocketName, V3Vec3Tuple } from '../v3/v3ModelTypes';
import type { CombatantAttachmentPointName } from './combatantRig';

const SOCKET_ATTACHMENT_MAP: Partial<Record<V3SocketName, CombatantAttachmentPointName>> = {
  thirdPersonPrimaryGrip: 'thirdPersonWeaponGrip',
  thirdPersonOffhandGrip: 'thirdPersonOffhandGrip',
  firstPersonPrimaryGrip: 'firstPersonWeaponGrip',
  firstPersonOffhandGrip: 'firstPersonOffhandGrip',
};

export function mapV3SocketNameToCombatantAttachment(
  name: V3SocketName
): CombatantAttachmentPointName | undefined {
  return SOCKET_ATTACHMENT_MAP[name];
}

const toVector3Tuple = (value: V3Vec3Tuple | THREE.Vector3Tuple | undefined): THREE.Vector3Tuple | undefined => {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  return [value[0], value[1], value[2]];
};

const getV3SocketDefinitions = (model: THREE.Group): readonly V3SocketDefinition[] => {
  const sockets = model.userData?.v3CharacterSockets ?? model.userData?.v3WeaponSockets ?? model.userData?.v3Sockets;
  return Array.isArray(sockets) ? sockets : [];
};

const findV3SocketForAttachment = (
  model: THREE.Group,
  attachment: CombatantAttachmentPointName
): V3SocketDefinition | undefined =>
  getV3SocketDefinitions(model).find((socket) => mapV3SocketNameToCombatantAttachment(socket.name) === attachment);

export function getV3AttachmentOffset(
  model: THREE.Group,
  attachment: CombatantAttachmentPointName
): THREE.Vector3Tuple | undefined {
  const direct = toVector3Tuple(model.userData?.v3AttachmentOffsets?.[attachment]);
  if (direct) {
    return direct;
  }

  const socket = findV3SocketForAttachment(model, attachment);
  return socket ? toVector3Tuple(socket.position) : undefined;
}

export function getV3AttachmentRotation(
  model: THREE.Group,
  attachment: CombatantAttachmentPointName
): THREE.Vector3Tuple | undefined {
  const direct = toVector3Tuple(model.userData?.v3AttachmentRotations?.[attachment]);
  if (direct) {
    return direct;
  }

  const socket = findV3SocketForAttachment(model, attachment);
  return socket ? toVector3Tuple(socket.rotation) : undefined;
}
