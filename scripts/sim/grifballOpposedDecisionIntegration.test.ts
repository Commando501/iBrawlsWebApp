import test from 'node:test';
import assert from 'node:assert/strict';
import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';

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
