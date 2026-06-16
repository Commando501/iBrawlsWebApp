import type {
  CharacterLoadout,
  SpartanColors,
  VoxelData,
} from '../VoxelModels';
import type { V3CharacterPartManifest } from './v3AssetManifest';
import {
  V3_AEGIS_SCULPT_PROFILES,
  appendV3ArmorPlate,
  appendV3CornerArmorTabs,
  appendV3MirroredArmorPlates,
  appendV3PanelStripe,
  createV3SculptedShell,
} from './v3ArmorSculpt';
import type { V3CharacterSlotId } from './v3ModelTypes';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
} from './v3PaintPalette';

export type V3BuiltinPartGridScale = 1 | 2;

export type V3AegisPartSpec = {
  segment: 'lowerTorso' | 'upperTorso' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
  dimensions: [number, number, number];
  position: [number, number, number];
};

type ReadonlyV3AegisPartSpec = {
  readonly segment: V3AegisPartSpec['segment'];
  readonly dimensions: readonly [number, number, number];
  readonly position: readonly [number, number, number];
};

export const V3_AEGIS_PART_SPECS: Readonly<Record<V3CharacterSlotId, ReadonlyV3AegisPartSpec>> = {
  helmet: { segment: 'head', dimensions: [9, 8, 8], position: [-0.22, 1.56, -0.19] },
  neck: { segment: 'upperTorso', dimensions: [6, 4, 6], position: [-0.16, 1.39, -0.15] },
  chest: { segment: 'upperTorso', dimensions: [16, 15, 11], position: [-0.42, 0.97, -0.27] },
  shoulderLeft: { segment: 'leftArm', dimensions: [7, 5, 8], position: [-0.64, 1.31, -0.18] },
  shoulderRight: { segment: 'rightArm', dimensions: [7, 5, 8], position: [0.27, 1.31, -0.18] },
  upperArmLeft: { segment: 'leftArm', dimensions: [5, 9, 5], position: [-0.58, 0.95, -0.12] },
  upperArmRight: { segment: 'rightArm', dimensions: [5, 9, 5], position: [0.31, 0.95, -0.12] },
  forearmLeft: { segment: 'leftArm', dimensions: [5, 9, 5], position: [-0.58, 0.54, -0.12] },
  forearmRight: { segment: 'rightArm', dimensions: [5, 9, 5], position: [0.31, 0.54, -0.12] },
  handLeft: { segment: 'leftArm', dimensions: [4, 4, 4], position: [-0.55, 0.3, -0.1] },
  handRight: { segment: 'rightArm', dimensions: [4, 4, 4], position: [0.34, 0.3, -0.1] },
  pelvis: { segment: 'lowerTorso', dimensions: [12, 6, 8], position: [-0.31, 0.78, -0.19] },
  thighLeft: { segment: 'leftLeg', dimensions: [6, 10, 6], position: [-0.32, 0.38, -0.14] },
  thighRight: { segment: 'rightLeg', dimensions: [6, 10, 6], position: [0.04, 0.38, -0.14] },
  shinLeft: { segment: 'leftLeg', dimensions: [6, 10, 6], position: [-0.32, 0.0, -0.14] },
  shinRight: { segment: 'rightLeg', dimensions: [6, 10, 6], position: [0.04, 0.0, -0.14] },
  footLeft: { segment: 'leftLeg', dimensions: [7, 3, 9], position: [-0.34, -0.04, -0.1] },
  footRight: { segment: 'rightLeg', dimensions: [7, 3, 9], position: [0.02, -0.04, -0.1] },
  back: { segment: 'upperTorso', dimensions: [8, 12, 4], position: [-0.2, 1.04, -0.44] },
};

export function getV3BuiltinPartGridScale(slot: V3CharacterSlotId): V3BuiltinPartGridScale {
  void slot;
  return 2;
}

export const scaleV3Dimensions = (
  dimensions: [number, number, number],
  gridScale: V3BuiltinPartGridScale
): [number, number, number] => [
  dimensions[0] * gridScale,
  dimensions[1] * gridScale,
  dimensions[2] * gridScale,
];

