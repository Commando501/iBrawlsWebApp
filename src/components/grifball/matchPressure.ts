import {
  applyMatchAggression,
  deriveMatchStateMultipliers,
  type AIMatchScoreContext,
  type MatchStateMultipliers,
} from '../../game/aiTuning';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { getPressureDuration, shouldEnterPressure } from '../../game/aiPressure';
import { type Combatant, type UniversalSettings } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export const createMatchScoreContext = (
  state: GrifballRuntimeState,
  killsToWin: number | undefined
): AIMatchScoreContext => ({
  scorePlayer: state.scorePlayer,
  scoreEnemy: state.scoreEnemy,
  killsToWin,
});

export const getPressureMatchMultipliers = (
  settings: UniversalSettings,
  scoreContext: AIMatchScoreContext,
  pressureAggression: number
): MatchStateMultipliers => {
  const tuning = resolveBehaviorTuning(settings);
  return deriveMatchStateMultipliers(scoreContext, pressureAggression / 100, {
    aheadThreshold: tuning.scoreAheadThreshold,
    closeThreshold: tuning.scoreCloseThreshold,
  });
};

export const getEffectivePressureAggression = (
  settings: UniversalSettings,
  scoreContext: AIMatchScoreContext,
  baseAggression: number
): number => applyMatchAggression(
  baseAggression,
  getPressureMatchMultipliers(settings, scoreContext, baseAggression)
);

export const tryEnterCombatantPressureState = ({
  bot,
  targetId,
  targetHp,
  targetInvuln,
  pressureAggression,
  skipPressure,
  settings,
  scoreContext,
}: {
  bot: Combatant | undefined;
  targetId: string;
  targetHp: number;
  targetInvuln: number;
  pressureAggression: number;
  skipPressure?: boolean;
  settings: UniversalSettings;
  scoreContext: AIMatchScoreContext;
}): boolean => {
  if (skipPressure) {
    return false;
  }

  if (!shouldEnterPressure({ pressureAggression, targetHp, targetInvuln })) {
    return false;
  }

  if (!bot || bot.controller !== 'ai') {
    return false;
  }

  const duration = getPressureDuration(pressureAggression) *
    getPressureMatchMultipliers(settings, scoreContext, pressureAggression).pressureDurationMult;

  bot.aiState = 'PRESSURING';
  bot.aiTimer = duration;
  bot.aiPressureTargetId = targetId;
  return true;
};

export const clearCombatantPressureTarget = (bot: Combatant | undefined): void => {
  if (bot) {
    bot.aiPressureTargetId = undefined;
  }
};
