import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { DEFAULT_KEYBINDINGS, type DeviceInfo, type Keybindings } from '../types';
import { getGamepadButtonName } from '../components/main-menu/KeybindingControls';
import { KEYBINDINGS_STORAGE_KEY, normalizeKeybindings } from './keybindingNormalization';

type KeybindsModalTab = 'keyboard' | 'gamepad';

interface UseKeybindingControlsOptions {
  isPlaying: boolean;
  isPaused: boolean;
  deviceInfo: DeviceInfo;
  forceMobileControls: boolean;
  hasMatchResult: boolean;
}

interface GamepadHoldState {
  buttonIndex: number;
  name: string;
  progress: number;
}

const GAMEPAD_BUTTON_KEYS: Array<keyof Keybindings> = [
  'gamepadJump',
  'gamepadCrouch',
  'gamepadPickup',
  'gamepadDash',
  'gamepadSwapWeapon',
  'gamepadAttack',
  'gamepadAltAttack',
  'gamepadSprint',
  'gamepadScoreboard',
  'gamepadPause',
];

const loadStoredKeybindings = (): Keybindings => {
  try {
    const saved = localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (saved) {
      return normalizeKeybindings(JSON.parse(saved));
    }
  } catch {
    /* fall back to defaults */
  }
  return normalizeKeybindings(DEFAULT_KEYBINDINGS);
};

const persistKeybindings = (keybindings: Keybindings) => {
  try {
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(keybindings));
  } catch {
    /* local persistence is optional */
  }
};

const getInitialCursorCoords = () => {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
};

const findInteractiveElement = (x: number, y: number): HTMLElement | null => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest('button, input, select, textarea, [role="button"], a, .cursor-pointer') as HTMLElement | null;
};

