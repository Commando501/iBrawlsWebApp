import * as THREE from 'three';
import { type AIPersonalityFlags } from '../../game/aiPersonalities';
import {
  type AIMatchScoreContext,
  type AIResolvedKnobs,
  type DerivedAIParams,
} from '../../game/aiTuning';
import { type Combatant } from '../../types';
import {
  recordBotCalibrationCounterSuccessForState,
  recordBotCalibrationDeathForState,
  recordBotDamageTagForState,
} from './aiBookkeeping';
import { tryStartComboOnHitForState } from './combatantCombos';
import { type TacticalTargetCandidate } from './combatGeometry';
import {
  clearCombatantPressureTarget,
  getEffectivePressureAggression,
  tryEnterCombatantPressureState,
} from './matchPressure';
import { recordBotPostKillPressure } from './postKillPressure';
import { type GrifballRuntimeState } from './runtimeState';

export function createAICombatBookkeepingCallbacksForState({
  getState,
  isMultiplayer,
  getRosterAI,
  rosterCombatant,
  resolveBotKnobs,
  resolveBotDerived,
  resolveBotFlags,
  getMatchScoreContext,
  getTacticalTargetById,
  getOptimalSpawnPoint,
}: {
  getState: () => GrifballRuntimeState;
  isMultiplayer: boolean;
  getRosterAI: () => Combatant[];
  rosterCombatant: (botId: string) => Combatant | undefined;
  resolveBotKnobs: (botId: string) => AIResolvedKnobs;
  resolveBotDerived: (botId: string) => DerivedAIParams;
  resolveBotFlags: (botId: string) => AIPersonalityFlags;
  getMatchScoreContext: () => AIMatchScoreContext;
  getTacticalTargetById: (botId: string, targetId: string) => TacticalTargetCandidate | null;
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
}) {
  const getBotPressureAggression = (botId: string): number => {
    const state = getState();
    const baseAggression = resolveBotDerived(botId).pressureAggression;
    return getEffectivePressureAggression(state.settings, getMatchScoreContext(), baseAggression);
  };

  const tryEnterPressureState = (
    botId: string,
    targetId: string,
    targetHp: number,
    targetInvuln: number
  ): boolean => {
    const state = getState();
    const personalityFlags = resolveBotFlags(botId);
    const pressureAggression = getBotPressureAggression(botId);
    return tryEnterCombatantPressureState({
      bot: rosterCombatant(botId),
      targetId,
      targetHp,
      targetInvuln,
      pressureAggression,
      skipPressure: personalityFlags.skipPressure,
      settings: state.settings,
      scoreContext: getMatchScoreContext(),
    });
  };

  const clearPressureTarget = (botId: string) => {
    clearCombatantPressureTarget(rosterCombatant(botId));
  };

  const tryStartComboOnHit = (
    botId: string,
    targetId: string,
    openingWeapon: 'hammer' | 'sword',
    opts: { targetRecovering?: boolean } = {}
  ) => {
    tryStartComboOnHitForState({
      state: getState(),
      botId,
      targetId,
      openingWeapon,
      bot: rosterCombatant(botId),
      candidate: getTacticalTargetById(botId, targetId),
      knobs: resolveBotKnobs(botId),
      targetRecovering: opts.targetRecovering,
    });
  };

  const recordBotPsychKill = (botId: string, victimId: string, wasLungeKill: boolean) => {
    const knobs = resolveBotKnobs(botId);
    recordBotPostKillPressure({
      state: getState(),
      bot: rosterCombatant(botId),
      botId,
      victimId,
      difficulty: knobs.difficulty,
      pressureAggression: getBotPressureAggression(botId),
      wasLungeKill,
      rosterAI: getRosterAI(),
      getOptimalSpawnPoint,
      nowSeconds: performance.now() / 1000,
    });
  };

  const recordBotCalibrationDeath = (botId: string) => {
    const knobs = resolveBotKnobs(botId);
    recordBotCalibrationDeathForState({
      state: getState(),
      botId,
      difficulty: knobs.difficulty,
      nowSeconds: performance.now() / 1000,
    });
  };

  const tryRecordCalibrationCounterSuccess = (botId: string) => {
    const knobs = resolveBotKnobs(botId);
    recordBotCalibrationCounterSuccessForState({
      state: getState(),
      botId,
      difficulty: knobs.difficulty,
    });
  };

  const recordBotDamageTag = (botId: string, targetId: string) => {
    recordBotDamageTagForState({
      state: getState(),
      botId,
      targetId,
      isMultiplayer,
    });
  };

  return {
    getBotPressureAggression,
    tryEnterPressureState,
    clearPressureTarget,
    tryStartComboOnHit,
    recordBotPsychKill,
    recordBotCalibrationDeath,
    tryRecordCalibrationCounterSuccess,
    recordBotDamageTag,
  };
}
