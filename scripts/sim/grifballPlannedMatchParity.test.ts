import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANNED_MATCH_CASES, plannedMatchCaseKey, runPlannedMatchParityTrace, plannedMatchCoverage } from './grifballPlannedMatchParity';

for (const scenario of PLANNED_MATCH_CASES) test(plannedMatchCaseKey(scenario), t => {
  const trace = runPlannedMatchParityTrace(scenario);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  // Current Championship Stadium: half extents 61.5 x 33.08, goals at +/-56.5.
  // The old 52 x 23 court ended at 2263 with goals at 684 and 2022.
  assert.equal(trace.finalTick, 2535);
  assert.deepEqual(trace.goals, [760, 2294]);
  assert.equal(trace.frames.length, trace.finalTick + 5);
  assert.equal(trace.resets, 1); assert.equal(trace.countdowns, 2);
  assert.ok(trace.postResetPickups > 0); assert.equal(trace.passes, 0);
  t.diagnostic(JSON.stringify({ goals: trace.goals, finalTick: trace.finalTick, frames: trace.frames.length }));
});

test('planned match coverage rejects missing, duplicate, failed and incomplete lifecycle evidence', () => {
  const valid = PLANNED_MATCH_CASES.map(scenario => ({ name: plannedMatchCaseKey(scenario), failureCount: 0,
    goals: [684, 2022], finalTick: 2263, resets: 1, countdowns: 2, postResetPickups: 1, passes: 0,
    frames: [{ tick: 2268, phase: 'matchEnd' }] }));
  assert.deepEqual(plannedMatchCoverage(valid), { required: 8, completed: 8, errors: [] });
  for (const defect of ['missing', 'duplicate', 'renamed', 'failed', 'goal', 'goal-order', 'reset', 'countdown',
    'no-pickup', 'invented-pass', 'no-winner', 'truncated', 'nonterminal', 'no-frames'] as const) {
    const traces = structuredClone(valid), first = traces[0];
    if (defect === 'missing') traces.pop();
    if (defect === 'duplicate') traces[1] = structuredClone(first);
    if (defect === 'renamed') first.name = 'undeclared';
    if (defect === 'failed') first.failureCount = 1;
    if (defect === 'goal') first.goals.pop();
    if (defect === 'goal-order') first.goals.reverse();
    if (defect === 'reset') first.resets = 0;
    if (defect === 'countdown') first.countdowns = 1;
    if (defect === 'no-pickup') first.postResetPickups = 0;
    if (defect === 'invented-pass') first.passes = 1;
    if (defect === 'no-winner') first.finalTick = 0;
    if (defect === 'truncated') first.frames[0].tick--;
    if (defect === 'nonterminal') first.frames[0].phase = 'playing';
    if (defect === 'no-frames') first.frames = [];
    assert.ok(plannedMatchCoverage(traces).errors.length > 0, defect);
  }
});
