import { type CustomMapData, type CustomMapObject, type TeamId } from '../types';
import { getGoalPlates } from './grifballGoals';
import { getRectHalfExtents } from './arenaDimensions';

/**
 * Grifball court half-extents (≈104m long × 46m wide), measured at walk speed:
 * 18s goal-to-goal on the long (X) axis, 8s wall-to-wall on the short (Z) axis.
 */
export const GRIFBALL_HALF_X = 52;
export const GRIFBALL_HALF_Z = 23;

/** X position of each goal plate (just inside the end wall). */
const PLATE_X = GRIFBALL_HALF_X - 5;
/** X position of each team's spawn cluster (in front of their own plate). */
const SPAWN_X = GRIFBALL_HALF_X - 9;
const SPAWN_ZS = [-9, -3, 3, 9];
/** Collidable obstacles at |x| beyond this are stripped to keep goal approaches open. */
const GOAL_ZONE_CLEAR_X = GRIFBALL_HALF_X - 14;

const cache = new Map<string, CustomMapData>();

function makeGoalPlate(team: TeamId, x: number): CustomMapObject {
  return {
    id: `grifball_goal_${team}`,
    name: `${team === 'blue' ? 'Blue' : 'Red'} Goal Plate`,
    type: 'box',
    position: { x, y: 0.06, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 7, y: 0.12, z: 26 },
    color: team === 'red' ? '#ff3b3b' : '#3b82ff',
    metalness: 0.2,
    roughness: 0.4,
    opacity: 0.82,
    transparent: true,
    emissive: team === 'red' ? '#ff3b3b' : '#3b82ff',
    emissiveIntensity: 0.9,
    isCollidable: false,
    texture: team === 'red' ? 'goal_plate_red' : 'goal_plate_blue',
    goalPlateTeam: team,
  };
}

function teamSpawnCluster(x: number): { x: number; y: number; z: number }[] {
  return SPAWN_ZS.map((z) => ({ x, y: 0, z }));
}

/**
 * Reshape a rectangular sandbox map into a Grifball court: stretch its themed
 * decor to the larger long lane, then add goal plates and team spawn clusters.
 *
 * Idempotent and memoized by map id. Non-rectangular maps and maps already
 * carrying goal plates (authored Grifball maps) pass through unchanged.
 */
export function toGrifballArena(base: CustomMapData): CustomMapData {
  if (base.mapShape !== 'rectangular') return base;
  if (getGoalPlates(base).length > 0) return base;

  const cached = cache.get(base.id);
  if (cached) return cached;

  const oldHalf = getRectHalfExtents(base.arenaRadius, base.arenaHalfExtents);
  const fX = GRIFBALL_HALF_X / oldHalf.x;
  const fZ = GRIFBALL_HALF_Z / oldHalf.z;

  const stretchedObjects: CustomMapObject[] = base.objects
    .map((obj) => ({
      ...obj,
      position: { x: obj.position.x * fX, y: obj.position.y, z: obj.position.z * fZ },
      scale: { x: obj.scale.x * fX, y: obj.scale.y, z: obj.scale.z * fZ },
    }))
    // Keep the goal end-zones clear of collidable obstacles so a carrier can reach
    // the plate. The hard arena wall (±GRIFBALL_HALF_X) still contains everyone, so
    // dropping the stretched end-barriers here does not let combatants leave the court.
    .filter((obj) => !(obj.isCollidable && Math.abs(obj.position.x) >= GOAL_ZONE_CLEAR_X));

  const lighting = {
    ...base.lighting,
    directPosition: {
      x: base.lighting.directPosition.x * fX,
      y: base.lighting.directPosition.y,
      z: base.lighting.directPosition.z * fZ,
    },
    pointLights: base.lighting.pointLights.map((light) => ({
      ...light,
      position: { x: light.position.x * fX, y: light.position.y, z: light.position.z * fZ },
    })),
  };

  const teamSpawns = {
    blue: teamSpawnCluster(-SPAWN_X),
    red: teamSpawnCluster(SPAWN_X),
  };

  const result: CustomMapData = {
    ...base,
    arenaHalfExtents: { x: GRIFBALL_HALF_X, z: GRIFBALL_HALF_Z },
    objects: [
      ...stretchedObjects,
      makeGoalPlate('blue', -PLATE_X),
      makeGoalPlate('red', PLATE_X),
    ],
    lighting,
    teamSpawns,
    spawnPoints: [...teamSpawns.blue, ...teamSpawns.red],
  };

  cache.set(base.id, result);
  return result;
}
