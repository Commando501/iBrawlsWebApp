import * as THREE from 'three';
import { resolveObstacleCollisions } from '../../game/mapPhysics';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { type CustomMapData } from '../../types';

export interface ConstrainCombatantToArenaOptions {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  activeCustomMap: CustomMapData | null;
  arenaRadius: number;
}

export interface ConstrainCombatantToArenaResult {
  grounded: boolean;
}

export const clampVectorXZToArenaBounds = ({
  pos,
  activeCustomMap,
  arenaRadius,
  inset = 0.6,
}: {
  pos: THREE.Vector3;
  activeCustomMap: CustomMapData | null;
  arenaRadius: number;
  inset?: number;
}): void => {
  const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : arenaRadius;

  if (activeCustomMap?.mapShape === 'rectangular') {
    const half = getRectHalfExtents(radiusToUse, activeCustomMap?.arenaHalfExtents);
    const boundX = half.x - inset;
    const boundZ = half.z - inset;
    pos.x = Math.max(-boundX, Math.min(boundX, pos.x));
    pos.z = Math.max(-boundZ, Math.min(boundZ, pos.z));
    return;
  }

  const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
  const maxRadius = radiusToUse - inset;
  if (distFromCenter > maxRadius) {
    const angle = Math.atan2(pos.z, pos.x);
    pos.x = Math.cos(angle) * maxRadius;
    pos.z = Math.sin(angle) * maxRadius;
  }
};

export const isVectorXZAtArenaBoundary = ({
  pos,
  activeCustomMap,
  arenaRadius,
  inset = 0.6,
}: {
  pos: THREE.Vector3;
  activeCustomMap: CustomMapData | null;
  arenaRadius: number;
  inset?: number;
}): boolean => {
  const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : arenaRadius;

  if (activeCustomMap?.mapShape === 'rectangular') {
    const half = getRectHalfExtents(radiusToUse, activeCustomMap?.arenaHalfExtents);
    const boundX = half.x - inset;
    const boundZ = half.z - inset;
    return Math.abs(pos.x) >= boundX || Math.abs(pos.z) >= boundZ;
  }

  const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
  return distFromCenter >= radiusToUse - inset;
};

export const constrainCombatantToArenaBounds = ({
  pos,
  vel,
  activeCustomMap,
  arenaRadius,
}: ConstrainCombatantToArenaOptions): ConstrainCombatantToArenaResult => {
  const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : arenaRadius;

  if (activeCustomMap?.mapShape === 'rectangular') {
    const half = getRectHalfExtents(radiusToUse, activeCustomMap?.arenaHalfExtents);
    const boundX = half.x - 0.6;
    const boundZ = half.z - 0.6;

    if (Math.abs(pos.x) > boundX) {
      const sign = Math.sign(pos.x);
      pos.x = sign * boundX;
      if (vel && vel.x * sign > 0) {
        vel.x = 0;
      }
    }

    if (Math.abs(pos.z) > boundZ) {
      const sign = Math.sign(pos.z);
      pos.z = sign * boundZ;
      if (vel && vel.z * sign > 0) {
        vel.z = 0;
      }
    }
  } else {
    const maxRadius = Math.max(0, radiusToUse - 0.6);
    const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);

    if (distFromCenter > maxRadius && distFromCenter > 0) {
      const normalX = pos.x / distFromCenter;
      const normalZ = pos.z / distFromCenter;
      pos.x = normalX * maxRadius;
      pos.z = normalZ * maxRadius;

      if (vel) {
        const outwardSpeed = vel.x * normalX + vel.z * normalZ;
        if (outwardSpeed > 0) {
          vel.x -= normalX * outwardSpeed;
          vel.z -= normalZ * outwardSpeed;
        }
      }
    }
  }

  if (pos.y < 0) {
    pos.y = 0;
    if (vel && vel.y < 0) {
      vel.y = 0;
    }
  }

  // Optional authored ceiling: clamp vertical travel when the map defines one.
  const ceiling = activeCustomMap?.arenaCeiling;
  if (ceiling && ceiling > 0 && pos.y > ceiling) {
    pos.y = ceiling;
    if (vel && vel.y > 0) {
      vel.y = 0;
    }
  }

  if (activeCustomMap?.objects?.length && vel) {
    const originX = pos.x, originZ = pos.z;
    const result = resolveObstacleCollisions(pos, vel, activeCustomMap.objects);
    pos.copy(result.position);
    vel.copy(result.velocity);
    resolveArenaObstacleConflict(pos, vel, activeCustomMap, arenaRadius, originX, originZ);
    return { grounded: result.grounded };
  }

  return { grounded: false };
};


