import { type Keybindings } from '../../types';
import { type ReplayTargetCycleDirection } from './replayHelpers';
import { type GrifballRuntimeState } from './runtimeState';

type MutableRef<T> = { current: T };

const OBSERVER_CAMERA_MODES: GrifballRuntimeState['observerCamMode'][] = ['free', 'third', 'first'];

export function cycleObserverCameraModeForState({
  state,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  pushStatsUpdate: () => void;
}): void {
  if (!state.isObserverMode) return;

  const currentIdx = OBSERVER_CAMERA_MODES.indexOf(state.observerCamMode);
  const nextMode = OBSERVER_CAMERA_MODES[(currentIdx + 1) % OBSERVER_CAMERA_MODES.length];
  state.observerCamMode = nextMode;
  state.yaw = Math.PI;
  state.pitch = -0.2;
  console.log('Spectator Camera mode cycled to:', nextMode);
  pushStatsUpdate();
}

export function cycleObserverTargetForState({
  state,
  replayActive,
  event,
  cycleReplayTarget,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  replayActive: boolean;
  event?: Event;
  cycleReplayTarget: (direction?: ReplayTargetCycleDirection) => void;
  pushStatsUpdate: () => void;
}): void {
  if (!state.isObserverMode) return;

  if (replayActive) {
    const customEvent = event as CustomEvent<{ direction?: ReplayTargetCycleDirection }> | undefined;
    const direction = customEvent?.detail?.direction === 'prev' ? 'prev' : 'next';
    cycleReplayTarget(direction);
    return;
  }

  state.observerTarget = state.observerTarget === 'host' ? 'client' : 'host';
  console.log('Spectator Target toggled to:', state.observerTarget);
  pushStatsUpdate();
}

export function handleObserverKeyboardInputForState({
  state,
  key,
  rawKey,
  keybindings,
  replayActive,
  replayPlayerIdsRef,
  replayTargetIdRef,
  cycleReplayTarget,
  pushStatsUpdate,
  onPauseToggle,
}: {
  state: GrifballRuntimeState;
  key: string;
  rawKey: string;
  keybindings: Keybindings;
  replayActive: boolean;
  replayPlayerIdsRef: MutableRef<string[]>;
  replayTargetIdRef: MutableRef<string>;
  cycleReplayTarget: (direction?: ReplayTargetCycleDirection) => void;
  pushStatsUpdate: () => void;
  onPauseToggle: () => void;
}): boolean {
  if (!state.isObserverMode) return false;

  if (key === 'v') {
    cycleObserverCameraModeForState({ state, pushStatsUpdate });
    return true;
  }

  if (key === 'arrowleft' || key === 'arrowright' || key === '1' || key === '2') {
    if (replayActive) {
      if (key === 'arrowleft' || key === 'arrowright') {
        cycleReplayTarget(key === 'arrowleft' ? 'prev' : 'next');
        return true;
      }

      const playerIds = replayPlayerIdsRef.current;
      const idx = key === '1' ? 0 : 1;
      if (playerIds && playerIds[idx]) {
        replayTargetIdRef.current = playerIds[idx];
        if (state.observerCamMode === 'free') {
          state.observerCamMode = 'third';
        }
        console.log('Replay Cam Target set to:', replayTargetIdRef.current);
        pushStatsUpdate();
      }
      return true;
    }

    if (key === '1') {
      state.observerTarget = 'host';
    } else if (key === '2') {
      state.observerTarget = 'client';
    } else {
      state.observerTarget = state.observerTarget === 'host' ? 'client' : 'host';
    }
    console.log('Spectator Target toggled to:', state.observerTarget);
    pushStatsUpdate();
    return true;
  }

  if (rawKey === 'Escape') {
    onPauseToggle();
  }

  if (
    key === keybindings.crouch ||
    key === keybindings.jump ||
    key === 'spacebar' ||
    key === keybindings.moveForward ||
    key === keybindings.moveLeft ||
    key === keybindings.moveBackward ||
    key === keybindings.moveRight ||
    key === 'shift'
  ) {
    return false;
  }

  return true;
}
