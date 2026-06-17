import * as THREE from 'three';
import { type Keybindings } from '../../types';
import { resolveRunnerThrowAllowed, resolveRunnerThrustAllowed } from '../../game/runnerBallSettings';
import { type GrifballRuntimeState } from './runtimeState';

type JoystickVector = {
  x: number;
  y: number;
};

type MutableRef<T> = { current: T };
type MousePosition = { x: number; y: number };

type PlayerWeaponInputCallbacks = {
  triggerPlayerHammerSwing: () => void;
  triggerPlayerHammerMelee: () => void;
  triggerPlayerPistolFire: () => void;
  triggerPlayerSwordSlash: () => void;
  triggerPlayerSwordLunge: () => void;
};

type PlayerKeyboardActionCallbacks = {
  onPauseToggle: () => void;
  swapPlayerWeapon: (type: 'hammer' | 'sword') => void;
  recordDashObservation: (dashDir: THREE.Vector3) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  pushStatsUpdate: () => void;
  playCrouch: () => void;
  playJump: () => void;
  playDash: () => void;
};

const LOOK_PITCH_LIMIT = Math.PI / 2.3;
const GAMEPAD_DEADZONE = 0.18;
const MOUSE_BUTTON_BINDINGS: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
const MIN_MOUSE_SENSITIVITY = 0.1;
const MAX_MOUSE_SENSITIVITY = 5.0;
const MIN_GAMEPAD_SENSITIVITY = 0.5;
const MAX_GAMEPAD_SENSITIVITY = 10.0;
const MIN_LOOK_ACCELERATION = 0.0;
const MAX_LOOK_ACCELERATION = 2.0;
const MAX_POINTER_LOCK_DELTA = 160;
const MAX_DRAG_LOOK_DELTA = 160;
const MAX_TOUCH_LOOK_DELTA = 140;
const MAX_LOOK_RADIANS_PER_EVENT = 0.75;
const MAX_LOOK_DT = 0.05;

