/**
 * Pure Grifball ball state + physics. No THREE / DOM dependencies so it can be
 * unit-tested directly; the component owns rendering, weapon swaps and respawns.
 */

import { getRectHalfExtents, type ArenaHalfExtents } from './arenaDimensions';

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
export const GRIFBALL_BALL_GRAVITY = 18.0;
export const GRIFBALL_THROW_ARC = 0.35;
export const GRIFBALL_BALL_RADIUS = BALL_REST_Y;
const GROUND_RESTITUTION = 0.45;
const GROUND_FRICTION = 0.86;
const WALL_RESTITUTION = 0.78;
const SETTLE_SPEED = 1.2;
const TRAJECTORY_SIMULATION_STEP = 1 / 240;

export interface BallArenaBounds {
  mapShape?: 'circle' | 'rectangular';
  arenaRadius: number;
  arenaHalfExtents?: ArenaHalfExtents | null;
  arenaCeiling?: number | null;
}

export interface BallPickupCandidate {
  id: string;
  pos: Vec3;
  alive: boolean;
}

interface BallPhysicsBody {
  pos: Vec3;
  vel: Vec3;
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
export function throwBall(ball: GrifballBall, from: Vec3, dir: Vec3, speed: number, arc = GRIFBALL_THROW_ARC): void {
  ball.state = 'thrown';
  ball.holderId = null;
  ball.pos = { x: from.x, y: Math.max(BALL_REST_Y, from.y), z: from.z };
  ball.vel = { x: dir.x * speed, y: speed * arc, z: dir.z * speed };
  ball.looseTimer = 0;
}

export function predictThrowTrajectory({
  from,
  dir,
  speed,
  arc = GRIFBALL_THROW_ARC,
  samples = 24,
  arenaBounds = null,
}: {
  from: Vec3;
  dir: Vec3;
  speed: number;
  arc?: number;
  samples?: number;
  arenaBounds?: BallArenaBounds | null;
}): Vec3[] {
  const sampleCount = Math.max(2, Math.floor(samples));
  const start = { x: from.x, y: Math.max(BALL_REST_Y, from.y), z: from.z };
  const headingLength = Math.hypot(dir.x, dir.z);
  if (headingLength <= 0.0001 || speed <= 0) {
    return Array.from({ length: sampleCount }, () => ({ ...start }));
  }

  const headingX = dir.x / headingLength;
  const headingZ = dir.z / headingLength;
  const velX = headingX * speed;
  const velY = speed * arc;
  const velZ = headingZ * speed;
  const heightAboveGround = Math.max(0, start.y - BALL_REST_Y);
  const impactTime = (velY + Math.sqrt((velY * velY) + (2 * GRIFBALL_BALL_GRAVITY * heightAboveGround))) / GRIFBALL_BALL_GRAVITY;
  const body: BallPhysicsBody = {
    pos: { ...start },
    vel: { x: velX, y: velY, z: velZ },
  };
  const points: Vec3[] = [{ ...start }];
  let elapsed = 0;

  for (let index = 1; index < sampleCount; index += 1) {
    const targetTime = impactTime * (index / (sampleCount - 1));
    while (elapsed < targetTime - 0.000001) {
      const dt = Math.min(TRAJECTORY_SIMULATION_STEP, targetTime - elapsed);
      body.pos.x += body.vel.x * dt;
      body.pos.z += body.vel.z * dt;
      elapsed += dt;
      body.vel.y = velY - (GRIFBALL_BALL_GRAVITY * elapsed);
      body.pos.y = start.y + (velY * elapsed) - (0.5 * GRIFBALL_BALL_GRAVITY * elapsed * elapsed);
      if (body.pos.y < BALL_REST_Y || index === sampleCount - 1) body.pos.y = BALL_REST_Y;
      constrainBallToArenaBounds(body, arenaBounds);
    }
    points.push({ ...body.pos });
  }

  return points;
}

/** True when the ball is grabbable (on/near the ground, not held, not mid-flight). */
export function isBallGrabbable(ball: GrifballBall): boolean {
  return ball.state === 'idle' || ball.state === 'loose';
}

function reflectOutwardVelocity(ball: BallPhysicsBody, normalX: number, normalZ: number): void {
  const outwardSpeed = (ball.vel.x * normalX) + (ball.vel.z * normalZ);
  if (outwardSpeed <= 0) return;
  ball.vel.x -= normalX * outwardSpeed * (1 + WALL_RESTITUTION);
  ball.vel.z -= normalZ * outwardSpeed * (1 + WALL_RESTITUTION);
}

function constrainBallToArenaBounds(ball: BallPhysicsBody, bounds?: BallArenaBounds | null): void {
  if (!bounds || !Number.isFinite(bounds.arenaRadius) || bounds.arenaRadius <= 0) return;

  if (bounds.mapShape === 'rectangular') {
    const half = getRectHalfExtents(bounds.arenaRadius, bounds.arenaHalfExtents);
    const boundX = Math.max(0, half.x - GRIFBALL_BALL_RADIUS);
    const boundZ = Math.max(0, half.z - GRIFBALL_BALL_RADIUS);

    if (Math.abs(ball.pos.x) > boundX) {
      const sign = ball.pos.x >= 0 ? 1 : -1;
      ball.pos.x = sign * boundX;
      reflectOutwardVelocity(ball, sign, 0);
    }

    if (Math.abs(ball.pos.z) > boundZ) {
      const sign = ball.pos.z >= 0 ? 1 : -1;
      ball.pos.z = sign * boundZ;
      reflectOutwardVelocity(ball, 0, sign);
    }
  } else {
    const maxRadius = Math.max(0, bounds.arenaRadius - GRIFBALL_BALL_RADIUS);
    const distFromCenter = Math.hypot(ball.pos.x, ball.pos.z);
    if (distFromCenter > maxRadius && distFromCenter > 0) {
      const normalX = ball.pos.x / distFromCenter;
      const normalZ = ball.pos.z / distFromCenter;
      ball.pos.x = normalX * maxRadius;
      ball.pos.z = normalZ * maxRadius;
      reflectOutwardVelocity(ball, normalX, normalZ);
    }
  }

  const ceiling = bounds.arenaCeiling;
  if (ceiling && ceiling > 0 && ball.pos.y > ceiling) {
    ball.pos.y = ceiling;
    if (ball.vel.y > 0) ball.vel.y = 0;
  }
}

/**
 * Advance free-ball physics one tick. Held balls follow their carrier (handled by
 * the caller) and are skipped here. Returns true if the ball auto-returned home.
 */
export function tickBallPhysics(
  ball: GrifballBall,
  dt: number,
  returnTimeout: number,
  arenaBounds?: BallArenaBounds | null
): boolean {
  if (ball.state === 'held') return false;

  constrainBallToArenaBounds(ball, arenaBounds);

  if (ball.state === 'thrown') {
    ball.vel.y -= GRIFBALL_BALL_GRAVITY * dt;
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
    constrainBallToArenaBounds(ball, arenaBounds);
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
