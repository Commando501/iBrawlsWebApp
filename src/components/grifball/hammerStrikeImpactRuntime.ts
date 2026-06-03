import * as THREE from 'three';
import { ballAsHammer } from '../../game/weaponCompat';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent, type MedalInfo } from '../../types';
import { getCombatBodyCenter } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type EnemyAITarget } from './targetSelection';

type HammerStrikeSyncPayload =
  | {
      type: 'sync';
      action: 'hammer_impact';
      pos: { x: number; y: number; z: number };
      radius: number;
    }
  | {
      type: 'sync';
      action: 'hit_taken';
      damage: 1;
      targetId: string;
    };

export function applyHammerStrikeImpactForState({
  state,
  isPlayerStriking,
  mainAI,
  getEnemyAITarget,
  isMultiplayer,
  areCombatantsHostile,
  sendSync,
  applyOutgoingMultiplayerHitLocally,
  renderHammerSplashVfx,
  spawnVoxelShockwaveParticles,
  evaluatePlayerKillMedals,
  recordBotCalibrationDeath,
  recordPlayerDamageTaken,
  tryRecordCalibrationCounterSuccess,
  recordBotPsychKill,
  recordBotDamageTag,
  tryEnterPressureState,
  tryStartComboOnHit,
  playExplosion,
  playSwing,
  playDeath,
  playJump,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  isPlayerStriking: boolean;
  mainAI: Combatant | undefined;
  getEnemyAITarget: () => EnemyAITarget | null;
  isMultiplayer: boolean;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  sendSync: (payload: HammerStrikeSyncPayload) => boolean;
  applyOutgoingMultiplayerHitLocally: (targetId: string, damage?: number) => void;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
  recordPlayerDamageTaken: () => void;
  tryRecordCalibrationCounterSuccess: (botId: string) => void;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotDamageTag: (botId: string, targetId: string) => void;
  tryEnterPressureState: (botId: string, targetId: string, targetHp: number, targetInvuln: number) => boolean;
  tryStartComboOnHit: (
    botId: string,
    targetId: string,
    openingWeapon: 'hammer' | 'sword',
    opts?: { targetRecovering?: boolean }
  ) => void;
  playExplosion: () => void;
  playSwing: () => void;
  playDeath: () => void;
  playJump: () => void;
  pushStatsUpdate: () => void;
}): void {
  playExplosion();

  if (isPlayerStriking) {
    if (state.playerHP <= 0) return;

    const eyePos = new THREE.Vector3(
      state.playerPos.x,
      1.65 - state.crouchAmount + state.playerPos.y,
      state.playerPos.z
    );

    const lookHeading = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
      .normalize();

    const impactPos = eyePos.clone().addScaledVector(lookHeading, state.settings.attackRange);

    state.lastStrikePos = impactPos;
    state.lastStrikeTick = 1.5;

    if (state.activeWeapon === 'hammer') {
      const distToBase = impactPos.distanceTo(state.playerPos);
      if (distToBase <= (state.settings.hammerJumpTriggerRadius ?? 3.5)) {
        state.pHammerJumpWindowTimer = state.settings.hammerJumpWindow ?? 0.6;
      }
    }

    const impactRadius = state.settings.attackRadius ?? 4.5;
    renderHammerSplashVfx(impactPos, '#38bdf8', impactRadius);

    if (state.isMultiplayer) {
      sendSync({
        type: 'sync',
        action: 'hammer_impact',
        pos: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
        radius: impactRadius,
      });
    }

    if (
      !isMultiplayer &&
      mainAI &&
      mainAI.hp > 0 &&
      mainAI.aiState !== 'RESPAWNING' &&
      (mainAI.invulnerabilityTimer ?? 0) <= 0 &&
      areCombatantsHostile('player', MAIN_AI_ID)
    ) {
      const enemyBodyCenter = new THREE.Vector3(mainAI.pos.x, mainAI.pos.y + 0.825, mainAI.pos.z);
      const dist = impactPos.distanceTo(enemyBodyCenter);

      if (dist <= state.settings.attackRadius) {
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
            weapon: state.activeWeapon as DeathEvent['weapon'],
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
          spawnVoxelShockwaveParticles(mainAI.pos, '#ef4444');
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
        const dist = impactPos.distanceTo(otherBodyCenter);

        if (dist <= state.settings.attackRadius) {
          if (isMultiplayer) {
            playSwing();
            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
            state.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
            state.lastStrikeTick = 1.0;

            const sent = sendSync({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id });
            if (sent) {
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
                weapon: state.activeWeapon as DeathEvent['weapon'],
              };
              state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
            }
          }
        }
      }
    });
    return;
  }

  if (isMultiplayer) return;
  if (!mainAI) return;
  if (mainAI.hp <= 0 || mainAI.aiState === 'RESPAWNING') return;

  const target = getEnemyAITarget();
  if (!target) return;

  const aiEyePos = new THREE.Vector3(mainAI.pos.x, mainAI.pos.y + 1.2, mainAI.pos.z);
  const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);

  let aiHeading3D: THREE.Vector3;
  if (mainAI.hammerJumpPlanned) {
    aiHeading3D = new THREE.Vector3(0, -1, 0);
  } else {
    aiHeading3D = targetBodyCenter.clone().sub(aiEyePos).normalize();
  }

  const impactPos = aiEyePos.clone().addScaledVector(aiHeading3D, state.settings.attackRange * 0.875);

  state.lastAIStrikePos = impactPos;
  state.lastAIStrikeTick = 1.5;

  const distToBase = impactPos.distanceTo(mainAI.pos);
  if (distToBase <= (state.settings.hammerJumpTriggerRadius ?? 3.5)) {
    mainAI.hammerJumpWindowTimer = state.settings.hammerJumpWindow ?? 0.6;
    const limit = state.settings.hammerJumpAirLimit ?? 1;
    const withinLimit = limit === 10 || (mainAI.aiHammerJumpsInAir ?? 0) < limit;

    if (mainAI.hammerJumpPlanned && limit > 0 && withinLimit) {
      mainAI.isJumping = true;
      mainAI.vel.y = 7.2 + (state.settings.hammerJumpPower ?? 6.5);
      mainAI.aiHammerJumpsInAir = (mainAI.aiHammerJumpsInAir ?? 0) + 1;
      playJump();
      spawnVoxelShockwaveParticles(mainAI.pos, '#f59e0b');
    }
  }
  mainAI.hammerJumpPlanned = false;
  mainAI.hammerJumpType = undefined;

  renderHammerSplashVfx(impactPos, '#f97316', state.settings.attackRadius ?? 4.5);

  if (target.hp > 0 && target.invuln <= 0 && areCombatantsHostile(MAIN_AI_ID, target.id)) {
    const dist = impactPos.distanceTo(targetBodyCenter);

    if (dist <= state.settings.attackRadius) {
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
            attacker: 'Red (AI)',
            victim: 'Blue (You)',
            weapon: ballAsHammer(mainAI.activeWeapon),
          };
          state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);

          spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');
          recordBotPsychKill(MAIN_AI_ID, 'player', false);
        } else {
          playSwing();
          spawnVoxelShockwaveParticles(state.playerPos, '#e2e8f0');
          recordBotDamageTag(MAIN_AI_ID, 'player');
          tryEnterPressureState(MAIN_AI_ID, 'player', state.playerHP, state.playerInvulnerabilityTimer);
          tryStartComboOnHit(MAIN_AI_ID, 'player', ballAsHammer(mainAI.activeWeapon));
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
              attacker: 'Red (AI)',
              victim: other.playerName,
              weapon: ballAsHammer(mainAI.activeWeapon),
            };
            state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
            recordBotPsychKill(MAIN_AI_ID, target.id, false);
          } else {
            playSwing();
            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
            recordBotDamageTag(MAIN_AI_ID, target.id);
            tryEnterPressureState(MAIN_AI_ID, target.id, other.hp, other.invulnerabilityTimer || 0);
            tryStartComboOnHit(MAIN_AI_ID, target.id, ballAsHammer(mainAI.activeWeapon));
          }
          pushStatsUpdate();
        }
      }
    }
  }
}
