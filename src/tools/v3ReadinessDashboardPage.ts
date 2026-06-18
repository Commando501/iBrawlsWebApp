import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import {
  analyzeV3AegisReferenceProportions,
  formatV3ReferenceProportionGapSummary,
  sampleV3ReferenceProportionBands,
} from '../components/v3/v3ReferenceProportions';
import { analyzeV3BuiltInSuitFidelity } from '../components/v3/v3SuitFidelity';
import {
  buildV3PerformanceSmokeReport,
  buildV3PerformanceSmokeScene,
} from './v3PerformanceSmoke';
import {
  V3_READINESS_CHECKLIST_COPY,
  V3_READINESS_CHECKLIST_ITEM_IDS,
  buildV3ReadinessDashboardReport,
  buildV3ReadinessExport,
  persistV3ReadinessChecklist,
  readV3ReadinessChecklist,
  type V3ReadinessChecklist,
  type V3ReadinessDashboardReport,
  type V3ReadinessReferenceComparisonInput,
} from './v3ReadinessDashboard';
import {
  assertNoV3ReferencePayloadPersisted,
  buildV3ReferenceMetadata,
  compareV3ReferenceSilhouettes,
  getV3ReferenceFileKind,
  type V3ReferenceMetadata,
  type V3ReferenceSilhouette,
  type V3ReferenceSilhouetteComparison,
} from './v3ReferenceComparison';
import {
  buildV3ReadinessBaseline,
  formatV3ReadinessBaselineMarkdown,
  type V3ReadinessBaselineReport,
} from './v3ReadinessBaseline';
import {
  buildV3ReferenceScaffold,
  type V3ReferenceScaffold,
} from './v3ReferenceScaffold';
import {
  buildV3AegisCalibrationCandidates,
  formatV3AegisCalibrationReport,
  type V3AegisCalibrationReport,
} from './v3AegisAutoCalibration';

type RenderView = 'front' | 'side';

const canvas = document.getElementById('comparisonCanvas') as HTMLCanvasElement;
const statusLabel = document.getElementById('statusLabel') as HTMLSpanElement;
const statusSummary = document.getElementById('statusSummary') as HTMLSpanElement;
const checklistRoot = document.getElementById('checklist') as HTMLDivElement;
const referenceInput = document.getElementById('referenceInput') as HTMLInputElement;
const referenceDropZone = document.getElementById('referenceDropZone') as HTMLDivElement;
const referenceFileName = document.getElementById('referenceFileName') as HTMLSpanElement;
const referenceSummary = document.getElementById('referenceSummary') as HTMLPreElement;
const metricsRoot = document.getElementById('metrics') as HTMLDivElement;
const reportSummary = document.getElementById('reportSummary') as HTMLPreElement;
const issuesRoot = document.getElementById('issues') as HTMLDivElement;
const baselineSummary = document.getElementById('baselineSummary') as HTMLDivElement;
const baselineFindingsRoot = document.getElementById('baselineFindings') as HTMLDivElement;
const calibrationSummary = document.getElementById('calibrationSummary') as HTMLDivElement;
const calibrationReport = document.getElementById('calibrationReport') as HTMLPreElement;
const acknowledgeReferenceButton = document.getElementById('ackReference') as HTMLButtonElement;
const downloadReportButton = document.getElementById('downloadReport') as HTMLButtonElement;
const copyReportButton = document.getElementById('copyReport') as HTMLButtonElement;
const downloadBaselineButton = document.getElementById('downloadBaseline') as HTMLButtonElement;
const copyBaselineButton = document.getElementById('copyBaseline') as HTMLButtonElement;
const downloadCalibrationButton = document.getElementById('downloadCalibration') as HTMLButtonElement;
const copyCalibrationButton = document.getElementById('copyCalibration') as HTMLButtonElement;
const downloadCalibrationJsonButton = document.getElementById('downloadCalibrationJson') as HTMLButtonElement;
const copyCalibrationJsonButton = document.getElementById('copyCalibrationJson') as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setScissorTest(true);

