import { getRectHalfExtents } from '../../game/arenaDimensions';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import type { CustomMapData, ReplayFile } from '../../types';

export interface TopDownMapBounds {
  shape: 'circle' | 'rectangular';
  radius: number;
  halfX: number;
  halfZ: number;
  map: CustomMapData | null;
  mapId: string;
}

const DEFAULT_ARENA_RADIUS = 20;

export function resolveTopDownCustomMap({
  selectedMap,
  customMap,
  replayData,
}: {
  selectedMap: string;
  customMap?: CustomMapData | null;
  replayData?: ReplayFile | null;
}): { mapId: string; map: CustomMapData | null } {
  const mapId = String(replayData?.mapType ?? selectedMap ?? 'hangar');
  if (customMap && (selectedMap === 'custom_file' || customMap.id === mapId)) {
    return { mapId, map: customMap };
  }

  const premade = PREMADE_MAPS.find((map) => map.id === mapId);
  if (premade) return { mapId, map: premade };

  if (typeof localStorage !== 'undefined' && mapId !== 'hangar' && mapId !== 'circle') {
    const stored = localStorage.getItem(`map_${mapId}`);
    if (stored) {
      try {
        return { mapId, map: JSON.parse(stored) as CustomMapData };
      } catch {
        return { mapId, map: null };
      }
    }
  }

  return { mapId, map: null };
}

export function resolveTopDownMapBounds(input: {
  selectedMap: string;
  customMap?: CustomMapData | null;
  replayData?: ReplayFile | null;
}): TopDownMapBounds {
  const { mapId, map } = resolveTopDownCustomMap(input);
  if (map) {
    const shape = map.mapShape === 'circle' ? 'circle' : 'rectangular';
    const extents = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
    return {
      shape,
      radius: map.arenaRadius,
      halfX: shape === 'circle' ? map.arenaRadius : extents.x,
      halfZ: shape === 'circle' ? map.arenaRadius : extents.z,
      map,
      mapId,
    };
  }

  if (mapId === 'hangar' || mapId === 'circle') {
    return {
      shape: 'circle',
      radius: DEFAULT_ARENA_RADIUS,
      halfX: DEFAULT_ARENA_RADIUS,
      halfZ: DEFAULT_ARENA_RADIUS,
      map: null,
      mapId,
    };
  }

  const extents = getRectHalfExtents(DEFAULT_ARENA_RADIUS);
  return {
    shape: 'rectangular',
    radius: DEFAULT_ARENA_RADIUS,
    halfX: extents.x,
    halfZ: extents.z,
    map: null,
    mapId,
  };
}
