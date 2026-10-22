import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameStatsStore, createInitialGameStats } from './useCurrentGameStats';

test('stats subscribers receive every frame, functional updates use the latest snapshot, and unsubscribe works', () => {
  const store = createGameStatsStore(createInitialGameStats(90, 0));
  const seen: number[] = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().gameTime));
  for (let i = 0; i < 120; i++) store.setStats(previous => ({ ...previous, gameTime: i }));
  assert.deepEqual(seen, Array.from({ length: 120 }, (_, i) => i));
  const previous = store.getSnapshot();
  store.setStats(previous);
  assert.equal(seen.length, 120);
  unsubscribe();
  store.setStats(stats => ({ ...stats, ping: 45 }));
  assert.equal(store.getSnapshot().gameTime, 119);
  assert.equal(store.getSnapshot().ping, 45);
  assert.equal(previous.ping, 0);
  assert.equal(seen.length, 120);
});

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
