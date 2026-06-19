import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_OBJ_REFERENCE_PROPORTION_TARGETS,
} from '../components/v3/v3ReferenceProportions';
import {
  createV3ReadinessComparisonLoadout,
  hideV3ReadinessComparisonWeapons,
  normalizeV3ReadinessComparisonSubject,
} from './v3ReadinessDashboardPreview';
import {
  V3_READINESS_CHECKLIST_ITEM_IDS,
  V3_READINESS_CHECKLIST_STORAGE_KEY,
  V3_READINESS_STATUS_COPY,
  buildV3ReadinessDashboardReport,
  buildV3ReadinessExport,
  formatV3ReadinessCalibrationWorkflowText,
  getV3ReadinessCalibrationWorkflowState,
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

const readyReferenceProportions = {
  ready: true,
  issues: [],
  summary: {
    maxBandWidthDelta: 0.12,
    maxBandDepthDelta: 0.04,
    worstWidthBand: 'thigh',
    worstDepthBand: 'chest',
  },
};

const completeChecklist = () => (
  Object.fromEntries(
    V3_READINESS_CHECKLIST_ITEM_IDS.map((id) => [id, true])
  )
);

const readyInput = (): V3ReadinessDashboardInput => ({
  checklist: completeChecklist(),
  suitFidelity: readyEvidence,
  referenceProportions: readyReferenceProportions,
  referenceFeatureMatch: {
    ready: true,
    issues: [],
    summary: {
      averageScore: 0.94,
      readySlotCount: 18,
      slotCount: 18,
    },
  },
  referenceVoxelSource: {
    ready: true,
    issues: [],
    summary: {
      schemaVersion: 'v3-obj-surface-voxels/v1',
      slotCount: 19,
      totalVoxelCount: 101550,
      targetHeightVoxels: 192,
      surfaceThicknessVoxels: 1,
      excludedObjectCount: 4,
      sourceHash: 'sha256:abc123',
    },
  },
  visualQa: readyEvidence,
  poseClearance: readyEvidence,
  performanceSmoke: readyEvidence,
  referenceComparison: {
    acknowledged: true,
    acknowledgedBy: 'Phase 30',
    metadata: {
      fileName: 'Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
      kind: 'obj',
      rawAssetData: 'do-not-export',
    },
    proportionBands: {
      reference: V3_OBJ_REFERENCE_PROPORTION_TARGETS.bands,
      global: V3_OBJ_REFERENCE_PROPORTION_TARGETS.global,
      rawGeometry: 'do-not-export',
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
    referenceProportions: readyReferenceProportions,
    referenceFeatureMatch: readyEvidence,
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

test('buildV3ReadinessDashboardReport stays not-player-ready even after manual checklist, acknowledgement, and evidence are clean', () => {
  const report = buildV3ReadinessDashboardReport(readyInput());

  assert.equal(report.ready, false);
  assert.equal(report.status, 'not-player-ready');
  assert.equal(report.label, V3_READINESS_STATUS_COPY['not-player-ready'].label);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'v3InternalPrototypeGate'));
  assert.deepEqual(report.warnings, []);
  assert.equal(report.evidence.suitFidelity.ready, true);
  assert.equal(report.evidence.referenceProportions.ready, true);
  assert.equal(report.evidence.referenceVoxelSource.ready, true);
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

test('buildV3ReadinessDashboardReport keeps inspection-only reference files blocked', () => {
  const report = buildV3ReadinessDashboardReport({
    ...readyInput(),
    referenceComparison: {
      acknowledged: false,
      metadata: {
        fileName: 'Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.fbx',
        kind: 'fbx',
      },
      issues: ['Phase 32 calibration requires the canonical OBJ reference; FBX is inspection-only.'],
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.status, 'not-player-ready');
  assert.ok(report.blockers.some((blocker) => blocker.id === 'referenceComparisonAcknowledgement'));
  assert.ok(report.blockers.some((blocker) => (
    blocker.id === 'referenceComparisonEvidence' &&
    blocker.message.includes('canonical OBJ')
  )));
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
  assert.ok(report.blockers.some((blocker) => blocker.id === 'referenceProportionsEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'referenceFeatureMatchEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'referenceVoxelSourceEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'visualQaEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'poseClearanceEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'performanceSmokeEvidence'));
});

test('buildV3ReadinessDashboardReport supports deferred heavy evidence while generated source evidence is ready', () => {
  const report = buildV3ReadinessDashboardReport({
    checklist: completeChecklist(),
    referenceVoxelSource: readyInput().referenceVoxelSource,
    referenceComparison: {
      acknowledged: true,
      metadata: {
        fileName: 'Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
        kind: 'obj',
      },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.status, 'not-player-ready');
  assert.equal(report.evidence.referenceVoxelSource.ready, true);
  assert.equal(report.evidence.visualQa.ready, null);
  assert.equal(report.evidence.poseClearance.ready, null);
  assert.equal(report.evidence.performanceSmoke.ready, null);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'visualQaEvidence'));
  assert.ok(report.blockers.some((blocker) => blocker.id === 'performanceSmokeEvidence'));
});

test('getV3ReadinessCalibrationWorkflowState retires envelope candidates when generated OBJ voxel source is active', () => {
  const sourceActive = getV3ReadinessCalibrationWorkflowState({
    referenceKind: 'obj',
    referenceVoxelSource: readyInput().referenceVoxelSource,
  });

  assert.equal(sourceActive.status, 'source-active');
  assert.equal(sourceActive.shouldBuildEnvelopeCandidates, false);
  assert.match(sourceActive.message, /Exact OBJ surface voxel source is active/i);
  assert.match(sourceActive.message, /envelope calibration is retired/i);

  const missingSource = getV3ReadinessCalibrationWorkflowState({
    referenceKind: 'obj',
    referenceVoxelSource: {
      ready: false,
      issues: ['Generated source has no voxels.'],
      summary: { schemaVersion: 'v3-obj-surface-voxels/v1' },
    },
  });

  assert.equal(missingSource.status, 'candidate-required');
  assert.equal(missingSource.shouldBuildEnvelopeCandidates, true);

  const inspectionOnly = getV3ReadinessCalibrationWorkflowState({
    referenceKind: 'fbx',
    referenceVoxelSource: readyInput().referenceVoxelSource,
  });

  assert.equal(inspectionOnly.status, 'waiting');
  assert.equal(inspectionOnly.shouldBuildEnvelopeCandidates, false);
});

test('formatV3ReadinessCalibrationWorkflowText explains source-active calibration exports', () => {
  const state = getV3ReadinessCalibrationWorkflowState({
    referenceKind: 'obj',
    referenceVoxelSource: readyInput().referenceVoxelSource,
  });
  const text = formatV3ReadinessCalibrationWorkflowText(state);

  assert.match(text, /Calibration Status: source-active/);
  assert.match(text, /Rendered Gate Closure: Exact Source Active/);
  assert.match(text, /Candidates: 0/);
  assert.match(text, /Envelope calibration is retired/i);
  assert.doesNotMatch(text, /Load the canonical OBJ reference first/);
});

test('hideV3ReadinessComparisonWeapons hides all weapon groups without hiding the armor root', async () => {
  const THREE = await import('three');
  const group = new THREE.Group();
  const hammer = new THREE.Group();
  const sword = new THREE.Group();
  const pistol = new THREE.Group();
  hammer.userData.weaponType = 'hammer';
  sword.userData.weaponType = 'sword';
  pistol.userData.weaponType = 'pistol';
  hammer.visible = true;
  sword.visible = true;
  pistol.visible = true;
  group.visible = true;

  hideV3ReadinessComparisonWeapons({ group, hammer, sword, pistol });

  assert.equal(group.visible, true);
  assert.equal(hammer.visible, false);
  assert.equal(sword.visible, false);
  assert.equal(pistol.visible, false);
  assert.equal(hammer.userData.v3ReadinessComparisonHidden, true);
  assert.equal(sword.userData.v3ReadinessComparisonHidden, true);
  assert.equal(pistol.userData.v3ReadinessComparisonHidden, true);
});

test('createV3ReadinessComparisonLoadout uses a neutral body-only review palette', () => {
  const loadout = createV3ReadinessComparisonLoadout();
  const colors = loadout.paintJob?.v3RoleColors ?? {};

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(colors.primary, '#7dd3fc');
  assert.equal(colors.secondary, '#334155');
  assert.equal(colors.accent, '#94a3b8');
  assert.equal(colors.undersuit, '#111827');
  assert.notEqual(colors.accent, '#fbbf24');
  assert.deepEqual(loadout.paintJob?.v3RoleEmissive, {
    visor: true,
    emissive: true,
  });
});

test('normalizeV3ReadinessComparisonSubject scales review subjects to a shared standing height', async () => {
  const THREE = await import('three');
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 1),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.set(4, 8, -3);
  root.add(mesh);

  const result = normalizeV3ReadinessComparisonSubject(root, {
    targetHeight: 1.8,
  });
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  assert.equal(Number(size.y.toFixed(6)), 1.8);
  assert.ok(Math.abs(bounds.min.y) < 0.000001);
  assert.ok(Math.abs(center.x) < 0.000001);
  assert.ok(Math.abs(center.z) < 0.000001);
  assert.equal(Number(result.scale.toFixed(6)), 0.45);
  assert.equal(Number(result.normalizedHeight.toFixed(6)), 1.8);
});

test('buildV3ReadinessExport preserves sanitized OBJ proportion bands and strips raw payloads', () => {
  const report = buildV3ReadinessDashboardReport(readyInput());
  const exportObject = buildV3ReadinessExport(report);
  const exportedJson = JSON.stringify(exportObject);
  const proportionBands = exportObject.evidence.referenceComparison.proportionBands as {
    reference: { shin: { widthRatio: number } };
  };

  assert.equal(proportionBands.reference.shin.widthRatio, 0.3218);
  assert.equal(exportObject.evidence.referenceProportions.ready, true);
  assert.equal(exportObject.evidence.referenceFeatureMatch.ready, true);
  assert.equal(exportObject.evidence.referenceVoxelSource.ready, true);
  assert.equal(exportedJson.includes('rawGeometry'), false);
  assert.equal(exportedJson.includes('do-not-export'), false);
  assert.equal(exportedJson.includes('C:\\'), false);
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
  assert.equal(objectExport.status, 'not-player-ready');
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
