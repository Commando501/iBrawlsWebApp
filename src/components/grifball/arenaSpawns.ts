import * as THREE from 'three';
import { type CustomMapData } from '../../types';

/**
 * A spawn position that optionally carries an authored facing direction (yaw,
 * radians). Callers that care about facing read `.spawnYaw`; everything else
 * treats it as a plain {@link THREE.Vector3}.
 */
export type SpawnVector = THREE.Vector3 & { spawnYaw?: number };

const toSpawnVec = (p: { x: number; y: number; z: number; yaw?: number }): SpawnVector =>
  Object.assign(new THREE.Vector3(p.x, p.y, p.z), { spawnYaw: p.yaw }) as SpawnVector;

/** Clone a spawn vector, preserving its authored yaw (Vector3.clone drops it). */
const cloneSpawn = (v: SpawnVector): SpawnVector =>
  Object.assign(v.clone(), { spawnYaw: v.spawnYaw }) as SpawnVector;

const MULTIPLAYER_SPAWN_ORDER = [2, 6, 0, 4, 1, 5, 3, 7];

export const createDefaultSpawnPoints = (radius = 13): THREE.Vector3[] =>
  Array.from({ length: 8 }).map((_, i) => {
    const angle = (i * 2 * Math.PI) / 8;
    return new THREE.Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle));
  });

export const resolveActiveSpawnPoints = (
  activeCustomMap: CustomMapData | null,
  fallbackSpawnPoints: THREE.Vector3[]
): SpawnVector[] => {
  if (activeCustomMap?.spawnPoints?.length) {
    return activeCustomMap.spawnPoints.map(toSpawnVec);
  }
  return fallbackSpawnPoints as SpawnVector[];
};

const normalizeSpawnSlot = (spawnSlot: number | null | undefined): number => {
  if (typeof spawnSlot !== 'number' || !Number.isFinite(spawnSlot)) return 0;
  return Math.max(0, Math.floor(spawnSlot));
};

const spawnIndexForSlot = (spawnSlot: number, spawnCount: number): number => {
  if (spawnCount <= 0) return 0;
  const normalizedSlot = normalizeSpawnSlot(spawnSlot);
  if (spawnCount >= MULTIPLAYER_SPAWN_ORDER.length) {
    return MULTIPLAYER_SPAWN_ORDER[normalizedSlot % MULTIPLAYER_SPAWN_ORDER.length] % spawnCount;
  }
  return normalizedSlot % spawnCount;
};

const orderSpawnsFromPreferred = (spawns: SpawnVector[], preferredIndex: number): SpawnVector[] => {
  if (spawns.length <= 1) return spawns;
  return spawns.map((_, offset) => spawns[(preferredIndex + offset) % spawns.length]);
};

const chooseSpawnPoint = (
  spawns: SpawnVector[],
  excludePositions: THREE.Vector3[],
  preferredIndex = 0
): SpawnVector => {
  if (spawns.length === 0) return new THREE.Vector3(0, 0, 0) as SpawnVector;

  const orderedSpawns = orderSpawnsFromPreferred(spawns, preferredIndex % spawns.length);
  if (excludePositions.length === 0) return cloneSpawn(orderedSpawns[0]);

  let bestPoint = orderedSpawns[0];
  let bestMinDist = -1;
  for (const point of orderedSpawns) {
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

  return cloneSpawn(bestPoint);
};

export const getMultiplayerSpawnPoint = (
  activeCustomMap: CustomMapData | null,
  fallbackSpawnPoints: THREE.Vector3[],
  spawnSlot: number | null | undefined,
  excludePositions: THREE.Vector3[] = []
): SpawnVector => {
  const activeSpawns = resolveActiveSpawnPoints(activeCustomMap, fallbackSpawnPoints);
  const preferredIndex = spawnIndexForSlot(normalizeSpawnSlot(spawnSlot), activeSpawns.length);
  return chooseSpawnPoint(activeSpawns, excludePositions, preferredIndex);
};

export const getOptimalGrifballSpawnPoint = (
  activeCustomMap: CustomMapData | null,
  fallbackSpawnPoints: THREE.Vector3[],
  excludePositions: THREE.Vector3[]
): SpawnVector => {
  const activeSpawns = resolveActiveSpawnPoints(activeCustomMap, fallbackSpawnPoints);
  return chooseSpawnPoint(activeSpawns, excludePositions);
};

/**
 * Pick a Grifball spawn for a given team: greedy max-distance selection scoped to
 * that team's spawn cluster. Falls back to the map's full spawn list (then origin)
 * when the map has no per-team spawns configured.
 */
export const getGrifballTeamSpawn = (
  activeCustomMap: CustomMapData | null,
  team: string,
  fallbackSpawnPoints: THREE.Vector3[],
  excludePositions: THREE.Vector3[],
  preferredSlot?: number | null
): SpawnVector => {
  const teamPoints = activeCustomMap?.teamSpawns?.[team];
  if (!teamPoints?.length) {
    if (preferredSlot !== undefined) {
      return getMultiplayerSpawnPoint(activeCustomMap, fallbackSpawnPoints, preferredSlot, excludePositions);
    }
    return getOptimalGrifballSpawnPoint(activeCustomMap, fallbackSpawnPoints, excludePositions);
  }

  const spawns = teamPoints.map(toSpawnVec);
  const preferredIndex = spawnIndexForSlot(normalizeSpawnSlot(preferredSlot), spawns.length);
  return chooseSpawnPoint(spawns, excludePositions, preferredIndex);
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
