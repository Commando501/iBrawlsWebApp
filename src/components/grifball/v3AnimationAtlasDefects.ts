import * as THREE from 'three';
import { buildV3WeaponModel } from '../v3/VoxelModelsV3';
import type { V3QualityTier, V3WeaponId } from '../v3/v3ModelTypes';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import type { CharacterLoadout } from '../VoxelModels';
import {
  animateV3CombatantModel,
  animateV3WeaponMeshes,
} from './combatantAnimationV3';
import { createCombatantMeshRig } from './combatantModels';
import { createInitialGrifballThreeRefs } from './threeRefs';
import {
  V3_POSE_CLEARANCE_CASES,
  analyzeV3PoseClearance,
  type V3PoseClearanceCaseId,
} from './v3PoseClearance';
import {
  analyzeV3SlotContinuity,
  type V3SlotContinuityViewId,
} from './v3SlotContinuity';

export type V3AnimationAtlasDefectViewId = 'front' | 'left' | 'rear' | 'right';
export type V3AnimationAtlasDefectMode = 'normalizedReview' | 'runtimeSimulation';

export interface V3AnimationAtlasSlotContinuityIssue {
  frameFraction: number;
  linkId: string;
  label: string;
  viewId: V3AnimationAtlasDefectViewId;
  worldGap: number;
  projectedGap: number;
  jointAnchorError: number;
  warnings: string[];
}

export interface V3AnimationAtlasDefectMetrics {
  visibleWeapon: V3WeaponId | null;
  limbSeparation: number;
  slotBoneDrift: number;
  weaponBodyHeightRatio: number | null;
  weaponGripDrift: number | null;
  footFloorPenetration: number;
  upperLowerCoupling: number;
  nonFiniteTransformCount: number;
  maxSlotContinuityGap: number;
  maxProjectedSlotGap: number;
  maxJointAnchorError: number;
  slotContinuityWarningCount: number;
  slotContinuityIssues: V3AnimationAtlasSlotContinuityIssue[];
}

export interface V3AnimationAtlasViewDefectReport {
  viewId: V3AnimationAtlasDefectViewId;
  metrics: V3AnimationAtlasDefectMetrics;
  warnings: string[];
}

export interface V3AnimationAtlasCaseDefectReport {
  caseId: V3PoseClearanceCaseId;
  mode: V3AnimationAtlasDefectMode;
  ready: boolean;
  sampledFrameFractions: number[];
  views: V3AnimationAtlasViewDefectReport[];
}

export interface V3AnimationAtlasDefectSummary {
  caseCount: number;
  viewCount: number;
  warningCount: number;
  maxLimbSeparation: number;
  maxSlotBoneDrift: number;
  maxWeaponBodyHeightRatio: number;
  maxWeaponGripDrift: number;
  maxFootFloorPenetration: number;
  maxUpperLowerCoupling: number;
  maxSlotContinuityGap: number;
  maxProjectedSlotGap: number;
  maxJointAnchorError: number;
  slotContinuityWarningCount: number;
}

export interface V3AnimationAtlasDefectReport {
  ready: boolean;
  mode: V3AnimationAtlasDefectMode;
  cases: V3AnimationAtlasCaseDefectReport[];
  summary: V3AnimationAtlasDefectSummary;
}

export interface V3AnimationAtlasDefectOptions {
  caseIds?: readonly V3PoseClearanceCaseId[];
  mode?: V3AnimationAtlasDefectMode;
  qualityTier?: V3QualityTier;
  v3Options?: V3RenderOptions;
}

const VIEW_IDS: readonly V3AnimationAtlasDefectViewId[] = ['front', 'left', 'rear', 'right'];
const DEFAULT_SLOT_CONTINUITY_FRAME_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
const WEAPON_CASES = new Set<V3PoseClearanceCaseId>([
  'hammerWindup',
  'hammerStrike',
  'hammerRecover',
  'swordLunge',
  'swordSlash',
  'pistolFire',
]);
const ANALYSIS_LOADOUT: CharacterLoadout = {
  modelSystem: 'v3',
  paintJob: {
    v3RoleColors: {
      primary: '#67d7ff',
      secondary: '#334155',
      accent: '#fbbf24',
      visor: '#67e8f9',
      emissive: '#5eead4',
      undersuit: '#111827',
    },
    v3RoleEmissive: {
      visor: true,
      emissive: true,
    },
  },
};

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const caseDefinition = (caseId: V3PoseClearanceCaseId) => {
  const definition = V3_POSE_CLEARANCE_CASES.find((candidate) => candidate.id === caseId);
  if (!definition) throw new Error(`Unknown V3 atlas defect case: ${caseId}`);
  return definition;
};

const isWeaponVisible = (caseId: V3PoseClearanceCaseId): boolean => (
  WEAPON_CASES.has(caseId)
);

