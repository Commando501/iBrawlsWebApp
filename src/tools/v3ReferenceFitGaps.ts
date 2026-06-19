import * as THREE from 'three';
import { buildV3SpartanModel } from '../components/v3/VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import {
  classifyV3ObjSurfaceReferenceFitGapReview,
  classifyV3ObjSurfaceReferenceTargetReview,
  type V3ObjSurfaceSlotSegmentationCategory,
} from '../components/v3/v3ObjSurfaceSlotSegmentation';
import type {
  V3ReferenceFeatureGuide,
  V3ReferenceFeatureSlot,
  V3ReferenceFeatureSlotGuide,
} from './v3ReferenceFeatureGuide';

export type V3ReferenceFitGapAxis = 'width' | 'height' | 'depth' | 'vertical';
export type V3ReferenceFitGapDirection = 'too-large' | 'too-small' | 'too-high' | 'too-low';
export type V3ReferenceFitGapTargetConfidence = 'reliable' | 'needs-review';
export type V3ReferenceFitGapDiagnosticCategory = V3ObjSurfaceSlotSegmentationCategory;
export type V3ReferenceFitGapIssueCode =
  | 'too-wide'
  | 'too-narrow'
  | 'too-tall'
  | 'too-short'
  | 'too-deep'
  | 'too-shallow'
  | 'too-high'
  | 'too-low'
  | 'missing-v3-slot-bounds'
  | 'missing-reference-guide';
export type V3ReferenceFitGapTargetAxis = Exclude<V3ReferenceFitGapAxis, 'vertical'>;

export interface V3ReferenceFitGapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface V3ReferenceFitGapIssue {
  code: V3ReferenceFitGapIssueCode;
  slot: V3ReferenceFeatureSlot;
  axis: V3ReferenceFitGapAxis;
  direction: V3ReferenceFitGapDirection;
  current: number;
  target: number;
  delta: number;
  tolerance: number;
  severity: number;
  diagnosticCategory: V3ReferenceFitGapDiagnosticCategory;
  blocksBodyRebuild: boolean;
  diagnosticReason?: string;
  message: string;
}

export interface V3ReferenceFitGapTargetWarning {
  slot: V3ReferenceFeatureSlot;
  axis: V3ReferenceFitGapTargetAxis;
  target: number;
  min: number;
  max: number;
  severity: number;
  diagnosticCategory: V3ReferenceFitGapDiagnosticCategory;
  blocksBodyRebuild: boolean;
  diagnosticReason?: string;
  message: string;
}

export interface V3ReferenceFitGapSlotReport {
  slot: V3ReferenceFeatureSlot;
  v3Slots: V3CharacterSlotId[];
  current: {
    widthRatio: number;
    heightRatio: number;
    depthRatio: number;
    verticalCenterRatio: number;
  };
  target: {
    widthRatio: number;
    heightRatio: number;
    depthRatio: number;
    verticalCenterRatio: number;
  };
  targetConfidence: V3ReferenceFitGapTargetConfidence;
  targetWarnings: V3ReferenceFitGapTargetWarning[];
  maxSeverity: number;
  issues: V3ReferenceFitGapIssue[];
  ready: boolean;
}

export interface V3ReferenceFitGapReport {
  ready: boolean;
  slots: V3ReferenceFitGapSlotReport[];
  issues: V3ReferenceFitGapIssue[];
  targetWarnings: V3ReferenceFitGapTargetWarning[];
  summary: {
    slotCount: number;
    readySlotCount: number;
    issueCount: number;
    modelIssueCount: number;
    targetWarningCount: number;
    segmentationReviewCount: number;
    bodyRebuildBlockerCount: number;
    maxSeverity: number;
  };
}

export interface V3ReferenceFitGapOptions {
  modelHeight?: number;
  boundsBySlot?: Partial<Record<V3CharacterSlotId, V3ReferenceFitGapBounds>>;
  tolerances?: Partial<Record<V3ReferenceFitGapAxis, number>>;
}

interface V3ReferenceFitGapIssueClassification {
  diagnosticCategory: V3ReferenceFitGapDiagnosticCategory;
  blocksBodyRebuild: boolean;
  diagnosticReason?: string;
}

