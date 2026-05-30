/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CustomMapObject } from '../types';

export interface CollisionResult {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  onObject: boolean;
}

/**
 * Resolves 3D collisions between a combatant (cylinder: radius 0.55m, height 2.0m)
 * and all collidable custom map obstacles. Supports smooth horizontal wall sliding 
 * and landing/standing on top of obstacles (platforming).
 *
 * @param pos Current spartan position (feet coordinate)
 * @param vel Current spartan velocity
 * @param obstacles List of custom map objects
 * @param spartanRadius Collision radius of spartan (default 0.55)
 * @param spartanHeight Height of spartan (default 2.0)
 */
export function resolveObstacleCollisions(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  obstacles: CustomMapObject[],
  spartanRadius: number = 0.55,
  spartanHeight: number = 2.0
): CollisionResult {
  const nextPos = pos.clone();
  const nextVel = vel.clone();
  let isGrounded = false;
  let isOnObject = false;

  // Prioritize standing/falling checks on top of obstacles.
  // We check if the spartan's feet are just above the top of any obstacle.
  for (const obj of obstacles) {
    if (!obj.isCollidable) continue;

    // Calculate dimensions
    const scaleX = obj.scale.x;
    const scaleY = obj.scale.y;
    const scaleZ = obj.scale.z;

    const posY = obj.position.y;
    const posX = obj.position.x;
    const posZ = obj.position.z;

    if (obj.type === 'box') {
      const bMinY = posY - scaleY / 2;
      const bMaxY = posY + scaleY / 2;
      const bMinX = posX - scaleX / 2;
      const bMaxX = posX + scaleX / 2;
      const bMinZ = posZ - scaleZ / 2;
      const bMaxZ = posZ + scaleZ / 2;

      // Vertical proximity check: Feet are falling or standing, and near the top face of the box
      const verticalSnapWindow = 0.25; // snap range
      const feetY = nextPos.y;

      if (
        nextVel.y <= 0.05 &&
        feetY >= bMaxY - verticalSnapWindow &&
        feetY <= bMaxY + 0.1
      ) {
        // Horizontal overlap check: Is the spartan cylinder intersecting the box XZ footprint?
        const clX = Math.max(bMinX, Math.min(bMaxX, nextPos.x));
        const clZ = Math.max(bMinZ, Math.min(bMaxZ, nextPos.z));
        const distXZSq = (nextPos.x - clX) ** 2 + (nextPos.z - clZ) ** 2;

        if (distXZSq < spartanRadius * spartanRadius) {
          nextPos.y = bMaxY;
          if (nextVel.y < 0) nextVel.y = 0;
          isGrounded = true;
          isOnObject = true;
        }
      }
    } else if (obj.type === 'cylinder') {
      const radius = scaleX / 2; // scale.x represents diameter
      const height = scaleY;
      const cMinY = posY - height / 2;
      const cMaxY = posY + height / 2;

      const feetY = nextPos.y;
      const verticalSnapWindow = 0.25;

      if (
        nextVel.y <= 0.05 &&
        feetY >= cMaxY - verticalSnapWindow &&
        feetY <= cMaxY + 0.1
      ) {
        // Horizontal overlap check (circle to cylinder)
        const distXZSq = (nextPos.x - posX) ** 2 + (nextPos.z - posZ) ** 2;
        if (distXZSq < (spartanRadius + radius) ** 2) {
          nextPos.y = cMaxY;
          if (nextVel.y < 0) nextVel.y = 0;
          isGrounded = true;
          isOnObject = true;
        }
      }
    }
  }

  // Resolve horizontal XZ collisions (blocking movement, sliding along walls/pillars)
  for (const obj of obstacles) {
    if (!obj.isCollidable) continue;

    const scaleX = obj.scale.x;
    const scaleY = obj.scale.y;
    const scaleZ = obj.scale.z;

    const posY = obj.position.y;
    const posX = obj.position.x;
    const posZ = obj.position.z;

    if (obj.type === 'box') {
      const bMinY = posY - scaleY / 2;
      const bMaxY = posY + scaleY / 2;
      const bMinX = posX - scaleX / 2;
      const bMaxX = posX + scaleX / 2;
      const bMinZ = posZ - scaleZ / 2;
      const bMaxZ = posZ + scaleZ / 2;

      // Vertical overlap check: Does Spartan cylinder overlap the box vertically?
      const overlapY = (nextPos.y + spartanHeight >= bMinY + 0.05) && (nextPos.y <= bMaxY - 0.05);
      if (!overlapY) continue;

      // XZ Projection
      const clX = Math.max(bMinX, Math.min(bMaxX, nextPos.x));
      const clZ = Math.max(bMinZ, Math.min(bMaxZ, nextPos.z));

      const dx = nextPos.x - clX;
      const dz = nextPos.z - clZ;
      const distSq = dx * dx + dz * dz;
      const dist = Math.sqrt(distSq);

      if (dist < spartanRadius) {
        let normalX = 0;
        let normalZ = 0;
        let penetration = 0;

        if (dist > 0.001) {
          normalX = dx / dist;
          normalZ = dz / dist;
          penetration = spartanRadius - dist;
        } else {
          // Center is directly inside: push out to closest side
          const leftDist = nextPos.x - bMinX + spartanRadius;
          const rightDist = bMaxX - nextPos.x + spartanRadius;
          const frontDist = nextPos.z - bMinZ + spartanRadius;
          const backDist = bMaxZ - nextPos.z + spartanRadius;

          const minDist = Math.min(leftDist, rightDist, frontDist, backDist);
          penetration = minDist;

          if (minDist === leftDist) {
            normalX = -1;
          } else if (minDist === rightDist) {
            normalX = 1;
          } else if (minDist === frontDist) {
            normalZ = -1;
          } else {
            normalZ = 1;
          }
        }

        // Apply push correction
        nextPos.x += normalX * penetration;
        nextPos.z += normalZ * penetration;

        // Apply sliding velocity deflection
        const dot = nextVel.x * normalX + nextVel.z * normalZ;
        if (dot < 0) {
          nextVel.x -= normalX * dot;
          nextVel.z -= normalZ * dot;
        }
      }
    } else if (obj.type === 'cylinder') {
      const radius = scaleX / 2;
      const height = scaleY;
      const cMinY = posY - height / 2;
      const cMaxY = posY + height / 2;

      // Vertical overlap check
      const overlapY = (nextPos.y + spartanHeight >= cMinY + 0.05) && (nextPos.y <= cMaxY - 0.05);
      if (!overlapY) continue;

      const dx = nextPos.x - posX;
      const dz = nextPos.z - posZ;
      const distXZ = Math.sqrt(dx * dx + dz * dz);
      const minDist = spartanRadius + radius;

      if (distXZ < minDist) {
        let normalX = 0;
        let normalZ = 0;
        let penetration = 0;

        if (distXZ > 0.001) {
          normalX = dx / distXZ;
          normalZ = dz / distXZ;
          penetration = minDist - distXZ;
        } else {
          // Exactly centered: push forward along X
          normalX = 1;
          penetration = minDist;
        }

        // Correct position
        nextPos.x += normalX * penetration;
        nextPos.z += normalZ * penetration;

        // Slide velocity
        const dot = nextVel.x * normalX + nextVel.z * normalZ;
        if (dot < 0) {
          nextVel.x -= normalX * dot;
          nextVel.z -= normalZ * dot;
        }
      }
    } else if (obj.type === 'sphere') {
      const radius = scaleX / 2;
      const center = new THREE.Vector3(posX, posY, posZ);

      // Closest point on spartan vertical line segment
      const closestY = Math.max(nextPos.y, Math.min(nextPos.y + spartanHeight, center.y));
      const spartanSegmentPoint = new THREE.Vector3(nextPos.x, closestY, nextPos.z);

      const dVec = spartanSegmentPoint.clone().sub(center);
      const dist = dVec.length();
      const minDist = spartanRadius + radius;

      if (dist < minDist) {
        const normal = dVec.clone().normalize();
        const penetration = minDist - dist;

        // Push spartan vertically and horizontally
        nextPos.addScaledVector(normal, penetration);

        // Slide velocity
        const dot = nextVel.dot(normal);
        if (dot < 0) {
          nextVel.addScaledVector(normal, -dot);
        }

        // If normal points strongly upward, spartan can stand on the sphere
        if (normal.y > 0.6) {
          isGrounded = true;
          isOnObject = true;
        }
      }
    }
  }

  return {
    position: nextPos,
    velocity: nextVel,
    grounded: isGrounded,
    onObject: isOnObject,
  };
}
