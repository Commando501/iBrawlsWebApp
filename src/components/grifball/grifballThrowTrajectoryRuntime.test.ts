import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { attachBallTo } from '../../game/grifballBall';
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
      grifballTrajectoryLineThickness: 0.22,
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
  assert.ok(refs.grifballThrowTrajectoryDashes);
  assert.equal(refs.grifballThrowTrajectoryDashes.visible, true);
  assert.ok(refs.grifballThrowTrajectoryDashes.children.length >= 8);
  const firstDash = refs.grifballThrowTrajectoryDashes.children[0];
  assert.ok(firstDash instanceof THREE.Mesh);
  assert.ok(firstDash.geometry instanceof THREE.CylinderGeometry);
  assert.ok(firstDash.material instanceof THREE.MeshBasicMaterial);
  assert.equal(firstDash.material.color.getHexString(), '00ff88');
  assert.equal(firstDash.geometry.parameters.radiusTop, 0.22);
  assert.ok(refs.grifballThrowTrajectoryMarker);
  assert.equal(refs.grifballThrowTrajectoryMarker.visible, true);
  assert.ok(refs.grifballThrowTrajectoryMarker.material instanceof THREE.MeshBasicMaterial);
  assert.equal(refs.grifballThrowTrajectoryMarker.material.color.getHexString(), '00ff88');
  assert.equal(scene.children.includes(refs.grifballThrowTrajectoryLine), true);
  assert.equal(scene.children.includes(refs.grifballThrowTrajectoryDashes), true);

  updateGrifballThrowTrajectoryVisualForState({ state, refs, chargingHolderId: null });

  assert.equal(refs.grifballThrowTrajectoryLine?.visible, false);
  assert.equal(refs.grifballThrowTrajectoryDashes?.visible, false);
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
  assert.ok((refs.grifballThrowTrajectoryMarker?.position.x ?? 0) > 10);

  disposeGrifballThrowTrajectoryVisualForRefs(refs);
});
