import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildLocalPlayerViewForRefs } from './localPlayerViewRuntime';
import { createInitialGrifballThreeRefs } from './threeRefs';

test('local first-person view uses V3 weapon builders for V3 loadouts', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: { modelSystem: 'v3' },
  });

  assert.equal(refs.playerHammer?.userData.modelSystem, 'v3');
  assert.equal(refs.playerSword?.userData.modelSystem, 'v3');
  assert.equal(refs.playerPistol?.userData.modelSystem, 'v3');
  assert.equal(refs.playerHammer?.userData.weaponType, 'hammer');
  assert.equal(refs.playerSword?.userData.weaponType, 'sword');
  assert.equal(refs.playerPistol?.userData.weaponType, 'pistol');
});

test('local first-person V3 weapons receive render quality options', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: { modelSystem: 'v3' },
    v3Options: {
      v3QualityTier: 'mobileLow',
    },
  });

  assert.equal(refs.playerHammer?.userData.v3QualityTier, 'mobileLow');
  assert.equal(refs.playerSword?.userData.v3QualityTier, 'mobileLow');
  assert.equal(refs.playerPistol?.userData.v3QualityTier, 'mobileLow');
});