const DEFAULT_TOLERANCES: Record<V3ReferenceFitGapAxis, number> = {
  width: 0.055,
  height: 0.055,
  depth: 0.05,
  vertical: 0.06,
};

const SLOT_FAMILIES: Array<{
  slot: V3ReferenceFeatureSlot;
  v3Slots: V3CharacterSlotId[];
}> = [
  { slot: 'helmet', v3Slots: ['helmet'] },
  { slot: 'chest', v3Slots: ['chest'] },
  { slot: 'pelvis', v3Slots: ['pelvis'] },
  { slot: 'back', v3Slots: ['back'] },
  { slot: 'shoulder', v3Slots: ['shoulderLeft', 'shoulderRight'] },
  { slot: 'upperArm', v3Slots: ['upperArmLeft', 'upperArmRight'] },
  { slot: 'forearm', v3Slots: ['forearmLeft', 'forearmRight'] },
  { slot: 'hand', v3Slots: ['handLeft', 'handRight'] },
  { slot: 'thigh', v3Slots: ['thighLeft', 'thighRight'] },
  { slot: 'shin', v3Slots: ['shinLeft', 'shinRight'] },
  { slot: 'foot', v3Slots: ['footLeft', 'footRight'] },
];

const REFERENCE_TARGET_LIMITS: Record<
  V3ReferenceFeatureSlot,
  Record<V3ReferenceFitGapTargetAxis, { min: number; max: number }>
> = {
  helmet: {
    width: { min: 0.18, max: 0.45 },
    height: { min: 0.12, max: 0.32 },
    depth: { min: 0.14, max: 0.36 },
  },
  chest: {
    width: { min: 0.25, max: 0.7 },
    height: { min: 0.14, max: 0.36 },
    depth: { min: 0.1, max: 0.36 },
  },
  pelvis: {
    width: { min: 0.18, max: 0.7 },
    height: { min: 0.08, max: 0.28 },
    depth: { min: 0.1, max: 0.36 },
  },
  back: {
    width: { min: 0.16, max: 0.55 },
    height: { min: 0.12, max: 0.4 },
    depth: { min: 0.05, max: 0.28 },
  },
  shoulder: {
    width: { min: 0.35, max: 0.75 },
    height: { min: 0.06, max: 0.3 },
    depth: { min: 0.08, max: 0.34 },
  },
  upperArm: {
    width: { min: 0.2, max: 0.7 },
    height: { min: 0.1, max: 0.35 },
    depth: { min: 0.06, max: 0.3 },
  },
  forearm: {
    width: { min: 0.15, max: 0.55 },
    height: { min: 0.08, max: 0.28 },
    depth: { min: 0.06, max: 0.26 },
  },
  hand: {
    width: { min: 0.12, max: 0.45 },
    height: { min: 0.05, max: 0.18 },
    depth: { min: 0.06, max: 0.26 },
  },
  thigh: {
    width: { min: 0.15, max: 0.55 },
    height: { min: 0.13, max: 0.35 },
    depth: { min: 0.08, max: 0.28 },
  },
  shin: {
    width: { min: 0.15, max: 0.5 },
    height: { min: 0.14, max: 0.35 },
    depth: { min: 0.07, max: 0.28 },
  },
  foot: {
    width: { min: 0.14, max: 0.5 },
    height: { min: 0.04, max: 0.18 },
    depth: { min: 0.08, max: 0.36 },
  },
};

const round = (value: number): number => Number(value.toFixed(6));

function getDimensions(bounds: V3ReferenceFitGapBounds): {
  width: number;
  height: number;
  depth: number;
} {
  return {
    width: Math.max(0, bounds.maxX - bounds.minX),
    height: Math.max(0, bounds.maxY - bounds.minY),
    depth: Math.max(0, bounds.maxZ - bounds.minZ),
  };
}

