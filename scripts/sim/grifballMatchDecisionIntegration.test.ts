import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_DECISION_CASES, runMatchDecisionTrace } from './grifballMatchDecisionIntegration';

for (const spec of MATCH_DECISION_CASES) test(`match decision ${JSON.stringify(spec)}`, () => {
  const trace = runMatchDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 3840);
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) test(`match decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: false };
    assert.deepEqual(runMatchDecisionTrace(spec), runMatchDecisionTrace(spec));
  });
}
