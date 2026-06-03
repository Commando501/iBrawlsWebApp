/**
 * Pure Grifball ball state + physics. No THREE / DOM dependencies so it can be
 * unit-tested directly; the component owns rendering, weapon swaps and respawns.
 */

export type GrifballBallState = 'idle' | 'held' | 'loose' | 'thrown';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GrifballBall {
  state: GrifballBallState;
  /** Combatant id currently carrying the ball, or null. */
  holderId: string | null;
  pos: Vec3;
  vel: Vec3;
  /** Seconds the ball has sat loose/idle untouched (drives auto-return). */
  looseTimer: number;
  /** Center / neutral home the ball returns to between rounds. */
  home: Vec3;
}

/** Resting height of the ball center above the floor. */
export const BALL_REST_Y = 0.35;
const GRAVITY = 18.0;
const GROUND_RESTITUTION = 0.45;
const GROUND_FRICTION = 0.86;
const SETTLE_SPEED = 1.2;

export interface BallPickupCandidate {
  id: string;
  pos: Vec3;
  alive: boolean;
}

export function createInitialBall(home: Vec3): GrifballBall {
  return {
    state: 'idle',
    holderId: null,
    pos: { ...home, y: BALL_REST_Y },
    vel: { x: 0, y: 0, z: 0 },
    looseTimer: 0,
    home: { ...home },
  };
}

/** Reset the ball to its neutral home (round start / auto-return). */
export function returnBallHome(ball: GrifballBall): void {
  ball.state = 'idle';
  ball.holderId = null;
  ball.pos = { x: ball.home.x, y: BALL_REST_Y, z: ball.home.z };
  ball.vel = { x: 0, y: 0, z: 0 };
  ball.looseTimer = 0;
}

/** A combatant grabs the ball. */
export function attachBallTo(ball: GrifballBall, holderId: string): void {
  ball.state = 'held';
  ball.holderId = holderId;
  ball.vel = { x: 0, y: 0, z: 0 };
  ball.looseTimer = 0;
}

/** Ball drops loose at a position (carrier death / fumble). */
export function dropBall(ball: GrifballBall, at: Vec3): void {
  ball.state = 'loose';
  ball.holderId = null;
  ball.pos = { x: at.x, y: BALL_REST_Y, z: at.z };
  ball.vel = { x: 0, y: 0, z: 0 };
  ball.looseTimer = 0;
}

/** Throw the ball along a (normalized) direction at a given speed. */
export function throwBall(ball: GrifballBall, from: Vec3, dir: Vec3, speed: number, arc = 0.35): void {
  ball.state = 'thrown';
  ball.holderId = null;
  ball.pos = { x: from.x, y: Math.max(BALL_REST_Y, from.y), z: from.z };
  ball.vel = { x: dir.x * speed, y: speed * arc, z: dir.z * speed };
  ball.looseTimer = 0;
}

/** True when the ball is grabbable (on/near the ground, not held, not mid-flight). */
export function isBallGrabbable(ball: GrifballBall): boolean {
  return ball.state === 'idle' || ball.state === 'loose';
}

/**
 * Advance free-ball physics one tick. Held balls follow their carrier (handled by
 * the caller) and are skipped here. Returns true if the ball auto-returned home.
 */
export function tickBallPhysics(
  ball: GrifballBall,
  dt: number,
  returnTimeout: number
): boolean {
  if (ball.state === 'held') return false;

  if (ball.state === 'thrown') {
    ball.vel.y -= GRAVITY * dt;
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;
    ball.pos.z += ball.vel.z * dt;

    if (ball.pos.y <= BALL_REST_Y) {
      ball.pos.y = BALL_REST_Y;
      if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * GROUND_RESTITUTION;
      ball.vel.x *= GROUND_FRICTION;
      ball.vel.z *= GROUND_FRICTION;
      const horiz = Math.hypot(ball.vel.x, ball.vel.z);
      if (ball.vel.y < SETTLE_SPEED && horiz < SETTLE_SPEED) {
        // Came to rest — becomes a loose ball anyone can grab.
        ball.state = 'loose';
        ball.vel = { x: 0, y: 0, z: 0 };
        ball.looseTimer = 0;
      }
    }
    return false;
  }

  // idle / loose: count down toward auto-return.
  ball.looseTimer += dt;
  if (ball.state === 'loose' && ball.looseTimer >= returnTimeout) {
    returnBallHome(ball);
    return true;
  }
  return false;
}

/**
 * Find the nearest alive candidate within `pickupRadius` of a grabbable ball
 * (horizontal distance). Returns the combatant id, or null.
 */
export function findBallPickup(
  ball: GrifballBall,
  candidates: BallPickupCandidate[],
  pickupRadius: number
): string | null {
  if (!isBallGrabbable(ball)) return null;
  let bestId: string | null = null;
  let bestDist = pickupRadius;
  for (const c of candidates) {
    if (!c.alive) continue;
    const d = Math.hypot(c.pos.x - ball.pos.x, c.pos.z - ball.pos.z);
    if (d <= bestDist) {
      bestDist = d;
      bestId = c.id;
    }
  }
  return bestId;
}
