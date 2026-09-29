import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESSURE_DECISION_CASES, runPressureDecisionTrace } from './grifballPressureDecisionIntegration';
for (const spec of PRESSURE_DECISION_CASES) test(`pressure decision ${JSON.stringify(spec)}`, () => {
  const t = runPressureDecisionTrace(spec);
  assert.equal(t.failureCount, 0, JSON.stringify(t.failures));
  assert.equal(t.frames.length, 180);
});
for (const pressure of ['runner', 'receiver', 'withdraw'] as const) test(`pressure repeatability: ${pressure}`, () => {
  const spec = { pressure, team: 'blue' as const, reverse: false, main: true };
  assert.deepEqual(runPressureDecisionTrace(spec), runPressureDecisionTrace(spec));
});
