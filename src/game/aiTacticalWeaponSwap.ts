import type { UniversalSettings } from '../types';

export interface TacticalWeaponSwapContext {
  carrierInterception: boolean;
  swordForbidden: boolean;
  hammerForbidden: boolean;
}

/** Tactical requests run after combo/feint arbitration. This preserves the live
 * policy; it is not permission for every host to swap during an animation. */
export function canApplyAITacticalWeaponSwap(context: TacticalWeaponSwapContext & {
  activeWeapon: string; requestedWeapon: 'hammer' | 'sword';
  weaponState: string; swapLockoutTimer: number; force?: boolean;
}): boolean {
  if (context.requestedWeapon === context.activeWeapon) return false;
  if (context.carrierInterception && ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(context.weaponState)) return false;
  if (context.requestedWeapon === 'sword' ? context.swordForbidden : context.hammerForbidden) return false;
  return !!context.force || context.swapLockoutTimer <= 0;
}

/** Zero disables starting a new delay; it does not erase an existing one. */
export function resolveAIWeaponSwapTimers(settings: Pick<UniversalSettings, 'weaponSwapLockout' | 'weaponReadyTime'>,
  lockout: number, readiness: number) {
  return { lockout: settings.weaponSwapLockout > 0 ? settings.weaponSwapLockout : lockout,
    readiness: settings.weaponReadyTime > 0 ? settings.weaponReadyTime : readiness };
}
