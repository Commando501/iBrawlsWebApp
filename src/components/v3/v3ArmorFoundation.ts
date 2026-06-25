import type {
  CharacterLoadout,
  SpartanColors,
  VoxelData,
} from '../VoxelModels';
import * as THREE from 'three';
import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../customArmor';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import {
  deriveV3CanonicalRigContract,
  type V3CanonicalJointName,
} from './v3CanonicalRigContract';
import { getV3ExactSourceRenderableSlot } from './v3ExactSourceLod';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import {
  V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOTS,
  isV3Mesh2MotionNativeArmChainSlot,
  isV3Mesh2MotionNativeLimbChainSlot,
} from './v3Mesh2MotionArmorRigContract';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3PaintRole,
  type V3QualityTier,
  type V3QuatTuple,
  type V3Vec3Tuple,
} from './v3ModelTypes';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
} from './v3PaintPalette';
import {
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
} from './v3RigDetail';
import type { V3SourceFidelity } from './v3QualityTiers';
import { V3_REFERENCE_LIMB_VOXELS } from './v3ReferenceLimbVoxels.generated';
import { V3_REFERENCE_SOURCE_BIND } from './v3ReferenceSourceBind.generated';

export const V3_ARMOR_FOUNDATION_SCHEMA = 'v3-internal-armor-foundation/v1' as const;

export type V3ArmorFoundationMaskRun = readonly [
  roleIndex: number,
  y: number,
  z: number,
  xStart: number,
  xEnd: number,
  emissive?: 1,
];

export interface V3ArmorFoundationSourceSummary {
  kind: 'v3-internal-reference-locked-foundation';
  exactObjSurfaceSchema: typeof V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.schemaVersion;
  exactObjSurfaceHash: string;
  mesh2MotionRigSchema: typeof V3_MESH2MOTION_ARMOR_RIG.schemaVersion;
  mesh2MotionRigSha256: string;
  referenceSourceBindSchema: typeof V3_REFERENCE_SOURCE_BIND.schemaVersion;
  referenceSourceBindSha256: string;
  referenceLimbVoxelSchema: typeof V3_REFERENCE_LIMB_VOXELS.schemaVersion;
  referenceLimbVoxelSha256: string;
  generator: 'sanitized-obj-surface-plus-mesh2motion-rig-plus-blender-source-bind-plus-regenerated-limb-voxels';
}

export interface V3ArmorFoundationGeometryTransform {
  position: V3Vec3Tuple;
  rotation: V3Vec3Tuple;
  scale: V3Vec3Tuple;
}

export interface V3ArmorFoundationSlotBasis {
  xAxis: V3Vec3Tuple;
  yAxis: V3Vec3Tuple;
  zAxis: V3Vec3Tuple;
  quaternion: V3QuatTuple;
}

export interface V3ArmorFoundationSlot {
  slot: V3CharacterSlotId;
  sourceJointName: string;
  endJointName: string | null;
  mirrorOf: V3CharacterSlotId | null;
  exactSourceBounds: {
    min: V3Vec3Tuple;
    max: V3Vec3Tuple;
    size: V3Vec3Tuple;
  };
  exactSourceGeometryCenter: V3Vec3Tuple;
  exactSourceBindPoint: V3Vec3Tuple;
  exactSourceBindOffset: V3Vec3Tuple;
  localGridDimensions: V3Vec3Tuple;
  localVoxelPivot: V3Vec3Tuple;
  exactSourceRestBasis: V3ArmorFoundationSlotBasis;
  referenceSourceBindBasis: V3ArmorFoundationSlotBasis | null;
  sourcePoseCorrectionAngleDegrees: number;
  mesh2MotionPivotWorldPosition: V3Vec3Tuple;
  mesh2MotionPivotWorldQuaternion: V3QuatTuple;
  mesh2MotionGeometry: V3ArmorFoundationGeometryTransform;
  jointClearance: number;
  roleHintIndexes: readonly number[];
  sourceHashes: {
    exactObjSurfaceSlot: string | null;
    referenceLimbVoxelSlot: string | null;
    mesh2MotionSlot: string;
    referenceSourceBindSlot: string | null;
  };
  referenceVoxelCount: number;
  referenceRunCount: number;
  referenceMaskRuns: readonly V3ArmorFoundationMaskRun[];
}

export interface V3ArmorFoundationArtifact {
  schemaVersion: typeof V3_ARMOR_FOUNDATION_SCHEMA;
  version: 1;
  source: V3ArmorFoundationSourceSummary;
  rolePalette: readonly V3PaintRole[];
  slots: Readonly<Record<V3CharacterSlotId, V3ArmorFoundationSlot>>;
}

export interface V3ArmorFoundationAnalysis {
  kind: 'v3-armor-foundation-analysis';
  version: 1;
  ready: boolean;
  slotCount: number;
  referenceVoxelCount: number;
  issues: string[];
}

export interface V3ReferenceLockedPartOptions {
  qualityTier?: V3QualityTier;
  sourceFidelity?: V3SourceFidelity;
}

export interface V3ArmorThemeGenerationOptions {
  slot: V3CharacterSlotId;
  description: string;
  seed?: string | number;
  intensity?: number;
  now?: number;
}

export interface V3ArmorSuitThemeGenerationOptions extends Omit<V3ArmorThemeGenerationOptions, 'slot'> {}

export interface V3ArmorFoundationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    slot?: V3CharacterSlotId;
    voxelCount: number;
    expectedVoxelCount: number;
    missingVoxelCount: number;
    outsideVoxelCount: number;
    duplicateVoxelCount: number;
  };
}

interface ExpandedFoundationVoxel {
  x: number;
  y: number;
  z: number;
  roleIndex: number;
  emissive: boolean;
}

interface ThemeProfile {
  key: string;
  primary: CustomArmorMaterialRole;
  secondary: CustomArmorMaterialRole;
  accent: CustomArmorMaterialRole;
  detail: CustomArmorMaterialRole;
  fixedColor: string;
  emissiveEvery: number;
}

