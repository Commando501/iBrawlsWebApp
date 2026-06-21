import * as THREE from 'three';
import type { V3WeaponId } from './v3ModelTypes';

export interface V3WeaponScaleProfile {
  readonly weapon: V3WeaponId;
  readonly modelSystem: 'v3';
  readonly targetBodyHeightRatio: number;
  readonly maxHandSpanRatio: number;
  readonly minUniformScale: number;
  readonly maxUniformScale: number;
}

export type V3WeaponScaleIssueCode =
  | 'height-ratio-high'
  | 'height-ratio-low'
  | 'hand-span-ratio-high';

export interface V3WeaponScaleIssue {
  code: V3WeaponScaleIssueCode;
  value: number;
  threshold: number;
  message: string;
}

export interface V3WeaponScaleFitContext {
  weapon?: V3WeaponId;
  handSpan?: number;
}

export interface V3WeaponScaleApplyContext extends V3WeaponScaleFitContext {
  bodyBounds?: THREE.Box3;
}

export interface V3WeaponScaleFitReport {
  weapon: V3WeaponId;
  bodyHeight: number;
  handSpan: number;
  weaponDimensions: { x: number; y: number; z: number };
  currentBodyHeightRatio: number;
  currentHandSpanRatio: number;
  targetBodyHeightRatio: number;
  maxHandSpanRatio: number;
  recommendedUniformScale: number;
  ready: boolean;
  issues: V3WeaponScaleIssue[];
}

export interface V3WeaponScaleApplyReport extends V3WeaponScaleFitReport {
  appliedUniformScale: number;
}

const RATIO_EPSILON = 0.000001;
const DEFAULT_WEAPON: V3WeaponId = 'hammer';

const V3_WEAPON_SCALE_PROFILES: Record<V3WeaponId, V3WeaponScaleProfile> = {
  hammer: Object.freeze({
    weapon: 'hammer',
    modelSystem: 'v3',
    // Gravity hammer stands three-quarters of the character's height.
    targetBodyHeightRatio: 0.75,
    maxHandSpanRatio: 2,
    minUniformScale: 0.35,
    maxUniformScale: 1.25,
  }),
  sword: Object.freeze({
    weapon: 'sword',
    modelSystem: 'v3',
    // Energy katar reaches half the character's height along its thrust axis.
    targetBodyHeightRatio: 0.5,
    maxHandSpanRatio: 1.8,
    minUniformScale: 0.35,
    maxUniformScale: 1.25,
  }),
  pistol: Object.freeze({
    weapon: 'pistol',
    modelSystem: 'v3',
    targetBodyHeightRatio: 0.16,
    maxHandSpanRatio: 4,
    minUniformScale: 0.5,
    maxUniformScale: 1.75,
  }),
};

const roundScale = (value: number): number => Number(value.toFixed(6));

const finitePositiveOrFallback = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const boxFromModelOrBounds = (modelOrBounds: THREE.Object3D | THREE.Box3): THREE.Box3 => {
  if (modelOrBounds instanceof THREE.Box3) {
    return modelOrBounds.clone();
  }
  modelOrBounds.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(modelOrBounds);
};

const dimensionsFromBounds = (bounds: THREE.Box3): THREE.Vector3 =>
  bounds.getSize(new THREE.Vector3());

const getBodyHeight = (bodyBounds: THREE.Box3): number =>
  finitePositiveOrFallback(dimensionsFromBounds(bodyBounds).y, 1.8);

const getDefaultHandSpan = (bodyHeight: number): number =>
  roundScale(bodyHeight * 0.1);

const clampScale = (scale: number, profile: V3WeaponScaleProfile): number =>
  roundScale(Math.min(profile.maxUniformScale, Math.max(profile.minUniformScale, scale)));

const createIssue = (
  code: V3WeaponScaleIssueCode,
  value: number,
  threshold: number
): V3WeaponScaleIssue => ({
  code,
  value,
  threshold,
  message: `${code} ${value.toFixed(6)} outside ${threshold.toFixed(6)}`,
});

export function getV3WeaponScaleProfile(weapon: V3WeaponId): V3WeaponScaleProfile {
  return V3_WEAPON_SCALE_PROFILES[weapon];
}

