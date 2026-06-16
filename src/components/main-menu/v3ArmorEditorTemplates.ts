import {
  createCustomArmorPiece,
  createCustomArmorSnapshot,
  dedupeCustomArmorVoxels,
  getCustomArmorGridScale,
  getCustomArmorSlotLabel,
  validateCustomArmorPiece,
  type CustomArmorMaterialRole,
  type CustomArmorPieceSnapshot,
  type CustomArmorVoxel,
  type V3CustomArmorSlot,
} from '../customArmor';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';

export interface V3ArmorTemplateOptions {
  hue?: number;
  now?: number;
  name?: string;
}

const TEMPLATE_GRID_SCALE = 2;
const DEFAULT_TEMPLATE_HUE = 210;

interface AxisRange {
  min: number;
  max: number;
}

interface TemplateBounds {
  x: number;
  y: number;
  z: number;
}

type TemplateVoxelRole = CustomArmorMaterialRole;

export function getV3ArmorTemplateLabel(slot: V3CustomArmorSlot): string {
  return getCustomArmorSlotLabel(slot, 'v3');
}

function normalizeHue(hue: number | undefined): number {
  if (typeof hue !== 'number' || !Number.isFinite(hue)) return DEFAULT_TEMPLATE_HUE;
  return ((Math.round(hue) % 360) + 360) % 360;
}

function normalizeTimestamp(now: number | undefined): number {
  return typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs((2 * lightness) - 1)) * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = lightness - (chroma / 2);
  const [r1, g1, b1] = segment < 1
    ? [chroma, x, 0]
    : segment < 2
      ? [x, chroma, 0]
      : segment < 3
        ? [0, chroma, x]
        : segment < 4
          ? [0, x, chroma]
          : segment < 5
            ? [x, 0, chroma]
            : [chroma, 0, x];
  const toHex = (value: number) => Math.round((value + match) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function rangeBetween(size: number, startRatio: number, endRatio: number, minimumSize = 1): AxisRange {
  const clampedSize = Math.max(1, Math.floor(size));
  const start = Math.max(0, Math.min(1, startRatio));
  const end = Math.max(start, Math.min(1, endRatio));
  let min = Math.floor((clampedSize - 1) * start);
  let max = Math.ceil((clampedSize - 1) * end);
  if ((max - min + 1) < minimumSize) {
    const needed = minimumSize - (max - min + 1);
    min -= Math.floor(needed / 2);
    max += Math.ceil(needed / 2);
  }
  if (min < 0) {
    max -= min;
    min = 0;
  }
  if (max >= clampedSize) {
    min -= max - clampedSize + 1;
    max = clampedSize - 1;
  }
  return {
    min: Math.max(0, min),
    max: Math.min(clampedSize - 1, max),
  };
}

function rangeAround(size: number, centerRatio: number, widthRatio: number, minimumSize = 1): AxisRange {
  const clampedSize = Math.max(1, Math.floor(size));
  const width = Math.max(minimumSize, Math.round(clampedSize * widthRatio));
  const center = Math.round((clampedSize - 1) * Math.max(0, Math.min(1, centerRatio)));
  let min = center - Math.floor((width - 1) / 2);
  let max = min + width - 1;
  if (min < 0) {
    max -= min;
    min = 0;
  }
  if (max >= clampedSize) {
    min -= max - clampedSize + 1;
    max = clampedSize - 1;
  }
  return {
    min: Math.max(0, min),
    max: Math.min(clampedSize - 1, max),
  };
}

function addBox(
  voxels: CustomArmorVoxel[],
  bounds: TemplateBounds,
  xRange: AxisRange,
  yRange: AxisRange,
  zRange: AxisRange,
  role: TemplateVoxelRole,
  hue: number,
  emissive = false
): void {
  const color = role === 'fixed' ? hslToHex(hue, 0.75, 0.56) : undefined;
  const minX = Math.max(0, Math.min(bounds.x - 1, xRange.min));
  const maxX = Math.max(0, Math.min(bounds.x - 1, xRange.max));
  const minY = Math.max(0, Math.min(bounds.y - 1, yRange.min));
  const maxY = Math.max(0, Math.min(bounds.y - 1, yRange.max));
  const minZ = Math.max(0, Math.min(bounds.z - 1, zRange.min));
  const maxZ = Math.max(0, Math.min(bounds.z - 1, zRange.max));

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        voxels.push({
          x,
          y,
          z,
          role,
          color,
          emissive,
        });
      }
    }
  }
}

