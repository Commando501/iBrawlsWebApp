import test from 'node:test';
import assert from 'node:assert/strict';
import { EARNED_TANK_CASES, runEarnedTankTrace } from './grifballEarnedTankContest';

for (const spec of EARNED_TANK_CASES) test(`earned tank opening ${spec.opening}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runEarnedTankTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 300);
  assert.equal(trace.boundary, 'live-earned-tank-contest');
});
test('earned tank matrix covers both teams, orders and tank identities with three refusal controls', () => {
  assert.equal(EARNED_TANK_CASES.length, 32);
  assert.equal(new Set(EARNED_TANK_CASES.map(s => `${s.opening}/${s.team}/${s.reverse}/${s.main}`)).size, 32);
});
for (const opening of ['opening', 'default-roles', 'late-arrival', 'shared-blast'] as const) test(`earned tank exact repeat: ${opening}`, () => {
  const spec = EARNED_TANK_CASES.find(s => s.opening === opening && s.main)!;
  assert.deepEqual(runEarnedTankTrace(spec), runEarnedTankTrace(spec));
});
