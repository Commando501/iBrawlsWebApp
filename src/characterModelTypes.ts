import type { CharacterModelType } from './types';

export const DEFAULT_CHARACTER_MODEL_TYPE: CharacterModelType = 'medium';
export const CHARACTER_MODEL_TYPES = ['medium', 'large'] as const satisfies readonly CharacterModelType[];

export interface CharacterModelCollisionProfile {
  radius: number;
  standingHeight: number;
  crouchingHeight: number;
}

export interface CharacterModelProfile {
  modelType: CharacterModelType;
  label: string;
  voxelScale: number;
  collision: CharacterModelCollisionProfile;
  thirdPersonWeaponGripOffset: [number, number, number];
  thirdPersonOffhandGripOffset: [number, number, number];
}

export const CHARACTER_MODEL_PROFILES: Record<CharacterModelType, CharacterModelProfile> = {
  medium: {
    modelType: 'medium',
    label: 'Medium',
    voxelScale: 0.045,
    collision: {
      radius: 0.55,
      standingHeight: 1.8,
      crouchingHeight: 1.2,
    },
    thirdPersonWeaponGripOffset: [0, -0.05, 0],
    thirdPersonOffhandGripOffset: [0, -0.05, 0],
  },
  large: {
    modelType: 'large',
    label: 'Large',
    voxelScale: 0.052,
    collision: {
      radius: 0.75,
      standingHeight: 2.2,
      crouchingHeight: 1.45,
    },
    thirdPersonWeaponGripOffset: [0.03, -0.08, -0.02],
    thirdPersonOffhandGripOffset: [-0.03, -0.08, -0.02],
  },
};

export function isCharacterModelType(value: unknown): value is CharacterModelType {
  return value === 'medium' || value === 'large';
}

export function resolveCharacterModelType(value: unknown, modelSystem?: unknown): CharacterModelType {
  if (modelSystem === 'v1') return DEFAULT_CHARACTER_MODEL_TYPE;
  return isCharacterModelType(value) ? value : DEFAULT_CHARACTER_MODEL_TYPE;
}

export function getCharacterModelProfile(value: unknown, modelSystem?: unknown): CharacterModelProfile {
  return CHARACTER_MODEL_PROFILES[resolveCharacterModelType(value, modelSystem)];
}

export function getCharacterModelCollisionProfile(
  value: unknown,
  modelSystem?: unknown
): CharacterModelCollisionProfile {
  return getCharacterModelProfile(value, modelSystem).collision;
}
