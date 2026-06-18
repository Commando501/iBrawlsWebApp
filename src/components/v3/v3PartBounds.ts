import type { V3AssetKind, V3CharacterSlotId, V3WeaponId } from './v3ModelTypes';

export interface V3VoxelDimensions {
  x: number;
  y: number;
  z: number;
}

export interface V3GripSafetyEnvelope {
  radius: number;
  length: number;
}

export interface V3FitBounds {
  id: string;
  kind: V3AssetKind;
  maxDimensions: V3VoxelDimensions;
  centerOffset: [number, number, number];
  gripSafetyEnvelope?: V3GripSafetyEnvelope;
}

export const V3_CHARACTER_PART_BOUNDS: Record<V3CharacterSlotId, V3FitBounds> = {
  helmet: {
    id: 'helmet',
    kind: 'characterPart',
    maxDimensions: { x: 13, y: 9, z: 10 },
    centerOffset: [0, 0.02, 0],
  },
  neck: {
    id: 'neck',
    kind: 'characterPart',
    maxDimensions: { x: 6, y: 4, z: 6 },
    centerOffset: [0, 0, 0],
  },
  chest: {
    id: 'chest',
    kind: 'characterPart',
    maxDimensions: { x: 16, y: 18, z: 13 },
    centerOffset: [0, 0.01, 0],
  },
  shoulderLeft: {
    id: 'shoulderLeft',
    kind: 'characterPart',
    maxDimensions: { x: 8, y: 8, z: 9 },
    centerOffset: [-0.03, 0, 0],
  },
  shoulderRight: {
    id: 'shoulderRight',
    kind: 'characterPart',
    maxDimensions: { x: 8, y: 8, z: 9 },
    centerOffset: [0.03, 0, 0],
  },
  upperArmLeft: {
    id: 'upperArmLeft',
    kind: 'characterPart',
    maxDimensions: { x: 7, y: 13, z: 7 },
    centerOffset: [-0.02, 0, 0],
  },
  upperArmRight: {
    id: 'upperArmRight',
    kind: 'characterPart',
    maxDimensions: { x: 7, y: 13, z: 7 },
    centerOffset: [0.02, 0, 0],
  },
  forearmLeft: {
    id: 'forearmLeft',
    kind: 'characterPart',
    maxDimensions: { x: 7, y: 13, z: 7 },
    centerOffset: [-0.015, 0, 0],
  },
  forearmRight: {
    id: 'forearmRight',
    kind: 'characterPart',
    maxDimensions: { x: 7, y: 13, z: 7 },
    centerOffset: [0.015, 0, 0],
  },
  handLeft: {
    id: 'handLeft',
    kind: 'characterPart',
    maxDimensions: { x: 6, y: 6, z: 6 },
    centerOffset: [-0.01, 0, 0],
  },
  handRight: {
    id: 'handRight',
    kind: 'characterPart',
    maxDimensions: { x: 6, y: 6, z: 6 },
    centerOffset: [0.01, 0, 0],
  },
  pelvis: {
    id: 'pelvis',
    kind: 'characterPart',
    maxDimensions: { x: 13, y: 9, z: 10 },
    centerOffset: [0, 0, 0],
  },
  thighLeft: {
    id: 'thighLeft',
    kind: 'characterPart',
    maxDimensions: { x: 8, y: 15, z: 8 },
    centerOffset: [-0.02, 0, 0],
  },
  thighRight: {
    id: 'thighRight',
    kind: 'characterPart',
    maxDimensions: { x: 8, y: 15, z: 8 },
    centerOffset: [0.02, 0, 0],
  },
  shinLeft: {
    id: 'shinLeft',
    kind: 'characterPart',
    maxDimensions: { x: 8, y: 15, z: 8 },
    centerOffset: [-0.015, 0, 0],
  },
  shinRight: {
    id: 'shinRight',
    kind: 'characterPart',
    maxDimensions: { x: 8, y: 15, z: 8 },
    centerOffset: [0.015, 0, 0],
  },
  footLeft: {
    id: 'footLeft',
    kind: 'characterPart',
    maxDimensions: { x: 9, y: 6, z: 11 },
    centerOffset: [-0.01, -0.01, 0.02],
  },
  footRight: {
    id: 'footRight',
    kind: 'characterPart',
    maxDimensions: { x: 9, y: 6, z: 11 },
    centerOffset: [0.01, -0.01, 0.02],
  },
  back: {
    id: 'back',
    kind: 'characterPart',
    maxDimensions: { x: 14, y: 15, z: 6 },
    centerOffset: [0, 0, -0.03],
  },
};

