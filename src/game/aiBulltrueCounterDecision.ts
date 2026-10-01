import type { AICombatWeapon } from './aiCombatDecision';
import type { AIBehaviorState, Combatant, UniversalSettings, WeaponState } from '../types';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTiming';

export interface AIBulltrueCounterFrame {
  activeWeapon: Combatant['activeWeapon'];
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}
export interface AIBulltrueCounterResult {
  started: boolean;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: AIBulltrueCounterFrame['weaponState'];
}

/** Shared counter commitment; readiness and tactical counter selection have
 * already been sampled by the caller. Calibration belongs to the live wrapper. */
export function resolveAIBulltrueCounterDecision({ settings, frame, bulltrueCounter, canStartWeaponAction,
  cooldownMultiplier, triggerCombatantAttack }: { settings: UniversalSettings; frame: AIBulltrueCounterFrame;
  bulltrueCounter: AICombatWeapon | null; canStartWeaponAction: boolean; cooldownMultiplier: number;
  triggerCombatantAttack: (weapon: AICombatWeapon) => void }): AIBulltrueCounterResult {
  const canCounter = !!bulltrueCounter && canStartWeaponAction && frame.activeWeapon === bulltrueCounter && frame.weaponState === 'ready';
  if (!canCounter) return { started: false, aiState: frame.aiState, timer: frame.timer, weaponState: frame.weaponState };
  frame.aiState = 'COOLDOWN';
  frame.timer = resolveScaledAIWeaponReloadTime(settings, bulltrueCounter, cooldownMultiplier);
  triggerCombatantAttack(bulltrueCounter);
  frame.weaponState = 'swing_up';
  return { started: true, aiState: frame.aiState, timer: frame.timer, weaponState: frame.weaponState };
}
