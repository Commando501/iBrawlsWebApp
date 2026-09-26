import type {
  CustomArmorGridScale,
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
  V3CustomArmorSlot,
} from '../customArmor';
import {
  V3_CUSTOM_ARMOR_SLOTS,
  dedupeCustomArmorVoxels,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  isVoxelInSlotBounds,
  validateCustomArmorPiece,
} from '../customArmor';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import type {
  V3SmartAuthoringVoxelDiff,
  V3SmartAuthoringVoxelRemapDiff,
} from './v3ArmorEditorSmartAuthoring';

export type V3ArmorCoverageScope = 'active-slot' | 'full-suit';
export type V3ArmorCoverageSeverity = 'high' | 'medium' | 'low';
export type V3ArmorCoverageRegion =
  | 'torsoCavity'
  | 'sideGap'
  | 'backGap'
  | 'slotSeam';
export type V3ArmorCoverageIssueClassification =
  | 'armor fill/coverage gap'
  | 'slot continuity break';

export interface V3ArmorCoverageInput {
  activeSlot: V3CustomArmorSlot;
  draft: CustomArmorPieceSnapshot;
  suitDrafts?: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>;
  scope?: V3ArmorCoverageScope;
}

export interface V3ArmorCoverageIssue {
  id: string;
  slot: V3CustomArmorSlot;
  region: V3ArmorCoverageRegion;
  severity: V3ArmorCoverageSeverity;
  classification: V3ArmorCoverageIssueClassification;
  message: string;
  missingVoxelCount: number;
  suggestedVoxels: CustomArmorVoxel[];
  reproductionHint: string;
}

export interface V3ArmorCoverageSummary {
  scope: V3ArmorCoverageScope;
  issueCount: number;
  highSeverityIssueCount: number;
  totalMissingVoxelCount: number;
  scannedSlotCount: number;
}

export interface V3ArmorCoverageReport {
  ready: boolean;
  score: number;
  issues: V3ArmorCoverageIssue[];
  summary: V3ArmorCoverageSummary;
  sourceSignature: string;
  sourceDraftsBySlot: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>;
}

export interface V3ArmorCoveragePatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface V3ArmorCoveragePatch {
  issueIds: string[];
  addedVoxelsBySlot: Partial<Record<V3CustomArmorSlot, CustomArmorVoxel[]>>;
  warnings: string[];
  validationResult: V3ArmorCoveragePatchValidationResult;
}

export interface V3ArmorCoveragePatchOptions {
  issueIds?: readonly string[];
  mirrorLocalX?: boolean;
}

export interface V3ArmorCoverageApplyOptions {
  now?: number;
}

export interface V3ArmorCoveragePreview {
  previewDraft: CustomArmorPieceSnapshot;
  changed: boolean;
  added: V3SmartAuthoringVoxelDiff[];
  removed: V3SmartAuthoringVoxelDiff[];
  remapped: V3SmartAuthoringVoxelRemapDiff[];
}

