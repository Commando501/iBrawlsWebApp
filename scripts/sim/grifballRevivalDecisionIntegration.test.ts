import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIVAL_DECISION_CASES, runRevivalDecisionTrace, revivalAttackCoverage } from './grifballRevivalDecisionIntegration';

const coverage: ReturnType<typeof runRevivalDecisionTrace>[] = [];
for (const spec of REVIVAL_DECISION_CASES) test(`revival decision ${JSON.stringify(spec)}`, () => {
  const trace = runRevivalDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 600);
  coverage.push(trace);
});
test('revival matrix proves renewed attacks by both carrier identities, teams and update orders', () => {
  assert.deepEqual(revivalAttackCoverage(coverage).missing, []);
  for (const defect of ['no-attacks', 'no-revival', 'before-revival', 'wrong-actor', 'failed']) {
    const changed = coverage.map(t => ({ name: t.name, scenario: t.scenario, failureCount: t.failureCount,
      attacks: structuredClone(t.attacks), revivals: structuredClone(t.revivals) }));
    for (const t of changed.filter(t => t.scenario.team === 'red' && t.scenario.main && t.scenario.reverse)) {
      if (defect === 'no-attacks') t.attacks = [];
      if (defect === 'no-revival') t.revivals = [];
      if (defect === 'before-revival') t.attacks.forEach(a => a.tick = 0);
      if (defect === 'wrong-actor') t.attacks.forEach(a => a.id = 'escort');
      if (defect === 'failed') t.failureCount = 1;
    }
    assert.ok(revivalAttackCoverage(changed).missing.includes('red/true/true'), defect);
  }
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) test(`revival decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: true };
    assert.deepEqual(runRevivalDecisionTrace(spec), runRevivalDecisionTrace(spec));
  });
}
