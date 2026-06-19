import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildV3ReadinessBaseline,
  formatV3ReadinessBaselineMarkdown,
  parseV3ReadinessDashboardExport,
  type V3ReadinessBaselineFinding,
} from './v3ReadinessBaseline';
import {
  V3_READINESS_CHECKLIST_ITEM_IDS,
  type V3ReadinessDashboardExportObject,
} from './v3ReadinessDashboard';

const completeChecklist = () => (
  Object.fromEntries(
    V3_READINESS_CHECKLIST_ITEM_IDS.map((id) => [id, true])
  ) as V3ReadinessDashboardExportObject['checklist']
);

const readyEvidence = () => ({
  ready: true,
  issueCount: 0,
  issues: [],
  summary: { checked: true },
});

const readyExport = (): V3ReadinessDashboardExportObject => ({
  kind: 'v3-readiness-dashboard',
  version: 1,
  ready: true,
  status: 'player-ready',
  label: 'Player Ready',
  checklist: completeChecklist(),
  evidence: {
    suitFidelity: readyEvidence(),
    referenceProportions: readyEvidence(),
    referenceFeatureMatch: readyEvidence(),
    referenceVoxelSource: readyEvidence(),
    visualQa: readyEvidence(),
    poseClearance: readyEvidence(),
    motionRetarget: readyEvidence(),
    performanceSmoke: readyEvidence(),
    referenceComparison: {
      acknowledged: true,
      issueCount: 0,
      issues: [],
      acknowledgedBy: 'Phase 30',
      acknowledgedAt: '2026-06-17T12:00:00.000Z',
      metadata: {
        fileName: 'phase30-reference.fbx',
        kind: 'fbx',
        byteLength: 40_000,
        meshCount: 8,
      },
      comparison: {
        mismatchNotes: [],
      },
    },
  },
  blockers: [],
  warnings: [],
  summary: 'Manual gates, reference comparison, and supplied evidence are ready.',
  exportedAt: '2026-06-17T12:30:00.000Z',
});

test('parseV3ReadinessDashboardExport accepts JSON strings and returns the sanitized dashboard export shape', () => {
  const parsed = parseV3ReadinessDashboardExport(JSON.stringify(readyExport()));

  assert.equal(parsed.kind, 'v3-readiness-dashboard');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.evidence.referenceComparison.acknowledged, true);
  assert.deepEqual(parsed.checklist, completeChecklist());
});

test('buildV3ReadinessBaseline blocks when reference metadata is missing', () => {
  const input = readyExport();
  delete input.evidence.referenceComparison.metadata;

  const report = buildV3ReadinessBaseline(input);

  assert.equal(report.status, 'blocked');
  assert.equal(report.ready, false);
  assert.ok(report.findings.some((finding) => (
    finding.category === 'referenceComparison' &&
    finding.severity === 'blocker' &&
    finding.message.includes('Reference metadata is missing')
  )));
});

test('buildV3ReadinessBaseline blocks when automated evidence is missing even if the manual checklist is complete', () => {
  const input = readyExport();
  input.evidence.visualQa.ready = null;
  input.evidence.visualQa.issues = [];
  input.evidence.visualQa.issueCount = 0;

  const report = buildV3ReadinessBaseline(input);

  assert.equal(report.status, 'blocked');
  assert.equal(report.ready, false);
  assert.equal(report.categories.builtInArmorFidelity.ready, false);
  assert.ok(report.findings.some((finding) => (
    finding.category === 'builtInArmorFidelity' &&
    finding.severity === 'blocker' &&
    finding.message.includes('Visual QA automated evidence is missing')
  )));
});

