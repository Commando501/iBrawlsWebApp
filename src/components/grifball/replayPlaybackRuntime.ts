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

export function registerReplayPlaybackEventListenersForState({
  state,
  replayData,
  replayTimeRef,
  replaySpeedRef,
  isReplayPausedRef,
  replayTargetIdRef,
  prevReplayFrameRef,
}: {
  state: GrifballRuntimeState;
  replayData: ReplayFile | null;
  replayTimeRef: MutableRef<number>;
  replaySpeedRef: MutableRef<number>;
  isReplayPausedRef: MutableRef<boolean>;
  replayTargetIdRef: MutableRef<string>;
  prevReplayFrameRef: MutableRef<ReplayFrame | null>;
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
  replayPlayerIdsRef,
  keysPressed,
  keybindings,
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
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  replayData: ReplayFile | null;
  replayTimeRef: MutableRef<number>;
  replaySpeedRef: MutableRef<number>;
  isReplayPausedRef: MutableRef<boolean>;
  replayTargetIdRef: MutableRef<string>;
  prevReplayFrameRef: MutableRef<ReplayFrame | null>;
  replayPlayerIdsRef: MutableRef<string[]>;
  keysPressed: MutableRef<Record<string, boolean>>;
  keybindings: Keybindings;
  botColors: Record<string, number>;
  adminSettings: UniversalSettings;
  dt: number;
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
    updatedPlayers,
    targetId,
    observerCamMode: state.observerCamMode,
    replayPlayerName: replayData.playerName,
    dt,
    animateSpartanModel,
    renderSwordLungeTrailVfx,
    updateBlinking,
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

  if (!isReplayPausedRef.current && dt > 0 && dt < 0.2 && prevReplayFrameRef.current) {
    const timeDiff = t - prevReplayFrameRef.current.time;
    if (timeDiff > 0 && timeDiff < 0.2) {
      updatedPlayers.forEach((player, id) => {
        let prevState: ReplayEntityState | null = null;
        for (let i = indexA - 1; i >= 0; i--) {
          const f = frames[i];
          if (id === 'player' && f.player) { prevState = f.player; break; }
          if (f.otherPlayers) {
            const found = f.otherPlayers.find(p => p.id === id);
            if (found) { prevState = found; break; }
          }
          if (id === MAIN_AI_ID && f.ai) { prevState = f.ai; break; }
        }

        if (prevState) {
          if (player.hp < prevState.hp) {
            spawnVoxelShockwaveParticles(player.pos, '#ef4444');
            if (player.hp <= 0) {
              playDeath();
              spawnVoxelShockwaveParticles(player.pos, '#ef4444');
              spawnVoxelShockwaveParticles(player.pos, '#ff4d4d');
            } else {
              playSwing();
            }
          }

          if (player.hp > 0 && prevState.hp <= 0) {
            playRespawn();
            spawnVoxelShockwaveParticles(player.pos, '#38bdf8');
          }

          if (player.weaponState !== 'ready' && prevState.weaponState === 'ready') {
            playSwing();
          }

          if (player.isLunging && !prevState.isLunging) {
            playDash();
          }

          if (player.isDashing && !prevState.isDashing) {
            playDash();
          }

          const wasSwingingDown = prevState.weaponState === 'swing_down' || prevState.weaponState === 'melee_swing';
          const isSwingingDownNow = player.weaponState === 'swing_down' || player.weaponState === 'melee_swing';
          if (wasSwingingDown && !isSwingingDownNow && player.activeWeapon === 'hammer' && prevState.activeWeapon === 'hammer') {
            playExplosion();
            const eyeHeight = 1.65 - (player.isCrouching ? 0.72 : 0);
            const eyePos = new THREE.Vector3(player.pos.x, eyeHeight + player.pos.y, player.pos.z);
            const lookHeading = new THREE.Vector3(0, 0, -1)
              .applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch || 0)
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw)
              .normalize();
            const impactPos = eyePos.clone().addScaledVector(lookHeading, state.settings.attackRange || 4.0);
            const impactRadius = state.settings.attackRadius ?? 4.5;
            renderHammerSplashVfx(
              impactPos,
              (id === 'player' || player.playerName === replayData.playerName) ? '#38bdf8' : '#ef4444',
              impactRadius
            );
          }
        }
      });
    }
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
