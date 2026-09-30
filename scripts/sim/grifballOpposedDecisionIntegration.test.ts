import test from 'node:test';
import assert from 'node:assert/strict';
import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace, validateOpeningCombatCredit } from './grifballOpposedDecisionIntegration';

test('opening combat credit permits a real second kill but rejects missing, duplicated or misplaced credit', () => {
  const actors = [{ id: 'defender', kills: 2, deaths: 0 }, { id: 'carrier', kills: 0, deaths: 1 }, { id: 'escort', kills: 0, deaths: 1 }];
  const impacts = [{ tick: 8, id: 'defender', victims: ['carrier'] }, { tick: 100, id: 'defender', victims: ['escort'] }];
  const deaths = [{ tick: 8, id: 'carrier' }, { tick: 100, id: 'escort' }];
  assert.deepEqual(validateOpeningCombatCredit(actors, impacts, deaths), []);
  for (const defect of ['missing-credit', 'wrong-owner', 'missing-impact', 'duplicate-impact', 'missing-death', 'wrong-time']) {
    const a = structuredClone(actors), i = structuredClone(impacts), d = structuredClone(deaths);
    if (defect === 'missing-credit') a[0].kills = 1;
    if (defect === 'wrong-owner') { a[0].kills = 1; a[1].kills = 1; }
    if (defect === 'missing-impact') i.pop();
    if (defect === 'duplicate-impact') i.push({ ...i[1] });
    if (defect === 'missing-death') d.pop();
    if (defect === 'wrong-time') d[1].tick++;
    assert.ok(validateOpeningCombatCredit(a, i, d).length, defect);
  }
});

for (const spec of OPPOSED_DECISION_CASES) test(`opposed decision ${JSON.stringify(spec)}`, () => {
  const trace = runOpposedDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 150);
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) test(`opposed decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: true };
    assert.deepEqual(runOpposedDecisionTrace(spec), runOpposedDecisionTrace(spec));
  });
}
