import type { V3ReferenceScaffold } from './v3ReferenceScaffold';
import {
  V3_AEGIS_PART_SPECS,
  type V3AegisPartSpec,
} from '../components/v3/v3AegisSuitParts';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import { V3_CHARACTER_PART_BOUNDS } from '../components/v3/v3PartBounds';
import {
  analyzeV3AegisReferenceProportions,
  V3_OBJ_REFERENCE_PROPORTION_TARGETS,
  V3_REFERENCE_PROPORTION_BANDS,
  type V3ReferenceProportionBandId,
  type V3ReferenceProportionTargets,
} from '../components/v3/v3ReferenceProportions';

type Vec3 = [number, number, number];

export type V3AegisCalibrationHardGateStatus = 'accepted' | 'rejected';

export interface V3AegisCalibrationSlotPatch {
  dimensions?: Vec3;
  position?: Vec3;
}

export interface V3AegisCalibrationPatch {
  slots: Partial<Record<V3CharacterSlotId, V3AegisCalibrationSlotPatch>>;
}

export interface V3AegisCalibrationCandidateInput {
  id: string;
  scope: string;
  patch: V3AegisCalibrationPatch;
}

export interface V3AegisCalibrationBandSummary {
  id: V3ReferenceProportionBandId;
  widthRatio: number;
  depthRatio: number;
  widthDelta: number;
  depthDelta: number;
}

export interface V3AegisCalibrationProportionSummary {
  globalFrontWidthRatio: number;
  globalSideDepthRatio: number;
  globalFrontWidthDelta: number;
  globalSideDepthDelta: number;
  maxBandWidthDelta: number;
  maxBandDepthDelta: number;
  worstWidthBand: V3ReferenceProportionBandId;
  worstDepthBand: V3ReferenceProportionBandId;
  bands: V3AegisCalibrationBandSummary[];
}

export interface V3AegisCalibrationCandidate extends V3AegisCalibrationCandidateInput {
  scoreBefore: number;
  scoreAfter: number;
  improvement: number;
  hardGateStatus: V3AegisCalibrationHardGateStatus;
  rejectionReasons: string[];
  beforeSummary: V3AegisCalibrationProportionSummary;
  afterSummary: V3AegisCalibrationProportionSummary;
}

export interface V3AegisCalibrationReport {
  sourceLabel: string;
  sourceKind: string;
  hardGateStatus: V3AegisCalibrationHardGateStatus;
  rejectionReasons: string[];
  scoreBefore: number;
  scoreAfter: number;
  improvement: number;
  beforeSummary: V3AegisCalibrationProportionSummary | null;
  afterSummary: V3AegisCalibrationProportionSummary | null;
  candidates: V3AegisCalibrationCandidate[];
}

export interface V3AegisCalibrationOptions {
  maxCandidates?: number;
}

export interface V3AegisAppliedCalibration {
  specs: Record<V3CharacterSlotId, V3AegisPartSpec>;
  patch: V3AegisCalibrationPatch;
}

const VOXEL_WORLD_UNIT = 0.04;
const MIN_PART_DIMENSION = 2;
const PAIR_EPSILON = 0.0001;
const CANONICAL_TARGET_EPSILON = 0.0005;

const MIRRORED_SLOT_PAIRS = [
  ['shoulderLeft', 'shoulderRight'],
  ['upperArmLeft', 'upperArmRight'],
  ['forearmLeft', 'forearmRight'],
  ['handLeft', 'handRight'],
  ['thighLeft', 'thighRight'],
  ['shinLeft', 'shinRight'],
  ['footLeft', 'footRight'],
] as const satisfies readonly (readonly [V3CharacterSlotId, V3CharacterSlotId])[];

const BASE_ENVELOPE_GROUPS = [
  {
    id: 'base-envelope-global',
    slots: V3_CHARACTER_SLOT_IDS,
    centerScale: true,
  },
  {
    id: 'base-envelope-torso',
    slots: ['helmet', 'neck', 'chest', 'pelvis', 'back'] as const,
    centerScale: false,
  },
  {
    id: 'base-envelope-limbs',
    slots: [
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
      'footLeft',
      'footRight',
    ] as const,
    centerScale: true,
  },
] as const;