export function getV3AegisPartSpec(slot: V3CharacterSlotId): V3AegisPartSpec {
  const spec = V3_AEGIS_PART_SPECS[slot];
  return {
    segment: spec.segment,
    dimensions: [...spec.dimensions],
    position: [...spec.position],
  };
}

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

const V3_BASE_CORE_SHRINK: Partial<Record<V3CharacterSlotId, [number, number, number]>> = {
  neck: [0.17, 0, 0.17],
  chest: [0.16, 0.03, 0.25],
  shoulderLeft: [0.14, 0, 0.18],
  shoulderRight: [0.14, 0, 0.18],
  upperArmLeft: [0.2, 0, 0.2],
  upperArmRight: [0.2, 0, 0.2],
  forearmLeft: [0.2, 0, 0.2],
  forearmRight: [0.2, 0, 0.2],
  handLeft: [0.25, 0, 0.25],
  handRight: [0.25, 0, 0.25],
  pelvis: [0.17, 0, 0.13],
  thighLeft: [0.17, 0, 0.17],
  thighRight: [0.17, 0, 0.17],
  shinLeft: [0.17, 0, 0.17],
  shinRight: [0.17, 0, 0.17],
  footLeft: [0.14, 0, 0.12],
  footRight: [0.14, 0, 0.12],
  back: [0.18, 0.04, 0.25],
};

const V3_ARTICULATED_SLOTS_WITH_LOCAL_PANELS = new Set<V3CharacterSlotId>([
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'handLeft',
  'handRight',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
  'back',
]);

const shrinkV3Dimensions = (
  dimensions: [number, number, number],
  shrink: [number, number, number]
): { dimensions: [number, number, number]; offset: [number, number, number] } => {
  const nextDimensions = dimensions.map((size, axis) => {
    const inset = Math.max(0, Math.floor(size * shrink[axis]));
    return Math.max(2, size - inset * 2);
  }) as [number, number, number];
  const offset = dimensions.map((size, axis) => Math.floor((size - nextDimensions[axis]) / 2)) as [number, number, number];
  return { dimensions: nextDimensions, offset };
};

const translateV3Voxels = (
  voxels: VoxelData[],
  offset: [number, number, number]
): VoxelData[] => voxels.map((voxel) => ({
  ...voxel,
  x: voxel.x + offset[0],
  y: voxel.y + offset[1],
  z: voxel.z + offset[2],
}));

