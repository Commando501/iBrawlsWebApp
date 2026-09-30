import test from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER_MATCH_CASES, runRosterMatchTrace } from './grifballRosterMatch';
import { ROUND_FRAME_CASES, runRoundFrameTrace } from './grifballRoundFrameParity';

for (const spec of ROSTER_MATCH_CASES) test(`complete roster match ${spec.map.id}/${spec.teamSize}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runRosterMatchTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.at(-1)!.phase, 'matchEnd');
  assert.equal(trace.frames.at(-1)!.actors.length, spec.teamSize * 2);
  for (const death of trace.deaths.filter(d => d.tick > trace.terminalTick!))
    assert.ok(trace.revivals.some(r => r.id === death.id && r.tick === death.tick + 181));
});

// Guarantee the terminal-impact boundary directly instead of requiring an
// autonomous seed to keep producing the same incidental post-match deaths.
for (const reverse of [false, true]) for (const attack of ['slash', 'slam', 'swipe'] as const)
  test(`committed terminal ${attack} revives after full delay / reversed=${reverse}`, () => {
    const round = ROUND_FRAME_CASES.find(s => s.map.id === 'championship_stadium' && s.winner && !s.player && !s.mirror && s.reverse === reverse)!;
    const trace = runRoundFrameTrace(round, undefined, { attack, impactTick: 17, hp: 1 }, undefined, 200);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
    for (const side of ['live', 'headless'] as const) {
      assert.equal(trace.frames[15][side].match.phase, 'matchEnd');
      const victim = trace.frames[16][side].actors.find(a => a.respawn === 3);
      assert.ok(victim, 'committed impact kills after match end');
      assert.equal(victim.hp, 0);
      assert.equal(trace.frames[196][side].actors.find(a => a.id === victim.id)!.hp, 0);
      assert.equal(trace.frames[197][side].actors.find(a => a.id === victim.id)!.hp, victim.maxHp);
      assert.equal(trace.frames[199][side].match.phase, 'matchEnd');
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