function clampPitch(pitch: number): number {
  return Math.max(-LOOK_PITCH_LIMIT, Math.min(LOOK_PITCH_LIMIT, pitch));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampSymmetric(value: number, maxAbs: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

function getSafeMouseSensitivity(mouseSensitivity: number): number {
  return clampNumber(mouseSensitivity, MIN_MOUSE_SENSITIVITY, MAX_MOUSE_SENSITIVITY);
}

function getSafeLookAcceleration(acceleration: number): number {
  return clampNumber(acceleration, MIN_LOOK_ACCELERATION, MAX_LOOK_ACCELERATION);
}

function getSafeGamepadSensitivity(gamepadSensitivity: number): number {
  return clampNumber(gamepadSensitivity, MIN_GAMEPAD_SENSITIVITY, MAX_GAMEPAD_SENSITIVITY);
}

function getMaxLookRadiansForSensitivity(mouseSensitivity: number): number {
  return Math.min(1.4, MAX_LOOK_RADIANS_PER_EVENT * Math.sqrt(getSafeMouseSensitivity(mouseSensitivity)));
}

function applyLookDeltaForState({
  state,
  deltaX,
  deltaY,
  sensitivity,
  maxDelta,
  maxRadians,
}: {
  state: GrifballRuntimeState;
  deltaX: number;
  deltaY: number;
  sensitivity: number;
  maxDelta: number;
  maxRadians: number;
}): void {
  const yawOffset = clampSymmetric(clampSymmetric(deltaX, maxDelta) * sensitivity, maxRadians);
  const pitchOffset = clampSymmetric(clampSymmetric(deltaY, maxDelta) * sensitivity, maxRadians);
  state.yaw -= yawOffset;
  state.pitch -= pitchOffset;
  state.pitch = clampPitch(state.pitch);
}

export function applyPointerLockMouseLookForState({
  state,
  movementX,
  movementY,
  mouseSensitivity,
  mouseAcceleration,
}: {
  state: GrifballRuntimeState;
  movementX: number;
  movementY: number;
  mouseSensitivity: number;
  mouseAcceleration: number;
}): void {
  const safeMouseSensitivity = getSafeMouseSensitivity(mouseSensitivity);
  const safeMouseAcceleration = getSafeLookAcceleration(mouseAcceleration);
  const baseSens = 0.0022 * safeMouseSensitivity;
  const maxRadians = getMaxLookRadiansForSensitivity(safeMouseSensitivity);
  const applyAccel = (delta: number) => {
    const safeDelta = clampSymmetric(delta, MAX_POINTER_LOCK_DELTA);
    if (safeMouseAcceleration === 0) return clampSymmetric(safeDelta * baseSens, maxRadians);
    const sign = safeDelta < 0 ? -1 : 1;
    const accelerated = sign * Math.pow(Math.abs(safeDelta), 1 + safeMouseAcceleration * 0.5) * baseSens;
    return clampSymmetric(accelerated, maxRadians);
  };

  state.yaw -= applyAccel(movementX);
  state.pitch -= applyAccel(movementY);
  state.pitch = clampPitch(state.pitch);
}

export function applyDragMouseLookForState({
  state,
  deltaX,
  deltaY,
  mouseSensitivity,
}: {
  state: GrifballRuntimeState;
  deltaX: number;
  deltaY: number;
  mouseSensitivity: number;
}): void {
  const safeMouseSensitivity = getSafeMouseSensitivity(mouseSensitivity);
  applyLookDeltaForState({
    state,
    deltaX,
    deltaY,
    sensitivity: 0.005 * safeMouseSensitivity,
    maxDelta: MAX_DRAG_LOOK_DELTA,
    maxRadians: getMaxLookRadiansForSensitivity(safeMouseSensitivity),
  });
}

export function applyTouchSwipeLookForState({
  state,
  deltaX,
  deltaY,
  mouseSensitivity,
}: {
  state: GrifballRuntimeState;
  deltaX: number;
  deltaY: number;
  mouseSensitivity: number;
}): void {
  const safeMouseSensitivity = getSafeMouseSensitivity(mouseSensitivity);
  applyLookDeltaForState({
    state,
    deltaX,
    deltaY,
    sensitivity: 0.003 * safeMouseSensitivity,
    maxDelta: MAX_TOUCH_LOOK_DELTA,
    maxRadians: getMaxLookRadiansForSensitivity(safeMouseSensitivity),
  });
}

export function createPlayerLookInputHandlersForState({
  canvas,
  getState,
  getKeybindings,
  isPlaying,
  isPaused,
  isPointerLocked,
  isMouseDown,
  lastMousePos,
  setShowPointerLockAlert,
}: {
  canvas: HTMLCanvasElement;
  getState: () => GrifballRuntimeState;
  getKeybindings: () => Keybindings;
  isPlaying: () => boolean;
  isPaused: () => boolean;
  isPointerLocked: MutableRef<boolean>;
  isMouseDown: MutableRef<boolean>;
  lastMousePos: MutableRef<MousePosition>;
  setShowPointerLockAlert: (show: boolean) => void;
}) {
  let lookTouchId: number | null = null;
  let lastTouchX = 0;
  let lastTouchY = 0;

  const handlePointerLockChange = () => {
    if (document.pointerLockElement === canvas) {
      isPointerLocked.current = true;
      isMouseDown.current = false;
      setShowPointerLockAlert(false);
    } else {
      isPointerLocked.current = false;
      isMouseDown.current = false;
      setShowPointerLockAlert(true);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPlaying() || isPaused()) return;

    if (isPointerLocked.current) {
      const keybindings = getKeybindings();
      applyPointerLockMouseLookForState({
        state: getState(),
        movementX: e.movementX,
        movementY: e.movementY,
        mouseSensitivity: keybindings.mouseSensitivity ?? 1.0,
        mouseAcceleration: keybindings.mouseAcceleration ?? 0.0,
      });
    } else if (isMouseDown.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;

      applyDragMouseLookForState({
        state: getState(),
        deltaX: dx,
        deltaY: dy,
        mouseSensitivity: getKeybindings().mouseSensitivity ?? 1.0,
      });

      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseDownFallback = (e: MouseEvent) => {
    if (!isPointerLocked.current) {
      isMouseDown.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUpFallback = () => {
    isMouseDown.current = false;
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (isPaused() || !isPlaying()) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.clientX > window.innerWidth / 2 && lookTouchId === null) {
        lookTouchId = touch.identifier;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
      }
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isPaused() || !isPlaying() || lookTouchId === null) return;
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      if (touch.identifier === lookTouchId) {
        const dx = touch.clientX - lastTouchX;
        const dy = touch.clientY - lastTouchY;

        applyTouchSwipeLookForState({
          state: getState(),
          deltaX: dx,
          deltaY: dy,
          mouseSensitivity: getKeybindings().mouseSensitivity ?? 1.0,
        });

        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (lookTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  };

  return {
    handlePointerLockChange,
    handleMouseMove,
    handleMouseDownFallback,
    handleMouseUpFallback,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}

export function triggerPointerPrimaryPlayerActionForState({
  state,
  callbacks,
}: {
  state: GrifballRuntimeState;
  callbacks: Pick<
    PlayerWeaponInputCallbacks,
    'triggerPlayerHammerSwing' | 'triggerPlayerPistolFire' | 'triggerPlayerSwordLunge'
  >;
}): void {
  if (state.playerHP <= 0) return;

  if (state.activeWeapon === 'ball' || state.activeWeapon === 'hammer') {
    if (state.pWeaponReady && state.pWeaponState === 'ready' && state.playerDashRemaining <= 0) {
      callbacks.triggerPlayerHammerSwing();
    }
  } else if (state.activeWeapon === 'pistol') {
    if (state.pPistolReady && state.pPistolState === 'ready') {
      callbacks.triggerPlayerPistolFire();
    }
  } else if (state.crosshairColor === 'red' && state.pSwordReady && state.pSwordState === 'ready' && !state.isLunging) {
    callbacks.triggerPlayerSwordLunge();
  }
}

export function triggerPointerAltPlayerActionForState({
  state,
  ballChargingRef,
  ballChargeTimerRef,
  callbacks,
}: {
  state: GrifballRuntimeState;
  ballChargingRef: MutableRef<boolean>;
  ballChargeTimerRef: MutableRef<number>;
  callbacks: Pick<PlayerWeaponInputCallbacks, 'triggerPlayerHammerMelee' | 'triggerPlayerSwordSlash'>;
}): void {
  if (state.playerHP <= 0) return;

  if (state.activeWeapon === 'ball') {
    if (state.grifball.ball.holderId === 'player' && resolveRunnerThrowAllowed(state.settings)) {
      ballChargingRef.current = true;
      ballChargeTimerRef.current = 0;
    }
  } else if (state.activeWeapon === 'sword') {
    if (state.pSwordReady && state.pSwordState === 'ready' && !state.isLunging) {
      callbacks.triggerPlayerSwordSlash();
    }
  } else if (state.activeWeapon === 'hammer' && state.pWeaponReady && state.pWeaponState === 'ready' && state.playerDashRemaining <= 0) {
    callbacks.triggerPlayerHammerMelee();
  }
}

export function triggerMobilePrimaryPlayerActionForState({
  state,
  callbacks,
}: {
  state: GrifballRuntimeState;
  callbacks: Pick<
    PlayerWeaponInputCallbacks,
    'triggerPlayerHammerSwing' | 'triggerPlayerPistolFire' | 'triggerPlayerSwordLunge'
  >;
}): void {
  if (state.playerHP <= 0) return;

  if (state.activeWeapon === 'hammer') {
    if (state.pWeaponReady && state.pWeaponState === 'ready' && state.playerDashRemaining <= 0) {
      callbacks.triggerPlayerHammerSwing();
    }
  } else if (state.activeWeapon === 'pistol') {
    if (state.pPistolReady && state.pPistolState === 'ready') {
      callbacks.triggerPlayerPistolFire();
    }
  } else if (state.crosshairColor === 'red' && state.pSwordReady && state.pSwordState === 'ready' && !state.isLunging) {
    callbacks.triggerPlayerSwordLunge();
  }
}

export function triggerMobileAltPlayerActionForState({
  state,
  callbacks,
}: {
  state: GrifballRuntimeState;
  callbacks: Pick<PlayerWeaponInputCallbacks, 'triggerPlayerHammerMelee' | 'triggerPlayerSwordSlash'>;
}): void {
  if (state.playerHP <= 0) return;

  if (state.activeWeapon === 'sword') {
    if (state.pSwordReady && state.pSwordState === 'ready' && !state.isLunging) {
      callbacks.triggerPlayerSwordSlash();
    }
  } else if (state.activeWeapon === 'hammer' && state.pWeaponReady && state.pWeaponState === 'ready' && state.playerDashRemaining <= 0) {
    callbacks.triggerPlayerHammerMelee();
  }
}

export function handlePointerPlayerActionInputForState({
  state,
  button,
  keybindings,
  ballChargingRef,
  ballChargeTimerRef,
  callbacks,
}: {
  state: GrifballRuntimeState;
  button: number;
  keybindings: Keybindings;
  ballChargingRef: MutableRef<boolean>;
  ballChargeTimerRef: MutableRef<number>;
  callbacks: PlayerWeaponInputCallbacks;
}): void {
  const clickedBtn = MOUSE_BUTTON_BINDINGS[button] || '';
  if (clickedBtn === keybindings.attack) {
    triggerPointerPrimaryPlayerActionForState({ state, callbacks });
  } else if (clickedBtn === keybindings.altAttack) {
    triggerPointerAltPlayerActionForState({
      state,
      ballChargingRef,
      ballChargeTimerRef,
      callbacks,
    });
  }
}

export function handlePointerPlayerActionReleaseForState({
  button,
  keybindings,
  ballChargingRef,
  throwPlayerPass,
}: {
  button: number;
  keybindings: Keybindings;
  ballChargingRef: MutableRef<boolean>;
  throwPlayerPass: () => void;
}): void {
  const releasedBtn = MOUSE_BUTTON_BINDINGS[button] || '';
  if (releasedBtn === keybindings.altAttack && ballChargingRef.current) {
    throwPlayerPass();
  }
}

export function cyclePlayerWheelWeaponForState({
  state,
  swapPlayerWeapon,
}: {
  state: GrifballRuntimeState;
  swapPlayerWeapon: (type: 'hammer' | 'sword') => void;
}): void {
  if (state.playerHP <= 0 || state.isLunging) return;
  const next = state.activeWeapon === 'hammer' ? 'sword' : 'hammer';
  swapPlayerWeapon(next);
}

export function handlePlayerKeyboardActionForState({
  state,
  key,
  rawKey,
  repeat,
  keybindings,
  keysPressed,
  isPaused,
  isPlaying,
  callbacks,
}: {
  state: GrifballRuntimeState;
  key: string;
  rawKey: string;
  repeat: boolean;
  keybindings: Keybindings;
  keysPressed: Record<string, boolean>;
  isPaused: boolean;
  isPlaying: boolean;
  callbacks: PlayerKeyboardActionCallbacks;
}): void {
  if (rawKey === 'Escape') {
    callbacks.onPauseToggle();
  }

  if (key === keybindings.crouch) {
    state.isCrouching = true;
    callbacks.playCrouch();
  }

  if (key === keybindings.scoreboard) {
    state.showScoreboard = true;
    callbacks.pushStatsUpdate();
  }

  if (key === keybindings.weapon1) {
    callbacks.swapPlayerWeapon('hammer');
  }
  if (key === keybindings.weapon2) {
    callbacks.swapPlayerWeapon('sword');
  }

  if (key === keybindings.jump || key === 'spacebar') {
    if (state.playerHP > 0 && !isPaused && isPlaying) {
      const limit = state.settings.hammerJumpAirLimit ?? 1;
      const withinLimit = limit === 10 || (state.pHammerJumpsInAir ?? 0) < limit;

      if (state.pHammerJumpWindowTimer > 0 && limit > 0 && withinLimit) {
        const gate = state.settings.hammerJumpInputGate ?? 0;
        const elapsed = (state.settings.hammerJumpWindow ?? 0.6) - state.pHammerJumpWindowTimer;
        const passesGate = gate === 0 || (!repeat && elapsed <= gate);

        if (passesGate) {
          state.isJumping = true;
          state.playerVel.y = 7.2 + (state.settings.hammerJumpPower ?? 6.5);
          state.pHammerJumpWindowTimer = 0;
          state.pHammerJumpsInAir = (state.pHammerJumpsInAir ?? 0) + 1;
          callbacks.playJump();
          callbacks.spawnVoxelShockwaveParticles(state.playerPos, '#f59e0b');
          return;
        }
      }

      if (!state.isJumping) {
        state.isJumping = true;
        state.playerVel.y = 7.2;
        callbacks.playJump();
      }
    }
  }

  if (key === keybindings.dash) {
    const runnerThrustAllowed =
      state.activeWeapon !== 'ball' ||
      state.grifball.ball.holderId !== 'player' ||
      resolveRunnerThrustAllowed(state.settings);
    if (runnerThrustAllowed && state.playerHP > 0 && !isPaused && isPlaying && state.playerDashCooldownTimer <= 0 && state.playerDashRemaining <= 0) {
      let fMove = 0;
      let rMove = 0;
      if (keysPressed[keybindings.moveForward] || keysPressed['arrowup']) fMove += 1;
      if (keysPressed[keybindings.moveBackward] || keysPressed['arrowdown']) fMove -= 1;
      if (keysPressed[keybindings.moveRight] || keysPressed['arrowright']) rMove += 1;
      if (keysPressed[keybindings.moveLeft] || keysPressed['arrowleft']) rMove -= 1;

      const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
      const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

      const dDir = new THREE.Vector3(0, 0, 0);
      if (fMove !== 0 || rMove !== 0) {
        dDir.addScaledVector(forwardDir, fMove).addScaledVector(rightDir, rMove).normalize();
      } else {
        dDir.copy(forwardDir).normalize();
      }

      state.playerDashDir.copy(dDir);
      state.playerDashRemaining = state.settings.dashDuration || 0.25;
      state.playerDashCooldownTimer = state.settings.dashCooldown || 2.0;
      callbacks.recordDashObservation(dDir);
      callbacks.playDash();
    }
  }
}

export function handlePlayerKeyboardReleaseForState({
  state,
  key,
  keybindings,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  key: string;
  keybindings: Keybindings;
  pushStatsUpdate: () => void;
}): void {
  if (key === keybindings.crouch) {
    state.isCrouching = false;
  }

  if (key === keybindings.scoreboard) {
    state.showScoreboard = false;
    pushStatsUpdate();
  }
}

export function getPrimaryGamepad(): Gamepad | null {
  const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) return gamepads[i];
  }
  return null;
}

export function applyMobileRightJoystickLookForState({
  state,
  joystick,
  active,
  mouseSensitivity,
  dt,
}: {
  state: GrifballRuntimeState;
  joystick: JoystickVector | null;
  active: boolean;
  mouseSensitivity: number;
  dt: number;
}): void {
  if (!active || !joystick) return;
  const baseAimSens = 2.4 * getSafeMouseSensitivity(mouseSensitivity);
  const safeDt = clampNumber(dt, 0, MAX_LOOK_DT);
  state.yaw -= clampSymmetric(joystick.x, 1) * baseAimSens * safeDt;
  state.pitch -= clampSymmetric(joystick.y, 1) * baseAimSens * safeDt;
  state.pitch = clampPitch(state.pitch);
}

export function applyGamepadLookForState({
  state,
  gamepad,
  keybindings,
  dt,
}: {
  state: GrifballRuntimeState;
  gamepad: Gamepad | null;
  keybindings: Keybindings;
  dt: number;
}): void {
  if (!gamepad) return;

  const rx = gamepad.axes[2];
  const ry = gamepad.axes[3];
  if (Math.abs(rx) <= GAMEPAD_DEADZONE && Math.abs(ry) <= GAMEPAD_DEADZONE) return;

  const gpSens = getSafeGamepadSensitivity(keybindings.gamepadSensitivity ?? 3.0);
  const gpAccel = getSafeLookAcceleration(keybindings.gamepadAcceleration ?? 0.0);
  const baseSpeed = 2.4;
  const safeDt = clampNumber(dt, 0, MAX_LOOK_DT);

  const applyAccel = (val: number) => {
    if (gpAccel === 0) return val;
    const absVal = Math.abs(val);
    const sign = val < 0 ? -1 : 1;
    return sign * Math.pow(absVal, 1 + gpAccel * 0.5);
  };

  let targetYawOffset = 0;
  let targetPitchOffset = 0;
  if (Math.abs(rx) > GAMEPAD_DEADZONE) {
    targetYawOffset = applyAccel(clampSymmetric(rx, 1)) * baseSpeed * gpSens * safeDt;
  }
  if (Math.abs(ry) > GAMEPAD_DEADZONE) {
    targetPitchOffset = applyAccel(clampSymmetric(ry, 1)) * baseSpeed * gpSens * safeDt;
  }

  state.yaw -= targetYawOffset;
  state.pitch -= targetPitchOffset;
  state.pitch = clampPitch(state.pitch);
}

export function updateFreeObserverMovementForState({
  state,
  keysPressed,
  keyboardKeybindings,
  gamepadKeybindings,
  gamepad,
  dt,
}: {
  state: GrifballRuntimeState;
  keysPressed: Record<string, boolean>;
  keyboardKeybindings: Keybindings;
  gamepadKeybindings: Keybindings;
  gamepad: Gamepad | null;
  dt: number;
}): void {
  if (state.observerCamMode !== 'free') return;

  const forwardDir = new THREE.Vector3(0, 0, -1)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
    .normalize();
  const rightDir = new THREE.Vector3(1, 0, 0)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
    .normalize();
  const upDir = new THREE.Vector3(0, 1, 0);

  let moveForward = 0;
  let moveRight = 0;
  let moveUp = 0;
  if (keysPressed[keyboardKeybindings.moveForward] || keysPressed['arrowup']) moveForward += 1;
  if (keysPressed[keyboardKeybindings.moveBackward] || keysPressed['arrowdown']) moveForward -= 1;
  if (keysPressed[keyboardKeybindings.moveRight] || keysPressed['arrowright']) moveRight += 1;
  if (keysPressed[keyboardKeybindings.moveLeft] || keysPressed['arrowleft']) moveRight -= 1;

  if (gamepad) {
    const lx = gamepad.axes[0];
    const ly = gamepad.axes[1];
    if (Math.abs(ly) > GAMEPAD_DEADZONE) moveForward -= ly;
    if (Math.abs(lx) > GAMEPAD_DEADZONE) moveRight += lx;
  }

  const gpJump = gamepad ? gamepad.buttons[gamepadKeybindings.gamepadJump ?? 0]?.pressed : false;
  const gpCrouch = gamepad ? gamepad.buttons[gamepadKeybindings.gamepadCrouch ?? 1]?.pressed : false;
  if (keysPressed[keyboardKeybindings.jump] || keysPressed['spacebar'] || gpJump) moveUp += 1;
  if (keysPressed[keyboardKeybindings.crouch] || gpCrouch) moveUp -= 1;

  const gpSprint = gamepad ? gamepad.buttons[gamepadKeybindings.gamepadSprint ?? 10]?.pressed : false;
  const speedMultiplier = keysPressed['shift'] || gpSprint ? 2.8 : 1.0;
  const flySpeed = 11.0 * speedMultiplier * dt;

  state.playerPos.addScaledVector(forwardDir, moveForward * flySpeed);
  state.playerPos.addScaledVector(rightDir, moveRight * flySpeed);
  state.playerPos.addScaledVector(upDir, moveUp * flySpeed);
}
