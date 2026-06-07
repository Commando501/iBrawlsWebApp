import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import { type AITacticalTargetSnapshot } from '../../game/aiCombatDecision';
import { type CustomMapObject } from '../../types';

export const getInwardSpawnYaw = (spawnPos: THREE.Vector3): number => {
  return getYawForHeading(-spawnPos.x, -spawnPos.z);
};

export type TacticalTargetCandidate = AITacticalTargetSnapshot & {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
};

export const GRAVITY_ACCELERATION = 18.0;
const BODY_CENTER_HEIGHT = 0.825;
const CROUCH_BODY_CENTER_HEIGHT = 0.52;
export const AI_HAMMER_JUMP_COOLDOWN = 2.25;
export const AI_HAMMER_JUMP_START_MAX_HEIGHT = 0.08;
export const AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON = 0.1;

// Stationary-swing geometry, shared by the hit resolver and AI commit gates.
export const HAMMER_STRIKE_FORWARD_FACTOR = 0.875;
export const SWORD_SLASH_FORWARD_FACTOR = 0.3;
export const SWORD_SLASH_RADIUS = 2.0;

// Standing eye height used as the origin of every stationary melee reach test.
export const MELEE_EYE_HEIGHT = 1.65;

// Stationary melee reach shared by the player and every AI combatant.
export const MELEE_SWORD_SLASH_REACH = 2.8;
export const MELEE_HAMMER_SWIPE_REACH = 3.0;

export type SwordLungeCurrentTrailStyle = 'localCube' | 'enemyCube' | 'shockwave';

export const getCombatBodyCenter = (pos: THREE.Vector3, isCrouching = false): THREE.Vector3 => {
  return new THREE.Vector3(
    pos.x,
    pos.y + (isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT),
    pos.z
  );
};

export const predictCombatantPosition = (
  pos: THREE.Vector3,
  vel?: THREE.Vector3,
  leadTime = 0
): THREE.Vector3 => {
  const predicted = pos.clone();
  if (vel && leadTime > 0) {
    predicted.x += vel.x * leadTime;
    predicted.z += vel.z * leadTime;
    predicted.y += vel.y * leadTime - 0.5 * GRAVITY_ACCELERATION * leadTime * leadTime;
  }
  predicted.y = Math.max(0, predicted.y);
  return predicted;
};

export const predictLandingPosition = (
  pos: THREE.Vector3,
  vel?: THREE.Vector3,
  maxLeadTime = 1.25
): THREE.Vector3 => {
  if (!vel || (pos.y <= 0.01 && Math.abs(vel.y) < 0.01)) {
    return pos.clone();
  }

  const fallTime =
    (vel.y + Math.sqrt(Math.max(0, vel.y * vel.y + 2 * GRAVITY_ACCELERATION * Math.max(0, pos.y)))) /
    GRAVITY_ACCELERATION;
  const leadTime = Math.max(0, Math.min(maxLeadTime, fallTime));
  const landing = pos.clone().addScaledVector(vel, leadTime);
  landing.y = 0;
  return landing;
};