function getTemplateBounds(slot: V3CustomArmorSlot): TemplateBounds {
  const dimensions = getV3CharacterPartBounds(slot).maxDimensions;
  return {
    x: dimensions.x * TEMPLATE_GRID_SCALE,
    y: dimensions.y * TEMPLATE_GRID_SCALE,
    z: dimensions.z * TEMPLATE_GRID_SCALE,
  };
}

function buildHelmetVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const front = rangeAround(bounds.z, 0.25, 0.12, 1);
  const mid = rangeAround(bounds.z, 0.48, 0.16, 1);
  const rear = rangeAround(bounds.z, 0.72, 0.12, 1);
  const sideWidth = bounds.x >= 16 ? 0.2 : 0.24;
  const left = rangeBetween(bounds.x, 0.14, 0.14 + sideWidth, 2);
  const right = rangeBetween(bounds.x, 0.86 - sideWidth, 0.86, 2);
  const center = rangeAround(bounds.x, 0.5, 0.2, 2);
  const wide = rangeBetween(bounds.x, 0.22, 0.78, 4);
  const face = rangeAround(bounds.y, 0.48, 0.16, 2);
  const crown = rangeAround(bounds.y, 0.76, 0.16, 2);
  const shell = rangeBetween(bounds.y, 0.2, 0.82, 4);
  const lower = rangeAround(bounds.y, 0.24, 0.12, 1);

  addBox(voxels, bounds, left, shell, mid, 'primary', hue);
  addBox(voxels, bounds, right, shell, mid, 'primary', hue);
  addBox(voxels, bounds, center, shell, rear, 'secondary', hue);
  addBox(voxels, bounds, wide, crown, mid, 'accent', hue);
  addBox(voxels, bounds, wide, face, front, 'visor', hue, true);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.28, 0.72, 3), lower, rear, 'dark', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.14, 1), rangeAround(bounds.y, 0.88, 0.08, 1), mid, 'highlight', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.08, 1), crown, front, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildCollarVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const rear = rangeAround(bounds.z, 0.68, 0.2, 2);
  const front = rangeAround(bounds.z, 0.28, 0.14, 1);
  const low = rangeBetween(bounds.y, 0.12, 0.42, 2);
  const high = rangeBetween(bounds.y, 0.42, 0.82, 2);

  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.34, 2), high, rear, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.66, 0.82, 2), high, rear, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.28, 0.72, 3), low, rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.24, 0.42, 2), low, front, 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.58, 0.76, 2), low, front, 'accent', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.18, 1), high, front, 'highlight', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildChestVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const front = rangeAround(bounds.z, 0.26, 0.12, 2);
  const rear = rangeAround(bounds.z, 0.7, 0.1, 1);
  const upper = rangeBetween(bounds.y, 0.48, 0.86, 5);
  const lower = rangeBetween(bounds.y, 0.18, 0.52, 5);
  const leftChest = rangeBetween(bounds.x, 0.16, 0.43, 4);
  const rightChest = rangeBetween(bounds.x, 0.57, 0.84, 4);

  addBox(voxels, bounds, leftChest, upper, front, 'primary', hue);
  addBox(voxels, bounds, rightChest, upper, front, 'primary', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.12, 2), upper, front, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.22, 0.78, 5), lower, front, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.12, 0.88, 5), rangeAround(bounds.y, 0.78, 0.1, 2), front, 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.3, 0.7, 4), rangeAround(bounds.y, 0.34, 0.1, 2), front, 'highlight', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.16, 2), rangeBetween(bounds.y, 0.32, 0.7, 4), rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.08, 1), rangeAround(bounds.y, 0.62, 0.08, 1), front, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildShoulderVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const capY = rangeBetween(bounds.y, 0.42, 0.84, 4);
  const rimY = rangeAround(bounds.y, 0.32, 0.12, 1);
  const front = rangeAround(bounds.z, 0.3, 0.18, 2);
  const rear = rangeAround(bounds.z, 0.66, 0.16, 2);
  const centerX = rangeAround(bounds.x, 0.5, 0.42, 4);

  addBox(voxels, bounds, centerX, capY, front, 'primary', hue);
  addBox(voxels, bounds, centerX, capY, rear, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.38, 2), rangeBetween(bounds.y, 0.28, 0.66, 3), front, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.62, 0.82, 2), rangeBetween(bounds.y, 0.28, 0.66, 3), rear, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.24, 0.76, 3), rimY, rangeAround(bounds.z, 0.5, 0.42, 3), 'accent', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.16, 1), rangeAround(bounds.y, 0.86, 0.08, 1), rangeAround(bounds.z, 0.5, 0.16, 1), 'highlight', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildUpperArmVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const sleeve = rangeBetween(bounds.y, 0.18, 0.82, 6);
  const front = rangeAround(bounds.z, 0.26, 0.18, 2);
  const rear = rangeAround(bounds.z, 0.7, 0.14, 1);

  addBox(voxels, bounds, rangeAround(bounds.x, 0.46, 0.34, 3), sleeve, front, 'undersuit', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.56, 0.3, 3), sleeve, rear, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.36, 2), rangeBetween(bounds.y, 0.24, 0.76, 4), rangeAround(bounds.z, 0.5, 0.18, 2), 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.64, 0.82, 2), rangeBetween(bounds.y, 0.24, 0.76, 4), rangeAround(bounds.z, 0.5, 0.18, 2), 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.26, 0.74, 3), rangeAround(bounds.y, 0.76, 0.08, 1), rangeAround(bounds.z, 0.5, 0.36, 2), 'accent', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.12, 1), rangeAround(bounds.y, 0.5, 0.36, 3), front, 'highlight', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildForearmVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const lower = rangeBetween(bounds.y, 0.12, 0.58, 5);
  const upper = rangeBetween(bounds.y, 0.58, 0.86, 3);
  const front = rangeAround(bounds.z, 0.24, 0.2, 2);
  const rear = rangeAround(bounds.z, 0.72, 0.14, 1);

  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.82, 4), lower, front, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.28, 0.72, 3), upper, front, 'secondary', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.26, 2), lower, rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.16, 0.34, 2), rangeBetween(bounds.y, 0.18, 0.74, 4), rangeAround(bounds.z, 0.52, 0.16, 1), 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.66, 0.84, 2), rangeBetween(bounds.y, 0.18, 0.74, 4), rangeAround(bounds.z, 0.52, 0.16, 1), 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.28, 0.72, 3), rangeAround(bounds.y, 0.18, 0.08, 1), rangeAround(bounds.z, 0.48, 0.36, 2), 'highlight', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.12, 1), rangeAround(bounds.y, 0.48, 0.08, 1), front, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildHandVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const palm = rangeBetween(bounds.y, 0.18, 0.56, 3);
  const knuckle = rangeAround(bounds.y, 0.66, 0.16, 1);
  const cuff = rangeAround(bounds.y, 0.18, 0.12, 1);
  const front = rangeAround(bounds.z, 0.26, 0.22, 2);
  const mid = rangeAround(bounds.z, 0.5, 0.2, 2);

  addBox(voxels, bounds, rangeBetween(bounds.x, 0.24, 0.76, 3), palm, mid, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.42, 2), knuckle, front, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.58, 0.82, 2), knuckle, front, 'secondary', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.16, 1), rangeAround(bounds.y, 0.34, 0.12, 1), mid, 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.2, 0.8, 3), cuff, rangeAround(bounds.z, 0.62, 0.28, 2), 'accent', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.14, 1), knuckle, front, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildPelvisVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const front = rangeAround(bounds.z, 0.28, 0.16, 2);
  const rear = rangeAround(bounds.z, 0.7, 0.12, 1);
  const belt = rangeAround(bounds.y, 0.72, 0.14, 2);
  const lower = rangeBetween(bounds.y, 0.22, 0.58, 3);

  addBox(voxels, bounds, rangeBetween(bounds.x, 0.12, 0.88, 5), belt, front, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.38, 2), lower, front, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.62, 0.82, 2), lower, front, 'primary', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.18, 2), lower, front, 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.24, 0.76, 4), rangeAround(bounds.y, 0.42, 0.1, 1), rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.1, 1), belt, front, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildThighVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const upper = rangeBetween(bounds.y, 0.42, 0.86, 5);
  const lower = rangeBetween(bounds.y, 0.14, 0.5, 4);
  const front = rangeAround(bounds.z, 0.26, 0.18, 2);
  const rear = rangeAround(bounds.z, 0.72, 0.14, 1);

  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.82, 4), upper, front, 'secondary', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.34, 3), lower, front, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.34, 2), rangeBetween(bounds.y, 0.24, 0.76, 4), rangeAround(bounds.z, 0.52, 0.18, 2), 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.66, 0.82, 2), rangeBetween(bounds.y, 0.24, 0.76, 4), rangeAround(bounds.z, 0.52, 0.18, 2), 'accent', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.2, 2), upper, rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.3, 0.7, 3), rangeAround(bounds.y, 0.82, 0.08, 1), front, 'highlight', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildShinVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const tall = rangeBetween(bounds.y, 0.16, 0.82, 6);
  const knee = rangeAround(bounds.y, 0.8, 0.12, 2);
  const ankle = rangeAround(bounds.y, 0.16, 0.1, 1);
  const front = rangeAround(bounds.z, 0.24, 0.18, 2);
  const rear = rangeAround(bounds.z, 0.72, 0.12, 1);

  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.28, 3), tall, front, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.2, 0.8, 4), knee, front, 'accent', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.24, 0.76, 3), ankle, rangeAround(bounds.z, 0.5, 0.34, 2), 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.16, 0.32, 2), rangeBetween(bounds.y, 0.2, 0.72, 4), rangeAround(bounds.z, 0.52, 0.14, 1), 'highlight', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.68, 0.84, 2), rangeBetween(bounds.y, 0.2, 0.72, 4), rangeAround(bounds.z, 0.52, 0.14, 1), 'highlight', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.22, 2), rangeBetween(bounds.y, 0.26, 0.68, 4), rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.1, 1), rangeAround(bounds.y, 0.52, 0.08, 1), front, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildFootVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const sole = rangeAround(bounds.y, 0.16, 0.14, 1);
  const instep = rangeBetween(bounds.y, 0.3, 0.66, 3);
  const toe = rangeAround(bounds.z, 0.22, 0.24, 2);
  const heel = rangeAround(bounds.z, 0.76, 0.18, 2);
  const mid = rangeAround(bounds.z, 0.5, 0.28, 2);

  addBox(voxels, bounds, rangeBetween(bounds.x, 0.16, 0.84, 4), sole, rangeBetween(bounds.z, 0.18, 0.84, 5), 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.2, 0.8, 4), instep, toe, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.26, 0.74, 3), rangeAround(bounds.y, 0.46, 0.18, 2), mid, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.24, 0.76, 3), rangeBetween(bounds.y, 0.22, 0.48, 2), heel, 'accent', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.16, 1), rangeAround(bounds.y, 0.58, 0.1, 1), toe, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildBackVoxels(bounds: TemplateBounds, hue: number): CustomArmorVoxel[] {
  const voxels: CustomArmorVoxel[] = [];
  const rear = rangeAround(bounds.z, 0.74, 0.18, 2);
  const midZ = rangeAround(bounds.z, 0.52, 0.14, 1);
  const tall = rangeBetween(bounds.y, 0.18, 0.84, 6);
  const upper = rangeBetween(bounds.y, 0.56, 0.86, 3);
  const lower = rangeBetween(bounds.y, 0.18, 0.48, 3);

  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.32, 3), tall, rear, 'secondary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.18, 0.34, 2), upper, rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.66, 0.82, 2), upper, rear, 'undersuit', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.2, 0.38, 2), lower, midZ, 'primary', hue);
  addBox(voxels, bounds, rangeBetween(bounds.x, 0.62, 0.8, 2), lower, midZ, 'primary', hue);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.12, 1), rangeBetween(bounds.y, 0.34, 0.72, 3), rear, 'emissive', hue, true);
  addBox(voxels, bounds, rangeAround(bounds.x, 0.5, 0.1, 1), rangeAround(bounds.y, 0.84, 0.08, 1), rear, 'fixed', hue);

  return dedupeCustomArmorVoxels(voxels);
}

