import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDragMouseLookForState,
  applyGamepadLookForState,
  applyMobileRightJoystickLookForState,
  applyPointerLockMouseLookForState,
  applyTouchSwipeLookForState,
} from './playerInputRuntime';
import type { GrifballRuntimeState } from './runtimeState';

function makeLookState(overrides: Partial<GrifballRuntimeState> = {}): GrifballRuntimeState {
  return {
    yaw: 0,
    pitch: 0,
    ...overrides,
  } as GrifballRuntimeState;
}

function makeGamepad(overrides: Partial<Gamepad> = {}): Gamepad {
  return {
    axes: [0, 0, 0, 0],
    buttons: [],
    connected: true,
    hapticActuators: [],
    id: 'test-gamepad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
    ...overrides,
  } as unknown as Gamepad;
}

function assertNear(actual: number, expected: number): void {
  assert.equal(Math.abs(actual - expected) < 1e-12, true);
}

test('pointer-lock mouse look preserves normal linear sensitivity', () => {
  const state = makeLookState();

  applyPointerLockMouseLookForState({
    state,
    movementX: 10,
    movementY: -5,
    mouseSensitivity: 1,
    mouseAcceleration: 0,
  });

  assertNear(state.yaw, -0.022);
  assertNear(state.pitch, 0.011);
});

test('pointer-lock mouse look clamps pathological accelerated deltas', () => {
  const state = makeLookState();

  applyPointerLockMouseLookForState({
    state,
    movementX: 5000,
    movementY: -5000,
    mouseSensitivity: 1,
    mouseAcceleration: 2,
  });

  assert.equal(state.yaw, -0.75);
  assert.equal(state.pitch, 0.75);
});

test('drag and touch look clamp stale position jumps', () => {
  const dragState = makeLookState();
  const touchState = makeLookState();

  applyDragMouseLookForState({
    state: dragState,
    deltaX: 5000,
    deltaY: -5000,
    mouseSensitivity: 1,
  });
  applyTouchSwipeLookForState({
    state: touchState,
    deltaX: 5000,
    deltaY: -5000,
    mouseSensitivity: 1,
  });

  assert.equal(dragState.yaw, -0.75);
  assert.equal(dragState.pitch, 0.75);
  assert.equal(touchState.yaw, -0.42);
  assert.equal(touchState.pitch, 0.42);
});

test('stick look clamps frame hitches and invalid axes', () => {
  const mobileState = makeLookState();
  const gamepadState = makeLookState();

  applyMobileRightJoystickLookForState({
    state: mobileState,
    joystick: { x: 4, y: -4 },
    active: true,
    mouseSensitivity: 5,
    dt: 10,
  });
  applyGamepadLookForState({
    state: gamepadState,
    gamepad: makeGamepad({ axes: [0, 0, 4, -4] }),
    keybindings: {
      moveForward: 'w',
      moveLeft: 'a',
      moveBackward: 's',
      moveRight: 'd',
      jump: ' ',
      dash: 'q',
      crouch: 'c',
      scoreboard: 'u',
      weapon1: '1',
      weapon2: '2',
      attack: 'lmb',
      altAttack: 'rmb',
      sprint: 'shift',
      gamepadSensitivity: 10,
      gamepadAcceleration: 0,
    },
    dt: 10,
  });

  assertNear(mobileState.yaw, -0.6);
  assertNear(mobileState.pitch, 0.6);
  assertNear(gamepadState.yaw, -1.2);
  assertNear(gamepadState.pitch, 1.2);
});
