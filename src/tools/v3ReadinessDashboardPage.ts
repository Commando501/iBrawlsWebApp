import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { buildV3SpartanModel } from '../components/v3/VoxelModelsV3';
import {
  analyzeV3AegisReferenceProportions,
  formatV3ReferenceProportionGapSummary,
  sampleV3ReferenceProportionBands,
  type V3ReferenceProportionReport,
} from '../components/v3/v3ReferenceProportions';
import { buildV3ExactSourceDashboardEvidence } from '../components/v3/v3ExactSourceBaseline';
import {
  analyzeV3AegisObjSurfaceSlotSegmentation,
  formatV3ObjSurfaceSlotSegmentationSummary,
} from '../components/v3/v3ObjSurfaceSlotSegmentation';
import {
  analyzeV3BuiltInReferenceFeatureMatch,
  analyzeV3BuiltInSuitFidelity,
  formatV3ReferenceFeatureMatchSummary,
  type V3ReferenceFeatureMatchReport,
} from '../components/v3/v3SuitFidelity';
import {
  V3_READINESS_CHECKLIST_COPY,
  V3_READINESS_CHECKLIST_ITEM_IDS,
  buildV3ReadinessDashboardReport,
  buildV3ReadinessExport,
  formatV3ReadinessCalibrationWorkflowText,
  getV3ReadinessCalibrationWorkflowState,
  persistV3ReadinessChecklist,
  readV3ReadinessChecklist,
  type V3ReadinessChecklist,
  type V3ReadinessCalibrationWorkflowState,
  type V3ReadinessDashboardReport,
  type V3ReadinessEvidenceSummaryInput,
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
import {
  buildV3ReferenceFeatureGuide,
  type V3ReferenceFeatureGuide,
} from './v3ReferenceFeatureGuide';
import {
  analyzeV3ReferenceFitGaps,
  formatV3ReferenceFitGapSummary,
  type V3ReferenceFitGapReport,
} from './v3ReferenceFitGaps';
import {
  createV3ReadinessComparisonLoadout,
  normalizeV3ReadinessComparisonSubject,
} from './v3ReadinessDashboardPreview';

type RenderView = 'front' | 'side';
type V3SmokeEvidenceReport = {
  ready: boolean;
  issues: readonly unknown[];
  qualityTier: string;
  combatantCount: number;
  budget: {
    drawCallEstimate: number;
    mergedBoxCount: number;
    memoryEstimateKb: number;
  };
  visualQaReady: boolean;
  visualQa: {
    issues: readonly unknown[];
    summary: unknown;
  };
  poseClearanceReady: boolean;
  poseClearance: {
    issues: readonly unknown[];
    summary: unknown;
  };
};

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
const featureGuideSummary = document.getElementById('featureGuideSummary') as HTMLDivElement;
const featureMatchReport = document.getElementById('featureMatchReport') as HTMLPreElement;
const fitGapSummary = document.getElementById('fitGapSummary') as HTMLDivElement | null;
const fitGapReport = document.getElementById('fitGapReport') as HTMLPreElement | null;
const acknowledgeReferenceButton = document.getElementById('ackReference') as HTMLButtonElement;
const downloadReportButton = document.getElementById('downloadReport') as HTMLButtonElement;
const copyReportButton = document.getElementById('copyReport') as HTMLButtonElement;
const downloadBaselineButton = document.getElementById('downloadBaseline') as HTMLButtonElement;
const copyBaselineButton = document.getElementById('copyBaseline') as HTMLButtonElement;
const downloadCalibrationButton = document.getElementById('downloadCalibration') as HTMLButtonElement;
const copyCalibrationButton = document.getElementById('copyCalibration') as HTMLButtonElement;
const downloadCalibrationJsonButton = document.getElementById('downloadCalibrationJson') as HTMLButtonElement;
const copyCalibrationJsonButton = document.getElementById('copyCalibrationJson') as HTMLButtonElement;
const runAutomatedEvidenceButton = document.getElementById('runAutomatedEvidence') as HTMLButtonElement | null;

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
let latestReferenceProportionReport: V3ReferenceProportionReport | null = null;
let latestReferenceScaffold: V3ReferenceScaffold | null = null;
let latestReferenceFeatureGuide: V3ReferenceFeatureGuide | null = null;
let latestReferenceFeatureMatch: V3ReferenceFeatureMatchReport | null = null;
let latestReferenceFitGaps: V3ReferenceFitGapReport | null = null;
let latestCalibrationReport: V3AegisCalibrationReport | null = null;
const exactSourceSegmentation = analyzeV3AegisObjSurfaceSlotSegmentation();
let latestSuitFidelityEvidence: V3ReadinessEvidenceSummaryInput;
let latestReferenceProportionEvidence: V3ReadinessEvidenceSummaryInput;
let latestVisualQaEvidence: V3ReadinessEvidenceSummaryInput;
let latestPoseEvidence: V3ReadinessEvidenceSummaryInput;
let latestPerformanceEvidence: V3ReadinessEvidenceSummaryInput;
let automatedEvidenceRunning = false;
let v3PreviewReady = false;
let v3PreviewError: string | null = null;
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

const pendingEvidence = (label: string): V3ReadinessEvidenceSummaryInput => ({
  issues: [],
  summary: {
    status: 'pending',
    message: `${label} has not been run for this dashboard session. Use Run Automated Evidence when you need the full local QA pass.`,
  },
});

const failedEvidence = (label: string, error: unknown): V3ReadinessEvidenceSummaryInput => ({
  ready: false,
  issues: [error instanceof Error ? error.message : String(error)],
  summary: {
    status: 'failed',
    label,
  },
});

latestSuitFidelityEvidence = pendingEvidence('Suit fidelity');
latestReferenceProportionEvidence = pendingEvidence('Reference proportions');
latestVisualQaEvidence = pendingEvidence('Visual QA');
latestPoseEvidence = pendingEvidence('Pose clearance');
latestPerformanceEvidence = pendingEvidence('Performance smoke');

function ensureV3PreviewModel(): boolean {
  if (v3PreviewReady) return true;
  if (v3PreviewError) return false;

  try {
    const v3Model = buildV3SpartanModel({
      customHue: 188,
      isEnemy: false,
      loadout: createV3ReadinessComparisonLoadout(),
      v3ArmorRenderStyle: 'voxelEdit',
      v3QualityTier: 'desktop',
    });
    v3Root.add(v3Model);
    normalizeV3ReadinessComparisonSubject(v3Root);
    v3PreviewReady = true;
    return true;
  } catch (error) {
    v3PreviewError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function compactSuitFidelityEvidence(
  suitFidelity: ReturnType<typeof analyzeV3BuiltInSuitFidelity>
): V3ReadinessEvidenceSummaryInput {
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

function compactReferenceProportionEvidence(
  referenceProportions: V3ReferenceProportionReport
): V3ReadinessEvidenceSummaryInput {
  return {
    ready: referenceProportions.ready,
    issues: referenceProportions.issues.map((issue) => `${issue.code}: ${issue.message}`),
    summary: {
      ...referenceProportions.summary,
      calibration: formatV3ReferenceProportionGapSummary(referenceProportions),
    },
  };
}

function compactReferenceFeatureMatchEvidence(): V3ReadinessEvidenceSummaryInput {
  if (!latestReferenceFeatureMatch) {
    return pendingEvidence('Reference feature match');
  }

  return {
    ready: latestReferenceFeatureMatch.ready,
    issues: latestReferenceFeatureMatch.issues.map((issue) => `${issue.slot} ${issue.code}: ${issue.message}`),
    summary: {
      ...latestReferenceFeatureMatch.summary,
      match: formatV3ReferenceFeatureMatchSummary(latestReferenceFeatureMatch),
    },
  };
}

function compactReferenceVoxelSourceEvidence() {
  return buildV3ExactSourceDashboardEvidence();
}

function currentCalibrationWorkflowState(): V3ReadinessCalibrationWorkflowState {
  return getV3ReadinessCalibrationWorkflowState({
    referenceKind: latestReferenceMetadata?.kind ?? null,
    referenceVoxelSource: compactReferenceVoxelSourceEvidence(),
  });
}

function compactVisualQaEvidence(smokeReport: V3SmokeEvidenceReport): V3ReadinessEvidenceSummaryInput {
  return {
    ready: smokeReport.visualQaReady,
    issues: smokeReport.visualQa.issues,
    summary: smokeReport.visualQa.summary,
  };
}

function compactPoseEvidence(smokeReport: V3SmokeEvidenceReport): V3ReadinessEvidenceSummaryInput {
  return {
    ready: smokeReport.poseClearanceReady,
    issues: smokeReport.poseClearance.issues,
    summary: smokeReport.poseClearance.summary,
  };
}

function compactPerformanceEvidence(smokeReport: V3SmokeEvidenceReport): V3ReadinessEvidenceSummaryInput {
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
    ...(v3PreviewError ? [`V3 preview model failed to initialize: ${v3PreviewError}`] : []),
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
    comparison: latestComparison ? assertNoV3ReferencePayloadPersisted({
      silhouette: latestComparison,
      segmentationReview: {
        ready: exactSourceSegmentation.ready,
        summary: exactSourceSegmentation.summary,
        bodyRebuildRequired: false,
        diagnostics: exactSourceSegmentation.diagnostics.slice(0, 12),
        referenceFitGaps: latestReferenceFitGaps ? {
          ready: latestReferenceFitGaps.ready,
          summary: latestReferenceFitGaps.summary,
          bodyRebuildRequired: false,
          topSlots: latestReferenceFitGaps.slots.slice(0, 8).map((slot) => ({
            slot: slot.slot,
            v3Slots: slot.v3Slots,
            current: slot.current,
            target: slot.target,
            targetConfidence: slot.targetConfidence,
            targetWarnings: slot.targetWarnings,
            maxSeverity: slot.maxSeverity,
            issues: slot.issues.map((issue) => ({
              code: issue.code,
              axis: issue.axis,
              direction: issue.direction,
              current: issue.current,
              target: issue.target,
              delta: issue.delta,
              severity: issue.severity,
              message: issue.message,
            })),
          })),
        } : null,
      },
    }) : undefined,
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
    suitFidelity: latestSuitFidelityEvidence,
    referenceProportions: latestReferenceProportionEvidence,
    referenceFeatureMatch: compactReferenceFeatureMatchEvidence(),
    referenceVoxelSource: compactReferenceVoxelSourceEvidence(),
    visualQa: latestVisualQaEvidence,
    poseClearance: latestPoseEvidence,
    performanceSmoke: latestPerformanceEvidence,
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
    metric('Static Body Baseline', report.evidence.referenceVoxelSource.ready ? 'Accepted' : 'Blocked'),
    metric('Reference Proportions', report.evidence.referenceProportions.ready ?? 'unknown'),
    metric('Reference Feature Match', report.evidence.referenceFeatureMatch.ready ?? 'unknown'),
    metric('Exact OBJ Voxel Source', report.evidence.referenceVoxelSource.ready ?? 'unknown'),
    metric('Segmentation Review', exactSourceSegmentation.summary.segmentationReviewCount),
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
  const workflowState = currentCalibrationWorkflowState();

  if (!latestCalibrationReport) {
    const renderedGateClosureStatus = workflowState.status === 'source-active'
      ? 'Exact Source Active'
      : workflowState.status === 'candidate-required'
        ? 'Reconstruction Required'
        : 'waiting';
    calibrationSummary.append(
      metric('Calibration Source', latestReferenceScaffold?.source.kind ?? 'none'),
      metric('Calibration Status', workflowState.status),
      metric('Rendered Gate Closure', renderedGateClosureStatus),
      metric('Candidates', 0)
    );
    calibrationReport.textContent = workflowState.status === 'source-active'
      ? `${workflowState.message} Reconstruction Required now means a rendered model gap should be handled through the exact OBJ voxel source pipeline, not another envelope patch.`
      : `${workflowState.message} Rendered Gate Closure will report Reconstruction Required when envelope candidates improve score but fail focused OBJ bands.`;
    return;
  }

  const best = latestCalibrationReport.candidates[0];
  const formattedCalibrationReport = formatV3AegisCalibrationReport(latestCalibrationReport);
  const renderedGateClosureStatus = formattedCalibrationReport.includes('reconstruction required')
    ? 'Reconstruction Required'
    : 'Closed';
  calibrationSummary.append(
    metric('Calibration Source', latestCalibrationReport.sourceKind),
    metric('Calibration Status', latestCalibrationReport.hardGateStatus),
    metric('Rendered Gate Closure', renderedGateClosureStatus),
    metric('Best Candidate', best?.id ?? 'none'),
    metric('Improvement', latestCalibrationReport.improvement.toFixed(6)),
    metric('Candidates', latestCalibrationReport.candidates.length)
  );
  calibrationReport.textContent = formattedCalibrationReport;
}

function renderFeatureMatch(): void {
  featureGuideSummary.innerHTML = '';
  const match = latestReferenceFeatureMatch;
  featureGuideSummary.append(
    metric('Guide Source', latestReferenceFeatureGuide?.source.fileName ?? 'built-in fallback'),
    metric('Guide Slots', latestReferenceFeatureGuide?.summary.slotCount ?? 0),
    metric('Feature Match', match?.ready ?? 'pending'),
    metric('Average Score', match ? match.summary.averageScore.toFixed(4) : 'pending')
  );

  if (!match) {
    featureMatchReport.textContent = 'Reference feature match has not been run for this dashboard session. Use Run Automated Evidence for the built-in fallback gate, or load the canonical OBJ to build guide-aware evidence.';
    return;
  }

  featureMatchReport.textContent = JSON.stringify({
    guide: latestReferenceFeatureGuide ? {
      source: latestReferenceFeatureGuide.source,
      slotOrder: latestReferenceFeatureGuide.slotOrder,
      summary: latestReferenceFeatureGuide.summary,
      slots: latestReferenceFeatureGuide.slotGuides.map((slotGuide) => ({
        slot: slotGuide.slot,
        objectCount: slotGuide.objectCount,
        panelZones: slotGuide.panelZones,
        centerlineGaps: slotGuide.centerlineGaps,
        materialRoleHints: slotGuide.materialRoleHints,
        symmetrySignature: slotGuide.symmetrySignature,
      })),
    } : null,
    match: {
      ready: match.ready,
      summary: match.summary,
      issues: match.issues.slice(0, 20),
    },
  }, null, 2);
}

function renderFitGaps(): void {
  if (!fitGapSummary || !fitGapReport) return;

  fitGapSummary.innerHTML = '';
  const report = latestReferenceFitGaps;
  fitGapSummary.append(
    metric('Segmentation Status', exactSourceSegmentation.ready ? 'review' : 'blocked'),
    metric('Slot Families', report?.summary.slotCount ?? 0),
    metric('Review Issues', report?.summary.issueCount ?? exactSourceSegmentation.summary.segmentationReviewCount),
    metric('Target Warnings', report?.summary.targetWarningCount ?? 'pending'),
    metric('Body Rebuild Required', 'false'),
    metric('Max Severity', report ? report.summary.maxSeverity.toFixed(2) : 'pending')
  );

  if (!report) {
    fitGapReport.textContent = `${formatV3ObjSurfaceSlotSegmentationSummary(exactSourceSegmentation)} Load the canonical OBJ reference to attach legacy slot-family fit gaps as segmentation diagnostics.`;
    return;
  }

  fitGapReport.textContent = JSON.stringify({
    segmentationReview: {
      ready: exactSourceSegmentation.ready,
      summary: exactSourceSegmentation.summary,
      text: formatV3ObjSurfaceSlotSegmentationSummary(exactSourceSegmentation),
      bodyRebuildRequired: false,
      diagnostics: exactSourceSegmentation.diagnostics.slice(0, 20),
    },
    summary: {
      ...report.summary,
      text: `${formatV3ReferenceFitGapSummary(report)} These are Phase 39 segmentation review diagnostics, not accepted-body reshape blockers.`,
      bodyRebuildRequired: false,
    },
    topSlots: report.slots.slice(0, 10).map((slot) => ({
      slot: slot.slot,
      v3Slots: slot.v3Slots,
      current: slot.current,
      target: slot.target,
      targetConfidence: slot.targetConfidence,
      targetWarnings: slot.targetWarnings,
      maxSeverity: slot.maxSeverity,
      ready: slot.ready,
      issues: slot.issues,
    })),
  }, null, 2);
}

function buildCalibrationJsonExport(): string {
  const workflowState = currentCalibrationWorkflowState();
  return JSON.stringify({
    kind: 'v3-aegis-calibration-report',
    version: 1,
    exportedAt: new Date().toISOString(),
    status: latestCalibrationReport?.hardGateStatus ?? workflowState.status,
    sourceKind: latestCalibrationReport?.sourceKind ?? latestReferenceMetadata?.kind ?? 'none',
    workflow: workflowState,
    referenceVoxelSource: compactReferenceVoxelSourceEvidence().summary,
    report: latestCalibrationReport,
    issue: latestCalibrationReport
      ? undefined
      : workflowState.status === 'source-active'
        ? 'Envelope calibration skipped because exact OBJ surface voxel source is active.'
        : 'No V3 Aegis calibration report is available. Load the canonical OBJ reference first.',
  }, null, 2);
}

function buildCalibrationTextExport(): string {
  return latestCalibrationReport
    ? formatV3AegisCalibrationReport(latestCalibrationReport)
    : formatV3ReadinessCalibrationWorkflowText(currentCalibrationWorkflowState());
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
    referenceFeatureGuide: latestReferenceFeatureGuide ? {
      source: latestReferenceFeatureGuide.source,
      slotOrder: latestReferenceFeatureGuide.slotOrder,
      summary: latestReferenceFeatureGuide.summary,
    } : undefined,
    referenceFeatureMatch: latestReferenceFeatureMatch?.summary ?? {
      status: 'pending',
    },
    segmentationReview: {
      ready: exactSourceSegmentation.ready,
      summary: exactSourceSegmentation.summary,
      bodyRebuildRequired: false,
      diagnostics: exactSourceSegmentation.diagnostics.slice(0, 12),
      referenceFitGaps: latestReferenceFitGaps ? {
        ready: latestReferenceFitGaps.ready,
        summary: latestReferenceFitGaps.summary,
        bodyRebuildRequired: false,
        topSlots: latestReferenceFitGaps.slots.slice(0, 8),
      } : {
        status: 'pending',
      },
    },
    referenceVoxelSource: compactReferenceVoxelSourceEvidence().summary,
    calibration: currentCalibrationWorkflowState(),
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
  if (runAutomatedEvidenceButton) {
    runAutomatedEvidenceButton.disabled = automatedEvidenceRunning;
    runAutomatedEvidenceButton.textContent = automatedEvidenceRunning
      ? 'Running Evidence...'
      : 'Run Automated Evidence';
  }
  statusLabel.textContent = latestReport.label;
  statusSummary.textContent = latestReport.summary;
  renderMetrics(latestReport);
  renderIssues(latestReport);
  renderBaseline(latestBaseline);
  renderCalibration();
  renderFeatureMatch();
  renderFitGaps();
  renderReferenceSummary();
  reportSummary.textContent = buildV3ReadinessExport(latestReport, {
    format: 'string',
    exportedAt: new Date().toISOString(),
  });
  (window as any).__IBRAWLS_V3_READINESS_DASHBOARD__ = latestReport;
  (window as any).__IBRAWLS_V3_READINESS_BASELINE__ = latestBaseline;
  (window as any).__IBRAWLS_V3_AEGIS_CALIBRATION__ = latestCalibrationReport;
  (window as any).__IBRAWLS_V3_REFERENCE_FEATURE_MATCH__ = latestReferenceFeatureMatch;
  (window as any).__IBRAWLS_V3_REFERENCE_FIT_GAPS__ = latestReferenceFitGaps;
  (window as any).__IBRAWLS_V3_SEGMENTATION_REVIEW__ = exactSourceSegmentation;
}

async function runAutomatedEvidence(): Promise<void> {
  if (automatedEvidenceRunning) return;

  automatedEvidenceRunning = true;
  latestSuitFidelityEvidence = pendingEvidence('Suit fidelity is running');
  latestReferenceProportionEvidence = pendingEvidence('Reference proportions are running');
  latestVisualQaEvidence = pendingEvidence('Visual QA is running');
  latestPoseEvidence = pendingEvidence('Pose clearance is running');
  latestPerformanceEvidence = pendingEvidence('Performance smoke is running');
  renderDashboard();

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    ensureV3PreviewModel();
    const suitFidelity = analyzeV3BuiltInSuitFidelity();
    latestSuitFidelityEvidence = compactSuitFidelityEvidence(suitFidelity);

    latestReferenceProportionReport = analyzeV3AegisReferenceProportions();
    latestReferenceProportionEvidence = compactReferenceProportionEvidence(latestReferenceProportionReport);
    latestReferenceFeatureMatch = analyzeV3BuiltInReferenceFeatureMatch(latestReferenceFeatureGuide);
    latestReferenceFitGaps = latestReferenceFeatureGuide
      ? analyzeV3ReferenceFitGaps(latestReferenceFeatureGuide)
      : null;

    const {
      buildV3PerformanceSmokeReport,
      buildV3PerformanceSmokeScene,
    } = await import('./v3PerformanceSmoke');
    const smokeScene = buildV3PerformanceSmokeScene({ qualityTier: 'desktop' });
    const smokeReport = buildV3PerformanceSmokeReport(smokeScene);
    latestVisualQaEvidence = compactVisualQaEvidence(smokeReport);
    latestPoseEvidence = compactPoseEvidence(smokeReport);
    latestPerformanceEvidence = compactPerformanceEvidence(smokeReport);
  } catch (error) {
    latestSuitFidelityEvidence = failedEvidence('Suit fidelity', error);
    latestReferenceProportionEvidence = failedEvidence('Reference proportions', error);
    latestVisualQaEvidence = failedEvidence('Visual QA', error);
    latestPoseEvidence = failedEvidence('Pose clearance', error);
    latestPerformanceEvidence = failedEvidence('Performance smoke', error);
  } finally {
    automatedEvidenceRunning = false;
    renderDashboard();
  }
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
  normalizeV3ReadinessComparisonSubject(root);
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
  referenceLoadError = null;
  renderDashboard();
  referenceAcknowledged = false;
  referenceAcknowledgedAt = undefined;
  referenceAcknowledgementIssue = null;
  latestReferenceScaffold = null;
  latestReferenceFeatureGuide = null;
  latestReferenceFeatureMatch = null;
  latestReferenceFitGaps = null;
  latestCalibrationReport = null;
  const kind = getV3ReferenceFileKind(file.name);
  const objText = kind === 'obj' ? await file.text() : undefined;
  const parsed = await parseReferenceFileFromSource(file, objText);
  const normalized = normalizeObjectForReview(parsed);
  referenceRoot.clear();
  referenceRoot.add(normalized);
  const referenceSilhouette = silhouetteFromObject(referenceRoot);
  ensureV3PreviewModel();
  latestReferenceProportionReport = latestReferenceProportionReport ?? analyzeV3AegisReferenceProportions();
  latestReferenceProportionEvidence = compactReferenceProportionEvidence(latestReferenceProportionReport);

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
    current: latestReferenceProportionReport.current.bands,
    target: latestReferenceProportionReport.targets.bands,
    reference: sampleV3ReferenceProportionBands(referenceRoot),
    global: referenceSilhouette,
    summary: latestReferenceProportionReport.summary,
    canonical: latestReferenceMetadata.kind === 'obj',
  };
  if (latestReferenceMetadata.kind === 'obj' && objText) {
    latestReferenceFeatureGuide = buildV3ReferenceFeatureGuide({
      objText,
      source: {
        kind: 'obj',
        fileName: file.name,
        label: file.name,
      },
    });
    latestReferenceScaffold = buildV3ReferenceScaffold({
      objText,
      source: {
        kind: 'obj',
        fileName: file.name,
        label: file.name,
      },
    });
    const workflowState = currentCalibrationWorkflowState();
    latestCalibrationReport = workflowState.shouldBuildEnvelopeCandidates
      ? buildV3AegisCalibrationCandidates(latestReferenceScaffold, {
        maxCandidates: 5,
      })
      : null;
    latestReferenceFeatureMatch = analyzeV3BuiltInReferenceFeatureMatch(latestReferenceFeatureGuide);
    latestReferenceFitGaps = analyzeV3ReferenceFitGaps(latestReferenceFeatureGuide);
  }
  renderDashboard();
}

function handleReferenceFile(file: File): void {
  referenceFileName.textContent = file.name;
  loadReference(file).catch((error) => {
    latestReferenceMetadata = null;
    latestComparison = null;
    latestReferenceFeatureGuide = null;
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
  const contents = buildCalibrationTextExport();
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'v3-aegis-calibration-report.txt';
  anchor.click();
  URL.revokeObjectURL(url);
});

copyCalibrationButton.addEventListener('click', () => {
  navigator.clipboard?.writeText(buildCalibrationTextExport()).catch(() => undefined);
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

runAutomatedEvidenceButton?.addEventListener('click', () => {
  void runAutomatedEvidence();
});

window.addEventListener('resize', renderComparison);
buildChecklist();
renderDashboard();
requestAnimationFrame(frame);
