import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, buildCombatantIds, defaultGrifballMap } from './factory';
import { resolveGrifballTeam } from '../game/grifballTeams';

test('default match is a 4v4 on the championship arena', () => {
  const s = createMatch({ seed: 1 });
  assert.equal(s.combatants.length, 8);
  const blue = s.combatants.filter((c) => c.team === 'blue').length;
  const red = s.combatants.filter((c) => c.team === 'red').length;
  assert.equal(blue, 4);
  assert.equal(red, 4);
  assert.equal(s.goalPlates.length, 2, 'two goal plates');
  assert.equal(s.match.phase, 'countdown');
  assert.equal(s.tick, 0);
});

test('combatant ids follow the live grifball roster and team split', () => {
  const ids = buildCombatantIds({ blue: 4, red: 4 });
  assert.deepEqual(ids, ['player', 'main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7']);
  // player always blue; resolveGrifballTeam decides the rest.
  const s = createMatch({ seed: 5 });
  for (const c of s.combatants) {
    if (c.id === 'player') assert.equal(c.team, 'blue');
    else assert.equal(c.team, resolveGrifballTeam(c.id));
  }
});

test('combatants spawn alive at full hp inside their team cluster', () => {
  const s = createMatch({ seed: 3 });
  for (const c of s.combatants) {
    assert.ok(c.alive);
    assert.equal(c.hp, c.maxHp);
    assert.ok(c.hp > 0);
    // blue spawns at -x, red at +x on the championship arena.
    if (c.team === 'blue') assert.ok(c.pos.x < 0, `${c.id} blue should spawn at -x`);
    if (c.team === 'red') assert.ok(c.pos.x > 0, `${c.id} red should spawn at +x`);
  }
});

test('no two combatants share a spawn point', () => {
  const s = createMatch({ seed: 9 });
  const seen = new Set<string>();
  for (const c of s.combatants) {
    const key = `${c.pos.x},${c.pos.z}`;
    assert.ok(!seen.has(key), `duplicate spawn at ${key}`);
    seen.add(key);
  }
});

test('default grifball map has goal plates for both teams', () => {
  const map = defaultGrifballMap();
  const plates = map.objects.filter((o) => o.goalPlateTeam);
  const teams = new Set(plates.map((p) => p.goalPlateTeam));
  assert.ok(teams.has('blue') && teams.has('red'));
});

test('createMatch is deterministic for a given seed', () => {
  const a = createMatch({ seed: 777 });
  const b = createMatch({ seed: 777 });
  assert.equal(JSON.stringify(a.combatants), JSON.stringify(b.combatants));
  assert.equal(a.rngState, b.rngState);
});