function unionBounds(
  bounds: readonly V3ReferenceFitGapBounds[]
): V3ReferenceFitGapBounds | null {
  if (bounds.length === 0) return null;

  return {
    minX: Math.min(...bounds.map((entry) => entry.minX)),
    maxX: Math.max(...bounds.map((entry) => entry.maxX)),
    minY: Math.min(...bounds.map((entry) => entry.minY)),
    maxY: Math.max(...bounds.map((entry) => entry.maxY)),
    minZ: Math.min(...bounds.map((entry) => entry.minZ)),
    maxZ: Math.max(...bounds.map((entry) => entry.maxZ)),
  };
}

function boxToBounds(box: THREE.Box3): V3ReferenceFitGapBounds {
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

function collectBuiltInV3SlotBounds(): {
  modelHeight: number;
  boundsBySlot: Partial<Record<V3CharacterSlotId, V3ReferenceFitGapBounds>>;
} {
  const model = buildV3SpartanModel({ v3QualityTier: 'desktop' });
  model.updateWorldMatrix(true, true);
  const partGroups = model.userData.v3PartGroups as Partial<Record<V3CharacterSlotId, THREE.Object3D>> | undefined;
  const boundsBySlot: Partial<Record<V3CharacterSlotId, V3ReferenceFitGapBounds>> = {};

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const group = partGroups?.[slot];
    if (!group) continue;
    group.updateWorldMatrix(true, true);
    boundsBySlot[slot] = boxToBounds(new THREE.Box3().setFromObject(group));
  }

  const modelBounds = unionBounds(Object.values(boundsBySlot));
  const modelHeight = modelBounds ? Math.max(0.0001, modelBounds.maxY - modelBounds.minY) : 1;

  return { modelHeight, boundsBySlot };
}

function issueForDimension({
  slot,
  axis,
  current,
  target,
  tolerance,
  defaultClassification,
}: {
  slot: V3ReferenceFeatureSlot;
  axis: V3ReferenceFitGapAxis;
  current: number;
  target: number;
  tolerance: number;
  defaultClassification?: V3ReferenceFitGapIssueClassification;
}): V3ReferenceFitGapIssue | null {
  const delta = round(current - target);
  if (Math.abs(delta) <= tolerance) return null;

  const tooLarge = delta > 0;
  const codeByAxis: Record<V3ReferenceFitGapAxis, [V3ReferenceFitGapIssueCode, V3ReferenceFitGapIssueCode]> = {
    width: ['too-wide', 'too-narrow'],
    height: ['too-tall', 'too-short'],
    depth: ['too-deep', 'too-shallow'],
    vertical: ['too-high', 'too-low'],
  };
  const labelByAxis: Record<V3ReferenceFitGapAxis, string> = {
    width: 'width',
    height: 'height',
    depth: 'depth',
    vertical: 'vertical position',
  };
  const direction: V3ReferenceFitGapDirection = axis === 'vertical'
    ? tooLarge ? 'too-high' : 'too-low'
    : tooLarge ? 'too-large' : 'too-small';
  const code = tooLarge ? codeByAxis[axis][0] : codeByAxis[axis][1];
  const adjective = code.replace('too-', 'too ');
  const severity = round(Math.abs(delta) / tolerance);
  const review = classifyV3ObjSurfaceReferenceFitGapReview({
    slot,
    axis,
    direction,
  });
  const classification = review
    ? {
      diagnosticCategory: review.category,
      blocksBodyRebuild: review.blocksBodyRebuild,
      diagnosticReason: review.reason,
    }
    : defaultClassification ?? {
      diagnosticCategory: 'body-rebuild-blocker',
      blocksBodyRebuild: true,
    };

  return {
    code,
    slot,
    axis,
    direction,
    current: round(current),
    target: round(target),
    delta,
    tolerance,
    severity,
    diagnosticCategory: classification.diagnosticCategory,
    blocksBodyRebuild: classification.blocksBodyRebuild,
    ...(classification.diagnosticReason ? { diagnosticReason: classification.diagnosticReason } : {}),
    message: `${slot} ${labelByAxis[axis]} ${adjective} by ${Math.abs(delta).toFixed(4)}`,
  };
}

