import type { V3CharacterSlotId, V3PaintRole, V3Vec3Tuple } from './v3ModelTypes';

export const V3_REFERENCE_LIMB_VOXEL_SCHEMA = 'v3-reference-limb-voxels/v1';

export type V3ReferenceLimbVoxelRun = readonly [
  roleIndex: number,
  y: number,
  z: number,
  xStart: number,
  xEnd: number,
  emissive?: 1,
];

export interface V3ReferenceLimbVoxelSourceSummary {
  kind: 'blender-reference-glb';
  fileName: string;
  sha256: string;
  generator: string | null;
}

export interface V3ReferenceLimbVoxelCoordinateSystem {
  authoringSpace: 'mesh2motion-native-v3';
  targetHeightVoxels: number;
  voxelScale: number;
  pivot: V3Vec3Tuple;
}

export interface V3ReferenceLimbVoxelSlot {
  slot: V3CharacterSlotId;
  sourceObjectName: string;
  mirrorOf: V3CharacterSlotId | null;
  bounds: {
    min: V3Vec3Tuple;
    max: V3Vec3Tuple;
    size: V3Vec3Tuple;
  };
  worldBounds: {
    min: V3Vec3Tuple;
    max: V3Vec3Tuple;
    size: V3Vec3Tuple;
  };
  worldCenter: V3Vec3Tuple;
  roleHintIndexes: readonly number[];
  voxelCount: number;
  runCount: number;
  runs: readonly V3ReferenceLimbVoxelRun[];
}

export interface V3ReferenceLimbVoxelArtifact {
  schemaVersion: typeof V3_REFERENCE_LIMB_VOXEL_SCHEMA;
  version: 1;
  source: V3ReferenceLimbVoxelSourceSummary;
  coordinateSystem: V3ReferenceLimbVoxelCoordinateSystem;
  rolePalette: readonly V3PaintRole[];
  slots: Readonly<Partial<Record<V3CharacterSlotId, V3ReferenceLimbVoxelSlot>>>;
  metrics: {
    slotCount: number;
    totalVoxelCount: number;
    totalRunCount: number;
    maxSlotVoxelCount: number;
  };
  diagnostics: {
    missingArmMeshNodes: readonly string[];
    unassignedTriangleCount: number;
    sourceObjectNames: readonly string[];
  };
}