const sampleTimer = (
  caseId: V3PoseClearanceCaseId,
  baseTimer: number,
  frameFraction: number,
  mode: V3AnimationAtlasDefectMode
): number => {
  const t = Math.max(0, Math.min(1, frameFraction));
  if (mode === 'runtimeSimulation') {
    return roundMetric(Math.max(0.01, baseTimer - t / 60));
  }
  if (caseId === 'hammerWindup') return roundMetric(0.34 + (0.02 - 0.34) * t);
  if (caseId === 'hammerStrike') return roundMetric(0.18 + (0.01 - 0.18) * t);
  if (caseId === 'hammerRecover') return roundMetric(0.42 + (0.02 - 0.42) * t);
  if (caseId === 'swordSlash') return roundMetric(0.24 + (0.01 - 0.24) * t);
  if (caseId === 'swordLunge') return roundMetric(0.18 + (0.02 - 0.18) * t);
  if (caseId === 'pistolFire') return roundMetric(0.16 + (0.01 - 0.16) * t);
  return roundMetric(baseTimer);
};

const sampleVelocity = (
  baseVelocity: readonly [number, number, number],
  frameFraction: number,
  mode: V3AnimationAtlasDefectMode
): [number, number, number] => {
  if (mode === 'runtimeSimulation') {
    return [
      roundMetric(baseVelocity[0] * (0.92 + frameFraction * 0.08)),
      baseVelocity[1],
      roundMetric(baseVelocity[2] * (0.92 + frameFraction * 0.08)),
    ];
  }
  return [
    roundMetric(baseVelocity[0] * (0.85 + Math.sin(frameFraction * Math.PI) * 0.15)),
    baseVelocity[1],
    roundMetric(baseVelocity[2] * (0.85 + Math.sin(frameFraction * Math.PI) * 0.15)),
  ];
};

const measureWeaponBodyHeightRatio = (
  weapon: V3WeaponId,
  bodyHeight: number,
  options: V3AnimationAtlasDefectOptions
): number | null => {
  if (!Number.isFinite(bodyHeight) || bodyHeight <= 0) return null;
  const model = buildV3WeaponModel(weapon, {
    customHue: 192,
    v3QualityTier: options.qualityTier,
    ...options.v3Options,
  });
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const longestAxis = Math.max(size.x, size.y, size.z);
  return roundMetric(longestAxis / bodyHeight);
};

const buildWarnings = (
  caseId: V3PoseClearanceCaseId,
  metrics: V3AnimationAtlasDefectMetrics
): string[] => {
  const definition = caseDefinition(caseId);
  const expectUpperLowerIsolation = 'expectUpperLowerIsolation' in definition
    ? definition.expectUpperLowerIsolation === true
    : false;
  const warnings: string[] = [];
  if (metrics.nonFiniteTransformCount > 0) warnings.push('non-finite transform');
  if (metrics.limbSeparation > 0.45) warnings.push('limb separation high');
  if (metrics.slotBoneDrift > 0.7) warnings.push('slot/bone drift high');
  if ((metrics.weaponBodyHeightRatio ?? 0) > 0.72) warnings.push('weapon scale high');
  if ((metrics.weaponGripDrift ?? 0) > 0.65) warnings.push('weapon grip drift high');
  if (metrics.footFloorPenetration > 0.35) warnings.push('foot floor penetration');
  if (expectUpperLowerIsolation && metrics.upperLowerCoupling > 0.4) warnings.push('upper/lower coupling high');
  if (metrics.slotContinuityWarningCount > 0) warnings.push('slot continuity gap high');
  return warnings;
};

const applyDefectSample = (
  scene: THREE.Scene,
  meshRig: ReturnType<typeof createCombatantMeshRig>,
  caseId: V3PoseClearanceCaseId,
  frameFraction: number,
  mode: V3AnimationAtlasDefectMode
): void => {
  const definition = caseDefinition(caseId);
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  if ('previousHp' in definition && typeof definition.previousHp === 'number') {
    meshRig.group.userData.v3LastHp = definition.previousHp;
  }
  const hp = 'hp' in definition ? definition.hp : 100;
  const weaponTimer = sampleTimer(caseId, definition.weaponTimer, frameFraction, mode);

  animateV3CombatantModel({
    refs,
    mesh: meshRig.group,
    vel: new THREE.Vector3(...sampleVelocity(definition.vel, frameFraction, mode)),
    yaw: 0,
    hp,
    activeWeapon: definition.activeWeapon,
    weaponState: definition.weaponState,
    weaponTimer,
    dt: mode === 'runtimeSimulation' ? 1 / 60 : definition.dt,
    isSliding: 'isSliding' in definition ? definition.isSliding : false,
    isSprinting: 'isSprinting' in definition ? definition.isSprinting : false,
    isLunging: 'isLunging' in definition ? definition.isLunging : false,
    animationClockMs: frameFraction * 1000,
    isLocalV3Animation: true,
    settings: { hammerAttackAnimation: 'highFidelity' },
  });

  animateV3WeaponMeshes({
    hammerModel: meshRig.hammer,
    swordModel: meshRig.sword,
    pistolModel: meshRig.pistol,
    activeWeapon: definition.activeWeapon,
    weaponState: definition.weaponState,
    weaponTimer,
    isLunging: 'isLunging' in definition ? Boolean(definition.isLunging) : false,
    dt: mode === 'runtimeSimulation' ? 1 / 60 : definition.dt,
    settings: { hammerAttackAnimation: 'highFidelity' },
  });
  meshRig.hammer.visible = definition.activeWeapon === 'hammer' && isWeaponVisible(caseId);
  meshRig.sword.visible = definition.activeWeapon === 'sword' && isWeaponVisible(caseId);
  if (meshRig.pistol) meshRig.pistol.visible = definition.activeWeapon === 'pistol' && isWeaponVisible(caseId);
  meshRig.group.updateWorldMatrix(true, true);
};