const roundMetric = (value: number): number => Number(value.toFixed(6));
const roundPatchNumber = (value: number): number => Number(value.toFixed(4));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function cloneBaseSpecs(): Record<V3CharacterSlotId, V3AegisPartSpec> {
  return Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => {
    const spec = V3_AEGIS_PART_SPECS[slot];
    return [slot, {
      segment: spec.segment,
      dimensions: [...spec.dimensions],
      position: [...spec.position],
    }];
  })) as Record<V3CharacterSlotId, V3AegisPartSpec>;
}

function sanitizeVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const next = value.map((entry) => (
    typeof entry === 'number' && Number.isFinite(entry) ? roundPatchNumber(entry) : undefined
  ));
  if (next.some((entry) => entry === undefined)) return undefined;
  return next as Vec3;
}

function sanitizePatch(patch: V3AegisCalibrationPatch): V3AegisCalibrationPatch {
  const slots: Partial<Record<V3CharacterSlotId, V3AegisCalibrationSlotPatch>> = {};
  const sourceSlots = patch?.slots ?? {};

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const sourcePatch = sourceSlots[slot];
    if (!sourcePatch) continue;
    const sanitizedSlot: V3AegisCalibrationSlotPatch = {};
    const dimensions = sanitizeVec3(sourcePatch.dimensions);
    const position = sanitizeVec3(sourcePatch.position);
    if (dimensions) sanitizedSlot.dimensions = dimensions;
    if (position) sanitizedSlot.position = position;
    if (sanitizedSlot.dimensions || sanitizedSlot.position) {
      slots[slot] = sanitizedSlot;
    }
  }

  return { slots };
}

function applyPatchToSpecs(
  patch: V3AegisCalibrationPatch,
  baseSpecs = cloneBaseSpecs()
): Record<V3CharacterSlotId, V3AegisPartSpec> {
  const sanitized = sanitizePatch(patch);
  const specs = cloneSpecs(baseSpecs);

  for (const [slot, slotPatch] of Object.entries(sanitized.slots) as [V3CharacterSlotId, V3AegisCalibrationSlotPatch][]) {
    if (slotPatch.dimensions) specs[slot].dimensions = [...slotPatch.dimensions];
    if (slotPatch.position) specs[slot].position = [...slotPatch.position];
  }

  return specs;
}

function cloneSpecs(
  specs: Record<V3CharacterSlotId, V3AegisPartSpec>
): Record<V3CharacterSlotId, V3AegisPartSpec> {
  return Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
    slot,
    {
      segment: specs[slot].segment,
      dimensions: [...specs[slot].dimensions],
      position: [...specs[slot].position],
    },
  ])) as Record<V3CharacterSlotId, V3AegisPartSpec>;
}

function assignRuntimeAegisSpecs(specs: Record<V3CharacterSlotId, V3AegisPartSpec>): void {
  const mutableSpecs = V3_AEGIS_PART_SPECS as unknown as Record<V3CharacterSlotId, V3AegisPartSpec>;
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    mutableSpecs[slot].dimensions = [...specs[slot].dimensions];
    mutableSpecs[slot].position = [...specs[slot].position];
  }
}

function withTemporaryRuntimeAegisSpecs<T>(
  specs: Record<V3CharacterSlotId, V3AegisPartSpec>,
  callback: () => T
): T {
  const originalSpecs = cloneBaseSpecs();
  try {
    assignRuntimeAegisSpecs(specs);
    return callback();
  } finally {
    assignRuntimeAegisSpecs(originalSpecs);
  }
}

function slotEnvelope(spec: V3AegisPartSpec): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  return {
    minX: spec.position[0],
    maxX: spec.position[0] + spec.dimensions[0] * VOXEL_WORLD_UNIT,
    minY: spec.position[1],
    maxY: spec.position[1] + spec.dimensions[1] * VOXEL_WORLD_UNIT,
    minZ: spec.position[2],
    maxZ: spec.position[2] + spec.dimensions[2] * VOXEL_WORLD_UNIT,
  };
}

