import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Combatant } from '../types';
import {
  applyRosterSlotConfigToCombatants,
  offlineCustomBotTarget,
  seedOfflineRoster,
  syncOfflineBotSlots,
  tickAIOrchestrator,
} from './aiOrchestrator';
import { createBotCoordinator } from './aiBotCoordinator';
import {
  countOfflineBotSlots,
  createRemoteCombatant,
  getAICombatants,
  getMainAI,
  MAIN_AI_ID,
} from './roster';

const baseSettings = { maxHP: 3, respawnInvulnerabilityDuration: 1.5 } as any;

const spawnCallbacks = {
  getOptimalSpawnPoint: (exclude: THREE.Vector3[]) =>
    new THREE.Vector3(exclude.length, 0, -exclude.length),
  getInwardSpawnYaw: () => Math.PI,
};

test('offlineCustomBotTarget excludes main_ai slot', () => {
  assert.equal(offlineCustomBotTarget(1), 0);
  assert.equal(offlineCustomBotTarget(4), 3);
});

test('syncOfflineBotSlots spawns and despawns bot_* only', () => {
  const roster = new Map<string, Combatant>();
  const legacy = {
    botDifficulties: { bot_2: 'hard', bot_3: 'easy' },
    botBehaviors: {},
    botWeaponBehaviors: {},
    botColors: { bot_2: 99 },
  };
  const playerPos = new THREE.Vector3(0, 0, 12);
  const spawned: string[] = [];
  const despawned: string[] = [];

  syncOfflineBotSlots(
    { roster, settings: baseSettings, legacy, offlineBotCount: 3, playerPos },
    spawnCallbacks,
    {
      onBotSpawned: (id) => spawned.push(id),
      onBotDespawned: (id) => despawned.push(id),
    }
  );

  assert.equal(countOfflineBotSlots(roster), 2);
  assert.deepEqual(spawned, ['bot_2', 'bot_3']);
  assert.equal(roster.get('bot_2')?.difficulty, 'hard');
  assert.equal(roster.get('bot_2')?.hue, 99);

  syncOfflineBotSlots(
    { roster, settings: baseSettings, legacy, offlineBotCount: 2, playerPos },
    spawnCallbacks,
    { onBotDespawned: (id) => despawned.push(id) }
  );

  assert.equal(countOfflineBotSlots(roster), 1);
  assert.deepEqual(despawned, ['bot_3']);
});

test('syncOfflineBotSlots never removes remote combatants', () => {
  const roster = new Map<string, Combatant>();
  roster.set(
    'peer',
    createRemoteCombatant({
      id: 'peer',
      playerName: 'Guest',
      spawnZ: -12,
      settings: baseSettings,
    })
  );

  syncOfflineBotSlots(
    {
      roster,
      settings: baseSettings,
      legacy: {},
      offlineBotCount: 1,
      playerPos: new THREE.Vector3(),
    },
    spawnCallbacks
  );

  assert.ok(roster.has('peer'));
  assert.equal(countOfflineBotSlots(roster), 0);
});

test('seedOfflineRoster creates main_ai and bots with spread positions', () => {
  const roster = new Map<string, Combatant>();
  const playerPos = new THREE.Vector3();

  seedOfflineRoster(
    {
      roster,
      settings: baseSettings,
      legacy: { botDifficulties: { main_ai: 'normal', bot_2: 'hard' } },
      offlineBotCount: 2,
      playerPos,
      isPlaying: true,
      coordinator: createBotCoordinator(),
    },
    spawnCallbacks
  );

  assert.ok(getMainAI(roster));
  assert.equal(countOfflineBotSlots(roster), 1);
  assert.equal(getAICombatants(roster).length, 2);
  assert.notDeepEqual(playerPos.toArray(), [0, 0, 0]);
});

test('tickAIOrchestrator ensures main_ai and applies team config', () => {
  const roster = new Map<string, Combatant>();
  const coordinator = createBotCoordinator();
  const playerPos = new THREE.Vector3(0, 0, 12);

  const result = tickAIOrchestrator(
    {
      roster,
      settings: { ...baseSettings, aiDifficulty: 'nightmare' },
      legacy: { botDifficulties: { bot_2: 'easy' } },
      offlineBotCount: 2,
      playerPos,
      isPlaying: true,
      coordinator,
    },
    0.016,
    spawnCallbacks
  );

  assert.equal(result.totalCombatants, 3); // player + main_ai + bot_2
  assert.ok(getMainAI(roster));
  assert.equal(getMainAI(roster)!.difficulty, 'nightmare');
  assert.equal(roster.get('bot_2')?.difficulty, 'easy');
  assert.equal(countOfflineBotSlots(roster), 1);
});

test('applyRosterSlotConfigToCombatants updates difficulty reactively', () => {
  const roster = new Map<string, Combatant>();
  seedOfflineRoster(
    {
      roster,
      settings: baseSettings,
      legacy: { botDifficulties: { bot_2: 'normal' } },
      offlineBotCount: 2,
      playerPos: new THREE.Vector3(),
      isPlaying: true,
      coordinator: createBotCoordinator(),
    },
    spawnCallbacks
  );

  applyRosterSlotConfigToCombatants(
    roster,
    baseSettings,
    { botDifficulties: { bot_2: 'hard' } }
  );

  assert.equal(roster.get('bot_2')?.difficulty, 'hard');
});

test('tickAIOrchestrator skips roster work when not playing', () => {
  const roster = new Map<string, Combatant>();
  const result = tickAIOrchestrator(
    {
      roster,
      settings: baseSettings,
      legacy: {},
      offlineBotCount: 3,
      playerPos: new THREE.Vector3(),
      isPlaying: false,
      coordinator: createBotCoordinator(),
    },
    0.016,
    spawnCallbacks
  );

  assert.equal(result.rosterChanged, false);
  assert.equal(roster.size, 0);
});
