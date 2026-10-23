import * as THREE from 'three';
import { getCharacterModelCollisionProfile } from '../characterModelTypes';
import type { CharacterModelType, CustomMapData, UniversalSettings } from '../types';
import { resolvePunchLungeDistance, resolvePunchMagnetism } from './runnerBallSettings';

/** A short jab, independent of the distance the runner may lunge. */
export const BALL_PUNCH_REACH = 1.35;
const FIST_RADIUS = 0.1;
const LUNGE_SECONDS = 0.24;
type Point = { x: number; y: number; z: number };
export interface PunchBody {
  id: string;
  pos: Point;
  modelType?: CharacterModelType;
  isCrouching?: boolean;
}
export interface PunchActor extends PunchBody { heading: Point; eyeHeight: number }
export interface PunchAttack {
  targetId: string | null;
  direction: Point;
  remaining: number;
  elapsed: number;
  duration: number;
}
type PunchSettings = Pick<UniversalSettings, 'grifballPunchLungeDistance' | 'grifballPunchMagnetism' | 'hammerMeleeSpeed'>;
export const isPunchLungeActive = (attack?: PunchAttack): boolean =>
  !!attack?.targetId && attack.remaining > 0 && attack.elapsed < attack.duration;
const vector = (p: Point) => new THREE.Vector3(p.x, p.y, p.z);
const origin = (a: PunchActor) => vector(a.pos).add(new THREE.Vector3(0, a.eyeHeight, 0));
const height = (b: PunchBody) => {
  const profile = getCharacterModelCollisionProfile(b.modelType);
  return b.isCrouching ? profile.crouchingHeight : profile.standingHeight;
};
const aimPoint = (a: PunchActor, b: PunchBody) => new THREE.Vector3(b.pos.x,
  Math.max(b.pos.y + .2, Math.min(b.pos.y + height(b) - .15, a.pos.y + a.eyeHeight)), b.pos.z);

/** Contact uses the model's collision body, never an explosion at the end of reach. */
export function punchContactDistance(a: PunchActor, b: PunchBody, reach = BALL_PUNCH_REACH): number | null {
  const radius = getCharacterModelCollisionProfile(b.modelType).radius + FIST_RADIUS;
  const start = origin(a), direction = vector(a.heading).normalize();
  if (direction.lengthSq() < 1e-8) return null;
  const x = start.x - b.pos.x, z = start.z - b.pos.z;
  const planar = direction.x ** 2 + direction.z ** 2;
  const dot = x * direction.x + z * direction.z, outside = x * x + z * z - radius * radius;
  let near = 0, far = reach;
  if (planar < 1e-8) { if (outside > 0) return null; }
  else {
    const discriminant = dot * dot - planar * outside;
    if (discriminant < 0) return null;
    near = Math.max(near, (-dot - Math.sqrt(discriminant)) / planar);
    far = Math.min(far, (-dot + Math.sqrt(discriminant)) / planar);
  }
  const bottom = b.pos.y - FIST_RADIUS, top = b.pos.y + height(b) + FIST_RADIUS;
  if (Math.abs(direction.y) < 1e-8) { if (start.y < bottom || start.y > top) return null; }
  else {
    const t0 = (bottom - start.y) / direction.y, t1 = (top - start.y) / direction.y;
    near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1));
  }
  return near <= far ? near : null;
}

/** Collidable map objects occlude both acquisition and damage, including thin walls. */
export function punchPathIsClear(from: Point, to: Point, map?: CustomMapData | null, padding = 0): boolean {
  const start = vector(from), delta = vector(to).sub(start), length = delta.length();
  if (length < 1e-8) return true;
  const ray = new THREE.Ray(start, delta.normalize());
  for (const object of map?.objects ?? []) {
    if (!object.isCollidable) continue;
    const center = vector(object.position);
    const size = vector(object.scale).multiplyScalar(.5).addScalar(padding);
    const box = new THREE.Box3(center.clone().sub(size), center.clone().add(size));
    const hit = object.type === 'sphere'
      ? ray.intersectSphere(new THREE.Sphere(center, size.x), new THREE.Vector3())
      : ray.intersectBox(box, new THREE.Vector3());
    if (box.containsPoint(start) || hit && hit.distanceTo(start) < length - 1e-6) return false;
  }
  return true;
}

