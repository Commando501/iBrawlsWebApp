import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_DECISION_CASES, runPassDecisionTrace } from './grifballPassDecisionIntegration';

for (const spec of PASS_DECISION_CASES) test(`autonomous pass ${JSON.stringify(spec)}`, () => {
  const trace = runPassDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 360);
});

for (const mode of ['pass', 'cancel-receiver', 'resume'] as const) test(`pass decision repeatability: ${mode}`, () => {
  const spec = { mode, team: 'blue' as const, reverse: false, carrierId: 'main_ai' as const };
  assert.deepEqual(runPassDecisionTrace(spec), runPassDecisionTrace(spec));
});