export const V3_WEAPON_BOUNDS: Record<V3WeaponId, V3FitBounds> = {
  hammer: {
    id: 'hammer',
    kind: 'weapon',
    maxDimensions: { x: 11, y: 40, z: 11 },
    centerOffset: [0, 0, 0],
    gripSafetyEnvelope: { radius: 4, length: 17 },
  },
  sword: {
    id: 'sword',
    kind: 'weapon',
    maxDimensions: { x: 8, y: 36, z: 4 },
    centerOffset: [0, 0, 0],
    gripSafetyEnvelope: { radius: 3, length: 12 },
  },
  pistol: {
    id: 'pistol',
    kind: 'weapon',
    maxDimensions: { x: 10, y: 7, z: 5 },
    centerOffset: [0, 0, 0],
    gripSafetyEnvelope: { radius: 3, length: 7 },
  },
};

const copyBounds = (bounds: V3FitBounds): V3FitBounds => ({
  id: bounds.id,
  kind: bounds.kind,
  maxDimensions: { ...bounds.maxDimensions },
  centerOffset: [...bounds.centerOffset],
  gripSafetyEnvelope: bounds.gripSafetyEnvelope ? { ...bounds.gripSafetyEnvelope } : undefined,
});

export function getV3CharacterPartBounds(slot: V3CharacterSlotId): V3FitBounds {
  return copyBounds(V3_CHARACTER_PART_BOUNDS[slot]);
}

export function getV3WeaponBounds(weapon: V3WeaponId): V3FitBounds {
  return copyBounds(V3_WEAPON_BOUNDS[weapon]);
}

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function validateV3FitBounds(bounds: V3FitBounds): string[] {
  const issues: string[] = [];

  if (!bounds.id) {
    issues.push('id is required');
  }
  if (bounds.kind !== 'characterPart' && bounds.kind !== 'weapon') {
    issues.push('kind must be characterPart or weapon');
  }
  if (!isPositiveFinite(bounds.maxDimensions?.x)) {
    issues.push('maxDimensions.x must be positive');
  }
  if (!isPositiveFinite(bounds.maxDimensions?.y)) {
    issues.push('maxDimensions.y must be positive');
  }
  if (!isPositiveFinite(bounds.maxDimensions?.z)) {
    issues.push('maxDimensions.z must be positive');
  }
  if (!Array.isArray(bounds.centerOffset) || bounds.centerOffset.length !== 3) {
    issues.push('centerOffset must contain three numbers');
  } else if (!bounds.centerOffset.every(isFiniteNumber)) {
    issues.push('centerOffset must contain finite numbers');
  }
  if (bounds.kind === 'weapon' && !bounds.gripSafetyEnvelope) {
    issues.push('weapon gripSafetyEnvelope is required');
  }
  if (bounds.gripSafetyEnvelope) {
    if (!isPositiveFinite(bounds.gripSafetyEnvelope.radius)) {
      issues.push('gripSafetyEnvelope.radius must be positive');
    }
    if (!isPositiveFinite(bounds.gripSafetyEnvelope.length)) {
      issues.push('gripSafetyEnvelope.length must be positive');
    }
  }

  return issues;
}
