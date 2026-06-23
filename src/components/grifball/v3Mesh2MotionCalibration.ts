import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from '../v3/v3ModelTypes';
import { V3_MESH2MOTION_CLIP_SET } from './v3Mesh2MotionClips.generated';

export type V3Mesh2MotionCalibrationVec3 = [number, number, number];

export type V3Mesh2MotionArmSide = 'left' | 'right';

export type V3Mesh2MotionDriverJointName = string;

export type V3Mesh2MotionWeaponSocketCalibrationName = 'rightHandGrip' | 'leftHandGrip';

export type V3Mesh2MotionCalibrationTargetKind = 'partBinding' | 'driverJoint' | 'weaponSocket';

export interface V3Mesh2MotionTransformCalibration {
  position: V3Mesh2MotionCalibrationVec3;
  rotation: V3Mesh2MotionCalibrationVec3;
}

export interface V3Mesh2MotionPartBindingCalibration extends V3Mesh2MotionTransformCalibration {
  scale: V3Mesh2MotionCalibrationVec3;
}

export type V3Mesh2MotionWeaponSocketCalibration = V3Mesh2MotionTransformCalibration;

export interface V3Mesh2MotionCalibrationTargetDescriptor {
  kind: V3Mesh2MotionCalibrationTargetKind;
  id: string;
  label: string;
  sourceJointName: string | null;
  parentJointName: string | null;
  affectedSlots: V3CharacterSlotId[];
  hasVisibleBinding: boolean;
}

export interface V3Mesh2MotionCalibrationV2 {
  version: 'v3-mesh2motion-calibration/v2';
  armSpread: Record<V3Mesh2MotionArmSide, number>;
  driverJoints: Partial<Record<V3Mesh2MotionDriverJointName, V3Mesh2MotionTransformCalibration>>;
  partBindings: Partial<Record<V3CharacterSlotId, V3Mesh2MotionPartBindingCalibration>>;
  weaponSockets: Record<V3Mesh2MotionWeaponSocketCalibrationName, V3Mesh2MotionWeaponSocketCalibration>;
}

export type V3Mesh2MotionCalibration = V3Mesh2MotionCalibrationV2;

type LegacyV1JointOffsetMap = Record<string, unknown>;

const ZERO_VEC3: V3Mesh2MotionCalibrationVec3 = [0, 0, 0];

export const V3_MESH2MOTION_DRIVER_JOINT_NAMES = V3_MESH2MOTION_CLIP_SET.skeleton.joints
  .map((joint) => String(joint.name));

export const V3_MESH2MOTION_CALIBRATED_JOINT_NAMES = V3_MESH2MOTION_DRIVER_JOINT_NAMES;

const VALID_DRIVER_JOINT_NAMES = new Set(V3_MESH2MOTION_DRIVER_JOINT_NAMES);
const VALID_PART_BINDING_NAMES = new Set<string>(V3_CHARACTER_SLOT_IDS);

export const V3_MESH2MOTION_CALIBRATION_LIMITS = {
  maxArmSpread: 0.35,
  maxDriverJointPosition: 0.3,
  maxPartBindingPosition: 0.5,
  minPartBindingScale: 0.25,
  maxPartBindingScale: 2,
  maxSocketPosition: 0.5,
  maxRotation: Math.PI,
  maxJointOffset: 0.3,
  maxSocketRotation: Math.PI,
} as const;

export const V3_MESH2MOTION_DEFAULT_CALIBRATION: V3Mesh2MotionCalibration = {
  version: 'v3-mesh2motion-calibration/v2',
  armSpread: {
    left: 0.26,
    right: 0.26,
  },
  driverJoints: {
    hand_r: {
      position: [0, 0, -0.1],
      rotation: [0, 0, 0],
    },
  },
  partBindings: {},
  weaponSockets: {
    rightHandGrip: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    leftHandGrip: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
  },
};

