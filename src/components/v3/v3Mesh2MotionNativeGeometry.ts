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
  appendV3ProjectedPanelZone,
  appendV3ReferenceVentSet,
  carveV3NotchedSeam,
  createV3SculptedShell,
  type V3SculptProfile,
} from './v3ArmorSculpt';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import type { V3CharacterSlotId, V3QualityTier } from './v3ModelTypes';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
} from './v3PaintPalette';
import type { V3SourceFidelity } from './v3QualityTiers';

export const V3_MESH2MOTION_NATIVE_VOXEL_SCALE = 0.055;
export const V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER = 3;
export const V3_MESH2MOTION_NATIVE_RENDER_VOXEL_SCALE =
  V3_MESH2MOTION_NATIVE_VOXEL_SCALE / V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER;

export type V3NativeVoxelDimensions = [number, number, number];

export interface V3Mesh2MotionNativeGeometryOptions {
  qualityTier?: V3QualityTier;
  sourceFidelity?: V3SourceFidelity;
}

const ROLE_BY_SLOT: Record<V3CharacterSlotId, string> = {
  helmet: 'primary',
  neck: 'undersuit',
  chest: 'undersuit',
  shoulderLeft: 'primary',
  shoulderRight: 'primary',
  upperArmLeft: 'undersuit',
  upperArmRight: 'undersuit',
  forearmLeft: 'undersuit',
  forearmRight: 'undersuit',
  handLeft: 'undersuit',
  handRight: 'undersuit',
  pelvis: 'undersuit',
  thighLeft: 'undersuit',
  thighRight: 'undersuit',
  shinLeft: 'undersuit',
  shinRight: 'undersuit',
  footLeft: 'undersuit',
  footRight: 'undersuit',
  back: 'secondary',
};

const MIRROR_TARGETS: Partial<Record<V3CharacterSlotId, V3CharacterSlotId>> = {
  shoulderLeft: 'shoulderRight',
  upperArmLeft: 'upperArmRight',
  forearmLeft: 'forearmRight',
  handLeft: 'handRight',
  thighLeft: 'thighRight',
  shinLeft: 'shinRight',
  footLeft: 'footRight',
};

const FRONT_COLUMN_BREAK_SLOTS = new Set<V3CharacterSlotId>([
  'upperArmLeft',
  'forearmLeft',
  'thighLeft',
  'shinLeft',
]);

const roleColor = (
  role: string,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): string => resolveV3RoleColor(role, colors, paintJob);

const roleEmissive = (
  role: string,
  paintJob: CharacterLoadout['paintJob'] | undefined,
  fallback = false
): boolean => resolveV3RoleEmissive(role, paintJob, fallback);

const slotDimensions = (slot: V3CharacterSlotId): V3NativeVoxelDimensions => {
  const dimensions = V3_MESH2MOTION_ARMOR_RIG.slots[slot].localVoxelGridDimensions;
  return [
    Math.max(2, Math.round(dimensions[0] * V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER)),
    Math.max(2, Math.round(dimensions[1] * V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER)),
    Math.max(2, Math.round(dimensions[2] * V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER)),
  ];
};

export function getV3Mesh2MotionNativeSlotDimensions(slot: V3CharacterSlotId): V3NativeVoxelDimensions {
  return slotDimensions(slot);
}

export function getV3Mesh2MotionNativeVoxelPivot(slot: V3CharacterSlotId): [number, number, number] {
  const [width, height, depth] = slotDimensions(slot);
  return [
    (width - 1) / 2,
    (height - 1) / 2,
    (depth - 1) / 2,
  ];
}

export function getV3Mesh2MotionNativeMirrorPartner(slot: V3CharacterSlotId): V3CharacterSlotId | null {
  return V3_MESH2MOTION_ARMOR_RIG.slots[slot].mirrorOf
    ?? MIRROR_TARGETS[slot]
    ?? null;
}

const bounded = (value: number, size: number): number =>
  Math.max(0, Math.min(size - 1, Math.round(value)));

const detailCells = (value: number): number =>
  Math.max(1, Math.round(value * V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER));

