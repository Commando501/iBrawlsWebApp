import { applyPlayerModelCombatAdjustments, type PlayerModelSnapshot } from './aiPlayerModel';
import {
  getEffectiveWeaponSwapIQ,
  NEUTRAL_MATCH_MULTIPLIERS,
  type MatchStateMultipliers,
} from './aiTuning';

export type AICombatWeapon = 'hammer' | 'sword';

export type AILungeOutcome = 'hit' | 'miss_timeout' | 'miss_arena' | 'target_dead';

export interface AILungeMemory {
  outcome: AILungeOutcome;
  targetId?: string;
  timeRemaining: number;
}

export interface AITacticalTarget {
  id: string;
  hp: number;
  activeWeapon: AICombatWeapon;
  weaponState: string;
  isLunging: boolean;
  invulnerabilityTimer?: number;
  /** Seconds until dash is available again (0 = ready). */
  dashCooldownRemaining?: number;
  /** Seconds until weapon swap is allowed again (0 = ready). */
  swapLockoutRemaining?: number;
}

/** Extended target snapshot used by target selection and the FSM orchestrator. */
export interface AITacticalTargetSnapshot extends AITacticalTarget {
  maxHp: number;
  isCrouching: boolean;
  playerName: string;
}

export interface AICombatDecisionInput {
  difficulty: string;
  weaponSwapIQ: number;
  currentWeapon: AICombatWeapon;
  botHP: number;
  botMaxHP: number;
  distanceToTarget: number;
  combatDistanceToTarget?: number;
  nearbyEnemiesCount: number;
  target: AITacticalTarget;
  attackRange: number;
  attackRadius: number;
  swordLungeDistance: number;
  swordLungeSpeed: number;
  swordTradeWindowMs: number;
  canStartWeaponAction: boolean;
  canUseHammerCounter?: boolean;
  weaponState: string;
  recentLungeMemory?: AILungeMemory | null;
  weaponPrioritization: number;
  /** Learned opponent habits from adaptive player modeling (PR-B). */
  playerModel?: PlayerModelSnapshot | null;
  /** Score-aware trade and IQ modulation (PR-D). */
  matchMultipliers?: MatchStateMultipliers;
  random?: () => number;
  /** Tuning overrides (default to module constants). */
  mechanicAwareIq?: number;
  highIqOverride?: number;
  hammerWindupSeconds?: number;
}

export type { PlayerModelSnapshot };

export interface AICombatDecision {
  weapon: AICombatWeapon | null;
  bulltrueCounter: AICombatWeapon | null;
  postMissSpacing: boolean;
  bypassedRandomGate: boolean;
}

export const MECHANIC_AWARE_IQ_DEFAULT = 70;
export const HIGH_IQ_OVERRIDE_DEFAULT = 80;
export const HAMMER_WINDUP_SECONDS_DEFAULT = 0.32;

const MECHANIC_AWARE_IQ = MECHANIC_AWARE_IQ_DEFAULT;
const HIGH_IQ_OVERRIDE = HIGH_IQ_OVERRIDE_DEFAULT;
const HAMMER_WINDUP_SECONDS = HAMMER_WINDUP_SECONDS_DEFAULT;

export function isMechanicAwareDifficulty(
  difficulty: string,
  weaponSwapIQ: number,
  mechanicAwareIq: number = MECHANIC_AWARE_IQ,
  highIqOverride: number = HIGH_IQ_OVERRIDE,
): boolean {
  return difficulty === 'hard' ||
    difficulty === 'nightmare' ||
    (difficulty === 'custom' && weaponSwapIQ >= mechanicAwareIq) ||
    weaponSwapIQ >= highIqOverride;
}

export function isMissedLungeMemory(memory?: AILungeMemory | null): boolean {
  return !!memory &&
    memory.timeRemaining > 0 &&
    (memory.outcome === 'miss_timeout' || memory.outcome === 'miss_arena');
}