function buildModelEnvelope(specs: Record<V3CharacterSlotId, V3AegisPartSpec>) {
  const envelopes = V3_CHARACTER_SLOT_IDS.map((slot) => slotEnvelope(specs[slot]));
  return {
    minX: Math.min(...envelopes.map((entry) => entry.minX)),
    maxX: Math.max(...envelopes.map((entry) => entry.maxX)),
    minY: Math.min(...envelopes.map((entry) => entry.minY)),
    maxY: Math.max(...envelopes.map((entry) => entry.maxY)),
    minZ: Math.min(...envelopes.map((entry) => entry.minZ)),
    maxZ: Math.max(...envelopes.map((entry) => entry.maxZ)),
  };
}

function summarizeSpecsAgainstTargets(
  specs: Record<V3CharacterSlotId, V3AegisPartSpec>,
  targets: V3ReferenceProportionTargets
): V3AegisCalibrationProportionSummary {
  const model = buildModelEnvelope(specs);
  const height = Math.max(0.0001, model.maxY - model.minY);
  const globalFrontWidthRatio = roundMetric((model.maxX - model.minX) / height);
  const globalSideDepthRatio = roundMetric((model.maxZ - model.minZ) / height);

  const bands = V3_REFERENCE_PROPORTION_BANDS.map((band, index) => {
    const bandMinY = model.minY + (index / V3_REFERENCE_PROPORTION_BANDS.length) * height;
    const bandMaxY = model.minY + ((index + 1) / V3_REFERENCE_PROPORTION_BANDS.length) * height;
    const intersecting = V3_CHARACTER_SLOT_IDS
      .map((slot) => slotEnvelope(specs[slot]))
      .filter((envelope) => envelope.maxY >= bandMinY && envelope.minY <= bandMaxY);
    const minX = intersecting.length > 0 ? Math.min(...intersecting.map((entry) => entry.minX)) : model.minX;
    const maxX = intersecting.length > 0 ? Math.max(...intersecting.map((entry) => entry.maxX)) : model.maxX;
    const minZ = intersecting.length > 0 ? Math.min(...intersecting.map((entry) => entry.minZ)) : model.minZ;
    const maxZ = intersecting.length > 0 ? Math.max(...intersecting.map((entry) => entry.maxZ)) : model.maxZ;
    const widthRatio = roundMetric((maxX - minX) / height);
    const depthRatio = roundMetric((maxZ - minZ) / height);
    const target = targets.bands[band];
    return {
      id: band,
      widthRatio,
      depthRatio,
      widthDelta: roundMetric(Math.abs(widthRatio - target.widthRatio)),
      depthDelta: roundMetric(Math.abs(depthRatio - target.depthRatio)),
    };
  });
  const worstWidth = bands.reduce((best, band) => (
    band.widthDelta > best.widthDelta ? band : best
  ), bands[0]);
  const worstDepth = bands.reduce((best, band) => (
    band.depthDelta > best.depthDelta ? band : best
  ), bands[0]);

  return {
    globalFrontWidthRatio,
    globalSideDepthRatio,
    globalFrontWidthDelta: roundMetric(Math.abs(globalFrontWidthRatio - targets.global.front.widthRatio)),
    globalSideDepthDelta: roundMetric(Math.abs(globalSideDepthRatio - targets.global.side.widthRatio)),
    maxBandWidthDelta: worstWidth.widthDelta,
    maxBandDepthDelta: worstDepth.depthDelta,
    worstWidthBand: worstWidth.id,
    worstDepthBand: worstDepth.id,
    bands,
  };
}

