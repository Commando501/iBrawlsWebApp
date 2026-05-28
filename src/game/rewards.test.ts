import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateKillMedals } from './rewards';

test('evaluates special, multikill, spree, and weapon medals', () => {
  const result = evaluateKillMedals({
    isVictimLunging: true,
    victimSpawnTime: 9_500,
    playerHP: 1,
    playerMaxHP: 3,
    playerLastKillTime: 8_500,
    playerMultikillCount: 1,
    playerSpreeCount: 4,
    activeWeapon: 'sword',
    now: 10_000,
  });

  const ids = result.medals.map(medal => medal.id);
  assert.deepEqual(ids, ['showstopper', 'spawnslayer', 'closecall', 'double', 'killingspree', 'swordslayer']);
  assert.equal(result.playerMultikillCount, 2);
  assert.equal(result.playerSpreeCount, 5);
  assert.equal(result.priorityMedal?.id, 'showstopper');
});

test('starts a fresh multikill chain outside the timeout', () => {
  const result = evaluateKillMedals({
    isVictimLunging: false,
    victimSpawnTime: 0,
    playerHP: 3,
    playerMaxHP: 3,
    playerLastKillTime: 1_000,
    playerMultikillCount: 3,
    playerSpreeCount: 0,
    activeWeapon: 'hammer',
    now: 10_000,
  });

  assert.equal(result.playerMultikillCount, 1);
  assert.deepEqual(result.medals.map(medal => medal.id), ['hammertime']);
});
