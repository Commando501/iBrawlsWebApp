import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3ModelTypes';

export type V3ObjSurfaceSlotFamily =
  | 'helmet'
  | 'chest'
  | 'pelvis'
  | 'back'
  | 'shoulder'
  | 'upperArm'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'shin'
  | 'foot';

export type V3ObjSurfaceSlotSegmentationAxis = 'width' | 'height' | 'depth' | 'vertical';
export type V3ObjSurfaceSlotSegmentationDirection = 'too-large' | 'too-small' | 'too-high' | 'too-low';
export type V3ObjSurfaceSlotSegmentationCategory = 'segmentation-review' | 'body-rebuild-blocker';
export type V3ObjSurfaceSlotSegmentationDiagnosticCode =
  | 'empty-slot'
  | 'excluded-source-objects'
  | 'low-role-diversity'
  | 'paired-slot-imbalance'
  | 'suspicious-family-bounds';

export interface V3ObjSurfaceSlotSource {
  slot: V3CharacterSlotId;
  voxelCount: number;
  runCount: number;
  roleHintIndexes?: readonly number[];
  bounds: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
    size: readonly [number, number, number];
  };
}

export interface V3ObjSurfaceSlotSegmentationSource {
  schemaVersion: string;
  source: {
    hash: string;
    fileName: string;
    objectCount: number;
  };
  coordinateSystem: {
    targetHeightVoxels: number;
  };
  rolePalette: readonly string[];
  metrics: {
    slotCount: number;
    bodyObjectCount: number;
    excludedObjectCount: number;
    totalVoxelCount: number;
    totalRunCount: number;
  };
  excludedObjects: readonly string[];
  slots: Record<V3CharacterSlotId, V3ObjSurfaceSlotSource>;
}

export interface V3ObjSurfaceSlotCoverageReport {
  expectedSlotCount: number;
  coveredSlotCount: number;
  emptySlots: V3CharacterSlotId[];
}

export interface V3ObjSurfaceSlotRoleReport {
  slot: V3CharacterSlotId;
  roleCount: number;
  roles: string[];
}

export interface V3ObjSurfaceRoleDiversityReport {
  palette: string[];
  minSlotRoleCount: number;
  lowDiversitySlots: V3ObjSurfaceSlotRoleReport[];
  slots: V3ObjSurfaceSlotRoleReport[];
}

export interface V3ObjSurfacePairedSlotSymmetryReport {
  family: Extract<V3ObjSurfaceSlotFamily, 'shoulder' | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot'>;
  leftSlot: V3CharacterSlotId;
  rightSlot: V3CharacterSlotId;
  voxelBalance: number;
  runBalance: number;
  boundsSizeBalance: {
    width: number;
    height: number;
    depth: number;
  };
  balanced: boolean;
}

export interface V3ObjSurfaceFamilyBoundsReport {
  family: V3ObjSurfaceSlotFamily;
  slots: V3CharacterSlotId[];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  ratios: {
    width: number;
    height: number;
    depth: number;
    verticalCenter: number;
  };
}

export interface V3ObjSurfaceSlotSegmentationDiagnostic {
  code: V3ObjSurfaceSlotSegmentationDiagnosticCode;
  category: V3ObjSurfaceSlotSegmentationCategory;
  blocksBodyRebuild: boolean;
  message: string;
  slot?: V3CharacterSlotId;
  family?: V3ObjSurfaceSlotFamily;
  axis?: V3ObjSurfaceSlotSegmentationAxis;
  direction?: V3ObjSurfaceSlotSegmentationDirection;
  value?: number;
  threshold?: number;
}

export interface V3ObjSurfaceSuspiciousFamilyBound extends V3ObjSurfaceSlotSegmentationDiagnostic {
  code: 'suspicious-family-bounds';
  category: 'segmentation-review';
  blocksBodyRebuild: false;
  family: V3ObjSurfaceSlotFamily;
  axis: V3ObjSurfaceSlotSegmentationAxis;
  direction: V3ObjSurfaceSlotSegmentationDirection;
  value: number;
  threshold: number;
}

