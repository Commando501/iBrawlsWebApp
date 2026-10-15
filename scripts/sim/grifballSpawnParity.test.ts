import test from 'node:test';
import assert from 'node:assert/strict';
import { SPAWN_PARITY_CASES, runSpawnParityTrace } from './grifballSpawnParity';
for (const spec of SPAWN_PARITY_CASES) test(`spawn ${spec.map.id}/${spec.team}/${spec.reverse}/${spec.player}`, () => {
  const result = runSpawnParityTrace(spec);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});

import { defaultGrifballMap, createMatch } from '../../src/sim/factory';
import { tickRespawns } from '../../src/sim/weapons';
const points = [{ x: -10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
const map = { ...structuredClone(defaultGrifballMap()), id: 'spawn-known-outcomes', spawnPoints: points, teamSpawns: { blue: points } };
for (const player of ['alive', 'dead', 'observer'] as const) for (const reverse of [false, true]) {
  test(`known greedy spawn sequence ${player}/${reverse}`, () => {
    const trace = runSpawnParityTrace({ map, team: 'blue', reverse, player });
    assert.equal(trace.differenceCount, 0);
    const first = player === 'alive' ? 10 : -10;
    const second = -first;
    // Main and target revive on frame 1 in roster order. The waiting actor revives
    // on frame 2, sees both occupied ends and the blocker at center, and ties at slot 0.
    assert.deepEqual(trace.frames[2].live.slice(0, 3).map(c => c.pos),
      [[reverse ? second : first, 0, 0], [reverse ? first : second, 0, 0], [-10, 0, 0]]);
  });
}
for (const execution of ['legacy-v1', 'live-roster-v1'] as const) test(`${execution} keeps fixed respawn slots`, () => {
  const sim = createMatch({ seed: 12, map, combatExecution: execution });
  const dead = sim.combatants.find(c => c.team === 'blue')!;
  dead.hp = 0; dead.alive = false; dead.respawnTimer = 0;
  // An occupant at the legacy spawn must not change the old training profile.
  sim.combatants.find(c => c !== dead)!.pos = { ...points[0] };
  tickRespawns(sim, sim.settings, 1 / 60);
  assert.deepEqual(dead.pos, points[0]);
});
