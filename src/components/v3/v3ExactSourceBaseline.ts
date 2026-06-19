import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';

export const V3_EXACT_SOURCE_BASELINE_ACCEPTANCE = {
  acceptedHash: 'sha256:d47bdeb71004a1d1f6f0129ca67ae96c0e74a9cf9e0b8ba449c9594555b1cef7',
  schemaVersion: 'v3-obj-surface-voxels/v1',
  targetHeightVoxels: 192,
  surfaceThicknessVoxels: 1,
  expectedSlotCount: 19,
  sourceKind: 'obj',
} as const;

export type V3ExactSourceBaselineStatus = 'accepted' | 'blocked';
export type V3ExactSourcePlayerReadiness = 'not-player-ready';

export type V3ExactSourceBaselineIssueCode =
  | 'schema-mismatch'
  | 'source-kind-mismatch'
  | 'hash-mismatch'
  | 'target-height-mismatch'
  | 'surface-thickness-mismatch'
  | 'slot-count-mismatch'
  | 'empty-source'
  | 'reference-proportions-missing'
  | 'reference-proportions-blocked'
  | 'visual-qa-missing'
  | 'visual-qa-blocked'
  | 'silhouette-delta-high';

export interface V3ExactSourceBaselineIssue {
  code: V3ExactSourceBaselineIssueCode;
  message: string;
  expected?: string | number;
  actual?: string | number | null;
}

export type V3ExactSourceJsonValue =
  | string
  | number
  | boolean
  | null
  | V3ExactSourceJsonValue[]
  | { [key: string]: V3ExactSourceJsonValue };

export interface V3ExactSourceReadinessEvidence {
  ready?: boolean | null;
  issues?: readonly unknown[];
  summary?: unknown;
}

export interface V3ExactSourceSilhouetteComparison {
  deltas?: {
    front?: Record<string, unknown>;
    side?: Record<string, unknown>;
  };
  mismatchNotes?: readonly unknown[];
}

export interface V3ExactSourceBaselineOptions {
  source?: unknown;
  referenceProportions?: V3ExactSourceReadinessEvidence;
  visualQa?: V3ExactSourceReadinessEvidence;
  silhouetteComparison?: V3ExactSourceSilhouetteComparison | null;
}

export interface V3ExactSourceEvidenceSummary {
  ready: boolean | null;
  issueCount: number;
  issues: string[];
  summary?: V3ExactSourceJsonValue;
}

export interface V3ExactSourceSilhouetteSummary {
  ready: boolean;
  issueCount: number;
  maxAbsDelta: number;
  tolerance: number;
  mismatchNotes: string[];
  deltas?: V3ExactSourceJsonValue;
}

export interface V3ExactSourceBaselineSummary {
  acceptedHash: typeof V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash;
  schemaVersion: string | null;
  sourceHash: string | null;
  sourceKind: string | null;
  sourceFileName?: string;
  targetHeightVoxels: number | null;
  surfaceThicknessVoxels: number | null;
  coordinateTargetHeightVoxels: number | null;
  voxelScale: number | null;
  coordinateDimensions?: readonly number[];
  slotCount: number | null;
  totalVoxelCount: number | null;
  totalRunCount: number | null;
  maxSlotVoxelCount: number | null;
  excludedObjectCount: number | null;
  sourceTriangleCount: number | null;
  referenceProportions: V3ExactSourceEvidenceSummary;
  visualQa: V3ExactSourceEvidenceSummary;
  silhouetteDelta?: V3ExactSourceSilhouetteSummary;
  playerReadiness: V3ExactSourcePlayerReadiness;
  note: string;
}

export interface V3ExactSourceBaselineReport {
  kind: 'v3-exact-source-baseline';
  version: 1;
  ready: boolean;
  status: V3ExactSourceBaselineStatus;
  issues: V3ExactSourceBaselineIssue[];
  summary: V3ExactSourceBaselineSummary;
}

export interface V3ExactSourceDashboardEvidence {
  ready: boolean;
  issues: string[];
  summary: {
    acceptedHash: typeof V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash;
    schemaVersion: string | null;
    sourceHash: string | null;
    sourceKind: string | null;
    sourceFileName?: string;
    targetHeightVoxels: number | null;
    surfaceThicknessVoxels: number | null;
    voxelScale: number | null;
    slotCount: number | null;
    totalVoxelCount: number | null;
    totalRunCount: number | null;
    maxSlotVoxelCount: number | null;
    excludedObjectCount: number | null;
    sourceTriangleCount: number | null;
    playerReadiness: V3ExactSourcePlayerReadiness;
    referenceProportionsEvidence: 'tracked-separately';
    visualQaEvidence: 'tracked-separately';
    silhouetteDeltaEvidence: 'optional-dashboard-reference-comparison';
  };
}

