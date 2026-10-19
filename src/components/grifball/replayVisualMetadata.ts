import { normalizeSelectableVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
import type { ReplayFile } from '../../types';
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';
import type { CharacterLoadout } from '../VoxelModels';

export const DEFAULT_REPLAY_VISUAL_MODEL_POLICY: VisualModelPolicy = 'v1';

export function resolveReplayVisualModelPolicy(replay: ReplayFile | null | undefined, allowModelVariants = false): VisualModelPolicy {
  return normalizeSelectableVisualModelPolicy(replay?.visualModelPolicy, allowModelVariants, DEFAULT_REPLAY_VISUAL_MODEL_POLICY);
}

export function sanitizeReplayVisualLoadout(value: unknown): CharacterLoadout | undefined {
  return sanitizeCharacterLoadoutForNetwork(value) as CharacterLoadout | undefined;
}

export function resolveReplayCombatantVisualLoadout(
  replay: ReplayFile | null | undefined,
  combatantId: string,
  allowModelVariants = false
): CharacterLoadout {
  const stored = replay?.visualLoadouts?.[combatantId];
  return resolveLoadoutForVisualPolicy({
    visualModelPolicy: resolveReplayVisualModelPolicy(replay, allowModelVariants),
    loadout: sanitizeReplayVisualLoadout(stored),
  });
}
