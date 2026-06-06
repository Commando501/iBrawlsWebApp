import { tickBotPsychState } from '../../game/aiMatchContext';
import {
  getActivePostKillPressure,
  getEffectiveReactionLatency,
  isPsychPressureEnabled,
  type BotPsychState,
  type PostKillPressure,
} from '../../game/aiPsychologicalPressure';
import {
  applyCalibrationMultipliers,
  computeCalibrationMultipliers,
  getOrCreateBotCalibrationState,
  isSkillCalibrationEnabled,
  NEUTRAL_CALIBRATION_MULTIPLIERS,
  type SkillCalibrationMultipliers,
} from '../../game/aiSkillCalibration';
import {
  type AIMatchScoreContext,
  type AIResolvedKnobs,
  type DerivedAIParams,
  type MatchStateMultipliers,
} from '../../game/aiTuning';
import { type AIPersonalityFlags } from '../../game/aiPersonalities';
import { type Combatant } from '../../types';
import {
  getEffectivePressureAggression,
  getPressureMatchMultipliers,
} from './matchPressure';
import { type GrifballRuntimeState } from './runtimeState';

type CombatBehaviorTuning = {
  maxCalibrationDrift: number;
  tempoCycleDuration: number;
  tempoSlowMult: number;
  tempoFastMult: number;
};

export interface AICombatTuningPrelude {
  difficulty: string;
  movementComplexity: number;
  weaponSwapIQ: number;
  weaponPrioritization: number;
  swordForbidden: boolean;
  hammerForbidden: boolean;
  derivedParams: DerivedAIParams;
  personalityFlags: AIPersonalityFlags;
  matchMultipliers: MatchStateMultipliers;
  effectivePressureAggression: number;
  playstyleFactor: number;
  calibrationEnabled: boolean;
  calibrationMultipliers: SkillCalibrationMultipliers;
  tunedReactionLatency: number;
  tunedAnticipationFactor: number;
  psychEnabled: boolean;
  psychState: BotPsychState;
  effectiveReactionLatency: number;
  postKillPressure: PostKillPressure | undefined;
}

export function resolveAICombatTuningPreludeForCombatant({
  state,
  self,
  botId,
  dt,
  tuning,
  resolveBotKnobs,
  resolveBotDerived,
  resolveBotFlags,
  getMatchScoreContext,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  botId: string;
  dt: number;
  tuning: CombatBehaviorTuning;
  resolveBotKnobs: (botId: string) => AIResolvedKnobs;
  resolveBotDerived: (botId: string) => DerivedAIParams;
  resolveBotFlags: (botId: string) => AIPersonalityFlags;
  getMatchScoreContext: () => AIMatchScoreContext;
}): AICombatTuningPrelude {
  const resolvedKnobs = resolveBotKnobs(botId);
  const difficulty = resolvedKnobs.difficulty;
  const movementComplexity = resolvedKnobs.movementComplexity;
  const weaponSwapIQ = resolvedKnobs.weaponSwapIQ;
  const weaponPrioritization = resolvedKnobs.weaponPrioritization;
  const swordForbidden = weaponPrioritization <= 0;
  const hammerForbidden = weaponPrioritization >= 100;

  if ((self.aiPostLungeDecisionTimer ?? 0) > 0) {
    self.aiPostLungeDecisionTimer = Math.max(0, self.aiPostLungeDecisionTimer - dt);
  }

  const derivedParams = resolveBotDerived(botId);
  const personalityFlags = resolveBotFlags(botId);
  const matchScoreContext = getMatchScoreContext();
  const matchMultipliers = getPressureMatchMultipliers(
    state.settings,
    matchScoreContext,
    derivedParams.pressureAggression
  );
  const effectivePressureAggression = getEffectivePressureAggression(
    state.settings,
    matchScoreContext,
    derivedParams.pressureAggression
  );
  const playstyleFactor = effectivePressureAggression / 100;

  const calibrationEnabled = isSkillCalibrationEnabled(difficulty);
  const calibrationMultipliers = calibrationEnabled
    ? computeCalibrationMultipliers(
      getOrCreateBotCalibrationState(state.aiMatchContext, botId),
      tuning.maxCalibrationDrift
    )
    : NEUTRAL_CALIBRATION_MULTIPLIERS;
  const calibratedKnobs = applyCalibrationMultipliers({
    reactionLatency: resolvedKnobs.reactionLatency,
    anticipationFactor: resolvedKnobs.anticipationFactor,
    aggressiveLungeMult: 1,
    multipliers: calibrationMultipliers,
  });
  const tunedReactionLatency = calibratedKnobs.reactionLatency;
  const tunedAnticipationFactor = calibratedKnobs.anticipationFactor;

  const psychEnabled = isPsychPressureEnabled(difficulty, effectivePressureAggression);
  const psychState = tickBotPsychState(state.aiMatchContext, botId, dt, tuning.tempoCycleDuration);
  const effectiveReactionLatency = getEffectiveReactionLatency(
    tunedReactionLatency,
    psychState,
    psychEnabled,
    tuning.tempoSlowMult,
    tuning.tempoFastMult
  );
  const postKillPressure = psychEnabled ? getActivePostKillPressure(psychState) : undefined;

  return {
    difficulty,
    movementComplexity,
    weaponSwapIQ,
    weaponPrioritization,
    swordForbidden,
    hammerForbidden,
    derivedParams,
    personalityFlags,
    matchMultipliers,
    effectivePressureAggression,
    playstyleFactor,
    calibrationEnabled,
    calibrationMultipliers,
    tunedReactionLatency,
    tunedAnticipationFactor,
    psychEnabled,
    psychState,
    effectiveReactionLatency,
    postKillPressure,
  };
}
