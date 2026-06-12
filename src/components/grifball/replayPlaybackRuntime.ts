import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import {
  type CustomMapData,
  type GameStats,
  type Keybindings,
  type ReplayFile,
  type ReplayFrame,
  type UniversalSettings,
} from '../../types';
import {
  getCollisionResolvedCameraPos,
  type SwordLungeCurrentTrailStyle,
} from './combatGeometry';
import {
  getPrimaryGamepad,
  updateFreeObserverMovementForState,
} from './playerInputRuntime';
import { buildReplayPlaybackFrameSlice } from './replayHelpers';
import { updateReplayCombatantVisualsForFrame } from './replayPlaybackVisuals';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { updateTransientVfxForFrame } from './vfxRuntime';

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

type ReplayEntityState = NonNullable<ReplayFrame['player']> | NonNullable<ReplayFrame['ai']> | NonNullable<ReplayFrame['otherPlayers']>[number];
type ReplayPlaybackSoundEvent = 'death' | 'swing' | 'respawn' | 'dash' | 'explosion';

const MAX_REPLAY_EVENT_CATCH_UP_FRAMES = 8;

export type ReplayPlaybackEvent =
  | { type: 'sound'; sound: ReplayPlaybackSoundEvent }
  | { type: 'shockwave'; pos: THREE.Vector3; color: string }
  | { type: 'hammerSplash'; impactPos: THREE.Vector3; color: string; radius: number };

export interface ReplayEventFrameIndexesResult {
  frameIndexes: number[];
  nextLastReplayEventFrameIndex: number | null;
}

export function getReplayPlaybackEventFrameIndexes({
  currentFrameIndex,
  lastReplayEventFrameIndex,
  isPaused,
  dt,
  maxCatchUpFrames = MAX_REPLAY_EVENT_CATCH_UP_FRAMES,
}: {
  currentFrameIndex: number;
  lastReplayEventFrameIndex: number | null;
  isPaused: boolean;
  dt: number;
  maxCatchUpFrames?: number;
}): ReplayEventFrameIndexesResult {
  if (!Number.isFinite(currentFrameIndex)) {
    return { frameIndexes: [], nextLastReplayEventFrameIndex: lastReplayEventFrameIndex };
  }

  const normalizedCurrentFrameIndex = Math.max(0, Math.floor(currentFrameIndex));

  if (
    lastReplayEventFrameIndex === null ||
    isPaused ||
    dt <= 0 ||
    dt >= 0.2 ||
    normalizedCurrentFrameIndex <= lastReplayEventFrameIndex
  ) {
    return { frameIndexes: [], nextLastReplayEventFrameIndex: normalizedCurrentFrameIndex };
  }

  const catchUpLimit = Math.max(0, Math.floor(maxCatchUpFrames));
  if (catchUpLimit === 0) {
    return { frameIndexes: [], nextLastReplayEventFrameIndex: normalizedCurrentFrameIndex };
  }

  const firstFrameIndex = Math.max(
    lastReplayEventFrameIndex + 1,
    normalizedCurrentFrameIndex - catchUpLimit + 1
  );
  const frameIndexes: number[] = [];
  for (let frameIndex = firstFrameIndex; frameIndex <= normalizedCurrentFrameIndex; frameIndex++) {
    frameIndexes.push(frameIndex);
  }

  return { frameIndexes, nextLastReplayEventFrameIndex: normalizedCurrentFrameIndex };
}

function getReplayFrameEntityEntries(frame: ReplayFrame): { id: string; state: ReplayEntityState }[] {
  const entries = new Map<string, ReplayEntityState>();
  if (frame.player) entries.set('player', frame.player);
  frame.otherPlayers?.forEach(player => entries.set(player.id, player));
  if (frame.ai && !entries.has(MAIN_AI_ID)) entries.set(MAIN_AI_ID, frame.ai);
  return Array.from(entries.entries()).map(([id, state]) => ({ id, state }));
}

