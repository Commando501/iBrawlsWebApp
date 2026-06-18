import type { CharacterLoadout, VoxelData } from '../VoxelModels';
import type {
  V3ReferenceFeatureGuide,
  V3ReferenceFeaturePanelZoneKind,
  V3ReferenceFeatureSlot,
} from '../../tools/v3ReferenceFeatureGuide';
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

export type V3ReferenceFeatureMatchIssueCode =
  | 'empty-payload'
  | 'missing-guide-coverage'
  | 'missing-reference-feature'
  | 'material-role-diversity-low'
  | 'slot-fidelity-blocked'
  | 'low-reference-feature-score';

export interface V3ReferenceFeatureMatchIssue {
  code: V3ReferenceFeatureMatchIssueCode;
  slot: V3CharacterSlotId;
  message: string;
  value?: number;
  threshold?: number;
}

export interface V3ReferenceFeaturePresence {
  kind: V3ReferenceFeaturePanelZoneKind;
  present: boolean;
  value: number;
  threshold: number;
}

export interface V3ReferenceFeatureMatchSlotReport {
  slot: V3CharacterSlotId;
  referenceSlot: V3ReferenceFeatureSlot;
  voxelCount: number;
  score: number;
  requiredFeatureCount: number;
  matchedFeatureCount: number;
  materialRoleDiversity: number;
  guideObjectCount: number;
  features: V3ReferenceFeaturePresence[];
  issues: V3ReferenceFeatureMatchIssue[];
  ready: boolean;
}

export interface V3ReferenceFeatureMatchReport {
  ready: boolean;
  slots: Partial<Record<V3CharacterSlotId, V3ReferenceFeatureMatchSlotReport>>;
  issues: V3ReferenceFeatureMatchIssue[];
  summary: {
    slotCount: number;
    readySlotCount: number;
    averageScore: number;
    issueCount: number;
    guideSlotCount: number;
  };
}

