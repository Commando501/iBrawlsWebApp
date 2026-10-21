import type { Vec3 } from './grifballBall';

/** Capsule endpoints at the beginning/end of the tick. All coordinates are world space. */
export interface BallContactCollider {
  ownerId: string;
  kind: 'body' | 'weapon';
  startA: Vec3;
  startB: Vec3;
  endA: Vec3;
  endB: Vec3;
  radius: number;
}

const SKIN = 0.0001;
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
});
const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function closestPoint(point: Vec3, a: Vec3, b: Vec3) {
  const axis = subtract(b, a), offset = subtract(point, a);
  const squared = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
  const along = squared > 1e-12
    ? Math.max(0, Math.min(1, (offset.x * axis.x + offset.y * axis.y + offset.z * axis.z) / squared)) : 0;
  return { point: mix(a, b, along), along };
}

export function overlapsBallCollider(pos: Vec3, radius: number, collider: BallContactCollider, time = 1): boolean {
  const closest = closestPoint(pos, mix(collider.startA, collider.endA, time), mix(collider.startB, collider.endB, time));
  return length(subtract(pos, closest.point)) <= radius + collider.radius + SKIN;
}

function sweepContact(from: Vec3, to: Vec3, radius: number, collider: BallContactCollider, startTime: number) {
  const a0 = mix(collider.startA, collider.endA, startTime);
  const b0 = mix(collider.startB, collider.endB, startTime);
  const combined = radius + collider.radius;
  // Swept broad phase: most of the roster is nowhere near this pass.
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.max(from[axis], to[axis]) + combined < Math.min(a0[axis], b0[axis], collider.endA[axis], collider.endB[axis]) ||
        Math.min(from[axis], to[axis]) - combined > Math.max(a0[axis], b0[axis], collider.endA[axis], collider.endB[axis])) return null;
  }
  const movement = subtract(to, from);
  // A Lipschitz bound on relative motion makes conservative advancement safe for
  // a fast ball AND moving/rotating weapons, without sampling through thin blades.
  const speedBound = length(movement) + Math.max(length(subtract(collider.endA, a0)), length(subtract(collider.endB, b0)));
  let time = 0;
  for (let iteration = 0; iteration < 80; iteration++) {
    const pos = mix(from, to, time);
    const closest = closestPoint(pos, mix(a0, collider.endA, time), mix(b0, collider.endB, time));
    const offset = subtract(pos, closest.point), distance = length(offset);
    const gap = distance - combined;
    if (gap <= SKIN) {
      // A centerline overlap has no unique normal. Prefer the opposite travel
      // direction, or a horizontal direction for a stationary dropped ball.
      const fallback = length(movement) > 1e-8 ? subtract(from, to) : { x: 1, y: 0, z: 0 };
      const normal = distance > 1e-8 ? offset : fallback;
      const normalLength = length(normal);
      return {
        time, along: closest.along, penetration: Math.max(0, -gap),
        normal: { x: normal.x / normalLength, y: normal.y / normalLength, z: normal.z / normalLength },
      };
    }
    if (speedBound < 1e-10) return null;
    time += gap / speedBound;
    if (time > 1) return null;
  }
  return null;
}

/** One-way ball response: contacts never damage or move combatants. */
export function moveBallWithContacts(
  body: { pos: Vec3; vel: Vec3 },
  radius: number,
  dt: number,
  colliders: readonly BallContactCollider[],
  ignoredOwner?: string,
): boolean {
  let elapsed = 0, touched = false;
  // Bound corner/contact work. On exhaustion stop at the last safe point.
  for (let contact = 0; contact < 8; contact++) {
    const remaining = (1 - elapsed) * dt;
    const end = {
      x: body.pos.x + body.vel.x * remaining,
      y: body.pos.y + body.vel.y * remaining,
      z: body.pos.z + body.vel.z * remaining,
    };
    let nearest: { collider: BallContactCollider; hit: NonNullable<ReturnType<typeof sweepContact>> } | null = null;
    for (const collider of colliders) {
      if (collider.ownerId === ignoredOwner) continue;
      const hit = sweepContact(body.pos, end, radius, collider, elapsed);
      if (hit && (!nearest || hit.time < nearest.hit.time)) nearest = { collider, hit };
    }
    if (!nearest) {
      Object.assign(body.pos, end);
      return touched;
    }
    touched = true;
    const { collider, hit } = nearest;
    Object.assign(body.pos, mix(body.pos, end, hit.time));
    const surfaceDelta = mix(subtract(collider.endA, collider.startA), subtract(collider.endB, collider.startB), hit.along);
    const surfaceVelocity = dt > 0 ? { x: surfaceDelta.x / dt, y: surfaceDelta.y / dt, z: surfaceDelta.z / dt } : { x: 0, y: 0, z: 0 };
    const relative = subtract(body.vel, surfaceVelocity), n = hit.normal;
    const incoming = relative.x * n.x + relative.y * n.y + relative.z * n.z;
    if (incoming < 0) {
      const restitution = collider.kind === 'weapon' ? 0.7 : 0.5;
      body.vel.x -= (1 + restitution) * incoming * n.x;
      body.vel.y -= (1 + restitution) * incoming * n.y;
      body.vel.z -= (1 + restitution) * incoming * n.z;
    }
    const push = hit.penetration + SKIN * 2;
    body.pos.x += n.x * push;
    body.pos.y += n.y * push;
    body.pos.z += n.z * push;
    elapsed += (1 - elapsed) * hit.time;
    if (elapsed >= 1 || dt <= 0) return touched;
  }
  return touched;
}
