import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent, type MedalInfo } from '../../types';
import { MELEE_HAMMER_SWIPE_REACH } from './combatGeometry';
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
    mainAI.aiState !== 'RESPAWNING' &&
    (mainAI.invulnerabilityTimer ?? 0) <= 0 &&
    areCombatantsHostile('player', MAIN_AI_ID)
  ) {
    const enemyCenter = new THREE.Vector3(mainAI.pos.x, mainAI.pos.y + 0.825, mainAI.pos.z);
    const toEnemy = enemyCenter.clone().sub(eyePos);
    const dist = toEnemy.length();
    if (dist <= MELEE_HAMMER_SWIPE_REACH) {
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
            weapon: 'hammer',
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          spawnVoxelShockwaveParticles(mainAI.pos, '#ef4444');
        }
      }
    }
  }

  state.otherPlayers.forEach((other) => {
    if (
      other.hp > 0 &&
      !other.isObserver &&
      other.respawnTimer <= 0 &&
      (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0) &&
      areCombatantsHostile('player', other.id)
    ) {
      const otherBodyCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
      const toOther = otherBodyCenter.clone().sub(eyePos);
      const dist = toOther.length();
      if (dist <= MELEE_HAMMER_SWIPE_REACH) {
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
              other.hp = 0;
              other.respawnTimer = 3.0;
              if (other.controller === 'ai') {
                other.aiState = 'RESPAWNING';
                other.weaponState = 'ready';
                other.weaponTimer = 0;
              }
              state.scorePlayer += 1;
              state.playerKills += 1;
              if (other.id === MAIN_AI_ID) {
                state.enemyDeaths += 1;
                recordBotCalibrationDeath(MAIN_AI_ID);
              } else {
                other.deaths = (other.deaths || 0) + 1;
              }
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
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
            }
          }
        }
      }
    }
  });
}