export interface V3ObjSurfaceExcludedObjectsReport {
  count: number;
  names: string[];
}

export interface V3ObjSurfaceSlotSegmentationReport {
  ready: boolean;
  sourceHash: string;
  sourceFileName: string;
  coverage: V3ObjSurfaceSlotCoverageReport;
  roleDiversity: V3ObjSurfaceRoleDiversityReport;
  pairedSlotSymmetry: V3ObjSurfacePairedSlotSymmetryReport[];
  familyBounds: V3ObjSurfaceFamilyBoundsReport[];
  suspiciousFamilyBounds: V3ObjSurfaceSuspiciousFamilyBound[];
  excludedObjects: V3ObjSurfaceExcludedObjectsReport;
  diagnostics: V3ObjSurfaceSlotSegmentationDiagnostic[];
  summary: {
    slotCount: number;
    coveredSlotCount: number;
    segmentationReviewCount: number;
    bodyRebuildBlockerCount: number;
    diagnosticCount: number;
    suspiciousFamilyBoundCount: number;
    lowRoleDiversitySlotCount: number;
    pairedSlotCount: number;
    excludedObjectCount: number;
  };
}

export interface V3ObjSurfaceReferenceFitGapReviewInput {
  slot: V3ObjSurfaceSlotFamily;
  axis: V3ObjSurfaceSlotSegmentationAxis;
  direction: V3ObjSurfaceSlotSegmentationDirection | 'too-large' | 'too-small' | 'too-high' | 'too-low';
}

export interface V3ObjSurfaceReferenceTargetReviewInput {
  slot: V3ObjSurfaceSlotFamily;
  axis: Exclude<V3ObjSurfaceSlotSegmentationAxis, 'vertical'>;
}

export interface V3ObjSurfaceReferenceReviewClassification {
  category: 'segmentation-review';
  blocksBodyRebuild: false;
  reason: string;
}

const SLOT_FAMILIES: readonly { family: V3ObjSurfaceSlotFamily; slots: readonly V3CharacterSlotId[] }[] = [
  { family: 'helmet', slots: ['helmet'] },
  { family: 'chest', slots: ['chest'] },
  { family: 'pelvis', slots: ['pelvis'] },
  { family: 'back', slots: ['back'] },
  { family: 'shoulder', slots: ['shoulderLeft', 'shoulderRight'] },
  { family: 'upperArm', slots: ['upperArmLeft', 'upperArmRight'] },
  { family: 'forearm', slots: ['forearmLeft', 'forearmRight'] },
  { family: 'hand', slots: ['handLeft', 'handRight'] },
  { family: 'thigh', slots: ['thighLeft', 'thighRight'] },
  { family: 'shin', slots: ['shinLeft', 'shinRight'] },
  { family: 'foot', slots: ['footLeft', 'footRight'] },
];

const PAIRED_SLOT_FAMILIES = [
  { family: 'shoulder', leftSlot: 'shoulderLeft', rightSlot: 'shoulderRight' },
  { family: 'upperArm', leftSlot: 'upperArmLeft', rightSlot: 'upperArmRight' },
  { family: 'forearm', leftSlot: 'forearmLeft', rightSlot: 'forearmRight' },
  { family: 'hand', leftSlot: 'handLeft', rightSlot: 'handRight' },
  { family: 'thigh', leftSlot: 'thighLeft', rightSlot: 'thighRight' },
  { family: 'shin', leftSlot: 'shinLeft', rightSlot: 'shinRight' },
  { family: 'foot', leftSlot: 'footLeft', rightSlot: 'footRight' },
] as const;

const MIN_SLOT_ROLE_COUNT = 2;
const PAIR_BALANCE_MIN = 0.9;

