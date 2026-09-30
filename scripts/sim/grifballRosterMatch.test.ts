import test from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER_MATCH_CASES, runRosterMatchTrace } from './grifballRosterMatch';

for (const spec of ROSTER_MATCH_CASES) test(`complete roster match ${spec.map.id}/${spec.teamSize}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runRosterMatchTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.at(-1)!.phase, 'matchEnd');
  assert.equal(trace.frames.at(-1)!.actors.length, spec.teamSize * 2);
  if (spec.map.id === 'championship_stadium' && spec.teamSize === 3 && spec.main && !spec.reverse && spec.team === 'red') {
    const lateDeaths = trace.deaths.filter(d => d.tick > trace.terminalTick!);
    assert.equal(lateDeaths.length, 2, 'committed terminal impacts remain observable');
    for (const death of lateDeaths) assert.ok(trace.revivals.some(r => r.id === death.id && r.tick === death.tick + 181));
    assert.equal(trace.ticks - trace.terminalTick!, 192);
  }
});

test('roster match matrix covers both sizes, maps, teams, orders and carrier identities', () => {
  assert.equal(ROSTER_MATCH_CASES.length, 32);
  assert.equal(new Set(ROSTER_MATCH_CASES.map(s => `${s.map.id}/${s.teamSize}/${s.team}/${s.reverse}/${s.main}`)).size, 32);
});
for (const [mapId, teamSize] of [['championship_stadium', 3], ['synthwave_grid_arena', 4]] as const)
  test(`complete roster match repeats exactly: ${mapId}/${teamSize}`, () => {
    const spec = ROSTER_MATCH_CASES.find(s => s.map.id === mapId && s.teamSize === teamSize && s.main && s.reverse)!;
    assert.deepEqual(runRosterMatchTrace(spec), runRosterMatchTrace(spec));
  });
