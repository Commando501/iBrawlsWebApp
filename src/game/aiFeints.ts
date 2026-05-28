import { getFeintPressureMultiplier } from './aiPlayerModel';
import type { PlayerModelSnapshot } from './aiPlayerModel';

export const FEINT_COOLDOWN_MIN = 3;
export const FEINT_COOLDOWN_MAX = 5;
export const WEAPON_SWAP_FEINT_DELAY = 0.45;
export const APPROACH_FEINT_BACK_TIMER = 0.55;
export const LUNGE_FAKEOUT_FORWARD_TIMER = 0.38;
export const CHARGE_ABORT_SIDESTEP_TIMER = 0.35;

export type FeintKind = 'approach_abort' | 'weapon_swap' | 'charge_abort' | 'lunge_fakeout';

export interface FeintRollInput {
  feintChance: number;
  feintCooldownRemaining: number;
  playerModelMultiplier?: number;
  rollScale?: number;
  rng?: number;
}

export function isFeintEligible(input: Pick<FeintRollInput, 'feintChance' | 'feintCooldownRemaining'>): boolean {
  return input.feintChance > 0 && input.feintCooldownRemaining <= 0;
}

export function getEffectiveFeintChance(input: FeintRollInput): number {
  const multiplier = input.playerModelMultiplier ?? 1;
  const scale = input.rollScale ?? 1;
  return Math.max(0, Math.min(1, (input.feintChance / 100) * multiplier * scale));
}

export function rollFeintAttempt(input: FeintRollInput): boolean {
  if (!isFeintEligible(input)) {
    return false;
  }
  const rng = input.rng ?? Math.random();
  return rng < getEffectiveFeintChance(input);
}

export function rollFeintCooldownDuration(rng = Math.random()): number {
  return FEINT_COOLDOWN_MIN + rng * (FEINT_COOLDOWN_MAX - FEINT_COOLDOWN_MIN);
}

export function getPlayerFeintMultiplier(model: PlayerModelSnapshot | null | undefined): number {
  return getFeintPressureMultiplier(model);
}

export interface ApproachFeintInput {
  timerRemaining: number;
  targetProtected: boolean;
  feintEligible: boolean;
}

/** Returns roll scale when an approach feint window is open, else null. */
export function getApproachFeintWindow(input: ApproachFeintInput): number | null {
  if (!input.feintEligible || input.targetProtected) {
    return null;
  }
  if (input.timerRemaining > 0.35) {
    return 0.42;
  }
  if (input.timerRemaining > 0.12) {
    return 0.62;
  }
  return null;
}

export interface WeaponSwapFeintInput {
  activeWeapon: 'hammer' | 'sword';
  weaponReady: boolean;
  swapLockoutRemaining: number;
  distanceToTarget: number;
  minLungeRange: number;
  maxLungeRange: number;
  swapFeintActive: boolean;
  state: string;
  feintEligible: boolean;
}

export function canAttemptWeaponSwapFeint(input: WeaponSwapFeintInput): boolean {
  if (!input.feintEligible || input.swapFeintActive) {
    return false;
  }
  if (input.activeWeapon !== 'hammer' || !input.weaponReady) {
    return false;
  }
  if (input.swapLockoutRemaining > 0) {
    return false;
  }
  if (input.state === 'COOLDOWN' || input.state === 'PRESSURING' || input.state === 'LUNGING') {
    return false;
  }
  return (
    input.distanceToTarget >= input.minLungeRange * 0.9 &&
    input.distanceToTarget <= input.maxLungeRange + 1.5
  );
}

export interface ChargeAbortFeintInput {
  targetWeaponState: string | undefined;
  dashCooldownRemaining: number;
  targetProtected: boolean;
  feintEligible: boolean;
}

export function canAttemptChargeAbortFeint(input: ChargeAbortFeintInput): boolean {
  if (!input.feintEligible || input.targetProtected) {
    return false;
  }
  if (input.dashCooldownRemaining > 0) {
    return false;
  }
  return input.targetWeaponState === 'swing_up' || input.targetWeaponState === 'swing_down';
}

export interface LungeFakeoutInput {
  activeWeapon: 'hammer' | 'sword';
  weaponReady: boolean;
  inLungeRange: boolean;
  targetProtected: boolean;
  feintEligible: boolean;
}

export function canAttemptLungeFakeout(input: LungeFakeoutInput): boolean {
  if (!input.feintEligible || input.targetProtected) {
    return false;
  }
  return input.activeWeapon === 'sword' && input.weaponReady && input.inLungeRange;
}