test('buildV3ReadinessBaseline produces prioritized findings from blockers, warnings, and evidence issues', () => {
  const input = readyExport();
  input.blockers = [{
    id: 'poseAtlas',
    source: 'poseAtlas',
    severity: 'blocker',
    message: 'Pose atlas has not been manually confirmed.',
  }];
  input.warnings = [{
    id: 'attackMovementAnimation',
    source: 'attackMovementAnimation',
    severity: 'warning',
    message: 'Attack movement animation needs another pass.',
  }];
  input.evidence.suitFidelity = {
    ready: false,
    issueCount: 1,
    issues: ['torso is too wide versus the reference'],
  };
  input.evidence.performanceSmoke = {
    ready: true,
    issueCount: 1,
    issues: ['one spike above frame budget'],
  };

  const report = buildV3ReadinessBaseline(input);
  const findingKeys = report.findings.map((finding) => [
    finding.category,
    finding.severity,
    finding.message,
    finding.recommendedNextPhase,
  ]);

  assert.deepEqual(findingKeys.slice(0, 5), [
    [
      'poseAtlas',
      'blocker',
      'Pose atlas has not been manually confirmed.',
      'Phase 32 pose atlas clearance',
    ],
    [
      'baseProportions',
      'blocker',
      'V3 remains an internal prototype and is not player-ready.',
      'Phase 32 base proportion tuning',
    ],
    [
      'baseProportions',
      'blocker',
      'Suit fidelity is not ready: torso is too wide versus the reference',
      'Phase 32 base proportion tuning',
    ],
    [
      'attackMovementAnimation',
      'warning',
      'Attack movement animation needs another pass.',
      'Phase 33 attack and movement animation pass',
    ],
    [
      'performanceSmoke',
      'warning',
      'Performance smoke reported issues: one spike above frame budget',
      'Phase 35 performance smoke hardening',
    ],
  ]);
  assert.ok(report.findings.every((finding): finding is V3ReadinessBaselineFinding => (
    finding.severity === 'blocker' || finding.severity === 'warning'
  )));
});

test('buildV3ReadinessBaseline maps reference proportion evidence failures to base proportions', () => {
  const input = readyExport();
  input.evidence.referenceProportions = {
    ready: false,
    issueCount: 1,
    issues: ['thigh band width remains 22% wider than OBJ reference'],
    summary: { worstWidthBand: 'thigh' },
  };

  const report = buildV3ReadinessBaseline(input);

  assert.equal(report.status, 'blocked');
  assert.equal(report.categories.baseProportions.ready, false);
  assert.ok(report.findings.some((finding) => (
    finding.category === 'baseProportions' &&
    finding.severity === 'blocker' &&
    finding.message.includes('thigh band width')
  )));
});

test('buildV3ReadinessBaseline maps reference feature-match failures to built-in armor fidelity', () => {
  const input = readyExport();
  input.evidence.referenceFeatureMatch = {
    ready: false,
    issueCount: 1,
    issues: ['helmet missing reference jaw feature coverage'],
    summary: { averageScore: 0.68 },
  };

  const report = buildV3ReadinessBaseline(input);

  assert.equal(report.status, 'blocked');
  assert.equal(report.categories.builtInArmorFidelity.ready, false);
  assert.ok(report.findings.some((finding) => (
    finding.category === 'builtInArmorFidelity' &&
    finding.severity === 'blocker' &&
    finding.message.includes('helmet missing reference jaw')
  )));
});

test('formatV3ReadinessBaselineMarkdown includes baseline sections and local JSON path convention', () => {
  const markdown = formatV3ReadinessBaselineMarkdown(buildV3ReadinessBaseline(readyExport()));

  assert.match(markdown, /^# V3 Readiness Baseline/m);
  assert.match(markdown, /Status: blocked/);
  assert.match(markdown, /internal prototype/);
  assert.match(markdown, /phase30-reference\.fbx/);
  assert.match(markdown, /## Prioritized Findings/);
  assert.match(markdown, /## Category Readiness/);
  assert.match(markdown, /## Assumptions/);
  assert.match(markdown, /\.codex\/v3-readiness-baselines\/phase31-reference-dashboard-export\.json/);
});

test('parsed output and Markdown exclude raw payload keys and absolute private file paths', () => {
  const input = readyExport();
  const privateFilePath = ['Z:', 'redacted-workspace', 'private', 'phase30-reference.fbx']
    .join(String.fromCharCode(92));
  input.evidence.referenceComparison.metadata = {
    fileName: privateFilePath,
    rawAssetData: 'raw-private-bytes',
    sourcePath: privateFilePath,
    nested: {
      mesh: 'private mesh payload',
      reviewer: 'Phase 30',
    },
  };

  const parsed = parseV3ReadinessDashboardExport(input);
  const parsedJson = JSON.stringify(parsed);
  const markdown = formatV3ReadinessBaselineMarkdown(buildV3ReadinessBaseline(parsed));

  assert.equal(parsedJson.includes('rawAssetData'), false);
  assert.equal(parsedJson.includes('raw-private-bytes'), false);
  assert.equal(parsedJson.includes(privateFilePath), false);
  assert.equal(parsedJson.includes('sourcePath'), false);
  assert.equal(parsedJson.includes('private mesh payload'), false);
  assert.match(parsedJson, /phase30-reference\.fbx/);

  assert.equal(markdown.includes('rawAssetData'), false);
  assert.equal(markdown.includes('raw-private-bytes'), false);
  assert.equal(markdown.includes(privateFilePath), false);
  assert.equal(markdown.includes('sourcePath'), false);
});