export function evaluateAICombatDecision(input: AICombatDecisionInput): AICombatDecision {
  const random = input.random ?? Math.random;
  const pSword = input.weaponPrioritization / 100;
  const swordForbidden = pSword <= 0;
  const hammerForbidden = pSword >= 1;

  if (swordForbidden && input.currentWeapon === 'sword') {
    return {
      weapon: 'hammer',
      bulltrueCounter: null,
      postMissSpacing: false,
      bypassedRandomGate: true,
    };
  }

  if (hammerForbidden && input.currentWeapon === 'hammer') {
    return {
      weapon: 'sword',
      bulltrueCounter: null,
      postMissSpacing: false,
      bypassedRandomGate: true,
    };
  }

  const targetIsProtected = (input.target.invulnerabilityTimer ?? 0) > 0;
  const minDistance = Math.min(input.distanceToTarget, input.combatDistanceToTarget ?? input.distanceToTarget);
  const playerDangerZone = input.attackRange + input.attackRadius * 0.85;
  const minLunge = playerDangerZone * 0.85;
  const maxLunge = Math.min(18.0, input.swordLungeDistance);
  const mechanicAware = isMechanicAwareDifficulty(input.difficulty, input.weaponSwapIQ, input.mechanicAwareIq, input.highIqOverride);
  const matchMultipliers = input.matchMultipliers ?? NEUTRAL_MATCH_MULTIPLIERS;
  const effectiveWeaponSwapIQ = getEffectiveWeaponSwapIQ(input.weaponSwapIQ, matchMultipliers);
  const commitBias = matchMultipliers.matchPointCommitBias;
  const decision: AICombatDecision = {
    weapon: null,
    bulltrueCounter: null,
    postMissSpacing: false,
    bypassedRandomGate: false,
  };

  if (input.difficulty === 'easy') {
    return decision;
  }

  if (mechanicAware && input.target.isLunging && minDistance < 15.0 && !targetIsProtected) {
    const timeToImpact = minDistance / Math.max(1, input.swordLungeSpeed);
    const hammerCounterDistance = input.swordLungeSpeed * (input.hammerWindupSeconds ?? HAMMER_WINDUP_SECONDS) + input.attackRadius * 0.85;
    const hammerCanCounter = input.canUseHammerCounter !== false &&
      input.canStartWeaponAction &&
      input.weaponState === 'ready' &&
      minDistance <= hammerCounterDistance + 0.75;

    if (hammerCanCounter && !hammerForbidden) {
      decision.weapon = 'hammer';
      decision.bulltrueCounter = 'hammer';
      decision.bypassedRandomGate = true;
      return decision;
    }

    const swordTradeWindow = Math.max(0.08, input.swordTradeWindowMs / 1000);
    const swordCanCounter = input.canStartWeaponAction &&
      input.weaponState === 'ready' &&
      input.currentWeapon === 'sword' &&
      timeToImpact <= swordTradeWindow + 0.12;

    if (
      matchMultipliers.avoidCoinFlipTrades &&
      !hammerCanCounter
    ) {
      decision.weapon = hammerForbidden ? 'sword' : 'hammer';
      decision.postMissSpacing = true;
      decision.bypassedRandomGate = true;
      return decision;
    }

    if (swordCanCounter && !swordForbidden && commitBias >= 0.75) {
      decision.weapon = 'sword';
      decision.bulltrueCounter = 'sword';
      decision.bypassedRandomGate = true;
      return decision;
    }

    decision.weapon = hammerForbidden ? 'sword' : 'hammer';
    decision.postMissSpacing = true;
    decision.bypassedRandomGate = true;
    return decision;
  }

  if (mechanicAware && isMissedLungeMemory(input.recentLungeMemory)) {
    const sameTarget = !input.recentLungeMemory?.targetId || input.recentLungeMemory.targetId === input.target.id;
    if (sameTarget) {
      const targetCanPunish = input.target.activeWeapon === 'hammer' ||
        input.target.isLunging ||
        input.target.weaponState === 'swing_up' ||
        input.target.weaponState === 'swing_down' ||
        input.distanceToTarget <= maxLunge + 1.5;

      if (input.target.hp <= 1 || input.distanceToTarget <= playerDangerZone + 1.2 || targetCanPunish) {
        decision.weapon = hammerForbidden ? 'sword' : 'hammer';
        decision.postMissSpacing = input.distanceToTarget > playerDangerZone * 0.8 || targetCanPunish;
        decision.bypassedRandomGate = true;
        return decision;
      }
    }
  }

  const dashLocked = (input.target.dashCooldownRemaining ?? 0) > 0;
  const swapLocked = (input.target.swapLockoutRemaining ?? 0) > 0;
  const inLungeBand = minDistance >= minLunge && minDistance <= maxLunge;
  const inCloseBand = minDistance < playerDangerZone * 0.85;

  if (
    mechanicAware &&
    !targetIsProtected &&
    !input.target.isLunging &&
    input.canStartWeaponAction &&
    (dashLocked || swapLocked) &&
    (inLungeBand || inCloseBand)
  ) {
    let punishWeapon: AICombatWeapon | null = null;

    if (dashLocked) {
      punishWeapon = 'sword';
    } else if (swapLocked && input.target.activeWeapon === 'hammer') {
      punishWeapon = 'hammer';
    } else if (swapLocked && input.target.activeWeapon === 'sword') {
      punishWeapon = 'sword';
    }

    if (punishWeapon === 'sword' && swordForbidden) {
      punishWeapon = hammerForbidden ? null : 'hammer';
    } else if (punishWeapon === 'hammer' && hammerForbidden) {
      punishWeapon = swordForbidden ? null : 'sword';
    }

    if (punishWeapon) {
      decision.weapon = punishWeapon;
      decision.bypassedRandomGate = true;
      return decision;
    }
  }

  const modelAdjusted = applyPlayerModelCombatAdjustments(
    decision,
    input,
    mechanicAware,
    minDistance,
    minLunge,
    maxLunge,
    pSword,
    hammerForbidden,
    swordForbidden,
  );
  if (modelAdjusted.weapon) {
    return modelAdjusted;
  }

  if (random() * 100 > effectiveWeaponSwapIQ + 10) {
    return decision;
  }

  if (targetIsProtected) {
    decision.weapon = hammerForbidden ? 'sword' : 'hammer';
    return decision;
  }

  if (input.nearbyEnemiesCount >= 2) {
    decision.weapon = hammerForbidden ? 'sword' : 'hammer';
    return decision;
  }

  if (input.target.hp <= 1 && input.distanceToTarget <= maxLunge && input.target.hp > 0) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  if (input.target.isLunging) {
    decision.weapon = hammerForbidden ? 'sword' : 'hammer';
    return decision;
  }

  if (input.target.weaponState === 'recovering' && input.distanceToTarget >= minLunge && input.distanceToTarget <= maxLunge) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  if (input.distanceToTarget >= minLunge && input.distanceToTarget <= maxLunge) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  if (input.distanceToTarget < playerDangerZone * 0.7 && input.botHP >= input.botMaxHP * 0.35 && input.nearbyEnemiesCount < 2) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  return decision;
}
