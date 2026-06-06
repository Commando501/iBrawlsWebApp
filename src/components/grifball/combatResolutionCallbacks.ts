import * as THREE from 'three';
import {
  type Combatant,
  type DeathEvent,
  type GameStats,
  type MedalInfo,
} from '../../types';
import {
  getLocalPlayerFeedName,
  recordDeathEvent,
} from './deathFeed';
import { applyOutgoingMultiplayerHitForState } from './multiplayerHitRuntime';
import { evaluatePlayerKillMedalsForState } from './playerMedals';
import { type GrifballRuntimeState } from './runtimeState';
import {
  executeCustomBotTradeForState,
  executeMainAITradeForState,
  type CombatTradeReason,
} from './tradeRuntime';

type MedalId = string;

export function createCombatResolutionCallbacksForState({
  getState,
  getMainAI,
  multiplayerRole,
  rosterCombatant,
  recordBotCalibrationDeath,
  spawnVoxelShockwaveParticles,
  pushStatsUpdate,
  playDeath,
  playExplosion,
  playMedal,
}: {
  getState: () => GrifballRuntimeState;
  getMainAI: () => Combatant | undefined;
  multiplayerRole: GameStats['multiplayerRole'];
  rosterCombatant: (id: string) => Combatant | undefined;
  recordBotCalibrationDeath: (botId: string) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  pushStatsUpdate: () => void;
  playDeath: () => void;
  playExplosion: () => void;
  playMedal: (medalId: MedalId) => void;
}) {
  const getLocalPlayerFeedNameForCurrentState = () => {
    const state = getState();
    return getLocalPlayerFeedName(state.settings.playerName, multiplayerRole);
  };

  const recordDeathEventForCurrentState = (
    attacker: string,
    victim: string,
    medals?: MedalInfo[],
    weapon?: DeathEvent['weapon']
  ) => {
    return recordDeathEvent(getState(), attacker, victim, medals, weapon);
  };

  function evaluatePlayerKillMedals(victimId: string): MedalInfo[] {
    const state = getState();
    return evaluatePlayerKillMedalsForState({
      state,
      getState,
      victimId,
      victim: rosterCombatant(victimId),
      playMedal,
      onPopupExpired: pushStatsUpdate,
    });
  }

  const applyOutgoingMultiplayerHitLocally = (targetId: string, damage: number = 1) =>
    applyOutgoingMultiplayerHitForState({
      state: getState(),
      targetId,
      damage,
      evaluatePlayerKillMedals,
      recordDeathEvent: recordDeathEventForCurrentState,
      getLocalPlayerFeedName: getLocalPlayerFeedNameForCurrentState,
      playDeath,
      spawnVoxelShockwaveParticles,
    });

  const executeCustomBotTrade = (
    attackerBot: Combatant,
    target: { id: string },
    reason: CombatTradeReason = 'sword_vs_sword'
  ) =>
    executeCustomBotTradeForState({
      state: getState(),
      attackerBot,
      target,
      reason,
      rosterCombatant,
      evaluatePlayerKillMedals,
      recordDeathEvent: recordDeathEventForCurrentState,
      getLocalPlayerFeedName: getLocalPlayerFeedNameForCurrentState,
      playExplosion,
      playDeath,
      spawnVoxelShockwaveParticles,
      recordBotCalibrationDeath,
      pushStatsUpdate,
    });

  const executeTrade = (reason: CombatTradeReason) =>
    executeMainAITradeForState({
      state: getState(),
      mainAi: getMainAI(),
      reason,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
      playExplosion,
      playDeath,
      spawnVoxelShockwaveParticles,
      pushStatsUpdate,
    });

  return {
    getLocalPlayerFeedName: getLocalPlayerFeedNameForCurrentState,
    recordDeathEvent: recordDeathEventForCurrentState,
    applyOutgoingMultiplayerHitLocally,
    executeCustomBotTrade,
    evaluatePlayerKillMedals,
    executeTrade,
  };
}
