import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { resolvePunchCooldown } from '../../game/runnerBallSettings';
import { punchHitTargetForState } from './ballPunchRuntime';
import type { MedalInfo } from '../../types';
import { recordPlayerMeleeKillForState } from './playerMeleeDeathRuntime';
import { getLocalPlayerFeedName, recordDeathEvent } from './deathFeed';
import { createReplayHeatmapCombatantSource } from './replayHeatmapRuntime';
import { recordCombatantDamageDealtObservation, recordCombatantDamageReceivedObservation,
  recordCombatantCounterSuccessObservation } from './playerModelObservations';
import type { GrifballRuntimeState } from './runtimeState';

const activePunch = (phase: string | undefined) => phase === 'swing_up' || phase === 'swing_down';

export interface RunnerSwordClashEffects {
  playSwing?: () => void;
  playDeath?: () => void;
  spawnVoxelShockwaveParticles?: (pos: THREE.Vector3, color: string) => void;
  recordBotCalibrationDeath?: (id: string) => void;
  recordBotPsychKill?: (id: string, victimId: string, lunge: boolean) => void;
  evaluatePlayerKillMedals?: (id: string) => MedalInfo[];
  sendPunchHit?: (targetId: string) => void;
}

export function cancelSwordForRunnerPunch(state: GrifballRuntimeState, runnerId: string, swordId: string, swordContact = false): void {
  if (state.settings.gameMode !== 'grifball' || state.grifball.ball.state !== 'held'
    || state.grifball.ball.holderId !== runnerId) return;
  if (swordId === 'player') {
    if (state.activeWeapon !== 'sword' && !state.isLunging) return;
    if (!swordContact && !state.isLunging && state.pSwordState !== 'slashing') return;
    state.pSwordRecoverDuration = state.isLunging ? state.settings.swordLungeReload : state.settings.swordSlashReload;
    state.isLunging = false; state.lungeTimer = 0;
    state.pSwordState = 'recovering'; state.pSwordTimer = 0; state.pSwordReady = false;
    state.playerVel.x = state.playerVel.z = 0;
  } else {
    const sword = state.otherPlayers.get(swordId);
    if (!sword || sword.activeWeapon !== 'sword' && !sword.isLunging) return;
    if (!swordContact && !sword.isLunging && !activePunch(sword.weaponState)) return;
    const wasLunging = !!sword.isLunging;
    sword.isLunging = false; sword.lungeTimer = 0;
    sword.weaponState = 'recovering'; sword.weaponTimer = 0;
    sword.vel.x = sword.vel.z = 0;
    if (wasLunging) {
      sword.aiState = 'COOLDOWN'; sword.aiTimer = state.settings.swordLungeReload;
    }
  }
}

/** Only a current punch with reciprocal contact wins. Recovery/history never parries. */
export function canRunnerPunchClash(state: GrifballRuntimeState, runnerId: string, swordId: string): boolean {
  if (runnerId === swordId || state.settings.gameMode !== 'grifball' || state.grifball.ball.state !== 'held'
    || state.grifball.ball.holderId !== runnerId) return false;
  const runner = runnerId === 'player' ? undefined : state.otherPlayers.get(runnerId);
  const sword = swordId === 'player' ? undefined : state.otherPlayers.get(swordId);
  if (runnerId !== 'player' && !runner || swordId !== 'player' && !sword) return false;
  if ((runner ? runner.hp : state.playerHP) <= 0 || (sword ? sword.hp : state.playerHP) <= 0
    || (runner ? runner.respawnTimer : state.playerRespawnTimer) > 0
    || (sword ? sword.respawnTimer : state.playerRespawnTimer) > 0
    || (sword ? sword.invulnerabilityTimer ?? 0 : state.playerInvulnerabilityTimer) > 0) return false;
  if ((runner ? runner.activeWeapon : state.activeWeapon) !== 'ball'
    || !activePunch(runner ? runner.weaponState : state.pWeaponState)) return false;
  return punchHitTargetForState(state, runnerId) === swordId;
}

export function tryRunnerSwordClash(
  state: GrifballRuntimeState, swordId: string, runnerId: string, effects: RunnerSwordClashEffects = {}
): boolean {
  if (!canRunnerPunchClash(state, runnerId, swordId)) return false;
  cancelSwordForRunnerPunch(state, runnerId, swordId, true);
  // Remote runners own their punch damage. Cancel the local sword prediction and
  // let the runner's ordinary hit packet resolve its punch on the owning client.
  if (state.isMultiplayer && runnerId !== 'player') return true;
  const runner = state.otherPlayers.get(runnerId), sword = state.otherPlayers.get(swordId);
  if (runnerId === 'player') {
    state.pWeaponState = 'recovering'; state.pWeaponTimer = 0; state.pWeaponReady = false;
  } else if (runner) {
    runner.weaponState = 'recovering'; runner.weaponTimer = 0;
    runner.aiTimer = resolvePunchCooldown(state.settings);
  }
  recordCombatantDamageDealtObservation(state, runnerId);
  recordCombatantCounterSuccessObservation(state, runnerId);
  recordCombatantDamageReceivedObservation(state, swordId);
  effects.playSwing?.();
  const swordPos = sword?.pos ?? state.playerPos;
  effects.spawnVoxelShockwaveParticles?.(swordPos, '#7dd3fc');
  if (swordId === 'player') state.playerHP = Math.max(0, state.playerHP - 1);
  else if (sword) sword.hp = Math.max(0, sword.hp - 1);
  if (state.isMultiplayer) effects.sendPunchHit?.(swordId);
  if ((sword?.hp ?? state.playerHP) > 0) return true;
  const calibration = effects.recordBotCalibrationDeath ?? (() => {});
  if (runnerId === 'player' && sword) {
    recordPlayerMeleeKillForState(state, sword, calibration);
  } else {
    if (swordId === 'player') {
      state.playerDeaths++; state.playerRespawnTimer = 3;
      state.pSwordState = state.pWeaponState = 'ready';
      state.pSwordTimer = state.pWeaponTimer = 0;
      state.pSwordReady = state.pWeaponReady = true;
    } else if (sword) {
      sword.respawnTimer = 3; sword.deaths = (sword.deaths ?? 0) + 1;
      sword.weaponState = 'ready'; sword.weaponTimer = 0;
      if (sword.controller === 'ai') sword.aiState = 'RESPAWNING';
      if (swordId === MAIN_AI_ID) { state.enemyDeaths++; state.enemyRespawnTimer = 3; calibration(swordId); }
    }
    if (runner) {
      runner.kills = (runner.kills ?? 0) + 1; runner.score = (runner.score ?? 0) + 1;
      if (runnerId === MAIN_AI_ID) { state.enemyKills++; state.scoreEnemy++; }
      effects.recordBotPsychKill?.(runnerId, swordId, false);
    }
  }
  effects.playDeath?.();
  recordDeathEvent(state,
    runnerId === 'player' ? getLocalPlayerFeedName(state.settings.playerName, state.multiplayerRole) : runner!.playerName,
    swordId === 'player' ? getLocalPlayerFeedName(state.settings.playerName, state.multiplayerRole) : sword!.playerName,
    runnerId === 'player' ? effects.evaluatePlayerKillMedals?.(swordId) : undefined, 'hammer', {
      attacker: createReplayHeatmapCombatantSource(runnerId, runner, runnerId === 'player'
        ? { team: state.localPlayerTeam, pos: state.playerPos } : undefined),
      victim: createReplayHeatmapCombatantSource(swordId, sword, swordId === 'player'
        ? { team: state.localPlayerTeam, pos: state.playerPos } : undefined),
    });
  return true;
}
