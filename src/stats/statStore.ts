import { getMergeStrategy } from './statDefinitions';
import {
  createEmptyDelta,
  type PlayerStatsProfile,
  type StatCounterMap,
  type StatDelta,
  type StatModeKey,
} from './statTypes';

/**
 * Local persistence for the stat system. Pure merge helpers live here too so
 * they can be unit-tested without a browser.
 *
 * Storage layout:
 * - PROFILE_KEY  — the local view of lifetime totals (server totals + pending
 *   delta when signed in; the only copy when signed out).
 * - PENDING_KEY  — delta accumulated since the last successful cloud push.
 * - MERGED_KEY   — account id whose cloud profile already absorbed the
 *   pre-account local profile (guards the one-time first-login merge).
 */

export const STATS_PROFILE_KEY = 'ibrawls_player_stats_v1';
export const STATS_PENDING_KEY = 'ibrawls_player_stats_pending_v1';
export const STATS_MERGED_KEY = 'ibrawls_player_stats_merged_v1';
// Current win streak is device-local working state (a resettable counter can't
// ride the sum/max delta protocol); only the best.winStreak record syncs.
export const STATS_WIN_STREAK_KEY = 'ibrawls_player_stats_winstreak_v1';

function getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createEmptyProfile(now = Date.now()): PlayerStatsProfile {
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    totals: {},
    modes: {},
  };
}

function sanitizeCounterMap(raw: unknown): StatCounterMap {
  const out: StatCounterMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    out[key] = value;
  }
  return out;
}

export function parseStoredProfile(raw: string | null): PlayerStatsProfile {
  if (!raw) return createEmptyProfile();
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerStatsProfile> | null;
    if (!parsed || typeof parsed !== 'object') return createEmptyProfile();
    const modes: PlayerStatsProfile['modes'] = {};
    if (parsed.modes && typeof parsed.modes === 'object') {
      for (const [mode, counters] of Object.entries(parsed.modes)) {
        modes[mode as StatModeKey] = sanitizeCounterMap(counters);
      }
    }
    return {
      schemaVersion: 1,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      totals: sanitizeCounterMap(parsed.totals),
      modes,
    };
  } catch {
    return createEmptyProfile();
  }
}

export function parseStoredDelta(raw: string | null): StatDelta {
  if (!raw) return createEmptyDelta();
  try {
    const parsed = JSON.parse(raw) as Partial<StatDelta> | null;
    if (!parsed || typeof parsed !== 'object') return createEmptyDelta();
    const modes: StatDelta['modes'] = {};
    if (parsed.modes && typeof parsed.modes === 'object') {
      for (const [mode, entry] of Object.entries(parsed.modes)) {
        if (!entry || typeof entry !== 'object') continue;
        modes[mode as StatModeKey] = {
          sums: sanitizeCounterMap((entry as { sums?: unknown }).sums),
          maxes: sanitizeCounterMap((entry as { maxes?: unknown }).maxes),
        };
      }
    }
    return {
      sums: sanitizeCounterMap(parsed.sums),
      maxes: sanitizeCounterMap(parsed.maxes),
      modes,
    };
  } catch {
    return createEmptyDelta();
  }
}

// ── Pure merge helpers ───────────────────────────────────────────────────────

function applyCounter(target: StatCounterMap, statId: string, value: number, merge: 'sum' | 'max'): void {
  if (!Number.isFinite(value) || value <= 0) return;
  if (merge === 'sum') {
    target[statId] = (target[statId] ?? 0) + value;
  } else {
    target[statId] = Math.max(target[statId] ?? 0, value);
  }
}

