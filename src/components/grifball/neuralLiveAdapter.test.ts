import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getForwardHeadingForYaw } from '../../game/yaw';
import { createInitialGrifballRuntimeState } from './runtimeState';
import {
  buildLiveCombatSimState,
  liveWeaponStateToSim,
  liveYawToSimYaw,
  resolveNeuralPlanarVelocity,
  simYawToLiveYaw,
} from './neuralLiveAdapter';

test('buildLiveCombatSimState mirrors live player and main_ai into v1 combat observations', () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    isMultiplayer: false,
    multiplayerRole: null,
  });
  const bot = {
    id: 'main_ai',
    playerName: 'CombatDRV2',
    controller: 'ai' as const,
    difficulty: 'neural-net',
    team: 'red',
    pos: new THREE.Vector3(0, 0, -5),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    hp: 1,
    maxHp: 1,
    isCrouching: false,
    activeWeapon: 'hammer' as const,
    weaponState: 'ready' as const,
    respawnTimer: 0,
    hue: 0,
    score: 0,
    kills: 0,
    deaths: 0,
  };
  state.otherPlayers.set('main_ai', bot);

  const sim = buildLiveCombatSimState(state, 'main_ai', null);

  assert.ok(sim);
  assert.equal(sim.mode, 'combat');
  assert.deepEqual(sim.combatants.map((c) => c.id), ['player', 'main_ai']);
  assert.equal(sim.combatants[0].team, 't0');
  assert.equal(sim.combatants[1].team, 't1');
  assert.equal(sim.match.goalTarget, DEFAULT_ADMIN_SETTINGS.iBrawlsKillTarget);
  assert.equal(sim.combatants[1].yaw, liveYawToSimYaw(bot.yaw));
});

test('liveWeaponStateToSim collapses render-only weapon phases', () => {
  assert.equal(liveWeaponStateToSim('ready'), 'idle');
  assert.equal(liveWeaponStateToSim('swing_up'), 'windup');
  assert.equal(liveWeaponStateToSim('swing_down'), 'active');
  assert.equal(liveWeaponStateToSim('recovering'), 'recovering');
});

test('resolveNeuralPlanarVelocity applies ego-relative policy movement', () => {
  const velocity = resolveNeuralPlanarVelocity({
    moveX: 1,
    moveZ: 0,
    aim: 0,
    jump: false,
    dash: false,
    crouch: false,
    attackPrimary: false,
    attackSecondary: false,
    passCharge: 0,
    swapWeapon: false,
  }, 0, DEFAULT_ADMIN_SETTINGS, 'hammer', false);

  assert.ok(velocity.x > 0);
  assert.equal(Math.round(velocity.z * 1000) / 1000, 0);
});

test('sim policy yaw is converted to the live negative-Z yaw convention', () => {
  const policyYaw = 0;
  const liveYaw = simYawToLiveYaw(policyYaw);
  const liveForward = getForwardHeadingForYaw(liveYaw);

  assert.ok(Math.abs(liveForward.x) < 1e-9);
  assert.ok(liveForward.z > 0.999);

  const velocity = resolveNeuralPlanarVelocity({
    moveX: 0,
    moveZ: 1,
    aim: 0,
    jump: false,
    dash: false,
    crouch: false,
    attackPrimary: false,
    attackSecondary: false,
    passCharge: 0,
    swapWeapon: false,
  }, policyYaw, DEFAULT_ADMIN_SETTINGS, 'hammer', false);

  assert.ok(Math.abs(velocity.x) < 1e-9);
  assert.ok(velocity.z > 0);
});
