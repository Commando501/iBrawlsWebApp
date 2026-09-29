import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_INTEGRATION_CASES, runDecisionIntegrationTrace } from './grifballDecisionIntegration';

for (const spec of DECISION_INTEGRATION_CASES) test(`autonomous retrieval ${JSON.stringify(spec)}`, () => {
  const trace = runDecisionIntegrationTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 480);
});

for (const route of ['open', 'detour', 'blocked'] as const) test(`decision trace repeatability: ${route}`, () => {
  const spec = { route, team: 'blue' as const, reverse: false, retrieverId: 'main_ai' as const };
  assert.deepEqual(runDecisionIntegrationTrace(spec), runDecisionIntegrationTrace(spec));
});