type V3OptionalGeneratedRigSlotMetadata = {
  mirrorOf?: V3CharacterSlotId | null;
  jointClearance?: number;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const sourceDataHash = (label: string, value: unknown): string =>
  `${label}:fnv1a32:${hashString(JSON.stringify(value)).toString(16).padStart(8, '0')}`;

const resolvedSourceSlotHashPayload = (sourceSlot: V3FoundationSourceSlot) => ({
  slot: sourceSlot.slot,
  bounds: sourceSlot.bounds,
  roleHintIndexes: sourceSlot.roleHintIndexes,
  voxelCount: sourceSlot.voxelCount,
  runCount: sourceSlot.runCount,
  runs: sourceSlot.runs,
});

const getV3FoundationSourceContext = (slot: V3CharacterSlotId): V3FoundationSourceContext => {
  const limbSlot = V3_REFERENCE_LIMB_VOXELS.slots[
    slot as keyof typeof V3_REFERENCE_LIMB_VOXELS.slots
  ] as V3FoundationSourceSlot | undefined;
  if (isV3Mesh2MotionNativeArmChainSlot(slot) && limbSlot) {
    return {
      sourceKind: 'reference-limb',
      sourceSlot: limbSlot,
      rolePalette: V3_REFERENCE_LIMB_VOXELS.rolePalette,
      sourcePivot: V3_REFERENCE_LIMB_VOXELS.coordinateSystem.pivot,
      voxelScale: V3_REFERENCE_LIMB_VOXELS.coordinateSystem.voxelScale,
    };
  }
  return {
    sourceKind: 'exact-obj',
    sourceSlot: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot],
    rolePalette: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.rolePalette,
    sourcePivot: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.pivot,
    voxelScale: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale,
  };
};

const V3_FOUNDATION_RENDERABLE_SOURCE = {
  ...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE,
  source: {
    ...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source,
    hash: `${V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash}|reference-limb:${V3_REFERENCE_LIMB_VOXELS.source.sha256}`,
  },
  slots: {
    ...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots,
    shoulderLeft: V3_REFERENCE_LIMB_VOXELS.slots.shoulderLeft,
    shoulderRight: V3_REFERENCE_LIMB_VOXELS.slots.shoulderRight,
    upperArmLeft: V3_REFERENCE_LIMB_VOXELS.slots.upperArmLeft,
    upperArmRight: V3_REFERENCE_LIMB_VOXELS.slots.upperArmRight,
    forearmLeft: V3_REFERENCE_LIMB_VOXELS.slots.forearmLeft,
    forearmRight: V3_REFERENCE_LIMB_VOXELS.slots.forearmRight,
    handLeft: V3_REFERENCE_LIMB_VOXELS.slots.handLeft,
    handRight: V3_REFERENCE_LIMB_VOXELS.slots.handRight,
  },
} as unknown as typeof V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;

const CUSTOM_ROLE_SET = new Set<CustomArmorMaterialRole>([
  'primary',
  'secondary',
  'accent',
  'visor',
  'dark',
  'highlight',
  'undersuit',
  'emissive',
  'decal',
  'fixed',
]);

const DEFAULT_THEME: ThemeProfile = {
  key: 'aegis',
  primary: 'primary',
  secondary: 'secondary',
  accent: 'accent',
  detail: 'fixed',
  fixedColor: '#38bdf8',
  emissiveEvery: 19,
};

const THEMES: readonly ThemeProfile[] = [
  {
    key: 'forerunner',
    primary: 'primary',
    secondary: 'secondary',
    accent: 'accent',
    detail: 'fixed',
    fixedColor: '#67e8f9',
    emissiveEvery: 11,
  },
  {
    key: 'stealth',
    primary: 'dark',
    secondary: 'secondary',
    accent: 'fixed',
    detail: 'decal',
    fixedColor: '#ef4444',
    emissiveEvery: 23,
  },
  {
    key: 'inferno',
    primary: 'primary',
    secondary: 'fixed',
    accent: 'accent',
    detail: 'emissive',
    fixedColor: '#f97316',
    emissiveEvery: 9,
  },
  {
    key: 'frost',
    primary: 'primary',
    secondary: 'highlight',
    accent: 'accent',
    detail: 'fixed',
    fixedColor: '#bae6fd',
    emissiveEvery: 13,
  },
];

const SOURCE_AXIS_JOINTS = {
  shoulderLeft: ['shoulderLeft', 'elbowLeft'],
  upperArmLeft: ['shoulderLeft', 'elbowLeft'],
  forearmLeft: ['elbowLeft', 'wristLeft'],
  handLeft: ['wristLeft', 'gripLeft'],
  shoulderRight: ['shoulderRight', 'elbowRight'],
  upperArmRight: ['shoulderRight', 'elbowRight'],
  forearmRight: ['elbowRight', 'wristRight'],
  handRight: ['wristRight', 'gripRight'],
} as const satisfies Record<
  (typeof V3_MESH2MOTION_NATIVE_ARM_CHAIN_SLOTS)[number],
  readonly [V3CanonicalJointName, V3CanonicalJointName]
>;
const SOURCE_BIND_JOINTS = {
  shoulderLeft: ['shoulderLeft', 'elbowLeft'],
  upperArmLeft: ['shoulderLeft', 'elbowLeft'],
  forearmLeft: ['elbowLeft', 'wristLeft'],
  handLeft: ['wristLeft', 'gripLeft'],
  shoulderRight: ['shoulderRight', 'elbowRight'],
  upperArmRight: ['shoulderRight', 'elbowRight'],
  forearmRight: ['elbowRight', 'wristRight'],
  handRight: ['wristRight', 'gripRight'],
  thighLeft: ['hipLeft', 'kneeLeft'],
  shinLeft: ['kneeLeft', 'ankleLeft'],
  footLeft: ['ankleLeft', 'toeLeft'],
  thighRight: ['hipRight', 'kneeRight'],
  shinRight: ['kneeRight', 'ankleRight'],
  footRight: ['ankleRight', 'toeRight'],
} as const satisfies Partial<Record<
  V3CharacterSlotId,
  readonly [V3CanonicalJointName, V3CanonicalJointName]
>>;

const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const SHOULDER_SOURCE_ROLL_BLEND = 0.35;

type V3FoundationSourceRun = readonly [number, number, number, number, number, 1?];

type V3FoundationSourceSlot = {
  readonly slot: V3CharacterSlotId;
  readonly bounds: {
    readonly min: readonly number[];
    readonly max: readonly number[];
    readonly size: readonly number[];
  };
  readonly roleHintIndexes: readonly number[];
  readonly voxelCount: number;
  readonly runCount: number;
  readonly runs: readonly V3FoundationSourceRun[];
};

type V3FoundationSourceContext = {
  sourceKind: 'exact-obj' | 'reference-limb';
  sourceSlot: V3FoundationSourceSlot;
  rolePalette: readonly V3PaintRole[];
  sourcePivot: readonly number[];
  voxelScale: number;
};

