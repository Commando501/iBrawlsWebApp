import * as THREE from 'three';
import { buildV3WeaponModel } from '../v3/VoxelModelsV3';
import type { V3QualityTier, V3WeaponId } from '../v3/v3ModelTypes';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import type { CharacterLoadout } from '../VoxelModels';
import type { UniversalSettings } from '../../types';
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
import { getV3AnimationClipMetadataForCase } from './v3AnimationClipMetadata';
import type { V3RetargetedClipId, V3RetargetedClipSource } from './v3RetargetedAnimationClips';
import {
  analyzeV3SlotContinuity,
  type V3SlotContinuityViewId,
} from './v3SlotContinuity';
import { analyzeV3LowerBodyContinuity } from './v3LowerBodyContinuity';
import { analyzeV3UpperBodyContinuity } from './v3UpperBodyContinuity';
import {
  analyzeV3RetargetedMotionRetention,
  type V3RetargetedMotionRetentionReport,
} from './v3RetargetedAnimationClips';
import {
  analyzeV3RetargetJointAlignment,
  type V3RetargetJointAlignmentReport,
} from './v3MixamoRetarget';
import type { V3WeaponReferenceClipId } from './v3WeaponReferenceClips';

export type V3AnimationAtlasDefectViewId = 'front' | 'left' | 'rear' | 'right';
export type V3AnimationAtlasDefectMode = 'normalizedReview' | 'runtimeSimulation';

const V3_ANIMATION_ATLAS_DEFECT_WEAPON_SETTINGS: Partial<UniversalSettings> = {
  hammerAttackAnimation: 'highFidelity',
  hammerSlamWindupTime: 0.45,
  hammerSlamAttackTime: 0.3,
  hammerReloadTime: 0.6,
  hammerMeleeSpeed: 0.24,
  swordSlashSpeed: 0.22,
};

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

export interface V3AnimationAtlasLowerBodySeamIssue {
  frameFraction: number;
  linkId: string;
  label: string;
  viewId: V3AnimationAtlasDefectViewId;
  maxSeamGap: number;
  projectedSeamGap: number;
  warnings: string[];
}

