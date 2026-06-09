import * as THREE from 'three';
import { recordCalibrationDodgeFailed } from '../../game/aiSkillCalibration';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type CustomMapData, type DeathEvent, type MedalInfo } from '../../types';
import { isVectorXZAtArenaBoundary } from './arenaBounds';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { adjustRangeForTargetModel } from './modelHitbox';
import { createReplayHeatmapCombatantSource, queueReplayHeatmapDeathEventsForState } from './replayHeatmapRuntime';
import {
  findPlayerSwordLungeHitTargetForState,
  finishPlayerSwordLungeRecoveryForState,
} from './playerWeaponActions';
import { type CombatTradeReason } from './tradeRuntime';
import { type GrifballRuntimeState } from './runtimeState';

export function updatePlayerSwordLungeForState({
  state,
  dt,
  isMultiplayer,
  activeCustomMap,
  multiplayerSocket,
  getMainAi,
  areCombatantsHostile,
  constrainCombatantToArena,
  renderSwordLungeTrailVfx,
  recordPlayerLungeEnd,
  recordPlayerCounterSuccess,
  recordPlayerDamageDealt,
  recordBotCalibrationDeath,
  evaluatePlayerKillMedals,
  executeTrade,
  applyOutgoingMultiplayerHitLocally,
  playExplosion,
  playDeath,
  playSwing,
  spawnVoxelShockwaveParticles,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  dt: number;
  isMultiplayer: boolean;
  activeCustomMap: CustomMapData | null;
  multiplayerSocket: WebSocket | null;
  getMainAi: () => Combatant | undefined;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
  renderSwordLungeTrailVfx: (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle?: SwordLungeCurrentTrailStyle
  ) => void;
  recordPlayerLungeEnd: (hit: boolean) => void;
  recordPlayerCounterSuccess: () => void;
  recordPlayerDamageDealt: (targetWasCountering: boolean) => void;
  recordBotCalibrationDeath: (botId: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  executeTrade: (reason: CombatTradeReason) => void;
  applyOutgoingMultiplayerHitLocally: (targetId: string, damage?: number) => void;
  playExplosion: () => void;
  playDeath: () => void;
  playSwing: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  pushStatsUpdate: () => void;
}): void {
  state.lungeTimer += dt;
  const lungeSpeed = state.settings.swordLungeSpeed ?? 24.0;
  state.playerVel.copy(state.lungeTargetDir).multiplyScalar(lungeSpeed);

  state.playerPos.x += state.playerVel.x * dt;
  state.playerPos.z += state.playerVel.z * dt;
  state.playerPos.y = 0;
  state.playerVel.y = 0;
  state.isJumping = false;
  state.pHammerJumpsInAir = 0;
  state.isCrouching = false;
  constrainCombatantToArena(state.playerPos, state.playerVel);

  const trailPos = state.playerPos.clone();
  trailPos.y += 0.5;
  renderSwordLungeTrailVfx(trailPos, '#22d3ee', state.lungeTargetDir, 'localCube');

  const { closestTarget, distance: dist } = findPlayerSwordLungeHitTargetForState({
    state,
    mainAi: getMainAi(),
    isMultiplayer,
    areCombatantsHostile,
  });

  if (!closestTarget) {
    finishPlayerSwordLungeRecoveryForState({
      state,
      hit: false,
      recordLungeEnd: recordPlayerLungeEnd,
    });
  } else if (dist <= adjustRangeForTargetModel(1.5, closestTarget.modelType)) {
    state.isLunging = false;
    recordPlayerLungeEnd(true);
    playExplosion();
    spawnVoxelShockwaveParticles(closestTarget.pos, '#22d3ee');
    state.lastStrikePos = closestTarget.pos.clone();
    state.lastStrikeTick = 1.2;

    if (state.isMultiplayer) {
      const other = state.otherPlayers.get(closestTarget.id);
      const swordThreshold = state.settings.swordTradeWindow ?? 350;
      const hammerThreshold = state.settings.hammerSwordTradeWindow ?? 350;

      const isOtherSwordActiveAttack = other && state.settings.enableSwordTrade && other.activeWeapon === 'sword' && (
        other.isLunging ||
        other.weaponState === 'swing_up' ||
        other.weaponState === 'swing_down' ||
        (other.lastSwordAttackTime && (Date.now() - other.lastSwordAttackTime <= swordThreshold))
      );
      const isOtherHammerActiveAttack = other && state.settings.enableHammerSwordTrade && other.activeWeapon === 'hammer' && (
        other.weaponState === 'swing_up' ||
        other.weaponState === 'swing_down' ||
        (other.lastHammerAttackTime && (Date.now() - other.lastHammerAttackTime <= hammerThreshold))
      );

      if (isOtherSwordActiveAttack || isOtherHammerActiveAttack) {
        state.playerHP = Math.max(0, state.playerHP - 1);
        playExplosion();
        playDeath();
        spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');

        if (state.playerHP <= 0) {
          state.playerHP = 0;
          state.playerRespawnTimer = 3.0;
          state.playerDeaths += 1;

          if (other) {
            other.score = (other.score || 0) + 1;
            other.kills = (other.kills || 0) + 1;
            if (other.id === MAIN_AI_ID) {
              state.scoreEnemy += 1;
              state.enemyKills += 1;
            }
          }

          const newDeath: DeathEvent = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: (other && other.playerName) || 'Player',
            victim: state.settings.playerName || 'Blue (You)',
            weapon: isOtherSwordActiveAttack ? 'sword_vs_sword' : 'sword_vs_hammer',
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          if (other) {
            queueReplayHeatmapDeathEventsForState({
              state,
              attacker: createReplayHeatmapCombatantSource(other.id, other),
              victim: createReplayHeatmapCombatantSource('player', undefined, {
                team: state.localPlayerTeam,
                pos: state.playerPos,
              }),
              weapon: isOtherSwordActiveAttack ? 'sword_vs_sword' : 'sword_vs_hammer',
            });
          }
        }

        if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
          multiplayerSocket.send(JSON.stringify({
            type: 'sync',
            action: 'hit_taken',
            damage: 1,
            targetId: closestTarget.id,
            weapon: state.activeWeapon,
          }));
          applyOutgoingMultiplayerHitLocally(closestTarget.id, 1);
        }

        pushStatsUpdate();
        return;
      }

      if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
        multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: closestTarget.id }));
        applyOutgoingMultiplayerHitLocally(closestTarget.id, 1);
      }
    } else if (closestTarget.id === MAIN_AI_ID) {
      const mainAi = getMainAi();
      if (mainAi) {
        const swordThreshold = state.settings.swordTradeWindow ?? 350;
        const hammerThreshold = state.settings.hammerSwordTradeWindow ?? 350;
        const isAISwordActiveAttack = state.settings.enableSwordTrade && mainAi.activeWeapon === 'sword' && (
          mainAi.aiState === 'LUNGING' ||
          mainAi.weaponState === 'swing_up' ||
          mainAi.weaponState === 'swing_down' ||
          (Date.now() - mainAi.lastSwordAttackTime <= swordThreshold)
        );
        const isAIHammerActiveAttack = state.settings.enableHammerSwordTrade && mainAi.activeWeapon === 'hammer' && (
          mainAi.weaponState === 'swing_up' ||
          mainAi.weaponState === 'swing_down' ||
          (Date.now() - mainAi.lastHammerAttackTime <= hammerThreshold)
        );

        if (isAISwordActiveAttack) {
          executeTrade('sword_vs_sword');
          recordPlayerCounterSuccess();
          return;
        } else if (isAIHammerActiveAttack) {
          executeTrade('sword_lunge_vs_hammer');
          recordPlayerCounterSuccess();
          return;
        }

        recordPlayerDamageDealt(isAISwordActiveAttack || isAIHammerActiveAttack);
        recordCalibrationDodgeFailed(
          state.aiMatchContext,
          MAIN_AI_ID,
          resolveBehaviorTuning(state.settings).calibrationWindowSize
        );
        mainAi.hp -= 1;
        if (mainAi.hp <= 0) {
          mainAi.hp = 0;
          mainAi.aiState = 'RESPAWNING';
          state.enemyRespawnTimer = 3.0;
          state.scorePlayer += 1;
          state.playerKills += 1;
          state.enemyDeaths += 1;
          recordBotCalibrationDeath(MAIN_AI_ID);
          playDeath();
          mainAi.weaponState = 'ready';
          mainAi.weaponTimer = 0;

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
            victim: createReplayHeatmapCombatantSource(MAIN_AI_ID, mainAi),
            weapon: 'sword',
          });
          spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');
        } else {
          playSwing();
        }
      }
    } else {
      const other = state.otherPlayers.get(closestTarget.id);
      if (other && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
        other.hp -= 1;
        if (other.hp <= 0) {
          other.hp = 0;
          other.respawnTimer = 3.0;
          state.scorePlayer += 1;
          state.playerKills += 1;
          other.deaths += 1;
          playDeath();

          const medals = evaluatePlayerKillMedals(closestTarget.id);
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
          spawnVoxelShockwaveParticles(closestTarget.pos, '#ef4444');
        } else {
          playSwing();
        }
      }
    }

    state.pSwordState = 'recovering';
    state.pSwordTimer = 0;
    state.pSwordReady = false;
    state.pSwordRecoverDuration = state.settings.swordLungeReload ?? 1.2;
    pushStatsUpdate();
  }

  const startDist = state.playerPos.distanceTo(state.lungeStartPos);
  if (startDist > 16.0 || state.lungeTimer > 0.8) {
    finishPlayerSwordLungeRecoveryForState({
      state,
      hit: false,
      recordLungeEnd: recordPlayerLungeEnd,
    });
  }

  const hitsBoundary = isVectorXZAtArenaBoundary({
    pos: state.playerPos,
    activeCustomMap,
    arenaRadius: state.arenaRadius,
  });

  if (hitsBoundary) {
    constrainCombatantToArena(state.playerPos, state.playerVel);
    finishPlayerSwordLungeRecoveryForState({
      state,
      hit: false,
      recordLungeEnd: recordPlayerLungeEnd,
    });
  }
}
