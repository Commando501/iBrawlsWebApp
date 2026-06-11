import { resolveCharacterModelType } from '../characterModelTypes';
import { DEFAULT_LOADOUT, type CharacterLoadout } from '../components/VoxelModels';
import {
  normalizeVisualModelPolicy,
  type ModelSystem,
  type VisualModelPolicy,
} from './modelSystem';

export interface CombatantVisualModelSystemInput {
  visualModelPolicy?: VisualModelPolicy | null;
  loadout?: CharacterLoadout | null;
}

export function resolveCombatantVisualModelSystem(
  input: CombatantVisualModelSystemInput
): ModelSystem {
  return normalizeVisualModelPolicy(input.visualModelPolicy);
}

export function resolveLoadoutForVisualPolicy(
  input: CombatantVisualModelSystemInput
): CharacterLoadout {
  const modelSystem = resolveCombatantVisualModelSystem(input);
  const base = input.loadout ?? {};

  if (modelSystem === 'v1') {
    return { modelSystem: 'v1' };
  }

  if (modelSystem === 'v2') {
    const { modelSystem: baseModelSystem, modelType: baseModelType, ...customization } = base;
    return {
      ...customization,
      modelSystem: 'v2',
      modelType: resolveCharacterModelType(baseModelType, baseModelSystem ?? modelSystem),
    };
  }

  return {
    ...DEFAULT_LOADOUT,
    ...base,
    modelSystem: 'v3',
  };
}
