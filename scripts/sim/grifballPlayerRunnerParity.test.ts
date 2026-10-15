import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_RUNNER_CASES, runPlayerRunnerTrace } from './grifballPlayerRunnerParity';

test('moving local runner covers 864 distinct configurations', () => {
  assert.equal(PLAYER_RUNNER_CASES.length, 864);
  assert.equal(new Set(PLAYER_RUNNER_CASES.map(s => JSON.stringify(s))).size, 864);
});
for (const spec of PLAYER_RUNNER_CASES) test(`moving player runner ${JSON.stringify(spec)}`, () => {
  const trace = runPlayerRunnerTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const motion of ['retreat', 'cross', 'approach'] as const) {
  for (const hp of [1, 2]) test(`player runner snapshot ${motion}/${hp} HP`, () => {
    const spec = PLAYER_RUNNER_CASES.find(s => s.runner.motion === motion && s.hp === hp && s.runner.attack === 'lunge'
      && s.runner.counter && s.runner.mainAttacker && s.mirror && s.reverse)!;
    const trace = runPlayerRunnerTrace(spec, 3);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
  test(`player runner exact repeat ${motion}`, () => {
    const spec = PLAYER_RUNNER_CASES.find(s => s.runner.motion === motion && s.hp === 2 && s.runner.attack === 'lunge'
      && s.runner.counter && s.runner.mainAttacker && s.mirror && s.reverse)!;
    assert.deepEqual(runPlayerRunnerTrace(spec), runPlayerRunnerTrace(spec));
  });
}