let activeCalibrationOverride: V3Mesh2MotionCalibration | null = null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const finiteOrFallback = (value: unknown, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

const normalizeSignedComponent = (
  value: unknown,
  fallback: number,
  maxMagnitude: number
): number => clamp(finiteOrFallback(value, fallback), -maxMagnitude, maxMagnitude);

const normalizePositiveComponent = (
  value: unknown,
  fallback: number,
  maxMagnitude: number
): number => clamp(finiteOrFallback(value, fallback), 0, maxMagnitude);

const normalizeScaleComponent = (
  value: unknown,
  fallback: number
): number => clamp(
  finiteOrFallback(value, fallback),
  V3_MESH2MOTION_CALIBRATION_LIMITS.minPartBindingScale,
  V3_MESH2MOTION_CALIBRATION_LIMITS.maxPartBindingScale
);

const normalizeVec3 = (
  value: unknown,
  fallback: V3Mesh2MotionCalibrationVec3,
  maxMagnitude: number
): V3Mesh2MotionCalibrationVec3 => {
  const tuple = Array.isArray(value) ? value : [];
  return [
    normalizeSignedComponent(tuple[0], fallback[0], maxMagnitude),
    normalizeSignedComponent(tuple[1], fallback[1], maxMagnitude),
    normalizeSignedComponent(tuple[2], fallback[2], maxMagnitude),
  ];
};

const cloneTransform = (
  transform: V3Mesh2MotionTransformCalibration
): V3Mesh2MotionTransformCalibration => ({
  position: [...transform.position],
  rotation: [...transform.rotation],
});

const clonePartBindingTransform = (
  transform: V3Mesh2MotionPartBindingCalibration
): V3Mesh2MotionPartBindingCalibration => ({
  position: [...transform.position],
  rotation: [...transform.rotation],
  scale: [...transform.scale],
});

const normalizeTransform = (
  value: unknown,
  fallback: V3Mesh2MotionTransformCalibration,
  maxPositionMagnitude: number
): V3Mesh2MotionTransformCalibration => {
  const source = isObject(value) ? value : {};
  return {
    position: normalizeVec3(source.position, fallback.position, maxPositionMagnitude),
    rotation: normalizeVec3(source.rotation, fallback.rotation, V3_MESH2MOTION_CALIBRATION_LIMITS.maxRotation),
  };
};

const normalizePartBindingTransform = (
  value: unknown,
  fallback: V3Mesh2MotionPartBindingCalibration
): V3Mesh2MotionPartBindingCalibration => {
  const source = isObject(value) ? value : {};
  const scale = Array.isArray(source.scale) ? source.scale : [];
  return {
    position: normalizeVec3(
      source.position,
      fallback.position,
      V3_MESH2MOTION_CALIBRATION_LIMITS.maxPartBindingPosition
    ),
    rotation: normalizeVec3(source.rotation, fallback.rotation, V3_MESH2MOTION_CALIBRATION_LIMITS.maxRotation),
    scale: [
      normalizeScaleComponent(scale[0], fallback.scale[0]),
      normalizeScaleComponent(scale[1], fallback.scale[1]),
      normalizeScaleComponent(scale[2], fallback.scale[2]),
    ],
  };
};

const cloneTransformRecord = <Key extends string>(
  value: Partial<Record<Key, V3Mesh2MotionTransformCalibration>>
): Partial<Record<Key, V3Mesh2MotionTransformCalibration>> =>
  Object.fromEntries(
    Object.entries(value).map(([key, transform]) => [
      key,
      cloneTransform(transform as V3Mesh2MotionTransformCalibration),
    ])
  ) as Partial<Record<Key, V3Mesh2MotionTransformCalibration>>;

const clonePartBindingTransformRecord = <Key extends string>(
  value: Partial<Record<Key, V3Mesh2MotionPartBindingCalibration>>
): Partial<Record<Key, V3Mesh2MotionPartBindingCalibration>> =>
  Object.fromEntries(
    Object.entries(value).map(([key, transform]) => [
      key,
      clonePartBindingTransform(transform as V3Mesh2MotionPartBindingCalibration),
    ])
  ) as Partial<Record<Key, V3Mesh2MotionPartBindingCalibration>>;

const cloneCalibration = (calibration: V3Mesh2MotionCalibration): V3Mesh2MotionCalibration => ({
  version: 'v3-mesh2motion-calibration/v2',
  armSpread: {
    left: calibration.armSpread.left,
    right: calibration.armSpread.right,
  },
  driverJoints: cloneTransformRecord(calibration.driverJoints),
  partBindings: clonePartBindingTransformRecord(calibration.partBindings),
  weaponSockets: {
    rightHandGrip: cloneTransform(calibration.weaponSockets.rightHandGrip),
    leftHandGrip: cloneTransform(calibration.weaponSockets.leftHandGrip),
  },
});

const normalizeLegacyJointOffset = (
  value: unknown,
  fallback: V3Mesh2MotionTransformCalibration
): V3Mesh2MotionTransformCalibration => ({
  position: normalizeVec3(
    value,
    fallback.position,
    V3_MESH2MOTION_CALIBRATION_LIMITS.maxDriverJointPosition
  ),
  rotation: [...ZERO_VEC3],
});

export function normalizeV3Mesh2MotionCalibration(input: unknown): V3Mesh2MotionCalibration {
  const source = isObject(input) ? input : {};
  const sourceArmSpread = isObject(source.armSpread) ? source.armSpread : {};
  const sourceDriverJoints = isObject(source.driverJoints) ? source.driverJoints : {};
  const sourceLegacyJointOffsets = isObject(source.jointOffsets)
    ? source.jointOffsets as LegacyV1JointOffsetMap
    : {};
  const sourcePartBindings = isObject(source.partBindings) ? source.partBindings : {};
  const sourceWeaponSockets = isObject(source.weaponSockets) ? source.weaponSockets : {};

  const driverJoints = cloneTransformRecord<string>(V3_MESH2MOTION_DEFAULT_CALIBRATION.driverJoints);
  for (const jointName of V3_MESH2MOTION_DRIVER_JOINT_NAMES) {
    const fallback = driverJoints[jointName] ?? { position: [...ZERO_VEC3], rotation: [...ZERO_VEC3] };
    if (jointName in sourceDriverJoints) {
      driverJoints[jointName] = normalizeTransform(
        sourceDriverJoints[jointName],
        fallback,
        V3_MESH2MOTION_CALIBRATION_LIMITS.maxDriverJointPosition
      );
      continue;
    }
    if (jointName in sourceLegacyJointOffsets) {
      driverJoints[jointName] = normalizeLegacyJointOffset(sourceLegacyJointOffsets[jointName], fallback);
    }
  }

  for (const jointName of Object.keys(driverJoints)) {
    if (!VALID_DRIVER_JOINT_NAMES.has(jointName)) delete driverJoints[jointName];
  }

  const partBindings: V3Mesh2MotionCalibration['partBindings'] = {};
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    if (!(slot in sourcePartBindings)) continue;
    partBindings[slot] = normalizePartBindingTransform(
      sourcePartBindings[slot],
      { position: [...ZERO_VEC3], rotation: [...ZERO_VEC3], scale: [1, 1, 1] }
    );
  }
  for (const slot of Object.keys(partBindings)) {
    if (!VALID_PART_BINDING_NAMES.has(slot)) delete partBindings[slot as V3CharacterSlotId];
  }

  const sourceRightGrip = isObject(sourceWeaponSockets.rightHandGrip) ? sourceWeaponSockets.rightHandGrip : {};
  const sourceLeftGrip = isObject(sourceWeaponSockets.leftHandGrip) ? sourceWeaponSockets.leftHandGrip : {};

  return {
    version: 'v3-mesh2motion-calibration/v2',
    armSpread: {
      left: normalizePositiveComponent(
        sourceArmSpread.left,
        V3_MESH2MOTION_DEFAULT_CALIBRATION.armSpread.left,
        V3_MESH2MOTION_CALIBRATION_LIMITS.maxArmSpread
      ),
      right: normalizePositiveComponent(
        sourceArmSpread.right,
        V3_MESH2MOTION_DEFAULT_CALIBRATION.armSpread.right,
        V3_MESH2MOTION_CALIBRATION_LIMITS.maxArmSpread
      ),
    },
    driverJoints,
    partBindings,
    weaponSockets: {
      rightHandGrip: normalizeTransform(
        sourceRightGrip,
        V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.rightHandGrip,
        V3_MESH2MOTION_CALIBRATION_LIMITS.maxSocketPosition
      ),
      leftHandGrip: normalizeTransform(
        sourceLeftGrip,
        V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.leftHandGrip,
        V3_MESH2MOTION_CALIBRATION_LIMITS.maxSocketPosition
      ),
    },
  };
}

export function getV3Mesh2MotionCalibration(): V3Mesh2MotionCalibration {
  return cloneCalibration(activeCalibrationOverride ?? V3_MESH2MOTION_DEFAULT_CALIBRATION);
}

export function setV3Mesh2MotionCalibrationOverride(input: unknown | null): V3Mesh2MotionCalibration | null {
  activeCalibrationOverride = input === null ? null : normalizeV3Mesh2MotionCalibration(input);
  return activeCalibrationOverride ? cloneCalibration(activeCalibrationOverride) : null;
}
