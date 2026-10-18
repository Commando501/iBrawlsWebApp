import type { CustomMapData } from '../types';

export const CHAMPIONSHIP_STADIUM_LAYOUT_REVISION = 2;

/**
 * Wall-to-wall player-center travel from rest, facing along the measured axis,
 * with forward + sprint held, no ball, jumps, slides or dashes. The live movement
 * code assigns sprint velocity immediately (no acceleration ramp).
 *
 * These are authored dimensions, not a function of the current lobby settings:
 * changing speed settings must not resize a map or invalidate a saved replay.
 * Sprint remains opt-in; timings use the existing default 100% forward / 140%
 * sprint settings with sprint enabled. Custom speeds change traversal times.
 */
export const CHAMPIONSHIP_STADIUM_SPRINT_BASELINE = Object.freeze({
  baseWalkMetersPerSecond: 5.8,
  forwardPercent: 100,
  sprintPercent: 140,
  sprintMetersPerSecond: 8.12,
  playerBoundaryInsetMeters: 0.6,
  widthSeconds: 8,
  lengthSeconds: 15,
});

const HALF_EXTENTS = {
  1: { x: 52, z: 23 },
  // Full floor = sprint speed * target seconds + the two player-center insets.
  2: { x: 61.5, z: 33.08 },
} as const;

/** X is the long, goal-to-goal axis; Z is the short, sideline-to-sideline axis. */
export function getChampionshipStadiumLayout(revision: 1 | 2 = CHAMPIONSHIP_STADIUM_LAYOUT_REVISION) {
  const halfExtents = { ...HALF_EXTENTS[revision] };
  const goalX = halfExtents.x - 5;
  const outerSpawnZ = halfExtents.z - 5;
  const spawnZs = [-outerSpawnZ, -outerSpawnZ / 2, outerSpawnZ / 2, outerSpawnZ];
  const teamSpawns = {
    blue: spawnZs.map(z => ({ x: -goalX, y: 0, z })),
    red: spawnZs.map(z => ({ x: goalX, y: 0, z })),
  };
  return { halfExtents, goalX, teamSpawns, fogDensity: revision === 1 ? 0.015 : 0.009 };
}

/** Restore old recorded geometry without changing the current playable preset. */
export function withChampionshipStadiumLayout(map: CustomMapData, revision: 1 | 2): CustomMapData {
  const { halfExtents, goalX, teamSpawns, fogDensity } = getChampionshipStadiumLayout(revision);
  return {
    ...map,
    arenaRadius: halfExtents.x,
    arenaHalfExtents: halfExtents,
    fogDensity,
    spawnPoints: [...teamSpawns.blue, ...teamSpawns.red],
    teamSpawns,
    lighting: {
      ...map.lighting,
      pointLights: map.lighting.pointLights.map(light => {
        const side = light.id === 'stadium_blue_light_w' ? -1 : light.id === 'stadium_red_light_e' ? 1 : 0;
        return side ? { ...light, position: { ...light.position, x: side * goalX } } : light;
      }),
    },
    objects: map.objects.map(object => {
      const side = object.id === 'grifball_goal_blue' ? -1 : object.id === 'grifball_goal_red' ? 1 : 0;
      return side ? { ...object, position: { ...object.position, x: side * goalX } } : object;
    }),
  };
}

/** Shared by 3D playback, loading previews, and Theater heatmaps. */
export function resolveChampionshipStadiumReplayLayout(map: CustomMapData, revision?: 1 | 2): CustomMapData {
  return map.id === 'championship_stadium' && revision !== CHAMPIONSHIP_STADIUM_LAYOUT_REVISION
    ? withChampionshipStadiumLayout(map, 1)
    : map;
}
