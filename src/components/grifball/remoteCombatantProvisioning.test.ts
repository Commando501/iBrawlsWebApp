import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createOfflineBotCombatant, createRemoteCombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createOrUpdateRemoteCombatantForState } from './remoteCombatantProvisioning';
import type { V3RenderOptions } from '../v3/v3QualityTiers';

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
  data: any,
  v3Options?: V3RenderOptions
) => createOrUpdateRemoteCombatantForState({
  state,
  refs,
  clientId,
  data,
  opponentClientId: 'peer',
  activeCustomMap: null,
  spawnPoints: [],
  constrainCombatantToArena: () => {},
  v3Options,
});

const getAppliedLoadout = (
  refs: ReturnType<typeof createInitialGrifballThreeRefs>,
  clientId: string
) => {
  const meshes = refs.otherPlayerMeshes.get(clientId);
  assert.ok(meshes);
  return JSON.parse(meshes.group.userData.appliedLoadoutKey);
};

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

test('offline AI explicit V3 visual policy applies V3 visuals', () => {
  const { state, refs } = createStateAndRefs();
  const bot = createOfflineBotCombatant({
    id: 'bot_v3',
    playerName: 'Bot V3',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: DEFAULT_ADMIN_SETTINGS,
  });
  bot.modelType = 'medium';
  state.otherPlayers.set(bot.id, bot);

  provisionCombatant(state, refs, bot.id, {
    ...bot,
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v1',
      helmet: 'odst',
      hammerPreset: 'gravity-axe',
    },
  });

  const meshes = refs.otherPlayerMeshes.get(bot.id);
  assert.ok(meshes);
  assert.equal(meshes.group.userData.modelSystem, 'v3');
  assert.deepEqual(getAppliedLoadout(refs, bot.id), {
    helmet: 'odst',
    torso: 'mark-vi',
    arm: 'mark-vi',
    leg: 'mark-vi',
    hammerPreset: 'gravity-axe',
    swordPreset: 'default',
    modelSystem: 'v3',
  });
  assert.equal(state.otherPlayers.get(bot.id)?.modelType, 'medium');
});

test('offline AI explicit V3 visual policy does not change gameplay model type', () => {
  const { state, refs } = createStateAndRefs();
  const bot = createOfflineBotCombatant({
    id: 'bot_v3_large',
    playerName: 'Bot V3 Large',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: DEFAULT_ADMIN_SETTINGS,
  });
  state.otherPlayers.set(bot.id, bot);

  provisionCombatant(state, refs, bot.id, {
    ...bot,
    modelType: 'large',
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v3',
      modelType: 'large',
    },
  });

  assert.equal(state.otherPlayers.get(bot.id)?.modelType, 'large');
  assert.equal(getAppliedLoadout(refs, bot.id).modelType, 'large');
});

test('offline AI explicit V2 visual policy applies gameplay model type to V2 visuals', () => {
  const { state, refs } = createStateAndRefs();
  const bot = createOfflineBotCombatant({
    id: 'bot_v2',
    playerName: 'Bot V2',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: DEFAULT_ADMIN_SETTINGS,
  });
  state.otherPlayers.set(bot.id, bot);

  provisionCombatant(state, refs, bot.id, {
    ...bot,
    modelType: 'large',
    visualModelPolicy: 'v2',
  });

  const meshes = refs.otherPlayerMeshes.get(bot.id);
  assert.ok(meshes);
  assert.equal(meshes.group.userData.modelSystem, 'v2');
  assert.equal(meshes.group.userData.modelType, 'large');
  assert.deepEqual(getAppliedLoadout(refs, bot.id), { modelSystem: 'v2', modelType: 'large' });
  assert.equal(state.otherPlayers.get(bot.id)?.modelType, 'large');
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
  assert.equal(state.otherPlayers.get(remote.id)?.modelType, 'large');
});

test('remote human visual policy v1 forces V1 over V3 personal loadout', () => {
  const { state, refs } = createStateAndRefs();

  provisionCombatant(state, refs, 'peer', {
    controller: 'remote',
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3', modelType: 'large' },
  });

  const meshes = refs.otherPlayerMeshes.get('peer');
  assert.ok(meshes);
  assert.notEqual(meshes.group.userData.modelSystem, 'v2');
  assert.equal(meshes.group.userData.appliedLoadoutKey, JSON.stringify({ modelSystem: 'v1' }));
});

test('remote human visual policy v2 normalizes V3 personal model type to medium', () => {
  const { state, refs } = createStateAndRefs();

  provisionCombatant(state, refs, 'peer', {
    controller: 'remote',
    visualModelPolicy: 'v2',
    loadout: { modelSystem: 'v3', modelType: 'large' },
  });

  const meshes = refs.otherPlayerMeshes.get('peer');
  assert.ok(meshes);
  assert.equal(meshes.group.userData.modelSystem, 'v2');
  assert.equal(meshes.group.userData.modelType, 'medium');
  assert.equal(state.otherPlayers.get('peer')?.modelType, 'medium');
  assert.deepEqual(getAppliedLoadout(refs, 'peer'), { modelSystem: 'v2', modelType: 'medium' });
});

