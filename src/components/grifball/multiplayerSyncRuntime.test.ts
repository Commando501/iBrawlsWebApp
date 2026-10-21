import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createMultiplayerSyncMessageHandler } from './multiplayerSyncRuntime';
import { createOfflineBotCombatant } from '../../game/roster';
import { prepareRunnerSwordPrediction, recordRunnerSwordPrediction, rejectRunnerSwordPrediction } from './runnerSwordPrediction';

const createHandler = (
  capturedRemoteUpdates: unknown[],
  state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: 'host',
    isMultiplayer: true,
  })
) => createMultiplayerSyncMessageHandler({
  stateRef: { current: state },
  refs: createInitialGrifballThreeRefs(),
  multiplayerRole: state.multiplayerRole,
  secretAudioRef: { current: null },
  createOrUpdateRemotePlayer: (_clientId, data) => {
    capturedRemoteUpdates.push(data);
  },
  resizeArena: () => {},
  pushStatsUpdate: () => {},
  rebuildHostModel: () => {},
  rebuildEnemyModel: () => {},
  spawnVoxelShockwaveParticles: () => {},
  renderHammerSplashVfx: () => {},
  triggerEnemyHammerSwing: () => {},
  triggerEnemyHammerMelee: () => {},
  triggerEnemySwordSlash: () => {},
  triggerEnemySwordLunge: () => {},
  recordPlayerDamageTaken: () => {},
  playSwing: () => {},
  playDash: () => {},
  playDeath: () => {},
  onPauseToggle: () => {},
});

const emit = (handler: (event: MessageEvent) => void, data: unknown) => {
  handler({ data: JSON.stringify(data) } as MessageEvent);
};

