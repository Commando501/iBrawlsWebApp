import type { CustomMapData, UniversalSettings } from '../types';
import { PREMADE_MAPS } from './premadeMaps';
import { getRectHalfExtents } from './arenaDimensions';
import { resolveDirectionalSpeedMultiplier } from './runnerBallSettings';
import { DEFAULT_MAP_SCALE, getStadiumMapScale, normalizeMapScalePercent, type MapBalanceScale, type MapBalanceSettings } from '../../shared/mapBalanceSettings';

/** Only authored, verified Grifball courts are eligible. Map Maker data is untouched. */
export const BALANCEABLE_MAPS = PREMADE_MAPS.filter(map => map.id === 'championship_stadium');
export const MAP_BALANCE_PLAYER_INSET = 0.6;
export const STADIUM_STRUCTURE_HEIGHT = 22.4;
export const BASE_PLAYER_RUN_SPEED = 5.8;

export function mapScaleFactors(scale: MapBalanceScale = DEFAULT_MAP_SCALE) {
  return { x: normalizeMapScalePercent(scale.length) / 100, y: normalizeMapScalePercent(scale.height) / 100, z: normalizeMapScalePercent(scale.width) / 100 };
}

/** Always transform the authored map, never a previous preview (no cumulative drift).
 * Stadium objects are axis-aligned; its composed scenery uses the same world-axis
 * transform on the parent group, preserving every joint and clearance.
 */
export function balanceMap(base: CustomMapData, scale: MapBalanceScale): CustomMapData {
  if (base.id !== 'championship_stadium' || base.balanceScale) return base;
  const normalized = { length: normalizeMapScalePercent(scale.length), width: normalizeMapScalePercent(scale.width), height: normalizeMapScalePercent(scale.height) };
  const factors = mapScaleFactors(normalized);
  const point = <T extends { x: number; y: number; z: number }>(value: T): T => ({ ...value, x: value.x * factors.x, y: value.y * factors.y, z: value.z * factors.z });
  const half = getRectHalfExtents(base.arenaRadius, base.arenaHalfExtents);
  return {
    ...base,
    balanceScale: normalized,
    arenaRadius: base.arenaRadius * Math.max(factors.x, factors.z),
    arenaHalfExtents: { x: half.x * factors.x, z: half.z * factors.z },
    ...(base.arenaCeiling === undefined ? {} : { arenaCeiling: base.arenaCeiling * factors.y }),
    spawnPoints: base.spawnPoints.map(point),
    teamSpawns: base.teamSpawns && Object.fromEntries(Object.entries(base.teamSpawns).map(([team, spawns]) => [team, spawns.map(point)])),
    objects: base.objects.map(object => ({ ...object, position: point(object.position), scale: point(object.scale) })),
    lighting: {
      ...base.lighting,
      directPosition: point(base.lighting.directPosition),
      pointLights: base.lighting.pointLights.map(light => ({ ...light, position: point(light.position), distance: light.distance * Math.max(factors.x, factors.y, factors.z) })),
    },
  };
}

/** The host sends this concrete snapshot through the existing custom-map payload.
 * Even late joiners use the same court when the official preset changes mid-match.
 */
export function createBalancedMapSnapshot(mapId: string, settings: MapBalanceSettings): CustomMapData | null {
  const base = BALANCEABLE_MAPS.find(map => map.id === mapId);
  return base ? balanceMap(base, getStadiumMapScale(settings)) : null;
}

export function getMapTraversal(map: CustomMapData, settings: UniversalSettings) {
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  // Match playerMovementRuntime: full forward input, no ball, no transient abilities.
  const run = BASE_PLAYER_RUN_SPEED * resolveDirectionalSpeedMultiplier(settings, 'forward', false);
  const sprint = settings.enableSprint ? run * settings.speedSprint / 100 : null;
  const seconds = (distance: number, speed: number | null) => speed !== null && Number.isFinite(speed) && speed > 0 ? distance / speed : null;
  const length = Math.max(0, half.x * 2 - MAP_BALANCE_PLAYER_INSET * 2);
  const width = Math.max(0, half.z * 2 - MAP_BALANCE_PLAYER_INSET * 2);
  return { run, sprint, length, width, lengthRun: seconds(length, run), lengthSprint: seconds(length, sprint), widthRun: seconds(width, run), widthSprint: seconds(width, sprint) };
}
