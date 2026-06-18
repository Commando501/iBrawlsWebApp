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

export interface V3TaperedArmorPlateOptions extends V3ArmorPlateOptions {
  taperAxis: 'x' | 'y';
  taperAmount: number;
}

export interface V3SteppedRidgeOptions {
  origin: V3VoxelDimensionsTuple;
  axis: 'x' | 'y';
  length: number;
  width?: number;
  stepEvery: number;
  gapEvery?: number;
  color: string;
  emissive?: boolean;
}

export interface V3ProjectedPanelZone {
  xMinRatio: number;
  xMaxRatio: number;
  yMinRatio: number;
  yMaxRatio: number;
}

export interface V3ProjectedPanelZoneOptions {
  dimensions: V3VoxelDimensionsTuple;
  zone: V3ProjectedPanelZone;
  z: number;
  color: string;
  emissive?: boolean;
}

export interface V3NotchedSeamOptions {
  dimensions: V3VoxelDimensionsTuple;
  axis: 'x' | 'y';
  positionRatio: number;
  width?: number;
  z?: number;
  preserveEvery?: number;
}

export type V3ReferenceVentSide = 'left' | 'right' | 'both';

export interface V3ReferenceVentSetOptions {
  dimensions: V3VoxelDimensionsTuple;
  side?: V3ReferenceVentSide;
  yRatio: number;
  z: number;
  count: number;
  color: string;
  emissive?: boolean;
}

export interface V3MirroredReferenceFeatureOptions {
  dimensions: V3VoxelDimensionsTuple;
  origin: V3VoxelDimensionsTuple;
  featureDimensions: V3VoxelDimensionsTuple;
  color: string;
  emissive?: boolean;
}

export interface V3ReferenceTaperBand {
  yRatio: number;
  widthRatio: number;
  depthRatio: number;
}

type V3ChannelAxis = 'x' | 'y' | 'z';
type V3ChannelCoordinateRange = number | readonly [number, number];

export interface V3InsetChannelOptions {
  axis: V3ChannelAxis;
  fixed?: Partial<Record<V3ChannelAxis, V3ChannelCoordinateRange>>;
  range?: V3ChannelCoordinateRange;
  mode: 'remove' | 'recolor';
  color?: string;
  emissive?: boolean;
}

export interface V3VentPairOptions {
  centerX: number;
  y: number;
  z: number;
  pairs: number;
  spacing?: number;
  color: string;
  emissive?: boolean;
}

export interface V3SegmentedBandOptions extends V3ArmorPlateOptions {
  axis: 'x' | 'y';
  segmentLength: number;
  gapLength?: number;
}

export const V3_AEGIS_SCULPT_PROFILES: Record<V3CharacterSlotId, V3SculptProfile> = {
  helmet: {
    xInsets: [[0, 3], [0.3, 2], [0.58, 1], [0.74, 1], [0.88, 5], [1, 5]],
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

const clampRatio = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const clampVoxelIndex = (value: number, size: number): number =>
  clampInteger(Number.isFinite(value) ? value : 0, 0, Math.max(0, size - 1));

const normalizeExtent = (value: number): number =>
  Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));

const normalizedRangeToBounds = (
  minRatio: number,
  maxRatio: number,
  size: number
): readonly [number, number] | null => {
  const extent = normalizeExtent(size);
  if (extent <= 0) return null;

  const min = Math.min(clampRatio(minRatio), clampRatio(maxRatio));
  const max = Math.max(clampRatio(minRatio), clampRatio(maxRatio));
  const start = clampVoxelIndex(Math.floor(min * extent), extent);
  const end = clampVoxelIndex(Math.ceil(max * extent) - 1, extent);
  return start <= end ? [start, end] : [end, start];
};

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

