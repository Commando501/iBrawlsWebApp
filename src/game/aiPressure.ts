/** Minimum pressure aggression (0–100) before post-hit pressure chains activate. */
export const PRESSURE_AGGRESSION_THRESHOLD = 25;

export interface PressureEnterInput {
  pressureAggression: number;
  targetHp: number;
  targetInvuln: number;
}

export interface PressureExitInput {
  targetHp: number;
  targetInvuln: number;
  distanceToTarget: number;
  maxPressureRange: number;
  timerRemaining: number;
  targetMatchesLock: boolean;
}

export interface PressureAttackInput {
  activeWeapon: 'hammer' | 'sword';
  distanceToTarget: number;
  aiReach: number;
  minLungeRange: number;
  maxLungeRange: number;
  weaponReady: boolean;
  targetProtected: boolean;
}

export function shouldEnterPressure(input: PressureEnterInput): boolean {
  if (input.pressureAggression < PRESSURE_AGGRESSION_THRESHOLD) {
    return false;
  }
  if (input.targetHp <= 0) {
    return false;
  }
  if (input.targetInvuln > 0) {
    return false;
  }
  return true;
}

export function getPressureDuration(pressureAggression: number): number {
  const t = pressureAggression / 100;
  return 1.4 + t * 1.8;
}

/** Forward speed multiplier vs CHARGE_ATTACK baseline (6.5). */
export function getPressureApproachSpeed(pressureAggression: number): number {
  const t = pressureAggression / 100;
  return 7.2 + t * 1.6;
}

export function getPressureAttackCooldown(
  pressureAggression: number,
  baseCooldown: number
): number {
  const t = pressureAggression / 100;
  return baseCooldown * (0.55 + (1 - t) * 0.25);
}

export function getPressureMaxRange(aiReach: number, maxLungeRange: number): number {
  return Math.max(aiReach + 6, maxLungeRange + 2);
}

export function shouldExitPressure(input: PressureExitInput): boolean {
  if (!input.targetMatchesLock) {
    return true;
  }
  if (input.targetHp <= 0) {
    return true;
  }
  if (input.targetInvuln > 0) {
    return true;
  }
  if (input.timerRemaining <= 0) {
    return true;
  }
  if (input.distanceToTarget > input.maxPressureRange) {
    return true;
  }
  return false;
}

/** Prefer sword lunge when in range during pressure; otherwise hammer re-swing. */
export function shouldPressurePreferLunge(input: PressureAttackInput): boolean {
  if (!input.weaponReady || input.targetProtected) {
    return false;
  }
  if (input.activeWeapon !== 'sword') {
    return false;
  }
  return (
    input.distanceToTarget >= input.minLungeRange &&
    input.distanceToTarget <= input.maxLungeRange
  );
}

export function shouldPressureReSwing(input: PressureAttackInput): boolean {
  if (!input.weaponReady || input.targetProtected) {
    return false;
  }
  return input.distanceToTarget <= input.aiReach + 0.5;
}
