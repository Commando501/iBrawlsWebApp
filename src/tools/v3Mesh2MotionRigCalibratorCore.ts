import * as THREE from 'three';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId, type V3WeaponId } from '../components/v3/v3ModelTypes';
import type { V3AuthoredClipId } from '../components/grifball/v3AuthoredAnimationClips';
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

export type V3Mesh2MotionPriorityReviewClipId = Extract<
  V3AuthoredClipId,
  'clean_sprint' | 'clean_slide' | 'clean_sword_carry' | 'clean_sword_lunge' | 'clean_sword_slash'
>;

export interface V3Mesh2MotionCalibrationPriorityReviewClip {
  id: V3Mesh2MotionPriorityReviewClipId;
  label: string;
  sourceClipName: 'Sprint_Loop' | 'Slide_Loop' | 'Sword_Idle' | 'Sword_Dash_RM' | 'Sword_Regular_B';
  durationFrames: number;
  frames: readonly number[];
  activeWeapon: V3WeaponId;
  weaponState: string;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
}

export interface V3Mesh2MotionCalibrationPriorityFrameMetrics {
  shoulderLateralDistance: { left: number; right: number };
  handLateralDistance: { left: number; right: number };
  handSymmetryDelta: number;
  shoulderSymmetryDelta: number;
  upperArmPartDrift: { left: number; right: number };
  forearmPartDrift: { left: number; right: number };
  footFloorClearance: number;
  weaponPrimaryGripDrift: number;
  weaponOffhandGripDrift: number | null;
}

export interface V3Mesh2MotionCalibrationPriorityFrameReport {
  clipId: V3Mesh2MotionPriorityReviewClipId;
  label: string;
  sourceClipName: V3Mesh2MotionCalibrationPriorityReviewClip['sourceClipName'];
  frame: number;
  durationFrames: number;
  normalizedTime: number;
  status: 'pass' | 'warn' | 'fail';
  metrics: V3Mesh2MotionCalibrationPriorityFrameMetrics;
  warnings: string[];
}

export interface V3Mesh2MotionCalibrationPriorityReport {
  kind: 'v3-mesh2motion-calibration-priority-report';
  version: 1;
  ready: boolean;
  summary: {
    sampleCount: number;
    passCount: number;
    warnCount: number;
    failCount: number;
    maxHandLateralDistance: number;
    minHandLateralDistance: number;
    maxShoulderLateralDistance: number;
    maxHandSymmetryDelta: number;
    maxShoulderSymmetryDelta: number;
    maxUpperArmPartDrift: number;
    maxForearmPartDrift: number;
    minFootFloorClearance: number;
    maxWeaponPrimaryGripDrift: number;
    maxWeaponOffhandGripDrift: number;
  };
  samples: V3Mesh2MotionCalibrationPriorityFrameReport[];
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
  scale: THREE.Vector3;
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

export interface V3Mesh2MotionAnchoredPartBindingAdjustmentInput extends V3Mesh2MotionPartBindingAdjustmentInput {
  anchorLocalOffset: THREE.Vector3;
}

export interface V3Mesh2MotionCalibrationTargetWorldTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  matrix: THREE.Matrix4;
  sourceJointName: string | null;
  anchorLocalOffset?: THREE.Vector3;
}

export type V3Mesh2MotionCalibratorHotkeyAction =
  | { type: 'togglePlay' }
  | { type: 'stepFrame'; amount: number }
  | { type: 'editMode'; mode: V3Mesh2MotionCalibrationTargetDescriptor['kind'] }
  | { type: 'transformMode'; mode: 'translate' | 'rotate' | 'scale' }
  | { type: 'autoRelocate' };

export interface V3Mesh2MotionCalibratorHotkeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  targetTagName?: string | null;
  targetIsContentEditable?: boolean;
}

