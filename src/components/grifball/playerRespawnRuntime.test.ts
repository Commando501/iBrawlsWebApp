import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { updatePlayerRespawnForState } from './playerRespawnRuntime';

for (const isMultiplayer of [false, true]) test(`airborne death cannot retain jump state on revival ${isMultiplayer}`, () => {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: DEFAULT_ADMIN_SETTINGS,
    isMultiplayer, multiplayerRole: null });
  state.playerHP = 0; state.playerRespawnTimer = .1; state.isJumping = true;
  state.playerPos.set(3, 2, 4); state.playerVel.set(1, 5, -2);
  let revivals = 0;
  const options = { state, dt: .05, isMultiplayer, getMainAi: () => undefined, activeCustomMap: null,
    spawnPoints: [new THREE.Vector3(10, 0, 0)], playRespawn: () => { revivals++; } };
  assert.equal(updatePlayerRespawnForState(options), true);
  assert.equal(state.playerHP, 0); assert.equal(state.isJumping, true); assert.equal(revivals, 0);
  assert.equal(updatePlayerRespawnForState(options), true);
  assert.equal(state.playerHP, state.playerMaxHP); assert.equal(state.isJumping, false);
  assert.deepEqual(state.playerVel.toArray(), [0, 0, 0]); assert.equal(revivals, 1);
  state.isJumping = true;
  assert.equal(updatePlayerRespawnForState(options), false);
  assert.equal(state.isJumping, true, 'living jumps are not cleared by the respawn owner');
});