/** Fold a delta into a profile (mutates and returns the profile). */
export function applyDeltaToProfile(profile: PlayerStatsProfile, delta: StatDelta, now = Date.now()): PlayerStatsProfile {
  for (const [statId, value] of Object.entries(delta.sums)) {
    applyCounter(profile.totals, statId, value, 'sum');
  }
  for (const [statId, value] of Object.entries(delta.maxes)) {
    applyCounter(profile.totals, statId, value, 'max');
  }
  for (const [mode, entry] of Object.entries(delta.modes)) {
    if (!entry) continue;
    const target = (profile.modes[mode as StatModeKey] ??= {});
    for (const [statId, value] of Object.entries(entry.sums)) {
      applyCounter(target, statId, value, 'sum');
    }
    for (const [statId, value] of Object.entries(entry.maxes)) {
      applyCounter(target, statId, value, 'max');
    }
  }
  profile.updatedAt = now;
  return profile;
}

/** Fold delta `extra` into delta `base` (mutates and returns `base`). */
export function mergeDeltas(base: StatDelta, extra: StatDelta): StatDelta {
  for (const [statId, value] of Object.entries(extra.sums)) {
    applyCounter(base.sums, statId, value, 'sum');
  }
  for (const [statId, value] of Object.entries(extra.maxes)) {
    applyCounter(base.maxes, statId, value, 'max');
  }
  for (const [mode, entry] of Object.entries(extra.modes)) {
    if (!entry) continue;
    const target = (base.modes[mode as StatModeKey] ??= { sums: {}, maxes: {} });
    for (const [statId, value] of Object.entries(entry.sums)) {
      applyCounter(target.sums, statId, value, 'sum');
    }
    for (const [statId, value] of Object.entries(entry.maxes)) {
      applyCounter(target.maxes, statId, value, 'max');
    }
  }
  return base;
}

/**
 * Express an entire profile as a delta — used once on first login to merge
 * the pre-account local history into the cloud profile.
 */
export function profileToDelta(profile: PlayerStatsProfile): StatDelta {
  const delta = createEmptyDelta();
  for (const [statId, value] of Object.entries(profile.totals)) {
    if (getMergeStrategy(statId) === 'max') delta.maxes[statId] = value;
    else delta.sums[statId] = value;
  }
  for (const [mode, counters] of Object.entries(profile.modes)) {
    if (!counters) continue;
    const entry = { sums: {} as StatCounterMap, maxes: {} as StatCounterMap };
    for (const [statId, value] of Object.entries(counters)) {
      if (getMergeStrategy(statId) === 'max') entry.maxes[statId] = value;
      else entry.sums[statId] = value;
    }
    delta.modes[mode as StatModeKey] = entry;
  }
  return delta;
}

// ── localStorage I/O (best-effort; in-memory state remains authoritative) ───

export function loadProfile(): PlayerStatsProfile {
  return parseStoredProfile(getStorage()?.getItem(STATS_PROFILE_KEY) ?? null);
}

export function saveProfile(profile: PlayerStatsProfile): void {
  try {
    getStorage()?.setItem(STATS_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage full/disabled — keep playing */
  }
}

export function loadPendingDelta(): StatDelta {
  return parseStoredDelta(getStorage()?.getItem(STATS_PENDING_KEY) ?? null);
}

export function savePendingDelta(delta: StatDelta): void {
  try {
    getStorage()?.setItem(STATS_PENDING_KEY, JSON.stringify(delta));
  } catch {
    /* best effort */
  }
}

export function loadWinStreak(): number {
  const raw = getStorage()?.getItem(STATS_WIN_STREAK_KEY);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function saveWinStreak(streak: number): void {
  try {
    getStorage()?.setItem(STATS_WIN_STREAK_KEY, String(Math.max(0, Math.floor(streak))));
  } catch {
    /* best effort */
  }
}

export function loadMergedAccountId(): string | null {
  return getStorage()?.getItem(STATS_MERGED_KEY) ?? null;
}

export function saveMergedAccountId(accountId: string): void {
  try {
    getStorage()?.setItem(STATS_MERGED_KEY, accountId);
  } catch {
    /* best effort */
  }
}
