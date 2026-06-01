import * as THREE from 'three';
import { type CustomMapData } from '../../types';

export const createDefaultSpawnPoints = (radius = 13): THREE.Vector3[] =>
  Array.from({ length: 8 }).map((_, i) => {
    const angle = (i * 2 * Math.PI) / 8;
    return new THREE.Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle));
  });

export const resolveActiveSpawnPoints = (
  activeCustomMap: CustomMapData | null,
  fallbackSpawnPoints: THREE.Vector3[]
): THREE.Vector3[] => {
  if (activeCustomMap?.spawnPoints?.length) {
    return activeCustomMap.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
  }
  return fallbackSpawnPoints;
};

export const getOptimalGrifballSpawnPoint = (
  activeCustomMap: CustomMapData | null,
  fallbackSpawnPoints: THREE.Vector3[],
  excludePositions: THREE.Vector3[]
): THREE.Vector3 => {
  const activeSpawns = resolveActiveSpawnPoints(activeCustomMap, fallbackSpawnPoints);

  if (activeSpawns.length === 0) {
    return new THREE.Vector3(0, 0, 0);
  }

  if (excludePositions.length === 0) {
    return activeSpawns[0].clone();
  }

  let bestPoint = activeSpawns[0];
  let bestMinDist = -1;
  for (const point of activeSpawns) {
    let minDist = Infinity;
    for (const entityPos of excludePositions) {
      const d = point.distanceTo(entityPos);
      if (d < minDist) minDist = d;
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestPoint = point;
    }
  }

  return bestPoint.clone();
};

export const resizeArenaSceneForPlayerCount = (
  scene: THREE.Scene,
  spawnPoints: THREE.Vector3[],
  playerCount: number
): { scale: number; arenaRadius: number } => {
  const scale = 1.0 + Math.min(0.50, Math.floor((playerCount - 1) / 2) * 0.125);
  const arenaRadius = 20 * scale;

  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry) {
      const params = (child.geometry as any).parameters;
      if (params && params.radialSegments === 64 && params.height === 0.2) {
        child.scale.set(scale, 1, scale);
      }
    }
  });

  scene.traverse((child) => {
    if (child instanceof THREE.Group && child.children.length === 2 && child.parent === scene && child.userData.angle !== undefined) {
      const pos = child.position;
      const angle = Math.atan2(pos.z, pos.x);
      const targetRadius = 20.3 * scale;
      child.position.set(Math.cos(angle) * targetRadius, 2, Math.sin(angle) * targetRadius);
    }
  });

  scene.traverse((child) => {
    if (child instanceof THREE.Group && child.name === 'hangarWallGroup') {
      child.scale.set(scale, 1, scale);
    }
  });

  const spawnRadius = 13.0 * scale;
  spawnPoints.forEach((p, i) => {
    const angle = (i * 2 * Math.PI) / 8;
    p.set(spawnRadius * Math.cos(angle), 0, spawnRadius * Math.sin(angle));
  });

  return { scale, arenaRadius };
};