function targetValueForAxis(
  target: V3ReferenceFitGapSlotReport['target'],
  axis: V3ReferenceFitGapTargetAxis
): number {
  switch (axis) {
    case 'width': return target.widthRatio;
    case 'height': return target.heightRatio;
    case 'depth': return target.depthRatio;
  }
}

function buildTargetWarnings({
  slot,
  target,
  tolerances,
}: {
  slot: V3ReferenceFeatureSlot;
  target: V3ReferenceFitGapSlotReport['target'];
  tolerances: Record<V3ReferenceFitGapAxis, number>;
}): V3ReferenceFitGapTargetWarning[] {
  const limits = REFERENCE_TARGET_LIMITS[slot];
  const warnings: V3ReferenceFitGapTargetWarning[] = [];

  for (const axis of ['width', 'height', 'depth'] as const) {
    const value = targetValueForAxis(target, axis);
    const limit = limits[axis];
    const outsideBy = value < limit.min ? value - limit.min : value > limit.max ? value - limit.max : 0;
    if (outsideBy === 0) continue;
    const review = classifyV3ObjSurfaceReferenceTargetReview({ slot, axis });

    warnings.push({
      slot,
      axis,
      target: round(value),
      min: limit.min,
      max: limit.max,
      severity: round(Math.max(1, Math.abs(outsideBy) / tolerances[axis])),
      diagnosticCategory: review?.category ?? 'segmentation-review',
      blocksBodyRebuild: review?.blocksBodyRebuild ?? false,
      ...(review?.reason ? { diagnosticReason: review.reason } : {}),
      message: `${slot} reference ${axis} target ${value.toFixed(4)} is outside the plausible ${axis} range ${limit.min.toFixed(4)}-${limit.max.toFixed(4)}; review OBJ slot segmentation before tuning this axis`,
    });
  }

  return warnings.sort((a, b) => b.severity - a.severity || a.axis.localeCompare(b.axis));
}

function buildSlotReport({
  guide,
  bounds,
  modelHeight,
  v3Slots,
  tolerances,
  defaultIssueClassification,
}: {
  guide: V3ReferenceFeatureSlotGuide;
  bounds: V3ReferenceFitGapBounds;
  modelHeight: number;
  v3Slots: V3CharacterSlotId[];
  tolerances: Record<V3ReferenceFitGapAxis, number>;
  defaultIssueClassification?: V3ReferenceFitGapIssueClassification;
}): V3ReferenceFitGapSlotReport {
  const dimensions = getDimensions(bounds);
  const verticalCenterRatio = ((bounds.minY + bounds.maxY) / 2) / modelHeight;
  const targetVerticalCenterRatio = (guide.verticalRange.minRatio + guide.verticalRange.maxRatio) / 2;
  const current = {
    widthRatio: round(dimensions.width / modelHeight),
    heightRatio: round(dimensions.height / modelHeight),
    depthRatio: round(dimensions.depth / modelHeight),
    verticalCenterRatio: round(verticalCenterRatio),
  };
  const target = {
    widthRatio: round(guide.boundsRatio.widthToReferenceHeight),
    heightRatio: round(guide.boundsRatio.heightToReferenceHeight),
    depthRatio: round(guide.boundsRatio.depthToReferenceHeight),
    verticalCenterRatio: round(targetVerticalCenterRatio),
  };
  const targetWarnings = buildTargetWarnings({
    slot: guide.slot,
    target,
    tolerances,
  });
  const unreliableAxes = new Set<V3ReferenceFitGapAxis>(targetWarnings.map((warning) => warning.axis));
  if (unreliableAxes.has('height')) {
    unreliableAxes.add('vertical');
  }
  const issues = [
    unreliableAxes.has('width') ? null : issueForDimension({
      slot: guide.slot,
      axis: 'width',
      current: current.widthRatio,
      target: target.widthRatio,
      tolerance: tolerances.width,
      defaultClassification: defaultIssueClassification,
    }),
    unreliableAxes.has('height') ? null : issueForDimension({
      slot: guide.slot,
      axis: 'height',
      current: current.heightRatio,
      target: target.heightRatio,
      tolerance: tolerances.height,
      defaultClassification: defaultIssueClassification,
    }),
    unreliableAxes.has('depth') ? null : issueForDimension({
      slot: guide.slot,
      axis: 'depth',
      current: current.depthRatio,
      target: target.depthRatio,
      tolerance: tolerances.depth,
      defaultClassification: defaultIssueClassification,
    }),
    unreliableAxes.has('vertical') ? null : issueForDimension({
      slot: guide.slot,
      axis: 'vertical',
      current: current.verticalCenterRatio,
      target: target.verticalCenterRatio,
      tolerance: tolerances.vertical,
      defaultClassification: defaultIssueClassification,
    }),
  ].filter((issue): issue is V3ReferenceFitGapIssue => issue !== null);

  const bodyRebuildBlockerCount = [...issues, ...targetWarnings]
    .filter((issue) => issue.blocksBodyRebuild)
    .length;

  return {
    slot: guide.slot,
    v3Slots,
    current,
    target,
    targetConfidence: targetWarnings.length === 0 ? 'reliable' : 'needs-review',
    targetWarnings,
    maxSeverity: [...issues, ...targetWarnings].reduce((max, issue) => Math.max(max, issue.severity), 0),
    issues: issues.sort((a, b) => b.severity - a.severity),
    ready: bodyRebuildBlockerCount === 0,
  };
}

