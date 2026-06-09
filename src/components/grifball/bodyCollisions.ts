import * as THREE from 'three';
import { getCharacterModelCollisionProfile } from '../../characterModelTypes';
import type { CharacterModelType } from '../../types';

export interface CombatantColliderEntity {
  id: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  isCrouching: boolean;
  modelType?: CharacterModelType;
}

const ITERATIONS = 3;

export const resolveCombatantBodyCollisions = (colliders: CombatantColliderEntity[]) => {
  if (colliders.length < 2) return;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < colliders.length; i++) {
      const A = colliders[i];
      for (let j = i + 1; j < colliders.length; j++) {
        const B = colliders[j];

        const profileA = getCharacterModelCollisionProfile(A.modelType, 'v2');
        const profileB = getCharacterModelCollisionProfile(B.modelType, 'v2');
        const heightA = A.isCrouching ? profileA.crouchingHeight : profileA.standingHeight;
        const heightB = B.isCrouching ? profileB.crouchingHeight : profileB.standingHeight;

        const verticalOverlap = (A.pos.y < B.pos.y + heightB) && (B.pos.y < A.pos.y + heightA);
        if (!verticalOverlap) continue;

        let dx = B.pos.x - A.pos.x;
        let dz = B.pos.z - A.pos.z;
        const distSq = dx * dx + dz * dz;

        const minDist = profileA.radius + profileB.radius;
        const minDistSq = minDist * minDist;

        if (distSq < minDistSq) {
          let dist = Math.sqrt(distSq);
          if (dist < 0.001) {
            dx = 0.01;
            dz = 0.0;
            dist = 0.01;
          }

          const overlap = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;

          A.pos.x -= nx * overlap * 0.5;
          A.pos.z -= nz * overlap * 0.5;
          B.pos.x += nx * overlap * 0.5;
          B.pos.z += nz * overlap * 0.5;

          const rvx = B.vel.x - A.vel.x;
          const rvz = B.vel.z - A.vel.z;
          const velAlongNormal = rvx * nx + rvz * nz;

          if (velAlongNormal < 0) {
            const impulseX = nx * velAlongNormal * 0.5;
            const impulseZ = nz * velAlongNormal * 0.5;
            A.vel.x += impulseX;
            A.vel.z += impulseZ;
            B.vel.x -= impulseX;
            B.vel.z -= impulseZ;
          }
        }
      }
    }
  }
};