type ContactPoint = { x: number; z: number };
type ContactEdge = { a: ContactPoint; b: ContactPoint } | { center: ContactPoint; radius: number };

/** Resolve the uncommon case where obstacle separation crosses the arena wall.
 * Boundary intersections supply feasible exits even when clamping the separated
 * position would put the body back into the obstacle. Normal movement continues
 * through the existing collision resolver without building these candidates. */
function resolveArenaObstacleConflict(
  pos: THREE.Vector3, vel: THREE.Vector3, map: CustomMapData,
  arenaRadius: number, originX: number, originZ: number,
): void {
  const epsilon = 1e-9, bodyRadius = .55;
  const half = map.mapShape === 'rectangular' ? getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents) : null;
  const boundX = half ? Math.max(0, half.x - .6) : 0;
  const boundZ = half ? Math.max(0, half.z - .6) : 0;
  const radius = Math.max(0, (map.arenaRadius ?? arenaRadius) - .6);
  const inside = (p: ContactPoint) => half
    ? Math.abs(p.x) <= boundX + epsilon && Math.abs(p.z) <= boundZ + epsilon
    : Math.hypot(p.x, p.z) <= radius + epsilon;
  if (inside(pos)) return;

  const edges: ContactEdge[] = [], blockers: ((p: ContactPoint) => boolean)[] = [];
  const segment = (ax: number, az: number, bx: number, bz: number) => edges.push({ a: { x: ax, z: az }, b: { x: bx, z: bz } });
  const circle = (x: number, z: number, r: number) => edges.push({ center: { x, z }, radius: r });
  if (half) {
    segment(-boundX, -boundZ, boundX, -boundZ); segment(boundX, -boundZ, boundX, boundZ);
    segment(boundX, boundZ, -boundX, boundZ); segment(-boundX, boundZ, -boundX, -boundZ);
  } else circle(0, 0, radius);
  for (const object of map.objects) {
    if (!object.isCollidable) continue;
    const x = object.position.x, z = object.position.z;
    if (object.type === 'sphere') {
      const dy = Math.max(pos.y - object.position.y, object.position.y - pos.y - 2, 0);
      const r3 = object.scale.x / 2 + bodyRadius;
      if (dy >= r3) continue;
      const r = Math.sqrt(r3 * r3 - dy * dy);
      circle(x, z, r);
      blockers.push(p => Math.hypot(p.x - x, p.z - z) < r - epsilon);
      continue;
    }
    const bottom = object.position.y - object.scale.y / 2, top = object.position.y + object.scale.y / 2;
    if (pos.y > top - .05 || pos.y + 2 < bottom + .05) continue;
    if (object.type === 'cylinder') {
      const r = object.scale.x / 2 + bodyRadius;
      circle(x, z, r); blockers.push(p => Math.hypot(p.x - x, p.z - z) < r - epsilon);
    } else if (object.type === 'box') {
      const left = x - object.scale.x / 2, right = x + object.scale.x / 2;
      const near = z - object.scale.z / 2, far = z + object.scale.z / 2;
      segment(left - bodyRadius, near, left - bodyRadius, far);
      segment(right + bodyRadius, near, right + bodyRadius, far);
      segment(left, near - bodyRadius, right, near - bodyRadius);
      segment(left, far + bodyRadius, right, far + bodyRadius);
      for (const cx of [left, right]) for (const cz of [near, far]) circle(cx, cz, bodyRadius);
      blockers.push(p => Math.hypot(Math.max(left - p.x, p.x - right, 0), Math.max(near - p.z, p.z - far, 0)) < bodyRadius - epsilon);
    }
  }
  let best: ContactPoint | null = null, bestDistance = Infinity;
  const consider = (p: ContactPoint) => {
    const distance = (p.x - originX) ** 2 + (p.z - originZ) ** 2;
    if (!Number.isFinite(distance) || distance >= bestDistance || !inside(p) || blockers.some(blocked => blocked(p))) return;
    best = p; bestDistance = distance;
  };
  consider({ x: originX, z: originZ });
  for (const edge of edges) {
    if ('center' in edge) {
      const dx = originX - edge.center.x, dz = originZ - edge.center.z, length = Math.hypot(dx, dz);
      if (length > epsilon) consider({ x: edge.center.x + dx * edge.radius / length, z: edge.center.z + dz * edge.radius / length });
      else for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) consider({ x: edge.center.x + nx * edge.radius, z: edge.center.z + nz * edge.radius });
    } else {
      consider(edge.a); consider(edge.b);
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z, lengthSq = dx * dx + dz * dz;
      const t = lengthSq ? Math.max(0, Math.min(1, ((originX - edge.a.x) * dx + (originZ - edge.a.z) * dz) / lengthSq)) : 0;
      consider({ x: edge.a.x + t * dx, z: edge.a.z + t * dz });
    }
  }
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j];
    if ('center' in a && 'center' in b) {
      const dx = b.center.x - a.center.x, dz = b.center.z - a.center.z, d = Math.hypot(dx, dz);
      if (d <= epsilon || d > a.radius + b.radius + epsilon || d < Math.abs(a.radius - b.radius) - epsilon) continue;
      const along = (a.radius ** 2 - b.radius ** 2 + d * d) / (2 * d);
      const height = Math.sqrt(Math.max(0, a.radius ** 2 - along * along));
      for (const sign of [-1, 1]) consider({ x: a.center.x + dx * along / d - sign * dz * height / d,
        z: a.center.z + dz * along / d + sign * dx * height / d });
    } else if (!('center' in a) && !('center' in b)) {
      const ax = a.b.x - a.a.x, az = a.b.z - a.a.z, bx = b.b.x - b.a.x, bz = b.b.z - b.a.z;
      const determinant = ax * bz - az * bx;
      if (Math.abs(determinant) <= epsilon) continue;
      const dx = b.a.x - a.a.x, dz = b.a.z - a.a.z;
      const t = (dx * bz - dz * bx) / determinant, u = (dx * az - dz * ax) / determinant;
      if (t >= -epsilon && t <= 1 + epsilon && u >= -epsilon && u <= 1 + epsilon) consider({ x: a.a.x + t * ax, z: a.a.z + t * az });
    } else {
      const round = ('center' in a ? a : b) as { center: ContactPoint; radius: number };
      const line = ('center' in a ? b : a) as { a: ContactPoint; b: ContactPoint };
      const dx = line.b.x - line.a.x, dz = line.b.z - line.a.z;
      const ox = line.a.x - round.center.x, oz = line.a.z - round.center.z;
      const aa = dx * dx + dz * dz, bb = 2 * (ox * dx + oz * dz), cc = ox * ox + oz * oz - round.radius ** 2;
      const discriminant = bb * bb - 4 * aa * cc;
      if (aa === 0 || discriminant < -epsilon) continue;
      for (const sign of [-1, 1]) {
        const t = (-bb + sign * Math.sqrt(Math.max(0, discriminant))) / (2 * aa);
        if (t >= -epsilon && t <= 1 + epsilon) consider({ x: line.a.x + t * dx, z: line.a.z + t * dz });
      }
    }
  }
  if (best) {
    // Selection tests every obstacle, including other objects at this contact.
    pos.x = (best as ContactPoint).x; pos.z = (best as ContactPoint).z;
  } else {
    // An authored arena can contain no feasible body location. Preserve the hard
    // arena bound in that invalid geometry rather than ejecting the combatant.
    clampVectorXZToArenaBounds({ pos, activeCustomMap: map, arenaRadius });
  }
  // A blocked corner consumes planar momentum; the next movement decision can
  // choose a free direction instead of reintroducing the same penetration.
  vel.x = vel.z = 0;
}