test('remote human visual policy v3 carries a V3 applied loadout key', () => {
  const { state, refs } = createStateAndRefs();

  provisionCombatant(state, refs, 'peer', {
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v1',
      helmet: 'odst',
      hammerPreset: 'gravity-axe',
    },
  });

  const appliedLoadout = getAppliedLoadout(refs, 'peer');
  assert.equal(appliedLoadout.modelSystem, 'v3');
  assert.equal(appliedLoadout.helmet, 'odst');
  assert.equal(appliedLoadout.torso, 'mark-vi');
  assert.equal(appliedLoadout.hammerPreset, 'gravity-axe');
});

test('remote human visual policy v3 does not let V3 personal model type affect gameplay state', () => {
  const { state, refs } = createStateAndRefs();
  const remote = createRemoteCombatant({
    id: 'peer',
    playerName: 'Peer',
    spawnZ: -12,
    settings: DEFAULT_ADMIN_SETTINGS,
    data: { modelType: 'medium' },
  });
  state.otherPlayers.set(remote.id, remote);

  provisionCombatant(state, refs, remote.id, {
    ...remote,
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v3',
      modelType: 'large',
      helmet: 'odst',
    },
  });

  const appliedLoadout = getAppliedLoadout(refs, remote.id);
  assert.equal(appliedLoadout.modelSystem, 'v3');
  assert.equal(appliedLoadout.modelType, 'large');
  assert.equal(state.otherPlayers.get(remote.id)?.modelType, 'medium');
});

test('remote V3 meshes rebuild when render quality changes without changing loadout identity', () => {
  const { state, refs } = createStateAndRefs();
  const data = {
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: { modelSystem: 'v3', helmet: 'odst' },
    hue: 128,
  };

  provisionCombatant(state, refs, 'peer', data, { v3QualityTier: 'mobileLow' });
  const firstMeshes = refs.otherPlayerMeshes.get('peer');
  assert.ok(firstMeshes);
  const appliedLoadoutKey = firstMeshes.group.userData.appliedLoadoutKey;
  assert.equal(firstMeshes.group.userData.appliedV3QualityTier, 'mobileLow');

  provisionCombatant(state, refs, 'peer', data, { v3QualityTier: 'desktop' });
  const secondMeshes = refs.otherPlayerMeshes.get('peer');
  assert.ok(secondMeshes);
  assert.notEqual(secondMeshes.group, firstMeshes.group);
  assert.equal(secondMeshes.group.userData.appliedLoadoutKey, appliedLoadoutKey);
  assert.equal(secondMeshes.group.userData.appliedV3QualityTier, 'desktop');
});

test('remote V3 visual policy preserves sanitized V3 role paint while forced V1 and V2 remain legacy visual policies', () => {
  const { state, refs } = createStateAndRefs();
  const v3Loadout = {
    modelSystem: 'v3',
    helmet: 'odst',
    paintJob: {
      v3RoleColors: {
        primary: '#123456',
        accent: '#abcdef',
        invalid: '#ffffff',
      },
      v3RoleEmissive: {
        visor: true,
        primary: false,
      },
    },
  } as any;

  provisionCombatant(state, refs, 'peer-v3', {
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: v3Loadout,
  });
  const v3Applied = getAppliedLoadout(refs, 'peer-v3') as any;
  assert.equal(v3Applied.modelSystem, 'v3');
  assert.equal(v3Applied.paintJob.v3RoleColors.primary, '#123456');
  assert.equal(v3Applied.paintJob.v3RoleColors.accent, '#abcdef');
  assert.equal(v3Applied.paintJob.v3RoleColors.invalid, undefined);
  assert.equal(v3Applied.paintJob.v3RoleEmissive.visor, true);

  provisionCombatant(state, refs, 'peer-v1', {
    controller: 'remote',
    visualModelPolicy: 'v1',
    loadout: v3Loadout,
  });
  assert.deepEqual(getAppliedLoadout(refs, 'peer-v1'), { modelSystem: 'v1' });

  provisionCombatant(state, refs, 'peer-v2', {
    controller: 'remote',
    visualModelPolicy: 'v2',
    loadout: v3Loadout,
  });
  const v2Applied = getAppliedLoadout(refs, 'peer-v2') as any;
  assert.equal(v2Applied.modelSystem, 'v2');
  assert.equal(v2Applied.modelType, 'medium');
  assert.equal(v2Applied.paintJob.v3RoleColors.invalid, undefined);
});
