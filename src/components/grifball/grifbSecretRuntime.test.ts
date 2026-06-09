import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildGrifbSecretSyncPayload,
  GRIFB_SECRET_AUDIO_SRC,
  playGrifbSecretAudio,
} from './grifbSecretRuntime';
import { createMultiplayerSyncMessageHandler } from './multiplayerSyncRuntime';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import type { GrifballThreeRefs } from './threeRefs';

class FakeAudio {
  static created: FakeAudio[] = [];
  src: string;
  volume = 1;
  paused = false;

  constructor(src: string) {
    this.src = src;
    FakeAudio.created.push(this);
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

test('buildGrifbSecretSyncPayload includes a full remote state snapshot', () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: {
      ...DEFAULT_ADMIN_SETTINGS,
      playerHue: 214,
      playerName: 'Akela',
    },
    multiplayerRole: 'client',
    isMultiplayer: true,
  });
  state.playerPos.set(1, 2, 3);
  state.playerVel.set(4, 5, 6);
  state.yaw = 0.7;
  state.pitch = -0.2;
  state.playerHP = 1;
  state.playerMaxHP = 2;
  state.isCrouching = true;
  state.playerRespawnTimer = 0.5;
  state.playerInvulnerabilityTimer = 0.25;

  const payload = buildGrifbSecretSyncPayload(state);

  assert.deepEqual(payload, {
    type: 'sync',
    action: 'unlock_secret',
    pos: { x: 1, y: 2, z: 3 },
    vel: { x: 4, y: 5, z: 6 },
    yaw: 0.7,
    pitch: -0.2,
    hp: 1,
    maxHp: 2,
    isCrouching: true,
    activeWeapon: 'pistol',
    respawnTimer: 0.5,
    invulnerabilityTimer: 0.25,
    hue: 214,
    playerName: 'Akela',
  });
});

test('playGrifbSecretAudio restarts the secret track without touching the socket', () => {
  FakeAudio.created = [];
  const existing = new FakeAudio('old.mp3') as unknown as HTMLAudioElement;
  const secretAudioRef = { current: existing };

  playGrifbSecretAudio(secretAudioRef);

  assert.equal((existing as unknown as FakeAudio).paused, true);
  assert.equal(FakeAudio.created.at(-1)?.src, GRIFB_SECRET_AUDIO_SRC);
  assert.equal(secretAudioRef.current, FakeAudio.created.at(-1) as unknown as HTMLAudioElement);
  assert.equal(secretAudioRef.current?.volume, 0.55);
});

test('multiplayer unlock_secret sync updates the remote player before presentation effects', () => {
  FakeAudio.created = [];
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: 'host',
    isMultiplayer: true,
  });
  const remoteId = 'remote-player';
  const remotePlayer = {
    id: remoteId,
    playerName: 'Guest',
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    hp: 1,
    maxHp: 1,
    activeWeapon: 'hammer',
    respawnTimer: 0,
    invulnerabilityTimer: 0,
  };
  state.otherPlayers.set(remoteId, remotePlayer as never);

  const meshes = {
    hammer: { visible: true },
    sword: { visible: true },
    pistol: { visible: false },
  };
  const refs = {
    otherPlayerMeshes: new Map([[remoteId, meshes]]),
  } as unknown as GrifballThreeRefs;
  const secretAudioRef = { current: null as HTMLAudioElement | null };
  const mergedPayloads: unknown[] = [];
  const shockwaves: THREE.Vector3[] = [];

  const handler = createMultiplayerSyncMessageHandler({
    stateRef: { current: state },
    refs,
    multiplayerRole: 'host',
    secretAudioRef,
    createOrUpdateRemotePlayer: (_clientId, data) => {
      mergedPayloads.push(data);
      remotePlayer.pos.set(data.pos.x, data.pos.y, data.pos.z);
      remotePlayer.vel.set(data.vel.x, data.vel.y, data.vel.z);
      remotePlayer.activeWeapon = data.activeWeapon;
    },
    resizeArena: () => {},
    pushStatsUpdate: () => {},
    rebuildHostModel: () => {},
    rebuildEnemyModel: () => {},
    spawnVoxelShockwaveParticles: (pos) => {
      shockwaves.push(pos.clone());
    },
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

  handler({
    data: JSON.stringify({
      type: 'sync',
      action: 'unlock_secret',
      senderId: remoteId,
      pos: { x: 9, y: 1, z: -4 },
      vel: { x: 1, y: 0, z: 0 },
      yaw: 0.5,
      pitch: 0.1,
      hp: 1,
      maxHp: 1,
      isCrouching: false,
      activeWeapon: 'pistol',
      respawnTimer: 0,
      invulnerabilityTimer: 0,
      hue: 120,
      playerName: 'Guest',
    }),
  } as MessageEvent);

  assert.equal(mergedPayloads.length, 1);
  assert.equal(remotePlayer.activeWeapon, 'pistol');
  assert.deepEqual(remotePlayer.pos.toArray(), [9, 1, -4]);
  assert.equal(meshes.hammer.visible, false);
  assert.equal(meshes.sword.visible, false);
  assert.equal(meshes.pistol.visible, true);
  assert.equal(FakeAudio.created.at(-1)?.src, GRIFB_SECRET_AUDIO_SRC);
  assert.equal(shockwaves.length, 2);
});
