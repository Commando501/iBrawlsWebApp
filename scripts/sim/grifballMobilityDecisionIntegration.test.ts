import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILITY_DECISION_CASES, runMobilityDecisionTrace } from './grifballMobilityDecisionIntegration';
import { jumpCoverage, type JumpCoverageTrace } from './grifballJumpCoverage';

const coverage: JumpCoverageTrace[] = [];
for (const spec of MOBILITY_DECISION_CASES) test(`autonomous jump flight ${spec.team}/${spec.reverse}/${spec.seed}`, () => {
  const trace = runMobilityDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 1800);
  coverage.push({ name: trace.name, scenario: trace.scenario, failureCount: trace.failureCount,
    flights: trace.flights, mainJumpRequests: trace.mainJumpRequests });
});
test('mobility matrix witnesses full flights and real dash rejections for both teams and orders', () => {
  assert.deepEqual(jumpCoverage(coverage, 'mobility').missing, []);
});
for (const seed of [1, 5]) for (const reverse of [false, true]) test(`autonomous jump flight repeats: ${reverse}/${seed}`, () => {
  const spec = { mode: 'contested' as const, team: 'blue' as const, main: true, reverse, seed };
  assert.deepEqual(runMobilityDecisionTrace(spec), runMobilityDecisionTrace(spec));
});
