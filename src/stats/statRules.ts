import type { StatContribution, StatRule } from './statTypes';

/**
 * Built-in complex stat rules. A rule owns numeric scratch state for the
 * current match, reacts to derived gameplay events, and emits contributions
 * mid-match and/or at match end. Register new rules in STAT_RULES — the
 * tracker runs every rule automatically.
 */

const sum = (statId: string, value = 1): StatContribution => ({ statId, value, merge: 'sum' });
const max = (statId: string, value: number): StatContribution => ({ statId, value, merge: 'max' });

/** Longest run of kills without dying, committed as a personal best. */
const killingSpreeRule: StatRule = {
  id: 'rule.killingSpree',
  createScratch: () => ({ current: 0 }),
  onEvent: (event, scratch) => {
    if (event.type === 'kill') {
      scratch.current += 1;
      return [max('best.killingSpree', scratch.current)];
    }
    if (event.type === 'death') {
      scratch.current = 0;
    }
  },
};

/** Double kills or better, counted once per multikill medal. */
const multikillRule: StatRule = {
  id: 'rule.multikills',
  onEvent: (event) => {
    if (event.type !== 'medal') return;
    if (event.medalId === 'double' || event.medalId === 'triple' || event.medalId === 'overkill') {
      return [sum('combat.multikills')];
    }
  },
};

/** Personal bests that read straight off the match summary. */
const personalBestsRule: StatRule = {
  id: 'rule.personalBests',
  onMatchEnd: (summary) => {
    const out: StatContribution[] = [];
    if (summary.kills > 0) out.push(max('best.killsInMatch', summary.kills));
    if (summary.medals > 0) out.push(max('best.medalsInMatch', summary.medals));
    return out;
  },
};

/** Win an entire match without dying once. */
const flawlessVictoryRule: StatRule = {
  id: 'rule.flawlessVictory',
  onMatchEnd: (summary) => {
    if (summary.outcome === 'win' && summary.deaths === 0) {
      return [sum('match.flawlessWins')];
    }
  },
};

/** Win after the local side trailed by 3+ at any point. */
const comebackWinRule: StatRule = {
  id: 'rule.comebackWin',
  onMatchEnd: (summary) => {
    if (summary.outcome === 'win' && summary.maxDeficit >= 3) {
      return [sum('match.comebackWins')];
    }
  },
};

/** Grifball win without conceding a single goal. */
const shutoutWinRule: StatRule = {
  id: 'rule.shutoutWin',
  onMatchEnd: (summary) => {
    if (
      summary.outcome === 'win' &&
      summary.context.gameMode === 'grifball' &&
      summary.goalsConceded === 0
    ) {
      return [sum('objective.shutoutWins')];
    }
  },
};

export const STAT_RULES: StatRule[] = [
  killingSpreeRule,
  multikillRule,
  personalBestsRule,
  flawlessVictoryRule,
  comebackWinRule,
  shutoutWinRule,
];
