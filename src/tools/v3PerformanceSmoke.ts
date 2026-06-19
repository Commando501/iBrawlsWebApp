import * as THREE from 'three';
import {
  createCombatantMeshRig,
  type CombatantMeshRig,
} from '../components/grifball/combatantModels';
import {
  analyzeV3BuiltInPoseClearance,
  type V3PoseClearanceReport,
} from '../components/grifball/v3PoseClearance';
import { summarizeV3SceneRenderBudget, type V3RenderBudgetSummary } from '../components/v3/v3PerformanceBudget';
import {
  analyzeV3ExactSourceLodBudget,
  type V3ExactSourceLodBudgetReport,
} from '../components/v3/v3ExactSourceLod';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import { V3_QUALITY_TIERS, type V3QualityTier } from '../components/v3/v3ModelTypes';
import type { CharacterLoadout } from '../components/VoxelModels';
import { buildV3VisualQaReport, type V3VisualQaIssue, type V3VisualQaReport } from './v3VisualQa';

export interface V3PerformanceSmokeCombatant {
  id: string;
  meshes: CombatantMeshRig;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  loadout: CharacterLoadout;
}

export interface V3PerformanceSmokeBudgetGate {
  maxDrawCallEstimate: number;
  maxMergedBoxCount: number;
  maxMemoryEstimateKb: number;
}

export interface V3PerformanceSmokeReport {
  ready: boolean;
  qualityTier: V3QualityTier;
  combatantCount: number;
  weaponCoverage: ('hammer' | 'pistol' | 'sword')[];
  budget: V3RenderBudgetSummary;
  gates: V3PerformanceSmokeBudgetGate;
  visualQaReady: boolean;
  visualQa: V3VisualQaReport;
  poseClearanceReady: boolean;
  poseClearance: V3PoseClearanceReport;
  exactSourceLodBudgetReady: boolean;
  exactSourceLodBudget: V3ExactSourceLodBudgetReport;
  issues: string[];
}

export interface V3PerformanceSmokeRuntimeSample {
  sampledFrames: number;
  elapsedMs: number;
}

export interface V3PerformanceSmokeRuntimeReport extends V3PerformanceSmokeReport {
  runtimeReady: boolean;
  sampledFrames: number;
  elapsedMs: number;
  averageFps: number;
  averageFrameMs: number;
  targetFps: number;
}

export const V3_PERFORMANCE_SMOKE_BUDGETS: Record<V3QualityTier, V3PerformanceSmokeBudgetGate> = {
  mobileLow: { maxDrawCallEstimate: 410, maxMergedBoxCount: 165000, maxMemoryEstimateKb: 37000 },
  mobile: { maxDrawCallEstimate: 410, maxMergedBoxCount: 165000, maxMemoryEstimateKb: 37000 },
  desktop: { maxDrawCallEstimate: 550, maxMergedBoxCount: 255000, maxMemoryEstimateKb: 55000 },
  ultra: { maxDrawCallEstimate: 650, maxMergedBoxCount: 305000, maxMemoryEstimateKb: 66000 },
};

export const V3_PERFORMANCE_RUNTIME_TARGET_FPS: Record<V3QualityTier, number> = {
  mobileLow: 20,
  mobile: 24,
  desktop: 30,
  ultra: 30,
};

let exactBodyPoseClearance: V3PoseClearanceReport | undefined;

const getCachedV3PerformancePoseClearance = (): V3PoseClearanceReport => {
  const cached = exactBodyPoseClearance;
  if (cached) return cached;
  // Pose clearance gates the accepted exact body; reduced mobile LODs are budget diagnostics.
  const report = analyzeV3BuiltInPoseClearance({
    v3Options: { v3QualityTier: 'desktop' },
  });
  exactBodyPoseClearance = report;
  return report;
};

const MIN_RUNTIME_SAMPLE_FRAMES = 30;
const weapons = ['hammer', 'sword', 'pistol'] as const;

const resolveV3PerformanceSmokeRenderTier = (qualityTier: V3QualityTier): V3QualityTier =>
  qualityTier === 'mobileLow' ? 'mobileLow' : 'mobile';

const smokePaints = [
  ['#4f86f7', '#f97316'],
  ['#ef4444', '#22d3ee'],
  ['#22c55e', '#eab308'],
  ['#a855f7', '#f8fafc'],
] as const;

function createSmokeLoadout(index: number): CharacterLoadout {
  const [primary, accent] = smokePaints[index % smokePaints.length];
  return {
    modelSystem: 'v3',
    helmet: index % 2 === 0 ? 'mark-vi' : 'odst',
    torso: 'mark-vi',
    arm: 'mark-vi',
    leg: 'mark-vi',
    hammerPreset: index % 2 === 0 ? 'gravity-axe' : 'default',
    swordPreset: index % 3 === 0 ? 'infinite' : 'default',
    paintJob: {
      v3RoleColors: {
        primary,
        accent,
        visor: '#67e8f9',
        emissive: '#5eead4',
      },
      v3RoleEmissive: {
        visor: true,
        emissive: true,
      },
    },
  };
}