const scaleNativeSculptProfile = (profile: V3SculptProfile): V3SculptProfile => ({
  xInsets: profile.xInsets.map(([ratio, inset]) => [
    ratio,
    inset * V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER,
  ] as const),
  zInsets: profile.zInsets.map(([ratio, inset]) => [
    ratio,
    inset * V3_MESH2MOTION_NATIVE_DETAIL_MULTIPLIER,
  ] as const),
});

const setVoxel = (
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  voxel: VoxelData
): void => {
  const x = bounded(voxel.x, dimensions[0]);
  const y = bounded(voxel.y, dimensions[1]);
  const z = bounded(voxel.z, dimensions[2]);
  const existing = voxels.find((candidate) =>
    candidate.x === x && candidate.y === y && candidate.z === z
  );
  if (existing) {
    existing.color = voxel.color;
    existing.emissive = voxel.emissive;
    return;
  }
  voxels.push({
    x,
    y,
    z,
    color: voxel.color,
    emissive: voxel.emissive || undefined,
  });
};

const appendPlate = (
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  origin: V3NativeVoxelDimensions,
  size: V3NativeVoxelDimensions,
  color: string,
  emissive = false
): void => {
  for (let x = origin[0]; x < origin[0] + size[0]; x += 1) {
    for (let y = origin[1]; y < origin[1] + size[1]; y += 1) {
      for (let z = origin[2]; z < origin[2] + size[2]; z += 1) {
        setVoxel(voxels, dimensions, { x, y, z, color, emissive });
      }
    }
  }
};

const finalizeVoxels = (
  voxels: readonly VoxelData[],
  dimensions: V3NativeVoxelDimensions
): VoxelData[] => {
  const byCoord = new Map<string, VoxelData>();
  for (const voxel of voxels) {
    if (!Number.isFinite(voxel.x) || !Number.isFinite(voxel.y) || !Number.isFinite(voxel.z)) continue;
    const x = bounded(voxel.x, dimensions[0]);
    const y = bounded(voxel.y, dimensions[1]);
    const z = bounded(voxel.z, dimensions[2]);
    byCoord.set(`${x}:${y}:${z}`, {
      x,
      y,
      z,
      color: voxel.color,
      emissive: voxel.emissive || undefined,
    });
  }
  return [...byCoord.values()].sort((left, right) => (
    left.y - right.y ||
    left.z - right.z ||
    left.x - right.x ||
    left.color.localeCompare(right.color) ||
    Number(left.emissive === true) - Number(right.emissive === true)
  ));
};

const mirrorVoxelsX = (
  voxels: readonly VoxelData[],
  dimensions: V3NativeVoxelDimensions
): VoxelData[] => finalizeVoxels(voxels.map((voxel) => ({
  ...voxel,
  x: dimensions[0] - 1 - voxel.x,
})), dimensions);

