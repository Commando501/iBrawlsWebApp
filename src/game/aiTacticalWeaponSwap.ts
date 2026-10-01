import type { UniversalSettings } from '../types';

export interface TacticalWeaponSwapContext {
  swordForbidden: boolean;
  hammerForbidden: boolean;
}

export function isAIWeaponStrikeCommitted(weaponState: string): boolean {
  return weaponState === 'swing_up' || weaponState === 'swing_down' ||
    weaponState === 'melee_up' || weaponState === 'melee_down';
}

/** Tactical requests run after combo/feint arbitration. A weapon change cannot
 * reinterpret the geometry and timing of an already committed strike. */
export function canApplyAITacticalWeaponSwap(context: TacticalWeaponSwapContext & {
  activeWeapon: string; requestedWeapon: 'hammer' | 'sword';
  weaponState: string; swapLockoutTimer: number; force?: boolean;
}): boolean {
  if (context.requestedWeapon === context.activeWeapon) return false;
  if (isAIWeaponStrikeCommitted(context.weaponState)) return false;
  if (context.requestedWeapon === 'sword' ? context.swordForbidden : context.hammerForbidden) return false;
  return !!context.force || context.swapLockoutTimer <= 0;
}

/** Zero disables starting a new delay; it does not erase an existing one. */
export function resolveAIWeaponSwapTimers(settings: Pick<UniversalSettings, 'weaponSwapLockout' | 'weaponReadyTime'>,
  lockout: number, readiness: number) {
  return { lockout: settings.weaponSwapLockout > 0 ? settings.weaponSwapLockout : lockout,
    readiness: settings.weaponReadyTime > 0 ? settings.weaponReadyTime : readiness };
}
