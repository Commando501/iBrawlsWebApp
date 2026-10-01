import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicTrace, LiveTimings, PLANNER_REFRESH_TRACE_LIMIT, assertPlannerRefreshTrace, retainPlannerRefreshTrace } from './telemetry';

test('state observation preserves exact hashes and cannot mutate the recorded state', async () => {
  const captured: string[] = [], normal = new DeterministicTrace();
  const observed = new DeterministicTrace(value => { captured.push(value); JSON.parse(value).position[0] = 999; });
  for (let tick = 0; tick < 121; tick++) {
    const value = { tick, position: [tick / 3, 0, 1] };
    normal.add(value); observed.add(value);
  }
  assert.equal(captured.length, 121);
  assert.equal(JSON.parse(captured[0]).position[0], 0);
  assert.deepEqual(await observed.finish(), await normal.finish());
});

test('planner timing trace captures only valid warm refreshes and owns exported samples', () => {
  const timing = new LiveTimings();
  timing.playingTicks = 119; timing.record('plannerRefresh', 9);
  timing.playingTicks = 120; timing.record('plannerBetween', 1); timing.record('plannerRefresh', 2);
  timing.playingTicks = 132; timing.record('plannerRefresh', 4); timing.record('plannerRefresh', NaN);
  const result = timing.finish();
  assert.deepEqual(result.plannerRefreshTrace, { version: 1, samples: [[120, 2], [132, 4]], dropped: 0 });
  assert.equal(result.dropped, 1);
  assertPlannerRefreshTrace(result);
  result.plannerRefreshTrace!.samples[0][1] = 99;
  assert.equal(timing.finish().plannerRefreshTrace!.samples[0][1], 2);
});

test('planner trace truncation preserves the full distribution and accounts for every sample', () => {
  const timing = new LiveTimings();
  for (let i = 0; i < PLANNER_REFRESH_TRACE_LIMIT + 9; i++) {
    timing.playingTicks = 120 + i; timing.record('plannerRefresh', i + 1);
  }
  const result = timing.finish();
  assert.equal(result.plannerRefreshTrace!.samples.length, PLANNER_REFRESH_TRACE_LIMIT);
  assert.equal(result.plannerRefreshTrace!.dropped, 9);
  assert.equal(result.warm.plannerRefresh.maxMs, PLANNER_REFRESH_TRACE_LIMIT + 9);
  const retained = retainPlannerRefreshTrace(result.plannerRefreshTrace!, 7);
  assert.equal(retained.samples.length, 7);
  assert.equal(retained.dropped, PLANNER_REFRESH_TRACE_LIMIT + 2);
  assertPlannerRefreshTrace({ ...result, plannerRefreshTrace: retained });
  assert.equal(result.plannerRefreshTrace!.samples.length, PLANNER_REFRESH_TRACE_LIMIT);
});

test('planner trace rejects contradictory counts, times and distributions but accepts historical absence', () => {
  const timing = new LiveTimings();
  timing.playingTicks = 120; timing.record('plannerRefresh', 2);
  timing.playingTicks = 132; timing.record('plannerRefresh', 4);
  const result = timing.finish();
  for (const patch of [
    { version: 2 }, { dropped: -1 }, { dropped: 1 }, { samples: [[119, 2], [132, 4]] },
    { samples: [[120, 2], [133, 4]] }, { samples: [[132, 2], [120, 4]] },
    { samples: [[120, -1], [132, 4]] }, { samples: [[120, 2], [132, Infinity]] },
    { samples: [[120, 2], [132, 3]] },
  ]) assert.throws(() => assertPlannerRefreshTrace({ ...result, plannerRefreshTrace: { ...result.plannerRefreshTrace!, ...patch } } as any), /planner refresh trace|Planner refresh trace/);
  delete result.plannerRefreshTrace;
  assert.doesNotThrow(() => assertPlannerRefreshTrace(result));
});