export interface V3Mesh2MotionPartBindingAutoRelocateInput {
  model: THREE.Group;
  rig: V3Mesh2MotionDriverRig;
  slot: V3CharacterSlotId;
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

export const V3_MESH2MOTION_PRIORITY_REVIEW_CLIPS: readonly V3Mesh2MotionCalibrationPriorityReviewClip[] = [
  {
    id: 'clean_sprint',
    label: 'Sprint',
    sourceClipName: 'Sprint_Loop',
    durationFrames: 90,
    frames: [0, 23, 45, 68, 82, 90],
    activeWeapon: 'sword',
    weaponState: 'ready',
    isSprinting: true,
  },
  {
    id: 'clean_slide',
    label: 'Slide',
    sourceClipName: 'Slide_Loop',
    durationFrames: 72,
    frames: [0, 18, 36, 54, 72],
    activeWeapon: 'sword',
    weaponState: 'ready',
    isSliding: true,
  },
  {
    id: 'clean_sword_carry',
    label: 'Sword Carry',
    sourceClipName: 'Sword_Idle',
    durationFrames: 90,
    frames: [0, 30, 60, 90],
    activeWeapon: 'sword',
    weaponState: 'ready',
  },
  {
    id: 'clean_sword_lunge',
    label: 'Sword Lunge',
    sourceClipName: 'Sword_Dash_RM',
    durationFrames: 60,
    frames: [0, 15, 30, 45, 60],
    activeWeapon: 'sword',
    weaponState: 'ready',
    isLunging: true,
  },
  {
    id: 'clean_sword_slash',
    label: 'Sword Slash',
    sourceClipName: 'Sword_Regular_B',
    durationFrames: 60,
    frames: [0, 15, 30, 45, 60],
    activeWeapon: 'sword',
    weaponState: 'slashing',
  },
] as const;

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

const objectWorldScale = (object: THREE.Object3D): THREE.Vector3 =>
  object.getWorldScale(new THREE.Vector3());

const localBoundsCenter = (object: THREE.Object3D): THREE.Vector3 => {
  object.updateWorldMatrix(true, true);
  const inverseObjectWorld = object.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const corner = new THREE.Vector3();
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const geometryBounds = geometry.boundingBox;
    if (!geometryBounds) return;
    const childToObject = inverseObjectWorld.clone().multiply(child.matrixWorld);
    for (const x of [geometryBounds.min.x, geometryBounds.max.x]) {
      for (const y of [geometryBounds.min.y, geometryBounds.max.y]) {
        for (const z of [geometryBounds.min.z, geometryBounds.max.z]) {
          corner.set(x, y, z).applyMatrix4(childToObject);
          bounds.expandByPoint(corner);
        }
      }
    }
  });
  if (!bounds.isEmpty()) return bounds.getCenter(new THREE.Vector3());
  return object.worldToLocal(boxCenter(object));
};

const DRIVER_PARENT_BY_NAME = new Map(
  V3_MESH2MOTION_CLIP_SET.skeleton.joints.map((joint) => [String(joint.name), joint.parent ? String(joint.parent) : null])
);

const DRIVER_CHILDREN_BY_NAME = new Map<string, string[]>();
for (const joint of V3_MESH2MOTION_CLIP_SET.skeleton.joints) {
  const parent = joint.parent ? String(joint.parent) : null;
  if (!parent) continue;
  DRIVER_CHILDREN_BY_NAME.set(parent, [...(DRIVER_CHILDREN_BY_NAME.get(parent) ?? []), String(joint.name)]);
}

const PRIMARY_AUTO_RELOCATE_CHILD_BY_SLOT: Partial<Record<V3CharacterSlotId, string>> = {
  upperArmLeft: 'lowerarm_l',
  upperArmRight: 'lowerarm_r',
  forearmLeft: 'hand_l',
  forearmRight: 'hand_r',
  thighLeft: 'calf_l',
  thighRight: 'calf_r',
  shinLeft: 'foot_l',
  shinRight: 'foot_r',
};

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
    scale,
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

