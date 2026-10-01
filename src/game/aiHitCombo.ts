import { canUseWeaponCombos, createBotComboState, pickComboOnHit, type BotComboState } from './aiComboEngine';
import type { AIResolvedKnobs } from './aiTuning';
import type { UniversalSettings } from '../types';

export type HitComboKnobs = Pick<AIResolvedKnobs, 'difficulty' | 'weaponSwapIQ' | 'weaponPrioritization'>;
export type HitComboSettings = Pick<UniversalSettings, 'attackRange' | 'attackRadius' | 'swordLungeDistance'>;
type Point = { x: number; y: number; z: number };

/** A landed, surviving hit may begin a combo; it never replaces one in progress.
 * Geometry and target recovery are observed at impact by each host. */
export function resolveAIHitCombo(input: {
  current: BotComboState | null; targetId: string; openingWeapon: 'hammer' | 'sword';
  botPos?: Point; target: { hp: number; pos: Point; weaponState?: string } | null;
  knobs: HitComboKnobs; settings: HitComboSettings; targetRecovering?: boolean; random?: () => number;
}): BotComboState | null {
  const { current, target, botPos, knobs, settings } = input;
  if (current) return current;
  if (!canUseWeaponCombos(knobs.difficulty, knobs.weaponSwapIQ) || !target || target.hp <= 0 || !botPos) return null;
  const combo = pickComboOnHit({ ...knobs, openingWeapon: input.openingWeapon,
    distanceToTarget: Math.sqrt((botPos.x - target.pos.x) ** 2 + (botPos.y - target.pos.y) ** 2 + (botPos.z - target.pos.z) ** 2),
    minLungeRange: (settings.attackRange + settings.attackRadius * .85) * .85,
    maxLungeRange: Math.min(18, settings.swordLungeDistance ?? 14.5),
    targetRecovering: input.targetRecovering ?? target.weaponState === 'recovering', random: input.random });
  return combo ? createBotComboState(combo, input.targetId) : null;
}