export interface V3AnimationAtlasDefectMetrics {
  visibleWeapon: V3WeaponId | null;
  limbSeparation: number;
  slotBoneDrift: number;
  weaponBodyHeightRatio: number | null;
  weaponGripDrift: number | null;
  weaponBasisForwardAlignment: number | null;
  weaponBasisUpAlignment: number | null;
  weaponPrimaryGripDrift: number | null;
  weaponOffhandGripDrift: number | null;
  weaponDesiredPrimaryGripDrift: number | null;
  weaponDesiredOffhandGripDrift: number | null;
  weaponIkMaxGripDrift: number | null;
  weaponIkShoulderSeamDistance: number | null;
  weaponIkReachClampCount: number;
  weaponSwingArcDistance: number | null;
  weaponRetargetMinElbowPlaneAlignment: number | null;
  weaponRetargetMinPalmForwardAlignment: number | null;
  weaponRetargetMinForearmTwistAlignment: number | null;
  weaponRetargetMaxJointDrift: number | null;
  weaponRetargetIkCleanupRequired: boolean;
  weaponTwoHandReadiness: number | null;
  weaponOneHandReadiness: number | null;
  footFloorPenetration: number;
  upperLowerCoupling: number;
  nonFiniteTransformCount: number;
  maxSlotContinuityGap: number;
  maxProjectedSlotGap: number;
  maxJointAnchorError: number;
  slotContinuityWarningCount: number;
  slotContinuityIssues: V3AnimationAtlasSlotContinuityIssue[];
  maxLowerBodySeamGap: number;
  maxLowerBodyProjectedSeamGap: number;
  lowerBodyTearWarningCount: number;
  maxUpperBodySeamGap: number;
  maxUpperBodyProjectedSeamGap: number;
  upperBodySeamWarningCount: number;
  rawMaxLowerBodySeamGap: number;
  rawMaxLowerBodyProjectedSeamGap: number;
  visibleMaxLowerBodySeamGap: number;
  visibleMaxLowerBodyProjectedSeamGap: number;
  visibleLowerBodyTearWarningCount: number;
  bridgeCoveredLinkCount: number;
  lowerBodySeamIssues: V3AnimationAtlasLowerBodySeamIssue[];
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
  clipSource?: V3RetargetedClipSource;
  clipId?: V3RetargetedClipId;
  sourceHash?: string;
  clipReady?: boolean;
  motionRetention?: V3RetargetedMotionRetentionReport;
  motionSourceLabel?: string;
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
  minWeaponBasisForwardAlignment: number;
  minWeaponBasisUpAlignment: number;
  maxWeaponPrimaryGripDrift: number;
  maxWeaponOffhandGripDrift: number;
  maxWeaponDesiredPrimaryGripDrift: number;
  maxWeaponDesiredOffhandGripDrift: number;
  maxWeaponIkGripDrift: number;
  maxWeaponIkShoulderSeamDistance: number;
  weaponIkReachClampCount: number;
  maxWeaponSwingArcDistance: number;
  minWeaponRetargetElbowPlaneAlignment: number;
  minWeaponRetargetPalmForwardAlignment: number;
  minWeaponRetargetForearmTwistAlignment: number;
  maxWeaponRetargetJointDrift: number;
  weaponRetargetIkCleanupRequiredCount: number;
  maxFootFloorPenetration: number;
  maxUpperLowerCoupling: number;
  maxSlotContinuityGap: number;
  maxProjectedSlotGap: number;
  maxJointAnchorError: number;
  slotContinuityWarningCount: number;
  maxLowerBodySeamGap: number;
  maxLowerBodyProjectedSeamGap: number;
  lowerBodyTearWarningCount: number;
  maxUpperBodySeamGap: number;
  maxUpperBodyProjectedSeamGap: number;
  upperBodySeamWarningCount: number;
  maxVisibleLowerBodySeamGap: number;
  maxVisibleLowerBodyProjectedSeamGap: number;
  visibleLowerBodyTearWarningCount: number;
  bridgeCoveredLinkCount: number;
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
const ATLAS_WARNING_THRESHOLDS = {
  maxLimbSeparation: 0.135,
  maxSlotBoneDrift: 0.9,
  maxWeaponGripDrift: 0.12,
  minWeaponBasisForwardAlignment: 0.82,
  minWeaponBasisUpAlignment: 0.82,
  maxWeaponPrimaryGripDrift: 0.18,
  maxWeaponOffhandGripDrift: 0.52,
  maxWeaponDesiredPrimaryGripDrift: 0.08,
  maxWeaponDesiredOffhandGripDrift: 0.2,
  maxWeaponIkGripDrift: 0.08,
  maxWeaponIkShoulderSeamDistance: 0.045,
  minWeaponRetargetElbowPlaneAlignment: 0.005,
  minWeaponRetargetPalmForwardAlignment: 0.3,
  minWeaponRetargetForearmTwistAlignment: 0.3,
  maxWeaponRetargetJointDrift: 0.08,
  minWeaponSwingArcDistance: {
    hammerWindup: 0.12,
    hammerStrike: 0.12,
    hammerRecover: 0.08,
    hammerMelee: 0.12,
    hammerMeleeRecover: 0.08,
    swordLunge: 0.08,
    swordSlash: 0.12,
    pistolFire: 0.025,
  } satisfies Partial<Record<V3PoseClearanceCaseId, number>>,
  maxFootFloorPenetration: 0.025,
  maxUpperLowerCoupling: 0.4,
  maxLowerBodySeamGap: 0.08,
  maxLowerBodyProjectedSeamGap: 0.08,
  maxUpperBodySeamGap: 0.06,
  maxUpperBodyProjectedSeamGap: 0.06,
  maxWeaponBodyHeightRatio: {
    hammer: 0.75,
    sword: 0.66,
    pistol: 0.24,
  } satisfies Record<V3WeaponId, number>,
} as const;
const RETARGETED_LOCOMOTION_LOWER_BODY_SEAM_LIMIT = 0.14;
const ATLAS_WARNING_EPSILON = 0.00001;
const WEAPON_CASES = new Set<V3PoseClearanceCaseId>([
  'hammerWindup',
  'hammerStrike',
  'hammerRecover',
  'hammerMelee',
  'hammerMeleeRecover',
  'swordLunge',
  'swordSlash',
  'pistolFire',
]);
const HAMMER_TWO_HAND_READY_CASES = new Set<V3PoseClearanceCaseId>([
  'idle',
  'walk',
  'sprint',
  'slide',
]);
const WEAPON_REFERENCE_BY_CASE: Partial<Record<V3PoseClearanceCaseId, V3WeaponReferenceClipId>> = {
  hammerWindup: 'hammer_heavy_swing',
  hammerStrike: 'hammer_heavy_swing',
  hammerRecover: 'hammer_heavy_swing',
  hammerMelee: 'hammer_melee_advance',
  hammerMeleeRecover: 'hammer_melee_advance',
  swordSlash: 'sword_outward_slash',
};
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
  if (caseId === 'hammerWindup') return roundMetric(0.02 + (0.45 - 0.02) * t);
  if (caseId === 'hammerStrike') return roundMetric(0.01 + (0.3 - 0.01) * t);
  if (caseId === 'hammerRecover') return roundMetric(0.02 + (0.6 - 0.02) * t);
  if (caseId === 'hammerMelee') return roundMetric(0.01 + (0.24 - 0.01) * t);
  if (caseId === 'hammerMeleeRecover') return roundMetric(0.01 + (0.5 - 0.01) * t);
  if (caseId === 'swordSlash') return roundMetric(0.01 + (0.22 - 0.01) * t);
  if (caseId === 'swordLunge') return roundMetric(0.02 + (0.18 - 0.02) * t);
  if (caseId === 'pistolFire') return roundMetric(0.01 + (0.16 - 0.01) * t);
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

export const buildV3AnimationAtlasDefectWarnings = (
  caseId: V3PoseClearanceCaseId,
  metrics: V3AnimationAtlasDefectMetrics
): string[] => {
  const definition = caseDefinition(caseId);
  const expectUpperLowerIsolation = 'expectUpperLowerIsolation' in definition
    ? definition.expectUpperLowerIsolation === true
    : false;
  const warnings: string[] = [];
  if (metrics.nonFiniteTransformCount > 0) warnings.push('non-finite transform');
  if (metrics.limbSeparation > ATLAS_WARNING_THRESHOLDS.maxLimbSeparation) warnings.push('limb separation high');
  if (metrics.slotBoneDrift > ATLAS_WARNING_THRESHOLDS.maxSlotBoneDrift) warnings.push('slot/bone drift high');
  const weaponScaleLimit = metrics.visibleWeapon
    ? ATLAS_WARNING_THRESHOLDS.maxWeaponBodyHeightRatio[metrics.visibleWeapon]
    : Number.POSITIVE_INFINITY;
  if ((metrics.weaponBodyHeightRatio ?? 0) > weaponScaleLimit + ATLAS_WARNING_EPSILON) warnings.push('weapon scale high');
  if ((metrics.weaponGripDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponGripDrift) warnings.push('weapon grip drift high');
  if (
    metrics.visibleWeapon
    && (metrics.weaponBasisForwardAlignment ?? 1) < ATLAS_WARNING_THRESHOLDS.minWeaponBasisForwardAlignment
  ) {
    warnings.push('weapon socket basis forward low');
  }
  if (
    metrics.visibleWeapon
    && (metrics.weaponBasisUpAlignment ?? 1) < ATLAS_WARNING_THRESHOLDS.minWeaponBasisUpAlignment
  ) {
    warnings.push('weapon socket basis up low');
  }
  if ((metrics.weaponPrimaryGripDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponPrimaryGripDrift) {
    warnings.push('weapon primary grip drift high');
  }
  if ((metrics.weaponDesiredPrimaryGripDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponDesiredPrimaryGripDrift) {
    warnings.push('weapon desired primary grip drift high');
  }
  if (
    HAMMER_TWO_HAND_READY_CASES.has(caseId)
    && metrics.visibleWeapon === 'hammer'
    && (metrics.weaponOffhandGripDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponOffhandGripDrift
  ) {
    warnings.push('weapon offhand grip drift high');
  }
  if (
    metrics.visibleWeapon === 'hammer'
    && (metrics.weaponDesiredOffhandGripDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponDesiredOffhandGripDrift
  ) {
    warnings.push('weapon desired offhand grip drift high');
  }
  if (
    metrics.weaponIkReachClampCount > 0 &&
    (metrics.weaponIkMaxGripDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponIkGripDrift
  ) {
    warnings.push('weapon IK reach clamped');
  }
  if ((metrics.weaponIkShoulderSeamDistance ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponIkShoulderSeamDistance) {
    warnings.push('weapon shoulder seam high');
  }
  if (
    metrics.visibleWeapon &&
    metrics.weaponRetargetMinElbowPlaneAlignment !== null &&
    metrics.weaponRetargetMinElbowPlaneAlignment < ATLAS_WARNING_THRESHOLDS.minWeaponRetargetElbowPlaneAlignment
  ) {
    warnings.push('weapon retarget elbow plane mismatch');
  }
  if (
    metrics.visibleWeapon &&
    metrics.weaponRetargetMinPalmForwardAlignment !== null &&
    metrics.weaponRetargetMinPalmForwardAlignment < ATLAS_WARNING_THRESHOLDS.minWeaponRetargetPalmForwardAlignment
  ) {
    warnings.push('weapon retarget palm forward mismatch');
  }
  if (
    metrics.visibleWeapon &&
    metrics.weaponRetargetMinForearmTwistAlignment !== null &&
    metrics.weaponRetargetMinForearmTwistAlignment < ATLAS_WARNING_THRESHOLDS.minWeaponRetargetForearmTwistAlignment
  ) {
    warnings.push('weapon retarget forearm twist mismatch');
  }
  if (
    metrics.visibleWeapon &&
    (metrics.weaponRetargetMaxJointDrift ?? 0) > ATLAS_WARNING_THRESHOLDS.maxWeaponRetargetJointDrift
  ) {
    warnings.push('weapon retarget joint drift high');
  }
  if (metrics.weaponRetargetIkCleanupRequired) {
    warnings.push('weapon retarget excessive IK cleanup');
  }
  const minSwingArc = ATLAS_WARNING_THRESHOLDS.minWeaponSwingArcDistance[caseId];
  if (
    metrics.visibleWeapon &&
    typeof minSwingArc === 'number' &&
    (metrics.weaponSwingArcDistance ?? 0) < minSwingArc
  ) {
    warnings.push('weapon swing arc too small');
  }
  if (metrics.footFloorPenetration > ATLAS_WARNING_THRESHOLDS.maxFootFloorPenetration) warnings.push('foot floor penetration');
  if (
    expectUpperLowerIsolation
    && metrics.upperLowerCoupling > ATLAS_WARNING_THRESHOLDS.maxUpperLowerCoupling
  ) {
    warnings.push('upper/lower coupling high');
  }
  if (metrics.slotContinuityWarningCount > 0) warnings.push('slot continuity gap high');
  if (metrics.visibleLowerBodyTearWarningCount > 0) warnings.push('lower-body seam tear');
  if (metrics.upperBodySeamWarningCount > 0) warnings.push('upper-body seam gap');
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
    v3PoseAlphaOverride: 1,
    settings: V3_ANIMATION_ATLAS_DEFECT_WEAPON_SETTINGS,
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
    settings: V3_ANIMATION_ATLAS_DEFECT_WEAPON_SETTINGS,
    combatantModel: meshRig.group,
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
  maxLowerBodySeamGap: number;
  maxLowerBodyProjectedSeamGap: number;
  lowerBodyIssues: V3AnimationAtlasLowerBodySeamIssue[];
  rawMaxLowerBodySeamGap: number;
  rawMaxLowerBodyProjectedSeamGap: number;
  visibleMaxLowerBodySeamGap: number;
  visibleMaxLowerBodyProjectedSeamGap: number;
  visibleLowerBodyTearWarningCount: number;
  bridgeCoveredLinkCount: number;
  maxUpperBodySeamGap: number;
  maxUpperBodyProjectedSeamGap: number;
  upperBodySeamWarningCount: number;
  weaponDesiredPrimaryGripDrift: number | null;
  weaponDesiredOffhandGripDrift: number | null;
  weaponIkMaxGripDrift: number | null;
  weaponIkShoulderSeamDistance: number | null;
  weaponIkReachClampCount: number;
  weaponSwingArcDistance: number | null;
  weaponArcPoints: THREE.Vector3[];
  weaponRetargetMinElbowPlaneAlignment: number | null;
  weaponRetargetMinPalmForwardAlignment: number | null;
  weaponRetargetMinForearmTwistAlignment: number | null;
  weaponRetargetMaxJointDrift: number | null;
  weaponRetargetIkCleanupRequired: boolean;
}>;

type V3GripConstraintReportLike = {
  maxGripDrift?: number;
  maxShoulderSeamDistance?: number;
  reachClampCount?: number;
  results?: Array<{
    socketName?: string;
    drift?: number;
  }>;
};

const getRigWeaponModel = (
  meshRig: ReturnType<typeof createCombatantMeshRig>,
  weapon: V3WeaponId | null
): THREE.Group | null | undefined => {
  if (weapon === 'hammer') return meshRig.hammer;
  if (weapon === 'sword') return meshRig.sword;
  if (weapon === 'pistol') return meshRig.pistol;
  return null;
};

const maxNullable = (current: number | null, value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return current;
  return current === null ? roundMetric(value) : roundMetric(Math.max(current, value));
};

const minNullable = (current: number | null, value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return current;
  return current === null ? roundMetric(value) : roundMetric(Math.min(current, value));
};

const pathLength = (points: readonly THREE.Vector3[]): number | null => {
  if (points.length < 2) return null;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += points[index - 1].distanceTo(points[index]);
  }
  return roundMetric(total);
};

const analyzeSlotContinuitySamples = (
  caseId: V3PoseClearanceCaseId,
  mode: V3AnimationAtlasDefectMode,
  options: V3AnimationAtlasDefectOptions
): { sampledFrameFractions: number[]; byView: ContinuityByView } => {
  const sampledFrameFractions = [...DEFAULT_SLOT_CONTINUITY_FRAME_FRACTIONS];
  const scene = new THREE.Scene();
  const clipMetadata = getV3AnimationClipMetadataForCase(caseId);
  const lowerBodySeamLimit = clipMetadata?.clipSource === 'retargetedMixamo'
    ? RETARGETED_LOCOMOTION_LOWER_BODY_SEAM_LIMIT
    : ATLAS_WARNING_THRESHOLDS.maxLowerBodySeamGap;
  const lowerBodyProjectedSeamLimit = clipMetadata?.clipSource === 'retargetedMixamo'
    ? RETARGETED_LOCOMOTION_LOWER_BODY_SEAM_LIMIT
    : ATLAS_WARNING_THRESHOLDS.maxLowerBodyProjectedSeamGap;
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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const easeInOutCubic = (value: number): number => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const sampleWeaponReferenceTime = (
  caseId: V3PoseClearanceCaseId,
  normalizedTime: number
): number => {
  const t = clamp01(normalizedTime);
  if (caseId === 'hammerWindup') return roundMetric(0.02 + (0.25 - 0.02) * easeInOutCubic(t));
  if (caseId === 'hammerStrike') return roundMetric(0.25 + (0.5 - 0.25) * easeInOutCubic(t));
  if (caseId === 'hammerRecover') return 0.5;
  if (caseId === 'hammerMelee') return roundMetric(0.02 + (0.56 - 0.02) * easeInOutCubic(t));
  if (caseId === 'hammerMeleeRecover') return 0.56;
  if (caseId === 'swordSlash') return roundMetric(0.5 + (0.64 - 0.5) * easeInOutCubic(t));
  return t;
};

const retargetReportForCaseFrame = (
  caseId: V3PoseClearanceCaseId,
  frameFraction: number
): V3RetargetJointAlignmentReport | null => {
  const clipId = WEAPON_REFERENCE_BY_CASE[caseId];
  if (!clipId) return null;
  return analyzeV3RetargetJointAlignment(
    clipId,
    sampleWeaponReferenceTime(caseId, frameFraction)
  );
};
  const byView = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    {
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      issues: [],
      maxLowerBodySeamGap: 0,
      maxLowerBodyProjectedSeamGap: 0,
      lowerBodyIssues: [],
      rawMaxLowerBodySeamGap: 0,
      rawMaxLowerBodyProjectedSeamGap: 0,
      visibleMaxLowerBodySeamGap: 0,
      visibleMaxLowerBodyProjectedSeamGap: 0,
      visibleLowerBodyTearWarningCount: 0,
      bridgeCoveredLinkCount: 0,
      maxUpperBodySeamGap: 0,
      maxUpperBodyProjectedSeamGap: 0,
      upperBodySeamWarningCount: 0,
      weaponDesiredPrimaryGripDrift: null,
      weaponDesiredOffhandGripDrift: null,
      weaponIkMaxGripDrift: null,
      weaponIkShoulderSeamDistance: null,
      weaponIkReachClampCount: 0,
      weaponSwingArcDistance: null,
      weaponArcPoints: [],
      weaponRetargetMinElbowPlaneAlignment: null,
      weaponRetargetMinPalmForwardAlignment: null,
      weaponRetargetMinForearmTwistAlignment: null,
      weaponRetargetMaxJointDrift: null,
      weaponRetargetIkCleanupRequired: false,
    },
  ])) as ContinuityByView;
  const activeWeapon = isWeaponVisible(caseId)
    ? caseDefinition(caseId).activeWeapon
    : null;

  for (const frameFraction of sampledFrameFractions) {
    applyDefectSample(scene, meshRig, caseId, frameFraction, mode);
    const weaponModel = getRigWeaponModel(meshRig, activeWeapon);
    const retargetReport = retargetReportForCaseFrame(caseId, frameFraction);
    const minElbowPlaneAlignment = retargetReport
      ? Math.min(retargetReport.left.elbowPlaneAlignment, retargetReport.right.elbowPlaneAlignment)
      : null;
    const minPalmForwardAlignment = retargetReport
      ? Math.min(retargetReport.left.palmForwardAlignment, retargetReport.right.palmForwardAlignment)
      : null;
    const minForearmTwistAlignment = retargetReport
      ? Math.min(retargetReport.left.forearmTwistAlignment, retargetReport.right.forearmTwistAlignment)
      : null;
    const gripReport = activeWeapon && weaponModel?.visible
      ? meshRig.group.userData.v3WeaponGripConstraintReport as V3GripConstraintReportLike | undefined
      : undefined;
    const primaryGripDrift = gripReport?.results
      ?.find((result) => result.socketName === 'thirdPersonPrimaryGrip')
      ?.drift;
    const offhandGripDrift = gripReport?.results
      ?.find((result) => result.socketName === 'thirdPersonOffhandGrip')
      ?.drift;
    const weaponPoint = activeWeapon && weaponModel?.visible
      ? weaponModel.getWorldPosition(new THREE.Vector3())
      : null;
    const continuity = analyzeV3SlotContinuity(meshRig.group, { includeAttachments: false });
    const lowerBodyContinuity = analyzeV3LowerBodyContinuity(meshRig.group, {
      maxSeamGap: lowerBodySeamLimit,
      maxProjectedSeamGap: lowerBodyProjectedSeamLimit,
      bridgeCoverage: 'runtime-bridges',
    });
    const upperBodyContinuity = analyzeV3UpperBodyContinuity(meshRig.group);
    for (const viewId of VIEW_IDS) {
      const viewMetrics = byView[viewId];
      viewMetrics.weaponDesiredPrimaryGripDrift = maxNullable(
        viewMetrics.weaponDesiredPrimaryGripDrift,
        primaryGripDrift
      );
      viewMetrics.weaponDesiredOffhandGripDrift = maxNullable(
        viewMetrics.weaponDesiredOffhandGripDrift,
        offhandGripDrift
      );
      viewMetrics.weaponIkMaxGripDrift = maxNullable(
        viewMetrics.weaponIkMaxGripDrift,
        gripReport?.maxGripDrift
      );
      viewMetrics.weaponIkShoulderSeamDistance = maxNullable(
        viewMetrics.weaponIkShoulderSeamDistance,
        gripReport?.maxShoulderSeamDistance
      );
      viewMetrics.weaponIkReachClampCount += Math.max(0, Math.floor(gripReport?.reachClampCount ?? 0));
      if (weaponPoint) {
        viewMetrics.weaponArcPoints.push(weaponPoint.clone());
      }
      viewMetrics.weaponRetargetMinElbowPlaneAlignment = minNullable(
        viewMetrics.weaponRetargetMinElbowPlaneAlignment,
        minElbowPlaneAlignment
      );
      viewMetrics.weaponRetargetMinPalmForwardAlignment = minNullable(
        viewMetrics.weaponRetargetMinPalmForwardAlignment,
        minPalmForwardAlignment
      );
      viewMetrics.weaponRetargetMinForearmTwistAlignment = minNullable(
        viewMetrics.weaponRetargetMinForearmTwistAlignment,
        minForearmTwistAlignment
      );
      viewMetrics.weaponRetargetMaxJointDrift = maxNullable(
        viewMetrics.weaponRetargetMaxJointDrift,
        retargetReport?.maxJointDrift
      );
      viewMetrics.weaponRetargetIkCleanupRequired ||= retargetReport?.ikCleanupRequired ?? false;
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
      viewMetrics.maxLowerBodySeamGap = Math.max(
        viewMetrics.maxLowerBodySeamGap,
        lowerBodyContinuity.summary.maxLowerBodySeamGap
      );
      viewMetrics.rawMaxLowerBodySeamGap = viewMetrics.maxLowerBodySeamGap;
      viewMetrics.maxLowerBodyProjectedSeamGap = Math.max(
        viewMetrics.maxLowerBodyProjectedSeamGap,
        lowerBodyContinuity.summary.maxLowerBodyProjectedSeamGap
      );
      viewMetrics.rawMaxLowerBodyProjectedSeamGap = viewMetrics.maxLowerBodyProjectedSeamGap;
      viewMetrics.visibleMaxLowerBodySeamGap = Math.max(
        viewMetrics.visibleMaxLowerBodySeamGap,
        lowerBodyContinuity.summary.maxVisibleLowerBodySeamGap
      );
      viewMetrics.visibleMaxLowerBodyProjectedSeamGap = Math.max(
        viewMetrics.visibleMaxLowerBodyProjectedSeamGap,
        lowerBodyContinuity.summary.maxVisibleLowerBodyProjectedSeamGap
      );
      viewMetrics.visibleLowerBodyTearWarningCount += lowerBodyContinuity.summary.visibleLowerBodyTearWarningCount;
      viewMetrics.bridgeCoveredLinkCount = Math.max(
        viewMetrics.bridgeCoveredLinkCount,
        lowerBodyContinuity.summary.bridgeCoveredLinkCount
      );
      viewMetrics.maxUpperBodySeamGap = Math.max(
        viewMetrics.maxUpperBodySeamGap,
        upperBodyContinuity.maxVisibleGap
      );
      viewMetrics.maxUpperBodyProjectedSeamGap = Math.max(
        viewMetrics.maxUpperBodyProjectedSeamGap,
        Math.max(0, ...upperBodyContinuity.links.map((link) => link.projectedGap[viewId]))
      );
      viewMetrics.upperBodySeamWarningCount += upperBodyContinuity.links.filter((link) => (
        !link.ready ||
        link.visibleGap > ATLAS_WARNING_THRESHOLDS.maxUpperBodySeamGap ||
        link.projectedGap[viewId] > ATLAS_WARNING_THRESHOLDS.maxUpperBodyProjectedSeamGap
      )).length;
      for (const link of lowerBodyContinuity.links) {
        const projectedViewId = viewId as V3SlotContinuityViewId;
        const viewProjectedGap = link.projectedGap[projectedViewId];
        const hasViewIssue = (
          link.maxSeamGap > lowerBodySeamLimit ||
          viewProjectedGap > lowerBodyProjectedSeamLimit
        );
        if (!hasViewIssue) continue;
        viewMetrics.lowerBodyIssues.push({
          frameFraction,
          linkId: link.id,
          label: link.label,
          viewId,
          maxSeamGap: link.maxSeamGap,
          projectedSeamGap: viewProjectedGap,
          warnings: link.warnings.map((warning) => `${warning.code}: ${warning.message}`),
        });
      }
    }
  }

  for (const viewId of VIEW_IDS) {
    byView[viewId].maxSlotContinuityGap = roundMetric(byView[viewId].maxSlotContinuityGap);
    byView[viewId].maxProjectedSlotGap = roundMetric(byView[viewId].maxProjectedSlotGap);
    byView[viewId].maxJointAnchorError = roundMetric(byView[viewId].maxJointAnchorError);
    byView[viewId].maxLowerBodySeamGap = roundMetric(byView[viewId].maxLowerBodySeamGap);
    byView[viewId].maxLowerBodyProjectedSeamGap = roundMetric(byView[viewId].maxLowerBodyProjectedSeamGap);
    byView[viewId].rawMaxLowerBodySeamGap = roundMetric(byView[viewId].rawMaxLowerBodySeamGap);
    byView[viewId].rawMaxLowerBodyProjectedSeamGap = roundMetric(byView[viewId].rawMaxLowerBodyProjectedSeamGap);
    byView[viewId].visibleMaxLowerBodySeamGap = roundMetric(byView[viewId].visibleMaxLowerBodySeamGap);
    byView[viewId].visibleMaxLowerBodyProjectedSeamGap = roundMetric(byView[viewId].visibleMaxLowerBodyProjectedSeamGap);
    byView[viewId].maxUpperBodySeamGap = roundMetric(byView[viewId].maxUpperBodySeamGap);
    byView[viewId].maxUpperBodyProjectedSeamGap = roundMetric(byView[viewId].maxUpperBodyProjectedSeamGap);
    byView[viewId].weaponSwingArcDistance = pathLength(byView[viewId].weaponArcPoints);
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
    thresholds: {
      maxPartOverlapRatio: ATLAS_WARNING_THRESHOLDS.maxSlotBoneDrift,
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
  const clipMetadata = getV3AnimationClipMetadataForCase(caseId);
  const motionRetention = clipMetadata?.clipId
    ? analyzeV3RetargetedMotionRetention(clipMetadata.clipId)
    : undefined;
  const continuity = analyzeSlotContinuitySamples(caseId, mode, options);
  const baseMetrics: V3AnimationAtlasDefectMetrics = {
    visibleWeapon,
    limbSeparation: roundMetric(Math.max(0, 0.12 - poseCase.metrics.limbGap)),
    slotBoneDrift: roundMetric(poseCase.metrics.partOverlapRatio),
    weaponBodyHeightRatio,
    weaponGripDrift: poseCase.metrics.weapon?.gripDrift ?? null,
    weaponBasisForwardAlignment: poseCase.metrics.weapon?.basisForwardAlignment ?? null,
    weaponBasisUpAlignment: poseCase.metrics.weapon?.basisUpAlignment ?? null,
    weaponPrimaryGripDrift: poseCase.metrics.weapon?.primaryGripDrift ?? null,
    weaponOffhandGripDrift: poseCase.metrics.weapon?.offhandGripDrift ?? null,
    weaponDesiredPrimaryGripDrift: null,
    weaponDesiredOffhandGripDrift: null,
    weaponIkMaxGripDrift: null,
    weaponIkShoulderSeamDistance: null,
    weaponIkReachClampCount: 0,
    weaponSwingArcDistance: null,
    weaponRetargetMinElbowPlaneAlignment: null,
    weaponRetargetMinPalmForwardAlignment: null,
    weaponRetargetMinForearmTwistAlignment: null,
    weaponRetargetMaxJointDrift: null,
    weaponRetargetIkCleanupRequired: false,
    weaponTwoHandReadiness: poseCase.metrics.weapon?.twoHandReadiness ?? null,
    weaponOneHandReadiness: poseCase.metrics.weapon?.oneHandReadiness ?? null,
    footFloorPenetration: poseCase.metrics.footFloorPenetration,
    upperLowerCoupling: poseCase.metrics.upperLowerCoupling,
    nonFiniteTransformCount: poseCase.issues.filter((issue) => issue.code === 'non-finite-transform').length,
    maxSlotContinuityGap: 0,
    maxProjectedSlotGap: 0,
    maxJointAnchorError: 0,
    slotContinuityWarningCount: 0,
    slotContinuityIssues: [],
    maxLowerBodySeamGap: 0,
    maxLowerBodyProjectedSeamGap: 0,
    lowerBodyTearWarningCount: 0,
    maxUpperBodySeamGap: 0,
    maxUpperBodyProjectedSeamGap: 0,
    upperBodySeamWarningCount: 0,
    rawMaxLowerBodySeamGap: 0,
    rawMaxLowerBodyProjectedSeamGap: 0,
    visibleMaxLowerBodySeamGap: 0,
    visibleMaxLowerBodyProjectedSeamGap: 0,
    visibleLowerBodyTearWarningCount: 0,
    bridgeCoveredLinkCount: 0,
    lowerBodySeamIssues: [],
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
      maxLowerBodySeamGap: viewContinuity.maxLowerBodySeamGap,
      maxLowerBodyProjectedSeamGap: viewContinuity.maxLowerBodyProjectedSeamGap,
      lowerBodyTearWarningCount: viewContinuity.lowerBodyIssues.length,
      weaponDesiredPrimaryGripDrift: viewContinuity.weaponDesiredPrimaryGripDrift,
      weaponDesiredOffhandGripDrift: viewContinuity.weaponDesiredOffhandGripDrift,
      weaponIkMaxGripDrift: viewContinuity.weaponIkMaxGripDrift,
      weaponIkShoulderSeamDistance: viewContinuity.weaponIkShoulderSeamDistance,
      weaponIkReachClampCount: viewContinuity.weaponIkReachClampCount,
      weaponSwingArcDistance: viewContinuity.weaponSwingArcDistance,
      weaponRetargetMinElbowPlaneAlignment: viewContinuity.weaponRetargetMinElbowPlaneAlignment,
      weaponRetargetMinPalmForwardAlignment: viewContinuity.weaponRetargetMinPalmForwardAlignment,
      weaponRetargetMinForearmTwistAlignment: viewContinuity.weaponRetargetMinForearmTwistAlignment,
      weaponRetargetMaxJointDrift: viewContinuity.weaponRetargetMaxJointDrift,
      weaponRetargetIkCleanupRequired: viewContinuity.weaponRetargetIkCleanupRequired,
      rawMaxLowerBodySeamGap: viewContinuity.rawMaxLowerBodySeamGap,
      rawMaxLowerBodyProjectedSeamGap: viewContinuity.rawMaxLowerBodyProjectedSeamGap,
      visibleMaxLowerBodySeamGap: viewContinuity.visibleMaxLowerBodySeamGap,
      visibleMaxLowerBodyProjectedSeamGap: viewContinuity.visibleMaxLowerBodyProjectedSeamGap,
      visibleLowerBodyTearWarningCount: viewContinuity.visibleLowerBodyTearWarningCount,
      bridgeCoveredLinkCount: viewContinuity.bridgeCoveredLinkCount,
      maxUpperBodySeamGap: viewContinuity.maxUpperBodySeamGap,
      maxUpperBodyProjectedSeamGap: viewContinuity.maxUpperBodyProjectedSeamGap,
      upperBodySeamWarningCount: viewContinuity.upperBodySeamWarningCount,
      lowerBodySeamIssues: viewContinuity.lowerBodyIssues,
    };
    return {
      viewId,
      metrics,
      warnings: buildV3AnimationAtlasDefectWarnings(caseId, metrics),
    };
  });

  return {
    caseId,
    mode,
    ready: poseCase.ready && (motionRetention?.ready ?? true) && views.every((view) => view.warnings.length === 0),
    ...(clipMetadata ? {
      clipSource: clipMetadata.clipSource,
      clipId: clipMetadata.clipId,
      sourceHash: clipMetadata.sourceHash,
      clipReady: clipMetadata.ready,
      ...(motionRetention ? { motionRetention } : {}),
      motionSourceLabel: clipMetadata.label,
    } : {}),
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
    minWeaponBasisForwardAlignment: roundMetric(Math.min(1, ...metrics
      .map((entry) => entry.weaponBasisForwardAlignment)
      .filter((value): value is number => typeof value === 'number'))),
    minWeaponBasisUpAlignment: roundMetric(Math.min(1, ...metrics
      .map((entry) => entry.weaponBasisUpAlignment)
      .filter((value): value is number => typeof value === 'number'))),
    maxWeaponPrimaryGripDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponPrimaryGripDrift ?? 0))),
    maxWeaponOffhandGripDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponOffhandGripDrift ?? 0))),
    maxWeaponDesiredPrimaryGripDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponDesiredPrimaryGripDrift ?? 0))),
    maxWeaponDesiredOffhandGripDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponDesiredOffhandGripDrift ?? 0))),
    maxWeaponIkGripDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponIkMaxGripDrift ?? 0))),
    maxWeaponIkShoulderSeamDistance: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponIkShoulderSeamDistance ?? 0))),
    weaponIkReachClampCount: metrics.reduce((total, entry) => total + entry.weaponIkReachClampCount, 0),
    maxWeaponSwingArcDistance: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponSwingArcDistance ?? 0))),
    minWeaponRetargetElbowPlaneAlignment: roundMetric(Math.min(1, ...metrics
      .map((entry) => entry.weaponRetargetMinElbowPlaneAlignment)
      .filter((value): value is number => typeof value === 'number'))),
    minWeaponRetargetPalmForwardAlignment: roundMetric(Math.min(1, ...metrics
      .map((entry) => entry.weaponRetargetMinPalmForwardAlignment)
      .filter((value): value is number => typeof value === 'number'))),
    minWeaponRetargetForearmTwistAlignment: roundMetric(Math.min(1, ...metrics
      .map((entry) => entry.weaponRetargetMinForearmTwistAlignment)
      .filter((value): value is number => typeof value === 'number'))),
    maxWeaponRetargetJointDrift: roundMetric(Math.max(0, ...metrics.map((entry) => entry.weaponRetargetMaxJointDrift ?? 0))),
    weaponRetargetIkCleanupRequiredCount: metrics.reduce((total, entry) => total + (entry.weaponRetargetIkCleanupRequired ? 1 : 0), 0),
    maxFootFloorPenetration: roundMetric(Math.max(0, ...metrics.map((entry) => entry.footFloorPenetration))),
    maxUpperLowerCoupling: roundMetric(Math.max(0, ...metrics.map((entry) => entry.upperLowerCoupling))),
    maxSlotContinuityGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxSlotContinuityGap))),
    maxProjectedSlotGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxProjectedSlotGap))),
    maxJointAnchorError: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxJointAnchorError))),
    slotContinuityWarningCount: metrics.reduce((total, entry) => total + entry.slotContinuityWarningCount, 0),
    maxLowerBodySeamGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxLowerBodySeamGap))),
    maxLowerBodyProjectedSeamGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxLowerBodyProjectedSeamGap))),
    lowerBodyTearWarningCount: metrics.reduce((total, entry) => total + entry.lowerBodyTearWarningCount, 0),
    maxUpperBodySeamGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxUpperBodySeamGap))),
    maxUpperBodyProjectedSeamGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.maxUpperBodyProjectedSeamGap))),
    upperBodySeamWarningCount: metrics.reduce((total, entry) => total + entry.upperBodySeamWarningCount, 0),
    maxVisibleLowerBodySeamGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.visibleMaxLowerBodySeamGap))),
    maxVisibleLowerBodyProjectedSeamGap: roundMetric(Math.max(0, ...metrics.map((entry) => entry.visibleMaxLowerBodyProjectedSeamGap))),
    visibleLowerBodyTearWarningCount: metrics.reduce((total, entry) => total + entry.visibleLowerBodyTearWarningCount, 0),
    bridgeCoveredLinkCount: metrics.reduce((total, entry) => total + entry.bridgeCoveredLinkCount, 0),
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
    `upper-body seams ${report.summary.maxUpperBodySeamGap.toFixed(3)}`,
    `lower-body seams ${report.summary.maxLowerBodySeamGap.toFixed(3)}`,
    `retarget palm ${report.summary.minWeaponRetargetPalmForwardAlignment.toFixed(3)}`,
  ].join(' | ');
}