const tuple3 = (value: readonly number[]): V3Vec3Tuple => [
  value[0] ?? 0,
  value[1] ?? 0,
  value[2] ?? 0,
];

const tuple4 = (value: readonly number[]): V3QuatTuple => [
  value[0] ?? 0,
  value[1] ?? 0,
  value[2] ?? 0,
  value[3] ?? 1,
];

const tupleQuat = (quaternion: THREE.Quaternion): V3QuatTuple => {
  const normalized = quaternion.lengthSq() > 0.000001
    ? quaternion.clone().normalize()
    : new THREE.Quaternion();
  return [
    roundMetric(normalized.x),
    roundMetric(normalized.y),
    roundMetric(normalized.z),
    roundMetric(normalized.w),
  ];
};

const runVoxelCount = (run: V3ArmorFoundationMaskRun): number =>
  Math.max(0, run[4] - run[3] + 1);

const roundMetric = (value: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(6)) : 0;

const normalizedVector = (
  value: THREE.Vector3,
  fallback: THREE.Vector3
): THREE.Vector3 => value.lengthSq() > 0.000001 ? value.normalize() : fallback.clone().normalize();

const projectedAxis = (
  reference: THREE.Vector3,
  normal: THREE.Vector3,
  fallback: THREE.Vector3
): THREE.Vector3 => {
  const projected = reference.clone().sub(normal.clone().multiplyScalar(reference.dot(normal)));
  return normalizedVector(projected, fallback);
};

const basisFromAxes = (
  xAxis: THREE.Vector3,
  yAxis: THREE.Vector3,
  zAxis: THREE.Vector3
): V3ArmorFoundationSlotBasis => {
  const normalizedX = normalizedVector(xAxis.clone(), WORLD_RIGHT);
  const normalizedY = normalizedVector(yAxis.clone(), WORLD_UP);
  const normalizedZ = normalizedVector(zAxis.clone(), WORLD_FORWARD);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(normalizedX, normalizedY, normalizedZ)
  ).normalize();
  return {
    xAxis: tuple3(normalizedX.toArray()),
    yAxis: tuple3(normalizedY.toArray()),
    zAxis: tuple3(normalizedZ.toArray()),
    quaternion: tupleQuat(quaternion),
  };
};

const basisFromQuaternion = (quaternion: THREE.Quaternion): V3ArmorFoundationSlotBasis => {
  const normalized = quaternion.clone().normalize();
  return basisFromAxes(
    WORLD_RIGHT.clone().applyQuaternion(normalized),
    WORLD_UP.clone().applyQuaternion(normalized),
    WORLD_FORWARD.clone().applyQuaternion(normalized)
  );
};

const angleDegreesBetweenAxes = (first: THREE.Vector3, second: THREE.Vector3): number => {
  const normalizedFirst = normalizedVector(first.clone(), WORLD_UP);
  const normalizedSecond = normalizedVector(second.clone(), WORLD_UP);
  const dot = Math.max(-1, Math.min(1, Math.abs(normalizedFirst.dot(normalizedSecond))));
  return roundMetric((Math.acos(dot) * 180) / Math.PI);
};

const sourceSlotMajorAxis = (slot: V3CharacterSlotId): THREE.Vector3 => {
  const sourceContext = getV3FoundationSourceContext(slot);
  const { sourceSlot, sourcePivot, voxelScale } = sourceContext;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let sumXX = 0;
  let sumXY = 0;
  let sumXZ = 0;
  let sumYY = 0;
  let sumYZ = 0;
  let sumZZ = 0;

  for (const run of sourceSlot.runs) {
    const worldY = run[1] * voxelScale;
    const worldZ = (run[2] - sourcePivot[2]) * voxelScale;
    for (let sourceX = run[3]; sourceX <= run[4]; sourceX += 1) {
      const worldX = (sourceX - sourcePivot[0]) * voxelScale;
      count += 1;
      sumX += worldX;
      sumY += worldY;
      sumZ += worldZ;
      sumXX += worldX * worldX;
      sumXY += worldX * worldY;
      sumXZ += worldX * worldZ;
      sumYY += worldY * worldY;
      sumYZ += worldY * worldZ;
      sumZZ += worldZ * worldZ;
    }
  }

  if (count <= 0) return WORLD_UP.clone();

  const meanX = sumX / count;
  const meanY = sumY / count;
  const meanZ = sumZ / count;
  const covariance = {
    xx: (sumXX / count) - (meanX * meanX),
    xy: (sumXY / count) - (meanX * meanY),
    xz: (sumXZ / count) - (meanX * meanZ),
    yy: (sumYY / count) - (meanY * meanY),
    yz: (sumYZ / count) - (meanY * meanZ),
    zz: (sumZZ / count) - (meanZ * meanZ),
  };
  let axis = WORLD_RIGHT.clone();
  for (let index = 0; index < 32; index += 1) {
    const next = new THREE.Vector3(
      (covariance.xx * axis.x) + (covariance.xy * axis.y) + (covariance.xz * axis.z),
      (covariance.xy * axis.x) + (covariance.yy * axis.y) + (covariance.yz * axis.z),
      (covariance.xz * axis.x) + (covariance.yz * axis.y) + (covariance.zz * axis.z)
    );
    if (next.lengthSq() <= 0.000000000001) break;
    axis = next.normalize();
  }

  return normalizedVector(axis, WORLD_UP);
};

const referenceSourceBindBasisForSlot = (
  slot: V3CharacterSlotId
): V3ArmorFoundationSlotBasis | null => {
  const referenceSourceSlot = V3_REFERENCE_SOURCE_BIND.slots[
    slot as keyof typeof V3_REFERENCE_SOURCE_BIND.slots
  ];
  if (!referenceSourceSlot) return null;
  return {
    xAxis: tuple3(referenceSourceSlot.sourceBasis.xAxis),
    yAxis: tuple3(referenceSourceSlot.sourceBasis.yAxis),
    zAxis: tuple3(referenceSourceSlot.sourceBasis.zAxis),
    quaternion: tuple4(referenceSourceSlot.sourceBasis.quaternion),
  };
};