const FAMILY_BOUND_REVIEW_RULES: readonly {
  family: V3ObjSurfaceSlotFamily;
  axis: V3ObjSurfaceSlotSegmentationAxis;
  min?: number;
  max?: number;
}[] = [
  { family: 'helmet', axis: 'width', min: 0.22 },
  { family: 'helmet', axis: 'height', min: 0.16 },
  { family: 'chest', axis: 'width', min: 0.28 },
  { family: 'chest', axis: 'height', min: 0.16 },
  { family: 'shoulder', axis: 'height', min: 0.14 },
  { family: 'forearm', axis: 'width', max: 0.55 },
  { family: 'forearm', axis: 'vertical', max: 0.52 },
  { family: 'hand', axis: 'width', max: 0.55 },
  { family: 'hand', axis: 'vertical', max: 0.48 },
];

const FIT_GAP_SEGMENTATION_REVIEW_RULES: readonly {
  slot: V3ObjSurfaceSlotFamily;
  axes: readonly V3ObjSurfaceSlotSegmentationAxis[];
  directions: readonly V3ObjSurfaceSlotSegmentationDirection[];
  reason: string;
}[] = [
  {
    slot: 'forearm',
    axes: ['width', 'vertical'],
    directions: ['too-large', 'too-high'],
    reason: 'forearm exact-source slot family is wide/high enough to require segmentation review before body rebuild work',
  },
  {
    slot: 'hand',
    axes: ['width', 'vertical'],
    directions: ['too-large', 'too-high'],
    reason: 'hand exact-source slot family is wide/high enough to require segmentation review before body rebuild work',
  },
  {
    slot: 'helmet',
    axes: ['width', 'height', 'depth'],
    directions: ['too-small'],
    reason: 'helmet exact-source slot family is undersized enough to require segmentation review before body rebuild work',
  },
  {
    slot: 'shoulder',
    axes: ['width', 'height', 'depth'],
    directions: ['too-small'],
    reason: 'shoulder exact-source slot family is undersized enough to require segmentation review before body rebuild work',
  },
  {
    slot: 'chest',
    axes: ['width', 'height', 'depth'],
    directions: ['too-small'],
    reason: 'chest exact-source slot family is undersized enough to require segmentation review before body rebuild work',
  },
];

const TARGET_REVIEW_SLOTS = new Set<V3ObjSurfaceSlotFamily>(['upperArm', 'shin']);

const round = (value: number): number => Number(value.toFixed(6));

function ratio(value: number, total: number): number {
  return round(value / Math.max(1, total));
}

function balance(left: number, right: number): number {
  const max = Math.max(left, right);
  if (max <= 0) return 1;
  return round(Math.min(left, right) / max);
}

function diagnostic(input: Omit<V3ObjSurfaceSlotSegmentationDiagnostic, 'category' | 'blocksBodyRebuild'> & {
  category?: V3ObjSurfaceSlotSegmentationCategory;
  blocksBodyRebuild?: boolean;
}): V3ObjSurfaceSlotSegmentationDiagnostic {
  const category = input.category ?? 'segmentation-review';
  return {
    ...input,
    category,
    blocksBodyRebuild: input.blocksBodyRebuild ?? category === 'body-rebuild-blocker',
  };
}

function sourceSlotRoles(source: V3ObjSurfaceSlotSegmentationSource, slot: V3CharacterSlotId): string[] {
  const sourceSlot = source.slots[slot];
  return [...new Set((sourceSlot.roleHintIndexes ?? [])
    .map((index) => source.rolePalette[index])
    .filter((role): role is string => typeof role === 'string'))].sort();
}

function buildSlotRoleReports(source: V3ObjSurfaceSlotSegmentationSource): V3ObjSurfaceSlotRoleReport[] {
  return V3_CHARACTER_SLOT_IDS.map((slot) => {
    const roles = sourceSlotRoles(source, slot);
    return {
      slot,
      roleCount: roles.length,
      roles,
    };
  });
}

