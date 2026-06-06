import * as THREE from 'three';
import { type Combatant, type Keybindings, type ReplayFile } from '../../types';
import {
  handleChatInputKeyboardFocus,
  isTextInputElementActive,
} from './chatInputRuntime';
import { type GrifballInputEventHandlers } from './inputEventListenersRuntime';
import {
  cycleObserverCameraModeForState,
  cycleObserverTargetForState,
  handleObserverKeyboardInputForState,
} from './observerInputRuntime';
import {
  cyclePlayerWheelWeaponForState,
  createPlayerLookInputHandlersForState,
  handlePlayerKeyboardActionForState,
  handlePlayerKeyboardReleaseForState,
  handlePointerPlayerActionInputForState,
  handlePointerPlayerActionReleaseForState,
  triggerMobileAltPlayerActionForState,
  triggerMobilePrimaryPlayerActionForState,
} from './playerInputRuntime';
import {
  observePlayerDash,
  observePlayerReaction,
  type PlayerModelObserver,
} from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';

type MutableRef<T> = { current: T };
type MousePosition = { x: number; y: number };
type ReplayTargetCycleDirection = 'next' | 'prev';

export function createGrifballInputHandlersForState({
  canvas,
  camera,
  renderer,
  getContainer,
  stateRef,
  keysPressed,
  keybindingsRef,
  isPausedRef,
  isPlaying,
  isMultiplayer,
  replayData,
  replayPlayerIdsRef,
  replayTargetIdRef,
  isPointerLocked,
  isMouseDown,
  lastMousePos,
  setShowPointerLockAlert,
  getMainAI,
  cycleReplayTarget,
  pushStatsUpdate,
  onPauseToggle,
  swapPlayerWeapon,
  recordLocalPlayerObservation,
  spawnVoxelShockwaveParticles,
  ballChargingRef,
  ballChargeTimerRef,
  triggerPlayerHammerSwing,
  triggerPlayerHammerMelee,
  triggerPlayerPistolFire,
  triggerPlayerSwordSlash,
  triggerPlayerSwordLunge,
  throwPlayerPass,
  playCrouch,
  playJump,
  playDash,
}: {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  getContainer: () => HTMLElement | null;
  stateRef: MutableRef<GrifballRuntimeState>;
  keysPressed: MutableRef<Record<string, boolean>>;
  keybindingsRef: MutableRef<Keybindings>;
  isPausedRef: MutableRef<boolean>;
  isPlaying: boolean;
  isMultiplayer: boolean;
  replayData: ReplayFile | null;
  replayPlayerIdsRef: MutableRef<string[]>;
  replayTargetIdRef: MutableRef<string>;
  isPointerLocked: MutableRef<boolean>;
  isMouseDown: MutableRef<boolean>;
  lastMousePos: MutableRef<MousePosition>;
  setShowPointerLockAlert: (show: boolean) => void;
  getMainAI: () => Combatant | undefined;
  cycleReplayTarget: (direction?: ReplayTargetCycleDirection) => void;
  pushStatsUpdate: () => void;
  onPauseToggle: () => void;
  swapPlayerWeapon: (type: 'hammer' | 'sword') => void;
  recordLocalPlayerObservation: (observe: PlayerModelObserver) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  ballChargingRef: MutableRef<boolean>;
  ballChargeTimerRef: MutableRef<number>;
  triggerPlayerHammerSwing: () => void;
  triggerPlayerHammerMelee: () => void;
  triggerPlayerPistolFire: () => void;
  triggerPlayerSwordSlash: () => void;
  triggerPlayerSwordLunge: () => void;
  throwPlayerPass: () => void;
  playCrouch: () => void;
  playJump: () => void;
  playDash: () => void;
}): GrifballInputEventHandlers {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (handleChatInputKeyboardFocus(e)) return;

    if (isTextInputElementActive()) {
      return;
    }

    const key = e.key.toLowerCase();
    keysPressed.current[key] = true;

    const s = stateRef.current;
    if (handleObserverKeyboardInputForState({
      state: s,
      key,
      rawKey: e.key,
      keybindings: keybindingsRef.current,
      replayActive: !!replayData,
      replayPlayerIdsRef,
      replayTargetIdRef,
      cycleReplayTarget,
      pushStatsUpdate,
      onPauseToggle,
    })) return;

    handlePlayerKeyboardActionForState({
      state: stateRef.current,
      key,
      rawKey: e.key,
      repeat: e.repeat,
      keybindings: keybindingsRef.current,
      keysPressed: keysPressed.current,
      isPaused: isPausedRef.current,
      isPlaying,
      callbacks: {
        onPauseToggle,
        swapPlayerWeapon,
        recordDashObservation: (dashDir) => {
          recordLocalPlayerObservation((model) => {
            observePlayerDash(model, dashDir.x, dashDir.z);
            const mainAi = getMainAI();
            if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.weaponState === 'swing_up') {
              observePlayerReaction(model, mainAi.weaponTimer ?? 0);
            }
          });
        },
        spawnVoxelShockwaveParticles,
        pushStatsUpdate,
        playCrouch,
        playJump,
        playDash,
      },
    });
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (isTextInputElementActive()) {
      return;
    }
    const key = e.key.toLowerCase();
    keysPressed.current[key] = false;

    handlePlayerKeyboardReleaseForState({
      state: stateRef.current,
      key,
      keybindings: keybindingsRef.current,
      pushStatsUpdate,
    });
  };

  const handleCanvasMouseDown = (e: MouseEvent) => {
    if (!isPlaying || isPausedRef.current) return;

    if (renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    const s = stateRef.current;
    if (s.isObserverMode) {
      if (e.button === 0) {
        if (replayData) {
          cycleReplayTarget('next');
        } else {
          s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
          console.log('Spectator Target cycled to:', s.observerTarget);
          pushStatsUpdate();
        }
      }
      return;
    }

    handlePointerPlayerActionInputForState({
      state: s,
      button: e.button,
      keybindings: keybindingsRef.current,
      ballChargingRef,
      ballChargeTimerRef,
      callbacks: {
        triggerPlayerHammerSwing,
        triggerPlayerHammerMelee,
        triggerPlayerPistolFire,
        triggerPlayerSwordSlash,
        triggerPlayerSwordLunge,
      },
    });
  };

  const handleCanvasMouseUp = (e: MouseEvent) => {
    if (!isPlaying || isPausedRef.current) return;
    handlePointerPlayerActionReleaseForState({
      button: e.button,
      keybindings: keybindingsRef.current,
      ballChargingRef,
      throwPlayerPass,
    });
  };

  const handleWheel = (e: WheelEvent) => {
    if (!isPlaying || isPausedRef.current) return;

    const s = stateRef.current;
    if (s.isObserverMode) {
      if (s.observerCamMode === 'third') {
        const zoomSpeed = 0.55;
        s.observerOrbitDistance = Math.max(2.0, Math.min(22.0, s.observerOrbitDistance + (e.deltaY > 0 ? zoomSpeed : -zoomSpeed)));
        pushStatsUpdate();
      }
      return;
    }

    cyclePlayerWheelWeaponForState({
      state: s,
      swapPlayerWeapon,
    });
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  const {
    handlePointerLockChange,
    handleMouseMove,
    handleMouseDownFallback,
    handleMouseUpFallback,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = createPlayerLookInputHandlersForState({
    canvas,
    getState: () => stateRef.current,
    getKeybindings: () => keybindingsRef.current,
    isPlaying: () => isPlaying,
    isPaused: () => isPausedRef.current,
    isPointerLocked,
    isMouseDown,
    lastMousePos,
    setShowPointerLockAlert,
  });

  const handleMobileAttackPrimary = () => {
    if (!isPlaying || isPausedRef.current) return;
    triggerMobilePrimaryPlayerActionForState({
      state: stateRef.current,
      callbacks: {
        triggerPlayerHammerSwing,
        triggerPlayerPistolFire,
        triggerPlayerSwordLunge,
      },
    });
  };

  const handleMobileAttackAlt = () => {
    if (!isPlaying || isPausedRef.current) return;
    triggerMobileAltPlayerActionForState({
      state: stateRef.current,
      callbacks: {
        triggerPlayerSwordSlash,
        triggerPlayerHammerMelee,
      },
    });
  };

  const handleResize = () => {
    const container = getContainer();
    if (!container || !renderer || !camera) return;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };

  const handleCycleObserverMode = () => {
    cycleObserverCameraModeForState({
      state: stateRef.current,
      pushStatsUpdate,
    });
  };

  const handleCycleObserverTarget = (e?: Event) => {
    cycleObserverTargetForState({
      state: stateRef.current,
      replayActive: !!replayData,
      event: e,
      cycleReplayTarget,
      pushStatsUpdate,
    });
  };

  return {
    handleKeyDown,
    handleKeyUp,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleWheel,
    handleContextMenu,
    handlePointerLockChange,
    handleMouseMove,
    handleMouseDownFallback,
    handleMouseUpFallback,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleMobileAttackPrimary,
    handleMobileAttackAlt,
    handleResize,
    handleCycleObserverMode,
    handleCycleObserverTarget,
  };
}
