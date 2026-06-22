import * as THREE from 'three';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId, type V3WeaponId } from '../components/v3/v3ModelTypes';
import {
  V3_MESH2MOTION_CALIBRATION_LIMITS,
  V3_MESH2MOTION_DRIVER_JOINT_NAMES,
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  getV3Mesh2MotionCalibration,
  normalizeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
  type V3Mesh2MotionCalibration,
  type V3Mesh2MotionCalibrationTargetDescriptor,
} from '../components/grifball/v3Mesh2MotionCalibration';
import { V3_MESH2MOTION_CLIP_SET } from '../components/grifball/v3Mesh2MotionClips.generated';
import {
  getV3Mesh2MotionDriverRig,
  V3_MESH2MOTION_SLOT_DRIVER_JOINTS,
  type V3Mesh2MotionDriverRig,
  type V3Mesh2MotionDriverWeaponSocketName,
} from '../components/grifball/v3Mesh2MotionDriverRig';
import { analyzeV3WeaponCarryAlignment } from '../components/grifball/v3WeaponSocketBasis';

export {
  V3_MESH2MOTION_CALIBRATION_LIMITS,
  V3_MESH2MOTION_DRIVER_JOINT_NAMES,
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  getV3Mesh2MotionCalibration,
  normalizeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
  type V3Mesh2MotionCalibration,
  type V3Mesh2MotionCalibrationTargetDescriptor,
};

export interface V3Mesh2MotionCalibrationClearanceDiagnostic {
  slot: string;
  outwardGap: number;
  intersectsChest: boolean;
  status: 'pass' | 'warn' | 'fail';
}

export interface V3Mesh2MotionCalibrationChainDiagnostic {
  id: string;
  distance: number;
  status: 'pass' | 'warn' | 'fail';
}

export interface V3Mesh2MotionCalibrationArmDiagnostics {
  clearances: V3Mesh2MotionCalibrationClearanceDiagnostic[];
  chainLinks: V3Mesh2MotionCalibrationChainDiagnostic[];
}

export interface V3Mesh2MotionCalibrationWeaponDiagnostics {
  primaryGripDrift: number;
  offhandGripDrift: number | null;
  forwardAxis: { x: number; y: number; z: number };
  upAxis: { x: number; y: number; z: number };
  forwardAlignment: number;
  upAlignment: number;
}

export interface V3Mesh2MotionCalibrationDiagnostics {
  kind: 'v3-mesh2motion-calibration-diagnostics';
  version: 1;
  ready: boolean;
  arms: {
    left: V3Mesh2MotionCalibrationArmDiagnostics;
    right: V3Mesh2MotionCalibrationArmDiagnostics;
  };
  weapon: V3Mesh2MotionCalibrationWeaponDiagnostics | null;
  warnings: string[];
}

export interface V3Mesh2MotionSocketCalibrationTransformInput {
  parentWorldMatrix: THREE.Matrix4;
  handleWorldMatrix: THREE.Matrix4;
  restLocalPosition: THREE.Vector3;
}

export interface V3Mesh2MotionSocketCalibrationTransformResult {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  rotation: [number, number, number];
}

export interface V3Mesh2MotionDriverJointAdjustmentInput {
  parentWorldMatrix: THREE.Matrix4;
  handleWorldMatrix: THREE.Matrix4;
  baseLocalPosition: THREE.Vector3;
  baseLocalQuaternion: THREE.Quaternion;
}

export interface V3Mesh2MotionPartBindingAdjustmentInput {
  baseWorldMatrix: THREE.Matrix4;
  handleWorldMatrix: THREE.Matrix4;
}

export interface V3Mesh2MotionCalibrationTargetWorldTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
  sourceJointName: string | null;
}

const ARM_SLOTS = {
  left: ['upperArmLeft', 'forearmLeft', 'handLeft'],
  right: ['upperArmRight', 'forearmRight', 'handRight'],
} as const;

