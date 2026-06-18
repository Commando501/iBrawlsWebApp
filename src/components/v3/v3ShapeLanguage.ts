import type { VoxelData } from '../VoxelModels';
import { getV3BuiltinPartVoxels } from './VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3ModelTypes';

export interface V3ShapeLanguageBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export interface V3ShapeLanguageRowSpanVariation {
  x: number;
  z: number;
}

export type V3ShapeLanguageIssueCode =
  | 'empty-payload'
  | 'torso-depth-ratio-high'
  | 'center-channel-filled'
  | 'front-slab-coverage-high'
  | 'crown-not-tapered'
  | 'limb-terminal-not-tapered'
  | 'full-height-front-column'
  | 'hand-not-smaller-than-bracer';

export interface V3ShapeLanguageIssue {
  code: V3ShapeLanguageIssueCode;
  message: string;
  value?: number;
  threshold?: number;
}

export interface V3ShapeLanguageReport {
  slot: V3CharacterSlotId;
  occupiedBounds: V3ShapeLanguageBounds;
  depthRatio: number;
  rowSpanVariation: V3ShapeLanguageRowSpanVariation;
  centerChannelFill: number;
  frontSlabCoverage: number;
  crownTaper: number;
  limbTaper: number;
  hasFullHeightFrontColumn: boolean;
  issues: V3ShapeLanguageIssue[];
}

type V3OccupiedVoxel = Pick<VoxelData, 'x' | 'y' | 'z'>;

const EMPTY_BOUNDS: V3ShapeLanguageBounds = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minZ: 0,
  maxZ: 0,
  sizeX: 0,
  sizeY: 0,
  sizeZ: 0,
};

const TORSO_DEPTH_RATIO_LIMITS = {
  chest: 0.58,
  back: 0.5,
} as const satisfies Partial<Record<V3CharacterSlotId, number>>;

const CHEST_CENTER_CHANNEL_FILL_LIMIT = 0.48;
const CHEST_FRONT_SLAB_COVERAGE_LIMIT = 0.52;
const HELMET_CROWN_TAPER_LIMIT = 0.82;
const ANKLE_TAPER_LIMIT = 1;
const HAND_BRACER_MIN_WIDTH_DELTA = 3;

const ANKLE_TAPER_SLOTS = new Set<V3CharacterSlotId>(['shinLeft', 'shinRight']);
const FRONT_COLUMN_LIMB_SLOTS = new Set<V3CharacterSlotId>([
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
]);

const keyForVoxel = ({ x, y, z }: V3OccupiedVoxel): string => `${x}:${y}:${z}`;

const getOccupiedVoxels = (voxels: readonly VoxelData[]): V3OccupiedVoxel[] => {
  const occupied: V3OccupiedVoxel[] = [];
  const seen = new Set<string>();

  for (const voxel of voxels) {
    if (!Number.isFinite(voxel.x) || !Number.isFinite(voxel.y) || !Number.isFinite(voxel.z)) continue;
    const key = keyForVoxel(voxel);
    if (seen.has(key)) continue;
    seen.add(key);
    occupied.push({ x: voxel.x, y: voxel.y, z: voxel.z });
  }

  return occupied;
};

const getBounds = (voxels: readonly V3OccupiedVoxel[]): V3ShapeLanguageBounds => {
  if (voxels.length === 0) {
    return { ...EMPTY_BOUNDS };
  }

  let minX = voxels[0].x;
  let maxX = voxels[0].x;
  let minY = voxels[0].y;
  let maxY = voxels[0].y;
  let minZ = voxels[0].z;
  let maxZ = voxels[0].z;

  for (const voxel of voxels) {
    minX = Math.min(minX, voxel.x);
    maxX = Math.max(maxX, voxel.x);
    minY = Math.min(minY, voxel.y);
    maxY = Math.max(maxY, voxel.y);
    minZ = Math.min(minZ, voxel.z);
    maxZ = Math.max(maxZ, voxel.z);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    sizeX: maxX - minX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: maxZ - minZ + 1,
  };
};

const groupByY = (voxels: readonly V3OccupiedVoxel[]): Map<number, V3OccupiedVoxel[]> => {
  const rows = new Map<number, V3OccupiedVoxel[]>();

  for (const voxel of voxels) {
    rows.set(voxel.y, [...(rows.get(voxel.y) ?? []), voxel]);
  }

  return rows;
};

const getSpan = (values: readonly number[]): number =>
  values.length === 0 ? 0 : Math.max(...values) - Math.min(...values) + 1;

