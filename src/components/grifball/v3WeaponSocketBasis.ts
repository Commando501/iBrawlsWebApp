import * as THREE from 'three';
import type { V3SocketDefinition, V3SocketName, V3WeaponId } from '../v3/v3ModelTypes';
import { getCombatantRig } from './combatantRig';
import { getV3Mesh2MotionDriverWeaponSocketWorldPosition } from './v3Mesh2MotionDriverRig';

export interface V3WeaponSocketBasis {
  weapon: V3WeaponId;
  socketName: V3SocketName;
  socket: V3SocketDefinition;
  correctionMatrix: THREE.Matrix4;
  correctionPosition: THREE.Vector3;
  correctionQuaternion: THREE.Quaternion;
  correctionScale: THREE.Vector3;
  canonicalQuaternion: THREE.Quaternion;
  primaryGripLocalPosition: THREE.Vector3;
  basisForward: THREE.Vector3;
  basisUp: THREE.Vector3;
  basisRight: THREE.Vector3;
}

export interface V3WeaponSemanticAxes {
  weapon: V3WeaponId;
  sourceForward: THREE.Vector3;
  sourceUp: THREE.Vector3;
  sourceRight: THREE.Vector3;
  canonicalForward: THREE.Vector3;
  canonicalUp: THREE.Vector3;
  canonicalRight: THREE.Vector3;
}

export interface V3WeaponSemanticAlignmentReport {
  weapon: V3WeaponId;
  forwardAlignment: number;
  upAlignment: number;
  rightAlignment: number;
  semanticForwardWorld: THREE.Vector3;
  semanticUpWorld: THREE.Vector3;
  semanticRightWorld: THREE.Vector3;
}

export interface V3AppliedWeaponSocketBasis extends V3WeaponSocketBasis {
  visualRoot: THREE.Group;
}

export interface V3WeaponCarryAlignmentReport {
  weapon: V3WeaponId;
  socketName: V3SocketName | null;
  basisApplied: boolean;
  basisForwardAlignment: number;
  basisUpAlignment: number;
  basisRightAlignment: number;
  primaryGripDrift: number;
  offhandGripDrift: number | null;
  twoHandReadiness: number | null;
  oneHandReadiness: number | null;
  weaponForwardWorld: THREE.Vector3;
  weaponUpWorld: THREE.Vector3;
  primaryGripWorldPosition: THREE.Vector3 | null;
  offhandGripWorldPosition: THREE.Vector3 | null;
}

const VISUAL_ROOT_NAME = 'v3WeaponSocketBasisVisualRoot';
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const CANONICAL_FORWARD = new THREE.Vector3(0, 0, -1);
const CANONICAL_UP = new THREE.Vector3(0, 1, 0);
const CANONICAL_RIGHT = new THREE.Vector3(1, 0, 0);

const SOURCE_FORWARD_AXES: Record<V3WeaponId, THREE.Vector3> = {
  hammer: new THREE.Vector3(0, 1, 0),
  sword: new THREE.Vector3(0, 1, 0),
  pistol: new THREE.Vector3(1, 0, 0),
};

const SOURCE_UP_AXES: Record<V3WeaponId, THREE.Vector3> = {
  hammer: new THREE.Vector3(0, 0, 1),
  sword: new THREE.Vector3(0, 0, 1),
  pistol: new THREE.Vector3(0, 0, 1),
};

const finiteAxisTuple = (value: unknown): value is readonly [number, number, number] => (
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry)) &&
  new THREE.Vector3(value[0], value[1], value[2]).lengthSq() > 1e-8
);

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const getSocketDefinitions = (weaponModel: THREE.Object3D): readonly V3SocketDefinition[] => {
  const sockets = weaponModel.userData?.v3WeaponSockets ?? weaponModel.userData?.v3Sockets;
  return Array.isArray(sockets) ? sockets : [];
};

const findSocket = (
  weaponModel: THREE.Object3D,
  socketName: V3SocketName
): V3SocketDefinition => {
  const socket = getSocketDefinitions(weaponModel).find((candidate) => candidate.name === socketName);
  if (!socket) {
    throw new Error(`Missing V3 weapon socket ${socketName} on ${weaponModel.name || 'unnamed weapon'}`);
  }
  return socket;
};

const socketMatrix = (socket: V3SocketDefinition): THREE.Matrix4 => {
  const position = new THREE.Vector3(...socket.position);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...socket.rotation));
  return new THREE.Matrix4().compose(position, quaternion, UNIT_SCALE);
};

