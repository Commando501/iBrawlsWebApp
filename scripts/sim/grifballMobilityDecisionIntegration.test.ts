import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILITY_DECISION_CASES, runMobilityDecisionTrace, validateMobilityDecisionTrace } from './grifballMobilityDecisionIntegration';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
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
test('landing across carrier death requires verified turnover and next-tick reassignment', () => {
  const raw = runOpposedDecisionTrace({ mode: 'contested', team: 'red', reverse: false, main: true, seed: 8 }, 'mobility');
  assert.equal(raw.failureCount, 0);
  const valid = validateMobilityDecisionTrace(structuredClone(raw));
  assert.equal(valid.failureCount, 0, JSON.stringify(valid.failures));
  assert.deepEqual(valid.landingReassignments, [{ landing: 1286, carrierId: 'cover', reassignedAt: 1287 }]);
  const corruptions = [
    (t: typeof raw) => { t.frames[1286].tick++; },
    (t: typeof raw) => { t.frames[1285].phase = 'countdown'; },
    (t: typeof raw) => { t.frames[1284].ball.state = 'loose'; },
    (t: typeof raw) => { t.frames[1284].assignments = t.frames[1284].assignments.filter(a => a.id !== 'main_ai'); },
    (t: typeof raw) => { t.frames[1284].actors.find(a => a.id === 'cover')!.hp = 0; },
    (t: typeof raw) => { t.frames[1285].actors.find(a => a.id === 'cover')!.hp = 1; },
    (t: typeof raw) => { t.deaths = t.deaths.filter(d => d.tick !== 1286); },
    (t: typeof raw) => { t.impacts = t.impacts.filter(i => i.tick !== 1286); },
    (t: typeof raw) => { t.frames[1285].ball.state = 'held'; },
    (t: typeof raw) => { t.frames[1285].ball.holderId = 'cover'; },
    (t: typeof raw) => { t.frames[1286].actors.find(a => a.id === 'main_ai')!.hp = 0; },
    (t: typeof raw) => { t.frames[1286].assignments = t.frames[1286].assignments.filter(a => a.id !== 'main_ai'); },
    (t: typeof raw) => { t.frames[1286].assignments.find(a => a.id === 'main_ai')!.target = 'cover'; },
  ];
  for (const corrupt of corruptions) {
    const trace = structuredClone(raw); corrupt(trace);
    const result = validateMobilityDecisionTrace(trace);
    assert.ok(result.failures.some(f => f.tick === 1286 && f.field.startsWith('landing retains an assignment')));
    assert.deepEqual(result.landingReassignments, []);
  }
});
