export const V3_READINESS_CHECKLIST_ITEM_IDS = [
  'baseProportions',
  'builtInArmorFidelity',
  'poseAtlas',
  'attackMovementAnimation',
  'referenceComparison',
  'performanceSmoke',
] as const;

export type V3ReadinessChecklistItemId = typeof V3_READINESS_CHECKLIST_ITEM_IDS[number];
export type V3ReadinessChecklist = Record<V3ReadinessChecklistItemId, boolean>;
export type V3ReadinessDashboardStatus = 'not-player-ready' | 'player-ready';

export const V3_READINESS_CHECKLIST_STORAGE_KEY = 'grifball_v3_readiness_checklist';

export const V3_READINESS_CHECKLIST_COPY: Record<V3ReadinessChecklistItemId, string> = {
  baseProportions: 'Base proportions',
  builtInArmorFidelity: 'Built-in armor fidelity',
  poseAtlas: 'Pose atlas',
  attackMovementAnimation: 'Attack movement animation',
  referenceComparison: 'Reference comparison',
  performanceSmoke: 'Performance smoke',
};

export const V3_READINESS_STATUS_COPY: Record<V3ReadinessDashboardStatus, {
  label: string;
  summary: string;
}> = {
  'not-player-ready': {
    label: 'Not Player Ready',
    summary: 'Manual readiness gates and reference comparison still need review.',
  },
  'player-ready': {
    label: 'Player Ready',
    summary: 'Manual gates, reference comparison, and supplied evidence are ready.',
  },
};

export interface V3ReadinessStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type V3ReadinessJsonValue =
  | string
  | number
  | boolean
  | null
  | V3ReadinessJsonValue[]
  | { [key: string]: V3ReadinessJsonValue };

export interface V3ReadinessEvidenceSummaryInput {
  ready?: boolean;
  issues?: readonly unknown[];
  summary?: unknown;
}

export interface V3ReadinessReferenceComparisonInput {
  acknowledged?: unknown;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  metadata?: unknown;
  comparison?: unknown;
  proportionBands?: unknown;
  issues?: readonly unknown[];
}

export interface V3ReadinessDashboardInput {
  checklist?: Record<string, unknown> | Partial<Record<V3ReadinessChecklistItemId, unknown>>;
  suitFidelity?: V3ReadinessEvidenceSummaryInput | null;
  referenceProportions?: V3ReadinessEvidenceSummaryInput | null;
  visualQa?: V3ReadinessEvidenceSummaryInput | null;
  poseClearance?: V3ReadinessEvidenceSummaryInput | null;
  performanceSmoke?: V3ReadinessEvidenceSummaryInput | null;
  referenceComparison?: V3ReadinessReferenceComparisonInput | null;
  exportedAt?: string;
}

export type V3ReadinessEvidenceKey =
  | 'suitFidelity'
  | 'referenceProportions'
  | 'visualQa'
  | 'poseClearance'
  | 'performanceSmoke';

export interface V3ReadinessEvidenceSummary {
  ready: boolean | null;
  issueCount: number;
  issues: string[];
  summary?: V3ReadinessJsonValue;
}

export interface V3ReadinessReferenceComparisonEvidence {
  acknowledged: boolean;
  issueCount: number;
  issues: string[];
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  metadata?: V3ReadinessJsonValue;
  comparison?: V3ReadinessJsonValue;
  proportionBands?: V3ReadinessJsonValue;
}

export interface V3ReadinessDashboardEvidence {
  suitFidelity: V3ReadinessEvidenceSummary;
  referenceProportions: V3ReadinessEvidenceSummary;
  visualQa: V3ReadinessEvidenceSummary;
  poseClearance: V3ReadinessEvidenceSummary;
  performanceSmoke: V3ReadinessEvidenceSummary;
  referenceComparison: V3ReadinessReferenceComparisonEvidence;
}

export interface V3ReadinessDashboardIssue {
  id: string;
  message: string;
  severity: 'blocker' | 'warning';
  source?: V3ReadinessChecklistItemId | V3ReadinessEvidenceKey | 'referenceComparisonAcknowledgement';
}

export interface V3ReadinessDashboardReport {
  ready: boolean;
  status: V3ReadinessDashboardStatus;
  label: string;
  checklist: V3ReadinessChecklist;
  evidence: V3ReadinessDashboardEvidence;
  blockers: V3ReadinessDashboardIssue[];
  warnings: V3ReadinessDashboardIssue[];
  summary: string;
  exportedAt?: string;
}

