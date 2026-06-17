import type { CharacterLoadout } from '../VoxelModels';
import {
  V3_CUSTOM_ARMOR_SLOTS,
  getCustomArmorPieceModelSystem,
  type CustomArmorCatalog,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
} from '../customArmor';
import {
  V3_POSE_CLEARANCE_CASES,
  analyzeV3PoseClearance,
  type V3PoseClearanceCaseId,
  type V3PoseClearanceCaseReport,
  type V3PoseClearanceIssue,
  type V3PoseClearanceIssueCode,
  type V3PoseClearanceOptions,
  type V3PoseClearanceReport,
} from '../grifball/v3PoseClearance';

export type V3ArmorEditorMotionQaMode = 'active-slot' | 'full-suit';
export type V3ArmorEditorMotionQaIssueCode = V3PoseClearanceIssueCode | 'unsupported-non-v3';

export interface V3ArmorEditorMotionQaIssue {
  code: V3ArmorEditorMotionQaIssueCode;
  message: string;
  caseId?: V3PoseClearanceCaseId;
  value?: number;
  threshold?: number;
  partIds?: string[];
  slots: V3CustomArmorSlot[];
}

export interface V3ArmorEditorMotionQaSummary {
  supported: boolean;
  mode: V3ArmorEditorMotionQaMode;
  caseCount: number;
  readyCaseCount: number;
  issueCount: number;
}

export interface V3ArmorEditorMotionQaReport {
  ready: boolean;
  score: number;
  cases: V3PoseClearanceCaseReport[];
  issues: V3ArmorEditorMotionQaIssue[];
  summary: V3ArmorEditorMotionQaSummary;
  slotIssueCounts: Partial<Record<V3CustomArmorSlot, number>>;
  sourceSignature: string;
}

export interface V3ArmorEditorMotionQaInput {
  mode?: V3ArmorEditorMotionQaMode;
  activeSlot: V3CustomArmorSlot;
  draft: CustomArmorPieceSnapshot;
  suitDrafts?: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>;
  loadout?: CharacterLoadout;
  catalog?: CustomArmorCatalog;
  selectedCaseId?: V3PoseClearanceCaseId;
  caseIds?: readonly V3PoseClearanceCaseId[];
  hue?: number;
  analyzer?: (
    caseId: V3PoseClearanceCaseId,
    options?: V3PoseClearanceOptions
  ) => V3PoseClearanceReport;
}

const DEFAULT_LOADOUT: CharacterLoadout = { modelSystem: 'v3' };
const V3_SLOT_SET = new Set<string>(V3_CUSTOM_ARMOR_SLOTS);