function unionFamilyBounds(
  source: V3ObjSurfaceSlotSegmentationSource,
  slots: readonly V3CharacterSlotId[]
): V3ObjSurfaceFamilyBoundsReport['bounds'] {
  const min: [number, number, number] = [
    Math.min(...slots.map((slot) => source.slots[slot].bounds.min[0])),
    Math.min(...slots.map((slot) => source.slots[slot].bounds.min[1])),
    Math.min(...slots.map((slot) => source.slots[slot].bounds.min[2])),
  ];
  const max: [number, number, number] = [
    Math.max(...slots.map((slot) => source.slots[slot].bounds.max[0])),
    Math.max(...slots.map((slot) => source.slots[slot].bounds.max[1])),
    Math.max(...slots.map((slot) => source.slots[slot].bounds.max[2])),
  ];
  return {
    min,
    max,
    size: [
      Math.max(0, max[0] - min[0] + 1),
      Math.max(0, max[1] - min[1] + 1),
      Math.max(0, max[2] - min[2] + 1),
    ],
  };
}

function buildFamilyBoundsReports(
  source: V3ObjSurfaceSlotSegmentationSource
): V3ObjSurfaceFamilyBoundsReport[] {
  const targetHeight = source.coordinateSystem.targetHeightVoxels;
  return SLOT_FAMILIES.map(({ family, slots }) => {
    const bounds = unionFamilyBounds(source, slots);
    return {
      family,
      slots: [...slots],
      bounds,
      ratios: {
        width: ratio(bounds.size[0], targetHeight),
        height: ratio(bounds.size[1], targetHeight),
        depth: ratio(bounds.size[2], targetHeight),
        verticalCenter: ratio((bounds.min[1] + bounds.max[1]) / 2, targetHeight),
      },
    };
  });
}

function ratioForAxis(
  report: V3ObjSurfaceFamilyBoundsReport,
  axis: V3ObjSurfaceSlotSegmentationAxis
): number {
  switch (axis) {
    case 'width': return report.ratios.width;
    case 'height': return report.ratios.height;
    case 'depth': return report.ratios.depth;
    case 'vertical': return report.ratios.verticalCenter;
  }
}

function buildSuspiciousFamilyBounds(
  familyBounds: readonly V3ObjSurfaceFamilyBoundsReport[]
): V3ObjSurfaceSuspiciousFamilyBound[] {
  const byFamily = new Map(familyBounds.map((entry) => [entry.family, entry]));
  const reviews: V3ObjSurfaceSuspiciousFamilyBound[] = [];

  for (const rule of FAMILY_BOUND_REVIEW_RULES) {
    const bounds = byFamily.get(rule.family);
    if (!bounds) continue;
    const value = ratioForAxis(bounds, rule.axis);
    const tooSmall = rule.min !== undefined && value < rule.min;
    const tooLarge = rule.max !== undefined && value > rule.max;
    if (!tooSmall && !tooLarge) continue;
    const threshold = rule.min ?? rule.max ?? value;
    const direction: V3ObjSurfaceSlotSegmentationDirection = rule.axis === 'vertical'
      ? tooLarge ? 'too-high' : 'too-low'
      : tooLarge ? 'too-large' : 'too-small';
    reviews.push({
      code: 'suspicious-family-bounds',
      category: 'segmentation-review',
      blocksBodyRebuild: false,
      family: rule.family,
      axis: rule.axis,
      direction,
      value,
      threshold,
      message: `${rule.family} exact OBJ ${rule.axis === 'vertical' ? 'vertical center' : rule.axis} is ${direction}; review source slot segmentation before treating this as a body rebuild blocker`,
    });
  }

  return reviews.sort((left, right) =>
    left.family.localeCompare(right.family) ||
    left.axis.localeCompare(right.axis)
  );
}

function buildPairedSlotSymmetry(
  source: V3ObjSurfaceSlotSegmentationSource
): V3ObjSurfacePairedSlotSymmetryReport[] {
  return PAIRED_SLOT_FAMILIES.map(({ family, leftSlot, rightSlot }) => {
    const left = source.slots[leftSlot];
    const right = source.slots[rightSlot];
    const boundsSizeBalance = {
      width: balance(left.bounds.size[0], right.bounds.size[0]),
      height: balance(left.bounds.size[1], right.bounds.size[1]),
      depth: balance(left.bounds.size[2], right.bounds.size[2]),
    };
    const voxelBalance = balance(left.voxelCount, right.voxelCount);
    const runBalance = balance(left.runCount, right.runCount);
    return {
      family,
      leftSlot,
      rightSlot,
      voxelBalance,
      runBalance,
      boundsSizeBalance,
      balanced: voxelBalance >= PAIR_BALANCE_MIN &&
        runBalance >= PAIR_BALANCE_MIN &&
        Object.values(boundsSizeBalance).every((entry) => entry >= PAIR_BALANCE_MIN),
    };
  });
}

