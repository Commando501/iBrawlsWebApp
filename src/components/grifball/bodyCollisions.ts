import * as THREE from 'three';

export interface CombatantColliderEntity {
  id: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  isCrouching: boolean;
}

const COLLISION_RADIUS = 0.55;
const MIN_DIST = COLLISION_RADIUS * 2;
const MIN_DIST_SQ = MIN_DIST * MIN_DIST;
const ITERATIONS = 3;

export const resolveCombatantBodyCollisions = (colliders: CombatantColliderEntity[]) => {
  if (colliders.length < 2) return;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < colliders.length; i++) {
      const A = colliders[i];
      for (let j = i + 1; j < colliders.length; j++) {
        const B = colliders[j];

        const heightA = A.isCrouching ? 1.2 : 1.8;
        const heightB = B.isCrouching ? 1.2 : 1.8;

        const verticalOverlap = (A.pos.y < B.pos.y + heightB) && (B.pos.y < A.pos.y + heightA);
        if (!verticalOverlap) continue;

        let dx = B.pos.x - A.pos.x;
        let dz = B.pos.z - A.pos.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < MIN_DIST_SQ) {
          let dist = Math.sqrt(distSq);
          if (dist < 0.001) {
            dx = 0.01;
            dz = 0.0;
            dist = 0.01;
          }

          const overlap = MIN_DIST - dist;
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
