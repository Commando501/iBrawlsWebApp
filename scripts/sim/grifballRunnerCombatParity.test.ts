import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNNER_COMBAT_CASES, runRunnerCombatTrace } from './grifballRunnerCombatParity';
for (const spec of RUNNER_COMBAT_CASES) test(`runner combat ${JSON.stringify(spec)}`, () => {
  const trace = runRunnerCombatTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});

for (const attack of ['none', 'slash', 'lunge']) for (const hp of [1, 2]) for (const reverse of [false, true])
  for (const snapshotAt of [3, 4, 8, 26]) test(`runner combat snapshot ${attack}/${hp}/${reverse}/${snapshotAt}`, () => {
    const spec = RUNNER_COMBAT_CASES.find(c => c.runner.attack === attack && c.runner.counter && c.frame.hp === hp && c.frame.reverse === reverse
      && c.frame.mirror && c.runner.enemyHp === 1 && c.runner.speed === 130 && c.runner.punchSpeed === .04 && !c.runner.shield)!;
    const trace = runRunnerCombatTrace(spec, snapshotAt);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