export function analyzeV3ReferenceFitGaps(
  guide: V3ReferenceFeatureGuide | null | undefined,
  options: V3ReferenceFitGapOptions = {}
): V3ReferenceFitGapReport {
  const usesBuiltInBounds = !(options.boundsBySlot && options.modelHeight);
  const resolved = options.boundsBySlot && options.modelHeight
    ? {
      modelHeight: options.modelHeight,
      boundsBySlot: options.boundsBySlot,
    }
    : collectBuiltInV3SlotBounds();
  const modelHeight = Math.max(0.0001, resolved.modelHeight);
  const tolerances = {
    ...DEFAULT_TOLERANCES,
    ...options.tolerances,
  };
  const guideBySlot = new Map(guide?.slotGuides.map((slotGuide) => [slotGuide.slot, slotGuide]) ?? []);
  const slots: V3ReferenceFitGapSlotReport[] = [];
  const defaultIssueClassification: V3ReferenceFitGapIssueClassification | undefined = usesBuiltInBounds
    ? {
      diagnosticCategory: 'segmentation-review',
      blocksBodyRebuild: false,
      diagnosticReason: 'built-in exact OBJ surface fit gaps require source slot segmentation review before body rebuild work',
    }
    : undefined;

  for (const family of SLOT_FAMILIES) {
    const slotGuide = guideBySlot.get(family.slot);
    if (!slotGuide) continue;
    const familyBounds = unionBounds(
      family.v3Slots
        .map((slot) => resolved.boundsBySlot[slot])
        .filter((bounds): bounds is V3ReferenceFitGapBounds => Boolean(bounds))
    );
    if (!familyBounds) {
      const issue: V3ReferenceFitGapIssue = {
        code: 'missing-v3-slot-bounds',
        slot: family.slot,
        axis: 'width',
        direction: 'too-small',
        current: 0,
        target: slotGuide.boundsRatio.widthToReferenceHeight,
        delta: -slotGuide.boundsRatio.widthToReferenceHeight,
        tolerance: tolerances.width,
        severity: round(slotGuide.boundsRatio.widthToReferenceHeight / tolerances.width),
        diagnosticCategory: 'body-rebuild-blocker',
        blocksBodyRebuild: true,
        message: `${family.slot} is missing V3 slot bounds for reference-fit comparison`,
      };
      slots.push({
        slot: family.slot,
        v3Slots: family.v3Slots,
        current: {
          widthRatio: 0,
          heightRatio: 0,
          depthRatio: 0,
          verticalCenterRatio: 0,
        },
        target: {
          widthRatio: slotGuide.boundsRatio.widthToReferenceHeight,
          heightRatio: slotGuide.boundsRatio.heightToReferenceHeight,
          depthRatio: slotGuide.boundsRatio.depthToReferenceHeight,
          verticalCenterRatio: (slotGuide.verticalRange.minRatio + slotGuide.verticalRange.maxRatio) / 2,
        },
        targetConfidence: 'reliable',
        targetWarnings: [],
        maxSeverity: issue.severity,
        issues: [issue],
        ready: false,
      });
      continue;
    }

    slots.push(buildSlotReport({
      guide: slotGuide,
      bounds: familyBounds,
      modelHeight,
      v3Slots: family.v3Slots,
      tolerances,
      defaultIssueClassification,
    }));
  }

  const sortedSlots = slots.sort((a, b) => b.maxSeverity - a.maxSeverity || a.slot.localeCompare(b.slot));
  const issues = sortedSlots.flatMap((slot) => slot.issues);
  const targetWarnings = sortedSlots.flatMap((slot) => slot.targetWarnings);
  const totalIssueCount = issues.length + targetWarnings.length;
  const bodyRebuildBlockerCount = [...issues, ...targetWarnings]
    .filter((issue) => issue.blocksBodyRebuild)
    .length;
  const segmentationReviewCount = totalIssueCount - bodyRebuildBlockerCount;

  return {
    ready: bodyRebuildBlockerCount === 0,
    slots: sortedSlots,
    issues,
    targetWarnings,
    summary: {
      slotCount: sortedSlots.length,
      readySlotCount: sortedSlots.filter((slot) => slot.ready).length,
      issueCount: totalIssueCount,
      modelIssueCount: issues.length,
      targetWarningCount: targetWarnings.length,
      segmentationReviewCount,
      bodyRebuildBlockerCount,
      maxSeverity: sortedSlots.reduce((max, slot) => Math.max(max, slot.maxSeverity), 0),
    },
  };
}

