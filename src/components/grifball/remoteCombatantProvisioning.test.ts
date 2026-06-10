import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createOfflineBotCombatant, createRemoteCombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createOrUpdateRemoteCombatantForState } from './remoteCombatantProvisioning';

const createStateAndRefs = () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  return { state, refs };
};

const provisionCombatant = (
  state: ReturnType<typeof createInitialGrifballRuntimeState>,
  refs: ReturnType<typeof createInitialGrifballThreeRefs>,
  clientId: string,
  data: any
) => createOrUpdateRemoteCombatantForState({
  state,
  refs,
  clientId,
  data,
  opponentClientId: 'peer',
  activeCustomMap: null,
  spawnPoints: [],
  constrainCombatantToArena: () => {},
});

test('offline AI roster visuals stay on the V1 model system', () => {
  const { state, refs } = createStateAndRefs();
  const bot = createOfflineBotCombatant({
    id: 'bot_2',
    playerName: 'Bot',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: DEFAULT_ADMIN_SETTINGS,
  });
  state.otherPlayers.set(bot.id, bot);

  provisionCombatant(state, refs, bot.id, bot);

  const meshes = refs.otherPlayerMeshes.get(bot.id);
  assert.ok(meshes);
  assert.notEqual(meshes.group.userData.modelSystem, 'v2');
  assert.equal(meshes.group.userData.appliedLoadoutKey, JSON.stringify({ modelSystem: 'v1' }));
});

test('remote human roster visuals can still use the V2 model system', () => {
  const { state, refs } = createStateAndRefs();
  const remote = createRemoteCombatant({
    id: 'peer',
    playerName: 'Peer',
    spawnZ: -12,
    settings: DEFAULT_ADMIN_SETTINGS,
    data: { modelType: 'large' },
  });
  state.otherPlayers.set(remote.id, remote);

  provisionCombatant(state, refs, remote.id, {
    ...remote,
    controller: 'remote',
    loadout: { modelSystem: 'v2', modelType: 'large' },
  });

  const meshes = refs.otherPlayerMeshes.get(remote.id);
  assert.ok(meshes);
  assert.equal(meshes.group.userData.modelSystem, 'v2');
  assert.equal(meshes.group.userData.modelType, 'large');
});