function scoreSummary(summary: V3AegisCalibrationProportionSummary): number {
  const averageBandDelta = summary.bands.reduce((total, band) => (
    total + band.widthDelta + band.depthDelta
  ), 0) / Math.max(1, summary.bands.length);
  return roundMetric(
    summary.globalFrontWidthDelta * 4 +
    summary.globalSideDepthDelta * 4 +
    summary.maxBandWidthDelta * 2 +
    summary.maxBandDepthDelta * 2 +
    averageBandDelta
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scaffoldSourceKind(scaffold: unknown): string {
  if (!isRecord(scaffold)) return 'missing';
  if (isRecord(scaffold.source) && typeof scaffold.source.kind === 'string') return scaffold.source.kind;
  if (typeof scaffold.sourceKind === 'string') return scaffold.sourceKind;
  if (isRecord(scaffold.metadata) && typeof scaffold.metadata.kind === 'string') return scaffold.metadata.kind;
  if (isRecord(scaffold.proportionTargets) && typeof scaffold.proportionTargets.sourceKind === 'string') {
    return scaffold.proportionTargets.sourceKind;
  }
  return 'unknown';
}

function scaffoldSourceLabel(scaffold: unknown): string {
  if (!isRecord(scaffold)) return 'missing scaffold';
  if (isRecord(scaffold.source) && typeof scaffold.source.label === 'string') return sanitizeScaffoldSourceLabel(scaffold.source.label);
  if (isRecord(scaffold.source) && typeof scaffold.source.fileName === 'string') return sanitizeScaffoldSourceLabel(scaffold.source.fileName);
  if (typeof scaffold.sourceLabel === 'string') return sanitizeScaffoldSourceLabel(scaffold.sourceLabel);
  if (isRecord(scaffold.metadata) && typeof scaffold.metadata.fileName === 'string') {
    return sanitizeScaffoldSourceLabel(scaffold.metadata.fileName);
  }
  if (isRecord(scaffold.proportionTargets) && typeof scaffold.proportionTargets.sourceLabel === 'string') {
    return sanitizeScaffoldSourceLabel(scaffold.proportionTargets.sourceLabel);
  }
  return 'unknown scaffold';
}

function sanitizeScaffoldSourceLabel(value: string): string {
  const normalized = value.trim().replace(/^file:\/+/i, '');
  const label = normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
  return label.length > 0 ? label : 'unknown scaffold';
}

function extractTargets(scaffold: unknown): V3ReferenceProportionTargets | undefined {
  if (!isRecord(scaffold)) return undefined;
  const nativeTargets = extractNativeScaffoldTargets(scaffold);
  if (nativeTargets) return nativeTargets;

  const candidates = [
    scaffold.proportionTargets,
    scaffold.targets,
    scaffold.proportions,
  ];
  for (const candidate of candidates) {
    if (isReferenceTargets(candidate)) return candidate;
  }
  return undefined;
}

function extractNativeScaffoldTargets(scaffold: Record<string, unknown>): V3ReferenceProportionTargets | undefined {
  if (!isRecord(scaffold.globalRatios) || !Array.isArray(scaffold.verticalBands)) return undefined;
  const globalRatios = scaffold.globalRatios;
  const verticalBands = scaffold.verticalBands;
  if (
    typeof globalRatios.widthToHeight !== 'number' ||
    typeof globalRatios.depthToHeight !== 'number' ||
    !Number.isFinite(globalRatios.widthToHeight) ||
    !Number.isFinite(globalRatios.depthToHeight)
  ) {
    return undefined;
  }

  const bands = Object.fromEntries(V3_REFERENCE_PROPORTION_BANDS.map((band) => {
    const scaffoldBand = verticalBands.find((entry) => (
      isRecord(entry) &&
      entry.id === band &&
      typeof entry.widthRatio === 'number' &&
      typeof entry.depthRatio === 'number' &&
      Number.isFinite(entry.widthRatio) &&
      Number.isFinite(entry.depthRatio)
    )) as Record<string, unknown> | undefined;
    if (!scaffoldBand) return [band, undefined];
    return [band, {
      widthRatio: roundMetric(scaffoldBand.widthRatio as number),
      depthRatio: roundMetric(scaffoldBand.depthRatio as number),
    }];
  }));

  if (Object.values(bands).some((band) => band === undefined)) return undefined;

  return {
    sourceLabel: scaffoldSourceLabel(scaffold),
    sourceKind: scaffoldSourceKind(scaffold) === 'obj' ? 'obj' : 'dashboard',
    global: {
      front: {
        widthRatio: roundMetric(globalRatios.widthToHeight),
        heightRatio: 1,
        areaRatio: roundMetric(globalRatios.widthToHeight),
      },
      side: {
        widthRatio: roundMetric(globalRatios.depthToHeight),
        heightRatio: 1,
        areaRatio: roundMetric(globalRatios.depthToHeight),
      },
    },
    bands: bands as V3ReferenceProportionTargets['bands'],
  };
}

function isReferenceTargets(value: unknown): value is V3ReferenceProportionTargets {
  return (
    isRecord(value) &&
    typeof value.sourceLabel === 'string' &&
    isRecord(value.global) &&
    isRecord(value.global.front) &&
    isRecord(value.global.side) &&
    typeof value.global.front.widthRatio === 'number' &&
    typeof value.global.side.widthRatio === 'number' &&
    isRecord(value.bands) &&
    V3_REFERENCE_PROPORTION_BANDS.every((band) => (
      isRecord(value.bands[band]) &&
      typeof value.bands[band].widthRatio === 'number' &&
      typeof value.bands[band].depthRatio === 'number'
    ))
  );
}

function validateScaffold(scaffold: V3ReferenceScaffold): string[] {
  const reasons: string[] = [];
  if (!isRecord(scaffold)) {
    return ['missing scaffold'];
  }
  if (scaffoldSourceKind(scaffold) !== 'obj') {
    reasons.push('non-OBJ scaffold is not eligible for auto-calibration');
  }
  if (!extractTargets(scaffold)) {
    reasons.push('missing OBJ scaffold proportion targets');
  }
  return reasons;
}

function buildBaseEnvelopeCandidates(
  targets: V3ReferenceProportionTargets
): V3AegisCalibrationCandidateInput[] {
  const baseSpecs = cloneBaseSpecs();
  const before = summarizeSpecsAgainstTargets(baseSpecs, targets);
  const widthScale = clamp(targets.global.front.widthRatio / Math.max(0.0001, before.globalFrontWidthRatio), 0.65, 1.25);
  const depthScale = clamp(targets.global.side.widthRatio / Math.max(0.0001, before.globalSideDepthRatio), 0.65, 1.25);

  return BASE_ENVELOPE_GROUPS.map((group) => ({
    id: group.id,
    scope: 'base-envelope',
    patch: buildScaledPatch([...group.slots], widthScale, depthScale, group.centerScale),
  }));
}

function buildScaledPatch(
  slots: readonly V3CharacterSlotId[],
  widthScale: number,
  depthScale: number,
  scaleCenters: boolean
): V3AegisCalibrationPatch {
  const baseSpecs = cloneBaseSpecs();
  const patch: V3AegisCalibrationPatch = { slots: {} };
  const model = buildModelEnvelope(baseSpecs);
  const modelCenterX = (model.minX + model.maxX) / 2;

  for (const slot of slots) {
    const spec = baseSpecs[slot];
    const dimensions: Vec3 = [
      clampDimension(slot, 0, Math.round(spec.dimensions[0] * widthScale)),
      spec.dimensions[1],
      clampDimension(slot, 2, Math.round(spec.dimensions[2] * depthScale)),
    ];
    const oldWidth = spec.dimensions[0] * VOXEL_WORLD_UNIT;
    const newWidth = dimensions[0] * VOXEL_WORLD_UNIT;
    const oldDepth = spec.dimensions[2] * VOXEL_WORLD_UNIT;
    const newDepth = dimensions[2] * VOXEL_WORLD_UNIT;
    const oldCenterX = spec.position[0] + oldWidth / 2;
    const newCenterX = scaleCenters
      ? modelCenterX + (oldCenterX - modelCenterX) * widthScale
      : oldCenterX;
    patch.slots[slot] = {
      dimensions,
      position: [
        roundPatchNumber(newCenterX - newWidth / 2),
        spec.position[1],
        roundPatchNumber(spec.position[2] + (oldDepth - newDepth) / 2),
      ],
    };
  }

  enforceMirroredPairPatches(patch, widthScale, slots);
  return sanitizePatch(patch);
}

function clampDimension(slot: V3CharacterSlotId, axis: 0 | 1 | 2, value: number): number {
  const bounds = V3_CHARACTER_PART_BOUNDS[slot].maxDimensions;
  const max = axis === 0 ? bounds.x : axis === 1 ? bounds.y : bounds.z;
  return Math.round(clamp(value, MIN_PART_DIMENSION, max));
}

function enforceMirroredPairPatches(
  patch: V3AegisCalibrationPatch,
  centerScale: number,
  touchedSlots: readonly V3CharacterSlotId[]
): void {
  const touched = new Set(touchedSlots);
  for (const [left, right] of MIRRORED_SLOT_PAIRS) {
    if (!touched.has(left) || !touched.has(right)) continue;
    const leftPatch = patch.slots[left];
    const rightPatch = patch.slots[right];
    if (!leftPatch?.dimensions || !rightPatch?.dimensions || !leftPatch.position || !rightPatch.position) {
      continue;
    }
    const baseLeft = V3_AEGIS_PART_SPECS[left];
    const baseRight = V3_AEGIS_PART_SPECS[right];
    const baseLeftCenter = baseLeft.position[0] + (baseLeft.dimensions[0] * VOXEL_WORLD_UNIT) / 2;
    const baseRightCenter = baseRight.position[0] + (baseRight.dimensions[0] * VOXEL_WORLD_UNIT) / 2;
    const midpoint = (baseLeftCenter + baseRightCenter) / 2;
    const offset = ((baseRightCenter - baseLeftCenter) / 2) * centerScale;
    const width = leftPatch.dimensions[0] * VOXEL_WORLD_UNIT;
    const sharedZ = roundPatchNumber((leftPatch.position[2] + rightPatch.position[2]) / 2);

    rightPatch.dimensions = [...leftPatch.dimensions];
    leftPatch.position = [
      roundPatchNumber(midpoint - offset - width / 2),
      roundPatchNumber(baseLeft.position[1]),
      sharedZ,
    ];
    rightPatch.position = [
      roundPatchNumber(midpoint + offset - width / 2),
      roundPatchNumber(baseRight.position[1]),
      sharedZ,
    ];
  }
}

function validateSpecs(specs: Record<V3CharacterSlotId, V3AegisPartSpec>): string[] {
  const reasons: string[] = [];

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const spec = specs[slot];
    const numbers = [...spec.dimensions, ...spec.position];
    if (numbers.some((value) => !Number.isFinite(value))) {
      reasons.push(`${slot} contains non-finite numbers`);
    }
    if (spec.dimensions.some((value) => value < MIN_PART_DIMENSION)) {
      reasons.push(`${slot} has collapsed limb or part dimensions`);
    }
    const bounds = V3_CHARACTER_PART_BOUNDS[slot].maxDimensions;
    if (
      spec.dimensions[0] > bounds.x ||
      spec.dimensions[1] > bounds.y ||
      spec.dimensions[2] > bounds.z
    ) {
      reasons.push(`${slot} dimensions are outside V3 fit bounds`);
    }
  }

  for (const [left, right] of MIRRORED_SLOT_PAIRS) {
    const leftSpec = specs[left];
    const rightSpec = specs[right];
    const baseLeft = V3_AEGIS_PART_SPECS[left];
    const baseRight = V3_AEGIS_PART_SPECS[right];
    const baseMidpoint = (
      baseLeft.position[0] +
      (baseLeft.dimensions[0] * VOXEL_WORLD_UNIT) / 2 +
      baseRight.position[0] +
      (baseRight.dimensions[0] * VOXEL_WORLD_UNIT) / 2
    ) / 2;
    const leftCenter = leftSpec.position[0] + (leftSpec.dimensions[0] * VOXEL_WORLD_UNIT) / 2;
    const rightCenter = rightSpec.position[0] + (rightSpec.dimensions[0] * VOXEL_WORLD_UNIT) / 2;
    const mirroredOffsetDelta = Math.abs(Math.abs(leftCenter - baseMidpoint) - Math.abs(rightCenter - baseMidpoint));
    if (
      !sameVec(leftSpec.dimensions, rightSpec.dimensions) ||
      Math.abs(leftSpec.position[1] - rightSpec.position[1]) > PAIR_EPSILON ||
      Math.abs(leftSpec.position[2] - rightSpec.position[2]) > PAIR_EPSILON ||
      mirroredOffsetDelta > PAIR_EPSILON
    ) {
      reasons.push(`${left}/${right} left/right asymmetry`);
    }
  }

  return [...new Set(reasons)];
}

function matchesCanonicalObjTarget(value: number, target: number): boolean {
  return Math.abs(value - target) <= CANONICAL_TARGET_EPSILON;
}

function isCanonicalObjReferenceTarget(targets: V3ReferenceProportionTargets): boolean {
  return (
    targets.sourceKind === 'obj' &&
    matchesCanonicalObjTarget(
      targets.global.front.widthRatio,
      V3_OBJ_REFERENCE_PROPORTION_TARGETS.global.front.widthRatio
    ) &&
    matchesCanonicalObjTarget(
      targets.global.side.widthRatio,
      V3_OBJ_REFERENCE_PROPORTION_TARGETS.global.side.widthRatio
    )
  );
}

function validateRenderedCanonicalProportions(
  specs: Record<V3CharacterSlotId, V3AegisPartSpec>,
  targets: V3ReferenceProportionTargets
): string[] {
  if (!isCanonicalObjReferenceTarget(targets)) return [];

  const report = withTemporaryRuntimeAegisSpecs(specs, () => (
    analyzeV3AegisReferenceProportions({ targets })
  ));
  if (report.ready) return [];

  return report.issues.map((issue) => (
    `rendered OBJ proportion gate failed: ${issue.message}`
  ));
}

function sameVec(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => (
    Math.abs(value - right[index]) <= PAIR_EPSILON
  ));
}

