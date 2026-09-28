import { recordPlayerMeleeKillForState } from './playerMeleeDeathRuntime';
import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent, type MedalInfo } from '../../types';
import { MELEE_HAMMER_SWIPE_REACH } from './combatGeometry';
import { adjustRangeForTargetModel } from './modelHitbox';
import { createReplayHeatmapCombatantSource, queueReplayHeatmapDeathEventsForState } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';

type PlayerHammerMeleeHitSyncPayload = {
  type: 'sync';
  action: 'hit_taken';
  damage: 1;
  targetId: string;
};

export function applyPlayerHammerMeleeImpactForState({
  state,
  mainAI,
  isMultiplayer,
  areCombatantsHostile,
  sendSync,
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
  sendSync: (payload: PlayerHammerMeleeHitSyncPayload) => boolean;
  playSwing: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
}): void {
  if (state.playerHP <= 0) return;

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
    !mainAI.isObserver &&
    (mainAI.respawnTimer ?? 0) <= 0 &&
    mainAI.aiState !== 'RESPAWNING' &&
    (mainAI.invulnerabilityTimer ?? 0) <= 0 &&
    areCombatantsHostile('player', MAIN_AI_ID)
  ) {
    const enemyCenter = new THREE.Vector3(mainAI.pos.x, mainAI.pos.y + 0.825, mainAI.pos.z);
    const toEnemy = enemyCenter.clone().sub(eyePos);
    const dist = toEnemy.length();
    if (dist <= adjustRangeForTargetModel(MELEE_HAMMER_SWIPE_REACH, mainAI.modelType)) {
      const toEnemyDir = toEnemy.clone().normalize();
      const dot = cameraLookDir.dot(toEnemyDir);
      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

      if (angle <= 1.0) {
        mainAI.hp -= 1;
        playSwing();
        spawnVoxelShockwaveParticles(mainAI.pos, '#38bdf8');
        state.lastStrikePos = mainAI.pos.clone();
        state.lastStrikeTick = 1.0;

        if (mainAI.hp <= 0) {
          recordPlayerMeleeKillForState(state, mainAI, recordBotCalibrationDeath);
          playDeath();

          const medals = evaluatePlayerKillMedals(MAIN_AI_ID);
          const newDeath: DeathEvent = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: state.settings.playerName || 'Blue (You)',
            victim: 'Red (AI)',
            medals,
            weapon: 'hammer',
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          queueReplayHeatmapDeathEventsForState({
            state,
            attacker: createReplayHeatmapCombatantSource('player', undefined, {
              team: state.localPlayerTeam,
              pos: state.playerPos,
            }),
            victim: createReplayHeatmapCombatantSource(MAIN_AI_ID, mainAI),
            weapon: 'hammer',
          });
          spawnVoxelShockwaveParticles(mainAI.pos, '#ef4444');
        }
      }
    }
  }

  state.otherPlayers.forEach((other) => {
    // The legacy main-AI branch owns this actor, including sword trades.
    if (!isMultiplayer && mainAI && other.id === mainAI.id) return;
    if (
      other.hp > 0 &&
      other.aiState !== 'RESPAWNING' &&
      !other.isObserver &&
      other.respawnTimer <= 0 &&
      (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0) &&
      areCombatantsHostile('player', other.id)
    ) {
      const otherBodyCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
      const toOther = otherBodyCenter.clone().sub(eyePos);
      const dist = toOther.length();
      if (dist <= adjustRangeForTargetModel(MELEE_HAMMER_SWIPE_REACH, other.modelType)) {
        const toOtherDir = toOther.clone().normalize();
        const dot = cameraLookDir.dot(toOtherDir);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

        if (angle <= 1.0) {
          playSwing();
          spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#38bdf8');
          state.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
          state.lastStrikeTick = 1.0;

          if (isMultiplayer) {
            sendSync({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id });
          } else {
            other.hp -= 1;
            if (other.hp <= 0) {
              recordPlayerMeleeKillForState(state, other, recordBotCalibrationDeath);
              playDeath();

              const medals = evaluatePlayerKillMedals(other.id);
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: state.settings.playerName || 'Blue (You)',
                victim: other.playerName,
                medals,
                weapon: 'hammer',
              };
              state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
              queueReplayHeatmapDeathEventsForState({
                state,
                attacker: createReplayHeatmapCombatantSource('player', undefined, {
                  team: state.localPlayerTeam,
                  pos: state.playerPos,
                }),
                victim: createReplayHeatmapCombatantSource(other.id, other),
                weapon: 'hammer',
              });
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
            }
          }
        }
      }
    }
  });
}
