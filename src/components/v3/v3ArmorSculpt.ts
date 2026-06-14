import type { VoxelData } from '../VoxelModels';
import type { V3CharacterSlotId } from './v3ModelTypes';

export type V3VoxelDimensionsTuple = [number, number, number];
export type V3InsetKeyframe = readonly [number, number];

export interface V3SculptProfile {
  xInsets: readonly V3InsetKeyframe[];
  zInsets: readonly V3InsetKeyframe[];
}

export interface V3SculptedShellOptions {
  dimensions: V3VoxelDimensionsTuple;
  profile: V3SculptProfile;
  color: string;
  emissive?: boolean;
}

export interface V3PanelStripeOptions {
  axis: 'x' | 'y';
  fixedZ: number;
  color: string;
  emissive?: boolean;
}

export interface V3CornerArmorTabOptions {
  dimensions: V3VoxelDimensionsTuple;
  color: string;
}

export interface V3ArmorPlateOptions {
  origin: V3VoxelDimensionsTuple;
  dimensions: V3VoxelDimensionsTuple;
  color: string;
  emissive?: boolean;
}

export interface V3MirroredArmorPlateOptions extends V3ArmorPlateOptions {
  mirrorMaxX: number;
}

export const V3_AEGIS_SCULPT_PROFILES: Record<V3CharacterSlotId, V3SculptProfile> = {
  helmet: {
    xInsets: [[0, 3], [0.3, 2], [0.58, 1], [0.74, 1], [0.88, 3], [1, 3]],
    zInsets: [[0, 3], [0.35, 1], [0.72, 1], [1, 3]],
  },
  neck: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  chest: {
    xInsets: [[0, 2], [0.45, 1], [0.72, 0], [1, 0]],
    zInsets: [[0, 1], [0.35, 0], [0.82, 0], [1, 1]],
  },
  shoulderLeft: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 2], [0.5, 0], [1, 1]],
  },
  shoulderRight: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 2], [0.5, 0], [1, 1]],
  },
  upperArmLeft: {
    xInsets: [[0, 1], [0.55, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  upperArmRight: {
    xInsets: [[0, 1], [0.55, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  forearmLeft: {
    xInsets: [[0, 1], [0.42, 0], [0.72, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  forearmRight: {
    xInsets: [[0, 1], [0.42, 0], [0.72, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  handLeft: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  handRight: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 1], [0.5, 0], [1, 1]],
  },
  pelvis: {
    xInsets: [[0, 2], [0.42, 0], [1, 1]],
    zInsets: [[0, 1], [0.58, 0], [1, 1]],
  },
  thighLeft: {
    xInsets: [[0, 1], [0.48, 0], [1, 1]],
    zInsets: [[0, 1], [0.55, 0], [1, 1]],
  },
  thighRight: {
    xInsets: [[0, 1], [0.48, 0], [1, 1]],
    zInsets: [[0, 1], [0.55, 0], [1, 1]],
  },
  shinLeft: {
    xInsets: [[0, 1], [0.6, 0], [1, 1]],
    zInsets: [[0, 1], [0.6, 0], [1, 1]],
  },
  shinRight: {
    xInsets: [[0, 1], [0.6, 0], [1, 1]],
    zInsets: [[0, 1], [0.6, 0], [1, 1]],
  },
  footLeft: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 0], [0.55, 1], [1, 2]],
  },
  footRight: {
    xInsets: [[0, 1], [0.5, 0], [1, 1]],
    zInsets: [[0, 0], [0.55, 1], [1, 2]],
  },
  back: {
    xInsets: [[0, 1], [0.48, 0], [1, 1]],
    zInsets: [[0, 1], [0.62, 0], [1, 0]],
  },
};

const clampInteger = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const setV3Voxel = (
  voxels: VoxelData[],
  voxel: VoxelData
): void => {
  const existing = voxels.find((candidate) =>
    candidate.x === voxel.x &&
    candidate.y === voxel.y &&
    candidate.z === voxel.z
  );

  if (existing) {
    existing.color = voxel.color;
    existing.emissive = voxel.emissive;
    return;
  }

  voxels.push(voxel);
};

export function sampleV3Inset(
  keyframes: readonly V3InsetKeyframe[],
  ratio: number,
  maxInset: number
): number {
  const sorted = [...keyframes].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return 0;
  if (ratio <= sorted[0][0]) return clampInteger(sorted[0][1], 0, maxInset);

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (ratio <= next[0]) {
      const span = Math.max(0.0001, next[0] - previous[0]);
      const blend = (ratio - previous[0]) / span;
      return clampInteger(previous[1] + (next[1] - previous[1]) * blend, 0, maxInset);
    }
  }

  return clampInteger(sorted[sorted.length - 1][1], 0, maxInset);
}

export function createV3SculptedShell({
  dimensions,
  profile,
  color,
  emissive = false,
}: V3SculptedShellOptions): VoxelData[] {
  const voxels: VoxelData[] = [];
  const [width, height, depth] = dimensions;
  const maxXInset = Math.max(0, Math.floor((width - 1) / 2));
  const maxZInset = Math.max(0, Math.floor((depth - 1) / 2));

  for (let y = 0; y < height; y += 1) {
    const ratio = height <= 1 ? 0 : y / (height - 1);
    const xInset = sampleV3Inset(profile.xInsets, ratio, maxXInset);
    const zInset = sampleV3Inset(profile.zInsets, ratio, maxZInset);
    const minX = xInset;
    const maxX = width - 1 - xInset;
    const minZ = zInset;
    const maxZ = depth - 1 - zInset;

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const isShell =
          y === 0 ||
          y === height - 1 ||
          x === minX ||
          x === maxX ||
          z === minZ ||
          z === maxZ;
        if (isShell) {
          voxels.push({ x, y, z, color, emissive });
        }
      }
    }
  }

  return voxels;
}

export function appendV3PanelStripe(
  voxels: VoxelData[],
  { axis, fixedZ, color, emissive = false }: V3PanelStripeOptions
): void {
  const maxX = Math.max(...voxels.map((voxel) => voxel.x));
  const maxY = Math.max(...voxels.map((voxel) => voxel.y));
  const centerX = Math.floor(maxX / 2);
  const centerY = Math.floor(maxY / 2);

  if (axis === 'x') {
    for (let x = 1; x < maxX; x += 1) {
      voxels.push({ x, y: centerY, z: fixedZ, color, emissive });
    }
    return;
  }

  for (let y = 1; y < maxY; y += 1) {
    voxels.push({ x: centerX, y, z: fixedZ, color, emissive });
  }
}

export function appendV3CornerArmorTabs(
  voxels: VoxelData[],
  { dimensions, color }: V3CornerArmorTabOptions
): void {
  const [width, height, depth] = dimensions;
  const tabY = Math.max(1, height - 2);
  const tabZ = Math.max(0, depth - 1);
  voxels.push({ x: 0, y: tabY, z: tabZ, color });
  voxels.push({ x: Math.max(0, width - 1), y: tabY, z: tabZ, color });
}

export function appendV3ArmorPlate(
  voxels: VoxelData[],
  { origin, dimensions, color, emissive = false }: V3ArmorPlateOptions
): void {
  const [originX, originY, originZ] = origin;
  const [width, height, depth] = dimensions;

  for (let x = originX; x < originX + width; x += 1) {
    for (let y = originY; y < originY + height; y += 1) {
      for (let z = originZ; z < originZ + depth; z += 1) {
        setV3Voxel(voxels, { x, y, z, color, emissive });
      }
    }
  }
}

export function appendV3MirroredArmorPlates(
  voxels: VoxelData[],
  { origin, dimensions, mirrorMaxX, color, emissive = false }: V3MirroredArmorPlateOptions
): void {
  appendV3ArmorPlate(voxels, { origin, dimensions, color, emissive });

  const mirroredOriginX = mirrorMaxX - origin[0] - dimensions[0] + 1;
  if (mirroredOriginX === origin[0]) return;

  appendV3ArmorPlate(voxels, {
    origin: [mirroredOriginX, origin[1], origin[2]],
    dimensions,
    color,
    emissive,
  });
}
