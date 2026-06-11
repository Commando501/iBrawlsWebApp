import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createMultiplayerSyncMessageHandler } from './multiplayerSyncRuntime';

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
  multiplayerRole: 'host',
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
