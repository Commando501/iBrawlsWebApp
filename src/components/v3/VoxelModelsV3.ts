import * as THREE from 'three';
import {
  createVoxelGroup,
  type CharacterLoadout,
  type SpartanColors,
  type VoxelData,
} from '../VoxelModels';
import {
  customArmorPieceToVoxels,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  validateCustomArmorPiece,
  type CustomArmorColors,
  type CustomArmorPieceSnapshot,
} from '../customArmor';
import {
  BUILT_IN_V3_CHARACTER_PARTS,
  getDefaultV3CharacterLoadout,
  getDefaultV3WeaponManifest,
  type V3CharacterPartManifest,
} from './v3AssetManifest';
import {
  V3_AEGIS_SCULPT_PROFILES,
  appendV3ArmorPlate,
  appendV3CornerArmorTabs,
  appendV3MirroredArmorPlates,
  appendV3PanelStripe,
  createV3SculptedShell,
} from './v3ArmorSculpt';
import { selectV3LodLevel } from './v3Lod';
import type { V3CharacterSlotId, V3WeaponId } from './v3ModelTypes';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
} from './v3PaintPalette';
import {
  normalizeV3ArmorRenderStyle,
  normalizeV3QualityTier,
  type V3RenderOptions,
} from './v3QualityTiers';
import {
  V3_DETAIL_BONE_NAMES,
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';
import {
  V3_ARMOR_SURFACE_BASE_VOXEL_SCALE,
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  createV3VoxelArmorGroup,
} from './v3VoxelArmorSurface';

export interface V3SpartanBuildOptions extends V3RenderOptions {
  isEnemy?: boolean;
  customHue?: number;
  loadout?: CharacterLoadout;
}

export interface V3WeaponBuildOptions extends V3RenderOptions {
  customHue?: number;
  loadout?: CharacterLoadout;
}

type V3PartSpec = {
  segment: 'lowerTorso' | 'upperTorso' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
  dimensions: [number, number, number];
  position: [number, number, number];
};

type V3BuiltinPartGridScale = 1 | 2;

const V3_WEAPON_SCALE = 0.06;

const V3_PART_SPECS: Record<V3CharacterSlotId, V3PartSpec> = {
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

const scaleV3Dimensions = (
  dimensions: [number, number, number],
  gridScale: V3BuiltinPartGridScale
): [number, number, number] => [
  dimensions[0] * gridScale,
  dimensions[1] * gridScale,
  dimensions[2] * gridScale,
];

const createColors = (isEnemy = false, customHue?: number): SpartanColors => ({
  primary: customHue !== undefined ? `hsl(${customHue}, 86%, 50%)` : isEnemy ? '#ef4444' : '#3b82f6',
  secondary: customHue !== undefined ? `hsl(${customHue}, 58%, 34%)` : isEnemy ? '#7f1d1d' : '#1e3a8a',
  visor: customHue !== undefined ? `hsl(${customHue}, 95%, 74%)` : '#facc15',
  accent: customHue !== undefined ? `hsl(${(customHue + 48) % 360}, 82%, 58%)` : '#22d3ee',
  dark: '#111827',
  highlight: customHue !== undefined ? `hsl(${customHue}, 72%, 68%)` : '#93c5fd',
});

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

const createCustomArmorColors = (
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): CustomArmorColors => ({
  primary: roleColor('primary', colors, paintJob),
  secondary: roleColor('secondary', colors, paintJob),
  accent: roleColor('accent', colors, paintJob),
  visor: roleColor('visor', colors, paintJob),
  dark: roleColor('undersuit', colors, paintJob),
  highlight: roleColor('emissive', colors, paintJob),
});

const addBox = (
  voxels: VoxelData[],
  dimensions: [number, number, number],
  color: string,
  emissive = false
) => {
  const [width, height, depth] = dimensions;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < depth; z++) {
        const isShell = x === 0 || y === 0 || z === 0 || x === width - 1 || y === height - 1 || z === depth - 1;
        if (isShell) {
          voxels.push({ x, y, z, color, emissive });
        }
      }
    }
  }
};

