import type { ReplayFile } from '../../types';

export type TheaterCollection = 'saved' | 'recent';
export type TheaterMapFilter = 'all' | 'hangar' | 'circle';
export type TheaterModeFilter = 'all' | 'sandbox' | 'tournament';
export type TheaterLibraryStatus = 'ready' | 'loading' | 'error';

export function getTheaterCollection({ collection, savedReplays, cachedReplays, searchQuery, mapFilter, modeFilter }: {
  collection: TheaterCollection;
  savedReplays: ReplayFile[];
  cachedReplays: ReplayFile[];
  searchQuery: string;
  mapFilter: TheaterMapFilter;
  modeFilter: TheaterModeFilter;
}): ReplayFile[] {
  // Saved filters never hide matches in the rolling cache.
  if (collection === 'recent') return cachedReplays;
  const query = searchQuery.trim().toLowerCase();
  return savedReplays.filter((replay) =>
    (mapFilter === 'all' || String(replay.mapType) === mapFilter)
    && (modeFilter === 'all' || replay.mode === modeFilter)
    && (!query || replay.name.toLowerCase().includes(query) || replay.description.toLowerCase().includes(query))
  );
}

export function getSelectedTheaterReplay(replays: ReplayFile[], selectedId: string | null): ReplayFile | null {
  return replays.find((replay) => replay.id === selectedId) ?? replays[0] ?? null;
}

export function formatReplayDuration(secondsTotal: number): string {
  const total = Math.max(0, Number.isFinite(secondsTotal) ? secondsTotal : 0);
  return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
}

export const HEATMAP_PREVIEW_LOOP_MS = 12_000;
export const HEATMAP_PREVIEW_HOLD_MS = 1_500;

/** Compress the actual recorded event timeline into a short loop, then hold every event in view. */
export function getHeatmapPreviewFrame(replay: ReplayFile | null, elapsedMs: number | null) {
  const events = replay?.heatmap?.events ?? [];
  const duration = events.reduce((end, event) => Number.isFinite(event.time) ? Math.max(end, event.time) : end,
    Number.isFinite(replay?.duration) ? Math.max(0, replay!.duration) : 0);
  if (elapsedMs === null) return { time: undefined, progress: 1, eventCount: events.length, duration };
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) % HEATMAP_PREVIEW_LOOP_MS;
  const progress = Math.min(1, elapsed / (HEATMAP_PREVIEW_LOOP_MS - HEATMAP_PREVIEW_HOLD_MS));
  const time = duration * progress;
  return { time, progress, eventCount: events.filter((event) => event.time <= time).length, duration };
}