interface RegionMask {
  slot: V3CustomArmorSlot;
  region: V3ArmorCoverageRegion;
  classification: V3ArmorCoverageIssueClassification;
  severity: V3ArmorCoverageSeverity;
  message: string;
  minMissingCount: number;
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

interface SlotDraft {
  slot: V3CustomArmorSlot;
  draft: CustomArmorPieceSnapshot;
}

const CORE_COVERAGE_SLOTS = new Set<V3CustomArmorSlot>(['chest', 'pelvis', 'back']);
const V3_SLOT_SET = new Set<string>(V3_CUSTOM_ARMOR_SLOTS);
const FILL_ROLE: CustomArmorMaterialRole = 'undersuit';

const COVERAGE_MASKS: readonly RegionMask[] = [
  {
    slot: 'chest',
    region: 'torsoCavity',
    classification: 'armor fill/coverage gap',
    severity: 'high',
    message: 'Chest foundation fill is missing behind the front armor shell.',
    minMissingCount: 12,
    x: [0.30, 0.70],
    y: [0.34, 0.62],
    z: [0.34, 0.60],
  },
  {
    slot: 'pelvis',
    region: 'slotSeam',
    classification: 'slot continuity break',
    severity: 'medium',
    message: 'Pelvis upper seam does not provide enough coverage under the chest.',
    minMissingCount: 8,
    x: [0.32, 0.68],
    y: [0.68, 0.94],
    z: [0.34, 0.66],
  },
  {
    slot: 'back',
    region: 'backGap',
    classification: 'armor fill/coverage gap',
    severity: 'medium',
    message: 'Back plate coverage leaves the rear torso foundation exposed.',
    minMissingCount: 8,
    x: [0.28, 0.72],
    y: [0.34, 0.72],
    z: [0.18, 0.70],
  },
];

const cloneVoxel = (voxel: CustomArmorVoxel): CustomArmorVoxel => ({ ...voxel });

const cloneDraft = (draft: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot => ({
  ...draft,
  voxels: draft.voxels.map(cloneVoxel),
});

const coordKey = (voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

const stableVoxelSort = (
  a: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>,
  b: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>
): number => coordKey(a).localeCompare(coordKey(b));

function isV3DraftForSlot(
  slot: V3CustomArmorSlot,
  draft: CustomArmorPieceSnapshot | undefined
): draft is CustomArmorPieceSnapshot {
  return Boolean(draft)
    && draft!.slot === slot
    && getCustomArmorPieceModelSystem(draft!) === 'v3'
    && V3_SLOT_SET.has(draft!.slot);
}

function buildVoxelMap(voxels: readonly CustomArmorVoxel[]): Map<string, CustomArmorVoxel> {
  const map = new Map<string, CustomArmorVoxel>();
  for (const voxel of voxels) {
    map.set(coordKey(voxel), cloneVoxel(voxel));
  }
  return map;
}

function normalizeVoxels(
  slot: V3CustomArmorSlot,
  gridScale: CustomArmorGridScale,
  voxels: readonly CustomArmorVoxel[]
): CustomArmorVoxel[] {
  return dedupeCustomArmorVoxels(voxels
    .map(cloneVoxel)
    .filter((voxel) => isVoxelInSlotBounds(slot, voxel, 'medium', 'v3', gridScale)));
}

function scaledRange(maxInclusive: number, range: [number, number]): [number, number] {
  return [
    Math.max(0, Math.min(maxInclusive, Math.floor(maxInclusive * range[0]))),
    Math.max(0, Math.min(maxInclusive, Math.ceil(maxInclusive * range[1]))),
  ];
}

function buildMaskVoxels(mask: RegionMask, gridScale: CustomArmorGridScale): CustomArmorVoxel[] {
  const dimensions = getV3CharacterPartBounds(mask.slot).maxDimensions;
  const maxX = dimensions.x * gridScale - 1;
  const maxY = dimensions.y * gridScale - 1;
  const maxZ = dimensions.z * gridScale - 1;
  const [minX, rangeMaxX] = scaledRange(maxX, mask.x);
  const [minY, rangeMaxY] = scaledRange(maxY, mask.y);
  const [minZ, rangeMaxZ] = scaledRange(maxZ, mask.z);
  const voxels: CustomArmorVoxel[] = [];

  for (let y = minY; y <= rangeMaxY; y++) {
    for (let z = minZ; z <= rangeMaxZ; z++) {
      for (let x = minX; x <= rangeMaxX; x++) {
        voxels.push({ x, y, z, role: FILL_ROLE });
      }
    }
  }

  return voxels;
}

function sourceSignatureFor(slots: readonly SlotDraft[], scope: V3ArmorCoverageScope): string {
  return JSON.stringify({
    scope,
    slots: slots.map(({ slot, draft }) => ({
      slot,
      id: draft.id,
      updatedAt: draft.updatedAt,
      voxelCount: draft.voxels.length,
      gridScale: getCustomArmorGridScale(draft),
    })),
  });
}

function sourceDraftsBySlotFor(slots: readonly SlotDraft[]): Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>> {
  return Object.fromEntries(slots.map(({ slot, draft }) => [slot, cloneDraft(draft)]));
}

function getScannedDrafts(input: V3ArmorCoverageInput): SlotDraft[] {
  const scope = input.scope ?? 'active-slot';
  const staged = {
    ...(scope === 'full-suit' ? input.suitDrafts ?? {} : {}),
    [input.activeSlot]: input.draft,
  };
  const slots = scope === 'full-suit'
    ? V3_CUSTOM_ARMOR_SLOTS.filter((slot) => CORE_COVERAGE_SLOTS.has(slot))
    : [input.activeSlot];

  return slots
    .map((slot) => ({ slot, draft: staged[slot] }))
    .filter((entry): entry is SlotDraft => isV3DraftForSlot(entry.slot, entry.draft));
}

function issueForMask(draft: CustomArmorPieceSnapshot, mask: RegionMask): V3ArmorCoverageIssue | undefined {
  const gridScale = getCustomArmorGridScale(draft);
  const occupied = buildVoxelMap(normalizeVoxels(mask.slot, gridScale, draft.voxels));
  const missing = buildMaskVoxels(mask, gridScale)
    .filter((voxel) => !occupied.has(coordKey(voxel)))
    .sort(stableVoxelSort);

  if (missing.length < mask.minMissingCount) return undefined;

  return {
    id: `coverage:${mask.slot}:${mask.region}`,
    slot: mask.slot,
    region: mask.region,
    severity: mask.severity,
    classification: mask.classification,
    message: mask.message,
    missingVoxelCount: missing.length,
    suggestedVoxels: missing,
    reproductionHint: mask.slot === 'chest'
      ? 'Review Mesh2Motion bind/rest pose and sprint frame 82 for the open chest/torso cavity.'
      : 'Review bind/rest pose, sprint, slide, sword carry, and side/rear rig preview angles.',
  };
}

function scoreForIssues(issues: readonly V3ArmorCoverageIssue[]): number {
  const highCount = issues.filter((issue) => issue.severity === 'high').length;
  const mediumCount = issues.filter((issue) => issue.severity === 'medium').length;
  const lowCount = issues.filter((issue) => issue.severity === 'low').length;
  return Math.max(0, Math.min(100, 100 - (highCount * 35) - (mediumCount * 18) - (lowCount * 8)));
}

export function buildV3ArmorCoverageReport(input: V3ArmorCoverageInput): V3ArmorCoverageReport {
  const scope = input.scope ?? 'active-slot';
  const scannedDrafts = getScannedDrafts(input);
  const issues: V3ArmorCoverageIssue[] = [];

  for (const { slot, draft } of scannedDrafts) {
    const slotIssues: V3ArmorCoverageIssue[] = [];
    for (const mask of COVERAGE_MASKS) {
      if (mask.slot !== slot) continue;
      const issue = issueForMask(draft, mask);
      if (issue) slotIssues.push(issue);
    }
    const hasHighSlotIssue = slotIssues.some((issue) => issue.severity === 'high');
    issues.push(...(hasHighSlotIssue
      ? slotIssues.filter((issue) => issue.severity === 'high')
      : slotIssues));
  }

  issues.sort((a, b) => (
    severityRank(a.severity) - severityRank(b.severity)
    || a.slot.localeCompare(b.slot)
    || a.region.localeCompare(b.region)
  ));
  const highSeverityIssueCount = issues.filter((issue) => issue.severity === 'high').length;
  const totalMissingVoxelCount = issues.reduce((total, issue) => total + issue.missingVoxelCount, 0);

  return {
    ready: issues.length === 0,
    score: scoreForIssues(issues),
    issues,
    summary: {
      scope,
      issueCount: issues.length,
      highSeverityIssueCount,
      totalMissingVoxelCount,
      scannedSlotCount: scannedDrafts.length,
    },
    sourceSignature: sourceSignatureFor(scannedDrafts, scope),
    sourceDraftsBySlot: sourceDraftsBySlotFor(scannedDrafts),
  };
}

function severityRank(severity: V3ArmorCoverageSeverity): number {
  if (severity === 'high') return 0;
  if (severity === 'medium') return 1;
  return 2;
}

function createEmptyPatch(issueIds: readonly string[], warnings: string[]): V3ArmorCoveragePatch {
  return {
    issueIds: [...issueIds],
    addedVoxelsBySlot: {},
    warnings,
    validationResult: {
      valid: warnings.length === 0,
      errors: warnings,
      warnings,
    },
  };
}

function mirrorVoxelsForSlot(
  slot: V3CustomArmorSlot,
  gridScale: CustomArmorGridScale,
  voxels: readonly CustomArmorVoxel[]
): CustomArmorVoxel[] {
  const maxX = getV3CharacterPartBounds(slot).maxDimensions.x * gridScale - 1;
  return voxels.map((voxel) => ({
    ...voxel,
    x: maxX - voxel.x,
  }));
}

export function buildV3ArmorCoveragePatch(
  report: V3ArmorCoverageReport,
  options: V3ArmorCoveragePatchOptions = {}
): V3ArmorCoveragePatch {
  const allowedIssueIds = options.issueIds ? new Set(options.issueIds) : undefined;
  const issueIds: string[] = [];
  const addedVoxelsBySlot: Partial<Record<V3CustomArmorSlot, CustomArmorVoxel[]>> = {};
  const warnings: string[] = [];

  for (const issue of report.issues) {
    if (allowedIssueIds && !allowedIssueIds.has(issue.id)) continue;
    issueIds.push(issue.id);
    const gridScale = getCustomArmorGridScale(report.sourceDraftsBySlot[issue.slot] ?? { modelSystem: 'v3' });
    const additions = options.mirrorLocalX
      ? mirrorVoxelsForSlot(issue.slot, gridScale, issue.suggestedVoxels)
      : issue.suggestedVoxels;
    addedVoxelsBySlot[issue.slot] = [
      ...(addedVoxelsBySlot[issue.slot] ?? []),
      ...additions.map(cloneVoxel),
    ];
  }

  if (issueIds.length === 0) {
    return createEmptyPatch([], []);
  }

  for (const [slot, voxels] of Object.entries(addedVoxelsBySlot) as Array<[V3CustomArmorSlot, CustomArmorVoxel[]]>) {
    const sourceDraft = report.sourceDraftsBySlot[slot];
    const additions = dedupeCustomArmorVoxels(voxels).sort(stableVoxelSort);
    if (!sourceDraft) {
      addedVoxelsBySlot[slot] = [];
      warnings.push(`${slot} coverage fill skipped because the source draft is unavailable.`);
      continue;
    }
    const gridScale = getCustomArmorGridScale(sourceDraft);
    const candidate: CustomArmorPieceSnapshot = {
      ...sourceDraft,
      voxels: normalizeVoxels(slot, gridScale, [...sourceDraft.voxels, ...additions]),
    };
    const validation = validateCustomArmorPiece(candidate);
    if (!validation.valid) {
      addedVoxelsBySlot[slot] = [];
      warnings.push(`${slot} coverage fill exceeds voxel budget or validation limits: ${validation.errors[0] ?? 'invalid patch'}`);
      continue;
    }
    addedVoxelsBySlot[slot] = additions;
  }

  return {
    issueIds,
    addedVoxelsBySlot,
    warnings,
    validationResult: {
      valid: warnings.length === 0,
      errors: warnings,
      warnings,
    },
  };
}

function sameVoxelMaterial(a: CustomArmorVoxel, b: CustomArmorVoxel): boolean {
  return a.role === b.role && a.color === b.color && a.emissive === b.emissive;
}

function toVoxelDiff(voxel: CustomArmorVoxel): V3SmartAuthoringVoxelDiff {
  const diff: V3SmartAuthoringVoxelDiff = {
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    role: voxel.role,
  };
  if (voxel.color !== undefined) diff.color = voxel.color;
  if (voxel.emissive !== undefined) diff.emissive = voxel.emissive;
  return diff;
}

function buildVoxelDiff(
  before: readonly CustomArmorVoxel[],
  after: readonly CustomArmorVoxel[]
): Pick<V3ArmorCoveragePreview, 'changed' | 'added' | 'removed' | 'remapped'> {
  const beforeMap = buildVoxelMap(before);
  const afterMap = buildVoxelMap(after);
  const added: V3SmartAuthoringVoxelDiff[] = [];
  const removed: V3SmartAuthoringVoxelDiff[] = [];
  const remapped: V3SmartAuthoringVoxelRemapDiff[] = [];

  for (const [key, afterVoxel] of afterMap) {
    const beforeVoxel = beforeMap.get(key);
    if (!beforeVoxel) {
      added.push(toVoxelDiff(afterVoxel));
    } else if (!sameVoxelMaterial(beforeVoxel, afterVoxel)) {
      remapped.push({
        before: toVoxelDiff(beforeVoxel),
        after: toVoxelDiff(afterVoxel),
      });
    }
  }
  for (const [key, beforeVoxel] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push(toVoxelDiff(beforeVoxel));
    }
  }

  added.sort(stableVoxelSort);
  removed.sort(stableVoxelSort);
  remapped.sort((a, b) => stableVoxelSort(a.after, b.after));

  return {
    changed: added.length > 0 || removed.length > 0 || remapped.length > 0,
    added,
    removed,
    remapped,
  };
}

export function applyV3ArmorCoveragePatch(
  suitDrafts: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>,
  patch: V3ArmorCoveragePatch,
  options: V3ArmorCoverageApplyOptions = {}
): Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>> {
  const nextDrafts: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>> = { ...suitDrafts };

  for (const [slot, additions] of Object.entries(patch.addedVoxelsBySlot) as Array<[V3CustomArmorSlot, CustomArmorVoxel[]]>) {
    const draft = nextDrafts[slot];
    if (!isV3DraftForSlot(slot, draft) || additions.length === 0) continue;

    const gridScale = getCustomArmorGridScale(draft);
    const nextVoxels = normalizeVoxels(slot, gridScale, [...draft.voxels, ...additions]);
    const candidate: CustomArmorPieceSnapshot = {
      ...draft,
      voxels: nextVoxels,
      updatedAt: options.now ?? draft.updatedAt,
    };

    if (validateCustomArmorPiece(draft).valid && !validateCustomArmorPiece(candidate).valid) {
      nextDrafts[slot] = cloneDraft(draft);
    } else {
      nextDrafts[slot] = candidate;
    }
  }

  return nextDrafts;
}

export function buildV3ArmorCoveragePreview(
  draft: CustomArmorPieceSnapshot,
  patch: V3ArmorCoveragePatch
): V3ArmorCoveragePreview {
  const patched = applyV3ArmorCoveragePatch({ [draft.slot as V3CustomArmorSlot]: draft }, patch)[draft.slot as V3CustomArmorSlot]
    ?? cloneDraft(draft);
  const previewDraft = {
    ...patched,
    voxels: patched.voxels.map(cloneVoxel),
    updatedAt: draft.updatedAt,
  };
  const diff = buildVoxelDiff(draft.voxels, previewDraft.voxels);

  return {
    previewDraft,
    ...diff,
  };
}
