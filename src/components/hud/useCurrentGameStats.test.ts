import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameStats } from './useCurrentGameStats';

test('createInitialGameStats applies saved player hue and lobby ping', () => {
  const stats = createInitialGameStats(215, 42);

  assert.equal(stats.settings.playerHue, 215);
  assert.equal(stats.ping, 42);
});

test('createInitialGameStats keeps the HUD-ready sandbox defaults', () => {
  const stats = createInitialGameStats(90, 0);

  assert.equal(stats.playerHP, 1);
  assert.equal(stats.enemyHP, 1);
  assert.equal(stats.gameTime, 522);
  assert.equal(stats.playerX, 0);
  assert.equal(stats.playerZ, 12);
  assert.equal(stats.enemyZ, -12);
  assert.equal(stats.activeWeapon, 'hammer');
  assert.equal(stats.weaponReady, true);
  assert.equal(stats.settings.weaponReadyTime, 0.5);
  assert.equal(stats.settings.enableSprint, false);
  assert.equal(stats.settings.enableSlide, false);
  assert.deepEqual(stats.lastDeaths, []);
});