export function useKeybindingControls({
  isPlaying,
  isPaused,
  deviceInfo,
  forceMobileControls,
  hasMatchResult,
}: UseKeybindingControlsOptions): {
  keybindings: Keybindings;
  setKeybindings: Dispatch<SetStateAction<Keybindings>>;
  rebindingAction: keyof Keybindings | null;
  setRebindingAction: Dispatch<SetStateAction<keyof Keybindings | null>>;
  keybindsModalTab: KeybindsModalTab;
  setKeybindsModalTab: Dispatch<SetStateAction<KeybindsModalTab>>;
  gamepadConnected: boolean;
  gamepadName: string;
  holdingGpButton: GamepadHoldState | null;
  unassignedButtonMap: number | null;
  setUnassignedButtonMap: Dispatch<SetStateAction<number | null>>;
  pressedGpButtons: boolean[];
  hoveredAction: string | null;
  setHoveredAction: Dispatch<SetStateAction<string | null>>;
  leftStickActive: boolean;
  rightStickActive: boolean;
  controllerCursorRef: RefObject<HTMLDivElement | null>;
} {
  const [keybindings, setKeybindings] = useState<Keybindings>(loadStoredKeybindings);
  const [rebindingAction, setRebindingAction] = useState<keyof Keybindings | null>(null);
  const [keybindsModalTab, setKeybindsModalTab] = useState<KeybindsModalTab>('keyboard');
  const [gamepadConnected, setGamepadConnected] = useState<boolean>(false);
  const [gamepadName, setGamepadName] = useState<string>('');
  const [holdingGpButton, setHoldingGpButton] = useState<GamepadHoldState | null>(null);
  const [unassignedButtonMap, setUnassignedButtonMap] = useState<number | null>(null);
  const [pressedGpButtons, setPressedGpButtons] = useState<boolean[]>([]);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [leftStickActive, setLeftStickActive] = useState<boolean>(false);
  const [rightStickActive, setRightStickActive] = useState<boolean>(false);

  const buttonHoldStart = useRef<number>(0);
  const buttonHoldIndex = useRef<number>(-1);
  const controllerCursorRef = useRef<HTMLDivElement | null>(null);
  const cursorCoordsRef = useRef<{ x: number; y: number }>(getInitialCursorCoords());
  const prevAButtonPressedRef = useRef<boolean>(false);
  const prevHoverElRef = useRef<HTMLElement | null>(null);

  const findActionForButton = (buttonIndex: number): keyof Keybindings | null => {
    for (const key of GAMEPAD_BUTTON_KEYS) {
      if (keybindings[key] === buttonIndex) {
        return key;
      }
    }
    return null;
  };

  useEffect(() => {
    if (!rebindingAction) return;

    if (rebindingAction.startsWith('gamepad')) {
      let active = true;
      let rafId: number;

      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const initialPressed: boolean[] = [];
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          gamepads[i]!.buttons.forEach((button, idx) => {
            if (button.pressed) initialPressed[idx] = true;
          });
          break;
        }
      }

      const pollGamepadForRebind = () => {
        if (!active) return;
        const currentGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let activeGamepad: Gamepad | null = null;
        for (let i = 0; i < currentGamepads.length; i++) {
          if (currentGamepads[i]) {
            activeGamepad = currentGamepads[i];
            break;
          }
        }

        if (activeGamepad) {
          for (let idx = 0; idx < activeGamepad.buttons.length; idx++) {
            const pressed = activeGamepad.buttons[idx].pressed;
            if (pressed && !initialPressed[idx]) {
              setKeybindings(prev => {
                const updated = { ...prev, [rebindingAction]: idx };
                persistKeybindings(updated);
                return updated;
              });
              setRebindingAction(null);
              active = false;
              return;
            }
            if (!pressed) {
              initialPressed[idx] = false;
            }
          }
        }
        rafId = requestAnimationFrame(pollGamepadForRebind);
      };

      rafId = requestAnimationFrame(pollGamepadForRebind);

      const handleGamepadEsc = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setRebindingAction(null);
        }
      };

      window.addEventListener('keydown', handleGamepadEsc, true);
      return () => {
        active = false;
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', handleGamepadEsc, true);
      };
    }

    const handleRebindKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRebindingAction(null);
        return;
      }
      const newKey = event.key.toLowerCase();
      setKeybindings(prev => {
        const updated = { ...prev, [rebindingAction]: newKey };
        persistKeybindings(updated);
        return updated;
      });
      setRebindingAction(null);
    };

    const handleRebindMouse = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const mouseMap: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
      const newKey = mouseMap[event.button];
      if (!newKey) return;
      setKeybindings(prev => {
        const updated = { ...prev, [rebindingAction]: newKey };
        persistKeybindings(updated);
        return updated;
      });
      setRebindingAction(null);
    };

    window.addEventListener('keydown', handleRebindKey, true);
    window.addEventListener('mousedown', handleRebindMouse, true);
    return () => {
      window.removeEventListener('keydown', handleRebindKey, true);
      window.removeEventListener('mousedown', handleRebindMouse, true);
    };
  }, [rebindingAction]);

  useEffect(() => {
    const handleGamepadConnect = (event: GamepadEvent) => {
      setGamepadConnected(true);
      setGamepadName(event.gamepad.id);
    };

    const handleGamepadDisconnect = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let found = false;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          setGamepadConnected(true);
          setGamepadName(gamepads[i]!.id);
          found = true;
          break;
        }
      }
      if (!found) {
        setGamepadConnected(false);
        setGamepadName('');
      }
    };

    window.addEventListener('gamepadconnected', handleGamepadConnect);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnect);

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        setGamepadConnected(true);
        setGamepadName(gamepads[i]!.id);
        break;
      }
    }

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnect);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!gamepadConnected) return;

    let active = true;
    let rafId: number;
    let lastTime = performance.now();

    const pollGamepad = () => {
      if (!active) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const currentGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let activeGamepad: Gamepad | null = null;
      for (let i = 0; i < currentGamepads.length; i++) {
        if (currentGamepads[i]) {
          activeGamepad = currentGamepads[i];
          break;
        }
      }

      if (activeGamepad) {
        setPressedGpButtons(activeGamepad.buttons.map(button => button.pressed));

        const deadzone = 0.15;
        setLeftStickActive(
          activeGamepad.axes.length >= 2 &&
          (Math.abs(activeGamepad.axes[0]) > deadzone || Math.abs(activeGamepad.axes[1]) > deadzone)
        );
        setRightStickActive(
          activeGamepad.axes.length >= 4 &&
          (Math.abs(activeGamepad.axes[2]) > deadzone || Math.abs(activeGamepad.axes[3]) > deadzone)
        );

        const isCursorActive = !!(
          !isPlaying ||
          isPaused ||
          (document.pointerLockElement === null && !deviceInfo.isMobile && !forceMobileControls) ||
          hasMatchResult
        );

        if (isCursorActive) {
          if (controllerCursorRef.current) {
            controllerCursorRef.current.style.display = 'block';
          }

          const rx = activeGamepad.axes[2];
          const ry = activeGamepad.axes[3];
          const aimDeadzone = 0.18;

          if (Math.abs(rx) > aimDeadzone || Math.abs(ry) > aimDeadzone) {
            const speedMultiplier = keybindings.gamepadCursorSpeed ?? 1.0;
            const baseSpeed = 400;
            const applyDeadzone = (value: number) => {
              const absValue = Math.abs(value);
              if (absValue <= aimDeadzone) return 0;
              const sign = value < 0 ? -1 : 1;
              return sign * ((absValue - aimDeadzone) / (1 - aimDeadzone));
            };

            cursorCoordsRef.current.x = Math.max(
              0,
              Math.min(window.innerWidth, cursorCoordsRef.current.x + applyDeadzone(rx) * baseSpeed * speedMultiplier * dt)
            );
            cursorCoordsRef.current.y = Math.max(
              0,
              Math.min(window.innerHeight, cursorCoordsRef.current.y + applyDeadzone(ry) * baseSpeed * speedMultiplier * dt)
            );

            if (controllerCursorRef.current) {
              controllerCursorRef.current.style.left = `${cursorCoordsRef.current.x}px`;
              controllerCursorRef.current.style.top = `${cursorCoordsRef.current.y}px`;
            }
          }

          const hoverEl = findInteractiveElement(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
          if (hoverEl !== prevHoverElRef.current) {
            if (prevHoverElRef.current) {
              prevHoverElRef.current.classList.remove('gpad-hover');
              prevHoverElRef.current.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
            }
            if (hoverEl) {
              hoverEl.classList.add('gpad-hover');
              hoverEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
            }
            prevHoverElRef.current = hoverEl;
          }

          const aPressed = activeGamepad.buttons[0]?.pressed || false;
          const aWasPressed = prevAButtonPressedRef.current;
          prevAButtonPressedRef.current = aPressed;

          if (aPressed && !aWasPressed) {
            const target = document.elementFromPoint(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
            if (target) {
              target.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y,
              }));
              if (typeof (target as HTMLElement).focus === 'function') {
                (target as HTMLElement).focus();
              }
            }
          } else if (!aPressed && aWasPressed) {
            const target = document.elementFromPoint(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
            if (target) {
              target.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y,
              }));
              target.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y,
              }));
            }
          } else if (aPressed) {
            const target = document.elementFromPoint(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
            if (target) {
              target.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y,
                buttons: 1,
              }));
            }
          }
        } else {
          if (prevHoverElRef.current) {
            prevHoverElRef.current.classList.remove('gpad-hover');
            prevHoverElRef.current = null;
          }
          if (controllerCursorRef.current) {
            controllerCursorRef.current.style.display = 'none';
          }
          prevAButtonPressedRef.current = false;
        }

        if (!rebindingAction && unassignedButtonMap === null) {
          let pressedIndex = -1;
          for (let idx = 0; idx < activeGamepad.buttons.length; idx++) {
            if (activeGamepad.buttons[idx].pressed) {
              pressedIndex = idx;
              break;
            }
          }

          if (pressedIndex !== -1) {
            if (buttonHoldIndex.current === -1) {
              buttonHoldIndex.current = pressedIndex;
              buttonHoldStart.current = performance.now();
              setHoldingGpButton({
                buttonIndex: pressedIndex,
                name: getGamepadButtonName(pressedIndex),
                progress: 0,
              });
            } else if (buttonHoldIndex.current === pressedIndex) {
              const elapsed = performance.now() - buttonHoldStart.current;
              const progress = Math.min(100, (elapsed / 3000) * 100);

              if (elapsed >= 3000) {
                const actionKey = findActionForButton(pressedIndex);
                if (actionKey) {
                  setRebindingAction(actionKey);
                } else {
                  setUnassignedButtonMap(pressedIndex);
                }
                buttonHoldIndex.current = -1;
                setHoldingGpButton(null);
              } else {
                setHoldingGpButton({
                  buttonIndex: pressedIndex,
                  name: getGamepadButtonName(pressedIndex),
                  progress,
                });
              }
            } else {
              buttonHoldIndex.current = -1;
              setHoldingGpButton(null);
            }
          } else if (buttonHoldIndex.current !== -1) {
            buttonHoldIndex.current = -1;
            setHoldingGpButton(null);
          }
        } else if (buttonHoldIndex.current !== -1) {
          buttonHoldIndex.current = -1;
          setHoldingGpButton(null);
        }
      } else {
        setPressedGpButtons([]);
        setLeftStickActive(false);
        setRightStickActive(false);
        if (buttonHoldIndex.current !== -1) {
          buttonHoldIndex.current = -1;
          setHoldingGpButton(null);
        }
        if (prevHoverElRef.current) {
          prevHoverElRef.current.classList.remove('gpad-hover');
          prevHoverElRef.current = null;
        }
        if (controllerCursorRef.current) {
          controllerCursorRef.current.style.display = 'none';
        }
        prevAButtonPressedRef.current = false;
      }

      rafId = requestAnimationFrame(pollGamepad);
    };

    rafId = requestAnimationFrame(pollGamepad);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      if (prevHoverElRef.current) {
        prevHoverElRef.current.classList.remove('gpad-hover');
        prevHoverElRef.current = null;
      }
      if (controllerCursorRef.current) {
        controllerCursorRef.current.style.display = 'none';
      }
      prevAButtonPressedRef.current = false;
    };
  }, [
    gamepadConnected,
    isPlaying,
    isPaused,
    keybindings,
    deviceInfo,
    forceMobileControls,
    hasMatchResult,
    rebindingAction,
    unassignedButtonMap,
  ]);

  return {
    keybindings,
    setKeybindings,
    rebindingAction,
    setRebindingAction,
    keybindsModalTab,
    setKeybindsModalTab,
    gamepadConnected,
    gamepadName,
    holdingGpButton,
    unassignedButtonMap,
    setUnassignedButtonMap,
    pressedGpButtons,
    hoveredAction,
    setHoveredAction,
    leftStickActive,
    rightStickActive,
    controllerCursorRef,
  };
}