const getRowSpanVariation = (rows: Map<number, V3OccupiedVoxel[]>): V3ShapeLanguageRowSpanVariation => {
  const xSpans = new Set<number>();
  const zSpans = new Set<number>();

  for (const row of rows.values()) {
    xSpans.add(getSpan(row.map((voxel) => voxel.x)));
    zSpans.add(getSpan(row.map((voxel) => voxel.z)));
  }

  return { x: xSpans.size, z: zSpans.size };
};

const getMaxRowXSpan = (rows: Map<number, V3OccupiedVoxel[]>, predicate: (y: number) => boolean): number => {
  let maxSpan = 0;

  for (const [y, row] of rows) {
    if (!predicate(y)) continue;
    maxSpan = Math.max(maxSpan, getSpan(row.map((voxel) => voxel.x)));
  }

  return maxSpan;
};

const getFrontSlabCoverage = (
  voxels: readonly V3OccupiedVoxel[],
  bounds: V3ShapeLanguageBounds
): number => {
  if (bounds.sizeX === 0 || bounds.sizeY === 0) return 0;
  const frontCount = voxels.filter((voxel) => voxel.z === bounds.maxZ).length;
  return frontCount / (bounds.sizeX * bounds.sizeY);
};

const getCenterChannelFill = (
  voxels: readonly V3OccupiedVoxel[],
  bounds: V3ShapeLanguageBounds
): number => {
  if (bounds.sizeX === 0 || bounds.sizeY === 0) return 0;

  const centerWidth = Math.max(2, Math.ceil(bounds.sizeX * 0.18));
  const startX = bounds.minX + Math.floor((bounds.sizeX - centerWidth) / 2);
  const endX = startX + centerWidth - 1;
  const startY = bounds.minY + Math.floor(bounds.sizeY * 0.55);
  const endY = bounds.maxY - Math.max(0, Math.floor(bounds.sizeY * 0.06));
  if (endY < startY) return 0;

  const occupied = new Set(voxels.map(keyForVoxel));
  let filledCells = 0;
  let totalCells = 0;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      totalCells += 1;
      if (occupied.has(`${x}:${y}:${bounds.maxZ}`)) {
        filledCells += 1;
      }
    }
  }

  return totalCells === 0 ? 0 : filledCells / totalCells;
};

const getCrownTaper = (rows: Map<number, V3OccupiedVoxel[]>, bounds: V3ShapeLanguageBounds): number => {
  const widestSpan = getMaxRowXSpan(rows, () => true);
  if (widestSpan === 0) return 0;

  const topBandHeight = Math.max(2, Math.ceil(bounds.sizeY * 0.12));
  const topStartY = bounds.maxY - topBandHeight + 1;
  const topSpan = getMaxRowXSpan(rows, (y) => y >= topStartY);
  return topSpan / widestSpan;
};

const getLimbTaper = (rows: Map<number, V3OccupiedVoxel[]>, bounds: V3ShapeLanguageBounds): number => {
  const widestSpan = getMaxRowXSpan(rows, () => true);
  if (widestSpan === 0) return 0;

  const terminalHeight = Math.max(2, Math.ceil(bounds.sizeY * 0.14));
  const terminalEndY = bounds.minY + terminalHeight - 1;
  const terminalSpan = getMaxRowXSpan(rows, (y) => y <= terminalEndY);
  return terminalSpan / widestSpan;
};

const hasFullHeightFrontColumn = (
  voxels: readonly V3OccupiedVoxel[],
  bounds: V3ShapeLanguageBounds
): boolean => {
  if (bounds.sizeY === 0) return false;

  const rowsByX = new Map<number, Set<number>>();
  for (const voxel of voxels) {
    if (voxel.z !== bounds.maxZ) continue;
    const rows = rowsByX.get(voxel.x) ?? new Set<number>();
    rows.add(voxel.y);
    rowsByX.set(voxel.x, rows);
  }

  const requiredRows = Math.max(4, bounds.sizeY - 3);
  return [...rowsByX.values()].some((rows) => rows.size >= requiredRows);
};

const createIssue = (
  code: V3ShapeLanguageIssueCode,
  message: string,
  value?: number,
  threshold?: number
): V3ShapeLanguageIssue => ({
  code,
  message,
  ...(value === undefined ? {} : { value }),
  ...(threshold === undefined ? {} : { threshold }),
});

