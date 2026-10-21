import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBallTo, createInitialBall, throwBall, tickBallPhysics, BALL_REST_Y } from './grifballBall';
import { createBallCombatantColliders, type BallColliderActor } from './grifballBallColliders';
import { moveBallWithContacts, type BallContactCollider } from './grifballBallContacts';

const actor = (overrides: Partial<BallColliderActor> = {}): BallColliderActor => ({
  id: 'bot', pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
  isCrouching: false, activeWeapon: 'ball', weaponState: 'ready', weaponTimer: 0, ...overrides,
});
const colliders = (actors: BallColliderActor[], dt = 1 / 60) => createBallCombatantColliders(actors, dt, {});
const thrown = (from = { x: 0, y: 1, z: -5 }, speed = 30) => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  throwBall(ball, from, { x: 0, y: 0, z: 1 }, speed, 0);
  return ball;
};

test('a fast throw cannot tunnel through a combatant body', () => {
  const ball = thrown(undefined, 1000);
  tickBallPhysics(ball, .01, 8, null, colliders([actor()], .01));
  assert.ok(ball.vel.z < 0);
  assert.ok(ball.pos.z < -.9, 'use the remaining tick to move away after impact');
});

test('a glancing hit deflects sideways rather than sticking inside the body', () => {
  const ball = thrown({ x: .7, y: 1, z: -3 }, 20);
  tickBallPhysics(ball, .2, 8, null, colliders([actor()], .2));
  assert.ok(ball.vel.x > 0);
  assert.ok(Math.hypot(ball.pos.x, ball.pos.z) >= .9);
});

for (const weapon of ['sword', 'pistol']) test(`${weapon} contact deflects a pass that misses the body`, () => {
  const ball = thrown({ x: -3, y: 1.1, z: weapon === 'sword' ? -1.2 : -1 });
  ball.vel = { x: 30, y: 0, z: 0 };
  const bodyOnly = structuredClone(ball);
  const blockers = colliders([actor({ activeWeapon: weapon })], .15);
  tickBallPhysics(bodyOnly, .15, 8, null, blockers.filter(c => c.kind === 'body'));
  tickBallPhysics(ball, .15, 8, null, blockers);
  assert.equal(bodyOnly.vel.x, 30, 'the pass clears the body');
  assert.ok(ball.vel.x < 29, 'the equipped weapon deflects the pass');
});

test('hammer head and shaft both have collision, unequipped weapons do not', () => {
  const equipped = colliders([actor({ activeWeapon: 'hammer' })]);
  assert.equal(equipped.filter(c => c.kind === 'weapon').length, 2);
  for (const target of equipped.filter(c => c.kind === 'weapon')) {
    const center = { x: (target.endA.x + target.endB.x) / 2, y: (target.endA.y + target.endB.y) / 2, z: (target.endA.z + target.endB.z) / 2 };
    const body = { pos: { ...center, z: center.z - 2 }, vel: { x: 0, y: 0, z: 30 } };
    assert.equal(moveBallWithContacts(body, .35, .1, [target]), true);
    assert.ok(body.vel.z < 0);
  }
  assert.equal(colliders([actor({ activeWeapon: 'ball' })]).filter(c => c.kind === 'weapon').length, 0);
  assert.equal(colliders([actor({ activeWeapon: 'sword', weaponState: 'swapping' })]).filter(c => c.kind === 'weapon').length, 0);
});

test('crouching, model size, and airborne height affect body contact', () => {
  const hits = (a: BallColliderActor, x: number, y: number) => {
    const ball = thrown({ x, y, z: -2 }, 30);
    tickBallPhysics(ball, .1, 8, null, colliders([a], .1));
    return ball.vel.z < 30 - .001;
  };
  assert.equal(hits(actor(), 0, 1.85), true);
  assert.equal(hits(actor({ isCrouching: true }), 0, 1.85), false);
  assert.equal(hits(actor({ pos: { x: 0, y: 3, z: 0 } }), 0, 1), false);
  assert.equal(hits(actor(), 1, 1), false);
  assert.equal(hits(actor({ modelType: 'large' }), 1, 1), true);
});

test('a body crossing a stationary ball transfers motion without tunneling', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  ball.state = 'loose'; ball.pos.y = 1;
  const moving = actor({ pos: { x: 2, y: 0, z: 0 }, vel: { x: 40, y: 0, z: 0 } });
  tickBallPhysics(ball, .1, 8, null, colliders([moving], .1));
  assert.ok(ball.vel.x > 0);
  assert.ok(ball.pos.x > 2);
  assert.equal(ball.state, 'loose', 'a nudged loose ball remains available for pickup');
});

test('a swept weapon can bat a stationary ball between frame endpoints', () => {
  const moving: BallContactCollider = {
    ownerId: 'bot', kind: 'weapon', radius: .08,
    startA: { x: -2, y: .5, z: 0 }, startB: { x: -2, y: 1.5, z: 0 },
    endA: { x: 2, y: .5, z: 0 }, endB: { x: 2, y: 1.5, z: 0 },
  };
  const ball = { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
  assert.equal(moveBallWithContacts(ball, .35, .1, [moving]), true);
  assert.ok(ball.vel.x > 40);
});

test('a pass clears its thrower and can hit them again after clearance', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  attachBallTo(ball, 'bot');
  throwBall(ball, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 10, 0);
  const blockers = colliders([actor()]);
  tickBallPhysics(ball, .15, 8, null, blockers);
  assert.equal(ball.vel.z, 10);
  assert.equal(ball.releaseOwnerId, undefined);
  ball.vel.z = -10;
  tickBallPhysics(ball, .1, 8, null, blockers);
  assert.ok(ball.vel.z > 0);
});

test('held balls do not collide, and ordinary idle balls retain their home state', () => {
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  tickBallPhysics(ball, .016, 8, null, colliders([actor()]));
  assert.equal(ball.state, 'idle');
  assert.equal(ball.pos.y, BALL_REST_Y);
  attachBallTo(ball, 'bot');
  const before = structuredClone(ball);
  tickBallPhysics(ball, 1, 8, null, colliders([actor({ activeWeapon: 'hammer' })]));
  assert.deepEqual(ball, before);
});

test('contact order and a restored snapshot produce identical flight', () => {
  const actors = [actor({ id: 'a' }), actor({ id: 'b', pos: { x: .5, y: 0, z: 1 } })];
  const first = thrown(), second = structuredClone(first);
  for (let tick = 0; tick < 90; tick++) {
    tickBallPhysics(first, 1 / 60, 8, null, colliders(actors));
    tickBallPhysics(second, 1 / 60, 8, null, colliders([...actors].reverse()));
  }
  assert.deepEqual(first, second);
});
