import type { VoxelData } from './VoxelModels';

export interface PartConstraint {
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const V2_PART_CONSTRAINTS: Record<string, PartConstraint> = {
  pelvis: { maxX: 10, maxY: 11, maxZ: 7 },
  stomach: { maxX: 9, maxY: 8, maxZ: 6 },
  chest: { maxX: 13, maxY: 16, maxZ: 14 },
  neck: { maxX: 7, maxY: 4, maxZ: 4 },
  head: { maxX: 9, maxY: 10, maxZ: 9 },
  shoulder: { maxX: 7, maxY: 8, maxZ: 6 },
  arm_upper: { maxX: 4, maxY: 5, maxZ: 9 },
  arm_lower: { maxX: 5, maxY: 6, maxZ: 9 },
  hand: { maxX: 4, maxY: 4, maxZ: 4 },
  leg_upper: { maxX: 6, maxY: 7, maxZ: 12 },
  leg_lower: { maxX: 6, maxY: 9, maxZ: 14 },
  foot: { maxX: 6, maxY: 8, maxZ: 5 },
  toes: { maxX: 6, maxY: 5, maxZ: 4 },
};

export function getV2PartDimensions(voxels: VoxelData[]): { sizeX: number; sizeY: number; sizeZ: number } {
  if (voxels.length === 0) {
    return { sizeX: 0, sizeY: 0, sizeZ: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const v of voxels) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }

  return {
    sizeX: maxX - minX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: maxZ - minZ + 1,
  };
}

export function verifyV2PartConstraints(voxels: VoxelData[], partName: string): boolean {
  const baseName = partName.replace(/_[lr]$/, '');
  const constraint = V2_PART_CONSTRAINTS[baseName];
  if (!constraint) {
    console.warn(`No V2 constraint defined for part name: "${partName}" (base: "${baseName}")`);
    return true;
  }

  const { sizeX, sizeY, sizeZ } = getV2PartDimensions(voxels);
  if (sizeX > constraint.maxX || sizeY > constraint.maxY || sizeZ > constraint.maxZ) {
    throw new Error(
      `V2 Body Part "${partName}" exceeds hitbox constraints. ` +
      `Size: ${sizeX}x${sizeY}x${sizeZ}, Max allowed: ${constraint.maxX}x${constraint.maxY}x${constraint.maxZ}`
    );
  }

  return true;
}
