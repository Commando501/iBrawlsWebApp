import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createMainAICombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import {
  rebuildEnemyCombatantModelForState,
  rebuildHostCombatantModelForState,
} from './combatantModelRebuild';
import { getRandomLoadout } from './combatantModels';
import { createViewTargetCallbacksForState } from './viewTargetCallbacks';

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

test('host rebuild uses visual loadout without changing gameplay model type', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;

  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: 'host',
    isMultiplayer: true,
  });
  state.playerModelType = 'medium';

  const { rebuildHostModel } = createViewTargetCallbacksForState({
    getState: () => state,
    getRefs: () => refs,
    getMainAI: () => undefined,
    replayPlayerIdsRef: { current: null },
    replayTargetIdRef: { current: 'free' },
    lastOpponentHue: { current: null },
    getOpponentName: () => 'Peer',
    opponentClientId: 'peer',
    isMultiplayer: true,
    multiplayerRole: 'host',
    playerLoadout: { modelSystem: 'v2', modelType: 'medium' },
    visualPlayerLoadout: { modelSystem: 'v3', modelType: 'large' },
    pushStatsUpdate: () => {},
  });

  rebuildHostModel(210);

  assert.ok(refs.hostGroup);
  assert.equal(refs.hostGroup.userData.modelSystem, 'v3');
  assert.deepEqual(JSON.parse(refs.hostGroup.userData.appliedLoadoutKey), {
    modelSystem: 'v3',
    modelType: 'large',
  });
  assert.equal(state.playerModelType, 'medium');
});

test('host combatant rebuild tags V3 quality without changing gameplay model type', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: 'host',
    isMultiplayer: true,
  });
  state.playerModelType = 'medium';

  rebuildHostCombatantModelForState({
    state,
    refs,
    hue: 220,
    isMultiplayer: true,
    multiplayerRole: 'host',
    playerLoadout: { modelSystem: 'v3', modelType: 'large' },
    v3Options: {
      v3QualityTier: 'mobileLow',
    },
  });

  assert.equal(refs.hostGroup?.userData.v3QualityTier, 'mobileLow');
  assert.equal(refs.hostGroup?.userData.appliedV3QualityTier, 'mobileLow');
  assert.equal(state.playerModelType, 'medium');
});