const ARM_CHAIN_LINKS = {
  left: [
    ['shoulderLeft', 'upperArmLeft'],
    ['upperArmLeft', 'forearmLeft'],
    ['forearmLeft', 'handLeft'],
  ],
  right: [
    ['shoulderRight', 'upperArmRight'],
    ['upperArmRight', 'forearmRight'],
    ['forearmRight', 'handRight'],
  ],
} as const;

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const vec3Record = (value: THREE.Vector3): { x: number; y: number; z: number } => ({
  x: roundMetric(value.x),
  y: roundMetric(value.y),
  z: roundMetric(value.z),
});

const objectBox = (object: THREE.Object3D): THREE.Box3 =>
  new THREE.Box3().setFromObject(object);

const boxCenter = (object: THREE.Object3D): THREE.Vector3 =>
  objectBox(object).getCenter(new THREE.Vector3());

const DRIVER_PARENT_BY_NAME = new Map(
  V3_MESH2MOTION_CLIP_SET.skeleton.joints.map((joint) => [String(joint.name), joint.parent ? String(joint.parent) : null])
);

const readableLabel = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const affectedSlotsForJoint = (sourceJointName: string): V3CharacterSlotId[] =>
  (Object.entries(V3_MESH2MOTION_SLOT_DRIVER_JOINTS) as [V3CharacterSlotId, string][])
    .filter(([, jointName]) => jointName === sourceJointName)
    .map(([slot]) => slot);

const rotationTupleFromQuaternion = (quaternion: THREE.Quaternion): [number, number, number] => {
  const euler = new THREE.Euler().setFromQuaternion(quaternion.normalize(), 'XYZ');
  return [euler.x, euler.y, euler.z];
};

const decomposeAdjustmentMatrix = (matrix: THREE.Matrix4): V3Mesh2MotionSocketCalibrationTransformResult => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  quaternion.normalize();
  return {
    position,
    quaternion,
    rotation: rotationTupleFromQuaternion(quaternion),
  };
};

export function listV3Mesh2MotionCalibrationTargets(): V3Mesh2MotionCalibrationTargetDescriptor[] {
  const driverTargets = V3_MESH2MOTION_DRIVER_JOINT_NAMES.map((jointName) => {
    const affectedSlots = affectedSlotsForJoint(jointName);
    return {
      kind: 'driverJoint' as const,
      id: jointName,
      label: readableLabel(jointName),
      sourceJointName: jointName,
      parentJointName: DRIVER_PARENT_BY_NAME.get(jointName) ?? null,
      affectedSlots,
      hasVisibleBinding: affectedSlots.length > 0,
    };
  });

  const partTargets = V3_CHARACTER_SLOT_IDS.map((slot) => {
    const sourceJointName = V3_MESH2MOTION_SLOT_DRIVER_JOINTS[slot] ?? null;
    return {
      kind: 'partBinding' as const,
      id: slot,
      label: readableLabel(slot),
      sourceJointName,
      parentJointName: sourceJointName ? DRIVER_PARENT_BY_NAME.get(sourceJointName) ?? null : null,
      affectedSlots: [slot],
      hasVisibleBinding: true,
    };
  });

  const socketTargets = (['rightHandGrip', 'leftHandGrip'] as const satisfies readonly V3Mesh2MotionDriverWeaponSocketName[])
    .map((socketName) => {
      const sourceJointName = socketName === 'rightHandGrip' ? 'hand_r' : 'hand_l';
      const affectedSlots: V3CharacterSlotId[] = [socketName === 'rightHandGrip' ? 'handRight' : 'handLeft'];
      return {
        kind: 'weaponSocket' as const,
        id: socketName,
        label: readableLabel(socketName),
        sourceJointName,
        parentJointName: DRIVER_PARENT_BY_NAME.get(sourceJointName) ?? null,
        affectedSlots,
        hasVisibleBinding: true,
      };
    });

  return [...partTargets, ...driverTargets, ...socketTargets];
}