export function scoreV3AegisCalibrationCandidate(
  candidate: V3AegisCalibrationCandidateInput,
  scaffold: V3ReferenceScaffold
): V3AegisCalibrationCandidate {
  const scaffoldReasons = validateScaffold(scaffold);
  const targets = extractTargets(scaffold) ?? V3_OBJ_REFERENCE_PROPORTION_TARGETS;
  const baseSpecs = cloneBaseSpecs();
  const sanitizedPatch = sanitizePatch(candidate.patch);
  const nextSpecs = applyPatchToSpecs(sanitizedPatch, baseSpecs);
  const beforeSummary = summarizeSpecsAgainstTargets(baseSpecs, targets);
  const afterSummary = summarizeSpecsAgainstTargets(nextSpecs, targets);
  const scoreBefore = scoreSummary(beforeSummary);
  const scoreAfter = scoreSummary(afterSummary);
  const improvement = roundMetric(scoreBefore - scoreAfter);
  const rejectionReasons = [
    ...scaffoldReasons,
    ...validateSpecs(nextSpecs),
    ...validateRenderedCanonicalProportions(nextSpecs, targets),
  ];

  if (improvement <= 0) {
    rejectionReasons.push('candidate does not improve Aegis proportion score');
  }

  return {
    id: candidate.id,
    scope: candidate.scope,
    patch: sanitizedPatch,
    scoreBefore,
    scoreAfter,
    improvement,
    hardGateStatus: rejectionReasons.length > 0 ? 'rejected' : 'accepted',
    rejectionReasons: [...new Set(rejectionReasons)],
    beforeSummary,
    afterSummary,
  };
}