function buildV3ArmorTemplateVoxels(slot: V3CustomArmorSlot, hue: number): CustomArmorVoxel[] {
  const bounds = getTemplateBounds(slot);
  switch (slot) {
    case 'helmet':
      return buildHelmetVoxels(bounds, hue);
    case 'neck':
      return buildCollarVoxels(bounds, hue);
    case 'chest':
      return buildChestVoxels(bounds, hue);
    case 'shoulderLeft':
    case 'shoulderRight':
      return buildShoulderVoxels(bounds, hue);
    case 'upperArmLeft':
    case 'upperArmRight':
      return buildUpperArmVoxels(bounds, hue);
    case 'forearmLeft':
    case 'forearmRight':
      return buildForearmVoxels(bounds, hue);
    case 'handLeft':
    case 'handRight':
      return buildHandVoxels(bounds, hue);
    case 'pelvis':
      return buildPelvisVoxels(bounds, hue);
    case 'thighLeft':
    case 'thighRight':
      return buildThighVoxels(bounds, hue);
    case 'shinLeft':
    case 'shinRight':
      return buildShinVoxels(bounds, hue);
    case 'footLeft':
    case 'footRight':
      return buildFootVoxels(bounds, hue);
    case 'back':
      return buildBackVoxels(bounds, hue);
    default: {
      const exhaustive: never = slot;
      throw new Error(`Unsupported V3 template slot: ${exhaustive}`);
    }
  }
}

