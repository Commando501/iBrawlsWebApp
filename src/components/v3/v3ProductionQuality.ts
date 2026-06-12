import type { VoxelData } from '../VoxelModels';

export type V3ProductionReadiness = 'blockout' | 'productionCandidate';

export interface V3ProductionQualityThresholds {
  minVoxels: number;
  minMaterials: number;
  minEmissiveVoxels: number;
  minSilhouetteColumns: number;
}

export interface V3VoxelQualityReport {
  voxelCount: number;
  materialCount: number;
  emissiveVoxelCount: number;
  occupiedDimensions: { x: number; y: number; z: number };
  silhouetteColumnCount: number;
}

export const V3_PRODUCTION_QUALITY_THRESHOLDS = {
  characterPart: {
    minVoxels: 24,
    minMaterials: 3,
    minEmissiveVoxels: 0,
    minSilhouetteColumns: 12,
  },
  weapon: {
    minVoxels: 32,
    minMaterials: 3,
    minEmissiveVoxels: 1,
    minSilhouetteColumns: 18,
  },
} as const satisfies Record<string, V3ProductionQualityThresholds>;

export function analyzeV3VoxelQuality(voxels: readonly VoxelData[]): V3VoxelQualityReport {
  if (voxels.length === 0) {
    return {
      voxelCount: 0,
      materialCount: 0,
      emissiveVoxelCount: 0,
      occupiedDimensions: { x: 0, y: 0, z: 0 },
      silhouetteColumnCount: 0,
    };
  }

  const xs = voxels.map((voxel) => voxel.x);
  const ys = voxels.map((voxel) => voxel.y);
  const zs = voxels.map((voxel) => voxel.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const silhouetteColumns = new Set(voxels.map((voxel) => `${voxel.x},${voxel.y}`));

  return {
    voxelCount: voxels.length,
    materialCount: new Set(voxels.map((voxel) => voxel.color)).size,
    emissiveVoxelCount: voxels.filter((voxel) => voxel.emissive).length,
    occupiedDimensions: {
      x: maxX - minX + 1,
      y: maxY - minY + 1,
      z: maxZ - minZ + 1,
    },
    silhouetteColumnCount: silhouetteColumns.size,
  };
}

export function classifyV3ProductionReadiness(
  report: V3VoxelQualityReport,
  thresholds: V3ProductionQualityThresholds
): V3ProductionReadiness {
  if (
    report.voxelCount >= thresholds.minVoxels &&
    report.materialCount >= thresholds.minMaterials &&
    report.emissiveVoxelCount >= thresholds.minEmissiveVoxels &&
    report.silhouetteColumnCount >= thresholds.minSilhouetteColumns
  ) {
    return 'productionCandidate';
  }

  return 'blockout';
}