function buildDiagnostics(input: {
  source: V3ObjSurfaceSlotSegmentationSource;
  coverage: V3ObjSurfaceSlotCoverageReport;
  roleDiversity: V3ObjSurfaceRoleDiversityReport;
  pairedSlotSymmetry: readonly V3ObjSurfacePairedSlotSymmetryReport[];
  suspiciousFamilyBounds: readonly V3ObjSurfaceSuspiciousFamilyBound[];
}): V3ObjSurfaceSlotSegmentationDiagnostic[] {
  const diagnostics: V3ObjSurfaceSlotSegmentationDiagnostic[] = [];

  for (const slot of input.coverage.emptySlots) {
    diagnostics.push(diagnostic({
      code: 'empty-slot',
      category: 'body-rebuild-blocker',
      slot,
      message: `${slot} has no exact OBJ surface voxels`,
    }));
  }

  if (input.source.metrics.excludedObjectCount > 0) {
    diagnostics.push(diagnostic({
      code: 'excluded-source-objects',
      value: input.source.metrics.excludedObjectCount,
      threshold: 0,
      message: `${input.source.metrics.excludedObjectCount} source object${input.source.metrics.excludedObjectCount === 1 ? '' : 's'} were excluded from body segmentation review`,
    }));
  }

  for (const slot of input.roleDiversity.lowDiversitySlots) {
    diagnostics.push(diagnostic({
      code: 'low-role-diversity',
      slot: slot.slot,
      value: slot.roleCount,
      threshold: input.roleDiversity.minSlotRoleCount,
      message: `${slot.slot} exact OBJ surface only exposes ${slot.roleCount} paint role${slot.roleCount === 1 ? '' : 's'}; review material segmentation before body rebuild work`,
    }));
  }

  for (const pair of input.pairedSlotSymmetry) {
    if (pair.balanced) continue;
    diagnostics.push(diagnostic({
      code: 'paired-slot-imbalance',
      family: pair.family,
      value: Math.min(pair.voxelBalance, pair.runBalance, ...Object.values(pair.boundsSizeBalance)),
      threshold: PAIR_BALANCE_MIN,
      message: `${pair.family} left/right exact OBJ slots are imbalanced; review paired-slot segmentation before body rebuild work`,
    }));
  }

  diagnostics.push(...input.suspiciousFamilyBounds);

  return diagnostics.sort((left, right) =>
    Number(left.blocksBodyRebuild) - Number(right.blocksBodyRebuild) ||
    left.code.localeCompare(right.code) ||
    (left.family ?? left.slot ?? '').localeCompare(right.family ?? right.slot ?? '')
  );
}