const SILHOUETTE_DELTA_TOLERANCE = 0.08;
const RAW_EXPORT_KEY_PATTERN =
  /^(raw|rawAssetData|rawGeometry|assetData|assetBytes|buffer|bytes|blob|geometry|mesh|meshes|scene|camera|voxels|snapshots|cases|overlays|sourcePath|path|absolutePath|localPath|filePath|payload|runs|slots)$/i;
const PRIVATE_PATH_PATTERN = /(?:[A-Za-z]:\\|\/Users\/|\\Users\\|\/home\/|\/var\/|\/tmp\/)/i;
const MAX_ISSUES_PER_ENTRY = 12;
const MAX_STRING_LENGTH = 1_000;
const MAX_JSON_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function numberAt(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberArrayAt(record: Record<string, unknown>, key: string): readonly number[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    return undefined;
  }
  return value;
}

function stripPrivatePath(value: string): string {
  const normalized = value.split(/[\\/]/).filter(Boolean);
  return normalized.length > 0 ? normalized[normalized.length - 1] : value;
}

function truncateString(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
}

function sanitizeString(value: string): string {
  return truncateString(PRIVATE_PATH_PATTERN.test(value) ? stripPrivatePath(value) : value);
}

function sanitizeJsonValue(value: unknown, depth = 0): V3ExactSourceJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= MAX_JSON_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonValue(entry, depth + 1))
      .filter((entry): entry is V3ExactSourceJsonValue => entry !== undefined);
  }
  if (isRecord(value)) {
    const sanitized: Record<string, V3ExactSourceJsonValue> = {};
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
  if (typeof issue === 'string') return sanitizeString(issue);
  if (isRecord(issue)) {
    const code = stringAt(issue, 'code');
    const message = stringAt(issue, 'message') ?? JSON.stringify(sanitizeJsonValue(issue) ?? {});
    return sanitizeString(code ? `${code}: ${message}` : message);
  }
  return sanitizeString(String(issue));
}

function normalizeIssueMessages(issues: readonly unknown[] | undefined): string[] {
  return (issues ?? [])
    .map(issueToMessage)
    .filter((message) => message.trim().length > 0)
    .slice(0, MAX_ISSUES_PER_ENTRY);
}

function addIssue(
  issues: V3ExactSourceBaselineIssue[],
  code: V3ExactSourceBaselineIssueCode,
  message: string,
  expected?: string | number,
  actual?: string | number | null
): void {
  issues.push({
    code,
    message,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
  });
}

function buildSourceSummary(source: unknown): Omit<
  V3ExactSourceBaselineSummary,
  'referenceProportions' | 'visualQa' | 'silhouetteDelta' | 'playerReadiness' | 'note'
> {
  const root = isRecord(source) ? source : {};
  const sourceInfo = recordAt(root, 'source');
  const options = recordAt(root, 'options');
  const coordinateSystem = recordAt(root, 'coordinateSystem');
  const metrics = recordAt(root, 'metrics');
  const dimensions = numberArrayAt(coordinateSystem, 'dimensions');

  return {
    acceptedHash: V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash,
    schemaVersion: stringAt(root, 'schemaVersion'),
    sourceHash: stringAt(sourceInfo, 'hash'),
    sourceKind: stringAt(sourceInfo, 'kind'),
    ...(stringAt(sourceInfo, 'fileName') ? { sourceFileName: stringAt(sourceInfo, 'fileName') as string } : {}),
    targetHeightVoxels: numberAt(options, 'targetHeightVoxels'),
    surfaceThicknessVoxels: numberAt(options, 'surfaceThicknessVoxels'),
    coordinateTargetHeightVoxels: numberAt(coordinateSystem, 'targetHeightVoxels'),
    voxelScale: numberAt(coordinateSystem, 'voxelScale'),
    ...(dimensions ? { coordinateDimensions: [...dimensions] } : {}),
    slotCount: numberAt(metrics, 'slotCount'),
    totalVoxelCount: numberAt(metrics, 'totalVoxelCount'),
    totalRunCount: numberAt(metrics, 'totalRunCount'),
    maxSlotVoxelCount: numberAt(metrics, 'maxSlotVoxelCount'),
    excludedObjectCount: numberAt(metrics, 'excludedObjectCount'),
    sourceTriangleCount: numberAt(metrics, 'sourceTriangleCount'),
  };
}

