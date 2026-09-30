import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRBORNE_RUNNER_CASES, runAirborneRunnerTrace } from './grifballAirborneRunnerParity';

for (const spec of AIRBORNE_RUNNER_CASES) test(`airborne moving carrier ${JSON.stringify(spec)}`, () => {
  const trace = runAirborneRunnerTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences));
  assert.equal(trace.frames.length, 120);
});

const continuations = AIRBORNE_RUNNER_CASES.filter(spec => spec.motion === 'cross' && spec.hp === 1 &&
  spec.speed === 130 && spec.main && spec.mirror && spec.reverse);
for (const spec of continuations) {
  for (const tick of [3, 4, 8, 50]) test(`airborne carrier JSON continuation ${spec.pose}/${tick}`, () => {
    const trace = runAirborneRunnerTrace(spec, tick);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences));
  });
  test(`airborne carrier repeats exactly ${spec.pose}`, () => {
    assert.deepEqual(runAirborneRunnerTrace(spec), runAirborneRunnerTrace(spec));
  });
}