export function resolveV3Mesh2MotionCalibratorHotkey({
  key,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  targetTagName = null,
  targetIsContentEditable = false,
}: V3Mesh2MotionCalibratorHotkeyInput): V3Mesh2MotionCalibratorHotkeyAction | null {
  const tagName = targetTagName?.toUpperCase() ?? '';
  if (targetIsContentEditable || tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
    return null;
  }
  if (ctrlKey || metaKey || altKey) return null;

  if (key === ' ' || key === 'Spacebar' || key === 'Space') return { type: 'togglePlay' };
  if (key === 'ArrowLeft') return { type: 'stepFrame', amount: shiftKey ? -10 : -1 };
  if (key === 'ArrowRight') return { type: 'stepFrame', amount: shiftKey ? 10 : 1 };

  switch (key.toLowerCase()) {
    case '1':
      return { type: 'editMode', mode: 'partBinding' };
    case '2':
      return { type: 'editMode', mode: 'driverJoint' };
    case '3':
      return { type: 'editMode', mode: 'weaponSocket' };
    case 'w':
      return { type: 'transformMode', mode: 'translate' };
    case 'e':
      return { type: 'transformMode', mode: 'scale' };
    case 'r':
      return { type: 'transformMode', mode: 'rotate' };
    case 'a':
      return { type: 'autoRelocate' };
    default:
      return null;
  }
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
      scale: objectWorldScale(joint.object),
      matrix: joint.object.matrixWorld.clone(),
      sourceJointName: joint.name,
    };
  }
  if (kind === 'partBinding') {
    const binding = rig.partBindings[targetId as V3CharacterSlotId];
    if (!binding) return null;
    binding.partGroup.updateWorldMatrix(true, false);
    const anchorLocalOffset = localBoundsCenter(binding.partGroup);
    const position = binding.partGroup.localToWorld(anchorLocalOffset.clone());
    const quaternion = binding.partGroup.getWorldQuaternion(new THREE.Quaternion()).normalize();
    const scale = objectWorldScale(binding.partGroup);
    const matrix = new THREE.Matrix4().compose(position, quaternion, scale);
    return {
      position,
      quaternion,
      scale,
      matrix,
      sourceJointName: binding.sourceJointName,
      anchorLocalOffset,
    };
  }
  const socket = rig.weaponSockets[targetId as V3Mesh2MotionDriverWeaponSocketName];
  if (!socket) return null;
  socket.object.updateWorldMatrix(true, false);
  return {
    position: socket.object.getWorldPosition(new THREE.Vector3()),
    quaternion: socket.object.getWorldQuaternion(new THREE.Quaternion()).normalize(),
    scale: objectWorldScale(socket.object),
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
    scale: new THREE.Vector3(1, 1, 1),
  };
}

export function computePartBindingAdjustmentFromWorldTransform({
  baseWorldMatrix,
  handleWorldMatrix,
}: V3Mesh2MotionPartBindingAdjustmentInput): V3Mesh2MotionSocketCalibrationTransformResult {
  return decomposeAdjustmentMatrix(baseWorldMatrix.clone().invert().multiply(handleWorldMatrix));
}

export function computePartBindingAdjustmentFromAnchoredWorldTransform({
  baseWorldMatrix,
  handleWorldMatrix,
  anchorLocalOffset,
}: V3Mesh2MotionAnchoredPartBindingAdjustmentInput): V3Mesh2MotionSocketCalibrationTransformResult {
  const desiredOriginWorldMatrix = handleWorldMatrix.clone().multiply(
    new THREE.Matrix4().makeTranslation(-anchorLocalOffset.x, -anchorLocalOffset.y, -anchorLocalOffset.z)
  );
  return computePartBindingAdjustmentFromWorldTransform({
    baseWorldMatrix,
    handleWorldMatrix: desiredOriginWorldMatrix,
  });
}

const jointWorldPosition = (
  rig: V3Mesh2MotionDriverRig,
  jointName: string
): THREE.Vector3 | null => {
  const joint = rig.joints[jointName];
  if (!joint) return null;
  joint.object.updateWorldMatrix(true, false);
  return joint.object.getWorldPosition(new THREE.Vector3());
};

const averageJointWorldPosition = (
  rig: V3Mesh2MotionDriverRig,
  jointNames: readonly string[]
): THREE.Vector3 | null => {
  const positions = jointNames
    .map((jointName) => jointWorldPosition(rig, jointName))
    .filter((position): position is THREE.Vector3 => position !== null);
  if (positions.length === 0) return null;
  return positions.reduce((sum, position) => sum.add(position), new THREE.Vector3()).multiplyScalar(1 / positions.length);
};

const autoRelocateAnchorWorldPosition = (
  rig: V3Mesh2MotionDriverRig,
  slot: V3CharacterSlotId,
  sourceJointName: string
): THREE.Vector3 | null => {
  const source = jointWorldPosition(rig, sourceJointName);
  if (!source) return null;

  const primaryChildName = PRIMARY_AUTO_RELOCATE_CHILD_BY_SLOT[slot];
  const primaryChild = primaryChildName ? jointWorldPosition(rig, primaryChildName) : null;
  if (primaryChild) return source.clone().lerp(primaryChild, 0.5);

  const childAverage = averageJointWorldPosition(rig, DRIVER_CHILDREN_BY_NAME.get(sourceJointName) ?? []);
  return childAverage ?? source;
};

