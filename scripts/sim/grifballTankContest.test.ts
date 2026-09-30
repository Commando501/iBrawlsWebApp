import test from 'node:test';
import assert from 'node:assert/strict';
import { TANK_CONTEST_CASES, runTankContestTrace } from './grifballTankContest';

for (const spec of TANK_CONTEST_CASES) test(`live tank commitment ${spec.opening}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runTankContestTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 300);
});
test('tank matrix covers eight openings, both teams, orders and initial carrier identities', () => {
  assert.equal(TANK_CONTEST_CASES.length, 64);
  assert.equal(new Set(TANK_CONTEST_CASES.map(s => `${s.opening}/${s.team}/${s.reverse}/${s.main}`)).size, 64);
});
for (const opening of ['opening', 'shared-blast', 'late-cover'] as const) test(`tank trace repeats: ${opening}`, () => {
  const spec = TANK_CONTEST_CASES.find(s => s.opening === opening && s.main)!;
  assert.deepEqual(runTankContestTrace(spec), runTankContestTrace(spec));
});
