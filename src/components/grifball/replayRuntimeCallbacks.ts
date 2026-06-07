import * as THREE from 'three';
import {
  type CustomMapData,
  type GameStats,
  type Keybindings,
  type ReplayFile,
  type ReplayFrame,
  type UniversalSettings,
} from '../../types';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import {
  registerReplayPlaybackEventListenersForState,
  runReplayPlaybackLoopForState,
} from './replayPlaybackRuntime';
import {
  emitMatchTelemetryForState,
  initializeReplayRecordingForState,
  persistLocalPlayerFingerprintForState,
  recordReplayFrameForState,
  saveCompiledReplayForRefs,
} from './replayRecordingRuntime';
import { type LastRecordedReplayEntityState } from './runtimeRefs';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MutableRef<T> = { current: T };

type AnimateSpartanModel = (
  mesh: THREE.Group | null,
  vel: THREE.Vector3,
  yaw: number,
  hp: number,
  weaponState: string,
  weaponTimer: number,
  dt: number,
  isSliding?: boolean,
  isSprinting?: boolean
) => void;

type RenderSwordLungeTrailVfx = (
  trailPos: THREE.Vector3,
  color: string,
  direction?: THREE.Vector3,
  currentStyle?: SwordLungeCurrentTrailStyle
) => void;

export function createReplayRuntimeCallbacksForState({
  getState,
  getRefs,
  replayData,
  replayRecordingRef,
  lastRecordTimeRef,
  replayRecordingElapsedTimeRef,
  lastRecordedStateRef,
  replayTimeRef,
  replaySpeedRef,
  isReplayPausedRef,
  replayTargetIdRef,
  prevReplayFrameRef,
  lastReplayEventFrameIndexRef,
  replayPlayerIdsRef,
  keysPressed,
  getKeybindings,
  botColors,
  adminSettings,
  selectedMap,
  aiMatchSessionKey,
  opponentPlayerName,
  matchKillsToWin,
  isMultiplayer,
  getActiveCustomMap,
  animateSpartanModel,
  renderSwordLungeTrailVfx,
  updateBlinking,
  renderGame,
  spawnVoxelShockwaveParticles,
  renderHammerSplashVfx,
  onStatsUpdate,
  playDeath,
  playSwing,
  playRespawn,
  playDash,
  playExplosion,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  replayData: ReplayFile | null;
  replayRecordingRef: MutableRef<ReplayFile | null>;
  lastRecordTimeRef: MutableRef<number>;
  replayRecordingElapsedTimeRef: MutableRef<number>;
  lastRecordedStateRef: MutableRef<Map<string, LastRecordedReplayEntityState>>;
  replayTimeRef: MutableRef<number>;
  replaySpeedRef: MutableRef<number>;
  isReplayPausedRef: MutableRef<boolean>;
  replayTargetIdRef: MutableRef<string>;
  prevReplayFrameRef: MutableRef<ReplayFrame | null>;
  lastReplayEventFrameIndexRef: MutableRef<number | null>;
  replayPlayerIdsRef: MutableRef<string[]>;
  keysPressed: MutableRef<Record<string, boolean>>;
  getKeybindings: () => Keybindings;
  botColors: Record<string, number>;
  adminSettings: UniversalSettings;
  selectedMap: string;
  aiMatchSessionKey: string;
  opponentPlayerName: string;
  matchKillsToWin?: number;
  isMultiplayer: boolean;
  getActiveCustomMap: () => CustomMapData | null;
  animateSpartanModel: AnimateSpartanModel;
  renderSwordLungeTrailVfx: RenderSwordLungeTrailVfx;
  updateBlinking: (group: THREE.Group | null, active: boolean) => void;
  renderGame: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  onStatsUpdate: (stats: GameStats) => void;
  playDeath: () => void;
  playSwing: () => void;
  playRespawn: () => void;
  playDash: () => void;
  playExplosion: () => void;
}) {
  const initializeReplayRecording = () =>
    initializeReplayRecordingForState({
      state: getState(),
      replayData,
      replayRecordingRef,
      lastRecordTimeRef,
      replayRecordingElapsedTimeRef,
      lastRecordedStateRef,
      aiMatchSessionKey,
      opponentPlayerName,
      adminSettings,
      selectedMap,
      matchKillsToWin,
    });

  const registerReplayPlaybackEvents = () =>
    registerReplayPlaybackEventListenersForState({
      state: getState(),
      replayData,
      replayTimeRef,
      replaySpeedRef,
      isReplayPausedRef,
      replayTargetIdRef,
      prevReplayFrameRef,
      lastReplayEventFrameIndexRef,
    });

  const recordReplayFrame = (time: number) =>
    recordReplayFrameForState({
      state: getState(),
      time,
      replayRecordingRef,
      lastRecordedStateRef,
      isMultiplayer,
    });

  const saveCompiledReplay = async () => {
    await saveCompiledReplayForRefs({
      state: getState(),
      replayRecordingRef,
      replayRecordingElapsedTimeRef,
    });
  };

  const persistLocalPlayerFingerprint = () =>
    persistLocalPlayerFingerprintForState({
      state: getState(),
      replayActive: Boolean(replayData),
    });

  const emitMatchTelemetry = () =>
    emitMatchTelemetryForState({
      state: getState(),
      replayActive: Boolean(replayData),
      selectedMap,
      aiMatchSessionKey,
      durationSeconds: replayRecordingElapsedTimeRef.current ?? 0,
    });

  const runReplayPlaybackLoop = (dt: number) => {
    runReplayPlaybackLoopForState({
      state: getState(),
      refs: getRefs(),
      replayData,
      replayTimeRef,
      replaySpeedRef,
      isReplayPausedRef,
      replayTargetIdRef,
      prevReplayFrameRef,
      lastReplayEventFrameIndexRef,
      replayPlayerIdsRef,
      keysPressed,
      keybindings: getKeybindings(),
      botColors,
      adminSettings,
      dt,
      getActiveCustomMap,
      animateSpartanModel,
      renderSwordLungeTrailVfx,
      updateBlinking,
      renderGame,
      spawnVoxelShockwaveParticles,
      renderHammerSplashVfx,
      onStatsUpdate,
      playDeath,
      playSwing,
      playRespawn,
      playDash,
      playExplosion,
    });
  };

  return {
    initializeReplayRecording,
    registerReplayPlaybackEvents,
    recordReplayFrame,
    saveCompiledReplay,
    persistLocalPlayerFingerprint,
    emitMatchTelemetry,
    runReplayPlaybackLoop,
  };
}
