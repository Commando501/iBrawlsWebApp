import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Combatant } from '../types';
import {
  MAIN_AI_ID,
  countOfflineBotSlots,
  createMainAICombatant,
  createOfflineBotCombatant,
  createRemoteCombatant,
  ensureMainAIInRoster,
  getAICombatants,
  getDisplayOpponent,
  getMainAI,
  getPrimaryRemoteOpponent,
  getRemoteCombatants,
  isAIControlled,
  isAICombatReady,
  isRemoteControlled,
  getRosterCombatant,
  removeMainAIFromRoster,
} from './roster';

const baseSettings = { maxHP: 3, respawnInvulnerabilityDuration: 1.5 } as any;
const legacy = { botDifficulties: {}, botBehaviors: {}, botWeaponBehaviors: {}, botColors: {} };

test('controller discriminator separates AI and remote entries', () => {
  const roster = new Map<string, Combatant>();
  const mai = createMainAICombatant({
    settings: baseSettings,
    legacy,
    spawnPos: new THREE.Vector3(0, 0, -12),
    yaw: 0,
  });
  roster.set(MAIN_AI_ID, mai);
  roster.set('client-1', createRemoteCombatant({
    id: 'client-1',
    playerName: 'Guest',
    spawnZ: 12,
    settings: baseSettings,
  }));
  roster.set('bot_2', createOfflineBotCombatant({
    id: 'bot_2',
    playerName: 'Bot',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: baseSettings,
  }));

  assert.equal(getAICombatants(roster).length, 2);
  assert.equal(getRemoteCombatants(roster).length, 1);
  assert.ok(isAIControlled(mai));
  assert.ok(isRemoteControlled(roster.get('client-1')!));
  assert.equal(countOfflineBotSlots(roster), 1);
});

test('getMainAI ignores remote id collision', () => {
  const roster = new Map<string, Combatant>();
  roster.set(MAIN_AI_ID, createRemoteCombatant({
    id: MAIN_AI_ID,
    playerName: 'Wrong',
    spawnZ: -12,
    settings: baseSettings,
  }));
  assert.equal(getMainAI(roster), undefined);
});

test('ensureMainAIInRoster is idempotent', () => {
  const roster = new Map<string, Combatant>();
  const a = ensureMainAIInRoster(roster, {
    settings: baseSettings,
    legacy,
    spawnPos: new THREE.Vector3(0, 0, -5),
    yaw: 1,
  });
  const b = ensureMainAIInRoster(roster, {
    settings: baseSettings,
    legacy,
    spawnPos: new THREE.Vector3(9, 0, 9),
    yaw: 2,
  });
  assert.equal(a, b);
  assert.equal(roster.size, 1);
  assert.equal(a.pos.z, -5);
});

test('getDisplayOpponent picks main_ai offline and remote online', () => {
  const roster = new Map<string, Combatant>();
  ensureMainAIInRoster(roster, {
    settings: baseSettings,
    legacy,
    spawnPos: new THREE.Vector3(0, 0, -12),
    yaw: 0,
  });
  assert.equal(getDisplayOpponent(roster, false)?.id, MAIN_AI_ID);

  const remote = createRemoteCombatant({
    id: 'peer',
    playerName: 'Peer',
    spawnZ: 12,
    settings: baseSettings,
  });
  roster.set('peer', remote);
  removeMainAIFromRoster(roster);
  assert.equal(getDisplayOpponent(roster, true, 'peer')?.id, 'peer');
  assert.equal(getPrimaryRemoteOpponent(roster, 'missing')?.id, 'peer');
});

test('getRosterCombatant and isAICombatReady', () => {
  const roster = new Map<string, Combatant>();
  const mai = createMainAICombatant({
    settings: baseSettings,
    legacy,
    spawnPos: new THREE.Vector3(0, 0, -12),
    yaw: 0,
  });
  roster.set(MAIN_AI_ID, mai);
  assert.equal(getRosterCombatant(roster, MAIN_AI_ID)?.id, MAIN_AI_ID);
  mai.invulnerabilityTimer = 0;
  assert.ok(isAICombatReady(mai));
  mai.hp = 0;
  assert.ok(!isAICombatReady(mai));
});

test('combatant factories keep bots medium and preserve explicit remote large model type', () => {
  const main = createMainAICombatant({
    settings: baseSettings,
    legacy,
    spawnPos: new THREE.Vector3(0, 0, -12),
    yaw: 0,
  });
  assert.equal(main.modelType, 'medium');

  const bot = createOfflineBotCombatant({
    id: 'bot_2',
    playerName: 'Heavy Bot',
    team: 'red',
    spawnPos: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    hue: 120,
    difficulty: 'normal',
    settings: baseSettings,
    modelType: 'large',
  } as any);
  assert.equal(bot.modelType, 'medium');

  const remote = createRemoteCombatant({
    id: 'peer',
    playerName: 'Peer',
    spawnZ: 12,
    settings: baseSettings,
    data: { modelType: 'large' },
  } as any);
  assert.equal(remote.modelType, 'large');
});
