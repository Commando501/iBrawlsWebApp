import type { VoxelData } from '../VoxelModels';
import { getV3BuiltinPartVoxels } from './VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3ModelTypes';
import {
  analyzeV3ShapeLanguage,
  type V3ShapeLanguageIssueCode,
} from './v3ShapeLanguage';
import { analyzeV3ArmorSurface } from './v3VoxelArmorSurface';

export interface V3PartFidelityBounds {
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

export interface V3PartFidelityDimensions {
  x: number;
  y: number;
  z: number;
}

export interface V3PartMaterialDiversity {
  colorCount: number;
  materialRoleCount: number;
  materialGroupCount: number;
  emissiveMaterialCount: number;
}

export interface V3PartFidelityMetrics {
  frontCoverageRatio: number;
  sideCoverageRatio: number;
  centerGapRatio: number;
  rowSpanVariation: number;
  terminalTaperRatio: number;
  panelDensity: number;
  colorDiversity: number;
}

export type V3PartFidelityIssueCode =
  | 'empty-payload'
  | 'slab-profile'
  | 'center-gap-filled'
  | 'material-diversity-low'
  | 'panel-hierarchy-flat'
  | 'cube-profile'
  | 'terminal-taper-flat'
  | 'vertical-scaffold'
  | 'silhouette-too-sparse'
  | 'terminal-proportion-oversized';

export interface V3PartFidelityIssue {
  code: V3PartFidelityIssueCode;
  message: string;
  value?: number;
  threshold?: number;
  source?: 'shape-language' | 'surface' | 'suit-fidelity';
}

export interface V3PartFidelityReport {
  slot: V3CharacterSlotId;
  voxelCount: number;
  uniqueVoxelCount: number;
  occupiedBounds: V3PartFidelityBounds;
  occupiedDimensions: V3PartFidelityDimensions;
  materialDiversity: V3PartMaterialDiversity;
  panelCount: number;
  exposedFaceCount: number;
  normalizedMetrics: V3PartFidelityMetrics;
  metrics: V3PartFidelityMetrics;
  issues: V3PartFidelityIssue[];
  ready: boolean;
}

type OccupiedVoxel = Pick<VoxelData, 'x' | 'y' | 'z'>;
type VoxelWithMaterialRole = VoxelData & {
  role?: unknown;
  materialRole?: unknown;
  paintRole?: unknown;
  v3Role?: unknown;
};

const EMPTY_BOUNDS: V3PartFidelityBounds = {
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

const TORSO_SLOTS = new Set<V3CharacterSlotId>(['chest', 'back']);
const LIMB_SLOTS = new Set<V3CharacterSlotId>([
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
]);
const HAND_SLOTS = new Set<V3CharacterSlotId>(['handLeft', 'handRight']);

const SLAB_PROFILE_COVERAGE_LIMIT = 0.9;
const SLAB_PROFILE_SOLIDITY_LIMIT = 0.78;
const CENTER_GAP_MIN_RATIO = 0.35;
const MATERIAL_GROUP_MIN_COUNT = 2;
const PANEL_HIERARCHY_MIN_DENSITY = 0.025;
const CUBE_PROFILE_SOLIDITY_LIMIT = 0.78;
const CUBE_PROFILE_DIMENSION_DELTA_LIMIT = 0.12;
const TERMINAL_TAPER_MAX_RATIO = 0.9;
const SCAFFOLD_FRONT_COVERAGE_LIMIT = 0.35;
const BUILT_IN_HAND_MAX_HIGH_DENSITY_DIMENSION = 8;

const voxelKey = ({ x, y, z }: OccupiedVoxel): string => `${x}:${y}:${z}`;

const isFiniteVoxel = (voxel: VoxelData): boolean =>
  Number.isFinite(voxel.x) && Number.isFinite(voxel.y) && Number.isFinite(voxel.z);

const getUniqueVoxels = (voxels: readonly VoxelData[]): VoxelData[] => {
  const unique = new Map<string, VoxelData>();

  for (const voxel of voxels) {
    if (!isFiniteVoxel(voxel)) continue;
    unique.set(voxelKey(voxel), voxel);
  }

  return [...unique.values()];
};

const getBounds = (voxels: readonly OccupiedVoxel[]): V3PartFidelityBounds => {
  if (voxels.length === 0) return { ...EMPTY_BOUNDS };

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

const ratio = (value: number, total: number): number =>
  total <= 0 ? 0 : Math.max(0, Math.min(1, value / total));

const bucketRatio = (value: number, step: number): number => {
  const safeValue = Math.max(0, Math.min(1, value));
  return Number((Math.round(safeValue / step) * step).toFixed(4));
};

const normalizeMetrics = (metrics: V3PartFidelityMetrics): V3PartFidelityMetrics => ({
  frontCoverageRatio: bucketRatio(metrics.frontCoverageRatio, 0.05),
  sideCoverageRatio: bucketRatio(metrics.sideCoverageRatio, 0.05),
  centerGapRatio: bucketRatio(metrics.centerGapRatio, 0.05),
  rowSpanVariation: bucketRatio(metrics.rowSpanVariation, 0.01),
  terminalTaperRatio: bucketRatio(metrics.terminalTaperRatio, 0.01),
  panelDensity: bucketRatio(metrics.panelDensity, 0.01),
  colorDiversity: bucketRatio(metrics.colorDiversity, 0.01),
});

const getFaceCoverageRatio = (
  voxels: readonly OccupiedVoxel[],
  bounds: V3PartFidelityBounds,
  face: 'front' | 'side'
): number => {
  if (bounds.sizeX === 0 || bounds.sizeY === 0 || bounds.sizeZ === 0) return 0;

  if (face === 'front') {
    const frontCount = voxels.filter((voxel) => voxel.z === bounds.maxZ).length;
    return ratio(frontCount, bounds.sizeX * bounds.sizeY);
  }

  const sideSilhouette = new Set(voxels.map((voxel) => `${voxel.y}:${voxel.z}`));
  return ratio(sideSilhouette.size, bounds.sizeZ * bounds.sizeY);
};

const getCenterGapRatio = (
  voxels: readonly OccupiedVoxel[],
  bounds: V3PartFidelityBounds
): number => {
  if (bounds.sizeX === 0 || bounds.sizeY === 0) return 0;

  const centerWidth = Math.max(2, Math.ceil(bounds.sizeX * 0.18));
  const startX = bounds.minX + Math.floor((bounds.sizeX - centerWidth) / 2);
  const endX = startX + centerWidth - 1;
  const startY = bounds.minY + Math.floor(bounds.sizeY * 0.55);
  const endY = bounds.maxY - Math.max(0, Math.floor(bounds.sizeY * 0.06));
  if (endY < startY) return 1;

  const occupied = new Set(voxels.map(voxelKey));
  let openCells = 0;
  let totalCells = 0;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      totalCells += 1;
      if (!occupied.has(`${x}:${y}:${bounds.maxZ}`)) {
        openCells += 1;
      }
    }
  }

  return ratio(openCells, totalCells);
};

const groupRows = (voxels: readonly OccupiedVoxel[]): Map<number, OccupiedVoxel[]> => {
  const rows = new Map<number, OccupiedVoxel[]>();

  for (const voxel of voxels) {
    rows.set(voxel.y, [...(rows.get(voxel.y) ?? []), voxel]);
  }

  return rows;
};

const getSpan = (values: readonly number[]): number =>
  values.length === 0 ? 0 : Math.max(...values) - Math.min(...values) + 1;

const getRowSpanVariation = (
  rows: Map<number, OccupiedVoxel[]>,
  bounds: V3PartFidelityBounds
): number => {
  if (rows.size === 0 || bounds.sizeX === 0 || bounds.sizeZ === 0) return 0;

  const xSpans = new Set<number>();
  const zSpans = new Set<number>();

  for (const row of rows.values()) {
    xSpans.add(getSpan(row.map((voxel) => voxel.x)));
    zSpans.add(getSpan(row.map((voxel) => voxel.z)));
  }

  const maxVariation = Math.max(1, bounds.sizeY * 0.5);
  return ratio(Math.max(0, xSpans.size + zSpans.size - 2), maxVariation);
};

const getMaxRowXSpan = (
  rows: Map<number, OccupiedVoxel[]>,
  predicate: (y: number) => boolean
): number => {
  let maxSpan = 0;

  for (const [y, row] of rows) {
    if (!predicate(y)) continue;
    maxSpan = Math.max(maxSpan, getSpan(row.map((voxel) => voxel.x)));
  }

  return maxSpan;
};

const getTerminalTaperRatio = (
  slot: V3CharacterSlotId,
  rows: Map<number, OccupiedVoxel[]>,
  bounds: V3PartFidelityBounds
): number => {
  const widestSpan = getMaxRowXSpan(rows, () => true);
  if (widestSpan === 0) return 0;

  const terminalHeight = Math.max(2, Math.ceil(bounds.sizeY * 0.14));
  const useTopBand = slot === 'helmet' || slot === 'neck';
  const terminalSpan = useTopBand
    ? getMaxRowXSpan(rows, (y) => y >= bounds.maxY - terminalHeight + 1)
    : getMaxRowXSpan(rows, (y) => y <= bounds.minY + terminalHeight - 1);

  return ratio(terminalSpan, widestSpan);
};

const getMaterialRole = (voxel: VoxelData): string | undefined => {
  const metadata = voxel as VoxelWithMaterialRole;
  const role = metadata.materialRole ?? metadata.paintRole ?? metadata.v3Role ?? metadata.role;
  return typeof role === 'string' && role.length > 0 ? role : undefined;
};

const getMaterialDiversity = (voxels: readonly VoxelData[]): V3PartMaterialDiversity => {
  const colors = new Set<string>();
  const roles = new Set<string>();
  const groups = new Set<string>();
  const emissiveGroups = new Set<string>();

  for (const voxel of voxels) {
    colors.add(voxel.color);
    const role = getMaterialRole(voxel);
    if (role) roles.add(role);
    const materialKey = `${voxel.color}|${voxel.emissive === true ? '1' : '0'}`;
    groups.add(materialKey);
    if (voxel.emissive === true) emissiveGroups.add(materialKey);
  }

  return {
    colorCount: colors.size,
    materialRoleCount: roles.size,
    materialGroupCount: groups.size,
    emissiveMaterialCount: emissiveGroups.size,
  };
};

const addIssue = (
  issues: V3PartFidelityIssue[],
  code: V3PartFidelityIssueCode,
  message: string,
  value?: number,
  threshold?: number,
  source: V3PartFidelityIssue['source'] = 'suit-fidelity'
): void => {
  if (issues.some((issue) => issue.code === code)) return;
  issues.push({
    code,
    message,
    ...(value === undefined ? {} : { value }),
    ...(threshold === undefined ? {} : { threshold }),
    source,
  });
};

const mapShapeLanguageIssue = (
  slot: V3CharacterSlotId,
  code: V3ShapeLanguageIssueCode,
  issues: V3PartFidelityIssue[],
  metrics: V3PartFidelityMetrics
): void => {
  if (code === 'empty-payload') {
    addIssue(issues, 'empty-payload', `${slot} has no occupied voxels`, undefined, undefined, 'shape-language');
  } else if (code === 'torso-depth-ratio-high' || code === 'front-slab-coverage-high') {
    addIssue(
      issues,
      'slab-profile',
      `${slot} reads as a filled slab from a primary view`,
      metrics.frontCoverageRatio,
      SLAB_PROFILE_COVERAGE_LIMIT,
      'shape-language'
    );
  } else if (code === 'center-channel-filled') {
    addIssue(
      issues,
      'center-gap-filled',
      `${slot} is missing enough negative space through the center channel`,
      metrics.centerGapRatio,
      CENTER_GAP_MIN_RATIO,
      'shape-language'
    );
  } else if (code === 'crown-not-tapered' || code === 'limb-terminal-not-tapered') {
    addIssue(
      issues,
      'terminal-taper-flat',
      `${slot} terminal rows are not tapered enough`,
      metrics.terminalTaperRatio,
      TERMINAL_TAPER_MAX_RATIO,
      'shape-language'
    );
  } else if (code === 'full-height-front-column') {
    addIssue(
      issues,
      'vertical-scaffold',
      `${slot} has a sparse full-height front scaffold`,
      metrics.frontCoverageRatio,
      SCAFFOLD_FRONT_COVERAGE_LIMIT,
      'shape-language'
    );
    addIssue(
      issues,
      'silhouette-too-sparse',
      `${slot} front silhouette is too sparse to read as armor mass`,
      metrics.frontCoverageRatio,
      SCAFFOLD_FRONT_COVERAGE_LIMIT,
      'shape-language'
    );
  } else if (code === 'hand-not-smaller-than-bracer') {
    addIssue(issues, 'terminal-proportion-oversized', `${slot} is oversized against its bracer`, undefined, undefined, 'shape-language');
  }
};

const isCubeProfile = (
  bounds: V3PartFidelityBounds,
  solidityRatio: number,
  metrics: V3PartFidelityMetrics
): boolean => {
  const maxDimension = Math.max(bounds.sizeX, bounds.sizeY, bounds.sizeZ);
  if (maxDimension === 0) return false;

  const dimensionDelta = (
    Math.max(bounds.sizeX, bounds.sizeY, bounds.sizeZ) -
    Math.min(bounds.sizeX, bounds.sizeY, bounds.sizeZ)
  ) / maxDimension;

  return (
    dimensionDelta <= CUBE_PROFILE_DIMENSION_DELTA_LIMIT &&
    solidityRatio >= CUBE_PROFILE_SOLIDITY_LIMIT &&
    metrics.frontCoverageRatio >= SLAB_PROFILE_COVERAGE_LIMIT &&
    metrics.sideCoverageRatio >= SLAB_PROFILE_COVERAGE_LIMIT
  );
};

export function analyzeV3PartFidelity(
  slot: V3CharacterSlotId,
  voxels: readonly VoxelData[]
): V3PartFidelityReport {
  const uniqueVoxels = getUniqueVoxels(voxels);
  const occupiedBounds = getBounds(uniqueVoxels);
  const occupiedDimensions = {
    x: occupiedBounds.sizeX,
    y: occupiedBounds.sizeY,
    z: occupiedBounds.sizeZ,
  };
  const rows = groupRows(uniqueVoxels);
  const materialDiversity = getMaterialDiversity(uniqueVoxels);
  const surface = analyzeV3ArmorSurface(uniqueVoxels);
  const shapeLanguage = analyzeV3ShapeLanguage(slot, uniqueVoxels);
  const volume = occupiedBounds.sizeX * occupiedBounds.sizeY * occupiedBounds.sizeZ;
  const solidityRatio = ratio(uniqueVoxels.length, volume);
  const panelDensity = ratio(surface.panelCount, surface.exposedFaceCount);
  const rawMetrics: V3PartFidelityMetrics = {
    frontCoverageRatio: getFaceCoverageRatio(uniqueVoxels, occupiedBounds, 'front'),
    sideCoverageRatio: getFaceCoverageRatio(uniqueVoxels, occupiedBounds, 'side'),
    centerGapRatio: slot === 'chest' ? getCenterGapRatio(uniqueVoxels, occupiedBounds) : 1,
    rowSpanVariation: getRowSpanVariation(rows, occupiedBounds),
    terminalTaperRatio: getTerminalTaperRatio(slot, rows, occupiedBounds),
    panelDensity,
    colorDiversity: ratio(materialDiversity.colorCount, 4),
  };
  const metrics = normalizeMetrics(rawMetrics);
  const issues: V3PartFidelityIssue[] = [];

  for (const issue of shapeLanguage.issues) {
    mapShapeLanguageIssue(slot, issue.code, issues, rawMetrics);
  }

  if (
    TORSO_SLOTS.has(slot) &&
    rawMetrics.frontCoverageRatio >= SLAB_PROFILE_COVERAGE_LIMIT &&
    rawMetrics.sideCoverageRatio >= SLAB_PROFILE_COVERAGE_LIMIT &&
    solidityRatio >= SLAB_PROFILE_SOLIDITY_LIMIT
  ) {
    addIssue(
      issues,
      'slab-profile',
      `${slot} reads as a filled slab from front and side views`,
      Math.min(rawMetrics.frontCoverageRatio, rawMetrics.sideCoverageRatio),
      SLAB_PROFILE_COVERAGE_LIMIT
    );
  }

  if (slot === 'chest' && rawMetrics.centerGapRatio < CENTER_GAP_MIN_RATIO) {
    addIssue(
      issues,
      'center-gap-filled',
      'chest is missing enough negative space through the pectoral center channel',
      rawMetrics.centerGapRatio,
      CENTER_GAP_MIN_RATIO
    );
  }

  if (materialDiversity.materialGroupCount < MATERIAL_GROUP_MIN_COUNT) {
    addIssue(
      issues,
      'material-diversity-low',
      `${slot} needs more than one rendered material group for readable armor hierarchy`,
      materialDiversity.materialGroupCount,
      MATERIAL_GROUP_MIN_COUNT
    );
  }

  if (TORSO_SLOTS.has(slot) && surface.panelCount <= 8 && rawMetrics.panelDensity < PANEL_HIERARCHY_MIN_DENSITY) {
    addIssue(
      issues,
      'panel-hierarchy-flat',
      `${slot} has too few merged panels for a readable armor hierarchy`,
      rawMetrics.panelDensity,
      PANEL_HIERARCHY_MIN_DENSITY,
      'surface'
    );
  }

  if (isCubeProfile(occupiedBounds, solidityRatio, rawMetrics)) {
    addIssue(
      issues,
      'cube-profile',
      `${slot} reads as a filled cube instead of a sculpted armor part`,
      solidityRatio,
      CUBE_PROFILE_SOLIDITY_LIMIT
    );
  }

  if (
    (slot === 'helmet' || LIMB_SLOTS.has(slot)) &&
    rawMetrics.terminalTaperRatio > TERMINAL_TAPER_MAX_RATIO &&
    solidityRatio >= CUBE_PROFILE_SOLIDITY_LIMIT
  ) {
    addIssue(
      issues,
      'terminal-taper-flat',
      `${slot} terminal rows are not tapered enough`,
      rawMetrics.terminalTaperRatio,
      TERMINAL_TAPER_MAX_RATIO
    );
  }

  if (
    LIMB_SLOTS.has(slot) &&
    rawMetrics.frontCoverageRatio < SCAFFOLD_FRONT_COVERAGE_LIMIT &&
    shapeLanguage.hasFullHeightFrontColumn
  ) {
    addIssue(
      issues,
      'vertical-scaffold',
      `${slot} has a sparse full-height front scaffold`,
      rawMetrics.frontCoverageRatio,
      SCAFFOLD_FRONT_COVERAGE_LIMIT
    );
    addIssue(
      issues,
      'silhouette-too-sparse',
      `${slot} front silhouette is too sparse to read as armor mass`,
      rawMetrics.frontCoverageRatio,
      SCAFFOLD_FRONT_COVERAGE_LIMIT
    );
  }

  if (
    HAND_SLOTS.has(slot) &&
    Math.max(occupiedBounds.sizeX, occupiedBounds.sizeY, occupiedBounds.sizeZ) > BUILT_IN_HAND_MAX_HIGH_DENSITY_DIMENSION
  ) {
    addIssue(
      issues,
      'terminal-proportion-oversized',
      `${slot} is larger than the built-in high-density hand envelope`,
      Math.max(occupiedBounds.sizeX, occupiedBounds.sizeY, occupiedBounds.sizeZ),
      BUILT_IN_HAND_MAX_HIGH_DENSITY_DIMENSION
    );
  }

  return {
    slot,
    voxelCount: voxels.length,
    uniqueVoxelCount: uniqueVoxels.length,
    occupiedBounds,
    occupiedDimensions,
    materialDiversity,
    panelCount: surface.panelCount,
    exposedFaceCount: surface.exposedFaceCount,
    normalizedMetrics: metrics,
    metrics,
    issues,
    ready: issues.length === 0,
  };
}

export function analyzeV3BuiltInSuitFidelity(): Record<V3CharacterSlotId, V3PartFidelityReport> {
  const reports = {} as Record<V3CharacterSlotId, V3PartFidelityReport>;

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    reports[slot] = analyzeV3PartFidelity(slot, getV3BuiltinPartVoxels(slot, 192));
  }

  return reports;
}
