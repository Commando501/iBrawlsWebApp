import { recordPlayerMeleeKillForState } from './playerMeleeDeathRuntime';
import { executePlayerCombatantTradeForState, resolveSwordLungeTradeReasonForState } from './tradeRuntime';
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
  if (!state.isLunging) return;
  if (state.playerHP <= 0 || state.playerRespawnTimer > 0 || state.isObserverMode) {
    finishPlayerSwordLungeRecoveryForState({ state, hit: false, recordLungeEnd: recordPlayerLungeEnd });
    return;
  }
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
    return;
  } else if (dist <= adjustRangeForTargetModel(1.5, closestTarget.modelType)) {
    const finishHit = () => finishPlayerSwordLungeRecoveryForState({ state, hit: true, recordLungeEnd: recordPlayerLungeEnd });
    playExplosion();
    spawnVoxelShockwaveParticles(closestTarget.pos, '#22d3ee');
    state.lastStrikePos = closestTarget.pos.clone();
    state.lastStrikeTick = 1.2;

    if (state.isMultiplayer) {
      const other = state.otherPlayers.get(closestTarget.id);
      const reason = resolveSwordLungeTradeReasonForState({ state, target: closestTarget, mainAi: other });
      const isOtherSwordActiveAttack = reason === 'sword_vs_sword';
      const isOtherHammerActiveAttack = reason === 'sword_lunge_vs_hammer';

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

        finishHit();
        pushStatsUpdate();
        return;
      }

      if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
        multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: closestTarget.id }));
        applyOutgoingMultiplayerHitLocally(closestTarget.id, 1);
      }
    } else {
      const mainAi = getMainAi();
      const other = closestTarget.id === MAIN_AI_ID ? mainAi ?? state.otherPlayers.get(MAIN_AI_ID)
        : state.otherPlayers.get(closestTarget.id);
      if (other) {
        const reason = resolveSwordLungeTradeReasonForState({ state, target: closestTarget, mainAi: other });
        if (reason) {
          if (mainAi && closestTarget.id === MAIN_AI_ID) executeTrade(reason);
          else executePlayerCombatantTradeForState({ state, combatant: other, reason, evaluatePlayerKillMedals,
            recordBotCalibrationDeath, playExplosion, playDeath, spawnVoxelShockwaveParticles, pushStatsUpdate });
          recordPlayerCounterSuccess();
          finishHit();
          return;
        }

        recordPlayerDamageDealt(false);
        if (other.id === MAIN_AI_ID) recordCalibrationDodgeFailed(
          state.aiMatchContext, MAIN_AI_ID, resolveBehaviorTuning(state.settings).calibrationWindowSize
        );
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
            weapon: 'sword',
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          queueReplayHeatmapDeathEventsForState({
            state,
            attacker: createReplayHeatmapCombatantSource('player', undefined, {
              team: state.localPlayerTeam, pos: state.playerPos,
            }),
            victim: createReplayHeatmapCombatantSource(other.id, other),
            weapon: 'sword',
          });
          spawnVoxelShockwaveParticles(other.pos, '#ef4444');
        } else playSwing();
      }
    }

    finishHit();
    pushStatsUpdate();
    return;
  }

  const startDist = state.playerPos.distanceTo(state.lungeStartPos);
  if (startDist > 16.0 || state.lungeTimer > 0.8) {
    finishPlayerSwordLungeRecoveryForState({
      state,
      hit: false,
      recordLungeEnd: recordPlayerLungeEnd,
    });
    return;
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
