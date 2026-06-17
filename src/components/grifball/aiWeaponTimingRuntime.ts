import { type AIBehaviorState, type Combatant, type UniversalSettings } from '../../types';
import { resolvePunchCooldown } from '../../game/runnerBallSettings';

export function resolveAIWeaponReloadTime(
  settings: UniversalSettings,
  weapon: Combatant['activeWeapon'],
  isMelee = false
): number {
  if (weapon === 'ball') return resolvePunchCooldown(settings);
  if (weapon === 'sword') return settings.swordSlashReload ?? 0.6;
  if (isMelee) return settings.hammerMeleeReload ?? 0.5;
  return settings.hammerReloadTime ?? 0.6;
}

export function resolveScaledAIWeaponReloadTime(
  settings: UniversalSettings,
  weapon: Combatant['activeWeapon'],
  cooldownMultiplier: number,
  isMelee = false
): number {
  return resolveAIWeaponReloadTime(settings, weapon, isMelee) * cooldownMultiplier;
}

export function canStartAIWeaponAction({
  aiState,
  timer,
  swapCooldownTimer,
}: {
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  swapCooldownTimer: number | undefined;
}): boolean {
  return (aiState !== 'COOLDOWN' || Number(timer) <= 0) && (swapCooldownTimer ?? 0) <= 0;
}