export function getV3Mesh2MotionCalibrationTargetWorldTransform(
  model: THREE.Group,
  kind: V3Mesh2MotionCalibrationTargetDescriptor['kind'],
  targetId: string,
  rig: V3Mesh2MotionDriverRig = getV3Mesh2MotionDriverRig(model)
): V3Mesh2MotionCalibrationTargetWorldTransform | null {
  model.updateWorldMatrix(true, true);
  if (kind === 'driverJoint') {
    const joint = rig.joints[targetId];
    if (!joint) return null;
    joint.object.updateWorldMatrix(true, false);
    return {
      position: joint.object.getWorldPosition(new THREE.Vector3()),
      quaternion: joint.object.getWorldQuaternion(new THREE.Quaternion()).normalize(),
      matrix: joint.object.matrixWorld.clone(),
      sourceJointName: joint.name,
    };
  }
  if (kind === 'partBinding') {
    const binding = rig.partBindings[targetId as V3CharacterSlotId];
    if (!binding) return null;
    binding.partGroup.updateWorldMatrix(true, false);
    return {
      position: binding.partGroup.getWorldPosition(new THREE.Vector3()),
      quaternion: binding.partGroup.getWorldQuaternion(new THREE.Quaternion()).normalize(),
      matrix: binding.partGroup.matrixWorld.clone(),
      sourceJointName: binding.sourceJointName,
    };
  }
  const socket = rig.weaponSockets[targetId as V3Mesh2MotionDriverWeaponSocketName];
  if (!socket) return null;
  socket.object.updateWorldMatrix(true, false);
  return {
    position: socket.object.getWorldPosition(new THREE.Vector3()),
    quaternion: socket.object.getWorldQuaternion(new THREE.Quaternion()).normalize(),
    matrix: socket.object.matrixWorld.clone(),
    sourceJointName: socket.sourceJointName,
  };
}

const diagnosticStatus = (
  value: number,
  warn: number,
  fail: number,
  direction: 'min' | 'max'
): 'pass' | 'warn' | 'fail' => {
  if (!Number.isFinite(value)) return 'fail';
  if (direction === 'min') {
    if (value < fail) return 'fail';
    if (value < warn) return 'warn';
    return 'pass';
  }
  if (value > fail) return 'fail';
  if (value > warn) return 'warn';
  return 'pass';
};

const armDiagnostics = (
  model: THREE.Group,
  side: 'left' | 'right',
  partGroups: Record<string, THREE.Group>,
  chest: THREE.Group
): V3Mesh2MotionCalibrationArmDiagnostics => {
  const sign = side === 'left' ? 1 : -1;
  const modelRight = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  const chestCenter = boxCenter(chest);
  const chestBox = objectBox(chest);
  const clearances = ARM_SLOTS[side].map((slot) => {
    const part = partGroups[slot];
    const center = part ? boxCenter(part) : new THREE.Vector3();
    const outwardGap = part ? center.clone().sub(chestCenter).dot(modelRight) * sign : 0;
    const intersectsChest = part ? chestBox.intersectsBox(objectBox(part)) : true;
    const status = intersectsChest
      ? diagnosticStatus(outwardGap, 0.22, 0.16, 'min')
      : diagnosticStatus(outwardGap, 0.18, 0.12, 'min');
    return {
      slot,
      outwardGap: roundMetric(outwardGap),
      intersectsChest,
      status,
    };
  });
  const chainLinks = ARM_CHAIN_LINKS[side].map(([fromSlot, toSlot]) => {
    const from = partGroups[fromSlot];
    const to = partGroups[toSlot];
    const distance = from && to ? boxCenter(from).distanceTo(boxCenter(to)) : Number.POSITIVE_INFINITY;
    return {
      id: `${fromSlot}->${toSlot}`,
      distance: roundMetric(distance),
      status: diagnosticStatus(distance, 0.34, 0.44, 'max'),
    };
  });
  return { clearances, chainLinks };
};

export function serializeV3Mesh2MotionCalibration(calibration: V3Mesh2MotionCalibration): string {
  return JSON.stringify(normalizeV3Mesh2MotionCalibration(calibration), null, 2);
}

export function parseV3Mesh2MotionCalibrationJson(json: string): V3Mesh2MotionCalibration {
  return normalizeV3Mesh2MotionCalibration(JSON.parse(json) as unknown);
}

