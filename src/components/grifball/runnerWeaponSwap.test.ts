import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from './grifballObjectiveRuntime';
import { swapPlayerWeaponForState, type PlayerSwappableWeapon } from './playerWeaponActions';
import { cyclePlayerWheelWeaponForState, triggerMobilePrimaryPlayerActionForState } from './playerInputRuntime';
import { buildGrifballHudStats } from './hudStats';

const noop = () => {};
function fixture() {
  const state = createInitialGrifballRuntimeState({
    debugMode: false, isMultiplayer: false, multiplayerRole: null,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', weaponReadyTime: 0.5, weaponSwapLockout: 1 },
  });
  state.otherPlayers.clear();
  state.grifball.phase = 'playing';
  state.playerPos.set(0, 0, 0);
  const refs = createInitialGrifballThreeRefs();
  refs.playerHammer = new THREE.Group();
  refs.playerSword = new THREE.Group();
  refs.playerPistol = new THREE.Group();
  const ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const tick = () => updateGrifballObjectiveForState({
    state, refs, ballChargingRef, ballChargeTimerRef, ballMeshRef: { current: null },
    dt: 0, isMultiplayer: false, activeCustomMap: null,
    placeCombatantsAtGrifballSpawns: noop, pushStatsUpdate: noop,
  });
  const swap = (type: PlayerSwappableWeapon, isPaused = false, isPlaying = true) => swapPlayerWeaponForState({
    state, refs, type, isPaused, isPlaying, recordWeaponSwap: noop, pushStatsUpdate: noop,
    cancelBallCharge: () => { ballChargingRef.current = false; ballChargeTimerRef.current = 0; },
  });
  const pickup = () => { state.playerPickupRequested = true; tick(); };
  return { state, refs, ballChargingRef, ballChargeTimerRef, tick, swap, pickup };
}

for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
  test(`runner swap restores pre-pickup ${weapon}, cancels charge and leaves a loose ball`, () => {
    const f = fixture(), { state, refs } = f;
    state.activeWeapon = weapon;
    f.pickup();
    assert.equal(state.activeWeapon, 'ball');
    assert.equal(state.playerWeaponBeforeBall, weapon);
    assert.equal(refs.playerHammer!.visible || refs.playerSword!.visible || refs.playerPistol!.visible, false);
    // A repeated carrier update must not overwrite the remembered weapon with the ball.
    setGrifballCarrierForState({ state, refs, id: 'player', carrying: true });
    state.settings.grifballAllowThrowing = false;
    f.ballChargingRef.current = true;
    f.ballChargeTimerRef.current = 0.8;
    state.grifballPassCharge = 0.8;
    state.playerPickupRequested = true;
    cyclePlayerWheelWeaponForState({ state, swapPlayerWeapon: f.swap });
    assert.equal(state.activeWeapon, weapon);
    assert.equal(state.grifball.ball.state, 'loose');
    assert.equal(state.grifball.ball.holderId, null);
    assert.deepEqual(state.grifball.ball.vel, { x: 0, y: 0, z: 0 });
    assert.equal(state.playerMaxHP, state.settings.maxHP);
    assert.equal(state.grifballPassCharge, 0);
    assert.equal(f.ballChargingRef.current, false);
    assert.equal(f.ballChargeTimerRef.current, 0);
    assert.equal(refs.playerHammer!.visible, weapon === 'hammer');
    assert.equal(refs.playerSword!.visible, weapon === 'sword');
    assert.equal(refs.playerPistol!.visible, weapon === 'pistol');
    assert.equal(state.swapCooldownTimer, 0.5);
    assert.equal(state.swapLockoutTimer, 1);
    f.tick();
    assert.equal(state.grifball.ball.holderId, null, 'queued pickup cannot immediately undo the drop');

    state.swapLockoutTimer = 0;
    const next = weapon === 'hammer' ? 'sword' : 'hammer';
    f.swap(next);
    assert.equal(state.activeWeapon, next, 'subsequent swaps select the requested weapon');
    state.swapLockoutTimer = 0;
    f.pickup();
    f.swap(weapon);
    assert.equal(state.activeWeapon, next, 'each new pickup remembers the currently equipped weapon');
  });
}

for (const blocked of ['paused', 'not-playing', 'dead', 'lunging', 'lockout'] as const) {
  test(`${blocked} swap cannot drop possession`, () => {
    const f = fixture();
    f.pickup();
    if (blocked === 'dead') f.state.playerHP = 0;
    if (blocked === 'lunging') f.state.isLunging = true;
    if (blocked === 'lockout') f.state.swapLockoutTimer = 1;
    f.swap('sword', blocked === 'paused', blocked !== 'not-playing');
    assert.equal(f.state.grifball.ball.holderId, 'player');
    assert.equal(f.state.activeWeapon, 'ball');
  });
}

test('HUD stats preserve the ball selection and use the punch cooldown', () => {
  const f = fixture();
  f.pickup();
  f.state.pWeaponReady = false;
  f.state.pWeaponCooldown = 0.25;
  f.state.pSwordReady = true;
  const stats = buildGrifballHudStats({
    state: f.state, opponent: undefined, isMultiplayer: false, multiplayerRole: null,
    opponentConnected: false, fps: 60, observerTargetName: '', opponentPlayerName: undefined,
  });
  assert.equal(stats.activeWeapon, 'ball');
  assert.equal(stats.weaponReady, false);
  assert.equal(stats.weaponCooldown, 0.25);
});

test('mobile primary action uses the runner punch while the ball is selected', () => {
  const f = fixture();
  f.pickup();
  let punches = 0;
  triggerMobilePrimaryPlayerActionForState({
    state: f.state,
    callbacks: {
      triggerPlayerHammerSwing: () => { punches++; },
      triggerPlayerPistolFire: () => assert.fail('runner cannot fire'),
      triggerPlayerSwordLunge: () => assert.fail('runner cannot lunge'),
    },
  });
  assert.equal(punches, 1);
});