export function formatV3ReferenceFitGapSummary(report: V3ReferenceFitGapReport): string {
  if (report.ready) {
    if (report.summary.issueCount === 0) {
      return `Reference Fit Gaps ready: ${report.summary.readySlotCount}/${report.summary.slotCount} slot families within tolerance.`;
    }

    const topTargetWarnings = report.targetWarnings
      .slice(0, 3)
      .map((warning) => warning.message)
      .join('; ');
    const warningText = report.summary.targetWarningCount > 0
      ? ` ${report.summary.targetWarningCount} reference target${report.summary.targetWarningCount === 1 ? '' : 's'} need review${topTargetWarnings ? `: ${topTargetWarnings}.` : '.'}`
      : '';
    const topIssues = report.issues
      .slice(0, 5)
      .map((issue) => issue.message)
      .join('; ');
    const issueText = topIssues
      ? ` Review gaps: ${topIssues}.`
      : '';
    return `Reference Fit Gap Segmentation Review: ${report.summary.segmentationReviewCount} diagnostic${report.summary.segmentationReviewCount === 1 ? '' : 's'} across ${report.summary.slotCount} slot families; no body rebuild blockers.${issueText}${warningText}`;
  }

  const topIssues = report.issues
    .slice(0, 5)
    .map((issue) => issue.message)
    .join('; ');
  const topTargetWarnings = report.targetWarnings
    .slice(0, 3)
    .map((warning) => warning.message)
    .join('; ');
  const warningText = report.summary.targetWarningCount > 0
    ? ` ${report.summary.targetWarningCount} reference target${report.summary.targetWarningCount === 1 ? '' : 's'} need review${topTargetWarnings ? `: ${topTargetWarnings}.` : '.'}`
    : '';
  const gapText = topIssues
    ? ` Top gaps: ${topIssues}.`
    : '';
  const reviewText = report.summary.segmentationReviewCount > 0
    ? ` ${report.summary.segmentationReviewCount} segmentation review diagnostic${report.summary.segmentationReviewCount === 1 ? '' : 's'} remain non-blocking.`
    : '';
  return `Reference Fit Gaps blocked: ${report.summary.bodyRebuildBlockerCount} body rebuild blocker${report.summary.bodyRebuildBlockerCount === 1 ? '' : 's'} across ${report.summary.slotCount} slot families.${gapText}${warningText}${reviewText}`;
}