type ContinuityByView = Record<V3AnimationAtlasDefectViewId, {
  maxSlotContinuityGap: number;
  maxProjectedSlotGap: number;
  maxJointAnchorError: number;
  issues: V3AnimationAtlasSlotContinuityIssue[];
}>;

const analyzeSlotContinuitySamples = (
  caseId: V3PoseClearanceCaseId,
  mode: V3AnimationAtlasDefectMode,
  options: V3AnimationAtlasDefectOptions
): { sampledFrameFractions: number[]; byView: ContinuityByView } => {
  const sampledFrameFractions = [...DEFAULT_SLOT_CONTINUITY_FRAME_FRACTIONS];
  const scene = new THREE.Scene();
  const meshRig = createCombatantMeshRig(
    scene,
    192,
    false,
    ANALYSIS_LOADOUT,
    {
      ...options.v3Options,
      v3QualityTier: options.qualityTier ?? options.v3Options?.v3QualityTier,
      v3SourceFidelity: options.v3Options?.v3SourceFidelity ?? 'exact',
    }
  );
  const byView = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    {
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      issues: [],
    },
  ])) as ContinuityByView;

  for (const frameFraction of sampledFrameFractions) {
    applyDefectSample(scene, meshRig, caseId, frameFraction, mode);
    const continuity = analyzeV3SlotContinuity(meshRig.group);
    for (const viewId of VIEW_IDS) {
      const viewMetrics = byView[viewId];
      viewMetrics.maxSlotContinuityGap = Math.max(
        viewMetrics.maxSlotContinuityGap,
        continuity.summary.maxWorldGap
      );
      viewMetrics.maxProjectedSlotGap = Math.max(
        viewMetrics.maxProjectedSlotGap,
        continuity.summary.maxProjectedGap
      );
      viewMetrics.maxJointAnchorError = Math.max(
        viewMetrics.maxJointAnchorError,
        continuity.summary.maxJointAnchorError
      );
      for (const link of continuity.links) {
        if (link.ready) continue;
        const projectedViewId = viewId as V3SlotContinuityViewId;
        viewMetrics.issues.push({
          frameFraction,
          linkId: link.id,
          label: link.label,
          viewId,
          worldGap: link.worldGap,
          projectedGap: link.projectedGap[projectedViewId],
          jointAnchorError: link.jointAnchorError,
          warnings: link.warnings.map((warning) => `${warning.code}: ${warning.message}`),
        });
      }
    }
  }

  for (const viewId of VIEW_IDS) {
    byView[viewId].maxSlotContinuityGap = roundMetric(byView[viewId].maxSlotContinuityGap);
    byView[viewId].maxProjectedSlotGap = roundMetric(byView[viewId].maxProjectedSlotGap);
    byView[viewId].maxJointAnchorError = roundMetric(byView[viewId].maxJointAnchorError);
  }

  return { sampledFrameFractions, byView };
};