const exactSourceRestBasisForSlot = (slot: V3CharacterSlotId): V3ArmorFoundationSlotBasis => {
  const referenceSourceSlot = V3_REFERENCE_SOURCE_BIND.slots[
    slot as keyof typeof V3_REFERENCE_SOURCE_BIND.slots
  ];
  const sourceContext = getV3FoundationSourceContext(slot);
  if (
    isV3Mesh2MotionNativeArmChainSlot(slot) &&
    sourceContext.sourceKind === 'reference-limb' &&
    referenceSourceSlot
  ) {
    const sourceYAxis = new THREE.Vector3(...referenceSourceSlot.sourceBasis.yAxis).normalize();
    const sourceZAxis = projectedAxis(WORLD_FORWARD, sourceYAxis, WORLD_UP);
    const sourceXAxis = normalizedVector(sourceYAxis.clone().cross(sourceZAxis), WORLD_RIGHT);
    const stableBasis = basisFromAxes(sourceXAxis, sourceYAxis, sourceZAxis);
    if (slot !== 'shoulderLeft' && slot !== 'shoulderRight') return stableBasis;

    const stableQuaternion = new THREE.Quaternion(...stableBasis.quaternion).normalize();
    const sourceRollQuaternion = new THREE.Quaternion(...referenceSourceSlot.sourceBasis.quaternion).normalize();
    return basisFromQuaternion(stableQuaternion.slerp(sourceRollQuaternion, SHOULDER_SOURCE_ROLL_BLEND));
  }
  if (isV3Mesh2MotionNativeArmChainSlot(slot) && referenceSourceSlot) {
    const referenceYAxis = new THREE.Vector3(...referenceSourceSlot.sourceBasis.yAxis).normalize();
    const sourceYAxis = sourceSlotMajorAxis(slot);
    if (sourceYAxis.dot(referenceYAxis) < 0) sourceYAxis.multiplyScalar(-1);
    const sourceZAxis = projectedAxis(WORLD_FORWARD, sourceYAxis, WORLD_UP);
    const sourceXAxis = normalizedVector(sourceYAxis.clone().cross(sourceZAxis), WORLD_RIGHT);
    return basisFromAxes(sourceXAxis, sourceYAxis, sourceZAxis);
  }

  const sourceBindJoints = SOURCE_BIND_JOINTS[slot as keyof typeof SOURCE_BIND_JOINTS];
  if (!sourceBindJoints || !isV3Mesh2MotionNativeLimbChainSlot(slot)) {
    return basisFromAxes(WORLD_RIGHT, WORLD_UP, WORLD_FORWARD);
  }

  const canonicalContract = deriveV3CanonicalRigContract();
  const from = new THREE.Vector3(...canonicalContract.joints[sourceBindJoints[0]].position);
  const to = new THREE.Vector3(...canonicalContract.joints[sourceBindJoints[1]].position);
  const segment = normalizedVector(to.sub(from), WORLD_UP);
  if (slot === 'footLeft' || slot === 'footRight') {
    const horizontal = segment.clone();
    horizontal.y = 0;
    const zAxis = normalizedVector(horizontal, WORLD_FORWARD);
    const yAxis = projectedAxis(WORLD_UP, zAxis, WORLD_UP);
    const xAxis = normalizedVector(yAxis.clone().cross(zAxis), WORLD_RIGHT);
    return basisFromAxes(xAxis, yAxis, zAxis);
  }

  const yAxis = segment;
  const zAxis = projectedAxis(WORLD_FORWARD, yAxis, WORLD_UP);
  const xAxis = normalizedVector(yAxis.clone().cross(zAxis), WORLD_RIGHT);
  return basisFromAxes(xAxis, yAxis, zAxis);
};

const inverseQuaternionEulerTuple = (quaternionTuple: V3QuatTuple): V3Vec3Tuple => {
  const quaternion = new THREE.Quaternion(...quaternionTuple).normalize().invert();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return tuple3([euler.x, euler.y, euler.z]);
};

const exactSourceGeometryCenterForSlot = (slot: V3CharacterSlotId): THREE.Vector3 => {
  const sourceContext = getV3FoundationSourceContext(slot);
  const { sourceSlot, sourcePivot, voxelScale } = sourceContext;
  return new THREE.Vector3(
    (((sourceSlot.bounds.min[0] + sourceSlot.bounds.max[0]) / 2) - sourcePivot[0]) * voxelScale,
    ((sourceSlot.bounds.min[1] + sourceSlot.bounds.max[1]) / 2) * voxelScale,
    (((sourceSlot.bounds.min[2] + sourceSlot.bounds.max[2]) / 2) - sourcePivot[2]) * voxelScale
  );
};

const exactSourceBindPointForSlot = (slot: V3CharacterSlotId): THREE.Vector3 => {
  const sourceContext = getV3FoundationSourceContext(slot);
  const referenceSourceSlot = V3_REFERENCE_SOURCE_BIND.slots[
    slot as keyof typeof V3_REFERENCE_SOURCE_BIND.slots
  ];
  if (
    isV3Mesh2MotionNativeArmChainSlot(slot) &&
    sourceContext.sourceKind === 'reference-limb' &&
    referenceSourceSlot
  ) {
    const source = new THREE.Vector3(...referenceSourceSlot.sourceRestWorldPosition);
    const end = new THREE.Vector3(...referenceSourceSlot.sourceEndRestWorldPosition);
    return source.lerp(end, 0.5);
  }
  const sourceBindJoints = SOURCE_BIND_JOINTS[slot as keyof typeof SOURCE_BIND_JOINTS];
  if (!sourceBindJoints) return exactSourceGeometryCenterForSlot(slot);
  const canonicalContract = deriveV3CanonicalRigContract();
  const from = new THREE.Vector3(...canonicalContract.joints[sourceBindJoints[0]].position);
  const to = new THREE.Vector3(...canonicalContract.joints[sourceBindJoints[1]].position);
  return from.lerp(to, 0.5);
};

const geometryPositionForSourceBindOffset = (
  sourceBindOffset: THREE.Vector3,
  geometryRotationQuaternion: THREE.Quaternion
): V3Vec3Tuple => {
  return tuple3(sourceBindOffset.clone().applyQuaternion(geometryRotationQuaternion).multiplyScalar(-1).toArray());
};

const deriveFallbackJointClearance = (dimensions: V3Vec3Tuple): number =>
  roundMetric(Math.max(1, Math.min(...dimensions) * 0.08));

const tupleLength = (value: readonly number[]): number =>
  Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);

const quaternionLength = (value: readonly number[]): number =>
  Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1);

