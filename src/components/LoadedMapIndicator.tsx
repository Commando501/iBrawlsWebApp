import React from 'react';
import type { CustomMapData } from '../types';
import { DEFAULT_MAP_SCALE } from '../../shared/mapBalanceSettings';

/** Receives the same frozen map as the renderer. Never consult live settings here. */
export function LoadedMapIndicator({ map, session }: { map: CustomMapData; session: string }) {
  const scale = map.balanceScale ?? DEFAULT_MAP_SCALE;
  const version = map.balancePresetVersion;
  const preset = typeof version === 'number' && Number.isSafeInteger(version) && version > 0
    ? `Preset v${version}`
    : version === null ? 'No published preset · authored size' : 'Preset version unavailable';
  return <aside aria-label="Loaded map" data-testid="loaded-map-indicator"
    className="pointer-events-none rounded-lg border border-cyan-300/25 bg-slate-950/90 px-3 py-2 text-center text-[10px] leading-relaxed text-slate-200 shadow-lg sm:text-xs">
    <p className="font-semibold text-cyan-200">Loaded map · {session} · {map.name}</p>
    <p className="font-mono tabular-nums">Length {scale.length}% · Width {scale.width}% · Height {scale.height}%</p>
    <p className="text-slate-300">{preset}</p>
  </aside>;
}
