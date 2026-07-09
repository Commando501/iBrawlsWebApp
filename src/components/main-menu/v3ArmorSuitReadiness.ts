import {
  CUSTOM_ARMOR_MAX_CATALOG_BYTES,
  CUSTOM_ARMOR_MAX_CATALOG_PIECES,
  V3_CUSTOM_ARMOR_SLOTS,
  getCustomArmorPieceModelSystem,
  type CustomArmorCatalog,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
} from '../customArmor';
import type { V3ArmorEditorMotionQaReport } from './v3ArmorEditorMotionQa';
import type { V3ArmorCoverageReport } from './v3ArmorEditorCoverage';
import type { V3ArmorEditorVisualQaReport } from './v3ArmorEditorVisualQa';
import type { V3SuitDraftValidationResult } from './v3ArmorEditorSuitWorkflow';
import type {
  V3SuitProfile,
  V3SuitProfileValidationResult,
} from './v3ArmorSuitProfiles';

export type V3SuitReadinessStatus = 'ready' | 'warnings' | 'blocked';
export type V3SuitReadinessSlotState = 'ready' | 'warning' | 'blocked' | 'missing';
export type V3SuitReadinessIssueCode =
  | 'normal_validation_failed'
  | 'missing_slot'
  | 'unsaved_staged_drafts'
  | 'coverage_qa_warning'
  | 'visual_qa_warning'
  | 'motion_qa_warning'
  | 'motion_qa_missing'
  | 'motion_qa_stale'
  | 'profile_missing_reference'
  | 'profile_partial'
  | 'catalog_piece_limit'
  | 'catalog_byte_limit'
  | 'export_blocked'
  | 'non_v3_piece';

export interface V3SuitReadinessIssue {
  code: V3SuitReadinessIssueCode;
  message: string;
  severity: 'blocker' | 'warning';
  slot?: V3CustomArmorSlot;
}

export interface V3SuitReadinessSlotReport {
  slot: V3CustomArmorSlot;
  state: V3SuitReadinessSlotState;
  score: number;
  issues: V3SuitReadinessIssue[];
  pieceId?: string;
}

export interface V3SuitReadinessReport {
  status: V3SuitReadinessStatus;
  score: number;
  readyToSaveSuit: boolean;
  readyToSaveProfile: boolean;
  readyToExportProfile: boolean;
  slotReports: V3SuitReadinessSlotReport[];
  blockers: V3SuitReadinessIssue[];
  warnings: V3SuitReadinessIssue[];
  summary: string;
  firstActionSlot?: V3CustomArmorSlot;
}

export interface V3SuitReadinessInput {
  source: 'stagedSuit' | 'profile' | 'loadout';
  catalog?: CustomArmorCatalog;
  suitDrafts?: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>;
  suitValidation?: V3SuitDraftValidationResult;
  profile?: V3SuitProfile;
  profileValidation?: V3SuitProfileValidationResult;
  coverageQa?: V3ArmorCoverageReport | null;
  visualQaBySlot?: Partial<Record<V3CustomArmorSlot, V3ArmorEditorVisualQaReport>>;
  motionQa?: V3ArmorEditorMotionQaReport | null;
  motionQaStale?: boolean;
  saveErrors?: string[];
  exportErrors?: string[];
  exportWarnings?: string[];
  catalogPieceCountAfterSave?: number;
  catalogByteLengthAfterSave?: number;
  dirty?: boolean;
}

const clampScore = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

const issue = (
  code: V3SuitReadinessIssueCode,
  message: string,
  severity: V3SuitReadinessIssue['severity'],
  slot?: V3CustomArmorSlot
): V3SuitReadinessIssue => ({
  code,
  message,
  severity,
  ...(slot ? { slot } : {}),
});

const addIssue = (
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[],
  nextIssue: V3SuitReadinessIssue
): void => {
  allIssues.push(nextIssue);
  if (!nextIssue.slot) return;
  const issues = slotIssues.get(nextIssue.slot) ?? [];
  issues.push(nextIssue);
  slotIssues.set(nextIssue.slot, issues);
};

const slotLabel = (slot: V3CustomArmorSlot): string => slot;

const sourceRequiresCompleteStagedSuit = (source: V3SuitReadinessInput['source']): boolean => (
  source === 'stagedSuit'
);

const motionQaApplies = (source: V3SuitReadinessInput['source']): boolean => (
  source === 'stagedSuit' || source === 'loadout'
);

const scoreForIssues = (issues: readonly V3SuitReadinessIssue[]): number => {
  const blockerCount = issues.filter((candidate) => candidate.severity === 'blocker').length;
  const warningCount = issues.length - blockerCount;
  return clampScore(100 - blockerCount * 28 - warningCount * 8);
};

const firstSlotWithSeverity = (
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  severity: V3SuitReadinessIssue['severity']
): V3CustomArmorSlot | undefined => (
  V3_CUSTOM_ARMOR_SLOTS.find((slot) => (
    (slotIssues.get(slot) ?? []).some((candidate) => candidate.severity === severity)
  ))
);

function addStagedSuitIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  if (!sourceRequiresCompleteStagedSuit(input.source)) return;

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const draft = input.suitDrafts?.[slot];
    const validation = input.suitValidation?.slots?.[slot];

    if (!draft) {
      addIssue(
        slotIssues,
        allIssues,
        issue('missing_slot', `${slotLabel(slot)} draft is missing.`, 'blocker', slot)
      );
      continue;
    }

    if (getCustomArmorPieceModelSystem(draft) !== 'v3') {
      addIssue(
        slotIssues,
        allIssues,
        issue('non_v3_piece', `${slotLabel(slot)} draft is not a V3 custom piece.`, 'blocker', slot)
      );
    }

    for (const errorMessage of validation?.errors ?? []) {
      addIssue(
        slotIssues,
        allIssues,
        issue('normal_validation_failed', errorMessage, 'blocker', slot)
      );
    }

    for (const warningMessage of validation?.warnings ?? []) {
      addIssue(
        slotIssues,
        allIssues,
        issue('normal_validation_failed', warningMessage, 'warning', slot)
      );
    }
  }

  if (input.dirty === true || input.suitValidation?.dirty === true) {
    addIssue(
      slotIssues,
      allIssues,
      issue('unsaved_staged_drafts', 'Staged V3 suit drafts have unsaved changes.', 'warning')
    );
  }
}

function addVisualQaIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const report = input.visualQaBySlot?.[slot];
    if (!report || (report.ready && report.issues.length === 0)) continue;
    const message = report.issues[0]?.message ?? `${slotLabel(slot)} visual QA needs review.`;
    addIssue(
      slotIssues,
      allIssues,
      issue('visual_qa_warning', message, 'warning', slot)
    );
  }
}

function addCoverageQaIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  const report = input.coverageQa;
  if (!report || (report.ready && report.issues.length === 0)) return;

  for (const coverageIssue of report.issues) {
    addIssue(
      slotIssues,
      allIssues,
      issue('coverage_qa_warning', coverageIssue.message, 'warning', coverageIssue.slot)
    );
  }
}

function addMotionQaIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  if (!motionQaApplies(input.source)) return;

  if (!input.motionQa) {
    addIssue(
      slotIssues,
      allIssues,
      issue('motion_qa_missing', 'Full-suit motion QA has not been run.', 'warning')
    );
    return;
  }

  if (input.motionQaStale) {
    addIssue(
      slotIssues,
      allIssues,
      issue('motion_qa_stale', 'Full-suit motion QA is stale for the current suit facts.', 'warning')
    );
  }

  if (input.motionQa.ready && input.motionQa.issues.length === 0) return;

  for (const motionIssue of input.motionQa.issues) {
    const slots = motionIssue.slots.length > 0 ? motionIssue.slots : [undefined];
    for (const slot of slots) {
      addIssue(
        slotIssues,
        allIssues,
        issue('motion_qa_warning', motionIssue.message, 'warning', slot)
      );
    }
  }
}

function addProfileIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  const validation = input.profileValidation;
  if (!validation) return;

  if (validation.status === 'partial') {
    for (const slot of validation.missingSlotIds) {
      addIssue(
        slotIssues,
        allIssues,
        issue('profile_partial', `${slotLabel(slot)} profile reference is missing.`, 'blocker', slot)
      );
    }
  }

  if (!validation.valid || validation.status === 'missing') {
    const slots = validation.missingSlotIds.length > 0 ? validation.missingSlotIds : [undefined];
    const message = validation.errors[0] ?? 'Suit profile is missing exportable V3 custom armor pieces.';
    for (const slot of slots) {
      addIssue(
        slotIssues,
        allIssues,
        issue('profile_missing_reference', message, 'blocker', slot)
      );
    }
  }
}

function addExportIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  for (const errorMessage of input.exportErrors ?? []) {
    addIssue(
      slotIssues,
      allIssues,
      issue('export_blocked', errorMessage, 'blocker')
    );
  }

  for (const warningMessage of input.exportWarnings ?? []) {
    addIssue(
      slotIssues,
      allIssues,
      issue('visual_qa_warning', warningMessage, 'warning')
    );
  }
}

function addSavePlanIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  for (const errorMessage of input.saveErrors ?? []) {
    const normalized = errorMessage.toLocaleLowerCase();
    const code: V3SuitReadinessIssueCode = normalized.includes('byte')
      ? 'catalog_byte_limit'
      : normalized.includes('piece') ? 'catalog_piece_limit' : 'normal_validation_failed';
    addIssue(
      slotIssues,
      allIssues,
      issue(code, errorMessage, 'blocker')
    );
  }
}

