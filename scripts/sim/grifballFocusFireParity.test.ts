import test from 'node:test';
import assert from 'node:assert/strict';
import { FOCUS_FIRE_CASES, runFocusFireTrace } from './grifballFocusFireParity';

test('moving focus fire covers 152 distinct encounters and controls', () => {
  assert.equal(FOCUS_FIRE_CASES.length, 152);
  assert.equal(new Set(FOCUS_FIRE_CASES.map(s => JSON.stringify(s))).size, 152);
});
for (const spec of FOCUS_FIRE_CASES) test(`moving focus fire ${JSON.stringify(spec)}`, () => {
  const trace = runFocusFireTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const motion of ['retreat', 'cross', 'approach'] as const) {
  for (const hp of [1, 3]) test(`focus fire snapshot ${motion}/${hp} HP`, () => {
    const spec = FOCUS_FIRE_CASES.find(s => s.runner.motion === motion && s.hp === hp
      && s.runner.attack === 'slash' && s.runner.secondAttack === 'lunge' && s.mirror && s.reverse)!;
    const trace = runFocusFireTrace(spec, 3);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
  test(`focus fire exact repeat ${motion}`, () => {
    const spec = FOCUS_FIRE_CASES.find(s => s.runner.motion === motion && s.hp === 3
      && s.runner.attack === 'lunge' && s.runner.secondAttack === 'slash' && s.mirror && s.reverse)!;
    assert.deepEqual(runFocusFireTrace(spec), runFocusFireTrace(spec));
  });
}