function findPreviousReplayEntityState(
  frames: ReplayFrame[],
  id: string,
  beforeFrameIndex: number
): ReplayEntityState | null {
  for (let i = beforeFrameIndex; i >= 0; i--) {
    const frame = frames[i];
    if (id === 'player' && frame.player) return frame.player;
    if (frame.otherPlayers) {
      const found = frame.otherPlayers.find(player => player.id === id);
      if (found) return found;
    }
    if (id === MAIN_AI_ID && frame.ai) return frame.ai;
  }
  return null;
}

function replayEntityPosToVector(state: ReplayEntityState): THREE.Vector3 {
  return new THREE.Vector3(state.pos.x, state.pos.y, state.pos.z);
}

function getReplayEntityEffectColor(id: string, state: ReplayEntityState, replayPlayerName: string): string {
  return id === 'player' || ('playerName' in state && state.playerName === replayPlayerName)
    ? '#38bdf8'
    : '#ef4444';
}

export function collectReplayPlaybackEventsForFrame({
  frames,
  frameIndex,
  replayPlayerName,
  attackRange,
  attackRadius,
}: {
  frames: ReplayFrame[];
  frameIndex: number;
  replayPlayerName: string;
  attackRange: number;
  attackRadius: number;
}): ReplayPlaybackEvent[] {
  const frame = frames[frameIndex];
  if (!frame) return [];

  const events: ReplayPlaybackEvent[] = [];
  getReplayFrameEntityEntries(frame).forEach(({ id, state }) => {
    const prevState = findPreviousReplayEntityState(frames, id, frameIndex - 1);
    if (!prevState) return;

    const pos = replayEntityPosToVector(state);

    if (state.hp < prevState.hp) {
      events.push({ type: 'shockwave', pos, color: '#ef4444' });
      if (state.hp <= 0) {
        events.push(
          { type: 'sound', sound: 'death' },
          { type: 'shockwave', pos, color: '#ef4444' },
          { type: 'shockwave', pos, color: '#ff4d4d' }
        );
      } else {
        events.push({ type: 'sound', sound: 'swing' });
      }
    }

    if (state.hp > 0 && prevState.hp <= 0) {
      events.push(
        { type: 'sound', sound: 'respawn' },
        { type: 'shockwave', pos, color: '#38bdf8' }
      );
    }

    if (state.weaponState !== 'ready' && prevState.weaponState === 'ready') {
      events.push({ type: 'sound', sound: 'swing' });
    }

    if (Boolean(state.isLunging) && !prevState.isLunging) {
      events.push({ type: 'sound', sound: 'dash' });
    }

    if (Boolean(state.isDashing) && !prevState.isDashing) {
      events.push({ type: 'sound', sound: 'dash' });
    }

    const wasSwingingDown = prevState.weaponState === 'swing_down' || prevState.weaponState === 'melee_swing';
    const isSwingingDownNow = state.weaponState === 'swing_down' || state.weaponState === 'melee_swing';
    if (wasSwingingDown && !isSwingingDownNow && state.activeWeapon === 'hammer' && prevState.activeWeapon === 'hammer') {
      const eyeHeight = 1.65 - (state.isCrouching ? 0.72 : 0);
      const eyePos = new THREE.Vector3(pos.x, eyeHeight + pos.y, pos.z);
      const lookHeading = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch || 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
        .normalize();
      events.push(
        { type: 'sound', sound: 'explosion' },
        {
          type: 'hammerSplash',
          impactPos: eyePos.clone().addScaledVector(lookHeading, attackRange),
          color: getReplayEntityEffectColor(id, state, replayPlayerName),
          radius: attackRadius,
        }
      );
    }
  });

  return events;
}

function emitReplayPlaybackEvents({
  events,
  spawnVoxelShockwaveParticles,
  renderHammerSplashVfx,
  playDeath,
  playSwing,
  playRespawn,
  playDash,
  playExplosion,
}: {
  events: ReplayPlaybackEvent[];
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  playDeath: () => void;
  playSwing: () => void;
  playRespawn: () => void;
  playDash: () => void;
  playExplosion: () => void;
}): void {
  events.forEach(event => {
    if (event.type === 'shockwave') {
      spawnVoxelShockwaveParticles(event.pos, event.color);
      return;
    }

    if (event.type === 'hammerSplash') {
      renderHammerSplashVfx(event.impactPos, event.color, event.radius);
      return;
    }

    if (event.sound === 'death') playDeath();
    if (event.sound === 'swing') playSwing();
    if (event.sound === 'respawn') playRespawn();
    if (event.sound === 'dash') playDash();
    if (event.sound === 'explosion') playExplosion();
  });
}

