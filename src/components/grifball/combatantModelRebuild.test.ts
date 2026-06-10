import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createMainAICombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { rebuildEnemyCombatantModelForState } from './combatantModelRebuild';
import { getRandomLoadout } from './combatantModels';

test('random bot loadouts stay on the V1 model system', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.75;

  try {
    const loadout = getRandomLoadout();
    assert.notEqual(loadout.modelSystem, 'v2');
    assert.equal(loadout.modelType, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('offline AI enemy rebuild uses the V1 model system', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  refs.enemyGroup = new THREE.Group();
  scene.add(refs.enemyGroup);

  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  const mainAI = createMainAICombatant({
    settings: DEFAULT_ADMIN_SETTINGS,
    legacy: {},
    spawnPos: new THREE.Vector3(0, 0, -12),
    yaw: 0,
  });
  mainAI.modelType = 'large';

  rebuildEnemyCombatantModelForState({
    state,
    refs,
    hue: 0,
    isMultiplayer: false,
    multiplayerRole: null,
    playerLoadout: { modelSystem: 'v2', modelType: 'large' },
    mainAI,
  });

  assert.ok(refs.enemyGroup);
  assert.notEqual(refs.enemyGroup.userData.modelSystem, 'v2');
  assert.equal(refs.enemyGroup.userData.appliedLoadoutKey, '');
});