export interface V3ReadinessDashboardExportObject {
  kind: 'v3-readiness-dashboard';
  version: 1;
  ready: boolean;
  status: V3ReadinessDashboardStatus;
  label: string;
  checklist: V3ReadinessChecklist;
  evidence: V3ReadinessDashboardEvidence;
  blockers: V3ReadinessDashboardIssue[];
  warnings: V3ReadinessDashboardIssue[];
  summary: string;
  exportedAt?: string;
}

export interface V3ReadinessDashboardExportOptions {
  format?: 'object' | 'string';
  exportedAt?: string;
}

const EVIDENCE_LABELS: Record<V3ReadinessEvidenceKey, string> = {
  suitFidelity: 'Suit fidelity',
  referenceProportions: 'Reference proportions',
  visualQa: 'Visual QA',
  poseClearance: 'Pose clearance',
  performanceSmoke: 'Performance smoke',
};

const RAW_EXPORT_KEY_PATTERN =
  /^(raw|rawAssetData|rawGeometry|assetData|assetBytes|buffer|bytes|blob|geometry|mesh|meshes|scene|camera|voxels|snapshots|cases|overlays|sourcePath|path|absolutePath|localPath|filePath|payload)$/i;
const PRIVATE_PATH_PATTERN = /(?:[A-Za-z]:\\|\/Users\/|\\Users\\|\/home\/|\/var\/|\/tmp\/)/i;
const MAX_ISSUES_PER_ENTRY = 12;
const MAX_STRING_LENGTH = 1_000;
const MAX_JSON_DEPTH = 4;

const emptyChecklist = (): V3ReadinessChecklist => (
  Object.fromEntries(
    V3_READINESS_CHECKLIST_ITEM_IDS.map((id) => [id, false])
  ) as V3ReadinessChecklist
);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value)
);

const truncateString = (value: string): string => (
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value
);

function stripPrivatePath(value: string): string {
  const normalized = value.split(/[\\/]/).filter(Boolean);
  return normalized.length > 0 ? normalized[normalized.length - 1] : value;
}

function sanitizeString(value: string): string {
  return truncateString(PRIVATE_PATH_PATTERN.test(value) ? stripPrivatePath(value) : value);
}

function sanitizeJsonValue(value: unknown, depth = 0): V3ReadinessJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= MAX_JSON_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonValue(entry, depth + 1))
      .filter((entry): entry is V3ReadinessJsonValue => entry !== undefined);
  }
  if (isPlainObject(value)) {
    const sanitized: Record<string, V3ReadinessJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (RAW_EXPORT_KEY_PATTERN.test(key)) continue;
      const next = sanitizeJsonValue(entry, depth + 1);
      if (next !== undefined) {
        sanitized[key] = next;
      }
    }
    return sanitized;
  }
  return undefined;
}

function issueToMessage(issue: unknown): string {
  if (typeof issue === 'string') return truncateString(issue);
  if (isPlainObject(issue)) {
    const code = typeof issue.code === 'string' ? issue.code : undefined;
    const message = typeof issue.message === 'string'
      ? issue.message
      : JSON.stringify(sanitizeJsonValue(issue) ?? {});
    return truncateString(code ? `${code}: ${message}` : message);
  }
  return truncateString(String(issue));
}

function normalizeIssueMessages(issues: readonly unknown[] | undefined): string[] {
  return (issues ?? [])
    .map(issueToMessage)
    .filter((message) => message.trim().length > 0)
    .slice(0, MAX_ISSUES_PER_ENTRY);
}

function normalizeEvidenceSummary(
  input: V3ReadinessEvidenceSummaryInput | null | undefined
): V3ReadinessEvidenceSummary {
  const issues = normalizeIssueMessages(input?.issues);
  const summary = sanitizeJsonValue(input?.summary);
  return {
    ready: typeof input?.ready === 'boolean' ? input.ready : null,
    issueCount: issues.length,
    issues,
    ...(summary !== undefined ? { summary } : {}),
  };
}