const v3Scene = new THREE.Scene();
const referenceScene = new THREE.Scene();
const v3Camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
const referenceCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
const v3Root = new THREE.Group();
const referenceRoot = new THREE.Group();
let currentView: RenderView = 'front';
let checklist: V3ReadinessChecklist = readV3ReadinessChecklist(window.localStorage);
let latestReferenceMetadata: V3ReferenceMetadata | null = null;
let latestComparison: V3ReferenceSilhouetteComparison | null = null;
let latestReferenceProportionBands: Record<string, unknown> | null = null;
let latestReferenceScaffold: V3ReferenceScaffold | null = null;
let latestCalibrationReport: V3AegisCalibrationReport | null = null;
let referenceAcknowledged = false;
let referenceAcknowledgedAt: string | undefined;
let referenceLoadError: string | null = null;
let referenceAcknowledgementIssue: string | null = null;
let latestReport: V3ReadinessDashboardReport = buildV3ReadinessDashboardReport();
let latestBaseline: V3ReadinessBaselineReport = buildV3ReadinessBaseline(
  buildV3ReadinessExport(latestReport)
);

function setupScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color('#061018');
  scene.add(new THREE.HemisphereLight('#ffffff', '#1e293b', 1.8));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshStandardMaterial({
      color: '#0d1b22',
      roughness: 0.8,
      metalness: 0.05,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);
}

setupScene(v3Scene);
setupScene(referenceScene);
v3Scene.add(v3Root);
referenceScene.add(referenceRoot);

const v3Rig = createCombatantMeshRig(v3Scene, 188, false, {
  modelSystem: 'v3',
  paintJob: {
    v3RoleColors: {
      primary: '#38bdf8',
      secondary: '#0f172a',
      accent: '#fbbf24',
      visor: '#67e8f9',
      emissive: '#5eead4',
    },
    v3RoleEmissive: {
      visor: true,
      emissive: true,
    },
  },
}, {
  v3QualityTier: 'desktop',
});
v3Root.add(v3Rig.group);

const smokeScene = buildV3PerformanceSmokeScene({ qualityTier: 'desktop' });
const smokeReport = buildV3PerformanceSmokeReport(smokeScene);
const suitFidelity = analyzeV3BuiltInSuitFidelity();
const referenceProportions = analyzeV3AegisReferenceProportions();

function compactSuitFidelityEvidence() {
  const reports = Object.values(suitFidelity);
  const issues = reports.flatMap((report) => (
    report.issues.map((issue) => `${report.slot} ${issue.code}: ${issue.message}`)
  ));
  return {
    ready: issues.length === 0,
    issues,
    summary: {
      partCount: reports.length,
      readyPartCount: reports.filter((report) => report.ready).length,
      totalVoxels: reports.reduce((total, report) => total + report.voxelCount, 0),
      totalPanels: reports.reduce((total, report) => total + report.panelCount, 0),
    },
  };
}

function compactReferenceProportionEvidence() {
  return {
    ready: referenceProportions.ready,
    issues: referenceProportions.issues.map((issue) => `${issue.code}: ${issue.message}`),
    summary: {
      ...referenceProportions.summary,
      calibration: formatV3ReferenceProportionGapSummary(referenceProportions),
    },
  };
}

function compactVisualQaEvidence() {
  return {
    ready: smokeReport.visualQaReady,
    issues: smokeReport.visualQa.issues,
    summary: smokeReport.visualQa.summary,
  };
}

function compactPoseEvidence() {
  return {
    ready: smokeReport.poseClearanceReady,
    issues: smokeReport.poseClearance.issues,
    summary: smokeReport.poseClearance.summary,
  };
}

function compactPerformanceEvidence() {
  return {
    ready: smokeReport.ready,
    issues: smokeReport.issues,
    summary: {
      tier: smokeReport.qualityTier,
      combatantCount: smokeReport.combatantCount,
      drawCallEstimate: smokeReport.budget.drawCallEstimate,
      mergedBoxCount: smokeReport.budget.mergedBoxCount,
      memoryEstimateKb: smokeReport.budget.memoryEstimateKb,
    },
  };
}