function validateSourceContract(source: unknown): {
  issues: V3ExactSourceBaselineIssue[];
  summary: ReturnType<typeof buildSourceSummary>;
} {
  const summary = buildSourceSummary(source);
  const issues: V3ExactSourceBaselineIssue[] = [];

  if (summary.schemaVersion !== V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.schemaVersion) {
    addIssue(
      issues,
      'schema-mismatch',
      `Exact OBJ voxel source schema is ${summary.schemaVersion ?? 'missing'}; expected ${V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.schemaVersion}.`,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.schemaVersion,
      summary.schemaVersion
    );
  }
  if (summary.sourceKind !== V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.sourceKind) {
    addIssue(
      issues,
      'source-kind-mismatch',
      `Exact source kind is ${summary.sourceKind ?? 'missing'}; expected ${V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.sourceKind}.`,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.sourceKind,
      summary.sourceKind
    );
  }
  if (summary.sourceHash !== V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash) {
    addIssue(
      issues,
      'hash-mismatch',
      `Exact source hash is ${summary.sourceHash ?? 'missing'}; expected accepted hash ${V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash}.`,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash,
      summary.sourceHash
    );
  }
  if (summary.targetHeightVoxels !== V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.targetHeightVoxels) {
    addIssue(
      issues,
      'target-height-mismatch',
      `Exact source target height is ${summary.targetHeightVoxels ?? 'missing'}; expected ${V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.targetHeightVoxels}.`,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.targetHeightVoxels,
      summary.targetHeightVoxels
    );
  }
  if (summary.surfaceThicknessVoxels !== V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.surfaceThicknessVoxels) {
    addIssue(
      issues,
      'surface-thickness-mismatch',
      `Exact source surface thickness is ${summary.surfaceThicknessVoxels ?? 'missing'}; expected ${V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.surfaceThicknessVoxels}.`,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.surfaceThicknessVoxels,
      summary.surfaceThicknessVoxels
    );
  }
  if (summary.slotCount !== V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.expectedSlotCount) {
    addIssue(
      issues,
      'slot-count-mismatch',
      `Exact source slot count is ${summary.slotCount ?? 'missing'}; expected ${V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.expectedSlotCount}.`,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.expectedSlotCount,
      summary.slotCount
    );
  }
  if ((summary.totalVoxelCount ?? 0) <= 0 || (summary.totalRunCount ?? 0) <= 0) {
    addIssue(
      issues,
      'empty-source',
      'Exact OBJ voxel source has no voxel/run payload to validate.',
      1,
      Math.min(summary.totalVoxelCount ?? 0, summary.totalRunCount ?? 0)
    );
  }

  return { issues, summary };
}

function normalizeEvidenceSummary(input: V3ExactSourceReadinessEvidence): V3ExactSourceEvidenceSummary {
  const issues = normalizeIssueMessages(input.issues);
  const summary = sanitizeJsonValue(input.summary);
  return {
    ready: typeof input.ready === 'boolean' ? input.ready : null,
    issueCount: issues.length,
    issues,
    ...(summary !== undefined ? { summary } : {}),
  };
}

function addEvidenceIssue(
  issues: V3ExactSourceBaselineIssue[],
  evidence: V3ExactSourceEvidenceSummary,
  label: string,
  missingCode: V3ExactSourceBaselineIssueCode,
  blockedCode: V3ExactSourceBaselineIssueCode
): void {
  if (evidence.ready === true) return;
  if (evidence.ready === false) {
    addIssue(
      issues,
      blockedCode,
      `${label} is not ready: ${evidence.issues[0] ?? 'reported readiness is false'}.`
    );
    return;
  }
  addIssue(issues, missingCode, `${label} evidence is missing.`);
}

function collectSilhouetteDeltas(comparison: V3ExactSourceSilhouetteComparison): {
  deltas: Record<string, Record<string, number>>;
  maxAbsDelta: number;
} {
  const deltas: Record<string, Record<string, number>> = {};
  let maxAbsDelta = 0;

  for (const view of ['front', 'side'] as const) {
    const viewDeltas = comparison.deltas?.[view];
    if (!isRecord(viewDeltas)) continue;
    deltas[view] = {};
    for (const [metric, value] of Object.entries(viewDeltas)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      deltas[view][metric] = value;
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(value));
    }
  }

  return { deltas, maxAbsDelta: Number(maxAbsDelta.toFixed(6)) };
}

function buildSilhouetteSummary(
  comparison: V3ExactSourceSilhouetteComparison | null | undefined
): V3ExactSourceSilhouetteSummary | undefined {
  if (!comparison) return undefined;
  const mismatchNotes = normalizeIssueMessages(comparison.mismatchNotes);
  const { deltas, maxAbsDelta } = collectSilhouetteDeltas(comparison);
  const ready = mismatchNotes.length === 0 && maxAbsDelta <= SILHOUETTE_DELTA_TOLERANCE;
  const sanitizedDeltas = sanitizeJsonValue(deltas);

  return {
    ready,
    issueCount: mismatchNotes.length + (maxAbsDelta > SILHOUETTE_DELTA_TOLERANCE ? 1 : 0),
    maxAbsDelta,
    tolerance: SILHOUETTE_DELTA_TOLERANCE,
    mismatchNotes,
    ...(sanitizedDeltas !== undefined ? { deltas: sanitizedDeltas } : {}),
  };
}

