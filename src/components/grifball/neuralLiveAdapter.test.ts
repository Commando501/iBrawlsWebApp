import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getForwardHeadingForYaw } from '../../game/yaw';
import { createInitialGrifballRuntimeState } from './runtimeState';
import {
  buildLiveCombatSimState,
  advanceNeuralLiveCooldowns,
  buildNeuralLiveFrameTelemetry,
  liveWeaponStateToSim,
  liveYawToSimYaw,
  resolveNeuralPlanarVelocity,
  shouldSuppressNeuralLiveAction,
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

test('advanceNeuralLiveCooldowns releases expired neural attack cooldowns', () => {
  const frame = advanceNeuralLiveCooldowns({
    aiState: 'COOLDOWN',
    aiTimer: 0.05,
    dashCooldownTimer: 0.25,
    slideCooldownTimer: 0.15,
    hammerJumpCooldownTimer: 0.35,
    swapLockoutTimer: 0.2,
    swapCooldownTimer: 0.3,
    dt: 0.1,
    tickSwapTimers: true,
  });

  assert.equal(frame.aiState, 'APPROACHING');
  assert.equal(frame.aiTimer, 0);
  assert.equal(Math.round(frame.dashCooldownTimer * 100) / 100, 0.15);
  assert.equal(Math.round(frame.slideCooldownTimer * 100) / 100, 0.05);
  assert.equal(Math.round(frame.hammerJumpCooldownTimer * 100) / 100, 0.25);
  assert.equal(Math.round(frame.swapLockoutTimer * 100) / 100, 0.1);
  assert.equal(Math.round(frame.swapCooldownTimer * 100) / 100, 0.2);
});

test('buildNeuralLiveFrameTelemetry separates requested and applied actions', () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    isMultiplayer: false,
    multiplayerRole: null,
  });
  state.playerPos.set(0, 0, 0);
  state.playerHP = 1;
  state.playerRespawnTimer = 0;
  state.playerInvulnerabilityTimer = 0.25;

  const bot = {
    id: 'main_ai',
    playerName: 'CombatDRV2',
    controller: 'ai' as const,
    difficulty: 'neural-net',
    team: 'red',
    pos: new THREE.Vector3(0, 0, 3),
    vel: new THREE.Vector3(1, 0, 2),
    yaw: Math.PI,
    hp: 1,
    maxHp: 1,
    isCrouching: false,
    isJumping: false,
    activeWeapon: 'hammer' as const,
    weaponState: 'ready' as const,
    weaponTimer: 0,
    swapLockoutTimer: 0,
    swapCooldownTimer: 0.25,
    invulnerabilityTimer: 0,
    respawnTimer: 0,
    aiState: 'COOLDOWN' as const,
    aiTimer: 0.4,
    hue: 0,
    score: 0,
    kills: 0,
    deaths: 0,
  };

  const frame = buildNeuralLiveFrameTelemetry({
    state,
    self: bot,
    action: {
      moveX: 0,
      moveZ: 1,
      aim: 0,
      jump: true,
      dash: false,
      crouch: false,
      attackPrimary: true,
      attackSecondary: false,
      passCharge: 0,
      swapWeapon: false,
    },
    decisionReused: false,
    policyYaw: 0,
    liveYaw: Math.PI,
    planarSpeed: 4,
    canStartWeaponAction: false,
    jumpApplied: false,
    dashStarted: false,
    attackStarted: false,
    swapStarted: false,
  });

  assert.equal(frame.distanceToPlayer, 3);
  assert.equal(frame.targetAlive, true);
  assert.equal(frame.targetInvulnerabilityTimer, 0.25);
  assert.equal(frame.selfAiState, 'COOLDOWN');
  assert.equal(frame.selfAiTimer, 0.4);
  assert.equal(frame.selfCanStartWeaponAction, false);
  assert.equal(frame.selfSwapLockoutTimer, 0);
  assert.equal(frame.selfSwapCooldownTimer, 0.25);
  assert.equal(frame.selfWeaponActionGate, 'ai_cooldown');
  assert.equal(frame.attackRequested, true);
  assert.equal(frame.attackStarted, false);
  assert.equal(frame.jumpRequested, true);
  assert.equal(frame.jumpApplied, false);
  assert.equal(frame.planarSpeed, 4);
});

test('dead live player suppresses neural target engagement and exposes raw target health', () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    isMultiplayer: false,
    multiplayerRole: null,
  });
  state.playerHP = 0;
  state.playerMaxHP = 1;
  state.playerRespawnTimer = 2.5;
  state.playerInvulnerabilityTimer = 0;

  assert.equal(shouldSuppressNeuralLiveAction(state), true);

  const frame = buildNeuralLiveFrameTelemetry({
    state,
    self: {
      pos: new THREE.Vector3(0, 0, 2),
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 1,
      maxHp: 1,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      respawnTimer: 0,
    },
    action: {
      moveX: 0,
      moveZ: 0,
      aim: 0,
      jump: false,
      dash: false,
      crouch: false,
      attackPrimary: false,
      attackSecondary: false,
      passCharge: 0,
      swapWeapon: false,
    },
    decisionReused: false,
    policyYaw: 0,
    liveYaw: Math.PI,
    planarSpeed: 0,
    canStartWeaponAction: false,
    jumpApplied: false,
    dashStarted: false,
    attackStarted: false,
    swapStarted: false,
  });

  assert.equal(frame.targetAlive, false);
  assert.equal(frame.targetHp, 0);
  assert.equal(frame.targetMaxHp, 1);
  assert.equal(frame.targetActionSuppressed, true);
});
