import {
  V3_READINESS_CHECKLIST_COPY,
  buildV3ReadinessDashboardReport,
  buildV3ReadinessExport,
  type V3ReadinessChecklistItemId,
  type V3ReadinessDashboardExportObject,
  type V3ReadinessDashboardIssue,
  type V3ReadinessEvidenceKey,
  type V3ReadinessJsonValue,
} from './v3ReadinessDashboard';

export const V3_READINESS_BASELINE_LOCAL_JSON_PATH =
  '.codex/v3-readiness-baselines/phase31-reference-dashboard-export.json';

export type V3ReadinessBaselineStatus = 'blocked' | 'ready';
export type V3ReadinessBaselineSeverity = 'blocker' | 'warning';

export type V3ReadinessBaselineCategory =
  | 'baseProportions'
  | 'builtInArmorFidelity'
  | 'poseAtlas'
  | 'attackMovementAnimation'
  | 'referenceComparison'
  | 'performanceSmoke';

export interface V3ReadinessBaselineFinding {
  id: string;
  category: V3ReadinessBaselineCategory;
  severity: V3ReadinessBaselineSeverity;
  message: string;
  recommendedNextPhase: string;
}

export interface V3ReadinessBaselineCategoryReport {
  id: V3ReadinessBaselineCategory;
  label: string;
  ready: boolean;
  blockerCount: number;
  warningCount: number;
  summary: string;
}

export interface V3ReadinessBaselineReferenceSummary {
  fileName?: string;
  kind?: string;
  extension?: string;
  byteLength?: number;
  objectCount?: number;
  meshCount?: number;
  triangleCount?: number;
}

export interface V3ReadinessBaselineReport {
  kind: 'v3-readiness-baseline';
  version: 1;
  phase: 31;
  ready: boolean;
  status: V3ReadinessBaselineStatus;
  dashboardStatus: V3ReadinessDashboardExportObject['status'];
  dashboardLabel: string;
  localJsonPath: typeof V3_READINESS_BASELINE_LOCAL_JSON_PATH;
  exportedAt?: string;
  sourceStatus: 'missing-reference' | 'reference-loaded' | 'reference-acknowledged';
  reference?: V3ReadinessBaselineReferenceSummary;
  categories: Record<V3ReadinessBaselineCategory, V3ReadinessBaselineCategoryReport>;
  findings: V3ReadinessBaselineFinding[];
  summary: string;
  assumptions: string[];
}

const CATEGORY_ORDER: V3ReadinessBaselineCategory[] = [
  'baseProportions',
  'builtInArmorFidelity',
  'poseAtlas',
  'attackMovementAnimation',
  'referenceComparison',
  'performanceSmoke',
];

const CATEGORY_LABELS: Record<V3ReadinessBaselineCategory, string> = {
  baseProportions: 'Base proportions',
  builtInArmorFidelity: 'Built-in armor fidelity',
  poseAtlas: 'Pose atlas',
  attackMovementAnimation: 'Attack/movement animation',
  referenceComparison: 'Reference comparison',
  performanceSmoke: 'Performance smoke',
};

const NEXT_PHASE_BY_CATEGORY: Record<V3ReadinessBaselineCategory, string> = {
  baseProportions: 'Phase 32 base proportion tuning',
  builtInArmorFidelity: 'Phase 32 built-in armor fidelity tuning',
  poseAtlas: 'Phase 32 pose atlas clearance',
  attackMovementAnimation: 'Phase 33 attack and movement animation pass',
  referenceComparison: 'Phase 31 reference baseline capture',
  performanceSmoke: 'Phase 35 performance smoke hardening',
};

const MANUAL_SOURCE_TO_CATEGORY: Record<V3ReadinessChecklistItemId, V3ReadinessBaselineCategory> = {
  baseProportions: 'baseProportions',
  builtInArmorFidelity: 'builtInArmorFidelity',
  poseAtlas: 'poseAtlas',
  attackMovementAnimation: 'attackMovementAnimation',
  referenceComparison: 'referenceComparison',
  performanceSmoke: 'performanceSmoke',
};