const localRunFromSourceRun = (
  run: readonly [number, number, number, number, number, 1?],
  min: readonly number[]
): V3ArmorFoundationMaskRun => (
  run[5] === 1
    ? [run[0], run[1] - min[1], run[2] - min[2], run[3] - min[0], run[4] - min[0], 1]
    : [run[0], run[1] - min[1], run[2] - min[2], run[3] - min[0], run[4] - min[0]]
);

const buildFoundationSlot = (slot: V3CharacterSlotId): V3ArmorFoundationSlot => {
  const sourceContext = getV3FoundationSourceContext(slot);
  const { sourceSlot } = sourceContext;
  const rigSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
  const referenceSourceSlot = V3_REFERENCE_SOURCE_BIND.slots[
    slot as keyof typeof V3_REFERENCE_SOURCE_BIND.slots
  ];
  const optionalRigSlot = rigSlot as typeof rigSlot & V3OptionalGeneratedRigSlotMetadata;
  const localGridDimensions = tuple3(sourceSlot.bounds.size);
  const exactSourceRestBasis = exactSourceRestBasisForSlot(slot);
  const referenceSourceBindBasis = referenceSourceBindBasisForSlot(slot);
  const sourcePoseCorrectionAngleDegrees = referenceSourceBindBasis
    ? angleDegreesBetweenAxes(
      new THREE.Vector3(...exactSourceRestBasis.yAxis),
      new THREE.Vector3(...referenceSourceBindBasis.yAxis)
    )
    : 0;
  const exactSourceGeometryCenter = exactSourceGeometryCenterForSlot(slot);
  const exactSourceBindPoint = exactSourceBindPointForSlot(slot);
  const exactSourceBindOffset = exactSourceBindPoint.clone().sub(exactSourceGeometryCenter);
  const nativeLimbChainSlot = isV3Mesh2MotionNativeLimbChainSlot(slot);
  const sourceBasisInverseQuaternion = new THREE.Quaternion(...exactSourceRestBasis.quaternion)
    .normalize()
    .invert();
  const referenceMaskRuns = sourceSlot.runs.map((run) =>
    localRunFromSourceRun(run, sourceSlot.bounds.min)
  );

  return {
    slot,
    sourceJointName: rigSlot.sourceJointName,
    endJointName: rigSlot.endJointName,
    mirrorOf: optionalRigSlot.mirrorOf ?? null,
    exactSourceBounds: {
      min: tuple3(sourceSlot.bounds.min),
      max: tuple3(sourceSlot.bounds.max),
      size: localGridDimensions,
    },
    exactSourceGeometryCenter: tuple3(exactSourceGeometryCenter.toArray()),
    exactSourceBindPoint: tuple3(exactSourceBindPoint.toArray()),
    exactSourceBindOffset: tuple3(exactSourceBindOffset.toArray()),
    localGridDimensions,
    localVoxelPivot: [
      (localGridDimensions[0] - 1) / 2,
      (localGridDimensions[1] - 1) / 2,
      (localGridDimensions[2] - 1) / 2,
    ],
    exactSourceRestBasis,
    referenceSourceBindBasis,
    sourcePoseCorrectionAngleDegrees,
    mesh2MotionPivotWorldPosition: tuple3(rigSlot.pivotWorldPosition),
    mesh2MotionPivotWorldQuaternion: tuple4(rigSlot.pivotWorldQuaternion),
    mesh2MotionGeometry: {
      position: nativeLimbChainSlot
        ? geometryPositionForSourceBindOffset(exactSourceBindOffset, sourceBasisInverseQuaternion)
        : tuple3(rigSlot.geometry.position),
      rotation: nativeLimbChainSlot
        ? inverseQuaternionEulerTuple(tuple4(exactSourceRestBasis.quaternion))
        : tuple3(rigSlot.geometry.rotation),
      scale: tuple3(rigSlot.geometry.scale),
    },
    jointClearance: Number.isFinite(optionalRigSlot.jointClearance)
      ? roundMetric(optionalRigSlot.jointClearance ?? 0)
      : deriveFallbackJointClearance(localGridDimensions),
    roleHintIndexes: [...sourceSlot.roleHintIndexes],
    sourceHashes: {
      exactObjSurfaceSlot: sourceContext.sourceKind === 'exact-obj'
        ? sourceDataHash('exact-obj-slot', resolvedSourceSlotHashPayload(sourceSlot))
        : null,
      referenceLimbVoxelSlot: sourceContext.sourceKind === 'reference-limb'
        ? sourceDataHash('reference-limb-voxel-slot', resolvedSourceSlotHashPayload(sourceSlot))
        : null,
      mesh2MotionSlot: sourceDataHash('mesh2motion-slot', rigSlot),
      referenceSourceBindSlot: referenceSourceSlot
        ? sourceDataHash('reference-source-bind-slot', referenceSourceSlot)
        : null,
    },
    referenceVoxelCount: sourceSlot.voxelCount,
    referenceRunCount: sourceSlot.runCount,
    referenceMaskRuns,
  };
};

const buildV3ArmorFoundationArtifact = (): V3ArmorFoundationArtifact => ({
  schemaVersion: V3_ARMOR_FOUNDATION_SCHEMA,
  version: 1,
  source: {
    kind: 'v3-internal-reference-locked-foundation',
    exactObjSurfaceSchema: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.schemaVersion,
    exactObjSurfaceHash: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash,
    mesh2MotionRigSchema: V3_MESH2MOTION_ARMOR_RIG.schemaVersion,
    mesh2MotionRigSha256: V3_MESH2MOTION_ARMOR_RIG.source.sha256,
    referenceSourceBindSchema: V3_REFERENCE_SOURCE_BIND.schemaVersion,
    referenceSourceBindSha256: V3_REFERENCE_SOURCE_BIND.source.sha256,
    referenceLimbVoxelSchema: V3_REFERENCE_LIMB_VOXELS.schemaVersion,
    referenceLimbVoxelSha256: V3_REFERENCE_LIMB_VOXELS.source.sha256,
    generator: 'sanitized-obj-surface-plus-mesh2motion-rig-plus-blender-source-bind-plus-regenerated-limb-voxels',
  },
  rolePalette: [...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.rolePalette],
  slots: Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
    slot,
    buildFoundationSlot(slot),
  ])) as Record<V3CharacterSlotId, V3ArmorFoundationSlot>,
});

export const V3_ARMOR_FOUNDATION = buildV3ArmorFoundationArtifact();

export const getV3ArmorFoundationMesh2MotionGeometry = (
  slot: V3CharacterSlotId
): V3ArmorFoundationGeometryTransform => V3_ARMOR_FOUNDATION.slots[slot].mesh2MotionGeometry;

