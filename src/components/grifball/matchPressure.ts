import {
  applyMatchAggression,
  deriveMatchStateMultipliers,
  type AIMatchScoreContext,
  type MatchStateMultipliers,
} from '../../game/aiTuning';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { type UniversalSettings } from '../../types';
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
