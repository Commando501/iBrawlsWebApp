import { UniversalSettings } from '../types';
import { isMechanicAwareDifficulty } from './aiCombatDecision';

export interface AIResolvedKnobs {
  difficulty: string;
  reactionLatency: number;
  anticipationFactor: number;
  movementComplexity: number;
  weaponSwapIQ: number;
  aiPlaystyle: number;
  weaponPrioritization: number;
}

export interface DerivedAIParams {
  spatialIQ: number;
  feintChance: number;
  pressureAggression: number;
  mechanicAware: boolean;
}

/** Live score context for match-state modulation (PR-D). */
export interface AIMatchScoreContext {
  scorePlayer: number;
  scoreEnemy: number;
  /** First-to-N kills; omit when sandbox has no win target. */
  killsToWin?: number;
}

/** Score-aware multipliers applied on top of derived tuning knobs. */
export interface MatchStateMultipliers {
  /** Scales effective pressure aggression and approach tempo. */
  aggressionMult: number;
  /** Scales attack cooldown timers (>1 = slower swings when protecting a lead). */
  cooldownMult: number;
  /** Scales spacing bands (>1 = wider standoff). */
  spacingMult: number;
  /** Bonus added to weapon-swap IQ random gate (close matches peak decision quality). */
  iqGateBonus: number;
  /** Prefer spacing and disengage over coin-flip counter trades. */
  avoidCoinFlipTrades: boolean;
  /** Match-point commit bias (>1 aggressive, <1 patient). */
  matchPointCommitBias: number;
  /** Scales PRESSURING chain duration. */
  pressureDurationMult: number;
}

export const NEUTRAL_MATCH_MULTIPLIERS: MatchStateMultipliers = {
  aggressionMult: 1,
  cooldownMult: 1,
  spacingMult: 1,
  iqGateBonus: 0,
  avoidCoinFlipTrades: false,
  matchPointCommitBias: 1,
  pressureDurationMult: 1,
};

const SCORE_AHEAD_THRESHOLD = 5;
const SCORE_CLOSE_THRESHOLD = 2;

const FEINT_IQ_GATE = 60;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function deriveSpatialIQ(
  movementComplexity: number,
  anticipationFactor: number
): number {
  const anticipationPct = anticipationFactor * 100;
  return clampPercent(movementComplexity * 0.55 + anticipationPct * 0.45);
}

export function deriveFeintChance(
  movementComplexity: number,
  anticipationFactor: number,
  difficulty: string,
  weaponSwapIQ: number
): number {
  if (difficulty === 'easy') {
    return 0;
  }

  const gate =
    difficulty === 'hard' ||
    difficulty === 'nightmare' ||
    (difficulty === 'custom' && weaponSwapIQ >= FEINT_IQ_GATE);

  if (!gate) {
    return 0;
  }

  const anticipationPct = anticipationFactor * 100;
  return clampPercent(movementComplexity * 0.35 + anticipationPct * 0.25);
}

export function derivePressureAggression(aiPlaystyle: number): number {
  return clampPercent(aiPlaystyle);
}

export function deriveMatchStateMultipliers(
  context: AIMatchScoreContext,
  playstyleFactor: number
): MatchStateMultipliers {
  const scoreDelta = context.scoreEnemy - context.scorePlayer;
  const absDelta = Math.abs(scoreDelta);
  const mult: MatchStateMultipliers = { ...NEUTRAL_MATCH_MULTIPLIERS };

  if (scoreDelta >= SCORE_AHEAD_THRESHOLD) {
    mult.aggressionMult = 0.72;
    mult.cooldownMult = 1.25;
    mult.spacingMult = 1.2;
    mult.avoidCoinFlipTrades = true;
    mult.pressureDurationMult = 0.85;
  } else if (scoreDelta <= -SCORE_AHEAD_THRESHOLD) {
    mult.aggressionMult = 1.28;
    mult.cooldownMult = 0.82;
    mult.spacingMult = 0.82;
    mult.pressureDurationMult = 1.2;
  } else if (absDelta <= SCORE_CLOSE_THRESHOLD) {
    mult.iqGateBonus = 15;
  }

  const killsToWin = context.killsToWin;
  if (killsToWin && killsToWin > 0) {
    const aiOnMatchPoint = context.scoreEnemy >= killsToWin - 1;
    const playerOnMatchPoint = context.scorePlayer >= killsToWin - 1;

    if (aiOnMatchPoint) {
      if (playstyleFactor >= 0.5) {
        mult.matchPointCommitBias = 1.35;
        mult.aggressionMult *= 1.15;
        mult.iqGateBonus += 8;
        mult.pressureDurationMult *= 1.1;
      } else {
        mult.matchPointCommitBias = 0.65;
        mult.aggressionMult *= 0.85;
        mult.avoidCoinFlipTrades = true;
        mult.spacingMult *= 1.15;
        mult.cooldownMult *= 1.1;
      }
    }

    if (playerOnMatchPoint && !aiOnMatchPoint) {
      if (playstyleFactor >= 0.5) {
        mult.aggressionMult *= 1.2;
        mult.matchPointCommitBias = Math.max(mult.matchPointCommitBias, 1.2);
        mult.pressureDurationMult *= 1.15;
      } else {
        mult.avoidCoinFlipTrades = true;
        mult.spacingMult *= 1.1;
        mult.cooldownMult *= 1.08;
      }
    }
  }

  return mult;
}

export function applyMatchAggression(
  basePressureAggression: number,
  multipliers: MatchStateMultipliers
): number {
  return clampPercent(basePressureAggression * multipliers.aggressionMult);
}

export function getEffectiveWeaponSwapIQ(
  weaponSwapIQ: number,
  multipliers: MatchStateMultipliers
): number {
  const commitBonus = multipliers.matchPointCommitBias > 1
    ? Math.round((multipliers.matchPointCommitBias - 1) * 20)
    : 0;
  return clampPercent(weaponSwapIQ + multipliers.iqGateBonus + commitBonus);
}

export function shouldAvoidCoinFlipTrade(input: {
  difficulty: string;
  playstyleFactor: number;
  botHP: number;
  targetHP: number;
  multipliers: MatchStateMultipliers;
  requireTargetOnCooldown?: boolean;
  targetOnCooldown?: boolean;
}): boolean {
  if (input.difficulty !== 'hard' && input.difficulty !== 'nightmare') {
    return false;
  }

  if (input.multipliers.avoidCoinFlipTrades) {
    return true;
  }

  if (input.multipliers.matchPointCommitBias < 0.75 && input.botHP <= input.targetHP) {
    return true;
  }

  if (
    input.playstyleFactor < 0.8 &&
    input.botHP <= input.targetHP &&
    (!input.requireTargetOnCooldown || input.targetOnCooldown)
  ) {
    return true;
  }

  return false;
}

export function deriveAIParams(
  settings: UniversalSettings,
  knobs: AIResolvedKnobs
): DerivedAIParams {
  const spatialIQ = deriveSpatialIQ(knobs.movementComplexity, knobs.anticipationFactor);
  const feintChance = deriveFeintChance(
    knobs.movementComplexity,
    knobs.anticipationFactor,
    knobs.difficulty,
    knobs.weaponSwapIQ
  );
  const pressureAggression = derivePressureAggression(knobs.aiPlaystyle);

  return {
    spatialIQ: settings.aiSpatialIQ ?? spatialIQ,
    feintChance: settings.aiFeintChance ?? feintChance,
    pressureAggression: settings.aiPressureAggression ?? pressureAggression,
    mechanicAware: isMechanicAwareDifficulty(knobs.difficulty, knobs.weaponSwapIQ),
  };
}