export function buildV3AegisCalibrationCandidates(
  scaffold: V3ReferenceScaffold,
  options: V3AegisCalibrationOptions = {}
): V3AegisCalibrationReport {
  const scaffoldReasons = validateScaffold(scaffold);
  const targets = extractTargets(scaffold);
  const sourceLabel = scaffoldSourceLabel(scaffold);
  const sourceKind = scaffoldSourceKind(scaffold);

  if (scaffoldReasons.length > 0 || !targets) {
    return {
      sourceLabel,
      sourceKind,
      hardGateStatus: 'rejected',
      rejectionReasons: scaffoldReasons,
      scoreBefore: 0,
      scoreAfter: 0,
      improvement: 0,
      beforeSummary: null,
      afterSummary: null,
      candidates: [],
    };
  }

  const candidates = buildBaseEnvelopeCandidates(targets)
    .map((candidate) => scoreV3AegisCalibrationCandidate(candidate, scaffold))
    .sort((left, right) => {
      if (left.hardGateStatus !== right.hardGateStatus) {
        return left.hardGateStatus === 'accepted' ? -1 : 1;
      }
      if (left.hardGateStatus === 'accepted' && left.improvement !== right.improvement) {
        return right.improvement - left.improvement;
      }
      if (left.scoreAfter !== right.scoreAfter) return left.scoreAfter - right.scoreAfter;
      if (left.scope !== right.scope) return left.scope.localeCompare(right.scope);
      return left.id.localeCompare(right.id);
    })
    .slice(0, options.maxCandidates ?? Number.POSITIVE_INFINITY);
  const best = candidates.find((candidate) => candidate.hardGateStatus === 'accepted') ?? candidates[0];

  return {
    sourceLabel,
    sourceKind,
    hardGateStatus: best?.hardGateStatus ?? 'rejected',
    rejectionReasons: best?.rejectionReasons ?? ['no calibration candidates generated'],
    scoreBefore: best?.scoreBefore ?? 0,
    scoreAfter: best?.scoreAfter ?? 0,
    improvement: best?.improvement ?? 0,
    beforeSummary: best?.beforeSummary ?? null,
    afterSummary: best?.afterSummary ?? null,
    candidates,
  };
}

