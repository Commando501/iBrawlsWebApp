import * as THREE from 'three';
import { type Combatant, type MedalInfo } from '../../types';
import { applyHammerStrikeImpactForState } from './hammerStrikeImpactRuntime';
import { applyMainAIHammerMeleeImpactForState } from './mainAIHammerMeleeRuntime';
import { applyMainAISwordSlashImpactForState } from './mainAISwordSlashRuntime';
import { applyPlayerHammerMeleeImpactForState } from './playerHammerMeleeRuntime';
import { applyPlayerSwordSlashImpactForState } from './playerSwordSlashRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type EnemyAITarget } from './targetSelection';
import { type CombatTradeReason } from './tradeRuntime';

export function createCombatImpactCallbacksForState({
  getState,
  getMainAI,
  getEnemyAITarget,
  isMultiplayer,
  areCombatantsHostile,
  executeTrade,
  sendSync,
  applyOutgoingMultiplayerHitLocally,
  renderHammerSplashVfx,
  spawnVoxelShockwaveParticles,
  evaluatePlayerKillMedals,
  recordBotCalibrationDeath,
  recordPlayerDamageTaken,
  tryRecordCalibrationCounterSuccess,
  recordBotPsychKill,
  recordBotDamageTag,
  tryEnterPressureState,
  tryStartComboOnHit,
  playExplosion,
  playSwing,
  playDeath,
  playJump,
  pushStatsUpdate,
}: {
  getState: () => GrifballRuntimeState;
  getMainAI: () => Combatant | undefined;
  getEnemyAITarget: () => EnemyAITarget | null;
  isMultiplayer: boolean;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  executeTrade: (reason: CombatTradeReason) => void;
  sendSync: (payload: object) => boolean;
  applyOutgoingMultiplayerHitLocally: (targetId: string, damage?: number) => void;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
  recordPlayerDamageTaken: () => void;
  tryRecordCalibrationCounterSuccess: (botId: string) => void;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotDamageTag: (botId: string, targetId: string) => void;
  tryEnterPressureState: (botId: string, targetId: string, targetHp: number, targetInvuln: number) => boolean;
  tryStartComboOnHit: (
    botId: string,
    targetId: string,
    openingWeapon: 'hammer' | 'sword',
    opts?: { targetRecovering?: boolean }
  ) => void;
  playExplosion: () => void;
  playSwing: () => void;
  playDeath: () => void;
  playJump: () => void;
  pushStatsUpdate: () => void;
}): {
  applyHammerStrikeImpact: (isPlayerStriking: boolean) => void;
  applyEnemySwordSlashImpact: () => void;
  applyPlayerHammerMeleeImpact: () => void;
  applyPlayerSwordSlashImpact: () => boolean;
  applyEnemyHammerMeleeImpact: () => void;
} {
  const applyHammerStrikeImpact = (isPlayerStriking: boolean) =>
    applyHammerStrikeImpactForState({
      state: getState(),
      isPlayerStriking,
      mainAI: getMainAI(),
      getEnemyAITarget,
      isMultiplayer,
      areCombatantsHostile,
      sendSync,
      applyOutgoingMultiplayerHitLocally,
      renderHammerSplashVfx,
      spawnVoxelShockwaveParticles,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
      recordPlayerDamageTaken,
      tryRecordCalibrationCounterSuccess,
      recordBotPsychKill,
      recordBotDamageTag,
      tryEnterPressureState,
      tryStartComboOnHit,
      playExplosion,
      playSwing,
      playDeath,
      playJump,
      pushStatsUpdate,
    });

  const applyEnemySwordSlashImpact = () => {
    return applyMainAISwordSlashImpactForState({
      state: getState(),
      mainAI: getMainAI(),
      target: getEnemyAITarget(),
      isMultiplayer,
      areCombatantsHostile,
      executeTrade,
      recordPlayerDamageTaken,
      tryRecordCalibrationCounterSuccess,
      playSwing,
      playDeath,
      spawnVoxelShockwaveParticles,
      recordBotPsychKill,
      recordBotDamageTag,
      tryEnterPressureState,
      tryStartComboOnHit,
      pushStatsUpdate,
    });
  };

  const applyPlayerHammerMeleeImpact = () =>
    applyPlayerHammerMeleeImpactForState({
      state: getState(),
      mainAI: getMainAI(),
      isMultiplayer,
      areCombatantsHostile,
      sendSync,
      playSwing,
      playDeath,
      spawnVoxelShockwaveParticles,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
    });

  const applyPlayerSwordSlashImpact = () =>
    applyPlayerSwordSlashImpactForState({
      state: getState(),
      mainAI: getMainAI(),
      isMultiplayer,
      areCombatantsHostile,
      executeTrade,
      sendSync,
      applyOutgoingMultiplayerHitLocally,
      playSwing,
      playDeath,
      spawnVoxelShockwaveParticles,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
    });

  const applyEnemyHammerMeleeImpact = () => {
    return applyMainAIHammerMeleeImpactForState({
      state: getState(),
      mainAI: getMainAI(),
      target: getEnemyAITarget(),
      isMultiplayer,
      areCombatantsHostile,
      recordPlayerDamageTaken,
      tryRecordCalibrationCounterSuccess,
      playSwing,
      playDeath,
      spawnVoxelShockwaveParticles,
      recordBotPsychKill,
      recordBotDamageTag,
      tryEnterPressureState,
      tryStartComboOnHit,
      pushStatsUpdate,
    });
  };

  return {
    applyHammerStrikeImpact,
    applyEnemySwordSlashImpact,
    applyPlayerHammerMeleeImpact,
    applyPlayerSwordSlashImpact,
    applyEnemyHammerMeleeImpact,
  };
}
