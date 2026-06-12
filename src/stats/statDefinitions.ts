import { MEDAL_IDS, getMedalInfo } from '../game/medalCatalog';
import type { StatMergeStrategy } from './statTypes';

/**
 * Declarative registry of every stat shown in the Service Record.
 *
 * Adding a stat:
 * 1. Add a definition here (display metadata + merge strategy).
 * 2. Emit it — either from the tracker's built-in counters, or from a rule in
 *    statRules.ts for nuanced multi-condition stats.
 * Persistence, cloud sync, and the UI pick it up with no further changes.
 *
 * Medal counts are auto-registered from the medal catalog as `medal.<id>`.
 */

export type StatCategory = 'combat' | 'matches' | 'objective' | 'records' | 'medals';

export type StatFormat = 'count' | 'duration' | 'ratio';

export interface StatDefinition {
  id: string;
  name: string;
  description: string;
  category: StatCategory;
  format: StatFormat;
  merge: StatMergeStrategy;
}

const def = (
  id: string,
  name: string,
  description: string,
  category: StatCategory,
  format: StatFormat = 'count',
  merge: StatMergeStrategy = 'sum'
): StatDefinition => ({ id, name, description, category, format, merge });

const CORE_STAT_DEFINITIONS: StatDefinition[] = [
  // ── Combat ──────────────────────────────────────────────────────────────
  def('combat.kills', 'Kills', 'Total opponents eliminated.', 'combat'),
  def('combat.deaths', 'Deaths', 'Total times eliminated.', 'combat'),
  def('combat.hammerKills', 'Hammer Kills', 'Kills with the Gravity Hammer.', 'combat'),
  def('combat.swordKills', 'Sword Kills', 'Kills with the Katar Sword.', 'combat'),
  def('combat.pistolKills', 'Pistol Kills', 'Kills with the pistol.', 'combat'),
  def('combat.tradeKills', 'Trades', 'Mutual eliminations — you and your opponent fell together.', 'combat'),
  def('combat.medals', 'Medals Earned', 'Total medals earned across all matches.', 'combat'),
  def('combat.multikills', 'Multikills', 'Double kills or better.', 'combat'),

  // ── Matches ─────────────────────────────────────────────────────────────
  def('match.played', 'Matches Played', 'Matches that reached a result.', 'matches'),
  def('match.wins', 'Wins', 'Matches won.', 'matches'),
  def('match.losses', 'Losses', 'Matches lost.', 'matches'),
  def('match.draws', 'Draws', 'Matches ended level.', 'matches'),
  def('match.abandoned', 'Abandoned', 'Matches left before a result.', 'matches'),
  def('match.timePlayed', 'Time Played', 'Total in-match time.', 'matches', 'duration'),
  def('match.flawlessWins', 'Flawless Victories', 'Wins without dying a single time.', 'matches'),
  def('match.comebackWins', 'Comeback Wins', 'Wins after trailing by 3 or more.', 'matches'),

  // ── Objective (Grifball) ────────────────────────────────────────────────
  def('objective.teamGoals', 'Team Goals', 'Goals your team scored while you fought.', 'objective'),
  def('objective.goalsConceded', 'Goals Conceded', 'Goals scored against your team.', 'objective'),
  def('objective.shutoutWins', 'Shutout Wins', 'Grifball wins conceding zero goals.', 'objective'),

  // ── Personal records (merge = max) ──────────────────────────────────────
  def('best.killsInMatch', 'Most Kills in a Match', 'Personal best kills in a single match.', 'records', 'count', 'max'),
  def('best.killingSpree', 'Longest Killing Spree', 'Most kills without dying.', 'records', 'count', 'max'),
  def('best.medalsInMatch', 'Most Medals in a Match', 'Personal best medals in a single match.', 'records', 'count', 'max'),
  def('best.winStreak', 'Longest Win Streak', 'Consecutive match wins.', 'records', 'count', 'max'),
];

const MEDAL_STAT_DEFINITIONS: StatDefinition[] = MEDAL_IDS.map((medalId) => {
  const info = getMedalInfo(medalId);
  return def(
    `medal.${medalId}`,
    info?.name ?? medalId,
    info?.description ?? '',
    'medals'
  );
});

export const STAT_DEFINITIONS: StatDefinition[] = [
  ...CORE_STAT_DEFINITIONS,
  ...MEDAL_STAT_DEFINITIONS,
];

const STAT_DEFINITION_INDEX = new Map(STAT_DEFINITIONS.map((d) => [d.id, d]));

export function getStatDefinition(statId: string): StatDefinition | undefined {
  return STAT_DEFINITION_INDEX.get(statId);
}

/**
 * Merge strategy for a stat id. Unknown ids (e.g. stats added in a newer
 * client whose totals come back from the cloud) fall back by convention:
 * `best.*` is a personal best, everything else is a counter.
 */
export function getMergeStrategy(statId: string): StatMergeStrategy {
  const known = STAT_DEFINITION_INDEX.get(statId);
  if (known) return known.merge;
  return statId.startsWith('best.') ? 'max' : 'sum';
}

export function medalIdFromStatId(statId: string): string | null {
  return statId.startsWith('medal.') ? statId.slice('medal.'.length) : null;
}