for (const role of ['host', 'client', 'observer'] as const) {
  test(`remote hammer explosion is resolved by ${role === 'host' ? 'the host' : 'no follower'} (${role})`, () => {
    const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: true,
      multiplayerRole: role === 'observer' ? null : role, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', hammerBallDeflectionStrength: 2 } });
    state.multiplayerRole = role;
    state.grifball.phase = 'playing';
    const attacker = createOfflineBotCombatant({ id: 'attacker', playerName: 'Remote', team: 'red',
      spawnPos: new THREE.Vector3(), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
    attacker.activeWeapon = 'hammer'; attacker.hp = 1; attacker.respawnTimer = 0; attacker.controller = 'remote';
    state.otherPlayers.set(attacker.id, attacker);
    const ball = state.grifball.ball;
    ball.state = 'thrown'; ball.pos = { x: 0, y: 0, z: -3 }; ball.vel = { x: 0, y: 0, z: 20 };
    const handler = createHandler([], state);
    const message = { type: 'sync', action: 'hammer_impact', senderId: attacker.id,
      pos: { x: 0, y: 1.65, z: -3.2 }, radius: 1000 };
    emit(handler, { ...message, weapon: 'ball' });
    assert.equal(ball.vel.z, 20, 'punch VFX must not deflect');
    emit(handler, { ...message, weapon: 'hammer' });
    assert.equal(ball.vel.z, role === 'host' ? -40 : 20);
    ball.pos.z = -100; ball.vel.z = 20;
    emit(handler, { ...message, weapon: 'hammer' });
    assert.equal(ball.vel.z, 20, 'host damage radius overrides a client-supplied VFX radius');
  });
}

for (const weapon of ['sword', 'hammer'] as const) {
  for (const hp of [2, 7.5, 100]) test(`online ${weapon} hit against a ${hp} HP runner`, () => {
    const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: true,
      multiplayerRole: 'client', adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' } });
    state.playerHP = state.playerMaxHP = hp; state.playerInvulnerabilityTimer = 0;
    state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'player';
    emit(createHandler([], state), { type: 'sync', action: 'hit_taken', senderId: 'attacker',
      targetId: 'local-client-id', weapon, damage: 1 });
    assert.equal(state.playerHP, weapon === 'sword' ? 0 : hp - 1);
    assert.equal(state.playerDeaths, weapon === 'sword' ? 1 : 0);
  });
}

for (const phase of ['swing_up', 'swing_down', 'recovering', 'ready'] as const)
  test(`online runner punch clash: ${phase}`, () => {
    const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: true,
      multiplayerRole: 'client', adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' } });
    state.playerHP = state.playerMaxHP = 3; state.playerInvulnerabilityTimer = 0;
    state.playerPos.set(0, 0, 0); state.yaw = state.pitch = state.crouchAmount = 0;
    state.activeWeapon = 'ball'; state.pWeaponState = phase;
    state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'player';
    const attacker = createOfflineBotCombatant({ id: 'attacker', playerName: 'Sword', team: 'red',
      spawnPos: new THREE.Vector3(0, 0, -1), yaw: Math.PI, hue: 0, difficulty: 'normal', settings: state.settings });
    attacker.controller = 'remote'; attacker.activeWeapon = 'sword'; attacker.weaponState = 'swing_down';
    attacker.hp = attacker.maxHp = 2; attacker.invulnerabilityTimer = attacker.respawnTimer = 0;
    state.otherPlayers.set(attacker.id, attacker);
    const sent: any[] = [];
    createHandler([], state)({ data: JSON.stringify({ type: 'sync', action: 'hit_taken', senderId: attacker.id,
      targetId: 'local-client-id', weapon: 'sword', damage: 3, hitId: '17' }),
      currentTarget: { readyState: 1, send: (text: string) => sent.push(JSON.parse(text)) } } as unknown as MessageEvent);
    const wins = phase === 'swing_up' || phase === 'swing_down';
    assert.equal(state.playerHP, wins ? 3 : 0);
    assert.equal(attacker.hp, wins ? 1 : 2);
    assert.equal(sent.length, Number(wins));
    if (wins) {
      assert.equal(state.pWeaponState, 'recovering');
      assert.equal(attacker.weaponState, 'recovering');
      assert.deepEqual(sent[0], { type: 'sync', action: 'hit_taken', targetId: attacker.id,
        weapon: 'ball', damage: 1, negatedSwordHitId: '17', runnerHp: 3 });
    }
  });

test('a clash reply reverses only its matching predicted runner kill, once', () => {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: true,
    multiplayerRole: 'host', adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' } });
  const runner = createOfflineBotCombatant({ id: 'runner', playerName: 'Runner', team: 'red',
    spawnPos: new THREE.Vector3(), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  state.otherPlayers.set(runner.id, runner);
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = runner.id;
  const hitId = prepareRunnerSwordPrediction(state, runner.id);
  runner.hp = 0; runner.respawnTimer = 3; runner.deaths = 1;
  state.playerKills = state.scorePlayer = 1;
  state.lastDeaths = [{ id: 'predicted', attacker: 'Sword', victim: 'Runner' }];
  recordRunnerSwordPrediction(state, hitId);
  rejectRunnerSwordPrediction(state, 'unrelated', hitId, 3);
  assert.equal(state.playerKills, 1);
  const reply = { type: 'sync', action: 'hit_taken', senderId: runner.id, targetId: 'local-client-id',
    weapon: 'ball', damage: 1, negatedSwordHitId: hitId, runnerHp: 3 };
  emit(createHandler([], state), reply);
  assert.equal(runner.hp, 3); assert.equal(runner.respawnTimer, 0); assert.equal(runner.deaths, 0);
  assert.equal(state.playerKills, 0); assert.equal(state.scorePlayer, 0); assert.equal(state.lastDeaths.length, 1);
  assert.notEqual(state.lastDeaths[0]?.id, 'predicted', 'only the sword user death remains');
  state.playerKills = state.scorePlayer = 2;
  rejectRunnerSwordPrediction(state, runner.id, hitId, 3);
  assert.equal(state.playerKills, 2, 'duplicate rejection cannot remove later kills');
});

test('connected roster updates carry the lobby visual model policy', () => {
  const capturedRemoteUpdates: unknown[] = [];
  const handler = createHandler(capturedRemoteUpdates);

  emit(handler, {
    type: 'connected',
    role: 'host',
    lobbyConfig: {
      access: 'open',
      gameMode: 'sandbox',
      selectedMap: 'hangar',
      customMap: null,
      maxPlayers: 8,
      allowObservers: true,
      matchTimerSeconds: 522,
      winTarget: 25,
      visualModelPolicy: 'v1',
    },
    otherPlayers: [{
      clientId: 'remote-1',
      role: 'client',
      spawnSlot: 1,
      loadout: { modelSystem: 'v3' },
    }],
  });

  assert.equal(capturedRemoteUpdates.length, 1);
  assert.equal((capturedRemoteUpdates[0] as any).visualModelPolicy, 'v1');
});

test('match_start visual model policy applies to later remote sync updates', () => {
  const capturedRemoteUpdates: unknown[] = [];
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: 'host',
    isMultiplayer: true,
  });
  state.otherPlayers.set('remote-1', {
    id: 'remote-1',
    controller: 'remote',
    playerName: 'Remote',
    team: 'red',
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    hp: 1,
    maxHp: 1,
    isCrouching: false,
    activeWeapon: 'hammer',
    respawnTimer: 0,
    hue: 120,
    modelType: 'medium',
    score: 0,
    kills: 0,
    deaths: 0,
    invulnerabilityTimer: 0,
    lastSwordAttackTime: 0,
    lastHammerAttackTime: 0,
    spawnTime: 0,
  } as never);
  const handler = createHandler(capturedRemoteUpdates, state);

  emit(handler, {
    type: 'match_start',
    lobbyConfig: {
      access: 'open',
      gameMode: 'sandbox',
      selectedMap: 'hangar',
      customMap: null,
      maxPlayers: 8,
      allowObservers: true,
      matchTimerSeconds: 522,
      winTarget: 25,
      visualModelPolicy: 'v3',
    },
  });
  emit(handler, {
    type: 'sync',
    action: 'state_update',
    senderId: 'remote-1',
    pos: { x: 1, y: 0, z: 2 },
    vel: { x: 0, y: 0, z: 0 },
    loadout: { modelSystem: 'v1' },
  });

  assert.equal(capturedRemoteUpdates.length, 1);
  assert.equal((capturedRemoteUpdates[0] as any).visualModelPolicy, 'v3');
});


test('spectators track all roster members without mixing the primary client mirror', () => {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: DEFAULT_ADMIN_SETTINGS, multiplayerRole: null, isMultiplayer: true });
  state.multiplayerRole = 'observer';
  const updates: unknown[] = [], handler = createHandler(updates, state);
  emit(handler, { type: 'sync', senderId: 'primary', senderRole: 'client', spawnSlot: 1, pos: { x: 1, y: 0, z: 2 } });
  emit(handler, { type: 'sync', senderId: 'third', senderRole: 'client', spawnSlot: 3, pos: { x: 30, y: 0, z: 20 } });
  assert.equal(updates.length, 2); assert.equal(state.clientClientId, 'primary');
  assert.equal(state.clientPos.x, 1); assert.equal(state.clientPos.z, 2);
});