const EVIDENCE_TO_CATEGORY: Record<V3ReadinessEvidenceKey, V3ReadinessBaselineCategory> = {
  suitFidelity: 'baseProportions',
  referenceProportions: 'baseProportions',
  referenceFeatureMatch: 'builtInArmorFidelity',
  referenceVoxelSource: 'baseProportions',
  visualQa: 'builtInArmorFidelity',
  poseClearance: 'poseAtlas',
  motionRetarget: 'attackMovementAnimation',
  performanceSmoke: 'performanceSmoke',
};

const EVIDENCE_LABELS: Record<V3ReadinessEvidenceKey, string> = {
  suitFidelity: 'Suit fidelity',
  referenceProportions: 'Reference proportions',
  referenceFeatureMatch: 'Reference feature match',
  referenceVoxelSource: 'Reference voxel source',
  visualQa: 'Visual QA',
  poseClearance: 'Pose clearance',
  motionRetarget: 'Motion retarget',
  performanceSmoke: 'Performance smoke',
};

const RAW_OR_PRIVATE_KEY_PATTERN =
  /^(raw|rawAssetData|rawGeometry|assetData|assetBytes|buffer|bytes|blob|geometry|mesh|meshes|scene|camera|voxels|snapshots|cases|overlays|sourcePath|path|absolutePath|localPath|filePath|payload)$/i;

const PRIVATE_PATH_PATTERN = /(?:[A-Za-z]:\\|\/Users\/|\\Users\\|\/home\/|\/var\/|\/tmp\/)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripPrivatePath(value: string): string {
  const normalized = value.split(/[\\/]/).filter(Boolean);
  return normalized.length > 0 ? normalized[normalized.length - 1] : value;
}

function sanitizeString(value: string): string {
  return PRIVATE_PATH_PATTERN.test(value) ? stripPrivatePath(value) : value;
}

function sanitizeJsonValue(value: unknown, depth = 0): V3ReadinessJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth > 5) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonValue(entry, depth + 1))
      .filter((entry): entry is V3ReadinessJsonValue => entry !== undefined);
  }
  if (isObject(value)) {
    const next: Record<string, V3ReadinessJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (RAW_OR_PRIVATE_KEY_PATTERN.test(key)) continue;
      const sanitized = sanitizeJsonValue(entry, depth + 1);
      if (sanitized !== undefined) {
        next[key] = sanitized;
      }
    }
    return next;
  }
  return undefined;
}

function parseInput(
  input: string | V3ReadinessDashboardExportObject
): Record<string, unknown> {
  if (typeof input === 'string') {
    const parsed = JSON.parse(input);
    if (!isObject(parsed)) {
      throw new Error('V3 readiness dashboard export must be a JSON object.');
    }
    return parsed;
  }
  return input as unknown as Record<string, unknown>;
}

function normalizeIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === 'string' ? sanitizeString(entry) : JSON.stringify(sanitizeJsonValue(entry) ?? {}))
    .filter((entry) => entry.trim().length > 0)
    .slice(0, 12);
}

function normalizeDashboardIssue(value: unknown): V3ReadinessDashboardIssue | undefined {
  if (!isObject(value)) return undefined;
  const severity = value.severity === 'warning' ? 'warning' : 'blocker';
  const message = typeof value.message === 'string'
    ? sanitizeString(value.message)
    : '';
  const id = typeof value.id === 'string' ? value.id : message;
  if (!id || !message) return undefined;
  const source = typeof value.source === 'string' ? value.source : undefined;
  return {
    id,
    severity,
    message,
    ...(source ? { source: source as V3ReadinessDashboardIssue['source'] } : {}),
  };
}

function normalizeEvidenceEntry(value: unknown): {
  ready: boolean | null;
  issueCount: number;
  issues: string[];
  summary?: V3ReadinessJsonValue;
} {
  if (!isObject(value)) {
    return { ready: null, issueCount: 0, issues: [] };
  }
  const issues = normalizeIssues(value.issues);
  const summary = sanitizeJsonValue(value.summary);
  return {
    ready: typeof value.ready === 'boolean' ? value.ready : null,
    issueCount: typeof value.issueCount === 'number' && Number.isFinite(value.issueCount)
      ? Math.max(0, Math.trunc(value.issueCount))
      : issues.length,
    issues,
    ...(summary !== undefined ? { summary } : {}),
  };
}

