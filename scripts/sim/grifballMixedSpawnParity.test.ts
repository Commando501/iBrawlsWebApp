import test from 'node:test';
import assert from 'node:assert/strict';
import { MIXED_SPAWN_CASES, runMixedSpawnTrace } from './grifballMixedSpawnParity';
import { defaultGrifballMap } from '../../src/sim/factory';

for (const spec of MIXED_SPAWN_CASES) test(`mixed spawn ${spec.map.id}/${spec.team}/${spec.reverse}/${spec.playerTick}`, () => {
  const trace = runMixedSpawnTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences));
  assert.equal(trace.frames[4].live.length, 8);
  for (const team of ['blue', 'red']) assert.equal(trace.frames[4].live.filter(a => a.team === team).length, 4);
});

test('mixed spawn matrix covers every map, team, order and local revival timing exactly once', () => {
  assert.equal(MIXED_SPAWN_CASES.length, 156);
  assert.equal(new Set(MIXED_SPAWN_CASES.map(s => `${s.map.id}/${s.team}/${s.reverse}/${s.playerTick}`)).size, 156);
});

const points = [{ x: -10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
const map = { ...structuredClone(defaultGrifballMap()), id: 'mixed-spawn-known-outcomes', spawnPoints: points,
  teamSpawns: { blue: points, red: points } };
for (const team of ['blue', 'red'] as const) for (const reverse of [false, true]) for (const playerTick of [1, 2, 3] as const)
  test(`mixed greedy spawn sequence ${team}/${reverse}/${playerTick}`, () => {
    const trace = runMixedSpawnTrace({ map, team, reverse, playerTick });
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences));
    for (const side of ['live', 'headless'] as const) {
      const [player, ...bots] = trace.frames[4][side];
      assert.deepEqual(player.pos, [-10, 0, 0]);
      const ordered = reverse ? bots.reverse() : bots;
      // Empty arena: first chooses the first slot, next the far end, then center.
      // A prior/same-tick human takes the first slot before any bot is processed.
      const expected = playerTick <= 2 ? [10, 0, -10, -10, -10, -10, -10] : [-10, 10, 0, -10, -10, -10, -10];
      assert.deepEqual(ordered.map(a => a.pos), expected.map(x => [x, 0, 0]));
    }
  });

for (const playerTick of [1, 2, 3] as const) for (const snapshotAt of [1, 2])
  test(`mixed spawn JSON continuation ${playerTick}/${snapshotAt}`, () => {
    const spec = MIXED_SPAWN_CASES.find(s => s.map.id === 'acceptance-spawn-elevation' && s.reverse && s.team === 'red' && s.playerTick === playerTick)!;
    const trace = runMixedSpawnTrace(spec, snapshotAt);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences));
    assert.deepEqual(trace, runMixedSpawnTrace(spec));
  });