export function createV3PerformanceSmokeCombatants(
  scene: THREE.Scene,
  qualityTier: V3QualityTier
): V3PerformanceSmokeCombatant[] {
  const renderQualityTier = resolveV3PerformanceSmokeRenderTier(qualityTier);
  return Array.from({ length: 8 }, (_, index) => {
    const loadout = createSmokeLoadout(index);
    const meshes = createCombatantMeshRig(scene, (index * 47) % 360, false, loadout, {
      v3QualityTier: renderQualityTier,
      v3Distance: index * 3,
    });
    meshes.group.userData.v3PerformanceSmokeQualityTier = qualityTier;
    meshes.group.userData.v3PerformanceSmokeRenderTier = renderQualityTier;
    const row = index < 4 ? 0 : 1;
    const col = index % 4;
    meshes.group.position.set((col - 1.5) * 1.8, 0, row === 0 ? -1.4 : 1.4);
    meshes.group.rotation.y = row === 0 ? 0.25 : Math.PI - 0.25;

    const activeWeapon = weapons[index % weapons.length];
    meshes.hammer.visible = activeWeapon === 'hammer';
    meshes.sword.visible = activeWeapon === 'sword';
    if (meshes.pistol) {
      meshes.pistol.visible = activeWeapon === 'pistol';
    }

    return {
      id: `smoke-${index + 1}`,
      meshes,
      activeWeapon,
      loadout,
    };
  });
}