const cloneSnapshot = (snapshot: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot => {
  const next: CustomArmorPieceSnapshot = {
    version: 1,
    id: snapshot.id,
    name: snapshot.name,
    slot: snapshot.slot,
    voxels: snapshot.voxels.map((voxel) => ({ ...voxel })),
    updatedAt: snapshot.updatedAt,
  };
  if (snapshot.modelSystem !== undefined) next.modelSystem = snapshot.modelSystem;
  if (snapshot.modelType !== undefined) next.modelType = snapshot.modelType;
  if (snapshot.gridScale !== undefined) next.gridScale = snapshot.gridScale;
  if (snapshot.sourcePreset !== undefined) next.sourcePreset = snapshot.sourcePreset;
  if (snapshot.thumbnail !== undefined) next.thumbnail = snapshot.thumbnail;
  return next;
};

const resolveCatalogSnapshot = (
  catalog: CustomArmorCatalog | undefined,
  snapshot: CustomArmorPieceSnapshot | undefined
): CustomArmorPieceSnapshot | undefined => {
  if (!snapshot) return undefined;
  const catalogPiece = catalog?.pieces.find((piece) => piece.id === snapshot.id);
  return cloneSnapshot(catalogPiece ?? snapshot);
};

const buildPreviewLoadout = (input: V3ArmorEditorMotionQaInput): CharacterLoadout => {
  const baseLoadout = input.loadout ?? DEFAULT_LOADOUT;
  const customArmor: CharacterLoadout['customArmor'] = {};

  for (const [slot, snapshot] of Object.entries(baseLoadout.customArmor ?? {})) {
    if (!V3_SLOT_SET.has(slot)) continue;
    customArmor[slot] = resolveCatalogSnapshot(input.catalog, snapshot);
  }

  for (const [slot, snapshot] of Object.entries(input.suitDrafts ?? {})) {
    if (!snapshot || !V3_SLOT_SET.has(slot)) continue;
    customArmor[slot] = cloneSnapshot(snapshot);
  }

  customArmor[input.activeSlot] = cloneSnapshot(input.draft);

  return {
    ...baseLoadout,
    modelSystem: 'v3',
    modelType: undefined,
    customArmor,
  };
};

const caseIdsFor = (input: V3ArmorEditorMotionQaInput): V3PoseClearanceCaseId[] => {
  if (input.caseIds && input.caseIds.length > 0) return [...input.caseIds];
  if (input.mode === 'full-suit') return V3_POSE_CLEARANCE_CASES.map((poseCase) => poseCase.id);
  return [input.selectedCaseId ?? 'idle'];
};

const slotFromPartId = (partId: string): V3CustomArmorSlot | undefined => (
  V3_SLOT_SET.has(partId) ? partId as V3CustomArmorSlot : undefined
);

const slotsForIssue = (
  issue: V3PoseClearanceIssue,
  fallbackSlot: V3CustomArmorSlot
): V3CustomArmorSlot[] => {
  const slots = (issue.partIds ?? [])
    .map(slotFromPartId)
    .filter((slot): slot is V3CustomArmorSlot => Boolean(slot));
  return slots.length > 0 ? [...new Set(slots)].sort() : [fallbackSlot];
};

const scoreMotionQa = (issues: readonly V3ArmorEditorMotionQaIssue[]): number => {
  const uniqueCodes = new Set(issues.map((issue) => issue.code)).size;
  return Math.max(0, Math.min(100, 100 - uniqueCodes * 14 - issues.length * 6));
};

const buildSourceSignature = (
  input: V3ArmorEditorMotionQaInput,
  mode: V3ArmorEditorMotionQaMode,
  caseIds: readonly V3PoseClearanceCaseId[]
): string => {
  const suitDrafts = Object.entries(input.suitDrafts ?? {})
    .filter((entry): entry is [string, CustomArmorPieceSnapshot] => Boolean(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slot, snapshot]) => ({
      slot,
      id: snapshot.id,
      updatedAt: snapshot.updatedAt,
      voxelCount: snapshot.voxels.length,
    }));
  return JSON.stringify({
    mode,
    activeSlot: input.activeSlot,
    selectedCaseId: input.selectedCaseId ?? null,
    caseIds: [...caseIds],
    draft: {
      id: input.draft.id,
      slot: input.draft.slot,
      updatedAt: input.draft.updatedAt,
      voxelCount: input.draft.voxels.length,
    },
    suitDrafts,
  });
};

const unsupportedReport = (
  input: V3ArmorEditorMotionQaInput,
  mode: V3ArmorEditorMotionQaMode,
  caseIds: readonly V3PoseClearanceCaseId[]
): V3ArmorEditorMotionQaReport => ({
  ready: false,
  score: 0,
  cases: [],
  issues: [{
    code: 'unsupported-non-v3',
    message: 'V3 motion QA only runs on V3 armor drafts.',
    slots: [input.activeSlot],
  }],
  summary: {
    supported: false,
    mode,
    caseCount: 0,
    readyCaseCount: 0,
    issueCount: 1,
  },
  slotIssueCounts: {},
  sourceSignature: buildSourceSignature(input, mode, caseIds),
});

export function buildV3ArmorEditorMotionQaReport(
  input: V3ArmorEditorMotionQaInput
): V3ArmorEditorMotionQaReport {
  const mode: V3ArmorEditorMotionQaMode = input.mode ?? 'active-slot';
  const caseIds = caseIdsFor(input);

  if (getCustomArmorPieceModelSystem(input.draft) !== 'v3') {
    return unsupportedReport(input, mode, caseIds);
  }

  const previewLoadout = buildPreviewLoadout(input);
  const analyzer = input.analyzer ?? analyzeV3PoseClearance;
  const poseReports = caseIds.map((caseId) => analyzer(caseId, {
    loadout: previewLoadout,
    hue: input.hue,
  }));
  const cases = poseReports.flatMap((report) => report.cases);
  const issues = poseReports.flatMap((report) => report.issues).map((issue) => ({
    code: issue.code,
    message: issue.message,
    caseId: issue.caseId,
    value: issue.value,
    threshold: issue.threshold,
    partIds: issue.partIds ? [...issue.partIds] : undefined,
    slots: slotsForIssue(issue, input.activeSlot),
  }));
  const slotIssueCounts: Partial<Record<V3CustomArmorSlot, number>> = {};
  for (const issue of issues) {
    for (const issueSlot of issue.slots) {
      slotIssueCounts[issueSlot] = (slotIssueCounts[issueSlot] ?? 0) + 1;
    }
  }

  return {
    ready: issues.length === 0,
    score: scoreMotionQa(issues),
    cases,
    issues,
    summary: {
      supported: true,
      mode,
      caseCount: cases.length,
      readyCaseCount: cases.filter((testCase) => testCase.ready).length,
      issueCount: issues.length,
    },
    slotIssueCounts,
    sourceSignature: buildSourceSignature(input, mode, caseIds),
  };
}
