import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILITY_DECISION_CASES, runMobilityDecisionTrace } from './grifballMobilityDecisionIntegration';
import { jumpCoverage, type JumpCoverageTrace } from './grifballJumpCoverage';
import { dashDecisionCoverage } from './grifballDashDecisionValidation';

const coverage: JumpCoverageTrace[] = [];
const dashCoverage: Parameters<typeof dashDecisionCoverage>[0][number][] = [];
for (const spec of MOBILITY_DECISION_CASES) test(`autonomous jump flight ${spec.team}/${spec.reverse}/${spec.seed}`, () => {
  const trace = runMobilityDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 3600);
  dashCoverage.push({ failureCount: trace.failureCount, scenario: spec, dash: trace.dash });
  coverage.push({ name: trace.name, scenario: trace.scenario, failureCount: trace.failureCount,
    flights: trace.flights, mainJumpRequests: trace.mainJumpRequests });
});
test('mobility matrix witnesses full flights and real dash rejections for both teams and orders', () => {
  assert.deepEqual(jumpCoverage(coverage, 'mobility').missing, []);
});
test('autonomous dash matrix covers ground commitments, airborne landings and target loss', (t) => {
  assert.deepEqual(dashDecisionCoverage(dashCoverage).missing, []);
  t.diagnostic(JSON.stringify(dashDecisionCoverage(dashCoverage)));
  assert.ok(dashDecisionCoverage(dashCoverage.filter(t => t.scenario.team !== 'red')).missing.includes('red/forward/main'));
  assert.ok(dashDecisionCoverage([]).missing.includes('target-loss'));
  assert.ok(dashDecisionCoverage(dashCoverage.map(t => ({ ...t, dash: { ...t.dash, airborneLandings: [] } })))
    .missing.includes('blue/forward/main/airborne-landing'));
  assert.ok(dashDecisionCoverage(dashCoverage.map(t => ({ ...t, dash: { ...t.dash, failureCount: 1 } })))
    .missing.includes('blue/forward/main/airborne-landing'), 'failed traces cannot supply landing witnesses');
  assert.ok(dashDecisionCoverage(dashCoverage.map(t => ({ ...t, failureCount: 1 })))
    .missing.includes('blue/forward/main/airborne-landing'), 'failures outside the dash audit also disqualify witnesses');
});
for (const seed of [1, 5]) for (const reverse of [false, true]) test(`autonomous jump flight repeats: ${reverse}/${seed}`, () => {
  const spec = { mode: 'contested' as const, team: 'blue' as const, main: true, reverse, seed };
  assert.deepEqual(runMobilityDecisionTrace(spec), runMobilityDecisionTrace(spec));
});
