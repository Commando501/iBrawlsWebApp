import test from 'node:test';
import assert from 'node:assert/strict';
import { countNearbyCombatEnemies, type TacticalWeaponActor } from './aiTacticalWeaponChoice';

const self: TacticalWeaponActor = { id: 'self', team: 'blue', pos: { x: 0, y: 0, z: 0 }, hp: 1, maxHp: 1 };
const actor = (id: string, changes: Partial<TacticalWeaponActor> = {}): TacticalWeaponActor =>
  ({ ...self, id, team: 'red', pos: { x: 2, y: 0, z: 0 }, ...changes });

test('enemy count excludes teammates, spectators and inactive bodies and deduplicates aliases', () => {
  const main = actor('main_ai');
  const roster = [self, main, main, actor('friend', { team: 'blue' }), actor('observer', { isObserver: true }),
    actor('dead', { hp: 0 }), actor('respawning', { respawnTimer: .1 }), actor('enemy')];
  assert.equal(countNearbyCombatEnemies(self, roster, true), 2);
  assert.equal(countNearbyCombatEnemies(self, roster, false), 3, 'non-team combat retains other living participants');
});

test('the six-unit crowd boundary is strict and uses full body position', () => {
  const roster = [actor('boundary', { pos: { x: 6, y: 0, z: 0 } }),
    actor('inside', { pos: { x: 5.99, y: 0, z: 0 } }), actor('above', { pos: { x: 0, y: 6, z: 0 } })];
  assert.equal(countNearbyCombatEnemies(self, roster, true), 1);
});

test('unknown team identity preserves live hostility behavior rather than assuming an ally', () => {
  assert.equal(countNearbyCombatEnemies(self, [actor('unknown', { team: undefined })], true), 1);
});

test('a stale main alias cannot override the authoritative roster position or death', () => {
  assert.equal(countNearbyCombatEnemies(self, [actor('main_ai', { hp: 0 }), actor('main_ai')], true), 0);
  assert.equal(countNearbyCombatEnemies(self, [actor('main_ai', { pos: { x: 20, y: 0, z: 0 } }), actor('main_ai')], true), 0);
});