const roleColor = (
  role: string,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): string => resolveV3RoleColor(role, colors, paintJob);

const roleEmissive = (
  role: string,
  paintJob: CharacterLoadout['paintJob'] | undefined,
  fallback: boolean
): boolean => resolveV3RoleEmissive(role, paintJob, fallback);

export function createV3ReferenceLockedPartVoxels(
  slot: V3CharacterSlotId,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob'],
  options: V3ReferenceLockedPartOptions = {}
): VoxelData[] {
  const sourceContext = getV3FoundationSourceContext(slot);
  const sourceSlot = getV3ExactSourceRenderableSlot(slot, {
    qualityTier: options.qualityTier,
    sourceFidelity: options.sourceFidelity,
  }, V3_FOUNDATION_RENDERABLE_SOURCE);
  const rolePalette = sourceContext.rolePalette;
  const sourcePivot = sourceContext.sourcePivot;
  const voxelScale = sourceContext.voxelScale;
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  const bonePosition = V3_DETAIL_BONE_SPECS[boneName].position;
  const voxels = new Map<string, VoxelData>();

  for (const run of sourceSlot.runs) {
    const role = rolePalette[run[0]] ?? 'primary';
    const color = roleColor(role, colors, paintJob);
    const emissive = run[5] === 1 || roleEmissive(role, paintJob, false);
    for (let sourceX = run[3]; sourceX <= run[4]; sourceX += 1) {
      const worldX = (sourceX - sourcePivot[0]) * voxelScale;
      const worldY = run[1] * voxelScale;
      const worldZ = (run[2] - sourcePivot[2]) * voxelScale;
      const x = Math.round((worldX - bonePosition[0]) / voxelScale);
      const y = Math.round((worldY - bonePosition[1]) / voxelScale);
      const z = Math.round((worldZ - bonePosition[2]) / voxelScale);
      voxels.set(`${x}:${y}:${z}`, {
        x,
        y,
        z,
        color,
        emissive: emissive || undefined,
      });
    }
  }

  return [...voxels.values()].sort((left, right) => (
    left.y - right.y ||
    left.z - right.z ||
    left.x - right.x ||
    left.color.localeCompare(right.color) ||
    Number(left.emissive === true) - Number(right.emissive === true)
  ));
}

const coordKey = (voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

const clampIntensity = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.55;

const normalizeDescription = (description: string): string =>
  description.trim().replace(/\s+/g, ' ').toLowerCase();

const resolveTheme = (description: string): ThemeProfile => {
  const normalized = normalizeDescription(description);
  if (/\b(forerunner|cobalt|cyan|hardlight|sentinel)\b/.test(normalized)) return THEMES[0];
  if (/\b(stealth|onyx|black|shadow|red)\b/.test(normalized)) return THEMES[1];
  if (/\b(fire|inferno|ember|lava|orange)\b/.test(normalized)) return THEMES[2];
  if (/\b(frost|ice|arctic|white|snow)\b/.test(normalized)) return THEMES[3];
  return DEFAULT_THEME;
};

const normalizeCustomRole = (role: string | undefined): CustomArmorMaterialRole => (
  role && CUSTOM_ROLE_SET.has(role as CustomArmorMaterialRole)
    ? role as CustomArmorMaterialRole
    : 'primary'
);

const expandFoundationSlot = (slot: V3CharacterSlotId): ExpandedFoundationVoxel[] => {
  const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
  const voxels: ExpandedFoundationVoxel[] = [];

  for (const run of foundationSlot.referenceMaskRuns) {
    for (let x = run[3]; x <= run[4]; x += 1) {
      voxels.push({
        x,
        y: run[1],
        z: run[2],
        roleIndex: run[0],
        emissive: run[5] === 1,
      });
    }
  }

  return voxels.sort((left, right) => (
    left.y - right.y ||
    left.z - right.z ||
    left.x - right.x ||
    left.roleIndex - right.roleIndex ||
    Number(left.emissive === true) - Number(right.emissive === true)
  ));
};

const selectThemeRole = (
  voxel: ExpandedFoundationVoxel,
  slot: V3CharacterSlotId,
  theme: ThemeProfile,
  description: string,
  seed: string,
  intensity: number
): { role: CustomArmorMaterialRole; color?: string; emissive?: true } => {
  const sourceRole = V3_ARMOR_FOUNDATION.rolePalette[voxel.roleIndex];
  if (sourceRole === 'visor') return { role: 'visor', emissive: true };
  if (voxel.emissive || sourceRole === 'emissive') return { role: 'emissive', emissive: true };

  const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
  const [width, height, depth] = foundationSlot.localGridDimensions;
  const edge = voxel.x <= 1 || voxel.x >= width - 2 || voxel.z <= 1 || voxel.z >= depth - 2;
  const upperBand = voxel.y >= Math.floor(height * 0.64);
  const lowerBand = voxel.y <= Math.ceil(height * 0.22);
  const hash = hashString(`${slot}|${description}|${seed}|${voxel.x}|${voxel.y}|${voxel.z}|${voxel.roleIndex}`);
  const roll = hash % 1000;
  const strongThreshold = Math.floor(1000 * intensity * 0.24);
  const detailThreshold = Math.floor(1000 * intensity * 0.14);
  const sourceMappedRole = normalizeCustomRole(sourceRole);

  if (edge && roll < strongThreshold) {
    return {
      role: theme.accent,
      color: theme.accent === 'fixed' ? theme.fixedColor : undefined,
    };
  }
  if ((upperBand || lowerBand) && roll < strongThreshold + detailThreshold) {
    return {
      role: theme.detail,
      color: theme.detail === 'fixed' ? theme.fixedColor : undefined,
      emissive: theme.detail === 'emissive' ? true : undefined,
    };
  }
  if (theme.emissiveEvery > 0 && roll % theme.emissiveEvery === 0 && intensity > 0.45) {
    return { role: 'emissive', emissive: true };
  }
  if (sourceMappedRole === 'undersuit') {
    return { role: theme.primary === 'dark' ? 'dark' : 'undersuit' };
  }
  if (sourceMappedRole === 'secondary' || roll % 7 === 0) {
    return { role: theme.secondary, color: theme.secondary === 'fixed' ? theme.fixedColor : undefined };
  }
  return { role: theme.primary, color: theme.primary === 'fixed' ? theme.fixedColor : undefined };
};

const buildGeneratedName = (slot: V3CharacterSlotId, theme: ThemeProfile): string =>
  `${slot} ${theme.key} foundation`;

export function generateV3ArmorFromTheme(
  options: V3ArmorThemeGenerationOptions
): CustomArmorPieceSnapshot {
  const theme = resolveTheme(options.description);
  const normalizedDescription = normalizeDescription(options.description);
  const seed = String(options.seed ?? 'default');
  const intensity = clampIntensity(options.intensity);
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
  const signature = hashString(`${options.slot}|${theme.key}|${normalizedDescription}|${seed}|${intensity}`)
    .toString(36)
    .padStart(7, '0');
  const voxels = expandFoundationSlot(options.slot).map((voxel): CustomArmorVoxel => {
    const themed = selectThemeRole(voxel, options.slot, theme, normalizedDescription, seed, intensity);
    return {
      x: voxel.x,
      y: voxel.y,
      z: voxel.z,
      role: themed.role,
      color: themed.color,
      emissive: themed.emissive,
    };
  });

  return {
    version: 1,
    id: `v3_foundation_${options.slot}_${signature}`,
    name: buildGeneratedName(options.slot, theme),
    slot: options.slot,
    modelSystem: 'v3',
    gridScale: 2,
    sourcePreset: `v3-foundation:${options.slot}:${theme.key}:${signature}`,
    voxels,
    thumbnail: `V3F:${options.slot}:${voxels.length}`,
    updatedAt: now,
  };
}

export function generateV3ArmorSuitFromTheme(
  options: V3ArmorSuitThemeGenerationOptions
): Record<V3CharacterSlotId, CustomArmorPieceSnapshot> {
  return Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
    slot,
    generateV3ArmorFromTheme({
      ...options,
      slot,
      seed: `${options.seed ?? 'default'}:${slot}`,
    }),
  ])) as Record<V3CharacterSlotId, CustomArmorPieceSnapshot>;
}