const createBasePartShell = (
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => {
  const shrink = V3_BASE_CORE_SHRINK[part.slot];
  const baseColor = roleColor(shrink ? 'undersuit' : part.paintRoles[0] ?? 'primary', colors, paintJob);
  if (!shrink) {
    return createV3SculptedShell({
      dimensions,
      profile: V3_AEGIS_SCULPT_PROFILES[part.slot],
      color: baseColor,
    });
  }

  const core = shrinkV3Dimensions(dimensions, shrink);
  return translateV3Voxels(createV3SculptedShell({
    dimensions: core.dimensions,
    profile: V3_AEGIS_SCULPT_PROFILES[part.slot],
    color: baseColor,
  }), core.offset);
};

const appendBoundedV3ArmorPlate = (
  voxels: VoxelData[],
  bounds: [number, number, number],
  origin: [number, number, number],
  plateDimensions: [number, number, number],
  color: string,
  emissive = false
): void => {
  const startX = Math.max(0, Math.min(bounds[0] - 1, origin[0]));
  const startY = Math.max(0, Math.min(bounds[1] - 1, origin[1]));
  const startZ = Math.max(0, Math.min(bounds[2] - 1, origin[2]));
  const endX = Math.max(startX, Math.min(bounds[0], origin[0] + plateDimensions[0]));
  const endY = Math.max(startY, Math.min(bounds[1], origin[1] + plateDimensions[1]));
  const endZ = Math.max(startZ, Math.min(bounds[2], origin[2] + plateDimensions[2]));

  if (endX <= startX || endY <= startY || endZ <= startZ) return;

  appendV3ArmorPlate(voxels, {
    origin: [startX, startY, startZ],
    dimensions: [endX - startX, endY - startY, endZ - startZ],
    color,
    emissive,
  });
};

const appendBoundedMirroredV3ArmorPlates = (
  voxels: VoxelData[],
  bounds: [number, number, number],
  origin: [number, number, number],
  plateDimensions: [number, number, number],
  color: string,
  emissive = false
): void => {
  appendBoundedV3ArmorPlate(voxels, bounds, origin, plateDimensions, color, emissive);
  const mirroredOriginX = bounds[0] - 1 - origin[0] - plateDimensions[0] + 1;
  if (mirroredOriginX === origin[0]) return;
  appendBoundedV3ArmorPlate(
    voxels,
    bounds,
    [mirroredOriginX, origin[1], origin[2]],
    plateDimensions,
    color,
    emissive
  );
};

const carveV3FaceGaps = (
  voxels: VoxelData[],
  color: string | undefined,
  predicate: (voxel: VoxelData) => boolean
): void => {
  for (let index = voxels.length - 1; index >= 0; index -= 1) {
    const voxel = voxels[index];
    if ((color === undefined || voxel.color === color) && predicate(voxel)) {
      voxels.splice(index, 1);
    }
  }
};

const carveAegisFidelityGaps = (
  voxels: VoxelData[],
  slot: V3CharacterSlotId,
  dimensions: [number, number, number],
  undersuitColor: string
): void => {
  const [width, height, depth] = dimensions;
  const occupiedFrontZ = voxels.length > 0 ? Math.max(...voxels.map((voxel) => voxel.z)) : Math.max(0, depth - 1);
  const interiorXStart = Math.max(1, Math.floor(width * 0.18));
  const interiorXEnd = Math.min(width - 2, Math.ceil(width * 0.82));
  const interiorYStart = Math.max(1, Math.floor(height * 0.16));
  const interiorYEnd = Math.min(height - 2, Math.ceil(height * 0.84));

  switch (slot) {
    case 'neck':
      carveV3FaceGaps(voxels, undefined, (voxel) =>
        voxel.z === occupiedFrontZ &&
        voxel.y >= 1 &&
        voxel.y <= height - 2 &&
        voxel.x >= 2 &&
        voxel.x <= width - 3 &&
        (voxel.x + voxel.y) % 3 === 0
      );
      break;
    case 'shoulderLeft':
    case 'shoulderRight':
      carveV3FaceGaps(voxels, undefined, (voxel) =>
        voxel.z === occupiedFrontZ &&
        voxel.y >= interiorYStart &&
        voxel.y <= interiorYEnd &&
        voxel.x >= interiorXStart &&
        voxel.x <= interiorXEnd &&
        (voxel.x + voxel.y) % 2 === 0
      );
      break;
    case 'footLeft':
    case 'footRight':
      carveV3FaceGaps(voxels, undefined, (voxel) =>
        voxel.z === occupiedFrontZ &&
        voxel.y >= 1 &&
        voxel.y <= height - 2 &&
        voxel.x >= interiorXStart &&
        voxel.x <= interiorXEnd &&
        voxel.x % 3 !== 1
      );
      break;
    case 'back':
      carveV3FaceGaps(voxels, undefined, (voxel) =>
        voxel.z === occupiedFrontZ &&
        voxel.y >= interiorYStart &&
        voxel.y <= interiorYEnd &&
        voxel.x >= interiorXStart &&
        voxel.x <= interiorXEnd &&
        (voxel.x + voxel.y) % 3 !== 1
      );
      break;
    default:
      break;
  }
};

const createAegisHelmetVoxels = (
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => {
  const voxels = createBasePartShell(part, dimensions, colors, paintJob);
  const [width, height, depth] = dimensions;
  const frontZ = Math.max(0, depth - 1);
  const mirrorMaxX = Math.max(0, width - 1);
  const visorY = Math.max(2, Math.floor(height * 0.44));
  const browY = Math.min(height - 2, visorY + 2);
  const crownY = Math.max(browY, height - 2);
  const jawY = Math.max(1, visorY - 5);
  const secondaryColor = roleColor('secondary', colors, paintJob);
  const accentColor = roleColor('accent', colors, paintJob);
  const visorColor = roleColor('visor', colors, paintJob);
  const fixedColor = roleColor('fixed', colors, paintJob);
  const emissiveColor = roleColor('emissive', colors, paintJob);

  appendV3MirroredArmorPlates(voxels, {
    origin: [2, Math.max(1, jawY + 2), frontZ],
    dimensions: [Math.max(1, Math.floor(width * 0.25)), Math.max(1, Math.floor(height * 0.28)), 1],
    mirrorMaxX,
    color: secondaryColor,
  });

  appendV3ArmorPlate(voxels, {
    origin: [1, visorY, frontZ],
    dimensions: [Math.max(1, width - 2), 1, 1],
    color: visorColor,
    emissive: roleEmissive('visor', paintJob, true),
  });
  appendV3ArmorPlate(voxels, {
    origin: [2, visorY + 1, frontZ],
    dimensions: [Math.max(1, width - 4), 1, 1],
    color: visorColor,
    emissive: roleEmissive('visor', paintJob, true),
  });
  appendV3ArmorPlate(voxels, {
    origin: [2, browY, frontZ],
    dimensions: [Math.max(1, width - 4), 1, 1],
    color: secondaryColor,
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [0, visorY, frontZ],
    dimensions: [1, Math.max(1, browY - visorY + 3), 1],
    mirrorMaxX,
    color: accentColor,
    emissive: roleEmissive('accent', paintJob, false),
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [3, jawY, frontZ],
    dimensions: [Math.max(2, Math.floor(width * 0.22)), 2, 1],
    mirrorMaxX,
    color: fixedColor,
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [5, Math.max(0, jawY - 1), frontZ],
    dimensions: [Math.max(1, Math.floor(width * 0.16)), 1, 1],
    mirrorMaxX,
    color: fixedColor,
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [3, crownY, Math.max(1, frontZ - 6)],
    dimensions: [Math.max(1, Math.floor(width * 0.12)), 1, Math.max(2, Math.floor(depth * 0.28))],
    mirrorMaxX,
    color: secondaryColor,
  });
  appendV3ArmorPlate(voxels, {
    origin: [Math.floor(width / 2), crownY, Math.max(1, frontZ - 5)],
    dimensions: [1, 1, Math.max(3, Math.floor(depth * 0.3))],
    color: secondaryColor,
  });
  appendV3ArmorPlate(voxels, {
    origin: [Math.floor(width / 2), browY, frontZ],
    dimensions: [1, 1, 1],
    color: emissiveColor,
    emissive: roleEmissive('emissive', paintJob, part.paintRoles.includes('emissive')),
  });

  return voxels;
};

const createAegisChestVoxels = (
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => {
  const voxels = createBasePartShell(part, dimensions, colors, paintJob);
  const [width, height, depth] = dimensions;
  const frontZ = Math.max(0, depth - 1);
  const mirrorMaxX = Math.max(0, width - 1);
  const secondaryColor = roleColor('secondary', colors, paintJob);
  const accentColor = roleColor('accent', colors, paintJob);
  const decalColor = roleColor('decal', colors, paintJob);
  const fixedColor = roleColor('fixed', colors, paintJob);
  const upperPlateY = Math.max(1, Math.floor(height * 0.6));
  const coreY = Math.max(1, Math.floor(height * 0.34));
  const abdomenY = Math.max(1, Math.floor(height * 0.3));
  const waistY = Math.max(1, Math.floor(height * 0.15));

  appendV3MirroredArmorPlates(voxels, {
    origin: [3, upperPlateY, frontZ],
    dimensions: [Math.max(4, Math.floor(width * 0.34)), Math.max(2, Math.floor(height * 0.12)), 1],
    mirrorMaxX,
    color: secondaryColor,
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [5, upperPlateY + Math.max(2, Math.floor(height * 0.1)), frontZ],
    dimensions: [Math.max(3, Math.floor(width * 0.23)), Math.max(1, Math.floor(height * 0.07)), 1],
    mirrorMaxX,
    color: secondaryColor,
  });
  appendV3ArmorPlate(voxels, {
    origin: [Math.floor(width / 2) - 1, coreY, frontZ],
    dimensions: [2, Math.max(3, height - coreY - 2), 1],
    color: decalColor,
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [3, waistY, frontZ],
    dimensions: [Math.max(4, Math.floor(width * 0.28)), Math.max(2, Math.floor(height * 0.08)), 1],
    mirrorMaxX,
    color: accentColor,
    emissive: roleEmissive('accent', paintJob, false),
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [5, waistY + Math.max(3, Math.floor(height * 0.12)), frontZ],
    dimensions: [Math.max(3, Math.floor(width * 0.22)), 1, 1],
    mirrorMaxX,
    color: accentColor,
    emissive: roleEmissive('accent', paintJob, false),
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [Math.max(1, Math.floor(width * 0.34)), abdomenY, frontZ],
    dimensions: [Math.max(2, Math.floor(width * 0.12)), Math.max(3, Math.floor(height * 0.2)), 1],
    mirrorMaxX,
    color: fixedColor,
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [0, Math.max(1, Math.floor(height * 0.34)), frontZ],
    dimensions: [1, Math.max(3, Math.floor(height * 0.14)), 1],
    mirrorMaxX,
    color: fixedColor,
  });
  appendV3ArmorPlate(voxels, {
    origin: [Math.floor(width / 2) - 1, height - 2, frontZ],
    dimensions: [2, 1, 1],
    color: fixedColor,
  });

  return voxels;
};

const createAegisDetailedPartVoxels = (
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => {
  const voxels = createBasePartShell(part, dimensions, colors, paintJob);
  const [width, height, depth] = dimensions;
  const frontZ = Math.max(0, depth - 1);
  const rearZ = 0;
  const centerX = Math.floor(width / 2);
  const isRightSlot = part.slot.endsWith('Right');
  const innerX = isRightSlot ? 0 : width - 1;
  const outerX = isRightSlot ? width - 1 : 0;
  const primaryColor = roleColor('primary', colors, paintJob);
  const secondaryColor = roleColor('secondary', colors, paintJob);
  const accentColor = roleColor('accent', colors, paintJob);
  const undersuitColor = roleColor('undersuit', colors, paintJob);
  const decalColor = roleColor('decal', colors, paintJob);
  const fixedColor = roleColor('fixed', colors, paintJob);
  const emissiveColor = roleColor('emissive', colors, paintJob);

  switch (part.slot) {
    case 'neck': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, height - 4, frontZ], [width - 4, 2, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [1, 2, frontZ], [width - 2, 1, 1], secondaryColor);
      appendBoundedMirroredV3ArmorPlates(voxels, dimensions, [0, 1, frontZ - 2], [1, height - 2, 3], fixedColor);
      break;
    }
    case 'shoulderLeft':
    case 'shoulderRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, height - 4, frontZ], [width - 4, 3, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [1, height - 6, frontZ - 4], [width - 2, 3, 5], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX, 2, frontZ - 5], [1, height - 3, 6], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 0 : width - 2, 4, frontZ - 1], [2, 3, 1], accentColor);
      break;
    }
    case 'upperArmLeft':
    case 'upperArmRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, height - 5, frontZ], [width - 4, 3, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, Math.floor(height * 0.45), frontZ], [width - 4, 1, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 0 : width - 1, height - 7, frontZ - 2], [1, 4, 3], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [innerX, 3, 2], [1, height - 6, depth - 4], undersuitColor);
      break;
    }
    case 'forearmLeft':
    case 'forearmRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [1, 1, frontZ], [width - 2, 4, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, 6, frontZ], [2, height - 8, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 0 : width - 1, 4, frontZ - 2], [1, height - 9, 3], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [innerX, 3, 2], [1, height - 6, depth - 4], undersuitColor);
      break;
    }
    case 'handLeft':
    case 'handRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, height - 4, frontZ], [width - 4, 2, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [1, 1, frontZ], [width - 2, 1, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 1 : width - 2, 2, frontZ - 1], [1, 2, 2], fixedColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [innerX, 1, 1], [1, height - 2, depth - 2], undersuitColor);
      break;
    }
    case 'pelvis': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, height - 4, frontZ], [width - 4, 2, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, height - 5, frontZ], [2, 3, 1], decalColor);
      appendBoundedMirroredV3ArmorPlates(voxels, dimensions, [1, height - 6, frontZ], [4, 3, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 2, 1, frontZ], [4, 4, 1], undersuitColor);
      break;
    }
    case 'thighLeft':
    case 'thighRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, 8, frontZ], [width - 4, 8, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, height - 6, frontZ], [2, 4, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 0 : width - 1, 6, frontZ - 2], [1, height - 10, 3], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [innerX, 4, 2], [1, height - 8, depth - 4], undersuitColor);
      break;
    }
    case 'shinLeft':
    case 'shinRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, 6, frontZ], [2, height - 8, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, height - 5, frontZ], [width - 4, 3, 1], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 0 : width - 1, 5, frontZ - 2], [1, height - 10, 3], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [innerX, 3, 2], [1, height - 7, depth - 4], undersuitColor);
      break;
    }
    case 'footLeft':
    case 'footRight': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, 2, frontZ - 1], [width - 4, 3, 2], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [1, 0, 1], [width - 2, 2, depth - 2], accentColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [outerX === 0 ? 0 : width - 2, 1, frontZ - 4], [2, 3, 4], fixedColor);
      break;
    }
    case 'back': {
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, 4, rearZ], [2, height - 8, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [width - 4, 4, rearZ], [2, height - 8, 1], secondaryColor);
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, height - 8, rearZ], [2, 4, 1], emissiveColor, roleEmissive('emissive', paintJob, true));
      appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, 6, rearZ], [2, height - 14, 1], emissiveColor, roleEmissive('emissive', paintJob, true));
      appendBoundedMirroredV3ArmorPlates(voxels, dimensions, [3, 2, rearZ], [3, 4, 2], fixedColor);
      break;
    }
    default:
      appendBoundedV3ArmorPlate(voxels, dimensions, [2, Math.floor(height / 2), frontZ], [Math.max(1, width - 4), 1, 1], primaryColor);
      break;
  }

  if (!V3_ARTICULATED_SLOTS_WITH_LOCAL_PANELS.has(part.slot)) {
    appendV3PanelStripe(voxels, { axis: 'x', fixedZ: frontZ, color: secondaryColor });
    appendV3PanelStripe(voxels, {
      axis: 'y',
      fixedZ: frontZ,
      color: accentColor,
      emissive: roleEmissive('accent', paintJob, part.paintRoles.includes('emissive')),
    });
    appendV3CornerArmorTabs(voxels, { dimensions, color: fixedColor });
  }

  carveAegisFidelityGaps(voxels, part.slot, dimensions, undersuitColor);

  if (part.slot === 'shoulderLeft' || part.slot === 'shoulderRight') {
    appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 1, height - 2, frontZ], [2, 1, 1], secondaryColor);
    appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 3, height - 1, frontZ], [6, 1, 1], secondaryColor);
    appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 2, height - 3, frontZ], [4, 1, 1], secondaryColor);
    appendBoundedV3ArmorPlate(voxels, dimensions, [centerX, height - 4, frontZ], [1, 1, 1], secondaryColor);
    appendBoundedV3ArmorPlate(voxels, dimensions, [centerX - 4, height - 1, frontZ], [1, 1, 1], secondaryColor);
  }

  return voxels;
};

export function createV3AegisPartVoxels(
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] {
  if (part.slot === 'helmet') {
    return createAegisHelmetVoxels(part, dimensions, colors, paintJob);
  }

  if (part.slot === 'chest') {
    return createAegisChestVoxels(part, dimensions, colors, paintJob);
  }

  return createAegisDetailedPartVoxels(part, dimensions, colors, paintJob);
}