export function analyzeV3ShapeLanguage(
  slot: V3CharacterSlotId,
  voxels: readonly VoxelData[]
): V3ShapeLanguageReport {
  const occupied = getOccupiedVoxels(voxels);
  const occupiedBounds = getBounds(occupied);
  const rows = groupByY(occupied);
  const depthRatio = occupiedBounds.sizeX === 0 ? 0 : occupiedBounds.sizeZ / occupiedBounds.sizeX;
  const rowSpanVariation = getRowSpanVariation(rows);
  const centerChannelFill = getCenterChannelFill(occupied, occupiedBounds);
  const frontSlabCoverage = getFrontSlabCoverage(occupied, occupiedBounds);
  const crownTaper = getCrownTaper(rows, occupiedBounds);
  const limbTaper = getLimbTaper(rows, occupiedBounds);
  const hasFrontColumn = hasFullHeightFrontColumn(occupied, occupiedBounds);
  const issues: V3ShapeLanguageIssue[] = [];

  if (occupied.length === 0) {
    issues.push(createIssue('empty-payload', `${slot} has no occupied voxels`));
  }

  const depthLimit = TORSO_DEPTH_RATIO_LIMITS[slot as keyof typeof TORSO_DEPTH_RATIO_LIMITS];
  if (depthLimit !== undefined && depthRatio > depthLimit) {
    issues.push(createIssue(
      'torso-depth-ratio-high',
      `${slot} depth ratio is too slab-like`,
      depthRatio,
      depthLimit
    ));
  }

  if (slot === 'chest' && centerChannelFill > CHEST_CENTER_CHANNEL_FILL_LIMIT) {
    issues.push(createIssue(
      'center-channel-filled',
      'chest pectoral center channel is over-filled',
      centerChannelFill,
      CHEST_CENTER_CHANNEL_FILL_LIMIT
    ));
  }

  if (slot === 'chest' && frontSlabCoverage > CHEST_FRONT_SLAB_COVERAGE_LIMIT) {
    issues.push(createIssue(
      'front-slab-coverage-high',
      'chest front face coverage is too slab-like',
      frontSlabCoverage,
      CHEST_FRONT_SLAB_COVERAGE_LIMIT
    ));
  }

  if (slot === 'helmet' && crownTaper > HELMET_CROWN_TAPER_LIMIT) {
    issues.push(createIssue(
      'crown-not-tapered',
      'helmet crown is not tapered enough against the widest row',
      crownTaper,
      HELMET_CROWN_TAPER_LIMIT
    ));
  }

  if (ANKLE_TAPER_SLOTS.has(slot) && limbTaper > ANKLE_TAPER_LIMIT) {
    issues.push(createIssue(
      'limb-terminal-not-tapered',
      `${slot} terminal rows are not tapered enough`,
      limbTaper,
      ANKLE_TAPER_LIMIT
    ));
  }

  if (FRONT_COLUMN_LIMB_SLOTS.has(slot) && hasFrontColumn) {
    issues.push(createIssue(
      'full-height-front-column',
      `${slot} has a near full-height front scaffolding column`
    ));
  }

  return {
    slot,
    occupiedBounds,
    depthRatio,
    rowSpanVariation,
    centerChannelFill,
    frontSlabCoverage,
    crownTaper,
    limbTaper,
    hasFullHeightFrontColumn: hasFrontColumn,
    issues,
  };
}

const appendHandBracerIssues = (
  reports: Record<V3CharacterSlotId, V3ShapeLanguageReport>,
  side: 'Left' | 'Right'
): void => {
  const handSlot = `hand${side}` as V3CharacterSlotId;
  const forearmSlot = `forearm${side}` as V3CharacterSlotId;
  const hand = reports[handSlot];
  const forearm = reports[forearmSlot];

  if (hand.occupiedBounds.sizeX <= forearm.occupiedBounds.sizeX - HAND_BRACER_MIN_WIDTH_DELTA) {
    return;
  }

  hand.issues.push(createIssue(
    'hand-not-smaller-than-bracer',
    `${handSlot} is not visibly smaller than ${forearmSlot}`,
    hand.occupiedBounds.sizeX,
    forearm.occupiedBounds.sizeX - HAND_BRACER_MIN_WIDTH_DELTA
  ));
};

export function analyzeV3BuiltInShapeLanguage(): Record<V3CharacterSlotId, V3ShapeLanguageReport> {
  const reports = {} as Record<V3CharacterSlotId, V3ShapeLanguageReport>;

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    reports[slot] = analyzeV3ShapeLanguage(slot, getV3BuiltinPartVoxels(slot, 192));
  }

  appendHandBracerIssues(reports, 'Left');
  appendHandBracerIssues(reports, 'Right');

  return reports;
}