export function appendV3TaperedArmorPlate(
  voxels: VoxelData[],
  { origin, dimensions, taperAxis, taperAmount, color, emissive = false }: V3TaperedArmorPlateOptions
): void {
  const [originX, originY, originZ] = origin;
  const [width, height, depth] = dimensions;
  const maxXInset = Math.max(0, Math.floor((width - 1) / 2));
  const maxYInset = Math.max(0, Math.floor((height - 1) / 2));

  for (let xIndex = 0; xIndex < width; xIndex += 1) {
    const xRatio = width <= 1 ? 1 : xIndex / (width - 1);
    const yInset = taperAxis === 'y'
      ? Math.min(maxYInset, Math.max(0, Math.round(taperAmount * xRatio)))
      : 0;

    for (let yIndex = yInset; yIndex < height - yInset; yIndex += 1) {
      const yRatio = height <= 1 ? 1 : yIndex / (height - 1);
      const xInset = taperAxis === 'x'
        ? Math.min(maxXInset, Math.max(0, Math.round(taperAmount * yRatio)))
        : 0;

      if (xIndex < xInset || xIndex >= width - xInset) continue;

      for (let zIndex = 0; zIndex < depth; zIndex += 1) {
        setV3Voxel(voxels, {
          x: originX + xIndex,
          y: originY + yIndex,
          z: originZ + zIndex,
          color,
          emissive,
        });
      }
    }
  }
}

export function appendV3SteppedRidge(
  voxels: VoxelData[],
  {
    origin,
    axis,
    length,
    width = 1,
    stepEvery,
    gapEvery = 1,
    color,
    emissive = false,
  }: V3SteppedRidgeOptions
): void {
  const [originX, originY, originZ] = origin;
  const activeLength = Math.max(1, Math.floor(stepEvery));
  const gapLength = Math.max(0, Math.floor(gapEvery));
  const cycleLength = activeLength + gapLength;
  const ridgeLength = Math.max(0, Math.floor(length));
  const ridgeWidth = Math.max(1, Math.floor(width));

  for (let index = 0; index < ridgeLength; index += 1) {
    if (cycleLength > 0 && index % cycleLength >= activeLength) continue;

    for (let offset = 0; offset < ridgeWidth; offset += 1) {
      setV3Voxel(voxels, {
        x: axis === 'x' ? originX + index : originX + offset,
        y: axis === 'x' ? originY + offset : originY + index,
        z: originZ,
        color,
        emissive,
      });
    }
  }
}

export function appendV3ProjectedPanelZone(
  voxels: VoxelData[],
  { dimensions, zone, z, color, emissive = false }: V3ProjectedPanelZoneOptions
): void {
  const [width, height, depth] = dimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  if (width <= 0 || height <= 0 || depth <= 0) return;

  const xBounds = normalizedRangeToBounds(zone.xMinRatio, zone.xMaxRatio, width);
  const yBounds = normalizedRangeToBounds(zone.yMinRatio, zone.yMaxRatio, height);
  if (!xBounds || !yBounds) return;

  const fixedZ = clampVoxelIndex(z, depth);
  for (let x = xBounds[0]; x <= xBounds[1]; x += 1) {
    for (let y = yBounds[0]; y <= yBounds[1]; y += 1) {
      setV3Voxel(voxels, { x, y, z: fixedZ, color, emissive });
    }
  }
}

