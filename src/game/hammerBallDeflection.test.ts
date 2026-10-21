import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_REST_Y, createInitialBall, throwBall } from './grifballBall';
import { deflectBallWithHammer } from './hammerBallDeflection';

const origin = { x: 0, y: 0, z: 0 };
function movingBall(speed = 20) {
  const ball = createInitialBall(origin);
  throwBall(ball, { x: 3, y: 4, z: 0 }, { x: -1, y: 0, z: 0 }, speed, 0);
  return ball;
}
for (const speed of [9, 26]) for (const strength of [.5, 1, 2, 3]) {
  test(`incoming speed ${speed}, strength ${strength}: redirects away at proportional speed`, () => {
    const ball = movingBall(speed);
    ball.releaseOwnerId = 'thrower';
    assert.equal(deflectBallWithHammer(ball, origin, ball.pos, 1, { hammerBallDeflectionStrength: strength }), true);
    assert.ok(Math.abs(ball.vel.x - 3 * speed * strength / 5) < 1e-9);
    assert.ok(Math.abs(ball.vel.y - 4 * speed * strength / 5) < 1e-9);
    assert.equal(ball.vel.z, 0);
    assert.equal(ball.releaseOwnerId, undefined);
  });
}
for (const reason of ['disabled', 'zero strength', 'held', 'stationary', 'out of range']) {
  test(`${reason}: no blast deflection`, () => {
    const ball = movingBall();
    const settings = { hammerBallDeflectionEnabled: reason !== 'disabled', hammerBallDeflectionStrength: reason === 'zero strength' ? 0 : 1 };
    if (reason === 'held') { ball.state = 'held'; ball.holderId = 'runner'; }
    if (reason === 'stationary') ball.vel = { ...origin };
    const before = structuredClone(ball);
    assert.equal(deflectBallWithHammer(ball, origin, reason === 'out of range' ? origin : ball.pos, 1, settings), false);
    assert.deepEqual(ball, before);
  });
}
for (const state of ['idle', 'loose'] as const) for (const speed of [0, 20]) {
  test(`${state} ground ball at speed ${speed} is unaffected by hammer blasts`, () => {
    const ball = movingBall(speed);
    ball.state = state;
    ball.pos.y = BALL_REST_Y;
    ball.looseTimer = 2;
    const before = structuredClone(ball);
    assert.equal(deflectBallWithHammer(ball, origin, ball.pos, 4.5, { hammerBallDeflectionStrength: 3 }), false);
    assert.deepEqual(ball, before);
  });
}
test('the ball surface can touch the blast edge; the source is the attacker, not the explosion center', () => {
  const ball = movingBall();
  ball.pos = { x: 1.3, y: 0, z: 0 };
  assert.equal(deflectBallWithHammer(ball, { x: 1.3, y: 0, z: -2 }, origin, 1, {}), true);
  assert.deepEqual(ball.vel, { x: 0, y: 0, z: 20 });
});
test('coincident attacker and ball reverse incoming travel without NaNs', () => {
  const ball = movingBall();
  assert.equal(deflectBallWithHammer(ball, ball.pos, ball.pos, 1, {}), true);
  assert.equal(ball.vel.x, 20);
  assert.equal(Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z), 20);
});