export function createV3ArmorTemplateDraft(
  slot: V3CustomArmorSlot,
  options: V3ArmorTemplateOptions = {}
): CustomArmorPieceSnapshot {
  const label = getV3ArmorTemplateLabel(slot);
  const name = options.name ?? `${label} Smart Start`;
  const now = normalizeTimestamp(options.now);
  const voxels = buildV3ArmorTemplateVoxels(slot, normalizeHue(options.hue));
  const piece = createCustomArmorPiece(
    slot,
    name,
    voxels,
    undefined,
    undefined,
    'v3',
    TEMPLATE_GRID_SCALE
  );
  const snapshot = createCustomArmorSnapshot({
    ...piece,
    id: `v3_template_${slot}_${now.toString(36)}`,
    name: piece.name,
    gridScale: TEMPLATE_GRID_SCALE,
    voxels,
    createdAt: now,
    updatedAt: now,
  });

  if (getCustomArmorGridScale(snapshot) !== TEMPLATE_GRID_SCALE) {
    throw new Error(`V3 template ${slot} did not preserve gridScale ${TEMPLATE_GRID_SCALE}.`);
  }

  const validation = validateCustomArmorPiece(snapshot);
  if (!validation.valid) {
    throw new Error(`V3 template ${slot} is invalid: ${validation.errors.join('; ')}`);
  }

  return snapshot;
}