export const getCollisionResolvedCameraPos = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  arenaRadius: number,
  objects: CustomMapObject[]
): THREE.Vector3 => {
  let t = 1.0;
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  if (length < 0.001) return end.clone();

  const minY = 0.2;
  if (start.y > minY && end.y < minY) {
    const t_floor = (minY - start.y) / (end.y - start.y);
    if (t_floor >= 0 && t_floor < t) {
      t = t_floor;
    }
  }

  const maxCamRadius = Math.max(0.5, arenaRadius - 0.3);
  const startDistSq = start.x * start.x + start.z * start.z;
  const endDistSq = end.x * end.x + end.z * end.z;

  if (startDistSq < maxCamRadius * maxCamRadius && endDistSq > maxCamRadius * maxCamRadius) {
    const a = dir.x * dir.x + dir.z * dir.z;
    const b = 2 * (start.x * dir.x + start.z * dir.z);
    const c = start.x * start.x + start.z * start.z - maxCamRadius * maxCamRadius;
    if (a > 0.000001) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const u = (-b + Math.sqrt(disc)) / (2 * a);
        if (u >= 0 && u < t) {
          t = u;
        }
      }
    }
  }

  const clearance = 0.3;
  for (const obj of objects) {
    if (!obj.isCollidable) continue;

    const scaleX = obj.scale.x;
    const scaleY = obj.scale.y;
    const scaleZ = obj.scale.z;
    const posX = obj.position.x;
    const posY = obj.position.y;
    const posZ = obj.position.z;

    if (obj.type === 'box') {
      const bMinX = posX - scaleX / 2 - clearance;
      const bMaxX = posX + scaleX / 2 + clearance;
      const bMinY = posY - scaleY / 2 - clearance;
      const bMaxY = posY + scaleY / 2 + clearance;
      const bMinZ = posZ - scaleZ / 2 - clearance;
      const bMaxZ = posZ + scaleZ / 2 + clearance;

      let tNear = -Infinity;
      let tFar = Infinity;

      if (Math.abs(dir.x) < 0.000001) {
        if (start.x < bMinX || start.x > bMaxX) continue;
      } else {
        const t1 = (bMinX - start.x) / dir.x;
        const t2 = (bMaxX - start.x) / dir.x;
        tNear = Math.max(tNear, Math.min(t1, t2));
        tFar = Math.min(tFar, Math.max(t1, t2));
      }

      if (Math.abs(dir.y) < 0.000001) {
        if (start.y < bMinY || start.y > bMaxY) continue;
      } else {
        const t1 = (bMinY - start.y) / dir.y;
        const t2 = (bMaxY - start.y) / dir.y;
        tNear = Math.max(tNear, Math.min(t1, t2));
        tFar = Math.min(tFar, Math.max(t1, t2));
      }

      if (Math.abs(dir.z) < 0.000001) {
        if (start.z < bMinZ || start.z > bMaxZ) continue;
      } else {
        const t1 = (bMinZ - start.z) / dir.z;
        const t2 = (bMaxZ - start.z) / dir.z;
        tNear = Math.max(tNear, Math.min(t1, t2));
        tFar = Math.min(tFar, Math.max(t1, t2));
      }

      if (tFar >= tNear && tNear > 0 && tNear < t) {
        t = tNear;
      }
    } else if (obj.type === 'cylinder') {
      const radius = scaleX / 2 + clearance;
      const cMinY = posY - scaleY / 2 - clearance;
      const cMaxY = posY + scaleY / 2 + clearance;

      const dx = start.x - posX;
      const dz = start.z - posZ;
      const a = dir.x * dir.x + dir.z * dir.z;
      const b = 2 * (dx * dir.x + dz * dir.z);
      const c = dx * dx + dz * dz - radius * radius;

      if (a > 0.000001) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const u1 = (-b - Math.sqrt(disc)) / (2 * a);
          if (u1 >= 0 && u1 < t) {
            const intersectY = start.y + u1 * dir.y;
            if (intersectY >= cMinY && intersectY <= cMaxY) {
              t = u1;
            }
          }
        }
      }

      if (Math.abs(dir.y) > 0.000001) {
        const uTop = (cMaxY - start.y) / dir.y;
        if (uTop >= 0 && uTop < t) {
          const ix = start.x + uTop * dir.x;
          const iz = start.z + uTop * dir.z;
          const distSq = (ix - posX) * (ix - posX) + (iz - posZ) * (iz - posZ);
          if (distSq <= radius * radius) t = uTop;
        }

        const uBot = (cMinY - start.y) / dir.y;
        if (uBot >= 0 && uBot < t) {
          const ix = start.x + uBot * dir.x;
          const iz = start.z + uBot * dir.z;
          const distSq = (ix - posX) * (ix - posX) + (iz - posZ) * (iz - posZ);
          if (distSq <= radius * radius) t = uBot;
        }
      }
    } else if (obj.type === 'sphere') {
      const radius = scaleX / 2 + clearance;
      const dx = start.x - posX;
      const dy = start.y - posY;
      const dz = start.z - posZ;

      const a = dir.dot(dir);
      const b = 2 * (dx * dir.x + dy * dir.y + dz * dir.z);
      const c = dx * dx + dy * dy + dz * dz - radius * radius;

      if (a > 0.000001) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const u1 = (-b - Math.sqrt(disc)) / (2 * a);
          if (u1 >= 0 && u1 < t) {
            t = u1;
          }
        }
      }
    }
  }

  const minAllowedT = length > 0.001 ? Math.min(1.0, 0.65 / length) : 1.0;
  const finalT = Math.max(minAllowedT, t);

  return start.clone().addScaledVector(dir, finalT);
};