const buildFoundationKeySet = (slot: V3CharacterSlotId): Set<string> =>
  new Set(expandFoundationSlot(slot).map(coordKey));

export function validateV3ArmorFoundationPiece(
  piece: CustomArmorPieceSnapshot
): V3ArmorFoundationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const slot = V3_CHARACTER_SLOT_IDS.includes(piece.slot as V3CharacterSlotId)
    ? piece.slot as V3CharacterSlotId
    : undefined;
  const expected = slot ? buildFoundationKeySet(slot) : new Set<string>();
  const actual = new Set<string>();
  let outsideVoxelCount = 0;
  let duplicateVoxelCount = 0;

  if (piece.modelSystem !== 'v3') errors.push('foundation armor pieces must target the V3 model system');
  if (!slot) errors.push(`unsupported V3 foundation slot ${String(piece.slot)}`);
  if (!piece.sourcePreset?.startsWith('v3-foundation:')) {
    warnings.push('piece was not generated by the V3 foundation generator');
  }

  for (const voxel of piece.voxels) {
    if (!Number.isInteger(voxel.x) || !Number.isInteger(voxel.y) || !Number.isInteger(voxel.z)) {
      errors.push('foundation armor voxels must use integer coordinates');
      continue;
    }
    const key = coordKey(voxel);
    if (actual.has(key)) duplicateVoxelCount += 1;
    actual.add(key);
    if (slot && !expected.has(key)) {
      outsideVoxelCount += 1;
      if (outsideVoxelCount <= 3) {
        errors.push(`${slot} voxel ${key} is outside the V3 foundation mask`);
      }
    }
    if (!CUSTOM_ROLE_SET.has(voxel.role)) {
      errors.push(`${slot ?? 'unknown'} voxel ${key} has unsupported material role ${String(voxel.role)}`);
    }
  }

  let missingVoxelCount = 0;
  if (slot) {
    for (const key of expected) {
      if (!actual.has(key)) missingVoxelCount += 1;
    }
    if (missingVoxelCount > 0) {
      errors.push(`${slot} is missing ${missingVoxelCount} foundation voxels`);
    }
    if (actual.size !== expected.size) {
      errors.push(`${slot} has ${actual.size} unique voxels; expected ${expected.size}`);
    }
  }
  if (duplicateVoxelCount > 0) {
    errors.push(`piece contains ${duplicateVoxelCount} duplicate foundation voxel coordinates`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      slot,
      voxelCount: piece.voxels.length,
      expectedVoxelCount: expected.size,
      missingVoxelCount,
      outsideVoxelCount,
      duplicateVoxelCount,
    },
  };
}

