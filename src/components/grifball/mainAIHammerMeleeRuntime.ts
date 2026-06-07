import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent } from '../../types';
import {
  getCombatBodyCenter,
  MELEE_EYE_HEIGHT,
  MELEE_HAMMER_SWIPE_REACH,
} from './combatGeometry';
import { createReplayHeatmapCombatantSource, queueReplayHeatmapDeathEventsForState } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type EnemyAITarget } from './targetSelection';

export function applyMainAIHammerMeleeImpactForState({
  state,
  mainAI,
  target,
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
}: {
  state: GrifballRuntimeState;
  mainAI: Combatant | undefined;
  target: EnemyAITarget | null;
  isMultiplayer: boolean;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  recordPlayerDamageTaken: () => void;
  tryRecordCalibrationCounterSuccess: (botId: string) => void;
  playSwing: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotDamageTag: (botId: string, targetId: string) => void;
  tryEnterPressureState: (botId: string, targetId: string, targetHp: number, targetInvuln: number) => boolean;
  tryStartComboOnHit: (
    botId: string,
    targetId: string,
    openingWeapon: 'hammer' | 'sword',
    opts?: { targetRecovering?: boolean }
  ) => void;
  pushStatsUpdate: () => void;
}): void {
  if (!mainAI) return;
  if (mainAI.hp <= 0 || mainAI.aiState === 'RESPAWNING') return;
  if (!target) return;

  const aiEyePos = new THREE.Vector3(mainAI.pos.x, mainAI.pos.y + MELEE_EYE_HEIGHT, mainAI.pos.z);
  const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
  const lookHeading = targetBodyCenter.clone().sub(aiEyePos).normalize();
  const vfxPos = aiEyePos.clone().addScaledVector(lookHeading, 1.0);

  state.lastAIStrikePos = vfxPos;
  state.lastAIStrikeTick = 1.0;

  playSwing();
  spawnVoxelShockwaveParticles(vfxPos, '#38bdf8');

  if (isMultiplayer) return;

  if (target.hp > 0 && target.invuln <= 0 && areCombatantsHostile(MAIN_AI_ID, target.id)) {
    const dist = aiEyePos.distanceTo(targetBodyCenter);

    if (dist <= MELEE_HAMMER_SWIPE_REACH) {
      if (target.id === 'player') {
        recordPlayerDamageTaken();
        tryRecordCalibrationCounterSuccess(MAIN_AI_ID);
        state.playerHP -= 1;
        if (state.playerHP <= 0) {
          state.playerHP = 0;
          state.playerRespawnTimer = 3.0;
          state.scoreEnemy += 1;
          state.playerDeaths += 1;
          state.enemyKills += 1;
          playDeath();
          state.pWeaponState = 'ready';
          state.pWeaponTimer = 0;
          state.pWeaponReady = true;
          state.pSwordState = 'ready';
          state.pSwordTimer = 0;
          state.pSwordReady = true;
          state.isLunging = false;
          state.lungeTimer = 0;

          const newDeath: DeathEvent = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: 'Red (AI) [Melee]',
            victim: 'Blue (You)',
            weapon: 'hammer',
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          queueReplayHeatmapDeathEventsForState({
            state,
            attacker: createReplayHeatmapCombatantSource(MAIN_AI_ID, mainAI),
            victim: createReplayHeatmapCombatantSource('player', undefined, {
              team: state.localPlayerTeam,
              pos: state.playerPos,
            }),
            weapon: 'hammer',
          });
          spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');
          recordBotPsychKill(MAIN_AI_ID, 'player', false);
        } else {
          playSwing();
          spawnVoxelShockwaveParticles(state.playerPos, '#e2e8f0');
          recordBotDamageTag(MAIN_AI_ID, 'player');
          tryEnterPressureState(MAIN_AI_ID, 'player', state.playerHP, state.playerInvulnerabilityTimer);
          tryStartComboOnHit(MAIN_AI_ID, 'player', 'hammer', { targetRecovering: true });
        }
      } else {
        const other = state.otherPlayers?.get(target.id);
        if (other && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
          other.hp -= 1;
          if (other.hp <= 0) {
            other.hp = 0;
            other.respawnTimer = 3.0;
            state.scoreEnemy += 1;
            state.enemyKills += 1;
            other.deaths = (other.deaths || 0) + 1;
            playDeath();

            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: 'Red (AI) [Melee]',
              victim: other.playerName,
              weapon: 'hammer',
            };
            state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
            queueReplayHeatmapDeathEventsForState({
              state,
              attacker: createReplayHeatmapCombatantSource(MAIN_AI_ID, mainAI),
              victim: createReplayHeatmapCombatantSource(target.id, other),
              weapon: 'hammer',
            });
            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
            recordBotPsychKill(MAIN_AI_ID, target.id, false);
          } else {
            playSwing();
            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
            recordBotDamageTag(MAIN_AI_ID, target.id);
            tryEnterPressureState(MAIN_AI_ID, target.id, other.hp, other.invulnerabilityTimer || 0);
            tryStartComboOnHit(MAIN_AI_ID, target.id, 'hammer', { targetRecovering: true });
          }
          pushStatsUpdate();
        }
      }
    }
  }
}
