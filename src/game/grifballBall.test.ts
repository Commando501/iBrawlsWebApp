import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialBall,
  attachBallTo,
  dropBall,
  throwBall,
  returnBallHome,
  tickBallPhysics,
  findBallPickup,
  isBallGrabbable,
  predictThrowTrajectory,
  BALL_REST_Y,
} from './grifballBall';

test('a fresh ball is idle at home and grabbable', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  assert.equal(ball.state, 'idle');
  assert.equal(ball.holderId, null);
  assert.equal(ball.pos.y, BALL_REST_Y);
  assert.ok(isBallGrabbable(ball));
});

test('held balls are skipped by physics and not grabbable', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  attachBallTo(ball, 'player');
  assert.equal(ball.state, 'held');
  assert.equal(ball.holderId, 'player');
  assert.ok(!isBallGrabbable(ball));
  assert.equal(tickBallPhysics(ball, 0.016, 8), false);
});

test('dropped ball lands loose at the drop spot and can be grabbed', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  attachBallTo(ball, 'bot_2');
  dropBall(ball, { x: 10, y: 1, z: -4 });
  assert.equal(ball.state, 'loose');
  assert.equal(ball.holderId, null);
  assert.deepEqual({ x: ball.pos.x, z: ball.pos.z }, { x: 10, z: -4 });
  assert.ok(isBallGrabbable(ball));
});

test('thrown ball flies, settles to loose, and is then grabbable', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  throwBall(ball, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 20);
  assert.equal(ball.state, 'thrown');
  assert.ok(!isBallGrabbable(ball)); // mid-flight cannot be grabbed

  let settled = false;
  for (let i = 0; i < 600 && !settled; i++) {
    tickBallPhysics(ball, 1 / 60, 8);
    if (isBallGrabbable(ball)) settled = true; // becomes 'loose' once at rest
  }
  assert.ok(settled, 'ball should settle to loose');
  assert.ok(ball.pos.x > 0, 'ball should travel in +x');
  assert.ok(isBallGrabbable(ball));
});

test('predictThrowTrajectory samples the throw arc through the landing point', () => {
  const points = predictThrowTrajectory({
    from: { x: 2, y: 1.1, z: -3 },
    dir: { x: 0, y: 0, z: -1 },
    speed: 20,
    samples: 9,
  });

  assert.equal(points.length, 9);
  assert.deepEqual(points[0], { x: 2, y: 1.1, z: -3 });
  assert.equal(points.at(-1)?.y, BALL_REST_Y);
  assert.ok((points.at(-1)?.z ?? 0) < -10, 'landing point should extend down the throw heading');
});

test('loose ball auto-returns home after the timeout', () => {
  const ball = createInitialBall({ x: 5, y: 0, z: 5 });
  dropBall(ball, { x: 30, y: 0, z: 10 });
  let returned = false;
  for (let i = 0; i < 1000 && !returned; i++) {
    returned = tickBallPhysics(ball, 1 / 60, 3); // 3s timeout
  }
  assert.ok(returned);
  assert.equal(ball.state, 'idle');
  assert.deepEqual({ x: ball.pos.x, z: ball.pos.z }, { x: 5, z: 5 });
});

test('findBallPickup returns nearest alive candidate within radius', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  dropBall(ball, { x: 0, y: 0, z: 0 });
  const id = findBallPickup(
    ball,
    [
      { id: 'far', pos: { x: 10, y: 0, z: 0 }, alive: true },
      { id: 'near', pos: { x: 1, y: 0, z: 0 }, alive: true },
      { id: 'dead', pos: { x: 0.2, y: 0, z: 0 }, alive: false },
    ],
    1.6
  );
  assert.equal(id, 'near');
});

test('held balls cannot be picked up', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  attachBallTo(ball, 'player');
  const id = findBallPickup(ball, [{ id: 'x', pos: { x: 0, y: 0, z: 0 }, alive: true }], 2);
  assert.equal(id, null);
});

test('returnBallHome clears holder and resets state', () => {
  const ball = createInitialBall({ x: 2, y: 0, z: 3 });
  attachBallTo(ball, 'bot_3');
  returnBallHome(ball);
  assert.equal(ball.state, 'idle');
  assert.equal(ball.holderId, null);
  assert.deepEqual({ x: ball.pos.x, z: ball.pos.z }, { x: 2, z: 3 });
});
