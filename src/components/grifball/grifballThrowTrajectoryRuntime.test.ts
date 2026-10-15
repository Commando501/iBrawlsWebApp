import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { attachBallTo, BALL_REST_Y } from '../../game/grifballBall';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import {
  disposeGrifballThrowTrajectoryVisualForRefs,
  updateGrifballThrowTrajectoryVisualForState,
} from './grifballThrowTrajectoryRuntime';

test('updateGrifballThrowTrajectoryVisualForState uses configured color and thickness while the player charges', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: {
      ...DEFAULT_ADMIN_SETTINGS,
      gameMode: 'grifball',
      grifballTrajectoryLineColor: '#00ff88',
      grifballTrajectoryLineThickness: 0.022,
    } as any,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  state.activeWeapon = 'ball';
  state.grifballPassCharge = 1;
  attachBallTo(state.grifball.ball, 'player');

  updateGrifballThrowTrajectoryVisualForState({ state, refs, chargingHolderId: 'player' });

  assert.ok(refs.grifballThrowTrajectoryLine);
  assert.equal(refs.grifballThrowTrajectoryLine.visible, true);
  assert.equal(refs.grifballThrowTrajectoryLine.material.color.getHexString(), '00ff88');
  assert.ok(Math.abs(refs.grifballThrowTrajectoryLine.material.linewidth - 2.2) < 1e-6);
  assert.equal(refs.grifballThrowTrajectoryLine.material.worldUnits, false);
  assert.equal(refs.grifballThrowTrajectoryLine.material.alphaToCoverage, true);
  assert.ok(refs.grifballThrowTrajectoryMarker);
  assert.equal(refs.grifballThrowTrajectoryMarker.visible, true);
  assert.ok(refs.grifballThrowTrajectoryMarker.material instanceof THREE.MeshBasicMaterial);
  assert.equal(refs.grifballThrowTrajectoryMarker.material.color.getHexString(), '00ff88');
  assert.equal(scene.children.includes(refs.grifballThrowTrajectoryLine), true);
  assert.equal(scene.children.length, 2);

  updateGrifballThrowTrajectoryVisualForState({ state, refs, chargingHolderId: null });

  assert.equal(refs.grifballThrowTrajectoryLine?.visible, false);
  assert.equal(refs.grifballThrowTrajectoryMarker?.visible, false);

  disposeGrifballThrowTrajectoryVisualForRefs(refs);
});

test('updateGrifballThrowTrajectoryVisualForState supports charging AI carriers', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' },
    multiplayerRole: null,
    isMultiplayer: false,
  });
  state.otherPlayers.set('bot_1', {
    id: 'bot_1',
    playerName: 'Bot 1',
    hue: 0,
    controller: 'ai',
    team: 'red',
    pos: new THREE.Vector3(5, 0, 2),
    vel: new THREE.Vector3(),
    yaw: -Math.PI / 2,
    isCrouching: false,
    hp: 1,
    maxHp: 1,
    respawnTimer: 0,
    activeWeapon: 'ball',
    grifballPassCharge: 1,
    score: 0,
    kills: 0,
    deaths: 0,
  });
  attachBallTo(state.grifball.ball, 'bot_1');

  updateGrifballThrowTrajectoryVisualForState({ state, refs, chargingHolderId: 'bot_1' });

  assert.equal(refs.grifballThrowTrajectoryLine?.visible, true);
  assert.equal(refs.grifballThrowTrajectoryMarker?.visible, true);
  const marker = refs.grifballThrowTrajectoryMarker;
  assert.ok(marker);
  assert.ok(Math.hypot(marker.position.x, marker.position.z) <= state.arenaRadius - BALL_REST_Y + 0.05);

  disposeGrifballThrowTrajectoryVisualForRefs(refs);
});

test('updateGrifballThrowTrajectoryVisualForState draws the post-bounce landing marker inside arena walls', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: {
      ...DEFAULT_ADMIN_SETTINGS,
      gameMode: 'grifball',
      grifballPassSpeedMin: 14,
      grifballPassSpeedMax: 14,
    } as any,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  state.playerPos.set(0, 0, 0);
  state.yaw = -Math.PI / 2;
  state.grifballPassCharge = 1;
  attachBallTo(state.grifball.ball, 'player');

  updateGrifballThrowTrajectoryVisualForState({
    state,
    refs,
    chargingHolderId: 'player',
    arenaBounds: {
      arenaRadius: 5,
      mapShape: 'rectangular',
      arenaHalfExtents: { x: 6, z: 3 },
    },
  });

  assert.ok(refs.grifballThrowTrajectoryMarker);
  assert.ok(refs.grifballThrowTrajectoryMarker.position.x <= 6 - BALL_REST_Y + 0.05);
  assert.ok(refs.grifballThrowTrajectoryMarker.position.x < 4, 'marker should show the inward post-bounce landing');

  disposeGrifballThrowTrajectoryVisualForRefs(refs);
});

test('throw preview follows the animated grip while preserving the predicted landing', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' },
    multiplayerRole: null,
    isMultiplayer: false,
  });
  state.grifballPassCharge = 1;
  attachBallTo(state.grifball.ball, 'player');
  updateGrifballThrowTrajectoryVisualForState({ state, refs, chargingHolderId: 'player' });
  const landing = refs.grifballThrowTrajectoryMarker!.position.clone();
  for (const grip of [new THREE.Vector3(0.4, 1.6, 0.2), new THREE.Vector3(0.6, 1.9, 0.3)]) {
    updateGrifballThrowTrajectoryVisualForState({ state, refs, chargingHolderId: 'player', visualOrigin: grip });
    const points = refs.grifballThrowTrajectoryLine!.geometry.getAttribute('instanceStart');
    assert.ok(new THREE.Vector3().fromBufferAttribute(points, 0).distanceTo(grip) < 1e-6);
    assert.ok(refs.grifballThrowTrajectoryMarker!.position.distanceTo(landing) < 1e-6);
    // Away from walls, the whole arc has constant acceleration: no hand-to-path kink.
    const vectors = Array.from({ length: points.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(points, i));
    const acceleration = vectors[2].clone().add(vectors[0]).addScaledVector(vectors[1], -2);
    for (let index = 2; index < vectors.length - 1; index += 1) {
      const nextAcceleration = vectors[index + 1].clone().add(vectors[index - 1]).addScaledVector(vectors[index], -2);
      assert.ok(nextAcceleration.distanceTo(acceleration) < 1e-5, 'arc must remain parabolic through the hand transition');
    }
  }
  disposeGrifballThrowTrajectoryVisualForRefs(refs);
  assert.equal(refs.scene.children.length, 0);
});
