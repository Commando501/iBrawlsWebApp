import type { Combatant, UniversalSettings } from '../types';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTiming';

/** The stationary primary-attack branch shared by engine adapters. Target
 * selection, range prediction and earlier FSM branches remain caller-owned. */
export function resolveAIGroundAttackCommitment(input: {
  enemyInKillRange: boolean;
  selfGrounded: boolean;
  canStartWeaponAction: boolean;
  weaponReady: boolean;
  slideActive: boolean;
  activeWeapon: Combatant['activeWeapon'];
  settings: UniversalSettings;
  cooldownMultiplier: number;
}) {
  if (!input.enemyInKillRange || !input.selfGrounded || !input.canStartWeaponAction ||
    !input.weaponReady || input.slideActive) return null;
  return {
    weapon: input.activeWeapon,
    aiState: 'COOLDOWN' as const,
    timer: resolveScaledAIWeaponReloadTime(input.settings, input.activeWeapon, input.cooldownMultiplier),
    weaponState: 'swing_up' as const,
    movement: { x: 0, z: 0 },
  };
}