export function analyzeV3AegisObjSurfaceSlotSegmentation(
  source: V3ObjSurfaceSlotSegmentationSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE as V3ObjSurfaceSlotSegmentationSource
): V3ObjSurfaceSlotSegmentationReport {
  const emptySlots = V3_CHARACTER_SLOT_IDS.filter((slot) => source.slots[slot].voxelCount <= 0);
  const coverage = {
    expectedSlotCount: V3_CHARACTER_SLOT_IDS.length,
    coveredSlotCount: V3_CHARACTER_SLOT_IDS.length - emptySlots.length,
    emptySlots,
  };
  const slotRoleReports = buildSlotRoleReports(source);
  const roleDiversity = {
    palette: [...source.rolePalette],
    minSlotRoleCount: MIN_SLOT_ROLE_COUNT,
    lowDiversitySlots: slotRoleReports.filter((entry) =>
      source.slots[entry.slot].voxelCount > 0 &&
      entry.roleCount < MIN_SLOT_ROLE_COUNT
    ),
    slots: slotRoleReports,
  };
  const pairedSlotSymmetry = buildPairedSlotSymmetry(source);
  const familyBounds = buildFamilyBoundsReports(source);
  const suspiciousFamilyBounds = buildSuspiciousFamilyBounds(familyBounds);
  const diagnostics = buildDiagnostics({
    source,
    coverage,
    roleDiversity,
    pairedSlotSymmetry,
    suspiciousFamilyBounds,
  });
  const bodyRebuildBlockerCount = diagnostics.filter((entry) => entry.blocksBodyRebuild).length;
  const segmentationReviewCount = diagnostics.filter((entry) => entry.category === 'segmentation-review').length;

  return {
    ready: bodyRebuildBlockerCount === 0,
    sourceHash: source.source.hash,
    sourceFileName: source.source.fileName,
    coverage,
    roleDiversity,
    pairedSlotSymmetry,
    familyBounds,
    suspiciousFamilyBounds,
    excludedObjects: {
      count: source.metrics.excludedObjectCount,
      names: [...source.excludedObjects],
    },
    diagnostics,
    summary: {
      slotCount: V3_CHARACTER_SLOT_IDS.length,
      coveredSlotCount: coverage.coveredSlotCount,
      segmentationReviewCount,
      bodyRebuildBlockerCount,
      diagnosticCount: diagnostics.length,
      suspiciousFamilyBoundCount: suspiciousFamilyBounds.length,
      lowRoleDiversitySlotCount: roleDiversity.lowDiversitySlots.length,
      pairedSlotCount: pairedSlotSymmetry.length,
      excludedObjectCount: source.metrics.excludedObjectCount,
    },
  };
}

export function analyzeV3ObjSurfaceSlotSegmentation(
  source: V3ObjSurfaceSlotSegmentationSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE as V3ObjSurfaceSlotSegmentationSource
): V3ObjSurfaceSlotSegmentationReport {
  return analyzeV3AegisObjSurfaceSlotSegmentation(source);
}

export function classifyV3ObjSurfaceReferenceFitGapReview(
  input: V3ObjSurfaceReferenceFitGapReviewInput
): V3ObjSurfaceReferenceReviewClassification | null {
  const rule = FIT_GAP_SEGMENTATION_REVIEW_RULES.find((entry) =>
    entry.slot === input.slot &&
    entry.axes.includes(input.axis) &&
    entry.directions.includes(input.direction as V3ObjSurfaceSlotSegmentationDirection)
  );
  if (!rule) return null;
  return {
    category: 'segmentation-review',
    blocksBodyRebuild: false,
    reason: rule.reason,
  };
}

export function classifyV3ObjSurfaceReferenceTargetReview(
  input: V3ObjSurfaceReferenceTargetReviewInput
): V3ObjSurfaceReferenceReviewClassification | null {
  if (!TARGET_REVIEW_SLOTS.has(input.slot)) return null;
  return {
    category: 'segmentation-review',
    blocksBodyRebuild: false,
    reason: `${input.slot} reference ${input.axis} target needs OBJ slot segmentation review before body rebuild work`,
  };
}

export function formatV3ObjSurfaceSlotSegmentationSummary(
  report: V3ObjSurfaceSlotSegmentationReport
): string {
  if (report.summary.bodyRebuildBlockerCount > 0) {
    return `Exact OBJ Surface Slot Segmentation blocked: ${report.summary.bodyRebuildBlockerCount} body rebuild blocker${report.summary.bodyRebuildBlockerCount === 1 ? '' : 's'} and ${report.summary.segmentationReviewCount} segmentation review diagnostic${report.summary.segmentationReviewCount === 1 ? '' : 's'} across ${report.summary.coveredSlotCount}/${report.summary.slotCount} covered slots.`;
  }

  return `Exact OBJ Surface Slot Segmentation Review: ${report.summary.coveredSlotCount}/${report.summary.slotCount} slots covered; ${report.summary.segmentationReviewCount} segmentation review diagnostic${report.summary.segmentationReviewCount === 1 ? '' : 's'}; no body rebuild blockers.`;
}