export interface V3ReferenceFeatureMatchOptions {
  guide?: V3ReferenceFeatureGuide | null;
  slots?: readonly V3CharacterSlotId[];
  voxelsBySlot?: Partial<Record<V3CharacterSlotId, readonly VoxelData[]>>;
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

const V3_REFERENCE_MATCH_COLORS = {
  primary: '#101010',
  secondary: '#202020',
  accent: '#303030',
  undersuit: '#353535',
  visor: '#404040',
  emissive: '#505050',
  decal: '#606060',
  fixed: '#707070',
} as const;

const V3_REFERENCE_MATCH_PAINT_JOB: CharacterLoadout['paintJob'] = {
  v3RoleColors: V3_REFERENCE_MATCH_COLORS,
  v3RoleEmissive: {
    visor: true,
    emissive: true,
  },
};

const V3_REFERENCE_FEATURE_SCORE_MIN = 0.72;
const V3_REFERENCE_FEATURE_MATERIAL_ROLE_MIN = 3;

const V3_DEFAULT_REFERENCE_FEATURES: Record<V3ReferenceFeatureSlot, readonly V3ReferenceFeaturePanelZoneKind[]> = {
  helmet: ['visor', 'jaw', 'crown'],
  chest: ['pectoral', 'core', 'abdomen'],
  pelvis: ['core'],
  back: ['rail', 'spine'],
  shoulder: ['pauldron'],
  upperArm: ['bicep'],
  forearm: ['wrist'],
  hand: ['glove'],
  thigh: ['knee'],
  shin: ['knee'],
  foot: ['boot', 'toe'],
};

const V3_REQUIRED_GUIDE_COVERAGE_FEATURES: Partial<
  Record<V3ReferenceFeatureSlot, readonly V3ReferenceFeaturePanelZoneKind[]>
> = {
  helmet: V3_DEFAULT_REFERENCE_FEATURES.helmet,
  chest: V3_DEFAULT_REFERENCE_FEATURES.chest,
  back: V3_DEFAULT_REFERENCE_FEATURES.back,
  shoulder: V3_DEFAULT_REFERENCE_FEATURES.shoulder,
};

const V3_REFERENCE_FEATURE_FIDELITY_BLOCKERS = new Set<V3PartFidelityIssueCode>([
  'slab-profile',
  'center-gap-filled',
  'panel-hierarchy-flat',
  'cube-profile',
  'terminal-taper-flat',
  'vertical-scaffold',
  'silhouette-too-sparse',
  'terminal-proportion-oversized',
]);

const V3_REFERENCE_FEATURE_MATCH_SLOTS: readonly V3CharacterSlotId[] = V3_CHARACTER_SLOT_IDS.filter(
  (slot) => slot !== 'neck'
);

const SLAB_PROFILE_COVERAGE_LIMIT = 0.9;
const SLAB_PROFILE_SOLIDITY_LIMIT = 0.78;
const CENTER_GAP_MIN_RATIO = 0.35;
const MATERIAL_GROUP_MIN_COUNT = 2;
const PANEL_HIERARCHY_MIN_DENSITY = 0.025;
const CUBE_PROFILE_SOLIDITY_LIMIT = 0.78;
const CUBE_PROFILE_DIMENSION_DELTA_LIMIT = 0.12;
const TERMINAL_TAPER_MAX_RATIO = 0.9;
const SCAFFOLD_FRONT_COVERAGE_LIMIT = 0.35;
const BUILT_IN_HAND_MAX_HIGH_DENSITY_DIMENSION = 12;

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
    Math.max(occupiedBounds.sizeX, occupiedBounds.sizeY) > BUILT_IN_HAND_MAX_HIGH_DENSITY_DIMENSION
  ) {
    const handPlanarDimension = Math.max(occupiedBounds.sizeX, occupiedBounds.sizeY);
    addIssue(
      issues,
      'terminal-proportion-oversized',
      `${slot} is larger than the built-in high-density hand envelope`,
      handPlanarDimension,
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

const uniqueFeatureKinds = (
  kinds: readonly V3ReferenceFeaturePanelZoneKind[]
): V3ReferenceFeaturePanelZoneKind[] => {
  const seen = new Set<V3ReferenceFeaturePanelZoneKind>();
  const unique: V3ReferenceFeaturePanelZoneKind[] = [];
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    unique.push(kind);
  }
  return unique;
};

const slotToReferenceFeatureSlot = (slot: V3CharacterSlotId): V3ReferenceFeatureSlot => {
  if (slot === 'helmet') return 'helmet';
  if (slot === 'chest' || slot === 'neck') return 'chest';
  if (slot === 'pelvis') return 'pelvis';
  if (slot === 'back') return 'back';
  if (slot === 'shoulderLeft' || slot === 'shoulderRight') return 'shoulder';
  if (slot === 'upperArmLeft' || slot === 'upperArmRight') return 'upperArm';
  if (slot === 'forearmLeft' || slot === 'forearmRight') return 'forearm';
  if (slot === 'handLeft' || slot === 'handRight') return 'hand';
  if (slot === 'thighLeft' || slot === 'thighRight') return 'thigh';
  if (slot === 'shinLeft' || slot === 'shinRight') return 'shin';
  return 'foot';
};

const getGuideFeatureKinds = (
  guide: V3ReferenceFeatureGuide | null | undefined,
  referenceSlot: V3ReferenceFeatureSlot
): V3ReferenceFeaturePanelZoneKind[] => {
  const guideKinds = guide?.slotGuides
    .find((slotGuide) => slotGuide.slot === referenceSlot)
    ?.panelZones.map((zone) => zone.kind) ?? [];
  return uniqueFeatureKinds([
    ...V3_DEFAULT_REFERENCE_FEATURES[referenceSlot],
    ...guideKinds,
  ]);
};

const getGuideSlot = (
  guide: V3ReferenceFeatureGuide | null | undefined,
  referenceSlot: V3ReferenceFeatureSlot
) => guide?.slotGuides.find((slotGuide) => slotGuide.slot === referenceSlot);

const getGuideObjectCount = (
  guide: V3ReferenceFeatureGuide | null | undefined,
  referenceSlot: V3ReferenceFeatureSlot
): number => getGuideSlot(guide, referenceSlot)?.objectCount ?? 0;

const getMissingGuideCoverageKinds = (
  guide: V3ReferenceFeatureGuide | null | undefined,
  referenceSlot: V3ReferenceFeatureSlot
): V3ReferenceFeaturePanelZoneKind[] => {
  if (!guide) return [];

  const requiredKinds = V3_REQUIRED_GUIDE_COVERAGE_FEATURES[referenceSlot] ?? [];
  if (requiredKinds.length === 0) return [];

  const slotGuide = getGuideSlot(guide, referenceSlot);
  const guideKinds = new Set(slotGuide?.panelZones.map((zone) => zone.kind) ?? []);
  return requiredKinds.filter((kind) => !slotGuide || slotGuide.objectCount <= 0 || !guideKinds.has(kind));
};

const countMatchingVoxels = (
  voxels: readonly VoxelData[],
  predicate: (voxel: VoxelData) => boolean
): number => voxels.reduce((count, voxel) => count + (predicate(voxel) ? 1 : 0), 0);

const colorIs = (voxel: VoxelData, color: string): boolean => voxel.color.toLowerCase() === color;

const getReferenceMaterialRoleDiversity = (voxels: readonly VoxelData[]): number => {
  const roles = new Set<string>();
  for (const voxel of voxels) {
    for (const [role, color] of Object.entries(V3_REFERENCE_MATCH_COLORS)) {
      if (colorIs(voxel, color)) {
        roles.add(role);
      }
    }
  }
  return roles.size;
};

const getFeaturePresence = (
  kind: V3ReferenceFeaturePanelZoneKind,
  voxels: readonly VoxelData[],
  bounds: V3PartFidelityBounds
): V3ReferenceFeaturePresence => {
  const frontZ = bounds.maxZ;
  const rearZ = bounds.minZ;
  const centerX = bounds.minX + Math.floor(bounds.sizeX / 2);
  const lowerY = bounds.minY + Math.floor(bounds.sizeY * 0.34);
  const middleY = bounds.minY + Math.floor(bounds.sizeY * 0.52);
  const upperY = bounds.minY + Math.floor(bounds.sizeY * 0.66);
  const minSideCount = Math.max(2, Math.floor(bounds.sizeY * 0.2));
  const minPanelCount = Math.max(3, Math.floor(bounds.sizeX * bounds.sizeY * 0.04));
  const hasBothSides = (predicate: (voxel: VoxelData) => boolean): number => {
    const left = countMatchingVoxels(voxels, (voxel) => predicate(voxel) && voxel.x < centerX - 1);
    const right = countMatchingVoxels(voxels, (voxel) => predicate(voxel) && voxel.x > centerX + 1);
    return Math.min(left, right);
  };
  const countRole = (role: keyof typeof V3_REFERENCE_MATCH_COLORS, predicate: (voxel: VoxelData) => boolean): number =>
    countMatchingVoxels(voxels, (voxel) => colorIs(voxel, V3_REFERENCE_MATCH_COLORS[role]) && predicate(voxel));

  let value = 0;
  let threshold = minPanelCount;

  switch (kind) {
    case 'visor':
      value = countRole('visor', (voxel) => voxel.y >= middleY);
      threshold = Math.max(8, Math.floor(bounds.sizeX * 0.8));
      break;
    case 'jaw':
      value = countMatchingVoxels(voxels, (voxel) =>
        voxel.color !== V3_REFERENCE_MATCH_COLORS.visor &&
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.18)) &&
        voxel.y <= lowerY
      );
      threshold = 5;
      break;
    case 'crown':
      value = countRole('primary', (voxel) => voxel.y >= upperY && voxel.z <= frontZ - 1);
      threshold = 5;
      break;
    case 'pectoral':
      value = hasBothSides((voxel) =>
        colorIs(voxel, V3_REFERENCE_MATCH_COLORS.primary) &&
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.18)) &&
        voxel.y >= upperY
      );
      threshold = Math.max(8, minSideCount);
      break;
    case 'core':
      value = countMatchingVoxels(voxels, (voxel) =>
        (colorIs(voxel, V3_REFERENCE_MATCH_COLORS.decal) || colorIs(voxel, V3_REFERENCE_MATCH_COLORS.emissive)) &&
        Math.abs(voxel.x - centerX) <= Math.max(1, Math.floor(bounds.sizeX * 0.08)) &&
        voxel.y >= middleY
      );
      threshold = 3;
      break;
    case 'abdomen':
      value = countRole('fixed', (voxel) =>
        voxel.y >= lowerY &&
        voxel.y <= bounds.maxY
      );
      threshold = 6;
      break;
    case 'rail':
      value = hasBothSides((voxel) =>
        voxel.color !== V3_REFERENCE_MATCH_COLORS.undersuit &&
        voxel.z <= rearZ + Math.max(2, Math.floor(bounds.sizeZ * 0.24)) &&
        voxel.y >= lowerY
      );
      threshold = 4;
      break;
    case 'spine':
      value = countMatchingVoxels(voxels, (voxel) =>
        (colorIs(voxel, V3_REFERENCE_MATCH_COLORS.emissive) || colorIs(voxel, V3_REFERENCE_MATCH_COLORS.fixed)) &&
        Math.abs(voxel.x - centerX) <= 1 &&
        voxel.y >= lowerY
      );
      threshold = 4;
      break;
    case 'boot':
      value = countMatchingVoxels(voxels, (voxel) =>
        (colorIs(voxel, V3_REFERENCE_MATCH_COLORS.accent) || colorIs(voxel, V3_REFERENCE_MATCH_COLORS.decal)) &&
        voxel.y <= lowerY + 1
      );
      threshold = 6;
      break;
    case 'toe':
      value = countMatchingVoxels(voxels, (voxel) =>
        voxel.color !== V3_REFERENCE_MATCH_COLORS.undersuit &&
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.18))
      );
      threshold = 6;
      break;
    case 'wrist':
      value = countRole('accent', (voxel) =>
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.18)) &&
        voxel.y <= lowerY + 1
      );
      threshold = 3;
      break;
    case 'glove':
      value = countMatchingVoxels(voxels, (voxel) =>
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.25)) &&
        voxel.y >= middleY &&
        (colorIs(voxel, V3_REFERENCE_MATCH_COLORS.accent) || colorIs(voxel, V3_REFERENCE_MATCH_COLORS.fixed))
      );
      threshold = 3;
      break;
    case 'pauldron':
      value = countMatchingVoxels(voxels, (voxel) =>
        voxel.color !== V3_REFERENCE_MATCH_COLORS.undersuit &&
        voxel.z >= frontZ - Math.max(4, Math.floor(bounds.sizeZ * 0.65)) &&
        voxel.y >= middleY
      );
      threshold = 6;
      break;
    case 'bicep':
      value = countRole('secondary', (voxel) =>
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.18)) &&
        voxel.y >= middleY
      );
      threshold = 4;
      break;
    case 'knee':
      value = countMatchingVoxels(voxels, (voxel) =>
        voxel.z >= frontZ - Math.max(2, Math.floor(bounds.sizeZ * 0.18)) &&
        voxel.y >= middleY &&
        (
          colorIs(voxel, V3_REFERENCE_MATCH_COLORS.accent) ||
          colorIs(voxel, V3_REFERENCE_MATCH_COLORS.secondary) ||
          colorIs(voxel, V3_REFERENCE_MATCH_COLORS.fixed)
        )
      );
      threshold = 4;
      break;
  }

  return {
    kind,
    present: value >= threshold,
    value,
    threshold,
  };
};

