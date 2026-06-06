import * as THREE from 'three';
import { type Keybindings } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

type JoystickVector = {
  x: number;
  y: number;
};

const LOOK_PITCH_LIMIT = Math.PI / 2.3;
const GAMEPAD_DEADZONE = 0.18;

function clampPitch(pitch: number): number {
  return Math.max(-LOOK_PITCH_LIMIT, Math.min(LOOK_PITCH_LIMIT, pitch));
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
  const baseAimSens = 2.4 * mouseSensitivity;
  state.yaw -= joystick.x * baseAimSens * dt;
  state.pitch -= joystick.y * baseAimSens * dt;
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

  const gpSens = keybindings.gamepadSensitivity ?? 3.0;
  const gpAccel = keybindings.gamepadAcceleration ?? 0.0;
  const baseSpeed = 2.4;

  const applyAccel = (val: number) => {
    if (gpAccel === 0) return val;
    const absVal = Math.abs(val);
    const sign = val < 0 ? -1 : 1;
    return sign * Math.pow(absVal, 1 + gpAccel * 0.5);
  };

  let targetYawOffset = 0;
  let targetPitchOffset = 0;
  if (Math.abs(rx) > GAMEPAD_DEADZONE) {
    targetYawOffset = applyAccel(rx) * baseSpeed * gpSens * dt;
  }
  if (Math.abs(ry) > GAMEPAD_DEADZONE) {
    targetPitchOffset = applyAccel(ry) * baseSpeed * gpSens * dt;
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
