import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { type CustomMapData, type ReplayFile } from '../../types';

interface ResolveActiveCustomMapOptions {
  customMap?: CustomMapData;
  replayData?: ReplayFile | null;
  selectedMap: string;
  /** When 'grifball', rectangular maps are reshaped into Grifball courts. */
  gameMode?: 'sandbox' | 'grifball';
}

function resolveBaseCustomMap({
  customMap,
  replayData,
  selectedMap,
}: ResolveActiveCustomMapOptions): CustomMapData | null {
  if (customMap) return customMap;
  const mapId = replayData ? replayData.mapType : selectedMap;
  if (mapId !== 'hangar' && mapId !== 'circle') {
    const premade = PREMADE_MAPS.find((m) => m.id === mapId);
    if (premade) return premade;
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(`map_${mapId}`);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          console.error('Error parsing local map', e);
        }
      }
    }
  }
  return null;
}

export function resolveActiveCustomMap(options: ResolveActiveCustomMapOptions): CustomMapData | null {
  const base = resolveBaseCustomMap(options);
  if (!base) return null;
  // Replays must replay on the exact recorded geometry — never reshape them.
  if (options.gameMode === 'grifball' && !options.replayData) {
    return toGrifballArena(base);
  }
  return base;
}
