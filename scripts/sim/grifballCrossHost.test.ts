import test from 'node:test';
import assert from 'node:assert/strict';
import { CrossHostStateComparison, CROSS_HOST_TOLERANCES } from './grifballCrossHost';

const state = () => ({ frame: { tick: 0, phase: 'playing', scores: { blue: 0, red: 0 }, alive: ['a'] },
  actors: [{ id: 'a', yaw: 1.9, hp: 1, weaponTimer: 0.2, pos: [0, 0, 0], vel: [1, 0, 0], aiState: 'APPROACHING' }] });
test('cross-host comparison tolerates transcendental rounding without rounding replay hashes', () => {
  const a = state(), b = state(); b.actors[0].yaw += Number.EPSILON;
  const compare = new CrossHostStateComparison(); compare.compare(JSON.stringify(a), JSON.stringify(b));
  assert.equal(compare.failureCount, 0); assert.equal(compare.comparedFrames, 1);
  assert.ok(compare.maxAbsoluteErrors.angle > 0);
});
test('cross-host comparison accepts bounded accumulated yaw and pitch roundoff', () => {
  const a = { ...state(), localPlayer: { yaw: 0, pitch: 0 } };
  const b = structuredClone(a);
  // Maximum yaw error in the complete mirrored seed-101 Canyon/Grid/Industrial
  // matches after stable routing; all discrete state, timers and health agree.
  b.actors[0].yaw += 8.658851413656521e-12;
  b.localPlayer.pitch = -8.658851413656521e-12;
  const compare = new CrossHostStateComparison(); compare.compare(JSON.stringify(a), JSON.stringify(b));
  assert.equal(compare.failureCount, 0);
  assert.ok(compare.maxAbsoluteErrors.angle > 1e-12);
});

test('angular error budget stays below the linear budget over a 1000-unit ray', () => {
  const radius = 1000;
  for (const angle of [0, 0.5, 1.9, -Math.PI, Math.PI]) {
    const delta = CROSS_HOST_TOLERANCES.angle;
    const displacement = radius * Math.hypot(Math.sin(angle + delta) - Math.sin(angle),
      Math.cos(angle + delta) - Math.cos(angle));
    assert.ok(displacement < 1.01e-7);
  }
});
for (const field of ['yaw', 'pitch']) for (const sign of [-1, 1]) {
  test(`angular comparison enforces the ${field} boundary with sign ${sign}`, () => {
    const a = { ...state(), localPlayer: { [field]: 0 } };
    for (const [delta, accepted] of [[0.5e-10, true], [1e-10, true], [1.01e-10, false], [1e-9, false]] as const) {
      const b = structuredClone(a); b.localPlayer[field] = sign * delta;
      const compare = new CrossHostStateComparison(); compare.compare(JSON.stringify(a), JSON.stringify(b));
      assert.equal(compare.failureCount === 0, accepted, `${field}: ${sign * delta}`);
      assert.equal(compare.maxAbsoluteErrors.angle, delta);
    }
  });
}
for (const field of ['position', 'velocity', 'health', 'timer', 'angle', 'score', 'phase', 'actor', 'length', 'missing', 'sequence']) {
  test(`cross-host comparison rejects corrupted ${field}`, () => {
    const a = state(), b = state();
    if (field === 'position') b.actors[0].pos[0] += 1e-5;
    if (field === 'velocity') b.actors[0].vel[0] += 1e-5;
    if (field === 'health') b.actors[0].hp -= 1e-8;
    if (field === 'timer') b.actors[0].weaponTimer += 1e-5;
    if (field === 'angle') b.actors[0].yaw += 1e-9;
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
