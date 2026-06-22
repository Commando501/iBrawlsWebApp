export type V3Mesh2MotionCalibrationVec3 = [number, number, number];

export type V3Mesh2MotionArmSide = 'left' | 'right';

export type V3Mesh2MotionCalibratedJointName =
  | 'clavicle_l'
  | 'upperarm_l'
  | 'lowerarm_l'
  | 'hand_l'
  | 'clavicle_r'
  | 'upperarm_r'
  | 'lowerarm_r'
  | 'hand_r';

export interface V3Mesh2MotionWeaponSocketCalibration {
  position: V3Mesh2MotionCalibrationVec3;
  rotation: V3Mesh2MotionCalibrationVec3;
}

export interface V3Mesh2MotionCalibration {
  version: 'v3-mesh2motion-calibration/v1';
  armSpread: Record<V3Mesh2MotionArmSide, number>;
  jointOffsets: Partial<Record<V3Mesh2MotionCalibratedJointName, V3Mesh2MotionCalibrationVec3>>;
  weaponSockets: {
    rightHandGrip: V3Mesh2MotionWeaponSocketCalibration;
  };
}

export const V3_MESH2MOTION_CALIBRATION_LIMITS = {
  maxArmSpread: 0.35,
  maxJointOffset: 0.3,
  maxSocketPosition: 0.5,
  maxSocketRotation: Math.PI,
} as const;

export const V3_MESH2MOTION_CALIBRATED_JOINT_NAMES = [
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
] as const satisfies readonly V3Mesh2MotionCalibratedJointName[];

export const V3_MESH2MOTION_DEFAULT_CALIBRATION: V3Mesh2MotionCalibration = {
  version: 'v3-mesh2motion-calibration/v1',
  armSpread: {
    left: 0.26,
    right: 0.26,
  },
  jointOffsets: {
    hand_r: [0, 0, -0.1],
  },
  weaponSockets: {
    rightHandGrip: {
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

const cloneCalibration = (calibration: V3Mesh2MotionCalibration): V3Mesh2MotionCalibration => ({
  version: 'v3-mesh2motion-calibration/v1',
  armSpread: {
    left: calibration.armSpread.left,
    right: calibration.armSpread.right,
  },
  jointOffsets: Object.fromEntries(
    Object.entries(calibration.jointOffsets).map(([joint, offset]) => [joint, [...offset]])
  ) as V3Mesh2MotionCalibration['jointOffsets'],
  weaponSockets: {
    rightHandGrip: {
      position: [...calibration.weaponSockets.rightHandGrip.position],
      rotation: [...calibration.weaponSockets.rightHandGrip.rotation],
    },
  },
});

export function normalizeV3Mesh2MotionCalibration(input: unknown): V3Mesh2MotionCalibration {
  const source = isObject(input) ? input : {};
  const sourceArmSpread = isObject(source.armSpread) ? source.armSpread : {};
  const sourceJointOffsets = isObject(source.jointOffsets) ? source.jointOffsets : {};
  const sourceWeaponSockets = isObject(source.weaponSockets) ? source.weaponSockets : {};
  const sourceRightGrip = isObject(sourceWeaponSockets.rightHandGrip) ? sourceWeaponSockets.rightHandGrip : {};

  const jointOffsets: V3Mesh2MotionCalibration['jointOffsets'] = {};
  for (const jointName of V3_MESH2MOTION_CALIBRATED_JOINT_NAMES) {
    if (!(jointName in sourceJointOffsets)) continue;
    jointOffsets[jointName] = normalizeVec3(
      sourceJointOffsets[jointName],
      [0, 0, 0],
      V3_MESH2MOTION_CALIBRATION_LIMITS.maxJointOffset
    );
  }

  return {
    version: 'v3-mesh2motion-calibration/v1',
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
    jointOffsets,
    weaponSockets: {
      rightHandGrip: {
        position: normalizeVec3(
          sourceRightGrip.position,
          V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.rightHandGrip.position,
          V3_MESH2MOTION_CALIBRATION_LIMITS.maxSocketPosition
        ),
        rotation: normalizeVec3(
          sourceRightGrip.rotation,
          V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.rightHandGrip.rotation,
          V3_MESH2MOTION_CALIBRATION_LIMITS.maxSocketRotation
        ),
      },
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
