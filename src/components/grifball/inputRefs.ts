import { useEffect, useRef } from 'react';

export interface PointerPosition {
  x: number;
  y: number;
}

export const usePausedPointerLockRef = (isPaused: boolean) => {
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
    if (isPaused && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }, [isPaused]);

  return isPausedRef;
};

export const useGrifballInputRefs = () => ({
  keysPressed: useRef<Record<string, boolean>>({}),
  prevGamepadButtonsRef: useRef<boolean[]>([]),
  grifbHoldTimerRef: useRef<number>(0),
  secretAudioRef: useRef<HTMLAudioElement | null>(null),
  isPointerLocked: useRef<boolean>(false),
  isMouseDown: useRef<boolean>(false),
  lastMousePos: useRef<PointerPosition>({ x: 0, y: 0 }),
});

export const useGrifballDomPoolRefs = () => ({
  lastOpponentHue: useRef<number | null>(null),
  radarDotPoolRef: useRef<Map<string, HTMLElement>>(new Map()),
  nameplatePoolRef: useRef<Map<string, HTMLElement>>(new Map()),
});
