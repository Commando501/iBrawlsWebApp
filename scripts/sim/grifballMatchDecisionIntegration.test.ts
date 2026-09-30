import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_DECISION_CASES, runMatchDecisionTrace } from './grifballMatchDecisionIntegration';
import { jumpCoverage, type JumpCoverageTrace } from './grifballJumpCoverage';

const coverage: JumpCoverageTrace[] = [];
for (const spec of MATCH_DECISION_CASES) test(`match decision ${JSON.stringify(spec)}`, () => {
  const trace = runMatchDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, spec.main ? 9000 : spec.mode === 'contested' ? 10800 : 3840);
  coverage.push({ name: trace.name, scenario: trace.scenario, failureCount: trace.failureCount,
    mainJumpRequests: trace.mainJumpRequests });
});
test('complete-match matrix witnesses real dash rejections on both teams', () => {
  assert.deepEqual(jumpCoverage(coverage, 'match').missing, []);
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) for (const main of [false, true]) test(`match decisions repeat: ${mode}/${reverse}/${main}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main };
    assert.deepEqual(runMatchDecisionTrace(spec), runMatchDecisionTrace(spec));
  });
}