function buildReferenceEvidence(): V3ReadinessReferenceComparisonInput {
  const hasComparison = Boolean(latestReferenceMetadata && latestComparison);
  const hasCanonicalObjReference = latestReferenceMetadata?.kind === 'obj';
  const issues = [
    ...(referenceAcknowledgementIssue ? [referenceAcknowledgementIssue] : []),
    ...(referenceLoadError
      ? [referenceLoadError]
      : hasComparison ? latestComparison?.mismatchNotes ?? [] : []),
    ...(hasComparison && !hasCanonicalObjReference
      ? ['Phase 33 calibration requires the canonical OBJ reference; FBX, GLB, and GLTF are inspection-only.']
      : []),
  ];
  return {
    acknowledged: referenceAcknowledged && hasComparison && hasCanonicalObjReference,
    metadata: latestReferenceMetadata ?? undefined,
    comparison: latestComparison ? assertNoV3ReferencePayloadPersisted(latestComparison) : undefined,
    proportionBands: latestReferenceProportionBands
      ? assertNoV3ReferencePayloadPersisted(latestReferenceProportionBands)
      : undefined,
    issues,
    ...(referenceAcknowledged && hasComparison && hasCanonicalObjReference && referenceAcknowledgedAt ? {
      acknowledgedAt: referenceAcknowledgedAt,
      acknowledgedBy: 'local-dashboard',
    } : {}),
  };
}

function buildDashboardReport(): V3ReadinessDashboardReport {
  return buildV3ReadinessDashboardReport({
    checklist,
    suitFidelity: compactSuitFidelityEvidence(),
    referenceProportions: compactReferenceProportionEvidence(),
    visualQa: compactVisualQaEvidence(),
    poseClearance: compactPoseEvidence(),
    performanceSmoke: compactPerformanceEvidence(),
    referenceComparison: buildReferenceEvidence(),
  });
}

function buildChecklist(): void {
  checklistRoot.innerHTML = '';
  for (const id of V3_READINESS_CHECKLIST_ITEM_IDS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checklist[id];
    input.addEventListener('change', () => {
      checklist = {
        ...checklist,
        [id]: input.checked,
      };
      persistV3ReadinessChecklist(window.localStorage, checklist);
      renderDashboard();
    });
    label.append(input, document.createTextNode(V3_READINESS_CHECKLIST_COPY[id]));
    checklistRoot.append(label);
  }
}

function metric(label: string, value: string | number | boolean): HTMLElement {
  const element = document.createElement('div');
  element.className = 'metric';
  const labelElement = document.createElement('span');
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.textContent = String(value);
  element.append(labelElement, valueElement);
  return element;
}

function renderMetrics(report: V3ReadinessDashboardReport): void {
  metricsRoot.innerHTML = '';
  metricsRoot.append(
    metric('Publish Status', report.label),
    metric('Manual Items', `${Object.values(report.checklist).filter(Boolean).length}/${V3_READINESS_CHECKLIST_ITEM_IDS.length}`),
    metric('Reference Loaded', Boolean(latestReferenceMetadata)),
    metric('Reference Acknowledged', report.evidence.referenceComparison.acknowledged),
    metric('Reference Proportions', report.evidence.referenceProportions.ready ?? 'unknown'),
    metric('Suit Fidelity', report.evidence.suitFidelity.ready ?? 'unknown'),
    metric('Visual QA', report.evidence.visualQa.ready ?? 'unknown'),
    metric('Pose Clearance', report.evidence.poseClearance.ready ?? 'unknown'),
    metric('Performance Smoke', report.evidence.performanceSmoke.ready ?? 'unknown')
  );
}

