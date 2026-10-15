import { isOnlineGrifballAuthority } from './onlineGrifballRuntime';
import { prepareIronVanguardBallVisuals, finishIronVanguardBallVisuals } from "./ironVanguardBallRuntime";
import * as THREE from 'three';
import { type ReplayFile } from '../../types';
import {
  buildGrifbSecretSyncPayload,
  unlockLocalGrifbSecretForState,
} from './grifbSecretRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { updateTransientVfxForFrame } from './vfxRuntime';

import { reconcileGrifballCarrierForState } from './grifballObjectiveRuntime';

type MutableRef<T> = { current: T };

export function advanceGrifballFrameForState({
  state,
  refs,
  ballMeshRef,
  ballChargingRef,
  ballChargeTimerRef,
  dt,
  isPlaying,
  isPausedRef,
  replayData,
  keysPressed,
  grifbHoldTimerRef,
  secretAudioRef,
  isMultiplayer,
  multiplayerRole,
  multiplayerSocket,
  replayRecordingRef,
  replayRecordingElapsedTimeRef,
  lastRecordTimeRef,
  spawnVoxelShockwaveParticles,
  rebuildHostModel,
  updatePhysics,
  updateHammerAnimations,
  runAIOrchestrator,
  updateAI,
  updateGrifball,
  updateCharacterSkeletalAnimations,
  updateMatchTimers,
  enforceArenaBounds,
  renderGame,
  updateFloatingNameplate,
  pushStatsUpdate,
  updateRadarDOM,
  runReplayPlaybackLoop,
  recordReplayFrame,
  playRespawn,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  ballMeshRef: MutableRef<THREE.Mesh | null>;
  ballChargingRef: MutableRef<boolean>;
  ballChargeTimerRef: MutableRef<number>;
  dt: number;
  isPlaying: boolean;
  isPausedRef: MutableRef<boolean>;
  replayData: ReplayFile | null;
  keysPressed: MutableRef<Record<string, boolean>>;
  grifbHoldTimerRef: MutableRef<number>;
  secretAudioRef: MutableRef<HTMLAudioElement | null>;
  isMultiplayer: boolean;
  multiplayerRole: 'host' | 'client' | 'observer' | null | undefined;
  multiplayerSocket: WebSocket | null | undefined;
  replayRecordingRef: MutableRef<ReplayFile | null>;
  replayRecordingElapsedTimeRef: MutableRef<number>;
  lastRecordTimeRef: MutableRef<number>;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  rebuildHostModel: (hue: number) => void;
  updatePhysics: (dt: number) => void;
  updateHammerAnimations: (dt: number) => void;
  runAIOrchestrator: (dt: number) => void;
  updateAI: (dt: number) => void;
  updateGrifball: (dt: number) => void;
  updateCharacterSkeletalAnimations: (dt: number) => void;
  updateMatchTimers: (dt: number) => void;
  enforceArenaBounds: (dt: number) => void;
  renderGame: () => void;
  updateFloatingNameplate: () => void;
  pushStatsUpdate: () => void;
  updateRadarDOM: () => void;
  runReplayPlaybackLoop: (dt: number) => void;
  recordReplayFrame: (time: number) => void;
  playRespawn: () => void;
}): void {
  const requiredKeys = ['g', 'r', 'i', 'f', 'b'];
  const activeKeys = Object.keys(keysPressed.current).filter(k => keysPressed.current[k]);
  const isHoldingOnlyGRIFB = activeKeys.length === 5 && requiredKeys.every(k => activeKeys.includes(k));

  if (isHoldingOnlyGRIFB && state.playerHP > 0 && isPlaying && !isPausedRef.current) {
    grifbHoldTimerRef.current += dt;
    if (grifbHoldTimerRef.current >= 2.0) {
      grifbHoldTimerRef.current = 0;
      requiredKeys.forEach(k => { keysPressed.current[k] = false; });

      if (state.activeWeapon !== 'pistol') {
        unlockLocalGrifbSecretForState({
          state,
          refs,
          secretAudioRef,
          spawnVoxelShockwaveParticles,
          playRespawn,
          pushStatsUpdate,
        });

        if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
          multiplayerSocket.send(JSON.stringify(buildGrifbSecretSyncPayload(state)));
        }
      }
    }
  } else {
    grifbHoldTimerRef.current = 0;
  }

  if (refs.skyboxMesh) {
    refs.skyboxMesh.rotation.y += dt * 0.004;
  }

  if (state.isObserverMode && !refs.hostGroup && !replayData) {
    rebuildHostModel(state.hostHue);
  }

  if (replayData) {
    runReplayPlaybackLoop(dt);
    return;
  }

  let currentReplayRecordTime: number | null = null;
  if (replayRecordingRef.current) {
    replayRecordingElapsedTimeRef.current += dt;
    currentReplayRecordTime = replayRecordingElapsedTimeRef.current;
    state.replayHeatmapRecordingActive = true;
    state.replayHeatmapElapsedTime = currentReplayRecordTime;
  } else {
    state.replayHeatmapRecordingActive = false;
  }

  updatePhysics(dt);
  updateHammerAnimations(dt);
  if (!isMultiplayer) {
    runAIOrchestrator(dt);
  }
  updateAI(dt);
  updateGrifball(dt);
  prepareIronVanguardBallVisuals(state, refs, ballMeshRef.current, dt);
  updateCharacterSkeletalAnimations(dt);
  updateTransientVfxForFrame(refs, dt);
  updateMatchTimers(dt);
  enforceArenaBounds(dt);
  // Skeletal melee impacts can kill a carrier after the objective has already advanced.
  // Repair ownership once all combat/bounds work is done, before rendering and recording.
  if (!isMultiplayer || isOnlineGrifballAuthority(state)) reconcileGrifballCarrierForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef });

  finishIronVanguardBallVisuals(state, refs, ballMeshRef.current, dt);
  renderGame();
  updateFloatingNameplate();
  pushStatsUpdate();
  updateRadarDOM();

  if (isMultiplayer && multiplayerRole !== 'observer' && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
    multiplayerSocket.send(JSON.stringify({
      type: 'sync',
      spawnSlot: state.multiplayerSpawnSlot,
      pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z },
      vel: { x: state.playerVel.x, y: state.playerVel.y, z: state.playerVel.z },
      yaw: state.yaw,
      pitch: state.pitch,
      hp: state.playerHP,
      maxHp: state.playerMaxHP,
      isCrouching: state.isCrouching,
      isJumping: state.isJumping,
      isSprinting: state.playerIsSprinting,
      isSliding: state.playerSlideActive,
      isLunging: state.isLunging,
      swordLungeHit: state.swordLungeHit,
      lungeTimer: state.lungeTimer,
      activeWeapon: state.activeWeapon,
      respawnTimer: state.playerRespawnTimer,
      invulnerabilityTimer: state.playerInvulnerabilityTimer,
      hue: state.settings.playerHue,
      playerName: state.settings.playerName,
      ...(multiplayerRole === 'host' ? {
        scoreHost: state.scorePlayer,
        scoreClient: state.scoreEnemy,
        killsHost: state.playerKills,
        deathsHost: state.playerDeaths,
        killsClient: state.enemyKills,
        deathsClient: state.enemyDeaths,
        gameTime: state.gameTime,
      } : {
        clientHP: state.playerHP,
      }),
    }));
  }

  if (replayRecordingRef.current && currentReplayRecordTime !== null) {
    if (currentReplayRecordTime - lastRecordTimeRef.current >= 0.05) {
      lastRecordTimeRef.current = currentReplayRecordTime;
      recordReplayFrame(currentReplayRecordTime);
    }
  }
}