const projectOnPlane = (value: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 =>
  value.clone().sub(normal.clone().multiplyScalar(value.dot(normal)));

const quaternionFromForwardUp = (
  sourceForward: THREE.Vector3,
  sourceUp: THREE.Vector3,
  targetForward: THREE.Vector3,
  targetUp: THREE.Vector3
): THREE.Quaternion => {
  const sourceForwardUnit = sourceForward.clone().normalize();
  const targetForwardUnit = targetForward.clone().normalize();
  const forwardRotation = new THREE.Quaternion().setFromUnitVectors(sourceForwardUnit, targetForwardUnit);
  const rotatedUp = sourceUp.clone().normalize().applyQuaternion(forwardRotation);
  const sourceUpProjected = projectOnPlane(rotatedUp, targetForwardUnit).normalize();
  const targetUpProjected = projectOnPlane(targetUp.clone().normalize(), targetForwardUnit).normalize();
  const upRotation = new THREE.Quaternion().setFromUnitVectors(sourceUpProjected, targetUpProjected);
  return upRotation.multiply(forwardRotation).normalize();
};

const metadataSemanticAxes = (
  weaponModel: THREE.Object3D
): { forward?: readonly [number, number, number]; up?: readonly [number, number, number] } | undefined => {
  const metadata = weaponModel.userData?.v3WeaponSemanticAxes;
  return metadata && typeof metadata === 'object'
    ? metadata as { forward?: readonly [number, number, number]; up?: readonly [number, number, number] }
    : undefined;
};

export function deriveV3WeaponSemanticAxes(
  weaponModel: THREE.Object3D,
  weapon: V3WeaponId
): V3WeaponSemanticAxes {
  const metadata = metadataSemanticAxes(weaponModel);
  const sourceForward = finiteAxisTuple(metadata?.forward)
    ? new THREE.Vector3(...metadata.forward).normalize()
    : SOURCE_FORWARD_AXES[weapon].clone().normalize();
  const sourceUpRaw = finiteAxisTuple(metadata?.up)
    ? new THREE.Vector3(...metadata.up).normalize()
    : SOURCE_UP_AXES[weapon].clone().normalize();
  const sourceUp = projectOnPlane(sourceUpRaw, sourceForward).normalize();
  const sourceRight = sourceForward.clone().cross(sourceUp).normalize();

  return {
    weapon,
    sourceForward,
    sourceUp,
    sourceRight,
    canonicalForward: CANONICAL_FORWARD.clone(),
    canonicalUp: CANONICAL_UP.clone(),
    canonicalRight: CANONICAL_RIGHT.clone(),
  };
}

const canonicalQuaternionForWeapon = (weaponModel: THREE.Object3D, weapon: V3WeaponId): THREE.Quaternion => {
  const semanticAxes = deriveV3WeaponSemanticAxes(weaponModel, weapon);
  return quaternionFromForwardUp(
    semanticAxes.sourceForward,
    semanticAxes.sourceUp,
    CANONICAL_FORWARD,
    CANONICAL_UP
  );
};

const axisWithQuaternion = (axis: THREE.Vector3, quaternion: THREE.Quaternion): THREE.Vector3 =>
  axis.clone().applyQuaternion(quaternion).normalize();

export function getV3WeaponSocketBasisVisualRoot(weaponModel: THREE.Object3D): THREE.Group | null {
  const stored = weaponModel.userData?.v3WeaponSocketBasisVisualRoot;
  if (stored instanceof THREE.Group) return stored;
  const child = weaponModel.children.find((candidate) => candidate.name === VISUAL_ROOT_NAME);
  return child instanceof THREE.Group ? child : null;
}

const getOrCreateVisualRoot = (weaponModel: THREE.Object3D): THREE.Group => {
  const existing = getV3WeaponSocketBasisVisualRoot(weaponModel);
  if (existing) {
    weaponModel.userData.v3WeaponSocketBasisVisualRoot = existing;
    return existing;
  }

  const visualRoot = new THREE.Group();
  visualRoot.name = VISUAL_ROOT_NAME;
  visualRoot.userData.v3WeaponSocketBasisVisualRoot = true;
  const existingChildren = [...weaponModel.children];
  weaponModel.add(visualRoot);
  for (const child of existingChildren) {
    visualRoot.add(child);
  }
  weaponModel.userData.v3WeaponSocketBasisVisualRoot = visualRoot;
  return visualRoot;
};

export function deriveV3WeaponSocketBasis(
  weaponModel: THREE.Object3D,
  weapon: V3WeaponId,
  socketName: V3SocketName
): V3WeaponSocketBasis {
  const socket = findSocket(weaponModel, socketName);
  const semanticAxes = deriveV3WeaponSemanticAxes(weaponModel, weapon);
  const canonicalQuaternion = canonicalQuaternionForWeapon(weaponModel, weapon);
  const canonicalMatrix = new THREE.Matrix4().compose(new THREE.Vector3(), canonicalQuaternion, UNIT_SCALE);
  const socketLocalMatrix = socketMatrix(socket);
  const correctionMatrix = canonicalMatrix.clone().multiply(socketLocalMatrix.clone().invert());
  const correctionPosition = new THREE.Vector3();
  const correctionQuaternion = new THREE.Quaternion();
  const correctionScale = new THREE.Vector3();
  correctionMatrix.decompose(correctionPosition, correctionQuaternion, correctionScale);
  const correctedSocketMatrix = correctionMatrix.clone().multiply(socketLocalMatrix);
  const primaryGripLocalPosition = new THREE.Vector3().setFromMatrixPosition(correctedSocketMatrix);

  return {
    weapon,
    socketName,
    socket,
    correctionMatrix,
    correctionPosition,
    correctionQuaternion,
    correctionScale,
    canonicalQuaternion,
    primaryGripLocalPosition,
    basisForward: axisWithQuaternion(semanticAxes.sourceForward, canonicalQuaternion),
    basisUp: axisWithQuaternion(semanticAxes.sourceUp, canonicalQuaternion),
    basisRight: axisWithQuaternion(CANONICAL_RIGHT, correctionQuaternion),
  };
}

export function applyV3WeaponSocketBasis(
  weaponModel: THREE.Object3D,
  weapon: V3WeaponId,
  socketName: V3SocketName
): V3AppliedWeaponSocketBasis {
  const basis = deriveV3WeaponSocketBasis(weaponModel, weapon, socketName);
  const visualRoot = getOrCreateVisualRoot(weaponModel);
  visualRoot.position.copy(basis.correctionPosition);
  visualRoot.quaternion.copy(basis.correctionQuaternion);
  visualRoot.scale.copy(basis.correctionScale);
  weaponModel.userData.v3WeaponSocketBasis = {
    weapon,
    socketName,
    basisForwardAlignment: roundMetric(basis.basisForward.dot(CANONICAL_FORWARD)),
    basisUpAlignment: roundMetric(basis.basisUp.dot(CANONICAL_UP)),
  };
  weaponModel.updateWorldMatrix(true, true);
  return { ...basis, visualRoot };
}

const socketWorldPosition = (
  weaponModel: THREE.Object3D,
  socketName: V3SocketName
): THREE.Vector3 | null => {
  const socket = getSocketDefinitions(weaponModel).find((candidate) => candidate.name === socketName);
  if (!socket) return null;
  const visualRoot = getV3WeaponSocketBasisVisualRoot(weaponModel);
  weaponModel.updateWorldMatrix(true, true);
  visualRoot?.updateWorldMatrix(true, true);
  const matrix = weaponModel.matrixWorld.clone();
  if (visualRoot) matrix.multiply(visualRoot.matrix);
  matrix.multiply(socketMatrix(socket));
  return new THREE.Vector3().setFromMatrixPosition(matrix);
};

export function getV3WeaponSocketWorldPosition(
  weaponModel: THREE.Object3D,
  socketName: V3SocketName
): THREE.Vector3 | null {
  return socketWorldPosition(weaponModel, socketName);
}

const getTargetWorldAxes = (model: THREE.Object3D) => {
  model.updateWorldMatrix(true, false);
  const quaternion = model.getWorldQuaternion(new THREE.Quaternion());
  return {
    forward: CANONICAL_FORWARD.clone().applyQuaternion(quaternion).normalize(),
    up: CANONICAL_UP.clone().applyQuaternion(quaternion).normalize(),
    right: CANONICAL_RIGHT.clone().applyQuaternion(quaternion).normalize(),
  };
};

const basisAxisAlignment = (
  weaponModel: THREE.Object3D,
  weapon: V3WeaponId,
  axis: 'forward' | 'up'
): number => {
  const visualRoot = getV3WeaponSocketBasisVisualRoot(weaponModel);
  const quaternion = visualRoot?.quaternion ?? new THREE.Quaternion();
  const semanticAxes = deriveV3WeaponSemanticAxes(weaponModel, weapon);
  const sourceAxis = axis === 'forward' ? semanticAxes.sourceForward : semanticAxes.sourceUp;
  const targetAxis = axis === 'forward' ? CANONICAL_FORWARD : CANONICAL_UP;
  return roundMetric(axisWithQuaternion(sourceAxis, quaternion).dot(targetAxis));
};

export function analyzeV3WeaponSemanticAlignment(
  weaponModel: THREE.Object3D,
  weapon: V3WeaponId
): V3WeaponSemanticAlignmentReport {
  const semanticAxes = deriveV3WeaponSemanticAxes(weaponModel, weapon);
  const visualRoot = getV3WeaponSocketBasisVisualRoot(weaponModel);
  const quaternion = visualRoot?.quaternion ?? new THREE.Quaternion();
  const semanticForwardWorld = axisWithQuaternion(semanticAxes.sourceForward, quaternion);
  const semanticUpWorld = axisWithQuaternion(semanticAxes.sourceUp, quaternion);
  const semanticRightWorld = semanticForwardWorld.clone().cross(semanticUpWorld).normalize();

  return {
    weapon,
    forwardAlignment: roundMetric(semanticForwardWorld.dot(CANONICAL_FORWARD)),
    upAlignment: roundMetric(semanticUpWorld.dot(CANONICAL_UP)),
    rightAlignment: roundMetric(semanticRightWorld.dot(CANONICAL_RIGHT)),
    semanticForwardWorld,
    semanticUpWorld,
    semanticRightWorld,
  };
}

export function analyzeV3WeaponCarryAlignment(
  model: THREE.Group,
  weaponModel: THREE.Object3D,
  weapon: V3WeaponId
): V3WeaponCarryAlignmentReport {
  const rig = getCombatantRig(model);
  const storedBasis = weaponModel.userData?.v3WeaponSocketBasis as { socketName?: V3SocketName } | undefined;
  const socketName = storedBasis?.socketName ?? null;
  const targetAxes = getTargetWorldAxes(model);
  const semanticAxes = deriveV3WeaponSemanticAxes(weaponModel, weapon);
  weaponModel.updateWorldMatrix(true, true);
  const visualRoot = getV3WeaponSocketBasisVisualRoot(weaponModel);
  const visualWorldQuaternion = (visualRoot ?? weaponModel).getWorldQuaternion(new THREE.Quaternion());
  const weaponForwardWorld = axisWithQuaternion(semanticAxes.sourceForward, visualWorldQuaternion);
  const weaponUpWorld = axisWithQuaternion(semanticAxes.sourceUp, visualWorldQuaternion);
  const driverRightGrip = model.userData.v3Mesh2MotionDriverActive === true
    ? getV3Mesh2MotionDriverWeaponSocketWorldPosition(model, 'rightHandGrip')
    : null;
  const driverLeftGrip = model.userData.v3Mesh2MotionDriverActive === true
    ? getV3Mesh2MotionDriverWeaponSocketWorldPosition(model, 'leftHandGrip')
    : null;
  const rightGrip = driverRightGrip
    ?? rig?.attachments.thirdPersonWeaponGrip?.group.getWorldPosition(new THREE.Vector3())
    ?? null;
  const offhandGrip = driverLeftGrip
    ?? rig?.attachments.thirdPersonOffhandGrip?.group.getWorldPosition(new THREE.Vector3())
    ?? null;
  const primaryGripWorldPosition = socketName
    ? socketWorldPosition(weaponModel, socketName)
    : null;
  const offhandGripWorldPosition = socketWorldPosition(weaponModel, 'thirdPersonOffhandGrip');
  const primaryGripDrift = rightGrip && primaryGripWorldPosition
    ? roundMetric(primaryGripWorldPosition.distanceTo(rightGrip))
    : Number.POSITIVE_INFINITY;
  const offhandGripDrift = offhandGrip && offhandGripWorldPosition
    ? roundMetric(offhandGripWorldPosition.distanceTo(offhandGrip))
    : null;
  const twoHandReadiness = offhandGripDrift === null
    ? null
    : roundMetric(Math.max(0, 1 - offhandGripDrift / 0.45));
  const oneHandReadiness = roundMetric(Math.max(0, 1 - primaryGripDrift / 0.16));

  return {
    weapon,
    socketName,
    basisApplied: Boolean(visualRoot && socketName),
    basisForwardAlignment: basisAxisAlignment(weaponModel, weapon, 'forward'),
    basisUpAlignment: basisAxisAlignment(weaponModel, weapon, 'up'),
    basisRightAlignment: roundMetric(weaponForwardWorld.clone().cross(weaponUpWorld).normalize().dot(targetAxes.right)),
    primaryGripDrift,
    offhandGripDrift,
    twoHandReadiness: weapon === 'hammer' ? twoHandReadiness : null,
    oneHandReadiness: weapon === 'hammer' ? null : oneHandReadiness,
    weaponForwardWorld,
    weaponUpWorld,
    primaryGripWorldPosition,
    offhandGripWorldPosition,
  };
}