function renderIssues(report: V3ReadinessDashboardReport): void {
  issuesRoot.innerHTML = '';
  const issues = [...report.blockers, ...report.warnings];
  if (issues.length === 0) {
    const element = document.createElement('div');
    element.className = 'issue warning';
    element.textContent = 'No blockers or warnings in the current readiness report.';
    issuesRoot.append(element);
    return;
  }

  for (const issue of issues.slice(0, 18)) {
    const element = document.createElement('div');
    element.className = `issue${issue.severity === 'warning' ? ' warning' : ''}`;
    element.textContent = `${issue.severity.toUpperCase()}: ${issue.message}`;
    issuesRoot.append(element);
  }
}

function renderBaseline(baseline: V3ReadinessBaselineReport): void {
  baselineSummary.innerHTML = '';
  baselineSummary.append(
    metric('Baseline Status', baseline.status),
    metric('Source', baseline.sourceStatus),
    metric('Findings', baseline.findings.length),
    metric('Blockers', baseline.findings.filter((finding) => finding.severity === 'blocker').length)
  );

  baselineFindingsRoot.innerHTML = '';
  const findings = baseline.findings.slice(0, 10);
  if (findings.length === 0) {
    const element = document.createElement('div');
    element.className = 'issue warning';
    element.textContent = 'No baseline gaps were found in the sanitized dashboard export.';
    baselineFindingsRoot.append(element);
    return;
  }

  for (const finding of findings) {
    const element = document.createElement('div');
    element.className = `issue${finding.severity === 'warning' ? ' warning' : ''}`;
    element.textContent = `${finding.severity.toUpperCase()}: ${finding.message} | Next: ${finding.recommendedNextPhase}`;
    baselineFindingsRoot.append(element);
  }
}

function renderCalibration(): void {
  calibrationSummary.innerHTML = '';

  if (!latestCalibrationReport) {
    calibrationSummary.append(
      metric('Calibration Source', latestReferenceScaffold?.source.kind ?? 'none'),
      metric('Calibration Status', 'waiting'),
      metric('Candidates', 0)
    );
    calibrationReport.textContent = 'Load the canonical OBJ reference to build local V3 Aegis calibration candidates. FBX, GLB, and GLTF remain inspection-only.';
    return;
  }

  const best = latestCalibrationReport.candidates[0];
  calibrationSummary.append(
    metric('Calibration Source', latestCalibrationReport.sourceKind),
    metric('Calibration Status', latestCalibrationReport.hardGateStatus),
    metric('Best Candidate', best?.id ?? 'none'),
    metric('Improvement', latestCalibrationReport.improvement.toFixed(6)),
    metric('Candidates', latestCalibrationReport.candidates.length)
  );
  calibrationReport.textContent = formatV3AegisCalibrationReport(latestCalibrationReport);
}

function buildCalibrationJsonExport(): string {
  return JSON.stringify({
    kind: 'v3-aegis-calibration-report',
    version: 1,
    exportedAt: new Date().toISOString(),
    status: latestCalibrationReport?.hardGateStatus ?? 'missing',
    sourceKind: latestCalibrationReport?.sourceKind ?? 'none',
    report: latestCalibrationReport,
    issue: latestCalibrationReport ? undefined : 'No V3 Aegis calibration report is available. Load the canonical OBJ reference first.',
  }, null, 2);
}

function renderReferenceSummary(): void {
  if (referenceLoadError) {
    referenceSummary.textContent = referenceLoadError;
    return;
  }

  if (!latestReferenceMetadata) {
    referenceSummary.textContent = 'No local reference loaded. Load the OBJ canonical reference for Phase 33 calibration. FBX, GLB, and GLTF remain supported for inspection only.';
    return;
  }

  referenceSummary.textContent = JSON.stringify({
    metadata: latestReferenceMetadata,
    comparison: latestComparison,
    proportionBands: latestReferenceProportionBands,
    calibration: latestReferenceMetadata.kind === 'obj'
      ? 'OBJ canonical Phase 33 calibration source'
      : 'Inspection-only reference; use OBJ for Phase 33 calibration',
    calibrationCandidate: latestCalibrationReport ? {
      status: latestCalibrationReport.hardGateStatus,
      improvement: latestCalibrationReport.improvement,
      candidateCount: latestCalibrationReport.candidates.length,
      bestCandidate: latestCalibrationReport.candidates[0]?.id,
    } : undefined,
    acknowledgementIssue: referenceAcknowledgementIssue ?? undefined,
    acknowledged: referenceAcknowledged,
  }, null, 2);
}

