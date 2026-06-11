export const V3_CHARACTER_SLOT_IDS = [
  'helmet',
  'neck',
  'chest',
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'handLeft',
  'handRight',
  'pelvis',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
  'footLeft',
  'footRight',
  'back',
] as const;

export const V3_WEAPON_IDS = ['hammer', 'sword', 'pistol'] as const;

export const V3_PAINT_ROLES = [
  'primary',
  'secondary',
  'accent',
  'undersuit',
  'visor',
  'emissive',
  'decal',
  'fixed',
] as const;

export const V3_QUALITY_TIERS = ['mobileLow', 'mobile', 'desktop', 'ultra'] as const;

export const V3_SOCKET_NAMES = [
  'thirdPersonPrimaryGrip',
  'thirdPersonOffhandGrip',
  'firstPersonPrimaryGrip',
  'firstPersonOffhandGrip',
  'backMount',
  'holster',
] as const;

export type V3CharacterSlotId = (typeof V3_CHARACTER_SLOT_IDS)[number];
export type V3WeaponId = (typeof V3_WEAPON_IDS)[number];
export type V3PaintRole = (typeof V3_PAINT_ROLES)[number];
export type V3QualityTier = (typeof V3_QUALITY_TIERS)[number];
export type V3SocketName = (typeof V3_SOCKET_NAMES)[number];
export type V3AssetKind = 'characterPart' | 'weapon';

export type V3Vec3Tuple = readonly [number, number, number];

export interface V3AssetBudget {
  sourceVoxelCount: number;
  mergedBoxCount: number;
  materialGroupCount: number;
  drawCallEstimate: number;
  lodCount: number;
  memoryEstimateKb: number;
}

export interface V3LodLevel {
  id: string;
  sourceId: string;
  qualityTier: V3QualityTier;
  maxDistance: number;
  budget: V3AssetBudget;
}

export interface V3SocketDefinition {
  name: V3SocketName;
  bone: string;
  position: V3Vec3Tuple;
  rotation: V3Vec3Tuple;
}

export interface V3AssetMetadata {
  id: string;
  label: string;
  kind: V3AssetKind;
  paintRoles: readonly V3PaintRole[];
  budget: V3AssetBudget;
  lods: readonly V3LodLevel[];
  sockets?: readonly V3SocketDefinition[];
}

const positiveBudgetFields = [
  'sourceVoxelCount',
  'mergedBoxCount',
  'materialGroupCount',
  'drawCallEstimate',
  'lodCount',
  'memoryEstimateKb',
] as const satisfies readonly (keyof V3AssetBudget)[];

export function validateV3AssetBudget(budget: V3AssetBudget): string[] {
  const issues: string[] = [];

  for (const field of positiveBudgetFields) {
    const value = budget[field];
    if (!Number.isFinite(value) || value <= 0) {
      issues.push(`${field} must be a positive finite number`);
    }
  }

  return issues;
}