export function analyzeV3ReferenceFeatureMatch(
  options: V3ReferenceFeatureMatchOptions = {}
): V3ReferenceFeatureMatchReport {
  const slots = options.slots ?? V3_REFERENCE_FEATURE_MATCH_SLOTS;
  const slotReports: Partial<Record<V3CharacterSlotId, V3ReferenceFeatureMatchSlotReport>> = {};
  const allIssues: V3ReferenceFeatureMatchIssue[] = [];

  for (const slot of slots) {
    const referenceSlot = slotToReferenceFeatureSlot(slot);
    const voxels = [...(options.voxelsBySlot?.[slot] ?? getV3BuiltinPartVoxels(slot, 192, V3_REFERENCE_MATCH_PAINT_JOB))];
    const uniqueVoxels = getUniqueVoxels(voxels);
    const bounds = getBounds(uniqueVoxels);
    const requiredKinds = getGuideFeatureKinds(options.guide, referenceSlot);
    const features = requiredKinds.map((kind) => getFeaturePresence(kind, uniqueVoxels, bounds));
    const matchedFeatureCount = features.filter((feature) => feature.present).length;
    const score = features.length === 0 ? 1 : Number((matchedFeatureCount / features.length).toFixed(4));
    const materialRoleDiversity = getReferenceMaterialRoleDiversity(uniqueVoxels);
    const missingGuideCoverageKinds = getMissingGuideCoverageKinds(options.guide, referenceSlot);
    const slotFidelity = uniqueVoxels.length > 0 ? analyzeV3PartFidelity(slot, uniqueVoxels) : null;
    const slotFidelityBlockers = slotFidelity?.issues.filter((issue) =>
      V3_REFERENCE_FEATURE_FIDELITY_BLOCKERS.has(issue.code)
    ) ?? [];
    const issues: V3ReferenceFeatureMatchIssue[] = [];

    if (uniqueVoxels.length === 0) {
      issues.push({
        code: 'empty-payload',
        slot,
        message: `${slot} has no voxels to compare against reference feature guidance`,
      });
    }

    for (const kind of missingGuideCoverageKinds) {
      issues.push({
        code: 'missing-guide-coverage',
        slot,
        message: `${slot} reference guide is missing required ${referenceSlot} ${kind} coverage`,
        value: 0,
        threshold: 1,
      });
    }

    for (const feature of features) {
      if (!feature.present) {
        issues.push({
          code: 'missing-reference-feature',
          slot,
          message: `${slot} is missing reference ${feature.kind} feature coverage`,
          value: feature.value,
          threshold: feature.threshold,
        });
      }
    }

    if (slotFidelityBlockers.length > 0) {
      issues.push({
        code: 'slot-fidelity-blocked',
        slot,
        message: `${slot} has blocky or non-slot-specific silhouette issues that cannot satisfy reference feature matching`,
        value: slotFidelityBlockers.length,
        threshold: 0,
      });
    }

    if (materialRoleDiversity < V3_REFERENCE_FEATURE_MATERIAL_ROLE_MIN) {
      issues.push({
        code: 'material-role-diversity-low',
        slot,
        message: `${slot} does not have enough role-colored feature contrast for reference matching`,
        value: materialRoleDiversity,
        threshold: V3_REFERENCE_FEATURE_MATERIAL_ROLE_MIN,
      });
    }

    if (score < V3_REFERENCE_FEATURE_SCORE_MIN) {
      issues.push({
        code: 'low-reference-feature-score',
        slot,
        message: `${slot} reference feature score is below the Phase 34 gate`,
        value: score,
        threshold: V3_REFERENCE_FEATURE_SCORE_MIN,
      });
    }

    const slotReport: V3ReferenceFeatureMatchSlotReport = {
      slot,
      referenceSlot,
      voxelCount: voxels.length,
      score,
      requiredFeatureCount: features.length,
      matchedFeatureCount,
      materialRoleDiversity,
      guideObjectCount: getGuideObjectCount(options.guide, referenceSlot),
      features,
      issues,
      ready: issues.length === 0,
    };
    slotReports[slot] = slotReport;
    allIssues.push(...issues);
  }

  const reports = Object.values(slotReports);
  const averageScore = reports.length === 0
    ? 0
    : Number((reports.reduce((total, report) => total + report.score, 0) / reports.length).toFixed(4));

  return {
    ready: allIssues.length === 0,
    slots: slotReports,
    issues: allIssues,
    summary: {
      slotCount: reports.length,
      readySlotCount: reports.filter((report) => report.ready).length,
      averageScore,
      issueCount: allIssues.length,
      guideSlotCount: options.guide?.slotGuides.length ?? 0,
    },
  };
}

export function analyzeV3BuiltInReferenceFeatureMatch(
  guide?: V3ReferenceFeatureGuide | null
): V3ReferenceFeatureMatchReport {
  return analyzeV3ReferenceFeatureMatch({ guide });
}

export function formatV3ReferenceFeatureMatchSummary(report: V3ReferenceFeatureMatchReport): string {
  return `Reference Feature Match ${report.ready ? 'ready' : 'blocked'}: ${report.summary.readySlotCount}/${report.summary.slotCount} slots, average score ${report.summary.averageScore.toFixed(4)}, ${report.summary.issueCount} issue${report.summary.issueCount === 1 ? '' : 's'}.`;
}

export function analyzeV3BuiltInSuitFidelity(): Record<V3CharacterSlotId, V3PartFidelityReport> {
  const reports = {} as Record<V3CharacterSlotId, V3PartFidelityReport>;

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    reports[slot] = analyzeV3PartFidelity(slot, getV3BuiltinPartVoxels(slot, 192));
  }

  return reports;
}
