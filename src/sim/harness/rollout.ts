/**
 * Match rollouts + head-to-head evaluation for baseline / frozen policies. `playMatch`
 * runs a full self-play match with one policy per team; `evaluate` aggregates many matches
 * into win-rate / goal-diff / length, the TS-side mirror of Python's `eval.py`.
 */

import { type UniversalSettings } from '../../types';
import { type TeamId } from '../../game/teamScoring';
import { createMatch, resolveSimSettings } from '../factory';
import { stepSimulation } from '../step';
import { type SimState } from '../simState';
import { createRng } from '../rng';
import { type Policy } from './policy';

export interface MatchResult {
  winner: TeamId | null;
  goals: Record<TeamId, number>;
  kills: Record<TeamId, number>;
  ticks: number;
  /** True if the match hit `maxTicks` without a winner. */
  timedOut: boolean;
}

export interface PlayMatchOptions {
  seed: number;
  bluePolicy: Policy;
  redPolicy: Policy;
  settings?: Partial<UniversalSettings>;
  /** Safety cap so a stalemate can't run forever (default 30 simulated minutes). */
  maxTicks?: number;
}

/** Run one match to its natural end (or `maxTicks`) and report the outcome. */
export function playMatch(options: PlayMatchOptions): MatchResult {
  const settings = resolveSimSettings(options.settings);
  const state: SimState = createMatch({ seed: options.seed, settings: options.settings });
  const rng = createRng(options.seed ^ 0x5bd1e995);
  const maxTicks = options.maxTicks ?? 60 * 60 * 30;

  let ticks = 0;
  while (state.match.phase !== 'matchEnd' && ticks < maxTicks) {
    const actions: Record<string, ReturnType<Policy>> = {};
    for (const c of state.combatants) {
      const policy = c.team === 'blue' ? options.bluePolicy : options.redPolicy;
      actions[c.id] = policy(state, c.id, rng);
    }
    stepSimulation(state, actions, { settings });
    ticks++;
  }

  const goals: Record<TeamId, number> = { blue: state.scores.blue.goals, red: state.scores.red.goals };
  const kills: Record<TeamId, number> = { blue: state.scores.blue.kills, red: state.scores.red.kills };
  return {
    winner: state.match.winningTeam,
    goals,
    kills,
    ticks,
    timedOut: state.match.phase !== 'matchEnd',
  };
}

export interface EvalSummary {
  matches: number;
  blueWins: number;
  redWins: number;
  draws: number;
  blueWinRate: number;
  avgGoalDiff: number; // blue - red, averaged
  avgTicks: number;
  timeouts: number;
}

export interface EvaluateOptions {
  blue: Policy;
  red: Policy;
  matches: number;
  baseSeed?: number;
  settings?: Partial<UniversalSettings>;
  maxTicks?: number;
}

/** Aggregate `matches` head-to-head games (deterministic per `baseSeed`). */
export function evaluate(options: EvaluateOptions): EvalSummary {
  const base = options.baseSeed ?? 1;
  let blueWins = 0;
  let redWins = 0;
  let draws = 0;
  let goalDiff = 0;
  let totalTicks = 0;
  let timeouts = 0;

  for (let i = 0; i < options.matches; i++) {
    const r = playMatch({
      seed: base + i,
      bluePolicy: options.blue,
      redPolicy: options.red,
      settings: options.settings,
      maxTicks: options.maxTicks,
    });
    if (r.winner === 'blue') blueWins++;
    else if (r.winner === 'red') redWins++;
    else draws++;
    goalDiff += r.goals.blue - r.goals.red;
    totalTicks += r.ticks;
    if (r.timedOut) timeouts++;
  }

  return {
    matches: options.matches,
    blueWins,
    redWins,
    draws,
    blueWinRate: blueWins / options.matches,
    avgGoalDiff: goalDiff / options.matches,
    avgTicks: totalTicks / options.matches,
    timeouts,
  };
}
