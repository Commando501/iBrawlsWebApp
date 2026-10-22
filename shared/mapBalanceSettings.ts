/** Published percentages. Keep this module dependency-free for both relays. */
export interface MapBalanceScale {
  length: number;
  width: number;
  height: number;
}

export interface MapBalanceSettings {
  mapScaleStadiumLength?: number;
  mapScaleStadiumWidth?: number;
  mapScaleStadiumHeight?: number;
}

export const MAP_SCALE_MIN = 50;
export const MAP_SCALE_MAX = 200;
export const DEFAULT_MAP_SCALE: Readonly<MapBalanceScale> = Object.freeze({ length: 100, width: 100, height: 100 });
export const STADIUM_SCALE_KEYS = {
  length: 'mapScaleStadiumLength',
  width: 'mapScaleStadiumWidth',
  height: 'mapScaleStadiumHeight',
} as const;

export function normalizeMapScalePercent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MAP_SCALE_MIN, Math.min(MAP_SCALE_MAX, Math.round(value)))
    : 100;
}

export function getStadiumMapScale(settings: MapBalanceSettings): MapBalanceScale {
  return {
    length: normalizeMapScalePercent(settings.mapScaleStadiumLength),
    width: normalizeMapScalePercent(settings.mapScaleStadiumWidth),
    height: normalizeMapScalePercent(settings.mapScaleStadiumHeight),
  };
}

export function sanitizeMapScaleSetting(key: string, value: unknown): unknown {
  return Object.values(STADIUM_SCALE_KEYS).some(candidate => candidate === key)
    ? normalizeMapScalePercent(value)
    : value;
}