export function carveV3NotchedSeam(
  voxels: VoxelData[],
  { dimensions, axis, positionRatio, width = 1, z, preserveEvery }: V3NotchedSeamOptions
): void {
  const [partWidth, partHeight, partDepth] = dimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  if (partWidth <= 0 || partHeight <= 0 || partDepth <= 0 || voxels.length === 0) return;

  const axisSize = axis === 'x' ? partWidth : partHeight;
  const seamCenter = clampVoxelIndex(clampRatio(positionRatio) * Math.max(0, axisSize - 1), axisSize);
  const seamWidth = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
  const seamStart = clampVoxelIndex(seamCenter - Math.floor((seamWidth - 1) / 2), axisSize);
  const seamEnd = clampVoxelIndex(seamCenter + Math.ceil((seamWidth - 1) / 2), axisSize);
  const fixedZ = z === undefined ? undefined : clampVoxelIndex(z, partDepth);
  const preserveStride = Math.max(0, Math.floor(Number.isFinite(preserveEvery) ? preserveEvery ?? 0 : 0));
  const inPart = (voxel: VoxelData): boolean =>
    voxel.x >= 0 &&
    voxel.x < partWidth &&
    voxel.y >= 0 &&
    voxel.y < partHeight &&
    voxel.z >= 0 &&
    voxel.z < partDepth &&
    (fixedZ === undefined || voxel.z === fixedZ);
  const matchesSeam = (voxel: VoxelData): boolean =>
    inPart(voxel) &&
    voxel[axis] >= Math.min(seamStart, seamEnd) &&
    voxel[axis] <= Math.max(seamStart, seamEnd);
  const candidates = voxels
    .filter(matchesSeam)
    .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  if (candidates.length === 0) return;

  const inPartCount = voxels.filter(inPart).length;
  let removable = preserveStride > 0
    ? candidates.filter((_, index) => index % preserveStride !== 0)
    : [...candidates];
  if (inPartCount > 0 && removable.length >= inPartCount) {
    removable = removable.slice(1);
  }

  const removalKeys = new Set(removable.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`));
  for (let index = voxels.length - 1; index >= 0; index -= 1) {
    const voxel = voxels[index];
    if (removalKeys.has(`${voxel.x}:${voxel.y}:${voxel.z}`)) {
      voxels.splice(index, 1);
    }
  }
}

export function appendV3ReferenceVentSet(
  voxels: VoxelData[],
  { dimensions, side = 'both', yRatio, z, count, color, emissive = false }: V3ReferenceVentSetOptions
): void {
  const [width, height, depth] = dimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  if (width <= 0 || height <= 0 || depth <= 0) return;

  const ventCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const y = clampVoxelIndex(clampRatio(yRatio) * Math.max(0, height - 1), height);
  const fixedZ = clampVoxelIndex(z, depth);
  for (let index = 0; index < ventCount; index += 1) {
    if (side === 'left' || side === 'both') {
      setV3Voxel(voxels, { x: clampVoxelIndex(index, width), y, z: fixedZ, color, emissive });
    }
    if (side === 'right' || side === 'both') {
      setV3Voxel(voxels, { x: clampVoxelIndex(width - 1 - index, width), y, z: fixedZ, color, emissive });
    }
  }
}

const appendBoundedV3Feature = (
  voxels: VoxelData[],
  {
    dimensions,
    origin,
    featureDimensions,
    color,
    emissive = false,
  }: V3MirroredReferenceFeatureOptions
): void => {
  const [partWidth, partHeight, partDepth] = dimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  const [featureWidth, featureHeight, featureDepth] = featureDimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  if (
    partWidth <= 0 ||
    partHeight <= 0 ||
    partDepth <= 0 ||
    featureWidth <= 0 ||
    featureHeight <= 0 ||
    featureDepth <= 0
  ) {
    return;
  }

  const [originX, originY, originZ] = origin.map((value) =>
    Math.round(Number.isFinite(value) ? value : 0)
  ) as V3VoxelDimensionsTuple;
  const maxX = Math.min(partWidth, originX + featureWidth);
  const maxY = Math.min(partHeight, originY + featureHeight);
  const maxZ = Math.min(partDepth, originZ + featureDepth);
  for (let x = Math.max(0, originX); x < maxX; x += 1) {
    for (let y = Math.max(0, originY); y < maxY; y += 1) {
      for (let z = Math.max(0, originZ); z < maxZ; z += 1) {
        setV3Voxel(voxels, { x, y, z, color, emissive });
      }
    }
  }
};

export function appendV3MirroredReferenceFeature(
  voxels: VoxelData[],
  options: V3MirroredReferenceFeatureOptions
): void {
  const [partWidth] = options.dimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  const [featureWidth] = options.featureDimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  const [originX, originY, originZ] = options.origin.map((value) =>
    Math.round(Number.isFinite(value) ? value : 0)
  ) as V3VoxelDimensionsTuple;
  if (partWidth <= 0 || featureWidth <= 0) return;

  appendBoundedV3Feature(voxels, options);
  appendBoundedV3Feature(voxels, {
    ...options,
    origin: [partWidth - originX - featureWidth, originY, originZ],
  });
}

export function buildV3ReferenceTaperProfile(
  dimensions: V3VoxelDimensionsTuple,
  bands: readonly V3ReferenceTaperBand[]
): V3SculptProfile {
  const [width, , depth] = dimensions.map(normalizeExtent) as V3VoxelDimensionsTuple;
  const maxXInset = Math.max(0, Math.floor((width - 1) / 2));
  const maxZInset = Math.max(0, Math.floor((depth - 1) / 2));
  const insetForRatio = (size: number, ratio: number, maxInset: number): number => {
    if (size <= 0) return 0;
    const targetSize = clampInteger(Math.round(size * clampRatio(ratio)), 1, size);
    return clampInteger(Math.floor((size - targetSize) / 2), 0, maxInset);
  };
  const sortedBands = [...bands].sort((a, b) => clampRatio(a.yRatio) - clampRatio(b.yRatio));

  return {
    xInsets: sortedBands.map((band) => [
      clampRatio(band.yRatio),
      insetForRatio(width, band.widthRatio, maxXInset),
    ]),
    zInsets: sortedBands.map((band) => [
      clampRatio(band.yRatio),
      insetForRatio(depth, band.depthRatio, maxZInset),
    ]),
  };
}

const coordinateMatchesRange = (
  value: number,
  range: V3ChannelCoordinateRange | undefined
): boolean => {
  if (range === undefined) return true;
  if (typeof range === 'number') return value === range;

  const [min, max] = range[0] <= range[1] ? range : [range[1], range[0]];
  return value >= min && value <= max;
};

export function appendV3InsetChannel(
  voxels: VoxelData[],
  options: V3InsetChannelOptions
): void {
  const { axis, fixed = {}, range, mode, color } = options;
  const fixedEntries = Object.entries(fixed) as [V3ChannelAxis, V3ChannelCoordinateRange][];
  const matchesChannel = (voxel: VoxelData): boolean =>
    coordinateMatchesRange(voxel[axis], range) &&
    fixedEntries.every(([fixedAxis, fixedRange]) => coordinateMatchesRange(voxel[fixedAxis], fixedRange));

  if (mode === 'remove') {
    for (let index = voxels.length - 1; index >= 0; index -= 1) {
      if (matchesChannel(voxels[index])) {
        voxels.splice(index, 1);
      }
    }
    return;
  }

  for (const voxel of voxels) {
    if (!matchesChannel(voxel)) continue;
    if (color !== undefined) {
      voxel.color = color;
    }
    if ('emissive' in options) {
      voxel.emissive = options.emissive;
    }
  }
}

export function appendV3VentPair(
  voxels: VoxelData[],
  { centerX, y, z, pairs, spacing = 1, color, emissive = false }: V3VentPairOptions
): void {
  const pairCount = Math.max(0, Math.floor(pairs));
  const ventSpacing = Math.max(1, Math.floor(spacing));

  for (let index = 0; index < pairCount; index += 1) {
    const offset = ventSpacing * (index + 1);
    setV3Voxel(voxels, { x: centerX - offset, y, z, color, emissive });
    setV3Voxel(voxels, { x: centerX + offset, y, z, color, emissive });
  }
}

export function appendV3SegmentedBand(
  voxels: VoxelData[],
  { origin, dimensions, axis, segmentLength, gapLength = 1, color, emissive = false }: V3SegmentedBandOptions
): void {
  const [originX, originY, originZ] = origin;
  const [width, height, depth] = dimensions;
  const activeLength = Math.max(1, Math.floor(segmentLength));
  const inactiveLength = Math.max(0, Math.floor(gapLength));
  const cycleLength = activeLength + inactiveLength;

  for (let xIndex = 0; xIndex < width; xIndex += 1) {
    for (let yIndex = 0; yIndex < height; yIndex += 1) {
      const bandIndex = axis === 'x' ? xIndex : yIndex;
      if (cycleLength > 0 && bandIndex % cycleLength >= activeLength) continue;

      for (let zIndex = 0; zIndex < depth; zIndex += 1) {
        setV3Voxel(voxels, {
          x: originX + xIndex,
          y: originY + yIndex,
          z: originZ + zIndex,
          color,
          emissive,
        });
      }
    }
  }
}
