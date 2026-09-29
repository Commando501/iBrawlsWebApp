import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_OBJECTIVE_CASES, runFrameObjectiveTrace } from './grifballFrameObjectiveParity';
for (const spec of FRAME_OBJECTIVE_CASES) test(`frame objective ${JSON.stringify(spec)}`, () => {
  const trace = runFrameObjectiveTrace(spec); assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
for (const lunge of [false, true]) test(`frame objective snapshot ${lunge}`, () => {
  const trace = runFrameObjectiveTrace({ player: true, lunge, goal: false, hp: 1, reverse: true, mirror: true }, 1);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