export function analyzeV3WeaponScaleFit(
  modelOrBounds: THREE.Object3D | THREE.Box3,
  bodyBounds: THREE.Box3,
  context: V3WeaponScaleFitContext = {}
): V3WeaponScaleFitReport {
  const weapon = context.weapon ?? DEFAULT_WEAPON;
  const profile = getV3WeaponScaleProfile(weapon);
  const weaponBounds = boxFromModelOrBounds(modelOrBounds);
  const weaponSize = dimensionsFromBounds(weaponBounds);
  const bodyHeight = roundScale(getBodyHeight(bodyBounds));
  const handSpan = roundScale(finitePositiveOrFallback(context.handSpan, getDefaultHandSpan(bodyHeight)));
  const weaponHeight = finitePositiveOrFallback(weaponSize.y, RATIO_EPSILON);
  const weaponHandWidth = finitePositiveOrFallback(
    Math.max(weaponSize.x, weaponSize.z),
    RATIO_EPSILON
  );
  const currentBodyHeightRatio = roundScale(weaponHeight / bodyHeight);
  const currentHandSpanRatio = roundScale(weaponHandWidth / handSpan);
  const bodyHeightScale = (profile.targetBodyHeightRatio * bodyHeight) / weaponHeight;
  const handSpanScale = (profile.maxHandSpanRatio * handSpan) / weaponHandWidth;
  const recommendedUniformScale = clampScale(Math.min(bodyHeightScale, handSpanScale), profile);
  const issues: V3WeaponScaleIssue[] = [];

  if (currentBodyHeightRatio > profile.targetBodyHeightRatio + RATIO_EPSILON) {
    issues.push(createIssue('height-ratio-high', currentBodyHeightRatio, profile.targetBodyHeightRatio));
  }
  if (currentBodyHeightRatio < profile.targetBodyHeightRatio - RATIO_EPSILON) {
    issues.push(createIssue('height-ratio-low', currentBodyHeightRatio, profile.targetBodyHeightRatio));
  }
  if (currentHandSpanRatio > profile.maxHandSpanRatio + RATIO_EPSILON) {
    issues.push(createIssue('hand-span-ratio-high', currentHandSpanRatio, profile.maxHandSpanRatio));
  }

  return {
    weapon,
    bodyHeight,
    handSpan,
    weaponDimensions: {
      x: roundScale(weaponSize.x),
      y: roundScale(weaponSize.y),
      z: roundScale(weaponSize.z),
    },
    currentBodyHeightRatio,
    currentHandSpanRatio,
    targetBodyHeightRatio: profile.targetBodyHeightRatio,
    maxHandSpanRatio: profile.maxHandSpanRatio,
    recommendedUniformScale,
    ready: issues.length === 0,
    issues,
  };
}

export function applyV3WeaponScaleProfile(
  model: THREE.Object3D,
  weapon: V3WeaponId,
  context: V3WeaponScaleApplyContext = {}
): V3WeaponScaleApplyReport {
  const bodyBounds = context.bodyBounds ?? new THREE.Box3(
    new THREE.Vector3(-0.45, 0, -0.21),
    new THREE.Vector3(0.45, 1.8, 0.21)
  );
  const report = analyzeV3WeaponScaleFit(model, bodyBounds, { ...context, weapon });
  const appliedUniformScale = Math.abs(report.recommendedUniformScale - 1) <= RATIO_EPSILON
    ? 1
    : report.recommendedUniformScale;

  if (appliedUniformScale !== 1) {
    model.scale.multiplyScalar(appliedUniformScale);
    model.updateWorldMatrix(true, true);
  }

  const applyReport: V3WeaponScaleApplyReport = {
    ...report,
    appliedUniformScale,
  };
  const priorScale = finitePositiveOrFallback(model.userData.v3WeaponScaleProfile?.appliedUniformScale, 1);
  model.userData.v3WeaponScaleProfile = {
    weapon,
    modelSystem: 'v3',
    appliedUniformScale: roundScale(priorScale * appliedUniformScale),
    targetBodyHeightRatio: report.targetBodyHeightRatio,
    maxHandSpanRatio: report.maxHandSpanRatio,
  };

  return applyReport;
}