function renderDashboard(): void {
  latestReport = buildDashboardReport();
  latestBaseline = buildV3ReadinessBaseline(buildV3ReadinessExport(latestReport));
  statusLabel.textContent = latestReport.label;
  statusSummary.textContent = latestReport.summary;
  renderMetrics(latestReport);
  renderIssues(latestReport);
  renderBaseline(latestBaseline);
  renderCalibration();
  renderReferenceSummary();
  reportSummary.textContent = buildV3ReadinessExport(latestReport, {
    format: 'string',
    exportedAt: new Date().toISOString(),
  });
  (window as any).__IBRAWLS_V3_READINESS_DASHBOARD__ = latestReport;
  (window as any).__IBRAWLS_V3_READINESS_BASELINE__ = latestBaseline;
  (window as any).__IBRAWLS_V3_AEGIS_CALIBRATION__ = latestCalibrationReport;
}

function objectBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function silhouetteFromObject(object: THREE.Object3D): V3ReferenceSilhouette {
  const box = objectBounds(object);
  const size = box.getSize(new THREE.Vector3());
  const frame = Math.max(size.x, size.y, size.z, 0.0001);
  return {
    front: {
      widthRatio: Number((size.x / frame).toFixed(6)),
      heightRatio: Number((size.y / frame).toFixed(6)),
      areaRatio: Number(((size.x * size.y) / (frame * frame)).toFixed(6)),
    },
    side: {
      widthRatio: Number((size.z / frame).toFixed(6)),
      heightRatio: Number((size.y / frame).toFixed(6)),
      areaRatio: Number(((size.z * size.y) / (frame * frame)).toFixed(6)),
    },
  };
}

function countObjectMetadata(object: THREE.Object3D): {
  objectCount: number;
  meshCount: number;
  triangleCount: number;
} {
  let objectCount = 0;
  let meshCount = 0;
  let triangleCount = 0;
  object.traverse((entry) => {
    objectCount += 1;
    const mesh = entry as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      meshCount += 1;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const indexCount = geometry.index?.count;
      const positionCount = geometry.attributes.position?.count ?? 0;
      triangleCount += Math.floor((indexCount ?? positionCount) / 3);
    }
  });
  return { objectCount, meshCount, triangleCount };
}

function normalizeObjectForReview(object: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.add(object);
  const sourceBounds = objectBounds(object);
  const center = sourceBounds.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const centeredBounds = objectBounds(root);
  const size = centeredBounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? 1.8 / size.y : 1;
  root.scale.setScalar(scale);
  root.position.y = 0.9;
  return root;
}

function boundsToMetadataBounds(object: THREE.Object3D) {
  const box = objectBounds(object);
  return {
    min: box.min.toArray() as [number, number, number],
    max: box.max.toArray() as [number, number, number],
  };
}

async function parseReferenceFile(file: File): Promise<THREE.Object3D> {
  return parseReferenceFileFromSource(file, undefined);
}

async function parseReferenceFileFromSource(
  file: File,
  objText: string | undefined
): Promise<THREE.Object3D> {
  const kind = getV3ReferenceFileKind(file.name);
  if (kind === 'unsupported') {
    throw new Error(`Unsupported reference file: ${file.name}`);
  }

  if (kind === 'obj') {
    return new OBJLoader().parse(objText ?? await file.text());
  }

  if (kind === 'fbx') {
    return new FBXLoader().parse(await file.arrayBuffer(), '');
  }

  const source = kind === 'glb' ? await file.arrayBuffer() : await file.text();
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      source,
      '',
      (result) => resolve(result.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error)))
    );
  });
}

