import {
  CHARACTER_MODEL_PROFILES,
  getCharacterModelCollisionProfile,
} from '../../characterModelTypes';
import { type CharacterModelType } from '../../types';

const MEDIUM_TARGET_RADIUS = CHARACTER_MODEL_PROFILES.medium.collision.radius;

export const getModelTargetRadiusBonus = (modelType?: CharacterModelType): number => {
  const profile = getCharacterModelCollisionProfile(modelType, 'v2');
  return Math.max(0, profile.radius - MEDIUM_TARGET_RADIUS);
};

export const adjustRangeForTargetModel = (
  baseRange: number,
  modelType?: CharacterModelType
): number => baseRange + getModelTargetRadiusBonus(modelType);