export function analyzeV3ArmorFoundation(
  artifact: V3ArmorFoundationArtifact = V3_ARMOR_FOUNDATION
): V3ArmorFoundationAnalysis {
  const issues: string[] = [];
  let referenceVoxelCount = 0;

  if (artifact.schemaVersion !== V3_ARMOR_FOUNDATION_SCHEMA) {
    issues.push(`schemaVersion must be ${V3_ARMOR_FOUNDATION_SCHEMA}`);
  }
  if (artifact.version !== 1) issues.push('version must be 1');
  if (artifact.source.exactObjSurfaceHash !== V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash) {
    issues.push('exact OBJ surface source hash does not match the accepted source');
  }
  if (artifact.source.mesh2MotionRigSha256 !== V3_MESH2MOTION_ARMOR_RIG.source.sha256) {
    issues.push('Mesh2Motion rig source hash does not match the generated rig');
  }
  if (artifact.source.referenceLimbVoxelSha256 !== V3_REFERENCE_LIMB_VOXELS.source.sha256) {
    issues.push('reference limb voxel source hash does not match the regenerated GLB limb source');
  }

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const foundationSlot = artifact.slots[slot];
    const sourceContext = getV3FoundationSourceContext(slot);
    const { sourceSlot } = sourceContext;
    const rigSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
    const optionalRigSlot = rigSlot as typeof rigSlot & V3OptionalGeneratedRigSlotMetadata;
    if (!foundationSlot) {
      issues.push(`${slot} foundation slot is missing`);
      continue;
    }
    referenceVoxelCount += foundationSlot.referenceVoxelCount;
    const runVoxelTotal = foundationSlot.referenceMaskRuns.reduce((total, run) => total + runVoxelCount(run), 0);
    if (foundationSlot.slot !== slot) issues.push(`${slot} foundation has mismatched slot ${foundationSlot.slot}`);
    if (foundationSlot.referenceVoxelCount !== sourceSlot.voxelCount) {
      issues.push(`${slot} reference voxel count does not match ${sourceContext.sourceKind} source`);
    }
    if (runVoxelTotal !== foundationSlot.referenceVoxelCount) {
      issues.push(`${slot} reference mask runs expand to ${runVoxelTotal}, expected ${foundationSlot.referenceVoxelCount}`);
    }
    if (foundationSlot.referenceRunCount !== sourceSlot.runCount) {
      issues.push(`${slot} reference run count does not match ${sourceContext.sourceKind} source`);
    }
    const expectedObjSlotHash = sourceContext.sourceKind === 'exact-obj'
      ? sourceDataHash('exact-obj-slot', resolvedSourceSlotHashPayload(sourceSlot))
      : null;
    const expectedLimbSlotHash = sourceContext.sourceKind === 'reference-limb'
      ? sourceDataHash('reference-limb-voxel-slot', resolvedSourceSlotHashPayload(sourceSlot))
      : null;
    if (foundationSlot.sourceHashes.exactObjSurfaceSlot !== expectedObjSlotHash) {
      issues.push(`${slot} exact OBJ slot hash does not match source slot data`);
    }
    if (foundationSlot.sourceHashes.referenceLimbVoxelSlot !== expectedLimbSlotHash) {
      issues.push(`${slot} reference limb voxel slot hash does not match source slot data`);
    }
    const expectedRigSlotHash = sourceDataHash('mesh2motion-slot', rigSlot);
    if (foundationSlot.sourceHashes.mesh2MotionSlot !== expectedRigSlotHash) {
      issues.push(`${slot} Mesh2Motion slot hash does not match source slot data`);
    }
    if (foundationSlot.sourceJointName !== rigSlot.sourceJointName) {
      issues.push(`${slot} source joint ${foundationSlot.sourceJointName} does not match Mesh2Motion rig`);
    }
    if (foundationSlot.endJointName !== rigSlot.endJointName) {
      issues.push(`${slot} end joint does not match Mesh2Motion rig`);
    }
    if (foundationSlot.mirrorOf !== (optionalRigSlot.mirrorOf ?? null)) {
      issues.push(`${slot} mirrorOf does not match Mesh2Motion rig`);
    }
    for (const [axis, dimension] of foundationSlot.localGridDimensions.entries()) {
      if (!Number.isFinite(dimension) || dimension <= 0) {
        issues.push(`${slot} localGridDimensions axis ${axis} is invalid`);
      }
    }
    for (const [fieldName, fieldValue] of Object.entries({
      exactSourceGeometryCenter: foundationSlot.exactSourceGeometryCenter,
      exactSourceBindPoint: foundationSlot.exactSourceBindPoint,
      exactSourceBindOffset: foundationSlot.exactSourceBindOffset,
      mesh2MotionGeometryPosition: foundationSlot.mesh2MotionGeometry.position,
    })) {
      if (!fieldValue.every(Number.isFinite)) {
        issues.push(`${slot} ${fieldName} must be finite`);
      }
    }
    for (const [axisName, axisValue] of Object.entries({
      xAxis: foundationSlot.exactSourceRestBasis.xAxis,
      yAxis: foundationSlot.exactSourceRestBasis.yAxis,
      zAxis: foundationSlot.exactSourceRestBasis.zAxis,
    })) {
      if (!axisValue.every(Number.isFinite) || Math.abs(tupleLength(axisValue) - 1) > 0.00001) {
        issues.push(`${slot} exactSourceRestBasis ${axisName} must be finite and normalized`);
      }
    }
    if (isV3Mesh2MotionNativeArmChainSlot(slot)) {
      const referenceSourceSlot = V3_REFERENCE_SOURCE_BIND.slots[
        slot as keyof typeof V3_REFERENCE_SOURCE_BIND.slots
      ];
      if (!foundationSlot.referenceSourceBindBasis || !referenceSourceSlot) {
        issues.push(`${slot} reference source bind basis is missing`);
      } else {
        const referenceAxis = new THREE.Vector3(...referenceSourceSlot.sourceBasis.yAxis);
        const foundationAxis = new THREE.Vector3(...foundationSlot.exactSourceRestBasis.yAxis);
        if (sourceContext.sourceKind === 'reference-limb') {
          if (foundationAxis.angleTo(referenceAxis) > 0.00001) {
            issues.push(`${slot} exactSourceRestBasis does not match the regenerated GLB source bind axis`);
          }
        } else {
          const sourceAxis = sourceSlotMajorAxis(slot);
          if (sourceAxis.dot(referenceAxis) < 0) sourceAxis.multiplyScalar(-1);
          if (foundationAxis.angleTo(sourceAxis) > 0.00001) {
            issues.push(`${slot} exactSourceRestBasis does not match the accepted voxel source axis`);
          }
        }
        if (
          !Number.isFinite(foundationSlot.sourcePoseCorrectionAngleDegrees) ||
          foundationSlot.sourcePoseCorrectionAngleDegrees < 0
        ) {
          issues.push(`${slot} sourcePoseCorrectionAngleDegrees must be finite and non-negative`);
        }
      }
    }
    if (
      !foundationSlot.exactSourceRestBasis.quaternion.every(Number.isFinite) ||
      Math.abs(quaternionLength(foundationSlot.exactSourceRestBasis.quaternion) - 1) > 0.00001
    ) {
      issues.push(`${slot} exactSourceRestBasis quaternion must be finite and normalized`);
    }
    for (const run of foundationSlot.referenceMaskRuns) {
      if (run[3] > run[4]) issues.push(`${slot} has inverted foundation run`);
      if (run[1] < 0 || run[1] >= foundationSlot.localGridDimensions[1]) {
        issues.push(`${slot} foundation run y is outside local grid`);
      }
      if (run[2] < 0 || run[2] >= foundationSlot.localGridDimensions[2]) {
        issues.push(`${slot} foundation run z is outside local grid`);
      }
      if (run[3] < 0 || run[4] >= foundationSlot.localGridDimensions[0]) {
        issues.push(`${slot} foundation run x range is outside local grid`);
      }
      if (artifact.rolePalette[run[0]] === undefined) {
        issues.push(`${slot} foundation run references missing role index ${run[0]}`);
      }
    }
  }

  return {
    kind: 'v3-armor-foundation-analysis',
    version: 1,
    ready: issues.length === 0,
    slotCount: Object.keys(artifact.slots).length,
    referenceVoxelCount,
    issues: [...new Set(issues)],
  };
}