export function buildV3PerformanceSmokeScene({
  qualityTier,
}: {
  qualityTier: V3QualityTier;
}) {
  const normalizedTier = normalizeV3QualityTier(qualityTier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#071014');

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
  camera.position.set(0, 3.2, 8);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.HemisphereLight('#ffffff', '#223344', 1.7));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 6),
    new THREE.MeshStandardMaterial({
      color: '#0f1f25',
      roughness: 0.78,
      metalness: 0.08,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const combatants = createV3PerformanceSmokeCombatants(scene, normalizedTier);
  const budget = summarizeV3SceneRenderBudget(scene);
  return {
    scene,
    camera,
    combatants,
    budget,
    qualityTier: normalizedTier,
  };
}

function emptyV3VisualQaReport(): V3VisualQaReport {
  return {
    ready: false,
    snapshots: [],
    issues: [{
      code: 'missing_visual_mass',
      message: 'performance smoke has no combatants to sample',
    }],
    summary: {
      snapshotCount: 0,
      minOccupiedAreaRatio: 0,
      maxOccupiedAreaRatio: 0,
      minProjectedWidth: 0,
      minProjectedHeight: 0,
      maxDarkMaterialCoverage: 0,
      maxEmissiveMaterialCoverage: 0,
      panelCount: 0,
      materialGroupCount: 0,
      visibleImportantPartCount: 0,
      importantPartCount: 0,
    },
  };
}

function roundSmokeMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function buildCombinedV3SmokeVisualQaReport(combatants: readonly V3PerformanceSmokeCombatant[]): V3VisualQaReport {
  if (combatants.length === 0) {
    return emptyV3VisualQaReport();
  }

  const reports = combatants.map((combatant) => ({
    id: combatant.id,
    report: buildV3VisualQaReport(combatant.meshes.group),
  }));
  const snapshots = reports.flatMap((entry) => entry.report.snapshots);
  const issues: V3VisualQaIssue[] = reports.flatMap((entry) => (
    entry.report.issues.map((issue) => ({
      ...issue,
      message: `${entry.id}: ${issue.message}`,
    }))
  ));
  const occupied = snapshots.map((snapshot) => snapshot.occupiedAreaRatio);
  const widths = snapshots.map((snapshot) => snapshot.projectedWidth);
  const heights = snapshots.map((snapshot) => snapshot.projectedHeight);

  return {
    ready: issues.length === 0,
    snapshots,
    issues,
    summary: {
      snapshotCount: snapshots.length,
      minOccupiedAreaRatio: roundSmokeMetric(occupied.length > 0 ? Math.min(...occupied) : 0),
      maxOccupiedAreaRatio: roundSmokeMetric(occupied.length > 0 ? Math.max(...occupied) : 0),
      minProjectedWidth: roundSmokeMetric(widths.length > 0 ? Math.min(...widths) : 0),
      minProjectedHeight: roundSmokeMetric(heights.length > 0 ? Math.min(...heights) : 0),
      maxDarkMaterialCoverage: roundSmokeMetric(Math.max(0, ...snapshots.map((snapshot) => snapshot.darkMaterialCoverage))),
      maxEmissiveMaterialCoverage: roundSmokeMetric(Math.max(0, ...snapshots.map((snapshot) => snapshot.emissiveMaterialCoverage))),
      panelCount: reports.reduce((total, entry) => total + entry.report.summary.panelCount, 0),
      materialGroupCount: reports.reduce((total, entry) => total + entry.report.summary.materialGroupCount, 0),
      visibleImportantPartCount: reports.reduce((total, entry) => total + entry.report.summary.visibleImportantPartCount, 0),
      importantPartCount: reports.reduce((total, entry) => total + entry.report.summary.importantPartCount, 0),
    },
  };
}

export function buildV3PerformanceSmokeReport(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>
): V3PerformanceSmokeReport {
  const gates = V3_PERFORMANCE_SMOKE_BUDGETS[smoke.qualityTier];
  const weaponCoverage = [...new Set(smoke.combatants.map((entry) => entry.activeWeapon))]
    .sort() as ('hammer' | 'pistol' | 'sword')[];
  const visualQa = buildCombinedV3SmokeVisualQaReport(smoke.combatants);
  const poseClearance = getCachedV3PerformancePoseClearance();
  const exactSourceLodBudget = analyzeV3ExactSourceLodBudget();
  const issues: string[] = [];

  if (smoke.combatants.length !== 8) {
    issues.push(`expected 8 combatants, found ${smoke.combatants.length}`);
  }
  if (!V3_QUALITY_TIERS.includes(smoke.qualityTier)) {
    issues.push(`invalid quality tier ${smoke.qualityTier}`);
  }
  for (const weapon of weapons) {
    if (!weaponCoverage.includes(weapon)) {
      issues.push(`missing ${weapon} combatant`);
    }
  }
  if (smoke.budget.modelCount !== 8) {
    issues.push(`expected 8 V3 models, found ${smoke.budget.modelCount}`);
  }
  if (smoke.budget.drawCallEstimate > gates.maxDrawCallEstimate) {
    issues.push(`draw call estimate ${smoke.budget.drawCallEstimate} exceeds ${gates.maxDrawCallEstimate}`);
  }
  if (smoke.budget.mergedBoxCount > gates.maxMergedBoxCount) {
    issues.push(`merged box count ${smoke.budget.mergedBoxCount} exceeds ${gates.maxMergedBoxCount}`);
  }
  if (smoke.budget.memoryEstimateKb > gates.maxMemoryEstimateKb) {
    issues.push(`memory estimate ${smoke.budget.memoryEstimateKb}KB exceeds ${gates.maxMemoryEstimateKb}KB`);
  }
  for (const issue of visualQa.issues) {
    const viewLabel = issue.viewId && issue.viewportId ? ` ${issue.viewId}/${issue.viewportId}` : '';
    issues.push(`visual QA${viewLabel} ${issue.code}: ${issue.message}`);
  }
  for (const issue of poseClearance.issues) {
    const metricLabel = typeof issue.value === 'number' && typeof issue.threshold === 'number'
      ? ` (${issue.value} vs ${issue.threshold})`
      : '';
    issues.push(`pose clearance ${issue.caseId} ${issue.code}: ${issue.message}${metricLabel}`);
  }
  for (const issue of exactSourceLodBudget.issues) {
    issues.push(`exact source LOD budget: ${issue}`);
  }

  return {
    ready: issues.length === 0,
    qualityTier: smoke.qualityTier,
    combatantCount: smoke.combatants.length,
    weaponCoverage,
    budget: smoke.budget,
    gates,
    visualQaReady: visualQa.ready,
    visualQa,
    poseClearanceReady: poseClearance.ready,
    poseClearance,
    exactSourceLodBudgetReady: exactSourceLodBudget.ready,
    exactSourceLodBudget,
    issues,
  };
}

export function assertV3PerformanceSmokeBudget(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>
): void {
  const report = buildV3PerformanceSmokeReport(smoke);
  if (!report.ready) {
    throw new Error(`V3 performance smoke failed: ${report.issues.join('; ')}`);
  }
}

export function buildV3PerformanceSmokeRuntimeReport(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>,
  sample?: V3PerformanceSmokeRuntimeSample,
  staticReport: V3PerformanceSmokeReport = buildV3PerformanceSmokeReport(smoke)
): V3PerformanceSmokeRuntimeReport {
  const targetFps = V3_PERFORMANCE_RUNTIME_TARGET_FPS[smoke.qualityTier];
  const sampledFrames = Math.max(0, Math.floor(sample?.sampledFrames ?? 0));
  const elapsedMs = Math.max(0, sample?.elapsedMs ?? 0);
  const averageFps = elapsedMs > 0 ? sampledFrames / (elapsedMs / 1000) : 0;
  const averageFrameMs = averageFps > 0 ? 1000 / averageFps : 0;
  const issues = [...staticReport.issues];

  if (!sample || sampledFrames < MIN_RUNTIME_SAMPLE_FRAMES || elapsedMs <= 0) {
    issues.push(`runtime sample pending: need ${MIN_RUNTIME_SAMPLE_FRAMES} frames`);
  } else if (averageFps < targetFps) {
    issues.push(`average FPS ${averageFps.toFixed(1)} below target ${targetFps}`);
  }

  const runtimeReady = Boolean(
    sample &&
    sampledFrames >= MIN_RUNTIME_SAMPLE_FRAMES &&
    elapsedMs > 0 &&
    averageFps >= targetFps
  );

  return {
    ...staticReport,
    ready: staticReport.ready && runtimeReady,
    runtimeReady,
    sampledFrames,
    elapsedMs,
    averageFps,
    averageFrameMs,
    targetFps,
    issues,
  };
}
