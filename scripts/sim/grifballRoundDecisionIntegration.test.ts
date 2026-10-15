import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_DECISION_CASES, runRoundDecisionTrace } from './grifballRoundDecisionIntegration';

for (const spec of ROUND_DECISION_CASES) test(`round decision ${JSON.stringify(spec)}`, () => {
  const trace = runRoundDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 360);
});
for (const mode of ['win', 'reset', 'instant-reset'] as const) {
  for (const reverse of [false, true]) test(`round decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: true };
    assert.deepEqual(runRoundDecisionTrace(spec), runRoundDecisionTrace(spec));
  });
}
