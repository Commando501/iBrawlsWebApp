import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_READINESS_CHECKLIST_ITEM_IDS,
  V3_READINESS_CHECKLIST_STORAGE_KEY,
  V3_READINESS_STATUS_COPY,
  buildV3ReadinessDashboardReport,
  buildV3ReadinessExport,
  normalizeV3ReadinessChecklist,
  persistV3ReadinessChecklist,
  readV3ReadinessChecklist,
  type V3ReadinessDashboardInput,
} from './v3ReadinessDashboard';

const readyEvidence = {
  ready: true,
  issues: [],
  summary: { checked: true },
};

const completeChecklist = () => (
  Object.fromEntries(
    V3_READINESS_CHECKLIST_ITEM_IDS.map((id) => [id, true])
  )
);

const readyInput = (): V3ReadinessDashboardInput => ({
  checklist: completeChecklist(),
  suitFidelity: readyEvidence,
  visualQa: readyEvidence,
  poseClearance: readyEvidence,
  performanceSmoke: readyEvidence,
  referenceComparison: {
    acknowledged: true,
    acknowledgedBy: 'Phase 30',
    metadata: {
      sourceName: 'reference-bundle.fbx',
      rawAssetData: 'do-not-export',
    },
  },
});

test('normalizeV3ReadinessChecklist returns every known manual item with false defaults', () => {
  const normalized = normalizeV3ReadinessChecklist({
    baseProportions: true,
    poseAtlas: 1,
    unknownItem: true,
  });

  assert.deepEqual(Object.keys(normalized), [...V3_READINESS_CHECKLIST_ITEM_IDS]);
  assert.equal(normalized.baseProportions, true);
  assert.equal(normalized.poseAtlas, true);
  assert.equal(normalized.builtInArmorFidelity, false);
  assert.equal(normalized.attackMovementAnimation, false);
  assert.equal(normalized.referenceComparison, false);
  assert.equal(normalized.performanceSmoke, false);
});

test('buildV3ReadinessDashboardReport keeps passing metrics not player-ready until manual gates and reference acknowledgement pass', () => {
  const report = buildV3ReadinessDashboardReport({
    suitFidelity: readyEvidence,
    visualQa: readyEvidence,
    poseClearance: readyEvidence,
    performanceSmoke: readyEvidence,
  });

  assert.equal(report.ready, false);
  assert.equal(report.status, 'not-player-ready');
  assert.equal(report.label, V3_READINESS_STATUS_COPY['not-player-ready'].label);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'baseProportions'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'referenceComparisonAcknowledgement'));
  assert.match(report.summary, /reference comparison/i);
});

test('buildV3ReadinessDashboardReport returns player-ready only after manual checklist, acknowledgement, and evidence are clean', () => {
  const report = buildV3ReadinessDashboardReport(readyInput());

  assert.equal(report.ready, true);
  assert.equal(report.status, 'player-ready');
  assert.equal(report.label, V3_READINESS_STATUS_COPY['player-ready'].label);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.evidence.suitFidelity.ready, true);
  assert.equal(report.evidence.referenceComparison.acknowledged, true);
});

test('buildV3ReadinessDashboardReport adds automated evidence blockers without making manual checks authoritative by themselves', () => {
  const report = buildV3ReadinessDashboardReport({
    ...readyInput(),
    performanceSmoke: {
      ready: false,
      issues: ['average FPS 18.4 below target 30'],
      summary: { averageFps: 18.4, targetFps: 30 },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.status, 'not-player-ready');
  assert.ok(report.blockers.some((blocker) => (
    blocker.id === 'performanceSmokeEvidence' &&
    blocker.message.includes('average FPS')
  )));
  assert.equal(report.evidence.performanceSmoke.ready, false);
});

test('buildV3ReadinessDashboardReport blocks readiness when automated evidence is missing', () => {
  const report = buildV3ReadinessDashboardReport({
    checklist: completeChecklist(),
    referenceComparison: {
      acknowledged: true,
      metadata: { sourceName: 'reference-bundle.fbx' },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.status, 'not-player-ready');
  assert.ok(report.blockers.some((blocker) => (
    blocker.id === 'suitFidelityEvidence' &&
    blocker.message.includes('readiness evidence is missing')
  )));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'visualQaEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'poseClearanceEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'performanceSmokeEvidence'));
});

test('readV3ReadinessChecklist and persistV3ReadinessChecklist use a tiny storage interface', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  assert.deepEqual(readV3ReadinessChecklist(storage), normalizeV3ReadinessChecklist());

  persistV3ReadinessChecklist(storage, {
    baseProportions: true,
    performanceSmoke: true,
  });

  assert.ok(values.has(V3_READINESS_CHECKLIST_STORAGE_KEY));
  assert.deepEqual(readV3ReadinessChecklist(storage), {
    ...normalizeV3ReadinessChecklist(),
    baseProportions: true,
    performanceSmoke: true,
  });

  values.set(V3_READINESS_CHECKLIST_STORAGE_KEY, '{broken');
  assert.deepEqual(readV3ReadinessChecklist(storage), normalizeV3ReadinessChecklist());
});

test('buildV3ReadinessExport returns JSON-safe object or string without raw reference asset data', () => {
  const privateFilePath = ['Z:', 'redacted-workspace', 'private', 'phase30-reference.fbx']
    .join(String.fromCharCode(92));
  const input = readyInput();
  input.referenceComparison = {
    ...input.referenceComparison,
    metadata: {
      sourceName: privateFilePath,
      rawAssetData: 'do-not-export',
      sourcePath: privateFilePath,
      nested: {
        mesh: 'private mesh payload',
      },
    },
  };
  const report = buildV3ReadinessDashboardReport({
    ...input,
    exportedAt: '2026-06-17T12:00:00.000Z',
  });

  const objectExport = buildV3ReadinessExport(report);
  assert.equal(objectExport.kind, 'v3-readiness-dashboard');
  assert.equal(objectExport.version, 1);
  assert.equal(objectExport.status, 'player-ready');
  assert.equal(objectExport.exportedAt, '2026-06-17T12:00:00.000Z');
  assert.equal(
    JSON.stringify(objectExport).includes('do-not-export'),
    false
  );
  assert.equal(JSON.stringify(objectExport).includes(privateFilePath), false);
  assert.equal(JSON.stringify(objectExport).includes('sourcePath'), false);
  assert.equal(JSON.stringify(objectExport).includes('private mesh payload'), false);
  assert.match(JSON.stringify(objectExport), /phase30-reference\.fbx/);

  const stringExport = buildV3ReadinessExport(report, { format: 'string' });
  assert.equal(typeof stringExport, 'string');
  assert.equal(JSON.parse(stringExport).kind, 'v3-readiness-dashboard');
  assert.equal(stringExport.includes('do-not-export'), false);
  assert.equal(stringExport.includes(privateFilePath), false);
  assert.equal(stringExport.includes('sourcePath'), false);
});
