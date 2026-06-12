/**
 * Core types for the player stat system.
 *
 * Design notes:
 * - Every tracked quantity (including each medal) is a flat numeric counter
 *   keyed by stat id. The only thing the persistence layer needs to know is
 *   the merge strategy ('sum' for counters, 'max' for personal bests), so new
 *   stats require zero storage/backend changes.
 * - Stats accumulate per mode (offline/online x game mode); lifetime totals
 *   are kept alongside so reads are O(1).
 * - Cloud sync is delta-based: the client accumulates a pending StatDelta and
 *   the server folds it into the account's totals. This survives multi-device
 *   play and offline sessions without double counting.
 */

export type StatMergeStrategy = 'sum' | 'max';

/** Where a match was played. Keep keys stable — they are persisted. */
export type StatModeKey =
  | 'offline:sandbox'
  | 'offline:tournament'
  | 'offline:grifball'
  | 'online:sandbox'
  | 'online:grifball';

export const STAT_MODE_KEYS: readonly StatModeKey[] = [
  'offline:sandbox',
  'offline:tournament',
  'offline:grifball',
  'online:sandbox',
  'online:grifball',
];

export const STAT_MODE_LABELS: Record<StatModeKey, string> = {
  'offline:sandbox': 'Offline Combat',
  'offline:tournament': 'Tournament',
  'offline:grifball': 'Offline Grifball',
  'online:sandbox': 'Online Combat',
  'online:grifball': 'Online Grifball',
};

export type StatCounterMap = Record<string, number>;

/** Persisted local profile. Totals are lifetime across all modes. */
export interface PlayerStatsProfile {
  schemaVersion: 1;
  createdAt: number;
  updatedAt: number;
  totals: StatCounterMap;
  modes: Partial<Record<StatModeKey, StatCounterMap>>;
}

/**
 * Accumulated, not-yet-synced changes. Sums add, maxes fold with Math.max.
 * The same shape is what the worker ingests, so the server stays generic.
 */
export interface StatDelta {
  sums: StatCounterMap;
  maxes: StatCounterMap;
  modes: Partial<Record<StatModeKey, { sums: StatCounterMap; maxes: StatCounterMap }>>;
}

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'abandoned';

export interface MatchContext {
  mode: StatModeKey;
  isMultiplayer: boolean;
  gameMode: 'sandbox' | 'grifball';
  startedAt: number;
}

/** Gameplay events derived by the tracker and consumed by stat rules. */
export type StatEvent =
  | { type: 'kill'; weapon: string | null; medals: string[] }
  | { type: 'death' }
  | { type: 'medal'; medalId: string }
  | { type: 'teamGoal' }
  | { type: 'goalConceded' };

/** Per-match summary handed to rules when the match ends. */
export interface MatchSummary {
  context: MatchContext;
  outcome: MatchOutcome;
  kills: number;
  deaths: number;
  medals: number;
  teamGoals: number;
  goalsConceded: number;
  /** Largest score deficit the local side faced during the match. */
  maxDeficit: number;
  timePlayedSeconds: number;
}

/** A single stat change produced by a rule or the tracker. */
export interface StatContribution {
  statId: string;
  value: number;
  merge: StatMergeStrategy;
}

/**
 * A complex stat rule: owns optional per-match scratch state, reacts to
 * gameplay events, and can emit contributions during the match and/or when
 * the match ends. This is the extension point for nuanced multi-condition
 * stats ("win without dying", "longest spree", ...).
 */
export interface StatRule {
  id: string;
  createScratch?: () => Record<string, number>;
  onEvent?: (
    event: StatEvent,
    scratch: Record<string, number>,
    context: MatchContext
  ) => StatContribution[] | void;
  onMatchEnd?: (
    summary: MatchSummary,
    scratch: Record<string, number>
  ) => StatContribution[] | void;
}

export function createEmptyDelta(): StatDelta {
  return { sums: {}, maxes: {}, modes: {} };
}

export function isDeltaEmpty(delta: StatDelta): boolean {
  if (Object.keys(delta.sums).length > 0) return false;
  if (Object.keys(delta.maxes).length > 0) return false;
  for (const mode of Object.values(delta.modes)) {
    if (!mode) continue;
    if (Object.keys(mode.sums).length > 0 || Object.keys(mode.maxes).length > 0) return false;
  }
  return true;
}
