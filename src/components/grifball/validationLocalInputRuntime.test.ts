import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYBINDINGS } from '../../types';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { applyValidationLocalInput } from './validationLocalInputRuntime';
import { triggerPlayerHammerSwingForState } from './playerWeaponActions';

function fixture() {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, isMultiplayer: false, multiplayerRole: null });
  state.grifball.phase = 'playing'; state.pWeaponReady = true;
  const keys: Record<string, boolean> = {};
  let swings = 0;
  const callbacks = { triggerPlayerHammerSwing: () => triggerPlayerHammerSwingForState({ state,
    recordHammerAttack: () => { swings++; }, playSwing: () => {}, sendSync: () => {} }),
    triggerPlayerPistolFire: () => { throw new Error('Unexpected pistol input'); },
    triggerPlayerSwordLunge: () => { throw new Error('Unexpected sword input'); } };
  return { state, keys, apply: () => applyValidationLocalInput(state, keys, { forward: true, yaw: .75, attack: 'primary', pickup: true }, callbacks), swings: () => swings };
}

test('validation input uses production readiness and requests without applying physics or objective results', () => {
  for (const weapon of ['hammer', 'ball'] as const) {
    const { state, keys, apply, swings } = fixture(); state.activeWeapon = weapon;
    const before = { pos: state.playerPos.clone(), vel: state.playerVel.clone(), hp: state.playerHP,
      ball: state.grifball.ball.holderId, goals: structuredClone(state.teamScores) };
    apply();
    assert.equal(keys[DEFAULT_KEYBINDINGS.moveForward], true); assert.equal(state.yaw, .75);
    assert.equal(state.playerPickupRequested, true); assert.equal(state.pWeaponState, 'swing_up');
    assert.equal(state.pWeaponReady, false);
    apply(); assert.equal(swings(), 1, 'holding an input cannot restart an unready attack');
    assert.deepEqual({ pos: state.playerPos, vel: state.playerVel, hp: state.playerHP,
      ball: state.grifball.ball.holderId, goals: state.teamScores }, before);
  }
});

test('validation input respects dead, respawning, observer and inactive local ownership', () => {
  for (const patch of [{ playerHP: 0 }, { playerRespawnTimer: 1 }, { isObserverMode: true }, { inactive: true }]) {
    const { state, keys, apply, swings } = fixture();
    if ('inactive' in patch) state.grifball.phase = 'countdown'; else Object.assign(state, patch);
    apply(); assert.deepEqual(keys, {}); assert.equal(swings(), 0); assert.equal(state.playerPickupRequested, false);
  }
});

test('production cooldown and dash commitments reject validation attack requests', () => {
  for (const patch of [{ swapCooldownTimer: 1 }, { playerDashRemaining: .2 }, { pWeaponReady: false }]) {
    const { state, apply, swings } = fixture(); Object.assign(state, patch);
    apply(); assert.equal(swings(), 0); assert.equal(state.pWeaponState, 'ready');
  }
});