export function findPunchLockTarget(a: PunchActor, targets: readonly PunchBody[], settings: PunchSettings,
  map?: CustomMapData | null): PunchBody | null {
  const reach = BALL_PUNCH_REACH + resolvePunchLungeDistance(settings);
  const magnetism = resolvePunchMagnetism(settings);
  let best: PunchBody | null = null, bestScore = Infinity;
  for (const target of targets) {
    const point = aimPoint(a, target), offset = point.clone().sub(origin(a)), distance = offset.length();
    if (distance > reach || distance < .001 || !punchPathIsClear(origin(a), point, map)) continue;
    const angle = vector(a.heading).angleTo(offset);
    const direct = punchContactDistance(a, target, reach) !== null;
    if (!direct && (magnetism === 0 || angle > .35 * magnetism)) continue;
    const score = direct ? distance : reach + angle;
    if (score < bestScore) { best = target; bestScore = score; }
  }
  return best;
}

export function beginPunch(a: PunchActor, targets: readonly PunchBody[], settings: PunchSettings,
  map?: CustomMapData | null): PunchAttack {
  const target = findPunchLockTarget(a, targets, settings, map);
  const direction = vector(a.heading).normalize();
  if (target) direction.lerp(aimPoint(a, target).sub(origin(a)).normalize(), resolvePunchMagnetism(settings)).normalize();
  return { targetId: target?.id ?? null, direction: { ...direction },
    remaining: target ? resolvePunchLungeDistance(settings) : 0, elapsed: 0,
    duration: Math.max(.02, Math.min(LUNGE_SECONDS, settings.hammerMeleeSpeed ?? LUNGE_SECONDS)) };
}

/** One committed target; losing it ends assistance without acquiring another actor. */
export function advancePunch(a: PunchActor, attack: PunchAttack, targets: readonly PunchBody[], settings: PunchSettings,
  dt: number, map?: CustomMapData | null): void {
  const target = targets.find(t => t.id === attack.targetId);
  if (!target) { attack.remaining = 0; return; }
  if (!isPunchLungeActive(attack)) return;
  const seconds = Math.min(Math.max(0, dt), attack.duration - attack.elapsed);
  attack.elapsed += seconds;
  const direction = vector(attack.direction);
  const desired = aimPoint(a, target).sub(origin(a)).normalize();
  direction.lerp(desired, (1 - Math.exp(-30 * seconds)) * resolvePunchMagnetism(settings)).normalize();
  attack.direction = { ...direction };
  const gap = Math.hypot(target.pos.x - a.pos.x, target.pos.z - a.pos.z);
  const stopAt = getCharacterModelCollisionProfile(a.modelType).radius + getCharacterModelCollisionProfile(target.modelType).radius + .05;
  const travel = Math.min(attack.remaining, resolvePunchLungeDistance(settings) / attack.duration * seconds, Math.max(0, gap - stopAt));
  const planar = new THREE.Vector3(direction.x, 0, direction.z).normalize();
  const next = vector(a.pos).addScaledVector(planar, travel);
  const centerHeight = height(a) * .5;
  if (!punchPathIsClear({ ...a.pos, y: a.pos.y + centerHeight }, { ...next, y: next.y + centerHeight }, map,
    getCharacterModelCollisionProfile(a.modelType).radius)) { attack.remaining = 0; return; }
  a.pos.x = next.x; a.pos.z = next.z;
  attack.remaining -= travel;
}

export function findPunchHitTarget(a: PunchActor, targets: readonly PunchBody[], map?: CustomMapData | null): PunchBody | null {
  let best: PunchBody | null = null, nearest = Infinity;
  for (const target of targets) {
    const distance = punchContactDistance(a, target);
    if (distance !== null && distance < nearest && punchPathIsClear(origin(a), aimPoint(a, target), map)) {
      best = target; nearest = distance;
    }
  }
  return best;
}