function addCatalogIssues(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>,
  allIssues: V3SuitReadinessIssue[]
): void {
  if (
    input.catalogPieceCountAfterSave !== undefined &&
    input.catalogPieceCountAfterSave > CUSTOM_ARMOR_MAX_CATALOG_PIECES
  ) {
    addIssue(
      slotIssues,
      allIssues,
      issue(
        'catalog_piece_limit',
        `Custom armor catalog would contain ${input.catalogPieceCountAfterSave} pieces; max is ${CUSTOM_ARMOR_MAX_CATALOG_PIECES}.`,
        'blocker'
      )
    );
  }

  if (
    input.catalogByteLengthAfterSave !== undefined &&
    input.catalogByteLengthAfterSave > CUSTOM_ARMOR_MAX_CATALOG_BYTES
  ) {
    addIssue(
      slotIssues,
      allIssues,
      issue(
        'catalog_byte_limit',
        `Custom armor catalog would be ${input.catalogByteLengthAfterSave} bytes; max is ${CUSTOM_ARMOR_MAX_CATALOG_BYTES}.`,
        'blocker'
      )
    );
  }
}

const isSuitSaveBlocker = (candidate: V3SuitReadinessIssue): boolean => (
  candidate.severity === 'blocker' &&
  (
    candidate.code === 'normal_validation_failed' ||
    candidate.code === 'missing_slot' ||
    candidate.code === 'non_v3_piece' ||
    candidate.code === 'catalog_piece_limit' ||
    candidate.code === 'catalog_byte_limit'
  )
);

const isProfileSaveBlocker = isSuitSaveBlocker;

const isExportBlocker = (candidate: V3SuitReadinessIssue): boolean => (
  candidate.severity === 'blocker'
);

function buildSlotReports(
  input: V3SuitReadinessInput,
  slotIssues: Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>
): V3SuitReadinessSlotReport[] {
  return V3_CUSTOM_ARMOR_SLOTS.map((slot) => {
    const issues = [...(slotIssues.get(slot) ?? [])];
    const hasBlocker = issues.some((candidate) => candidate.severity === 'blocker');
    const hasWarning = issues.some((candidate) => candidate.severity === 'warning');
    const missing = issues.some((candidate) => candidate.code === 'missing_slot');
    const draft = input.suitDrafts?.[slot];
    const profilePieceId = input.profile?.slotPieceIds?.[slot];
    const pieceId = draft?.id ?? profilePieceId;
    const score = input.suitValidation?.slots?.[slot]?.advisoryScore ?? scoreForIssues(issues);

    return {
      slot,
      state: missing ? 'missing' : hasBlocker ? 'blocked' : hasWarning ? 'warning' : 'ready',
      score: clampScore(scoreForIssues(issues.length > 0 ? issues : []) === 100 ? score : scoreForIssues(issues)),
      issues,
      ...(pieceId ? { pieceId } : {}),
    };
  });
}

const buildSummary = (
  status: V3SuitReadinessStatus,
  blockers: readonly V3SuitReadinessIssue[],
  warnings: readonly V3SuitReadinessIssue[]
): string => {
  if (status === 'ready') return 'V3 suit is ready.';
  if (status === 'blocked') {
    return `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} must be resolved.`;
  }
  return `${warnings.length} warning${warnings.length === 1 ? '' : 's'} need review.`;
};

export function buildV3SuitReadinessReport(
  input: V3SuitReadinessInput
): V3SuitReadinessReport {
  const slotIssues = new Map<V3CustomArmorSlot, V3SuitReadinessIssue[]>();
  const issues: V3SuitReadinessIssue[] = [];

  addStagedSuitIssues(input, slotIssues, issues);
  addCoverageQaIssues(input, slotIssues, issues);
  addVisualQaIssues(input, slotIssues, issues);
  addMotionQaIssues(input, slotIssues, issues);
  addProfileIssues(input, slotIssues, issues);
  addSavePlanIssues(input, slotIssues, issues);
  addExportIssues(input, slotIssues, issues);
  addCatalogIssues(input, slotIssues, issues);

  const blockers = issues.filter((candidate) => candidate.severity === 'blocker');
  const warnings = issues.filter((candidate) => candidate.severity === 'warning');
  const status: V3SuitReadinessStatus = blockers.length > 0
    ? 'blocked'
    : warnings.length > 0 ? 'warnings' : 'ready';
  const firstActionSlot = firstSlotWithSeverity(slotIssues, 'blocker')
    ?? firstSlotWithSeverity(slotIssues, 'warning');

  return {
    status,
    score: scoreForIssues(issues),
    readyToSaveSuit: !issues.some(isSuitSaveBlocker),
    readyToSaveProfile: !issues.some(isProfileSaveBlocker),
    readyToExportProfile: !issues.some(isExportBlocker),
    slotReports: buildSlotReports(input, slotIssues),
    blockers,
    warnings,
    summary: buildSummary(status, blockers, warnings),
    ...(firstActionSlot ? { firstActionSlot } : {}),
  };
}
