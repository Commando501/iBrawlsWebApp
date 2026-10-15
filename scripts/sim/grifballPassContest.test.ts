import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_CONTEST_CASES, PASS_CONTEST_OPENINGS, runPassContestTrace } from './grifballPassContest';

for (const spec of PASS_CONTEST_CASES) test(`autonomous pass contest ${spec.opening}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runPassContestTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 1200);
});
test('pass contest covers five openings with both teams, actor orders and carrier identities', () => {
  assert.equal(PASS_CONTEST_CASES.length, 40);
  assert.equal(new Set(PASS_CONTEST_CASES.map(s => `${s.opening}/${s.team}/${s.reverse}/${s.main}`)).size, 40);
});
for (const opening of Object.keys(PASS_CONTEST_OPENINGS)) test(`autonomous pass contest repeats: ${opening}`, () => {
  const spec = PASS_CONTEST_CASES.find(s => s.opening === opening && s.main)!;
  assert.deepEqual(runPassContestTrace(spec), runPassContestTrace(spec));
});
