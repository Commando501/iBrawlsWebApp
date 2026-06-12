import { resolveCharacterModelType } from '../characterModelTypes';
import { DEFAULT_LOADOUT, type CharacterLoadout } from '../components/VoxelModels';
import { sanitizeV3RolePaintPayload } from '../components/v3/v3PaintPalette';
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

export function sanitizeLoadoutV3RolePaint(
  loadout: CharacterLoadout | null | undefined
): CharacterLoadout | undefined {
  if (!loadout) return undefined;
  const paintJob = loadout.paintJob;
  if (!paintJob || typeof paintJob !== 'object' || Array.isArray(paintJob)) {
    return { ...loadout };
  }

  const rolePaint = sanitizeV3RolePaintPayload(paintJob);
  const sanitizedPaintJob = { ...paintJob };
  if (rolePaint.v3RoleColors) {
    sanitizedPaintJob.v3RoleColors = rolePaint.v3RoleColors;
  } else {
    delete sanitizedPaintJob.v3RoleColors;
  }
  if (rolePaint.v3RoleEmissive) {
    sanitizedPaintJob.v3RoleEmissive = rolePaint.v3RoleEmissive;
  } else {
    delete sanitizedPaintJob.v3RoleEmissive;
  }

  return {
    ...loadout,
    paintJob: sanitizedPaintJob,
  };
}

export function resolveLoadoutForVisualPolicy(
  input: CombatantVisualModelSystemInput
): CharacterLoadout {
  const modelSystem = resolveCombatantVisualModelSystem(input);
  const base = sanitizeLoadoutV3RolePaint(input.loadout) ?? {};

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