const createNativeShell = (
  slot: V3CharacterSlotId,
  dimensions: V3NativeVoxelDimensions,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => createV3SculptedShell({
  dimensions,
  profile: scaleNativeSculptProfile(V3_AEGIS_SCULPT_PROFILES[slot]),
  color: roleColor(ROLE_BY_SLOT[slot], colors, paintJob),
});

const carveFrontCenter = (
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  yMin: number,
  yMax: number
): void => {
  const centerX = Math.floor(dimensions[0] / 2);
  const frontZ = dimensions[2] - 1;
  for (let index = voxels.length - 1; index >= 0; index -= 1) {
    const voxel = voxels[index];
    if (
      voxel.z === frontZ &&
      voxel.y >= yMin &&
      voxel.y <= yMax &&
      Math.abs(voxel.x - centerX) <= 1
    ) {
      voxels.splice(index, 1);
    }
  }
};

const addHelmetStyle = (
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): void => {
  const [width, height, depth] = dimensions;
  const frontZ = depth - 1;
  const visorColor = roleColor('visor', colors, paintJob);
  const secondary = roleColor('secondary', colors, paintJob);
  const fixed = roleColor('fixed', colors, paintJob);
  const emissive = roleColor('emissive', colors, paintJob);
  const visorY = Math.max(2, Math.floor(height * 0.43));
  appendV3ProjectedPanelZone(voxels, {
    dimensions,
    zone: { xMinRatio: 0.16, xMaxRatio: 0.84, yMinRatio: 0.42, yMaxRatio: 0.62 },
    z: frontZ,
    color: visorColor,
    emissive: roleEmissive('visor', paintJob, true),
  });
  appendV3MirroredArmorPlates(voxels, {
    origin: [1, Math.max(1, visorY - 2), frontZ],
    dimensions: [Math.max(1, Math.floor(width * 0.18)), 2, 1],
    mirrorMaxX: width - 1,
    color: secondary,
  });
  appendV3ArmorPlate(voxels, {
    origin: [Math.max(1, Math.floor(width / 2) - 1), Math.max(1, visorY + 2), frontZ],
    dimensions: [2, 1, 1],
    color: fixed,
  });
  appendV3ArmorPlate(voxels, {
    origin: [Math.floor(width / 2), Math.min(height - 1, visorY + 3), Math.max(0, frontZ - 2)],
    dimensions: [1, 1, 2],
    color: emissive,
    emissive: roleEmissive('emissive', paintJob, true),
  });
  appendV3ReferenceVentSet(voxels, {
    dimensions,
    side: 'both',
    yRatio: 0.7,
    z: Math.max(0, frontZ - 2),
    count: 2,
    color: secondary,
  });
};

const addTorsoStyle = (
  slot: V3CharacterSlotId,
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): void => {
  const [width, height, depth] = dimensions;
  const frontZ = depth - 1;
  const centerX = Math.floor(width / 2);
  const secondary = roleColor('secondary', colors, paintJob);
  const accent = roleColor('accent', colors, paintJob);
  const decal = roleColor('decal', colors, paintJob);
  const fixed = roleColor('fixed', colors, paintJob);

  if (slot === 'chest') {
    carveFrontCenter(voxels, dimensions, Math.floor(height * 0.42), height - 1);
    appendPlate(voxels, dimensions, [1, Math.floor(height * 0.58), frontZ], [Math.max(2, centerX - 1), 2, 1], secondary);
    appendPlate(voxels, dimensions, [centerX + 1, Math.floor(height * 0.58), frontZ], [Math.max(2, width - centerX - 2), 2, 1], secondary);
    appendPlate(voxels, dimensions, [centerX, Math.floor(height * 0.22), frontZ], [1, Math.max(3, Math.floor(height * 0.45)), 1], decal);
    appendPlate(voxels, dimensions, [1, Math.floor(height * 0.14), frontZ], [width - 2, 2, 1], accent, roleEmissive('accent', paintJob));
    appendPlate(voxels, dimensions, [1, Math.floor(height * 0.36), Math.max(0, frontZ - 2)], [1, Math.max(3, Math.floor(height * 0.22)), 2], fixed);
    appendPlate(voxels, dimensions, [width - 2, Math.floor(height * 0.36), Math.max(0, frontZ - 2)], [1, Math.max(3, Math.floor(height * 0.22)), 2], fixed);
    for (let index = voxels.length - 1; index >= 0; index -= 1) {
      const voxel = voxels[index];
      if (
        voxel.z < detailCells(4) ||
        (voxel.z === frontZ && voxel.y > 1 && voxel.y < height - 1 && (voxel.x + voxel.y) % 3 === 0)
      ) {
        voxels.splice(index, 1);
      }
    }
    return;
  }

  if (slot === 'pelvis') {
    appendPlate(voxels, dimensions, [1, height - 3, frontZ], [width - 2, 2, 1], secondary);
    appendPlate(voxels, dimensions, [centerX - 1, 1, frontZ], [2, 4, 1], roleColor('undersuit', colors, paintJob));
    appendPlate(voxels, dimensions, [centerX, Math.floor(height * 0.45), frontZ], [1, 1, 1], decal);
    appendPlate(voxels, dimensions, [1, 1, 1], [2, Math.max(2, height - 3), 1], accent);
    appendPlate(voxels, dimensions, [width - 3, 1, 1], [2, Math.max(2, height - 3), 1], accent);
    return;
  }

  if (slot === 'back') {
    appendPlate(voxels, dimensions, [1, 2, 0], [2, Math.max(4, height - 4), 1], secondary);
    appendPlate(voxels, dimensions, [width - 3, 2, 0], [2, Math.max(4, height - 4), 1], secondary);
    appendPlate(voxels, dimensions, [centerX, 2, 0], [1, height - 4, 1], roleColor('emissive', colors, paintJob), roleEmissive('emissive', paintJob, true));
    for (let index = voxels.length - 1; index >= 0; index -= 1) {
      const voxel = voxels[index];
      if (voxel.z === frontZ && voxel.y > 1 && voxel.y < height - 1 && (voxel.x + voxel.y) % 3 === 0) {
        voxels.splice(index, 1);
      }
    }
  }
};

const addLimbStyle = (
  slot: V3CharacterSlotId,
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): void => {
  const [width, height, depth] = dimensions;
  const frontZ = depth - 1;
  const centerX = Math.floor(width / 2);
  const outerX = 0;
  const innerX = width - 1;
  const secondary = roleColor('secondary', colors, paintJob);
  const accent = roleColor('accent', colors, paintJob);
  const fixed = roleColor('fixed', colors, paintJob);
  const undersuit = roleColor('undersuit', colors, paintJob);
  const breakFrontColumns = (): void => {
    if (!FRONT_COLUMN_BREAK_SLOTS.has(slot)) return;
    for (let index = voxels.length - 1; index >= 0; index -= 1) {
      const voxel = voxels[index];
      if (
        voxel.z === frontZ &&
        voxel.y > 0 &&
        voxel.y < height - 1 &&
        (voxel.y % 3 === 1 || voxel.y === height - 3)
      ) {
        voxels.splice(index, 1);
      }
    }
  };

  if (slot === 'shoulderLeft') {
    appendPlate(voxels, dimensions, [1, height - 3, frontZ], [width - 2, 2, 1], secondary);
    appendPlate(voxels, dimensions, [outerX, 1, Math.max(0, frontZ - 3)], [1, height - 2, 3], accent);
    appendPlate(voxels, dimensions, [1, Math.max(1, height - 4), Math.max(0, frontZ - 2)], [width - 2, 2, 2], secondary);
    return;
  }

  if (slot === 'handLeft') {
    appendPlate(voxels, dimensions, [1, height - 2, frontZ], [width - 2, 1, 1], accent);
    appendPlate(voxels, dimensions, [1, 1, frontZ], [width - 2, 1, 1], fixed);
    appendPlate(voxels, dimensions, [innerX, 1, 1], [1, height - 2, depth - 2], undersuit);
    for (let index = voxels.length - 1; index >= 0; index -= 1) {
      const voxel = voxels[index];
      if (voxel.x < centerX - 1 || voxel.x > centerX) {
        voxels.splice(index, 1);
      }
    }
    return;
  }

  if (slot === 'footLeft') {
    appendPlate(voxels, dimensions, [1, 0, Math.max(0, frontZ - 5)], [width - 2, 2, 5], accent);
    appendPlate(voxels, dimensions, [1, 1, Math.max(0, frontZ - 2)], [width - 2, 2, 2], secondary);
    appendPlate(voxels, dimensions, [outerX, 1, Math.max(0, frontZ - 4)], [2, 2, 3], fixed);
    appendV3ProjectedPanelZone(voxels, {
      dimensions,
      zone: { xMinRatio: 0.24, xMaxRatio: 0.76, yMinRatio: 0.55, yMaxRatio: 1 },
      z: frontZ,
      color: secondary,
    });
    for (let index = voxels.length - 1; index >= 0; index -= 1) {
      const voxel = voxels[index];
      if (voxel.z === frontZ && voxel.y > 0 && (voxel.x + voxel.y) % 4 === 0) {
        voxels.splice(index, 1);
      }
    }
    return;
  }

  carveV3NotchedSeam(voxels, {
    dimensions,
    axis: 'y',
    positionRatio: 0.5,
    width: 1,
    z: frontZ,
    preserveEvery: 3,
  });
  appendPlate(voxels, dimensions, [Math.max(0, centerX - 1), 1, frontZ], [Math.min(2, width), Math.max(2, height - 2), 1], accent, roleEmissive('accent', paintJob));
  appendPlate(voxels, dimensions, [outerX, 2, Math.max(0, frontZ - 2)], [1, Math.max(2, height - 4), 2], secondary);
  appendPlate(voxels, dimensions, [innerX, 2, 1], [1, Math.max(2, height - 4), Math.max(1, depth - 2)], undersuit);
  if (slot === 'shinLeft') {
    appendPlate(voxels, dimensions, [Math.max(0, centerX - 1), height - 3, frontZ], [2, 2, 1], fixed);
  }
  breakFrontColumns();
};

const addNativeSlotStyle = (
  part: V3CharacterPartManifest,
  voxels: VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): void => {
  const slot = part.slot;
  const frontZ = dimensions[2] - 1;
  if (slot === 'helmet') {
    addHelmetStyle(voxels, dimensions, colors, paintJob);
  } else if (slot === 'chest' || slot === 'pelvis' || slot === 'back') {
    addTorsoStyle(slot, voxels, dimensions, colors, paintJob);
  } else if (
    slot === 'shoulderLeft' ||
    slot === 'upperArmLeft' ||
    slot === 'forearmLeft' ||
    slot === 'handLeft' ||
    slot === 'thighLeft' ||
    slot === 'shinLeft' ||
    slot === 'footLeft'
  ) {
    addLimbStyle(slot, voxels, dimensions, colors, paintJob);
  } else if (slot === 'neck') {
    appendV3PanelStripe(voxels, { axis: 'x', fixedZ: frontZ, color: roleColor('secondary', colors, paintJob) });
    appendV3CornerArmorTabs(voxels, { dimensions, color: roleColor('fixed', colors, paintJob) });
  } else {
    appendV3PanelStripe(voxels, { axis: 'x', fixedZ: frontZ, color: roleColor('secondary', colors, paintJob) });
    appendV3PanelStripe(voxels, { axis: 'y', fixedZ: frontZ, color: roleColor('accent', colors, paintJob), emissive: roleEmissive('accent', paintJob) });
  }
};

const canonicalPartForSlot = (
  part: V3CharacterPartManifest,
  slot: V3CharacterSlotId
): V3CharacterPartManifest => ({
  ...part,
  slot,
  boundsId: slot,
});

const NATIVE_RUNTIME_ROW_STRIDE_BY_TIER: Record<V3QualityTier, number> = {
  mobileLow: 4,
  mobile: 3,
  desktop: 2,
  ultra: 2,
};

const simplifyNativeVoxels = (
  voxels: readonly VoxelData[],
  dimensions: V3NativeVoxelDimensions,
  colors: SpartanColors,
  paintJob: CharacterLoadout['paintJob'] | undefined,
  options: V3Mesh2MotionNativeGeometryOptions
): VoxelData[] => {
  if (options.sourceFidelity !== 'runtimeLod') {
    return finalizeVoxels(voxels, dimensions);
  }

  const qualityTier = options.qualityTier ?? 'desktop';
  const rowStride = NATIVE_RUNTIME_ROW_STRIDE_BY_TIER[qualityTier] ?? NATIVE_RUNTIME_ROW_STRIDE_BY_TIER.desktop;
  const [, height] = dimensions;
  const priorityColors = new Set([
    roleColor('visor', colors, paintJob),
    roleColor('emissive', colors, paintJob),
  ]);
  const retained = voxels.filter((voxel) => (
    voxel.emissive === true ||
    priorityColors.has(voxel.color) ||
    voxel.y === 0 ||
    voxel.y === height - 1 ||
    voxel.y % rowStride === 0
  ));

  if (retained.length >= Math.min(8, voxels.length)) {
    return finalizeVoxels(retained, dimensions);
  }

  return finalizeVoxels(voxels.slice(0, Math.min(8, voxels.length)), dimensions);
};

export function createV3Mesh2MotionNativePartVoxels(
  part: V3CharacterPartManifest,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob'],
  options: V3Mesh2MotionNativeGeometryOptions = {}
): VoxelData[] {
  const placement = V3_MESH2MOTION_ARMOR_RIG.slots[part.slot];
  if (placement.mirrorOf) {
    const canonicalDimensions = slotDimensions(placement.mirrorOf);
    const mirrored = createV3Mesh2MotionNativePartVoxels(
      canonicalPartForSlot(part, placement.mirrorOf),
      colors,
      paintJob,
      options
    );
    return mirrorVoxelsX(mirrored, canonicalDimensions);
  }

  const dimensions = slotDimensions(part.slot);
  const voxels = createNativeShell(part.slot, dimensions, colors, paintJob);
  addNativeSlotStyle(part, voxels, dimensions, colors, paintJob);
  return simplifyNativeVoxels(voxels, dimensions, colors, paintJob, options);
}