function normalizeReferenceComparison(value: unknown): V3ReadinessDashboardExportObject['evidence']['referenceComparison'] {
  if (!isObject(value)) {
    return {
      acknowledged: false,
      issueCount: 0,
      issues: [],
    };
  }
  const issues = normalizeIssues(value.issues);
  const metadata = sanitizeJsonValue(value.metadata);
  const comparison = sanitizeJsonValue(value.comparison);
  const proportionBands = sanitizeJsonValue(value.proportionBands);
  return {
    acknowledged: value.acknowledged === true,
    issueCount: typeof value.issueCount === 'number' && Number.isFinite(value.issueCount)
      ? Math.max(0, Math.trunc(value.issueCount))
      : issues.length,
    issues,
    ...(typeof value.acknowledgedAt === 'string' ? { acknowledgedAt: sanitizeString(value.acknowledgedAt) } : {}),
    ...(typeof value.acknowledgedBy === 'string' ? { acknowledgedBy: sanitizeString(value.acknowledgedBy) } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(comparison !== undefined ? { comparison } : {}),
    ...(proportionBands !== undefined ? { proportionBands } : {}),
  };
}

function normalizeChecklist(value: unknown): V3ReadinessDashboardExportObject['checklist'] {
  const record = isObject(value) ? value : {};
  return {
    baseProportions: Boolean(record.baseProportions),
    builtInArmorFidelity: Boolean(record.builtInArmorFidelity),
    poseAtlas: Boolean(record.poseAtlas),
    attackMovementAnimation: Boolean(record.attackMovementAnimation),
    referenceComparison: Boolean(record.referenceComparison),
    performanceSmoke: Boolean(record.performanceSmoke),
  };
}

function normalizeExport(raw: Record<string, unknown>): V3ReadinessDashboardExportObject {
  const evidence = isObject(raw.evidence) ? raw.evidence : {};
  const normalized: V3ReadinessDashboardExportObject = {
    kind: 'v3-readiness-dashboard',
    version: 1,
    ready: raw.ready === true,
    status: raw.status === 'player-ready' ? 'player-ready' : 'not-player-ready',
    label: typeof raw.label === 'string' ? sanitizeString(raw.label) : 'Not Player Ready',
    checklist: normalizeChecklist(raw.checklist),
    evidence: {
      suitFidelity: normalizeEvidenceEntry(evidence.suitFidelity),
      referenceProportions: normalizeEvidenceEntry(evidence.referenceProportions),
      referenceFeatureMatch: normalizeEvidenceEntry(evidence.referenceFeatureMatch),
      referenceVoxelSource: normalizeEvidenceEntry(evidence.referenceVoxelSource),
      visualQa: normalizeEvidenceEntry(evidence.visualQa),
      poseClearance: normalizeEvidenceEntry(evidence.poseClearance),
      motionRetarget: normalizeEvidenceEntry(evidence.motionRetarget),
      performanceSmoke: normalizeEvidenceEntry(evidence.performanceSmoke),
      referenceComparison: normalizeReferenceComparison(evidence.referenceComparison),
    },
    blockers: Array.isArray(raw.blockers)
      ? raw.blockers.map(normalizeDashboardIssue).filter((entry): entry is V3ReadinessDashboardIssue => Boolean(entry))
      : [],
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map(normalizeDashboardIssue).filter((entry): entry is V3ReadinessDashboardIssue => Boolean(entry))
      : [],
    summary: typeof raw.summary === 'string' ? sanitizeString(raw.summary) : '',
    ...(typeof raw.exportedAt === 'string' ? { exportedAt: sanitizeString(raw.exportedAt) } : {}),
  };

  const rebuilt = buildV3ReadinessExport(buildV3ReadinessDashboardReport({
    checklist: normalized.checklist,
    suitFidelity: normalized.evidence.suitFidelity,
    referenceProportions: normalized.evidence.referenceProportions,
    referenceFeatureMatch: normalized.evidence.referenceFeatureMatch,
    referenceVoxelSource: normalized.evidence.referenceVoxelSource,
    visualQa: normalized.evidence.visualQa,
    poseClearance: normalized.evidence.poseClearance,
    motionRetarget: normalized.evidence.motionRetarget,
    performanceSmoke: normalized.evidence.performanceSmoke,
    referenceComparison: normalized.evidence.referenceComparison,
    exportedAt: normalized.exportedAt,
  })) as V3ReadinessDashboardExportObject;

  return {
    ...rebuilt,
    blockers: [...normalized.blockers, ...rebuilt.blockers],
    warnings: [...normalized.warnings, ...rebuilt.warnings],
  };
}

function categoryForIssue(issue: V3ReadinessDashboardIssue): V3ReadinessBaselineCategory {
  if (issue.source === 'referenceComparisonAcknowledgement') return 'referenceComparison';
  if (issue.source && issue.source in MANUAL_SOURCE_TO_CATEGORY) {
    return MANUAL_SOURCE_TO_CATEGORY[issue.source as V3ReadinessChecklistItemId];
  }
  if (issue.source && issue.source in EVIDENCE_TO_CATEGORY) {
    return EVIDENCE_TO_CATEGORY[issue.source as V3ReadinessEvidenceKey];
  }
  if (issue.id.includes('performanceSmoke')) return 'performanceSmoke';
  if (issue.id.includes('motionRetarget')) return 'attackMovementAnimation';
  if (issue.id.includes('poseClearance')) return 'poseAtlas';
  if (issue.id.includes('visualQa')) return 'builtInArmorFidelity';
  if (issue.id.includes('suitFidelity')) return 'baseProportions';
  if (issue.id.includes('referenceComparison')) return 'referenceComparison';
  return 'baseProportions';
}

function findingId(
  category: V3ReadinessBaselineCategory,
  severity: V3ReadinessBaselineSeverity,
  message: string
): string {
  return `${category}:${severity}:${message.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)}`;
}

function addFinding(
  findings: V3ReadinessBaselineFinding[],
  category: V3ReadinessBaselineCategory,
  severity: V3ReadinessBaselineSeverity,
  message: string,
  recommendedNextPhase = NEXT_PHASE_BY_CATEGORY[category]
): void {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return;
  const id = findingId(category, severity, normalizedMessage);
  if (findings.some((finding) => finding.id === id)) return;
  findings.push({
    id,
    category,
    severity,
    message: normalizedMessage,
    recommendedNextPhase,
  });
}

function addDashboardIssues(
  findings: V3ReadinessBaselineFinding[],
  issues: readonly V3ReadinessDashboardIssue[]
): void {
  for (const issue of issues) {
    const category = categoryForIssue(issue);
    addFinding(
      findings,
      category,
      issue.severity,
      issue.message,
      NEXT_PHASE_BY_CATEGORY[category]
    );
  }
}

function firstIssue(issues: readonly string[]): string {
  return issues[0] ?? 'reported readiness is false';
}

function addEvidenceFindings(
  findings: V3ReadinessBaselineFinding[],
  exportObject: V3ReadinessDashboardExportObject
): void {
  for (const key of Object.keys(EVIDENCE_TO_CATEGORY) as V3ReadinessEvidenceKey[]) {
    const entry = exportObject.evidence[key];
    const category = EVIDENCE_TO_CATEGORY[key];
    if (entry.ready !== true) {
      addFinding(
        findings,
        category,
        'blocker',
        entry.ready === false
          ? `${EVIDENCE_LABELS[key]} is not ready: ${firstIssue(entry.issues)}`
          : `${EVIDENCE_LABELS[key]} automated evidence is missing.`,
        NEXT_PHASE_BY_CATEGORY[category]
      );
    } else if (entry.issueCount > 0) {
      addFinding(
        findings,
        category,
        'warning',
        `${EVIDENCE_LABELS[key]} reported issues: ${firstIssue(entry.issues)}`,
        NEXT_PHASE_BY_CATEGORY[category]
      );
    }
  }
}

function referenceMetadata(
  exportObject: V3ReadinessDashboardExportObject
): V3ReadinessBaselineReferenceSummary | undefined {
  const metadata = exportObject.evidence.referenceComparison.metadata;
  if (!isObject(metadata)) return undefined;
  const summary: V3ReadinessBaselineReferenceSummary = {};
  const fileName = typeof metadata.fileName === 'string'
    ? metadata.fileName
    : typeof metadata.sourceName === 'string'
      ? metadata.sourceName
      : undefined;
  if (fileName) summary.fileName = stripPrivatePath(fileName);
  for (const key of ['kind', 'extension'] as const) {
    if (typeof metadata[key] === 'string') summary[key] = metadata[key];
  }
  for (const key of ['byteLength', 'objectCount', 'meshCount', 'triangleCount'] as const) {
    if (typeof metadata[key] === 'number' && Number.isFinite(metadata[key])) {
      summary[key] = metadata[key];
    }
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function buildCategories(
  findings: readonly V3ReadinessBaselineFinding[]
): Record<V3ReadinessBaselineCategory, V3ReadinessBaselineCategoryReport> {
  return Object.fromEntries(
    CATEGORY_ORDER.map((id) => {
      const blockers = findings.filter((finding) => finding.category === id && finding.severity === 'blocker');
      const warnings = findings.filter((finding) => finding.category === id && finding.severity === 'warning');
      const ready = blockers.length === 0;
      return [id, {
        id,
        label: CATEGORY_LABELS[id],
        ready,
        blockerCount: blockers.length,
        warningCount: warnings.length,
        summary: ready
          ? warnings.length > 0
            ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} remain.`
            : 'No baseline blockers found.'
          : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} remain.`,
      }];
    })
  ) as Record<V3ReadinessBaselineCategory, V3ReadinessBaselineCategoryReport>;
}

function sortFindings(findings: V3ReadinessBaselineFinding[]): V3ReadinessBaselineFinding[] {
  return [...findings].sort((a, b) => {
    const severityDelta = Number(a.severity === 'warning') - Number(b.severity === 'warning');
    return severityDelta;
  });
}

export function parseV3ReadinessDashboardExport(
  input: string | V3ReadinessDashboardExportObject
): V3ReadinessDashboardExportObject {
  return normalizeExport(parseInput(input));
}

export function buildV3ReadinessBaseline(
  input: string | V3ReadinessDashboardExportObject
): V3ReadinessBaselineReport {
  const exportObject = parseV3ReadinessDashboardExport(input);
  const findings: V3ReadinessBaselineFinding[] = [];
  const reference = referenceMetadata(exportObject);

  if (!reference) {
    addFinding(
      findings,
      'referenceComparison',
      'blocker',
      'Reference metadata is missing from the dashboard export.',
      NEXT_PHASE_BY_CATEGORY.referenceComparison
    );
  }
  if (!exportObject.evidence.referenceComparison.acknowledged) {
    addFinding(
      findings,
      'referenceComparison',
      'blocker',
      'Reference comparison has not been acknowledged.',
      NEXT_PHASE_BY_CATEGORY.referenceComparison
    );
  }
  if (exportObject.evidence.referenceComparison.issueCount > 0) {
    addFinding(
      findings,
      'referenceComparison',
      'blocker',
      `Reference comparison reported issues: ${firstIssue(exportObject.evidence.referenceComparison.issues)}`,
      NEXT_PHASE_BY_CATEGORY.referenceComparison
    );
  }

  addDashboardIssues(findings, exportObject.blockers);
  addDashboardIssues(findings, exportObject.warnings);
  addEvidenceFindings(findings, exportObject);

  const sortedFindings = sortFindings(findings);
  const categories = buildCategories(sortedFindings);
  const ready = Boolean(reference) &&
    exportObject.evidence.referenceComparison.acknowledged &&
    sortedFindings.every((finding) => finding.severity !== 'blocker');
  const sourceStatus = !reference
    ? 'missing-reference'
    : exportObject.evidence.referenceComparison.acknowledged
      ? 'reference-acknowledged'
      : 'reference-loaded';

  return {
    kind: 'v3-readiness-baseline',
    version: 1,
    phase: 31,
    ready,
    status: ready ? 'ready' : 'blocked',
    dashboardStatus: exportObject.status,
    dashboardLabel: exportObject.label,
    localJsonPath: V3_READINESS_BASELINE_LOCAL_JSON_PATH,
    ...(exportObject.exportedAt ? { exportedAt: exportObject.exportedAt } : {}),
    sourceStatus,
    ...(reference ? { reference } : {}),
    categories,
    findings: sortedFindings,
    summary: ready
      ? 'Reference metadata, acknowledgement, and automated evidence are present. This is a baseline capture, not a player-readiness release claim.'
      : `Blocked baseline: ${sortedFindings.filter((finding) => finding.severity === 'blocker').length} blocker${sortedFindings.filter((finding) => finding.severity === 'blocker').length === 1 ? '' : 's'} remain.`,
    assumptions: [
      'Phase 31 is a baseline and reporting pass only.',
      'Raw FBX/GLB/OBJ assets remain browser-local and are never checked in or loaded by Node tooling.',
      'Manual checklist state and advisory warnings cannot create a player-ready claim without reference metadata, acknowledgement, and automated evidence.',
      'V1/V2 behavior, gameplay collision, hitboxes, reach, AI, networking, simulation, and save schemas are unchanged.',
    ],
  };
}

function markdownTableEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatReference(reference: V3ReadinessBaselineReferenceSummary | undefined): string[] {
  if (!reference) {
    return ['- Reference metadata: missing'];
  }
  const rows = [
    `- File: ${reference.fileName ?? 'unknown'}`,
    `- Type: ${reference.kind ?? reference.extension ?? 'unknown'}`,
  ];
  if (typeof reference.byteLength === 'number') rows.push(`- Bytes: ${reference.byteLength}`);
  if (typeof reference.meshCount === 'number') rows.push(`- Meshes: ${reference.meshCount}`);
  if (typeof reference.objectCount === 'number') rows.push(`- Objects: ${reference.objectCount}`);
  if (typeof reference.triangleCount === 'number') rows.push(`- Triangles: ${reference.triangleCount}`);
  return rows;
}

export function formatV3ReadinessBaselineMarkdown(
  report: V3ReadinessBaselineReport
): string {
  const findings = report.findings.length > 0
    ? [
      '| Priority | Severity | Category | Finding | Recommended Next Phase |',
      '| --- | --- | --- | --- | --- |',
      ...report.findings.map((finding, index) => (
        `| ${index + 1} | ${finding.severity} | ${CATEGORY_LABELS[finding.category]} | ${markdownTableEscape(finding.message)} | ${markdownTableEscape(finding.recommendedNextPhase)} |`
      )),
    ]
    : ['No blocker or warning findings were generated from the sanitized dashboard export.'];

  const categoryRows = [
    '| Category | Ready | Blockers | Warnings | Summary |',
    '| --- | --- | --- | --- | --- |',
    ...CATEGORY_ORDER.map((id) => {
      const category = report.categories[id];
      return `| ${category.label} | ${category.ready ? 'yes' : 'no'} | ${category.blockerCount} | ${category.warningCount} | ${markdownTableEscape(category.summary)} |`;
    }),
  ];

  return [
    '# V3 Readiness Baseline',
    '',
    `Status: ${report.status}`,
    `Dashboard status: ${report.dashboardLabel}`,
    `Phase: ${report.phase}`,
    `Local private JSON convention: ${report.localJsonPath}`,
    ...(report.exportedAt ? [`Dashboard exported at: ${report.exportedAt}`] : []),
    '',
    '## Summary',
    '',
    report.summary,
    '',
    '## Reference Source',
    '',
    ...formatReference(report.reference),
    `- Source status: ${report.sourceStatus}`,
    '',
    '## Prioritized Findings',
    '',
    ...findings,
    '',
    '## Category Readiness',
    '',
    ...categoryRows,
    '',
    '## Assumptions',
    '',
    ...report.assumptions.map((assumption) => `- ${assumption}`),
    '',
  ].join('\n');
}
