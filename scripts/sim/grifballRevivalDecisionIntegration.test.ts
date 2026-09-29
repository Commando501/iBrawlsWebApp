import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIVAL_DECISION_CASES, runRevivalDecisionTrace } from './grifballRevivalDecisionIntegration';

for (const spec of REVIVAL_DECISION_CASES) test(`revival decision ${JSON.stringify(spec)}`, () => {
  const trace = runRevivalDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 600);
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) test(`revival decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: true };
    assert.deepEqual(runRevivalDecisionTrace(spec), runRevivalDecisionTrace(spec));
  });
}
