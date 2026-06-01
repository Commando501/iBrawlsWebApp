import * as THREE from 'three';
import { resolveObstacleCollisions } from '../../game/mapPhysics';
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

export const constrainCombatantToArenaBounds = ({
  pos,
  vel,
  activeCustomMap,
  arenaRadius,
}: ConstrainCombatantToArenaOptions): ConstrainCombatantToArenaResult => {
  const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : arenaRadius;

  if (activeCustomMap?.mapShape === 'rectangular') {
    const boundX = radiusToUse * 1.2 - 0.6;
    const boundZ = radiusToUse * 0.6 - 0.6;

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

  if (activeCustomMap?.objects?.length && vel) {
    const result = resolveObstacleCollisions(pos, vel, activeCustomMap.objects);
    pos.copy(result.position);
    vel.copy(result.velocity);
    return { grounded: result.grounded };
  }

  return { grounded: false };
};
