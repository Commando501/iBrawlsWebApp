import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createOfflineBotCombatant, createRemoteCombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createOrUpdateRemoteCombatantForState } from './remoteCombatantProvisioning';
import { balanceMap, BALANCEABLE_MAPS } from '../../game/mapBalancing';
import { syncMultiplayerRuntimeModeForState } from './multiplayerStateRuntime';
import { resolvePlayerCombatantCollisionsForState } from './playerCollisionSync';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import { ENEMY_ARMOR_COLOR, FRIENDLY_ARMOR_COLOR, getCombatantTeamArmorState } from './combatantTeamArmor';

const createStateAndRefs = (
  adminSettings = DEFAULT_ADMIN_SETTINGS
) => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings,
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

test('scaled Grifball late joiners start at their owning client team spawn without pushing existing players', () => {
  const map = balanceMap(BALANCEABLE_MAPS[0], { length: 125, width: 75, height: 60 });
  const settings = { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' as const };
  const { state, refs } = createStateAndRefs(settings);
  state.isMultiplayer = true;
  state.multiplayerRole = 'host';
  syncMultiplayerRuntimeModeForState({ state, refs, isMultiplayer: true, multiplayerRole: 'host',
    multiplayerSpawnSlot: 0, activeCustomMap: map, spawnPoints: [], replayActive: false });
  const original = state.playerPos.clone();
  for (let slot = 1; slot < 8; slot++) {
    const owner = createStateAndRefs(settings);
    syncMultiplayerRuntimeModeForState({ ...owner, isMultiplayer: true, multiplayerRole: 'client',
      multiplayerSpawnSlot: slot, activeCustomMap: map, spawnPoints: [], replayActive: false });
    createOrUpdateRemoteCombatantForState({ state, refs, clientId: `peer-${slot}`,
      data: { spawnSlot: slot, role: 'client', hp: 1, visualModelPolicy: 'v1' },
      opponentClientId: '', activeCustomMap: map, spawnPoints: [], constrainCombatantToArena: () => {} });
    const remote = state.otherPlayers.get(`peer-${slot}`)!;
    assert.deepEqual(remote.pos.toArray(), owner.state.playerPos.toArray(), `slot ${slot}`);
    assert.equal(remote.team, owner.state.localPlayerTeam);
    const positions = [...state.otherPlayers.values()].map(p => p.pos.toArray());
    resolvePlayerCombatantCollisionsForState({ state, mainAI: undefined });
    assert.deepEqual(state.playerPos.toArray(), original.toArray(), `slot ${slot} must not push host`);
    assert.deepEqual([...state.otherPlayers.values()].map(p => p.pos.toArray()), positions);
  }
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

test('offline AI explicit V3 visual policy preserves V3 visuals', () => {
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
  assert.equal(meshes.group.userData.characterAsset, 'iron-vanguard');
  const appliedLoadout = getAppliedLoadout(refs, bot.id) as any;
  assert.equal(appliedLoadout.modelSystem, 'v3');
  assert.equal(appliedLoadout.helmet, 'odst');
  assert.equal(appliedLoadout.hammerPreset, 'gravity-axe');
  assert.equal(state.otherPlayers.get(bot.id)?.modelType, 'medium');
});

test('grifball AI roster visuals attach solid team armor from combatant team', () => {
  const { state, refs } = createStateAndRefs({
    ...DEFAULT_ADMIN_SETTINGS,
    gameMode: 'grifball',
  });
  const bot = createOfflineBotCombatant({
    id: 'bot_blue_armor',
    playerName: 'Blue Bot',
    team: 'blue',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: state.settings,
  });
  state.otherPlayers.set(bot.id, bot);

  provisionCombatant(state, refs, bot.id, bot);

  const meshes = refs.otherPlayerMeshes.get(bot.id);
  assert.ok(meshes);
  const armor = getCombatantTeamArmorState(meshes.group);
  assert.ok(armor);
  assert.equal(armor.team, 'blue');
  assert.ok(armor.meshes.length > 0);
  assert.equal(armor.material.color.getHexString(), FRIENDLY_ARMOR_COLOR.slice(1));

  state.localPlayerTeam = 'red';
  provisionCombatant(state, refs, bot.id, bot);
  assert.equal(refs.otherPlayerMeshes.get(bot.id)?.group, meshes.group);
  assert.equal(armor.material.color.getHexString(), ENEMY_ARMOR_COLOR.slice(1));

  bot.team = 'red';
  provisionCombatant(state, refs, bot.id, bot);
  assert.equal(armor.material.color.getHexString(), FRIENDLY_ARMOR_COLOR.slice(1));
});

test('sandbox roster visuals do not keep Grifball solid team armor', () => {
  const { state, refs } = createStateAndRefs();
  const bot = createOfflineBotCombatant({
    id: 'bot_sandbox_armor',
    playerName: 'Sandbox Bot',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: state.settings,
  });
  state.otherPlayers.set(bot.id, bot);

  provisionCombatant(state, refs, bot.id, bot);

  const meshes = refs.otherPlayerMeshes.get(bot.id);
  assert.ok(meshes);
  assert.equal(getCombatantTeamArmorState(meshes.group), null);
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
  const appliedLoadout = getAppliedLoadout(refs, bot.id) as any;
  assert.equal(appliedLoadout.modelSystem, 'v3');
  assert.equal(appliedLoadout.modelType, 'medium');
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

test('remote human visual policy v3 preserves an advanced applied loadout key', () => {
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
  assert.equal(appliedLoadout.hammerPreset, 'gravity-axe');
});

test('remote human visual policy v3 keeps V3 visuals without letting V3 personal model type affect gameplay state', () => {
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
  assert.equal(appliedLoadout.modelType, 'medium');
  assert.equal(state.otherPlayers.get(remote.id)?.modelType, 'medium');
});

test('Iron Vanguard does not rebuild for prototype quality settings', () => {
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
  assert.equal(firstMeshes.group.userData.characterAsset, 'iron-vanguard');

  provisionCombatant(state, refs, 'peer', data, { v3QualityTier: 'desktop' });
  const secondMeshes = refs.otherPlayerMeshes.get('peer');
  assert.ok(secondMeshes);
  assert.equal(secondMeshes.group, firstMeshes.group);
  assert.equal(secondMeshes.group.userData.appliedLoadoutKey, appliedLoadoutKey);
  assert.equal(secondMeshes.group.userData.characterAsset, 'iron-vanguard');
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

test('Iron Vanguard hides on death and restores on respawn without prototype voxel effects', () => {
  const { state, refs } = createStateAndRefs();
  const data = {
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: { modelSystem: 'v3' },
    hue: 180,
    hp: 100,
    respawnTimer: 0,
    activeWeapon: 'hammer',
  };

  provisionCombatant(state, refs, 'peer-burst', data, { v3QualityTier: 'mobileLow' });
  assert.equal(refs.v3DeathVoxelBursts.size, 0);

  provisionCombatant(state, refs, 'peer-burst', {
    ...data,
    hp: 0,
  }, { v3QualityTier: 'mobileLow' });
  const firstBurst = refs.v3DeathVoxelBursts.get('combatant:peer-burst');
  const meshes = refs.otherPlayerMeshes.get('peer-burst');

  assert.equal(firstBurst, undefined);
  assert.ok(meshes);
  assert.equal(meshes.group.visible, false);
  assert.equal(meshes.hammer.visible, false);

  provisionCombatant(state, refs, 'peer-burst', {
    ...data,
    hp: 0,
  }, { v3QualityTier: 'mobileLow' });
  assert.equal(refs.v3DeathVoxelBursts.get('combatant:peer-burst'), firstBurst);

  provisionCombatant(state, refs, 'peer-burst', data, { v3QualityTier: 'mobileLow' });
  assert.equal(refs.v3DeathVoxelBursts.has('combatant:peer-burst'), false);
  assert.equal(refs.v3DeathVoxelBursts.size, 0);
});

test('Iron Vanguard remains hidden when rebuilt while dead', () => {
  const { state, refs } = createStateAndRefs();
  const data = {
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: { modelSystem: 'v3' },
    hue: 180,
    hp: 100,
    respawnTimer: 0,
    activeWeapon: 'hammer',
  };

  provisionCombatant(state, refs, 'peer-burst-rebuild', data, { v3QualityTier: 'mobileLow' });
  provisionCombatant(state, refs, 'peer-burst-rebuild', {
    ...data,
    hp: 0,
  }, { v3QualityTier: 'mobileLow' });
  const firstBurst = refs.v3DeathVoxelBursts.get('combatant:peer-burst-rebuild');
  assert.equal(firstBurst, undefined);

  provisionCombatant(state, refs, 'peer-burst-rebuild', {
    ...data,
    hp: 0,
    hue: 220,
  }, { v3QualityTier: 'mobileLow' });

  assert.equal(refs.v3DeathVoxelBursts.size, 0);
  assert.equal(refs.v3DeathVoxelBursts.has('combatant:peer-burst-rebuild'), false);
  assert.equal(refs.otherPlayerMeshes.get('peer-burst-rebuild')!.group.visible, false);
});

test('remote V2 visual policy does not trigger V3 death voxel burst', () => {
  const { state, refs } = createStateAndRefs();
  const data = {
    controller: 'remote',
    visualModelPolicy: 'v2',
    loadout: { modelSystem: 'v2' },
    hp: 100,
    respawnTimer: 0,
  };

  provisionCombatant(state, refs, 'peer-v2-burst', data);
  provisionCombatant(state, refs, 'peer-v2-burst', {
    ...data,
    hp: 0,
  });

  assert.equal(refs.v3DeathVoxelBursts.size, 0);
});


test('remote lunge flight and contact survive sync updates without starting a second sword attack', () => {
  const { state, refs } = createStateAndRefs();
  provisionCombatant(state, refs, 'peer', { activeWeapon: 'sword', isLunging: true, swordLungeHit: false, lungeTimer: 0.3 });
  const actor = state.otherPlayers.get('peer')!;
  assert.equal(actor.isLunging, true);
  assert.equal(actor.lungeTimer, 0.3);
  actor.weaponState = 'ready'; // The lunge-start action sets this separately from position sync.
  provisionCombatant(state, refs, 'peer', { isLunging: false, swordLungeHit: true });
  assert.equal(actor.isLunging, false);
  assert.equal(actor.swordLungeHit, true);
  assert.equal(actor.weaponState, 'ready');
  provisionCombatant(state, refs, 'peer', { yaw: 1 });
  assert.equal(actor.swordLungeHit, true, 'packets without the optional fields preserve the outcome');
  provisionCombatant(state, refs, 'peer', { isLunging: true, swordLungeHit: false, lungeTimer: 0 });
  assert.equal(actor.swordLungeHit, false);
});


test('remote jump and sprint flags survive partial updates and explicitly clear on landing/walk', () => {
  const { state, refs } = createStateAndRefs();
  provisionCombatant(state, refs, 'moving-peer', {isJumping: true, isSprinting: true, isSliding: true});
  const actor = state.otherPlayers.get('moving-peer')!;
  provisionCombatant(state, refs, 'moving-peer', {yaw: 1});
  assert.equal(actor.isJumping, true); assert.equal(actor.aiIsSprinting, true); assert.equal(actor.aiSlideActive, true);
  provisionCombatant(state, refs, 'moving-peer', {isJumping: false, isSprinting: false, isSliding: false});
  assert.equal(actor.isJumping, false); assert.equal(actor.aiIsSprinting, false); assert.equal(actor.aiSlideActive, false);
});
