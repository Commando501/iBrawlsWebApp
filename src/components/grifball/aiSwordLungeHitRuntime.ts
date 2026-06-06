import * as THREE from 'three';
import { type DeathEvent, type Combatant } from '../../types';
import { MAIN_AI_ID } from '../../game/roster';
import { type GrifballRuntimeState } from './runtimeState';
import { type TacticalTargetCandidate } from './combatGeometry';

export function applyAISwordLungeHitForState({
  state,
  attackerBot,
  target,
  mainAi,
  cooldownMult,
  finishSwordLunge,
  recordPlayerDamageTaken,
  playExplosion,
  playDeath,
  spawnVoxelShockwaveParticles,
  recordDeathEvent,
  recordBotPsychKill,
  recordBotCalibrationDeath,
}: {
  state: GrifballRuntimeState;
  attackerBot: Combatant;
  target: TacticalTargetCandidate;
  mainAi: Combatant | undefined;
  cooldownMult: number;
  finishSwordLunge: (cooldownMultiplier: number, outcome: 'hit', targetId: string) => void;
  recordPlayerDamageTaken: () => void;
  playExplosion: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  recordDeathEvent: (
    attacker: string,
    victim: string,
    medals?: undefined,
    weapon?: DeathEvent['weapon']
  ) => DeathEvent;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotCalibrationDeath: (botId: string) => void;
}): void {
  if (target.id === 'player') {
    recordPlayerDamageTaken();
    state.playerHP -= 1;
    finishSwordLunge(cooldownMult, 'hit', target.id);
    playExplosion();
    spawnVoxelShockwaveParticles(state.playerPos, '#ef4444');

    if (state.playerHP <= 0) {
      state.playerHP = 0;
      state.playerRespawnTimer = 3.0;
      state.playerDeaths += 1;
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      if (attackerBot.id === MAIN_AI_ID) {
        state.scoreEnemy += 1;
        state.enemyKills += 1;
      }
      playDeath();

      const newDeath: DeathEvent = {
        id: Math.random().toString(36).substring(2, 9),
        attacker: attackerBot.playerName,
        victim: state.settings.playerName || 'Blue (You)',
        weapon: 'sword',
      };
      state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
      recordBotPsychKill(attackerBot.id, 'player', true);
    }
    return;
  }

  if (target.id === MAIN_AI_ID) {
    if (!mainAi) return;
    mainAi.hp -= 1;
    finishSwordLunge(cooldownMult, 'hit', target.id);
    playExplosion();
    spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');

    if (mainAi.hp <= 0) {
      mainAi.hp = 0;
      mainAi.aiState = 'RESPAWNING';
      state.enemyRespawnTimer = 3.0;
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      if (attackerBot.id === MAIN_AI_ID) {
        state.scoreEnemy += 1;
        state.enemyKills += 1;
      }
      state.enemyDeaths += 1;
      recordBotCalibrationDeath(MAIN_AI_ID);
      playDeath();

      recordDeathEvent(attackerBot.playerName, 'Red (AI)', undefined, 'sword');
      recordBotPsychKill(attackerBot.id, MAIN_AI_ID, true);
    }
    return;
  }

  const targetBot = state.otherPlayers.get(target.id);
  if (!targetBot) return;
  targetBot.hp -= 1;
  finishSwordLunge(cooldownMult, 'hit', target.id);
  playExplosion();
  spawnVoxelShockwaveParticles(targetBot.pos, '#ef4444');

  if (targetBot.hp <= 0) {
    targetBot.hp = 0;
    targetBot.respawnTimer = 3.0;
    attackerBot.score = (attackerBot.score || 0) + 1;
    attackerBot.kills = (attackerBot.kills || 0) + 1;
    if (attackerBot.id === MAIN_AI_ID) {
      state.scoreEnemy += 1;
      state.enemyKills += 1;
    }
    targetBot.deaths = (targetBot.deaths || 0) + 1;
    playDeath();

    recordDeathEvent(attackerBot.playerName, targetBot.playerName, undefined, 'sword');
    recordBotPsychKill(attackerBot.id, target.id, true);
  }
}