export function registerReplayPlaybackEventListenersForState({
  state,
  replayData,
  replayTimeRef,
  replaySpeedRef,
  isReplayPausedRef,
  replayTargetIdRef,
  prevReplayFrameRef,
  lastReplayEventFrameIndexRef,
}: {
  state: GrifballRuntimeState;
  replayData: ReplayFile | null;
  replayTimeRef: MutableRef<number>;
  replaySpeedRef: MutableRef<number>;
  isReplayPausedRef: MutableRef<boolean>;
  replayTargetIdRef: MutableRef<string>;
  prevReplayFrameRef: MutableRef<ReplayFrame | null>;
  lastReplayEventFrameIndexRef: MutableRef<number | null>;
}): () => void {
  if (!replayData) return () => {};

  const handleReplayTogglePlay = () => {
    isReplayPausedRef.current = !isReplayPausedRef.current;
    console.log('Replay Toggle Play/Pause:', !isReplayPausedRef.current);
  };

  const handleReplaySeek = (e: Event) => {
    const customEvent = e as CustomEvent;
    if (customEvent.detail && typeof customEvent.detail.time === 'number') {
      replayTimeRef.current = Math.min(replayData.duration || 0, Math.max(0, customEvent.detail.time));
      prevReplayFrameRef.current = null;
      lastReplayEventFrameIndexRef.current = null;
      console.log('Replay Seek to:', replayTimeRef.current);
    }
  };

  const handleReplayChangeSpeed = (e: Event) => {
    const customEvent = e as CustomEvent;
    if (customEvent.detail && typeof customEvent.detail.speed === 'number') {
      replaySpeedRef.current = customEvent.detail.speed;
      console.log('Replay Speed changed to:', replaySpeedRef.current);
    }
  };

  const handleReplayChangeTarget = (e: Event) => {
    const customEvent = e as CustomEvent;
    if (customEvent.detail && typeof customEvent.detail.id === 'string') {
      replayTargetIdRef.current = customEvent.detail.id;
      console.log('Replay Cam Target changed to:', replayTargetIdRef.current);
    }
  };

  const handleReplayChangeCamMode = (e: Event) => {
    const customEvent = e as CustomEvent;
    if (customEvent.detail && typeof customEvent.detail.mode === 'string') {
      state.observerCamMode = customEvent.detail.mode as GrifballRuntimeState['observerCamMode'];
      console.log('Replay Cam Mode changed to:', state.observerCamMode);
    }
  };

  window.addEventListener('replay-toggle-play', handleReplayTogglePlay);
  window.addEventListener('replay-seek', handleReplaySeek);
  window.addEventListener('replay-change-speed', handleReplayChangeSpeed);
  window.addEventListener('replay-change-target', handleReplayChangeTarget);
  window.addEventListener('replay-change-cam-mode', handleReplayChangeCamMode);

  return () => {
    window.removeEventListener('replay-toggle-play', handleReplayTogglePlay);
    window.removeEventListener('replay-seek', handleReplaySeek);
    window.removeEventListener('replay-change-speed', handleReplayChangeSpeed);
    window.removeEventListener('replay-change-target', handleReplayChangeTarget);
    window.removeEventListener('replay-change-cam-mode', handleReplayChangeCamMode);
  };
}