export function applyV3AegisCalibrationCandidate(
  candidate: V3AegisCalibrationCandidate
): V3AegisAppliedCalibration {
  if (candidate.hardGateStatus !== 'accepted') {
    throw new Error(`Cannot apply rejected V3 Aegis calibration candidate: ${candidate.id}`);
  }
  const patch = sanitizePatch(candidate.patch);
  return {
    specs: applyPatchToSpecs(patch),
    patch,
  };
}

export function formatV3AegisCalibrationReport(report: V3AegisCalibrationReport): string {
  const lines = [
    `V3 Aegis auto-calibration ${report.hardGateStatus} for ${report.sourceLabel} (${report.sourceKind}).`,
    `score ${report.scoreBefore.toFixed(6)} -> ${report.scoreAfter.toFixed(6)}; improvement ${report.improvement.toFixed(6)}.`,
  ];

  if (report.beforeSummary && report.afterSummary) {
    lines.push(
      `front width ${report.beforeSummary.globalFrontWidthRatio.toFixed(6)} -> ${report.afterSummary.globalFrontWidthRatio.toFixed(6)}; ` +
      `side depth ${report.beforeSummary.globalSideDepthRatio.toFixed(6)} -> ${report.afterSummary.globalSideDepthRatio.toFixed(6)}.`
    );
    lines.push(
      `worst bands width ${report.afterSummary.worstWidthBand} ${report.afterSummary.maxBandWidthDelta.toFixed(6)}, ` +
      `depth ${report.afterSummary.worstDepthBand} ${report.afterSummary.maxBandDepthDelta.toFixed(6)}.`
    );
  }

  if (report.rejectionReasons.length > 0) {
    lines.push(`rejections: ${report.rejectionReasons.join('; ')}.`);
  }

  lines.push(`candidates: ${report.candidates.map((candidate) => (
    `${candidate.id}:${candidate.hardGateStatus}:improvement=${candidate.improvement.toFixed(6)}`
  )).join(', ') || 'none'}.`);

  return lines.join('\n');
}