export function analyzeV3AnimationAtlasCaseDefects(
  caseId: V3PoseClearanceCaseId,
  options: V3AnimationAtlasDefectOptions = {}
): V3AnimationAtlasCaseDefectReport {
  const mode = options.mode ?? 'normalizedReview';
  const definition = caseDefinition(caseId);
  const poseReport = analyzeV3PoseClearance(caseId, {
    v3Options: {
      ...options.v3Options,
      v3QualityTier: options.qualityTier ?? options.v3Options?.v3QualityTier,
      v3SourceFidelity: options.v3Options?.v3SourceFidelity ?? 'exact',
    },
  });
  const poseCase = poseReport.cases[0];
  const bodyHeight = poseCase.metrics.minProjectedHeight;
  const visibleWeapon = isWeaponVisible(caseId)
    ? definition.activeWeapon
    : null;
  const weaponBodyHeightRatio = visibleWeapon
    ? measureWeaponBodyHeightRatio(visibleWeapon, bodyHeight, options)
    : null;
  const continuity = analyzeSlotContinuitySamples(caseId, mode, options);
  const baseMetrics: V3AnimationAtlasDefectMetrics = {
    visibleWeapon,
    limbSeparation: roundMetric(Math.max(0, 0.12 - poseCase.metrics.limbGap)),
    slotBoneDrift: roundMetric(poseCase.metrics.partOverlapRatio),
    weaponBodyHeightRatio,
    weaponGripDrift: poseCase.metrics.weapon?.gripDrift ?? null,
    footFloorPenetration: poseCase.metrics.footFloorPenetration,
    upperLowerCoupling: poseCase.metrics.upperLowerCoupling,
    nonFiniteTransformCount: poseCase.issues.filter((issue) => issue.code === 'non-finite-transform').length,
    maxSlotContinuityGap: 0,
    maxProjectedSlotGap: 0,
    maxJointAnchorError: 0,
    slotContinuityWarningCount: 0,
    slotContinuityIssues: [],
  };

  const views = VIEW_IDS.map((viewId): V3AnimationAtlasViewDefectReport => {
    const viewContinuity = continuity.byView[viewId];
    const metrics: V3AnimationAtlasDefectMetrics = {
      ...baseMetrics,
      maxSlotContinuityGap: viewContinuity.maxSlotContinuityGap,
      maxProjectedSlotGap: viewContinuity.maxProjectedSlotGap,
      maxJointAnchorError: viewContinuity.maxJointAnchorError,
      slotContinuityWarningCount: viewContinuity.issues.length,
      slotContinuityIssues: viewContinuity.issues,
    };
    return {
      viewId,
      metrics,
      warnings: buildWarnings(caseId, metrics),
    };
  });

  return {
    caseId,
    mode,
    ready: poseCase.ready && views.every((view) => view.warnings.length === 0),
    sampledFrameFractions: continuity.sampledFrameFractions,
    views,
  };
}

const buildSummary = (
  cases: readonly V3AnimationAtlasCaseDefectReport[]
): V3AnimationAtlasDefectSummary => {
  const views = cases.flatMap((testCase) => testCase.views);
  const metrics = views.map((view) => view.metrics);
  return {
    caseCount: cases.length,
    viewCount: VIEW_IDS.length,
    warningCount: views.reduce((total, view) => total + view.warnings.length, 0),
    maxLimbSeparation: roundMetric(Math.max(0, ...metrics.map((entry) => entry.limbSeparation))),
    maxSlotBoneDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.slotBoneDrift))),
    maxWeaponBodyHeightRatio: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponBodyHeightRatio ?? 0))),
    maxWeaponGripDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponGripDrift ?? 0))),
    maxFootFloorPenetration: roundMetric(Math.max(0, ...metrics.map((entry) => entry.footFloorPenetration))),
    maxUpperLowerCoupling: roundMetric(Math.max(0, ...metrics.map((entry) => entry.upperLowerCoupling))),
    maxSlotContinuityGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxSlotContinuityGap))),
    maxProjectedSlotGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxProjectedSlotGap))),
    maxJointAnchorError: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxJointAnchorError))),
    slotContinuityWarningCount: metrics.reduce((total, entry) => total + entry.slotContinuityWarningCount, 0),
  };
};

export function analyzeV3AnimationAtlasDefects(
  options: V3AnimationAtlasDefectOptions = {}
): V3AnimationAtlasDefectReport {
  const caseIds = [...(options.caseIds ?? V3_POSE_CLEARANCE_CASES.map((entry) => entry.id))];
  const cases = caseIds.map((caseId) => analyzeV3AnimationAtlasCaseDefects(caseId, options));
  const summary = buildSummary(cases);
  return {
    ready: cases.every((testCase) => testCase.ready),
    mode: options.mode ?? 'normalizedReview',
    cases,
    summary,
  };
}

export function formatV3AnimationAtlasDefectSummary(
  report: V3AnimationAtlasDefectReport
): string {
  return [
    `V3 animation atlas defects: cases ${report.summary.caseCount}, views ${report.summary.viewCount}`,
    `warnings ${report.summary.warningCount}`,
    `weapon ratio ${report.summary.maxWeaponBodyHeightRatio.toFixed(3)}`,
    `weapon drift ${report.summary.maxWeaponGripDrift.toFixed(3)}`,
    `limb separation ${report.summary.maxLimbSeparation.toFixed(3)}`,
    `slot continuity ${report.summary.maxSlotContinuityGap.toFixed(3)}`,
  ].join(' | ');
}