export function runReplayPlaybackLoopForState({
  state,
  refs,
  replayData,
  replayTimeRef,
  replaySpeedRef,
  isReplayPausedRef,
  replayTargetIdRef,
  prevReplayFrameRef,
  lastReplayEventFrameIndexRef,
  replayPlayerIdsRef,
  keysPressed,
  keybindings,
  botColors,
  adminSettings,
  dt,
  v3Options = { v3QualityTier: 'desktop' },
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
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  replayData: ReplayFile | null;
  replayTimeRef: MutableRef<number>;
  replaySpeedRef: MutableRef<number>;
  isReplayPausedRef: MutableRef<boolean>;
  replayTargetIdRef: MutableRef<string>;
  prevReplayFrameRef: MutableRef<ReplayFrame | null>;
  lastReplayEventFrameIndexRef: MutableRef<number | null>;
  replayPlayerIdsRef: MutableRef<string[]>;
  keysPressed: MutableRef<Record<string, boolean>>;
  keybindings: Keybindings;
  botColors: Record<string, number>;
  adminSettings: UniversalSettings;
  dt: number;
  v3Options?: V3RenderOptions;
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
}): void {
  const camera = refs.camera;
  const scene = refs.scene;
  if (!replayData || !camera || !scene) return;

  const frames = replayData.frames;
  if (frames.length === 0) return;

  if (!isReplayPausedRef.current) {
    replayTimeRef.current += dt * replaySpeedRef.current;
    if (replayTimeRef.current > replayData.duration) {
      replayTimeRef.current = replayData.duration;
      isReplayPausedRef.current = true;
    }
  }

  const t = replayTimeRef.current;
  const playbackFrame = buildReplayPlaybackFrameSlice({
    replayData,
    time: t,
    botColors,
  });
  if (!playbackFrame) return;

  const { indexA, frameA, updatedPlayers } = playbackFrame;
  replayPlayerIdsRef.current = Array.from(updatedPlayers.keys());

  const targetId = replayTargetIdRef.current;

  updateReplayCombatantVisualsForFrame({
    refs,
    replayData,
    updatedPlayers,
    targetId,
    observerCamMode: state.observerCamMode,
    replayPlayerName: replayData.playerName,
    dt,
    v3Options,
    animateSpartanModel,
    renderSwordLungeTrailVfx,
    updateBlinking,
    settings: state.settings,
  });

  if (targetId === 'free') {
    state.observerCamMode = 'free';

    updateFreeObserverMovementForState({
      state,
      keysPressed: keysPressed.current,
      keyboardKeybindings: keybindings,
      gamepadKeybindings: keybindings,
      gamepad: getPrimaryGamepad(),
      dt,
    });

    const lookTarget = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
      .normalize();
    camera.position.copy(state.playerPos);
    camera.lookAt(camera.position.clone().add(lookTarget));
  } else {
    const targetData = updatedPlayers.get(targetId);
    if (targetData) {
      const eyeHeight = 1.65 - (targetData.isCrouching ? 0.72 : 0);
      const targetEyePos = targetData.pos.clone().setY(targetData.pos.y + eyeHeight);

      if (state.observerCamMode === 'first') {
        camera.position.copy(targetEyePos);
        const lookTarget = new THREE.Vector3(0, 0, -1)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), targetData.pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), targetData.yaw)
          .normalize();
        camera.lookAt(camera.position.clone().add(lookTarget));
      } else if (state.observerCamMode === 'third') {
        const offset = new THREE.Vector3(0, 0, state.observerOrbitDistance)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
        const cameraPos = targetEyePos.clone().add(offset);
        const activeCustomMap = getActiveCustomMap();
        const customMapObjects = activeCustomMap?.objects || [];
        const arenaRadius = activeCustomMap ? activeCustomMap.arenaRadius : state.arenaRadius;
        const resolvedPos = getCollisionResolvedCameraPos(targetEyePos, cameraPos, arenaRadius, customMapObjects);

        camera.position.copy(resolvedPos);
        camera.lookAt(targetEyePos);
      }
    }
  }

  type ReplayFirstPersonWeapon = 'hammer' | 'sword' | 'pistol' | 'none';
  let fpWeaponToShow: ReplayFirstPersonWeapon = 'none';
  if (state.observerCamMode === 'first' && targetId !== 'free') {
    const spectatedData = updatedPlayers.get(targetId);
    if (spectatedData && spectatedData.hp > 0 && spectatedData.respawnTimer <= 0) {
      fpWeaponToShow = spectatedData.activeWeapon as ReplayFirstPersonWeapon;
    }
  }

  if (refs.playerHammer) refs.playerHammer.visible = fpWeaponToShow === 'hammer';
  if (refs.playerSword) refs.playerSword.visible = fpWeaponToShow === 'sword';
  if (refs.playerPistol) refs.playerPistol.visible = fpWeaponToShow === 'pistol';

  renderGame();

  const replayEventFrameIndexes = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: indexA,
    lastReplayEventFrameIndex: lastReplayEventFrameIndexRef.current,
    isPaused: isReplayPausedRef.current,
    dt,
  });
  lastReplayEventFrameIndexRef.current = replayEventFrameIndexes.nextLastReplayEventFrameIndex;

  if (replayEventFrameIndexes.frameIndexes.length > 0) {
    const events = replayEventFrameIndexes.frameIndexes.flatMap(frameIndex =>
      collectReplayPlaybackEventsForFrame({
        frames,
        frameIndex,
        replayPlayerName: replayData.playerName,
        attackRange: state.settings.attackRange || 4.0,
        attackRadius: state.settings.attackRadius ?? 4.5,
      })
    );
    emitReplayPlaybackEvents({
      events,
      spawnVoxelShockwaveParticles,
      renderHammerSplashVfx,
      playDeath,
      playSwing,
      playRespawn,
      playDash,
      playExplosion,
    });
  }

  prevReplayFrameRef.current = frameA;

  const playerList = Array.from(updatedPlayers.entries()).map(([id, p]) => ({
    id,
    name: p.name,
    hue: p.hue,
  }));

  const mainPlayer: any = updatedPlayers.get('player') || { hp: 1, maxHp: 1, score: 0, kills: 0, deaths: 0 };
  const mainAI: any = updatedPlayers.get(MAIN_AI_ID) || { hp: 1, maxHp: 1, score: 0, kills: 0, deaths: 0 };

  const spectatedName = targetId === 'free' ? 'Free Cam' : (updatedPlayers.get(targetId)?.name || 'Spartan');
  const spectatedRole = targetId === 'player' ? 'host' : 'client';

  onStatsUpdate({
    playerHP: mainPlayer.hp,
    playerMaxHP: mainPlayer.maxHp !== undefined ? mainPlayer.maxHp : 5,
    enemyHP: mainAI.hp,
    enemyMaxHP: mainAI.maxHp !== undefined ? mainAI.maxHp : 5,
    scorePlayer: mainPlayer.score,
    scoreEnemy: mainAI.score,
    gameTime: t,
    debugMode: false,
    debugDamageRadius: 4.5,
    weaponReady: true,
    weaponCooldown: 1.0,
    lastStrikePos: null,
    lastStrikeTick: 0,
    isCrouching: false,
    isJumping: false,
    playerRespawnTimer: 0,
    enemyRespawnTimer: 0,
    playerDashCooldownTimer: 0,
    playerDashReady: true,
    settings: adminSettings,
    lastDeaths: [],
    playerX: mainPlayer.pos?.x ?? 0,
    playerZ: mainPlayer.pos?.z ?? 0,
    playerYaw: mainPlayer.yaw ?? 0,
    enemyX: mainAI.pos?.x ?? 0,
    enemyZ: mainAI.pos?.z ?? 0,
    enemyYaw: mainAI.yaw ?? 0,
    enemyIsCrouching: false,
    playerIsCrouchMoving: false,
    enemyIsCrouchMoving: false,
    activeWeapon: 'hammer',
    crosshairColor: 'white',
    playerKills: mainPlayer.kills,
    playerDeaths: mainPlayer.deaths,
    enemyKills: mainAI.kills,
    enemyDeaths: mainAI.deaths,
    isReplayMode: true,
    replayElapsedTime: t,
    replayDuration: replayData.duration,
    replayIsPlaying: !isReplayPausedRef.current,
    replaySpeedMultiplier: replaySpeedRef.current,
    replayPlayerList: playerList,
    replayCurrentTargetId: targetId,
    isObserverMode: true,
    observerCamMode: state.observerCamMode,
    observerTargetName: spectatedName,
    observerTargetRole: spectatedRole,
  });

  const playbackDt = isReplayPausedRef.current ? 0 : dt * replaySpeedRef.current;
  updateTransientVfxForFrame(refs, playbackDt);
}