function normalizeReferenceComparison(
  input: V3ReadinessReferenceComparisonInput | null | undefined
): V3ReadinessReferenceComparisonEvidence {
  const issues = normalizeIssueMessages(input?.issues);
  const metadata = sanitizeJsonValue(input?.metadata);
  const comparison = sanitizeJsonValue(input?.comparison);
  const proportionBands = sanitizeJsonValue(input?.proportionBands);
  return {
    acknowledged: input?.acknowledged === true,
    issueCount: issues.length,
    issues,
    ...(typeof input?.acknowledgedAt === 'string' ? { acknowledgedAt: input.acknowledgedAt } : {}),
    ...(typeof input?.acknowledgedBy === 'string' ? { acknowledgedBy: input.acknowledgedBy } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(comparison !== undefined ? { comparison } : {}),
    ...(proportionBands !== undefined ? { proportionBands } : {}),
  };
}

function buildEvidence(input: V3ReadinessDashboardInput): V3ReadinessDashboardEvidence {
  return {
    suitFidelity: normalizeEvidenceSummary(input.suitFidelity),
    referenceProportions: normalizeEvidenceSummary(input.referenceProportions),
    visualQa: normalizeEvidenceSummary(input.visualQa),
    poseClearance: normalizeEvidenceSummary(input.poseClearance),
    performanceSmoke: normalizeEvidenceSummary(input.performanceSmoke),
    referenceComparison: normalizeReferenceComparison(input.referenceComparison),
  };
}

const manualBlocker = (id: V3ReadinessChecklistItemId): V3ReadinessDashboardIssue => ({
  id,
  source: id,
  severity: 'blocker',
  message: `${V3_READINESS_CHECKLIST_COPY[id]} has not been manually confirmed.`,
});

function firstEvidenceIssueMessage(entry: V3ReadinessEvidenceSummary): string {
  return entry.issues[0] ?? 'reported readiness is false';
}

function collectEvidenceIssues(evidence: V3ReadinessDashboardEvidence): {
  blockers: V3ReadinessDashboardIssue[];
  warnings: V3ReadinessDashboardIssue[];
} {
  const blockers: V3ReadinessDashboardIssue[] = [];
  const warnings: V3ReadinessDashboardIssue[] = [];

  for (const key of Object.keys(EVIDENCE_LABELS) as V3ReadinessEvidenceKey[]) {
    const entry = evidence[key];
    if (entry.ready !== true) {
      blockers.push({
        id: `${key}Evidence`,
        source: key,
        severity: 'blocker',
        message: entry.ready === false
          ? `${EVIDENCE_LABELS[key]} is not ready: ${firstEvidenceIssueMessage(entry)}`
          : `${EVIDENCE_LABELS[key]} readiness evidence is missing.`,
      });
    } else if (entry.issueCount > 0) {
      warnings.push({
        id: `${key}Evidence`,
        source: key,
        severity: 'warning',
        message: `${EVIDENCE_LABELS[key]} reported issues: ${entry.issues[0]}`,
      });
    }
  }

  if (evidence.referenceComparison.issueCount > 0) {
    blockers.push({
      id: 'referenceComparisonEvidence',
      source: 'referenceComparison',
      severity: 'blocker',
      message: `Reference comparison reported issues: ${evidence.referenceComparison.issues[0]}`,
    });
  }

  return { blockers, warnings };
}

function buildReportSummary({
  ready,
  manualMissingCount,
  referenceAcknowledged,
  blockers,
  warnings,
}: {
  ready: boolean;
  manualMissingCount: number;
  referenceAcknowledged: boolean;
  blockers: readonly V3ReadinessDashboardIssue[];
  warnings: readonly V3ReadinessDashboardIssue[];
}): string {
  if (ready) {
    return warnings.length > 0
      ? `Player ready with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`
      : V3_READINESS_STATUS_COPY['player-ready'].summary;
  }

  const parts: string[] = [];
  if (manualMissingCount > 0) {
    parts.push(`${manualMissingCount} manual checklist item${manualMissingCount === 1 ? '' : 's'} remain`);
  }
  if (blockers.some((blocker) => blocker.id === 'v3InternalPrototypeGate')) {
    parts.push('internal prototype gate remains');
  }
  if (!referenceAcknowledged) {
    parts.push('reference comparison has not been acknowledged');
  }
  const evidenceBlockerCount = blockers.filter((blocker) => (
    blocker.id.endsWith('Evidence')
  )).length;
  if (evidenceBlockerCount > 0) {
    parts.push(`${evidenceBlockerCount} evidence blocker${evidenceBlockerCount === 1 ? '' : 's'} remain`);
  }

  return parts.length > 0
    ? `Not Player Ready: ${parts.join(', ')}.`
    : V3_READINESS_STATUS_COPY['not-player-ready'].summary;
}

export function normalizeV3ReadinessChecklist(
  input: Record<string, unknown> | Partial<Record<V3ReadinessChecklistItemId, unknown>> = {}
): V3ReadinessChecklist {
  const checklist = emptyChecklist();
  for (const id of V3_READINESS_CHECKLIST_ITEM_IDS) {
    checklist[id] = Boolean(input[id]);
  }
  return checklist;
}

export function readV3ReadinessChecklist(
  storage: Pick<V3ReadinessStorageLike, 'getItem'>
): V3ReadinessChecklist {
  try {
    const raw = storage.getItem(V3_READINESS_CHECKLIST_STORAGE_KEY);
    return normalizeV3ReadinessChecklist(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeV3ReadinessChecklist();
  }
}

export function persistV3ReadinessChecklist(
  storage: Pick<V3ReadinessStorageLike, 'setItem'>,
  checklist: Record<string, unknown> | Partial<Record<V3ReadinessChecklistItemId, unknown>>
): void {
  try {
    storage.setItem(
      V3_READINESS_CHECKLIST_STORAGE_KEY,
      JSON.stringify(normalizeV3ReadinessChecklist(checklist))
    );
  } catch {
    /* best effort */
  }
}

export function buildV3ReadinessDashboardReport(
  input: V3ReadinessDashboardInput = {}
): V3ReadinessDashboardReport {
  const checklist = normalizeV3ReadinessChecklist(input.checklist);
  const evidence = buildEvidence(input);
  const manualBlockers = V3_READINESS_CHECKLIST_ITEM_IDS
    .filter((id) => !checklist[id])
    .map(manualBlocker);
  const internalPrototypeBlocker: V3ReadinessDashboardIssue = {
    id: 'v3InternalPrototypeGate',
    severity: 'blocker',
    message: 'V3 remains an internal prototype and is not player-ready.',
  };
  const referenceBlocker: V3ReadinessDashboardIssue[] = evidence.referenceComparison.acknowledged
    ? []
    : [{
      id: 'referenceComparisonAcknowledgement',
      source: 'referenceComparisonAcknowledgement',
      severity: 'blocker',
      message: 'Reference comparison has not been acknowledged.',
    }];
  const evidenceIssues = collectEvidenceIssues(evidence);
  const blockers = [internalPrototypeBlocker, ...manualBlockers, ...referenceBlocker, ...evidenceIssues.blockers];
  const warnings = evidenceIssues.warnings;
  const manualReady = V3_READINESS_CHECKLIST_ITEM_IDS.every((id) => checklist[id]);
  const ready = manualReady && evidence.referenceComparison.acknowledged && blockers.length === 0;
  const status: V3ReadinessDashboardStatus = ready ? 'player-ready' : 'not-player-ready';

  return {
    ready,
    status,
    label: V3_READINESS_STATUS_COPY[status].label,
    checklist,
    evidence,
    blockers,
    warnings,
    summary: buildReportSummary({
      ready,
      manualMissingCount: manualBlockers.length,
      referenceAcknowledged: evidence.referenceComparison.acknowledged,
      blockers,
      warnings,
    }),
    ...(typeof input.exportedAt === 'string' ? { exportedAt: input.exportedAt } : {}),
  };
}

export function buildV3ReadinessExport(
  report: V3ReadinessDashboardReport,
  options?: V3ReadinessDashboardExportOptions & { format?: 'object' }
): V3ReadinessDashboardExportObject;
export function buildV3ReadinessExport(
  report: V3ReadinessDashboardReport,
  options: V3ReadinessDashboardExportOptions & { format: 'string' }
): string;
export function buildV3ReadinessExport(
  report: V3ReadinessDashboardReport,
  options: V3ReadinessDashboardExportOptions = {}
): V3ReadinessDashboardExportObject | string {
  const exportedAt = options.exportedAt ?? report.exportedAt;
  const exportObject: V3ReadinessDashboardExportObject = {
    kind: 'v3-readiness-dashboard',
    version: 1,
    ready: report.ready,
    status: report.status,
    label: report.label,
    checklist: normalizeV3ReadinessChecklist(report.checklist),
    evidence: buildEvidence({
      suitFidelity: report.evidence.suitFidelity,
      referenceProportions: report.evidence.referenceProportions,
      visualQa: report.evidence.visualQa,
      poseClearance: report.evidence.poseClearance,
      performanceSmoke: report.evidence.performanceSmoke,
      referenceComparison: report.evidence.referenceComparison,
    }),
    blockers: report.blockers.map((blocker) => ({ ...blocker })),
    warnings: report.warnings.map((warning) => ({ ...warning })),
    summary: report.summary,
    ...(exportedAt ? { exportedAt } : {}),
  };

  return options.format === 'string'
    ? JSON.stringify(exportObject, null, 2)
    : exportObject;
}
