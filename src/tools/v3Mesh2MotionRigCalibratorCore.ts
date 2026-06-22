import * as THREE from 'three';
import type { V3WeaponId } from '../components/v3/v3ModelTypes';
import {
  V3_MESH2MOTION_CALIBRATION_LIMITS,
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  getV3Mesh2MotionCalibration,
  normalizeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
  type V3Mesh2MotionCalibration,
} from '../components/grifball/v3Mesh2MotionCalibration';
import { analyzeV3WeaponCarryAlignment } from '../components/grifball/v3WeaponSocketBasis';

export {
  V3_MESH2MOTION_CALIBRATION_LIMITS,
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  getV3Mesh2MotionCalibration,
  normalizeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
  type V3Mesh2MotionCalibration,
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

export function computeV3Mesh2MotionSocketCalibrationFromWorldTransform({
  parentWorldMatrix,
  handleWorldMatrix,
  restLocalPosition,
}: V3Mesh2MotionSocketCalibrationTransformInput): V3Mesh2MotionSocketCalibrationTransformResult {
  const localMatrix = parentWorldMatrix.clone().invert().multiply(handleWorldMatrix);
  const localPosition = new THREE.Vector3();
  const localQuaternion = new THREE.Quaternion();
  const localScale = new THREE.Vector3();
  localMatrix.decompose(localPosition, localQuaternion, localScale);
  localQuaternion.normalize();

  const position = localPosition.sub(restLocalPosition);
  const rotationEuler = new THREE.Euler().setFromQuaternion(localQuaternion, 'XYZ');

  return {
    position,
    quaternion: localQuaternion,
    rotation: [rotationEuler.x, rotationEuler.y, rotationEuler.z],
  };
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
