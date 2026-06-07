import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent, type MedalInfo } from '../../types';
import { MELEE_SWORD_SLASH_REACH } from './combatGeometry';
import { createReplayHeatmapCombatantSource, queueReplayHeatmapDeathEventsForState } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';

type PlayerSwordSlashHitSyncPayload = {
  type: 'sync';
  action: 'hit_taken';
  damage: 1;
  targetId: string;
};

export function applyPlayerSwordSlashImpactForState({
  state,
  mainAI,
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
}: {
  state: GrifballRuntimeState;
  mainAI: Combatant | undefined;
  isMultiplayer: boolean;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  executeTrade: (reason: 'sword_vs_sword' | 'sword_lunge_vs_hammer') => void;
  sendSync: (payload: PlayerSwordSlashHitSyncPayload) => boolean;
  applyOutgoingMultiplayerHitLocally: (targetId: string, damage?: number) => void;
  playSwing: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
}): boolean {
  const eyePos = new THREE.Vector3(
    state.playerPos.x,
    1.65 - state.crouchAmount + state.playerPos.y,
    state.playerPos.z
  );
  const cameraLookDir = new THREE.Vector3(0, 0, -1)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
    .normalize();

  if (
    !isMultiplayer &&
    mainAI &&
    mainAI.hp > 0 &&
    mainAI.aiState !== 'RESPAWNING' &&
    (mainAI.invulnerabilityTimer ?? 0) <= 0 &&
    areCombatantsHostile('player', MAIN_AI_ID)
  ) {
    const enemyCenter = new THREE.Vector3(mainAI.pos.x, mainAI.pos.y + 0.825, mainAI.pos.z);
    const toEnemy = enemyCenter.clone().sub(eyePos);
    const dist = toEnemy.length();
    if (dist <= MELEE_SWORD_SLASH_REACH) {
      const toEnemyDir = toEnemy.clone().normalize();
      const dot = cameraLookDir.dot(toEnemyDir);
      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

      if (angle <= 1.0) {
        const swordThreshold = state.settings.swordTradeWindow ?? 350;
        const isAISwordActiveAttack = state.settings.enableSwordTrade && mainAI.activeWeapon === 'sword' && (
          mainAI.aiState === 'LUNGING' ||
          mainAI.weaponState === 'swing_up' ||
          mainAI.weaponState === 'swing_down' ||
          (Date.now() - mainAI.lastSwordAttackTime <= swordThreshold)
        );
        if (isAISwordActiveAttack) {
          executeTrade('sword_vs_sword');
          return true;
        }

        mainAI.hp -= 1;
        playSwing();
        spawnVoxelShockwaveParticles(mainAI.pos, '#22d3ee');
        state.lastStrikePos = mainAI.pos.clone();
        state.lastStrikeTick = 1.0;
        if (mainAI.hp <= 0) {
          mainAI.hp = 0;
          mainAI.aiState = 'RESPAWNING';
          state.enemyRespawnTimer = 3.0;
          state.scorePlayer += 1;
          state.playerKills += 1;
          state.enemyDeaths += 1;
          recordBotCalibrationDeath(MAIN_AI_ID);
          playDeath();
          mainAI.weaponState = 'ready';
          mainAI.weaponTimer = 0;

          const medals = evaluatePlayerKillMedals(MAIN_AI_ID);
          const newDeath: DeathEvent = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: state.settings.playerName || 'Blue (You)',
            victim: 'Red (AI)',
            medals,
            weapon: 'sword',
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          queueReplayHeatmapDeathEventsForState({
            state,
            attacker: createReplayHeatmapCombatantSource('player', undefined, {
              team: state.localPlayerTeam,
              pos: state.playerPos,
            }),
            victim: createReplayHeatmapCombatantSource(MAIN_AI_ID, mainAI),
            weapon: 'sword',
          });
          spawnVoxelShockwaveParticles(mainAI.pos, '#ef4444');
        }
      }
    }
  }

  if (state.otherPlayers) {
    state.otherPlayers.forEach((other) => {
      if (
        other.hp > 0 &&
        !other.isObserver &&
        other.respawnTimer <= 0 &&
        (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0) &&
        areCombatantsHostile('player', other.id)
      ) {
        const otherCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
        const toOther = otherCenter.clone().sub(eyePos);
        const dist = toOther.length();

        if (dist <= MELEE_SWORD_SLASH_REACH) {
          const toOtherDir = toOther.clone().normalize();
          const dot = cameraLookDir.dot(toOtherDir);
          const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

          if (angle <= 1.0) {
            if (isMultiplayer) {
              playSwing();
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
              state.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
              state.lastStrikeTick = 1.0;

              if (sendSync({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id })) {
                applyOutgoingMultiplayerHitLocally(other.id, 1);
              }
            } else {
              other.hp -= 1;
              playSwing();
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
              state.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
              state.lastStrikeTick = 1.0;

              if (other.hp <= 0) {
                other.hp = 0;
                other.respawnTimer = 3.0;
                state.scorePlayer += 1;
                state.playerKills += 1;
                other.deaths += 1;
                playDeath();

                const medals = evaluatePlayerKillMedals(other.id);
                const newDeath: DeathEvent = {
                  id: Math.random().toString(36).substring(2, 9),
                  attacker: state.settings.playerName || 'Blue (You)',
                  victim: other.playerName,
                  medals,
                  weapon: 'sword',
                };
                state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
                queueReplayHeatmapDeathEventsForState({
                  state,
                  attacker: createReplayHeatmapCombatantSource('player', undefined, {
                    team: state.localPlayerTeam,
                    pos: state.playerPos,
                  }),
                  victim: createReplayHeatmapCombatantSource(other.id, other),
                  weapon: 'sword',
                });
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
              }
            }
          }
        }
      }
    });
  }

  return false;
}