export function computeV3Mesh2MotionPartBindingAutoRelocateAdjustment({
  model,
  rig,
  slot,
}: V3Mesh2MotionPartBindingAutoRelocateInput): V3Mesh2MotionSocketCalibrationTransformResult | null {
  model.updateWorldMatrix(true, true);
  const binding = rig.partBindings[slot];
  const joint = binding ? rig.joints[binding.sourceJointName] : null;
  if (!binding || !joint) return null;
  const anchorWorldPosition = autoRelocateAnchorWorldPosition(rig, slot, binding.sourceJointName);
  if (!anchorWorldPosition) return null;

  binding.partGroup.updateWorldMatrix(true, false);
  joint.object.updateWorldMatrix(true, false);
  const currentTarget = getV3Mesh2MotionCalibrationTargetWorldTransform(model, 'partBinding', slot, rig);
  if (!currentTarget?.anchorLocalOffset) return null;
  const handleWorldMatrix = new THREE.Matrix4().compose(
    anchorWorldPosition,
    currentTarget.quaternion,
    currentTarget.scale
  );
  const result = computePartBindingAdjustmentFromAnchoredWorldTransform({
    baseWorldMatrix: joint.object.matrixWorld.clone().multiply(binding.bindMatrix),
    handleWorldMatrix,
    anchorLocalOffset: currentTarget.anchorLocalOffset,
  });

  return result;
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

const priorityMax = <Sample>(
  samples: readonly Sample[],
  valueForSample: (sample: Sample) => number
): number => {
  const values = samples.map(valueForSample).filter(Number.isFinite);
  return values.length ? roundMetric(Math.max(...values)) : 0;
};

const priorityMin = <Sample>(
  samples: readonly Sample[],
  valueForSample: (sample: Sample) => number
): number => {
  const values = samples.map(valueForSample).filter(Number.isFinite);
  return values.length ? roundMetric(Math.min(...values)) : 0;
};

const priorityStatusRank = (status: 'pass' | 'warn' | 'fail'): number =>
  status === 'fail' ? 2 : status === 'warn' ? 1 : 0;

const maxPriorityStatus = (
  current: 'pass' | 'warn' | 'fail',
  next: 'pass' | 'warn' | 'fail'
): 'pass' | 'warn' | 'fail' =>
  priorityStatusRank(next) > priorityStatusRank(current) ? next : current;

const priorityPartGroup = (
  partGroups: Record<string, THREE.Group>,
  slot: string,
  warnings: string[]
): THREE.Group | null => {
  const part = partGroups[slot];
  if (!part) {
    warnings.push(`missing ${slot} part group`);
    return null;
  }
  return part;
};

const lateralDistanceFromChest = (
  modelRight: THREE.Vector3,
  chestCenter: THREE.Vector3,
  part: THREE.Object3D | null
): number => {
  if (!part) return 0;
  return roundMetric(Math.abs(boxCenter(part).sub(chestCenter).dot(modelRight)));
};

const slotPartDrift = (
  rig: V3Mesh2MotionDriverRig,
  slot: V3CharacterSlotId,
  warnings: string[]
): number => {
  const binding = rig.partBindings[slot];
  const joint = binding ? rig.joints[binding.sourceJointName] : null;
  if (!binding || !joint) {
    warnings.push(`missing ${slot} Mesh2Motion binding`);
    return 0;
  }
  binding.partGroup.updateWorldMatrix(true, false);
  joint.object.updateWorldMatrix(true, false);
  return roundMetric(boxCenter(binding.partGroup).distanceTo(joint.object.getWorldPosition(new THREE.Vector3())));
};

const addPriorityThresholdWarning = (
  warnings: string[],
  message: string,
  status: 'pass' | 'warn' | 'fail',
  warn: boolean,
  fail: boolean
): 'pass' | 'warn' | 'fail' => {
  if (fail) {
    warnings.push(`${message} fail`);
    return maxPriorityStatus(status, 'fail');
  }
  if (warn) {
    warnings.push(`${message} warn`);
    return maxPriorityStatus(status, 'warn');
  }
  return status;
};

export function captureV3Mesh2MotionCalibrationPriorityFrame({
  model,
  weaponModel,
  weapon = 'sword',
  clip,
  frame,
}: {
  model: THREE.Group;
  weaponModel?: THREE.Object3D | null;
  weapon?: V3WeaponId;
  clip: V3Mesh2MotionCalibrationPriorityReviewClip;
  frame: number;
}): V3Mesh2MotionCalibrationPriorityFrameReport {
  model.updateWorldMatrix(true, true);
  weaponModel?.updateWorldMatrix(true, true);
  const warnings: string[] = [];
  const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group> | undefined;
  const rig = getV3Mesh2MotionDriverRig(model);
  const normalizedTime = roundMetric(Math.max(0, Math.min(clip.durationFrames, frame)) / Math.max(1, clip.durationFrames));

  if (!partGroups?.chest) {
    return {
      clipId: clip.id,
      label: clip.label,
      sourceClipName: clip.sourceClipName,
      frame,
      durationFrames: clip.durationFrames,
      normalizedTime,
      status: 'fail',
      metrics: {
        shoulderLateralDistance: { left: 0, right: 0 },
        handLateralDistance: { left: 0, right: 0 },
        handSymmetryDelta: 0,
        shoulderSymmetryDelta: 0,
        upperArmPartDrift: { left: 0, right: 0 },
        forearmPartDrift: { left: 0, right: 0 },
        footFloorClearance: 0,
        weaponPrimaryGripDrift: 0,
        weaponOffhandGripDrift: null,
      },
      warnings: ['missing V3 part groups'],
    };
  }

  const modelRight = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  const chestCenter = boxCenter(partGroups.chest);
  const shoulderLeft = priorityPartGroup(partGroups, 'shoulderLeft', warnings);
  const shoulderRight = priorityPartGroup(partGroups, 'shoulderRight', warnings);
  const handLeft = priorityPartGroup(partGroups, 'handLeft', warnings);
  const handRight = priorityPartGroup(partGroups, 'handRight', warnings);
  const footLeft = priorityPartGroup(partGroups, 'footLeft', warnings);
  const footRight = priorityPartGroup(partGroups, 'footRight', warnings);
  const leftHandLateral = lateralDistanceFromChest(modelRight, chestCenter, handLeft);
  const rightHandLateral = lateralDistanceFromChest(modelRight, chestCenter, handRight);
  const leftShoulderLateral = lateralDistanceFromChest(modelRight, chestCenter, shoulderLeft);
  const rightShoulderLateral = lateralDistanceFromChest(modelRight, chestCenter, shoulderRight);
  const footFloorClearance = roundMetric(Math.min(
    footLeft ? objectBox(footLeft).min.y : 0,
    footRight ? objectBox(footRight).min.y : 0
  ));
  const diagnostics = buildV3Mesh2MotionCalibrationDiagnostics(model, weaponModel, weapon);

  const metrics: V3Mesh2MotionCalibrationPriorityFrameMetrics = {
    shoulderLateralDistance: {
      left: leftShoulderLateral,
      right: rightShoulderLateral,
    },
    handLateralDistance: {
      left: leftHandLateral,
      right: rightHandLateral,
    },
    handSymmetryDelta: roundMetric(Math.abs(leftHandLateral - rightHandLateral)),
    shoulderSymmetryDelta: roundMetric(Math.abs(leftShoulderLateral - rightShoulderLateral)),
    upperArmPartDrift: {
      left: slotPartDrift(rig, 'upperArmLeft', warnings),
      right: slotPartDrift(rig, 'upperArmRight', warnings),
    },
    forearmPartDrift: {
      left: slotPartDrift(rig, 'forearmLeft', warnings),
      right: slotPartDrift(rig, 'forearmRight', warnings),
    },
    footFloorClearance,
    weaponPrimaryGripDrift: diagnostics.weapon?.primaryGripDrift ?? 0,
    weaponOffhandGripDrift: diagnostics.weapon?.offhandGripDrift ?? null,
  };

  let status: 'pass' | 'warn' | 'fail' = 'pass';
  const maxHandLateral = Math.max(metrics.handLateralDistance.left, metrics.handLateralDistance.right);
  const minHandLateral = Math.min(metrics.handLateralDistance.left, metrics.handLateralDistance.right);
  const maxUpperArmDrift = Math.max(metrics.upperArmPartDrift.left, metrics.upperArmPartDrift.right);
  const maxForearmDrift = Math.max(metrics.forearmPartDrift.left, metrics.forearmPartDrift.right);
  const offhandDrift = metrics.weaponOffhandGripDrift ?? 0;

  status = addPriorityThresholdWarning(warnings, 'hand too close to torso', status, minHandLateral < 0.12, minHandLateral < 0.08);
  status = addPriorityThresholdWarning(warnings, 'hand lateral spread high', status, maxHandLateral > 0.84, maxHandLateral > 0.92);
  status = addPriorityThresholdWarning(warnings, 'hand symmetry delta high', status, metrics.handSymmetryDelta > 0.32, metrics.handSymmetryDelta > 0.42);
  status = addPriorityThresholdWarning(warnings, 'shoulder symmetry delta high', status, metrics.shoulderSymmetryDelta > 0.18, metrics.shoulderSymmetryDelta > 0.28);
  status = addPriorityThresholdWarning(warnings, 'upper-arm part drift high', status, maxUpperArmDrift > 0.82, maxUpperArmDrift > 1.05);
  status = addPriorityThresholdWarning(warnings, 'forearm part drift high', status, maxForearmDrift > 0.82, maxForearmDrift > 1.05);
  status = addPriorityThresholdWarning(warnings, 'foot floor clearance low', status, footFloorClearance < -0.04, footFloorClearance < -0.12);
  status = addPriorityThresholdWarning(warnings, 'weapon primary grip drift high', status, metrics.weaponPrimaryGripDrift > 0.85, metrics.weaponPrimaryGripDrift > 1.1);
  status = addPriorityThresholdWarning(warnings, 'weapon offhand grip drift high', status, offhandDrift > 1.6, offhandDrift > 1.9);

  return {
    clipId: clip.id,
    label: clip.label,
    sourceClipName: clip.sourceClipName,
    frame,
    durationFrames: clip.durationFrames,
    normalizedTime,
    status,
    metrics,
    warnings,
  };
}

export function buildV3Mesh2MotionCalibrationPriorityReport(
  samples: readonly V3Mesh2MotionCalibrationPriorityFrameReport[]
): V3Mesh2MotionCalibrationPriorityReport {
  const passCount = samples.filter((sample) => sample.status === 'pass').length;
  const warnCount = samples.filter((sample) => sample.status === 'warn').length;
  const failCount = samples.filter((sample) => sample.status === 'fail').length;
  return {
    kind: 'v3-mesh2motion-calibration-priority-report',
    version: 1,
    ready: failCount === 0,
    summary: {
      sampleCount: samples.length,
      passCount,
      warnCount,
      failCount,
      maxHandLateralDistance: priorityMax(samples, (sample) =>
        Math.max(sample.metrics.handLateralDistance.left, sample.metrics.handLateralDistance.right)
      ),
      minHandLateralDistance: priorityMin(samples, (sample) =>
        Math.min(sample.metrics.handLateralDistance.left, sample.metrics.handLateralDistance.right)
      ),
      maxShoulderLateralDistance: priorityMax(samples, (sample) =>
        Math.max(sample.metrics.shoulderLateralDistance.left, sample.metrics.shoulderLateralDistance.right)
      ),
      maxHandSymmetryDelta: priorityMax(samples, (sample) => sample.metrics.handSymmetryDelta),
      maxShoulderSymmetryDelta: priorityMax(samples, (sample) => sample.metrics.shoulderSymmetryDelta),
      maxUpperArmPartDrift: priorityMax(samples, (sample) =>
        Math.max(sample.metrics.upperArmPartDrift.left, sample.metrics.upperArmPartDrift.right)
      ),
      maxForearmPartDrift: priorityMax(samples, (sample) =>
        Math.max(sample.metrics.forearmPartDrift.left, sample.metrics.forearmPartDrift.right)
      ),
      minFootFloorClearance: priorityMin(samples, (sample) => sample.metrics.footFloorClearance),
      maxWeaponPrimaryGripDrift: priorityMax(samples, (sample) => sample.metrics.weaponPrimaryGripDrift),
      maxWeaponOffhandGripDrift: priorityMax(samples, (sample) => sample.metrics.weaponOffhandGripDrift ?? 0),
    },
    samples: [...samples],
  };
}
