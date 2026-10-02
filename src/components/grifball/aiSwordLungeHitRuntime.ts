import * as THREE from 'three';
import { type DeathEvent, type Combatant } from '../../types';
import { MAIN_AI_ID } from '../../game/roster';
import {
  createReplayHeatmapCombatantSource,
  type ReplayHeatmapCombatantSource,
} from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type TacticalTargetCandidate } from './combatGeometry';
import { recordCombatantDamageReceivedObservation } from './playerModelObservations';

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
    weapon?: DeathEvent['weapon'],
    heatmap?: {
      attacker: ReplayHeatmapCombatantSource;
      victim: ReplayHeatmapCombatantSource;
    }
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
      // Local weapon animation already ran this frame. Cancel now so a lethal
      // incoming flight cannot leave a dead player lunging or recovering.
      state.isLunging = false; state.lungeTimer = 0;
      state.pSwordState = state.pWeaponState = 'ready';
      state.pSwordTimer = state.pWeaponTimer = 0;
      state.pSwordReady = state.pWeaponReady = true;
      state.playerRespawnTimer = 3.0;
      state.playerDeaths += 1;
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      if (attackerBot.id === MAIN_AI_ID) {
        state.scoreEnemy += 1;
        state.enemyKills += 1;
      }
      playDeath();

      recordDeathEvent(attackerBot.playerName, state.settings.playerName || 'Blue (You)', undefined, 'sword', {
        attacker: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
        victim: createReplayHeatmapCombatantSource('player', undefined, {
          team: state.localPlayerTeam,
          pos: state.playerPos,
        }),
      });
      recordBotPsychKill(attackerBot.id, 'player', true);
    }
    return;
  }

  if (target.id === MAIN_AI_ID) {
    if (!mainAi) return;
    mainAi.hp -= 1;
    recordCombatantDamageReceivedObservation(state, target.id);
    finishSwordLunge(cooldownMult, 'hit', target.id);
    playExplosion();
    spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');

    if (mainAi.hp <= 0) {
      mainAi.hp = 0;
      mainAi.aiState = 'RESPAWNING';
      mainAi.respawnTimer = 3.0;
      mainAi.deaths = (mainAi.deaths || 0) + 1;
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

      recordDeathEvent(attackerBot.playerName, 'Red (AI)', undefined, 'sword', {
        attacker: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
        victim: createReplayHeatmapCombatantSource(MAIN_AI_ID, mainAi),
      });
      recordBotPsychKill(attackerBot.id, MAIN_AI_ID, true);
    }
    return;
  }

  const targetBot = state.otherPlayers.get(target.id);
  if (!targetBot) return;
  targetBot.hp -= 1;
  recordCombatantDamageReceivedObservation(state, target.id);
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

    recordDeathEvent(attackerBot.playerName, targetBot.playerName, undefined, 'sword', {
      attacker: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
      victim: createReplayHeatmapCombatantSource(target.id, targetBot),
    });
    recordBotPsychKill(attackerBot.id, target.id, true);
  }
}
