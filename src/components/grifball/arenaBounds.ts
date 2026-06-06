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
    const result = resolveObstacleCollisions(pos, vel, activeCustomMap.objects);
    pos.copy(result.position);
    vel.copy(result.velocity);
    return { grounded: result.grounded };
  }

  return { grounded: false };
};
