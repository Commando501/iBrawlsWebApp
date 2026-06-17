import * as THREE from 'three';
import { MAIN_AI_ID, isAICombatReady } from '../../game/roster';
import { resolvePunchLungeDistance } from '../../game/runnerBallSettings';
import { getForwardHeadingForYaw } from '../../game/yaw';
import { getCombatBodyCenter, SWORD_SLASH_FORWARD_FACTOR, SWORD_SLASH_RADIUS } from './combatGeometry';
import { adjustRangeForTargetModel } from './modelHitbox';
import { recordBotDamageTagForState } from './aiBookkeeping';
import { recordDeathEvent as recordDeathEventOnState } from './deathFeed';
import { areGrifballCombatantsHostileForState } from './grifballObjectiveRuntime';
import {
  observePlayerDamageDealt,
  observePlayerDamageReceived,
  recordCombatantModelObservation,
  recordLocalPlayerDamageTakenObservation,
} from './playerModelObservations';
import { createReplayHeatmapCombatantSource } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';

export function applyBotMeleeImpactForState({
  state,
  botId,
  renderHammerSplashVfx,
  spawnVoxelShockwaveParticles,
  playExplosion,
  playDeath,
  playSwing,
  recordBotPsychKill,
  recordBotCalibrationDeath,
}: {
  state: GrifballRuntimeState;
  botId: string;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  playExplosion: () => void;
  playDeath: () => void;
  playSwing: () => void;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotCalibrationDeath: (botId: string) => void;
}): void {
  if (state.isMultiplayer) return;
  const bot = state.otherPlayers?.get(botId);
  if (!bot || bot.hp <= 0 || (bot.respawnTimer ?? 0) > 0) return;

  const weapon = bot.activeWeapon === 'sword' ? 'sword' : (bot.activeWeapon === 'ball' ? 'ball' : 'hammer');
  const isHammer = weapon === 'hammer';
  const isBall = weapon === 'ball';
  const forward = isBall
    ? resolvePunchLungeDistance(state.settings)
    : (isHammer
      ? (state.settings.attackRange ?? 3.2)
      : (state.settings.attackRange ?? 3.2) * SWORD_SLASH_FORWARD_FACTOR);
  const radius = isBall
    ? 1.5
    : (isHammer ? (state.settings.attackRadius ?? 4.5) : SWORD_SLASH_RADIUS);

  const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.2, bot.pos.z);
  const forwardHeading = getForwardHeadingForYaw(bot.yaw);
  const heading = new THREE.Vector3(forwardHeading.x, 0, forwardHeading.z);
  if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1);
  heading.normalize();
  const impactPos = eye.clone().addScaledVector(heading, forward);

  if (isHammer) {
    renderHammerSplashVfx(impactPos, '#f97316', radius);
  } else if (isBall) {
    spawnVoxelShockwaveParticles(impactPos, '#7dd3fc'); // cyan shockwave for punch!
  } else {
    spawnVoxelShockwaveParticles(impactPos, '#ef4444');
  }
  playExplosion();

  const creditKill = (
    victimId: string,
    victimName: string,
    victimSource: ReturnType<typeof createReplayHeatmapCombatantSource>
  ) => {
    bot.score = (bot.score || 0) + 1;
    bot.kills = (bot.kills || 0) + 1;
    if (bot.id === MAIN_AI_ID) {
      state.scoreEnemy += 1;
      state.enemyKills += 1;
    }
    playDeath();
    recordDeathEventOnState(state, bot.playerName, victimName, undefined, weapon === 'ball' ? 'hammer' : weapon, {
      attacker: createReplayHeatmapCombatantSource(botId, bot),
      victim: victimSource,
    });
    recordBotPsychKill(botId, victimId, false);
  };

  if (
    !state.isObserverMode &&
    state.playerHP > 0 &&
    state.playerRespawnTimer <= 0 &&
    state.playerInvulnerabilityTimer <= 0 &&
    areGrifballCombatantsHostileForState(state, botId, 'player') &&
    impactPos.distanceTo(getCombatBodyCenter(state.playerPos, state.isCrouching)) <=
      adjustRangeForTargetModel(radius, state.playerModelType)
  ) {
    recordLocalPlayerDamageTakenObservation(state);
    recordCombatantModelObservation(state, botId, (model) => observePlayerDamageDealt(model));
    state.playerHP -= 1;
    spawnVoxelShockwaveParticles(state.playerPos, '#ef4444');
    if (state.playerHP <= 0) {
      state.playerHP = 0;
      state.playerRespawnTimer = 3.0;
      state.playerDeaths += 1;
      state.pWeaponState = 'ready'; state.pWeaponTimer = 0; state.pWeaponReady = true;
      state.pSwordState = 'ready'; state.pSwordTimer = 0; state.pSwordReady = true;
      state.isLunging = false; state.lungeTimer = 0;
      creditKill('player', state.settings.playerName || 'Blue (You)', createReplayHeatmapCombatantSource('player', undefined, {
        team: state.localPlayerTeam,
        pos: state.playerPos,
      }));
    } else {
      playSwing();
      recordBotDamageTagForState({ state, botId, targetId: 'player', isMultiplayer: state.isMultiplayer });
    }
  }

  state.otherPlayers.forEach((other, otherId) => {
    if (otherId === botId) return;
    if (other.controller !== 'ai') return;
    if (!isAICombatReady(other)) return;
    if (!areGrifballCombatantsHostileForState(state, botId, otherId)) return;
    const otherPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
    if (
      impactPos.distanceTo(getCombatBodyCenter(otherPos, other.isCrouching || false)) >
      adjustRangeForTargetModel(radius, other.modelType)
    ) return;
    other.hp -= 1;
    recordCombatantModelObservation(state, botId, (model) => observePlayerDamageDealt(model));
    recordCombatantModelObservation(state, otherId, (model) => observePlayerDamageReceived(model));
    spawnVoxelShockwaveParticles(otherPos, '#ef4444');
    if (other.hp <= 0) {
      other.hp = 0;
      other.respawnTimer = 3.0;
      if (other.controller === 'ai') {
        other.aiState = 'RESPAWNING';
        other.weaponState = 'ready';
        other.weaponTimer = 0;
        if (other.id === MAIN_AI_ID) {
          state.enemyDeaths += 1;
          recordBotCalibrationDeath(other.id);
        } else {
          other.deaths = (other.deaths || 0) + 1;
        }
      } else {
        other.deaths = (other.deaths || 0) + 1;
      }
      creditKill(otherId, other.playerName, createReplayHeatmapCombatantSource(otherId, other));
    } else {
      playSwing();
      recordBotDamageTagForState({ state, botId, targetId: otherId, isMultiplayer: state.isMultiplayer });
    }
  });
}