const missingEvidence: V3ExactSourceReadinessEvidence = {
  ready: null,
  issues: [],
};

export function buildV3ExactSourceBaseline({
  source = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE,
  referenceProportions = missingEvidence,
  visualQa = missingEvidence,
  silhouetteComparison,
}: V3ExactSourceBaselineOptions = {}): V3ExactSourceBaselineReport {
  const sourceContract = validateSourceContract(source);
  const referenceProportionsSummary = normalizeEvidenceSummary(referenceProportions);
  const visualQaSummary = normalizeEvidenceSummary(visualQa);
  const silhouetteSummary = buildSilhouetteSummary(silhouetteComparison);
  const issues = [...sourceContract.issues];

  addEvidenceIssue(
    issues,
    referenceProportionsSummary,
    'Reference proportions',
    'reference-proportions-missing',
    'reference-proportions-blocked'
  );
  addEvidenceIssue(
    issues,
    visualQaSummary,
    'Visual QA',
    'visual-qa-missing',
    'visual-qa-blocked'
  );

  if (silhouetteSummary && !silhouetteSummary.ready) {
    addIssue(
      issues,
      'silhouette-delta-high',
      silhouetteSummary.mismatchNotes[0] ??
        `Silhouette delta ${silhouetteSummary.maxAbsDelta} exceeds tolerance ${silhouetteSummary.tolerance}.`,
      silhouetteSummary.tolerance,
      silhouetteSummary.maxAbsDelta
    );
  }

  const ready = issues.length === 0;

  return {
    kind: 'v3-exact-source-baseline',
    version: 1,
    ready,
    status: ready ? 'accepted' : 'blocked',
    issues,
    summary: {
      ...sourceContract.summary,
      referenceProportions: referenceProportionsSummary,
      visualQa: visualQaSummary,
      ...(silhouetteSummary ? { silhouetteDelta: silhouetteSummary } : {}),
      playerReadiness: 'not-player-ready',
      note: 'V3 exact-source baseline is internal dashboard evidence only and does not mark V3 player ready.',
    },
  };
}

export function buildV3ExactSourceDashboardEvidence({
  source = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE,
}: {
  source?: unknown;
} = {}): V3ExactSourceDashboardEvidence {
  const sourceContract = validateSourceContract(source);
  return {
    ready: sourceContract.issues.length === 0,
    issues: sourceContract.issues.map((issue) => issue.message),
    summary: {
      acceptedHash: sourceContract.summary.acceptedHash,
      schemaVersion: sourceContract.summary.schemaVersion,
      sourceHash: sourceContract.summary.sourceHash,
      sourceKind: sourceContract.summary.sourceKind,
      ...(sourceContract.summary.sourceFileName ? { sourceFileName: sourceContract.summary.sourceFileName } : {}),
      targetHeightVoxels: sourceContract.summary.targetHeightVoxels,
      surfaceThicknessVoxels: sourceContract.summary.surfaceThicknessVoxels,
      voxelScale: sourceContract.summary.voxelScale,
      slotCount: sourceContract.summary.slotCount,
      totalVoxelCount: sourceContract.summary.totalVoxelCount,
      totalRunCount: sourceContract.summary.totalRunCount,
      maxSlotVoxelCount: sourceContract.summary.maxSlotVoxelCount,
      excludedObjectCount: sourceContract.summary.excludedObjectCount,
      sourceTriangleCount: sourceContract.summary.sourceTriangleCount,
      playerReadiness: 'not-player-ready',
      referenceProportionsEvidence: 'tracked-separately',
      visualQaEvidence: 'tracked-separately',
      silhouetteDeltaEvidence: 'optional-dashboard-reference-comparison',
    },
  };
}

export function analyzeV3ExactSourceBaseline(
  options: V3ExactSourceBaselineOptions = {}
): {
  ready: boolean;
  acceptedHash: string;
  currentHash: string;
  staticModelAccepted: boolean;
  issues: V3ExactSourceBaselineIssue[];
  summary: V3ExactSourceBaselineSummary & { status: V3ExactSourceBaselineStatus };
} {
  const report = buildV3ExactSourceBaseline(options);
  return {
    ready: report.ready,
    acceptedHash: V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash,
    currentHash: report.summary.sourceHash ?? 'missing',
    staticModelAccepted: report.ready,
    issues: report.issues,
    summary: {
      ...report.summary,
      status: report.status,
    },
  };
}
