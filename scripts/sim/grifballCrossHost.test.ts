import test from 'node:test';
import assert from 'node:assert/strict';
import { CrossHostStateComparison } from './grifballCrossHost';

const state = () => ({ frame: { tick: 0, phase: 'playing', scores: { blue: 0, red: 0 }, alive: ['a'] },
  actors: [{ id: 'a', yaw: 1.9, hp: 1, weaponTimer: 0.2, pos: [0, 0, 0], vel: [1, 0, 0], aiState: 'APPROACHING' }] });
test('cross-host comparison tolerates transcendental rounding without rounding replay hashes', () => {
  const a = state(), b = state(); b.actors[0].yaw += Number.EPSILON;
  const compare = new CrossHostStateComparison(); compare.compare(JSON.stringify(a), JSON.stringify(b));
  assert.equal(compare.failureCount, 0); assert.equal(compare.comparedFrames, 1);
  assert.ok(compare.maxAbsoluteErrors.angle > 0);
});
for (const field of ['position', 'velocity', 'health', 'timer', 'angle', 'score', 'phase', 'actor', 'length', 'missing', 'sequence']) {
  test(`cross-host comparison rejects corrupted ${field}`, () => {
    const a = state(), b = state();
    if (field === 'position') b.actors[0].pos[0] += 1e-5;
    if (field === 'velocity') b.actors[0].vel[0] += 1e-5;
    if (field === 'health') b.actors[0].hp -= 1e-8;
    if (field === 'timer') b.actors[0].weaponTimer += 1e-5;
    if (field === 'angle') b.actors[0].yaw += 1e-10;
    if (field === 'score') b.frame.scores.blue += 1e-12;
    if (field === 'phase') b.frame.phase = 'scored';
    if (field === 'actor') b.actors[0].id = 'b';
    if (field === 'length') b.actors.push({ ...b.actors[0] });
    if (field === 'missing') delete (b.actors[0] as Partial<typeof b.actors[0]>).weaponTimer;
    if (field === 'sequence') { a.frame.tick = 2; b.frame.tick = 2; }
    const compare = new CrossHostStateComparison(); compare.compare(JSON.stringify(a), JSON.stringify(b));
    assert.ok(compare.failureCount > 0);
  });
}
test('cross-host failures remain counted after bounded diagnostic retention fills', () => {
  const compare = new CrossHostStateComparison();
  for (let tick = 0; tick < 40; tick++) {
    const a = state(), b = state(); a.frame.tick = b.frame.tick = tick; b.frame.phase = 'scored';
    compare.compare(JSON.stringify(a), JSON.stringify(b));
  }
  assert.equal(compare.failureCount, 40); assert.equal(compare.failures.length, 32);
  assert.equal(compare.comparedFrames, 40);
});