export function computeDriverJointAdjustmentFromWorldTransform({
  parentWorldMatrix,
  handleWorldMatrix,
  baseLocalPosition,
  baseLocalQuaternion,
}: V3Mesh2MotionDriverJointAdjustmentInput): V3Mesh2MotionSocketCalibrationTransformResult {
  const localMatrix = parentWorldMatrix.clone().invert().multiply(handleWorldMatrix);
  const localPosition = new THREE.Vector3();
  const localQuaternion = new THREE.Quaternion();
  const localScale = new THREE.Vector3();
  localMatrix.decompose(localPosition, localQuaternion, localScale);
  localQuaternion.normalize();

  const quaternion = baseLocalQuaternion.clone().invert().multiply(localQuaternion).normalize();
  return {
    position: localPosition.sub(baseLocalPosition),
    quaternion,
    rotation: rotationTupleFromQuaternion(quaternion),
  };
}

export function computePartBindingAdjustmentFromWorldTransform({
  baseWorldMatrix,
  handleWorldMatrix,
}: V3Mesh2MotionPartBindingAdjustmentInput): V3Mesh2MotionSocketCalibrationTransformResult {
  return decomposeAdjustmentMatrix(baseWorldMatrix.clone().invert().multiply(handleWorldMatrix));
}

export function computeWeaponSocketAdjustmentFromWorldTransform({
  parentWorldMatrix,
  handleWorldMatrix,
  restLocalPosition,
}: V3Mesh2MotionSocketCalibrationTransformInput): V3Mesh2MotionSocketCalibrationTransformResult {
  const localMatrix = parentWorldMatrix.clone().invert().multiply(handleWorldMatrix);
  const result = decomposeAdjustmentMatrix(localMatrix);
  result.position.sub(restLocalPosition);
  return result;
}

export function computeV3Mesh2MotionSocketCalibrationFromWorldTransform({
  parentWorldMatrix,
  handleWorldMatrix,
  restLocalPosition,
}: V3Mesh2MotionSocketCalibrationTransformInput): V3Mesh2MotionSocketCalibrationTransformResult {
  return computeWeaponSocketAdjustmentFromWorldTransform({
    parentWorldMatrix,
    handleWorldMatrix,
    restLocalPosition,
  });
}

export function buildV3Mesh2MotionCalibrationDiagnostics(
  model: THREE.Group,
  weaponModel?: THREE.Object3D | null,
  weapon: V3WeaponId = 'sword'
): V3Mesh2MotionCalibrationDiagnostics {
  model.updateWorldMatrix(true, true);
  weaponModel?.updateWorldMatrix(true, true);
  const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group> | undefined;
  const chest = partGroups?.chest;
  const warnings: string[] = [];

  if (!partGroups || !chest) {
    return {
      kind: 'v3-mesh2motion-calibration-diagnostics',
      version: 1,
      ready: false,
      arms: {
        left: { clearances: [], chainLinks: [] },
        right: { clearances: [], chainLinks: [] },
      },
      weapon: null,
      warnings: ['missing V3 part groups'],
    };
  }

  const arms = {
    left: armDiagnostics(model, 'left', partGroups, chest),
    right: armDiagnostics(model, 'right', partGroups, chest),
  };
  for (const side of [arms.left, arms.right]) {
    for (const item of [...side.clearances, ...side.chainLinks]) {
      if (item.status !== 'pass') warnings.push(`${'slot' in item ? item.slot : item.id} ${item.status}`);
    }
  }

  const alignment = weaponModel ? analyzeV3WeaponCarryAlignment(model, weaponModel, weapon) : null;
  const weaponReport: V3Mesh2MotionCalibrationWeaponDiagnostics | null = alignment ? {
    primaryGripDrift: roundMetric(alignment.primaryGripDrift),
    offhandGripDrift: alignment.offhandGripDrift === null ? null : roundMetric(alignment.offhandGripDrift),
    forwardAxis: vec3Record(alignment.weaponForwardWorld),
    upAxis: vec3Record(alignment.weaponUpWorld),
    forwardAlignment: roundMetric(alignment.basisForwardAlignment),
    upAlignment: roundMetric(alignment.basisUpAlignment),
  } : null;

  if (weaponReport && weaponReport.primaryGripDrift > 0.08) {
    warnings.push(`weapon primary grip drift ${weaponReport.primaryGripDrift.toFixed(3)}`);
  }

  return {
    kind: 'v3-mesh2motion-calibration-diagnostics',
    version: 1,
    ready: warnings.length === 0,
    arms,
    weapon: weaponReport,
    warnings,
  };
}