async function loadReference(file: File): Promise<void> {
  referenceFileName.textContent = file.name;
  referenceSummary.textContent = `Loading ${file.name}...`;
  referenceAcknowledged = false;
  referenceAcknowledgedAt = undefined;
  referenceLoadError = null;
  referenceAcknowledgementIssue = null;
  latestReferenceScaffold = null;
  latestCalibrationReport = null;
  const kind = getV3ReferenceFileKind(file.name);
  const objText = kind === 'obj' ? await file.text() : undefined;
  const parsed = await parseReferenceFileFromSource(file, objText);
  const normalized = normalizeObjectForReview(parsed);
  referenceRoot.clear();
  referenceRoot.add(normalized);
  const referenceSilhouette = silhouetteFromObject(referenceRoot);

  const metadataCounts = countObjectMetadata(normalized);
  latestReferenceMetadata = buildV3ReferenceMetadata({
    fileName: file.name,
    byteLength: file.size,
    ...metadataCounts,
    bounds: boundsToMetadataBounds(normalized),
  });
  latestComparison = compareV3ReferenceSilhouettes(
    silhouetteFromObject(v3Root),
    referenceSilhouette
  );
  latestReferenceProportionBands = {
    current: referenceProportions.current.bands,
    target: referenceProportions.targets.bands,
    reference: sampleV3ReferenceProportionBands(referenceRoot),
    global: referenceSilhouette,
    summary: referenceProportions.summary,
    canonical: latestReferenceMetadata.kind === 'obj',
  };
  if (latestReferenceMetadata.kind === 'obj' && objText) {
    latestReferenceScaffold = buildV3ReferenceScaffold({
      objText,
      source: {
        kind: 'obj',
        fileName: file.name,
        label: file.name,
      },
    });
    latestCalibrationReport = buildV3AegisCalibrationCandidates(latestReferenceScaffold, {
      maxCandidates: 5,
    });
  }
  renderDashboard();
}

function handleReferenceFile(file: File): void {
  referenceFileName.textContent = file.name;
  loadReference(file).catch((error) => {
    latestReferenceMetadata = null;
    latestComparison = null;
    referenceAcknowledged = false;
    referenceAcknowledgedAt = undefined;
    referenceLoadError = error instanceof Error ? error.message : String(error);
    referenceFileName.textContent = 'Load failed - choose another file.';
    renderDashboard();
  });
}

function resizeRenderer(): void {
  const pixelRatio = renderer.getPixelRatio();
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
  }
}

function setCamera(camera: THREE.PerspectiveCamera, viewportWidth: number, viewportHeight: number): void {
  camera.aspect = Math.max(0.1, viewportWidth / Math.max(1, viewportHeight));
  camera.position.set(0, 1.15, 4.1);
  camera.lookAt(0, 0.95, 0);
  camera.updateProjectionMatrix();
}

function setViewRotation(): void {
  const rotation = currentView === 'side' ? Math.PI / 2 : 0;
  v3Root.rotation.y = rotation;
  referenceRoot.rotation.y = rotation;
}

function renderComparison(): void {
  resizeRenderer();
  setViewRotation();
  const width = canvas.width;
  const height = canvas.height;
  const halfWidth = Math.floor(width / 2);
  setCamera(v3Camera, halfWidth, height);
  setCamera(referenceCamera, width - halfWidth, height);
  renderer.clear();
  renderer.setViewport(0, 0, halfWidth, height);
  renderer.setScissor(0, 0, halfWidth, height);
  renderer.render(v3Scene, v3Camera);
  renderer.setViewport(halfWidth, 0, width - halfWidth, height);
  renderer.setScissor(halfWidth, 0, width - halfWidth, height);
  renderer.render(referenceScene, referenceCamera);
}

function frame(time: number): void {
  currentView = Math.floor(time / 4200) % 2 === 0 ? 'front' : 'side';
  renderComparison();
  requestAnimationFrame(frame);
}