const addTranslatedBox = (
  voxels: VoxelData[],
  dimensions: [number, number, number],
  origin: [number, number, number],
  color: string,
  emissive = false
) => {
  const local: VoxelData[] = [];
  addBox(local, dimensions, color, emissive);
  for (const voxel of local) {
    voxels.push({
      x: voxel.x + origin[0],
      y: voxel.y + origin[1],
      z: voxel.z + origin[2],
      color: voxel.color,
      emissive: voxel.emissive,
    });
  }
};

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

  return voxels;
};

const createPartVoxels = (
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => {
  if (part.slot === 'helmet') {
    return createAegisHelmetVoxels(part, dimensions, colors, paintJob);
  }

  if (part.slot === 'chest') {
    return createAegisChestVoxels(part, dimensions, colors, paintJob);
  }

  return createAegisDetailedPartVoxels(part, dimensions, colors, paintJob);
};

export function getV3BuiltinPartVoxels(
  slot: V3CharacterSlotId,
  customHue?: number,
  paintJob?: CharacterLoadout['paintJob'],
  options: { gridScale?: V3BuiltinPartGridScale } = {}
): VoxelData[] {
  const part = BUILT_IN_V3_CHARACTER_PARTS.find((candidate) => candidate.slot === slot);
  if (!part) {
    throw new Error(`Missing built-in V3 part for ${slot}`);
  }
  const gridScale = options.gridScale ?? getV3BuiltinPartGridScale(slot);
  return createPartVoxels(
    part,
    scaleV3Dimensions(V3_PART_SPECS[slot].dimensions, gridScale),
    createColors(false, customHue),
    paintJob
  );
}

function getValidV3CustomPiece(
  loadout: CharacterLoadout | undefined,
  slot: V3CharacterSlotId
): CustomArmorPieceSnapshot | undefined {
  const piece = loadout?.customArmor?.[slot];
  if (!piece || piece.slot !== slot || getCustomArmorPieceModelSystem(piece) !== 'v3') return undefined;
  const validation = validateCustomArmorPiece(piece);
  return validation.valid ? piece : undefined;
}

const createSegmentGroups = (): Record<V3PartSpec['segment'], THREE.Group> => ({
  lowerTorso: new THREE.Group(),
  upperTorso: new THREE.Group(),
  head: new THREE.Group(),
  leftArm: new THREE.Group(),
  rightArm: new THREE.Group(),
  leftLeg: new THREE.Group(),
  rightLeg: new THREE.Group(),
});

type V3DetailBoneMap = Record<V3DetailBoneName, THREE.Group>;

const subtractVec3Tuple = (
  value: THREE.Vector3Tuple,
  offset: THREE.Vector3Tuple
): THREE.Vector3Tuple => [
  value[0] - offset[0],
  value[1] - offset[1],
  value[2] - offset[2],
];

const createV3DetailBones = (
  segmentGroups: Record<V3PartSpec['segment'], THREE.Group>
): V3DetailBoneMap => {
  const bones = {} as V3DetailBoneMap;

  for (const boneName of V3_DETAIL_BONE_NAMES) {
    const spec = V3_DETAIL_BONE_SPECS[boneName];
    const bone = new THREE.Group();
    bone.name = `v3bone:${boneName}`;
    bone.userData.v3DetailBoneName = boneName;
    bone.userData.v3ReferenceBoneName = spec.referenceBone;
    bone.userData.v3ReferencePosition = [...spec.position];

    const parent = spec.parent ? bones[spec.parent] : segmentGroups[spec.segment];
    const parentPosition = spec.parent
      ? V3_DETAIL_BONE_SPECS[spec.parent].position
      : [0, 0, 0] as THREE.Vector3Tuple;

    bone.position.fromArray(subtractVec3Tuple(spec.position, parentPosition));
    parent.add(bone);
    bones[boneName] = bone;
  }

  return bones;
};

const getV3PartLocalPosition = (
  slot: V3CharacterSlotId,
  spec: V3PartSpec
): THREE.Vector3Tuple => {
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  return subtractVec3Tuple(spec.position, V3_DETAIL_BONE_SPECS[boneName].position);
};

export function buildV3SpartanModel(options: V3SpartanBuildOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'v3SpartanRoot';
  root.userData.modelSystem = 'v3';

  const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
  const v3ArmorRenderStyle = normalizeV3ArmorRenderStyle(options.v3ArmorRenderStyle);
  const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
  const loadout = getDefaultV3CharacterLoadout();
  const colors = createColors(options.isEnemy, options.customHue);
  const paintJob = options.loadout?.paintJob;
  const customArmorColors = createCustomArmorColors(colors, paintJob);
  const segmentGroups = createSegmentGroups();
  const detailBones = createV3DetailBones(segmentGroups);
  const partGroups: Partial<Record<V3CharacterSlotId, THREE.Group>> = {};

  for (const [segmentName, segment] of Object.entries(segmentGroups)) {
    segment.name = `v3:${segmentName}`;
    root.add(segment);
  }

  for (const part of BUILT_IN_V3_CHARACTER_PARTS) {
    const spec = V3_PART_SPECS[part.slot];
    const customPiece = getValidV3CustomPiece(options.loadout, part.slot);
    const gridScale = customPiece ? getCustomArmorGridScale(customPiece) : getV3BuiltinPartGridScale(part.slot);
    const voxels = customPiece
      ? customArmorPieceToVoxels(customPiece, customArmorColors)
      : createPartVoxels(part, scaleV3Dimensions(spec.dimensions, gridScale), colors, paintJob);
    const group = createV3VoxelArmorGroup(voxels, {
      ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
      voxelScale: V3_ARMOR_SURFACE_BASE_VOXEL_SCALE / gridScale,
      renderStyle: v3ArmorRenderStyle,
      qualityTier: v3QualityTier,
    });
    const selectedLod = selectV3LodLevel({
      lods: part.lods,
      qualityTier: v3QualityTier,
      distance: v3Distance,
    });
    group.name = `v3:${part.slot}`;
    group.position.set(...getV3PartLocalPosition(part.slot, spec));
    group.userData.v3PartId = part.id;
    group.userData.v3Slot = part.slot;
    group.userData.v3BoundsId = part.boundsId;
    group.userData.v3QualityTier = v3QualityTier;
    group.userData.v3Distance = v3Distance;
    group.userData.v3SelectedLod = selectedLod;
    group.userData.v3GridScale = gridScale;
    if (customPiece) {
      group.userData.customArmorId = customPiece.id;
      group.userData.customArmorName = customPiece.name;
      group.userData.customArmorGridScale = gridScale;
    }
    detailBones[V3_SLOT_DETAIL_BONES[part.slot]].add(group);
    partGroups[part.slot] = group;
  }

  root.userData.v3CharacterLoadout = loadout;
  root.userData.v3QualityTier = v3QualityTier;
  root.userData.v3Distance = v3Distance;
  root.userData.v3ArmorRenderStyle = v3ArmorRenderStyle;
  root.userData.v3PartGroups = partGroups;
  root.userData.v3DetailBones = detailBones;
  root.userData.segmentGroups = segmentGroups;
  root.userData.lowerTorso = segmentGroups.lowerTorso;
  root.userData.upperTorso = detailBones.chest;
  root.userData.head = detailBones.head;
  root.userData.leftArm = detailBones.upperArmLeft;
  root.userData.rightArm = detailBones.upperArmRight;
  root.userData.leftLeg = detailBones.thighLeft;
  root.userData.rightLeg = detailBones.thighRight;
  root.userData.pelvis = detailBones.pelvis;
  root.userData.spine1 = detailBones.spine1;
  root.userData.spine2 = detailBones.spine2;
  root.userData.spine3 = detailBones.spine3;
  root.userData.chest = detailBones.chest;
  root.userData.neck = detailBones.neck;
  root.userData.backpack = detailBones.backpack;
  root.userData.handLeft = detailBones.handLeft;
  root.userData.handRight = detailBones.handRight;
  root.userData.hand_l = detailBones.handLeft;
  root.userData.hand_r = detailBones.handRight;
  root.userData.v3AttachmentOffsets = {
    thirdPersonWeaponGrip: [0.08, -0.08, 0.02],
    thirdPersonOffhandGrip: [-0.08, -0.08, 0.02],
    rightHandGrip: [0.08, -0.08, 0.02],
    leftHandGrip: [-0.08, -0.08, 0.02],
  };

  return root;
}

export function getV3BuiltinWeaponVoxels(
  weapon: V3WeaponId,
  customHue?: number,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] {
  const colors = createColors(false, customHue);
  const voxels: VoxelData[] = [];
  if (weapon === 'hammer') {
    addTranslatedBox(voxels, [3, 22, 3], [0, 0, 0], roleColor('undersuit', colors, paintJob));
    addTranslatedBox(voxels, [7, 3, 5], [-2, -2, -1], roleColor('secondary', colors, paintJob));
    addTranslatedBox(voxels, [5, 2, 5], [-1, 5, -1], roleColor('accent', colors, paintJob));
    addTranslatedBox(voxels, [5, 2, 5], [-1, 11, -1], roleColor('accent', colors, paintJob));
    addTranslatedBox(voxels, [11, 5, 7], [-4, 18, -2], roleColor('primary', colors, paintJob));
    addTranslatedBox(voxels, [3, 7, 5], [-5, 17, -1], roleColor('fixed', colors, paintJob));
    addTranslatedBox(voxels, [3, 7, 5], [5, 17, -1], roleColor('fixed', colors, paintJob));
    for (let x = -3; x <= 5; x += 2) {
      voxels.push({ x, y: 22, z: 5, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
      voxels.push({ x, y: 18, z: 5, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
    }
    return voxels;
  }
  if (weapon === 'sword') {
    addBox(voxels, [3, 7, 3], roleColor('undersuit', colors, paintJob));
    addTranslatedBox(voxels, [8, 2, 3], [-3, 5, 0], roleColor('primary', colors, paintJob));
    for (let y = 7; y < 35; y++) {
      voxels.push({ x: 1, y, z: 1, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
      if (y % 2 === 0) {
        voxels.push({ x: 0, y, z: 1, color: roleColor('accent', colors, paintJob), emissive: roleEmissive('accent', paintJob, true) });
        voxels.push({ x: 2, y, z: 1, color: roleColor('accent', colors, paintJob), emissive: roleEmissive('accent', paintJob, true) });
      } else {
        voxels.push({ x: -1, y, z: 1, color: roleColor('secondary', colors, paintJob) });
        voxels.push({ x: 3, y, z: 1, color: roleColor('secondary', colors, paintJob) });
      }
    }
    voxels.push({ x: 1, y: 35, z: 1, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
    return voxels;
  }

  addTranslatedBox(voxels, [4, 5, 3], [1, 0, 1], roleColor('undersuit', colors, paintJob));
  addTranslatedBox(voxels, [8, 3, 3], [1, 4, 1], roleColor('primary', colors, paintJob));
  addTranslatedBox(voxels, [3, 5, 3], [0, 1, 1], roleColor('secondary', colors, paintJob));
  addTranslatedBox(voxels, [2, 2, 5], [7, 4, 0], roleColor('fixed', colors, paintJob));
  addTranslatedBox(voxels, [2, 1, 3], [3, 7, 1], roleColor('accent', colors, paintJob));
  voxels.push({ x: 8, y: 5, z: 2, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
  voxels.push({ x: 5, y: 6, z: 3, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
  return voxels;
}

export function buildV3WeaponModel(weapon: V3WeaponId, options: V3WeaponBuildOptions = {}): THREE.Group {
  const manifest = getDefaultV3WeaponManifest(weapon);
  const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
  const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
  const group = createVoxelGroup(getV3BuiltinWeaponVoxels(weapon, options.customHue, options.loadout?.paintJob), V3_WEAPON_SCALE);
  const selectedLod = selectV3LodLevel({
    lods: manifest.lods,
    qualityTier: v3QualityTier,
    distance: v3Distance,
  });

  group.name = `v3:${weapon}`;
  group.userData.modelSystem = 'v3';
  group.userData.weaponType = weapon;
  group.userData.v3ManifestId = manifest.id;
  group.userData.v3Sockets = manifest.sockets;
  group.userData.v3QualityTier = v3QualityTier;
  group.userData.v3Distance = v3Distance;
  group.userData.v3SelectedLod = selectedLod;

  return group;
}

export function buildV3HammerModel(customHue?: number, v3Options: V3WeaponBuildOptions = {}): THREE.Group {
  return buildV3WeaponModel('hammer', { customHue, ...v3Options });
}

export function buildV3SwordModel(customHue?: number, v3Options: V3WeaponBuildOptions = {}): THREE.Group {
  return buildV3WeaponModel('sword', { customHue, ...v3Options });
}

export function buildV3PistolModel(customHue?: number, v3Options: V3WeaponBuildOptions = {}): THREE.Group {
  return buildV3WeaponModel('pistol', { customHue, ...v3Options });
}
