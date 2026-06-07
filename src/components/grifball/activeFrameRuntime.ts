import * as THREE from 'three';
import {
  type DeathEvent,
  type ReplayFile,
} from '../../types';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { updateTransientVfxForFrame } from './vfxRuntime';

type MutableRef<T> = { current: T };

export function advanceGrifballFrameForState({
  state,
  refs,
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
        state.activeWeapon = 'pistol';

        if (refs.playerHammer) refs.playerHammer.visible = false;
        if (refs.playerSword) refs.playerSword.visible = false;
        if (refs.playerPistol) refs.playerPistol.visible = true;

        spawnVoxelShockwaveParticles(state.playerPos, '#38bdf8');
        spawnVoxelShockwaveParticles(state.playerPos, '#fffa00');

        playRespawn();

        if (secretAudioRef.current) {
          secretAudioRef.current.pause();
        }
        const audio = new Audio('/Saudi Smurf Allah.mp3');
        audio.volume = 0.55;
        audio.play().catch(e => console.error('Error playing secret song:', e));
        secretAudioRef.current = audio;

        if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
          multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'unlock_secret' }));
        }

        const secretAnnouncement: DeathEvent = {
          id: Math.random().toString(36).substring(2, 9),
          attacker: 'SECRET',
          victim: 'UNLOCKED: GRIFB Pistol!',
          weapon: 'sword',
        };
        state.lastDeaths = [secretAnnouncement, ...state.lastDeaths].slice(0, 3);
        pushStatsUpdate();
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
  updateCharacterSkeletalAnimations(dt);
  updateTransientVfxForFrame(refs, dt);
  updateMatchTimers(dt);
  enforceArenaBounds(dt);

  renderGame();
  updateFloatingNameplate();
  pushStatsUpdate();
  updateRadarDOM();

  if (isMultiplayer && multiplayerRole !== 'observer' && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
    multiplayerSocket.send(JSON.stringify({
      type: 'sync',
      pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z },
      vel: { x: state.playerVel.x, y: state.playerVel.y, z: state.playerVel.z },
      yaw: state.yaw,
      pitch: state.pitch,
      hp: state.playerHP,
      maxHp: state.playerMaxHP,
      isCrouching: state.isCrouching,
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