referenceInput.addEventListener('change', () => {
  const file = referenceInput.files?.[0];
  if (!file) return;
  handleReferenceFile(file);
});

referenceDropZone.addEventListener('click', () => {
  referenceInput.click();
});

referenceDropZone.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  referenceInput.click();
});

for (const eventName of ['dragenter', 'dragover']) {
  referenceDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    referenceDropZone.classList.add('dragging');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  referenceDropZone.addEventListener(eventName, () => {
    referenceDropZone.classList.remove('dragging');
  });
}

referenceDropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    referenceLoadError = 'Drop a local FBX, GLB, GLTF, or OBJ reference file.';
    renderDashboard();
    return;
  }
  handleReferenceFile(file);
});

acknowledgeReferenceButton.addEventListener('click', () => {
  if (!latestReferenceMetadata || !latestComparison) {
    referenceLoadError = 'Load a local reference before acknowledging comparison.';
    renderDashboard();
    return;
  }
  if (latestReferenceMetadata.kind !== 'obj') {
    referenceAcknowledged = false;
    referenceAcknowledgedAt = undefined;
    referenceAcknowledgementIssue = 'Phase 33 calibration requires the canonical OBJ reference before acknowledgement; FBX, GLB, and GLTF remain inspection-only.';
    checklist = {
      ...checklist,
      referenceComparison: false,
    };
    persistV3ReadinessChecklist(window.localStorage, checklist);
    buildChecklist();
    renderDashboard();
    return;
  }
  referenceAcknowledged = true;
  referenceAcknowledgedAt = new Date().toISOString();
  referenceLoadError = null;
  referenceAcknowledgementIssue = null;
  checklist = {
    ...checklist,
    referenceComparison: true,
  };
  persistV3ReadinessChecklist(window.localStorage, checklist);
  buildChecklist();
  renderDashboard();
});

downloadReportButton.addEventListener('click', () => {
  const contents = buildV3ReadinessExport(latestReport, {
    format: 'string',
    exportedAt: new Date().toISOString(),
  });
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'v3-readiness-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
});

copyReportButton.addEventListener('click', () => {
  const contents = buildV3ReadinessExport(latestReport, {
    format: 'string',
    exportedAt: new Date().toISOString(),
  });
  navigator.clipboard?.writeText(contents).catch(() => undefined);
});

downloadBaselineButton.addEventListener('click', () => {
  const contents = formatV3ReadinessBaselineMarkdown(latestBaseline);
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/markdown' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'v3-phase-31-readiness-baseline.md';
  anchor.click();
  URL.revokeObjectURL(url);
});

copyBaselineButton.addEventListener('click', () => {
  navigator.clipboard?.writeText(formatV3ReadinessBaselineMarkdown(latestBaseline)).catch(() => undefined);
});

downloadCalibrationButton.addEventListener('click', () => {
  const contents = latestCalibrationReport
    ? formatV3AegisCalibrationReport(latestCalibrationReport)
    : 'No V3 Aegis calibration report is available. Load the canonical OBJ reference first.';
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'v3-aegis-calibration-report.txt';
  anchor.click();
  URL.revokeObjectURL(url);
});

copyCalibrationButton.addEventListener('click', () => {
  const contents = latestCalibrationReport
    ? formatV3AegisCalibrationReport(latestCalibrationReport)
    : 'No V3 Aegis calibration report is available. Load the canonical OBJ reference first.';
  navigator.clipboard?.writeText(contents).catch(() => undefined);
});

downloadCalibrationJsonButton.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([buildCalibrationJsonExport()], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'v3-aegis-calibration-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
});

copyCalibrationJsonButton.addEventListener('click', () => {
  navigator.clipboard?.writeText(buildCalibrationJsonExport()).catch(() => undefined);
});

window.addEventListener('resize', renderComparison);
buildChecklist();
renderDashboard();
requestAnimationFrame(frame);
