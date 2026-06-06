/**
 * `RewardConfig`-driven reward shaping. Terminal win/loss and goal scored/conceded are
 * the sparse objective; the dense shaping terms (possession, ball-progress toward the
 * enemy goal, kills/deaths, a small time penalty) give the policy gradient something to
 * climb early. Every weight is configurable so reward-shaping sweeps run from the harness.
 *
 * Rewards are computed **per agent** (shared-policy self-play flattens agents into the
 * batch). Progress / possession need the pre-step ball position, so the caller threads a
 * small {@link RewardMemory} across ticks (the vec-env owns one per env).
 */

import { type SimState } from '../simState';
import { type StepEvents } from '../step';
import { enemyGoalForTeam } from '../../game/aiGrifballRoles';
import { type TeamId } from '../../game/teamScoring';

export interface RewardConfig {
  /** Terminal: ± on match end for the winning / losing team. */
  win: number;
  /** Sparse: own team scores a goal. */
  goalScored: number;
  /** Sparse: enemy team scores. */
  goalConceded: number;
  /** Dense: per tick your team possesses the ball. */
  possession: number;
  /** Dense: per metre the ball moves toward your team's enemy goal this tick. */
  ballProgress: number;
  /** Event: your team gets a kill / you die. */
  kill: number;
  death: number;
  /** Dense: small per-tick penalty to discourage stalling. */
  timePenalty: number;
}

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  win: 1.0,
  goalScored: 1.0,
  goalConceded: 1.0,
  possession: 0.002,
  ballProgress: 0.01,
  kill: 0.1,
  death: 0.1,
  timePenalty: 0.0005,
};

export interface RewardMemory {
  /** Per-team distance from the ball to that team's enemy goal, captured pre-step. */
  ballDistToEnemyGoal: Record<TeamId, number>;
}

function ballDistanceToEnemyGoal(state: SimState, team: TeamId): number {
  const g = enemyGoalForTeam(team, state.goalPlates);
  if (!g) return 0;
  const b = state.match.ball;
  return Math.hypot(b.pos.x - g.position.x, b.pos.z - g.position.z);
}

/** Capture the pre-step ball-progress baseline for every team in the match. */
export function initRewardMemory(state: SimState): RewardMemory {
  const dist: Record<TeamId, number> = {} as Record<TeamId, number>;
  for (const team of teamsInMatch(state)) {
    dist[team] = ballDistanceToEnemyGoal(state, team);
  }
  return { ballDistToEnemyGoal: dist };
}

function teamsInMatch(state: SimState): TeamId[] {
  const seen = new Set<TeamId>();
  for (const c of state.combatants) seen.add(c.team);
  return [...seen];
}

/**
 * Compute this tick's reward for every combatant and advance `memory`. Call **after**
 * `stepSimulation`, passing the events it returned. Returns `agentId -> reward`.
 */
export function computeStepRewards(
  state: SimState,
  events: StepEvents,
  config: RewardConfig,
  memory: RewardMemory
): Record<string, number> {
  // Per-team scalar reward, then broadcast to that team's agents.
  const teams = teamsInMatch(state);
  const perTeam: Record<TeamId, number> = {} as Record<TeamId, number>;

  for (const team of teams) {
    let r = 0;

    // Ball progress toward this team's enemy goal (positive = closer).
    const prev = memory.ballDistToEnemyGoal[team] ?? 0;
    const now = ballDistanceToEnemyGoal(state, team);
    if (prev > 0 && now > 0) r += config.ballProgress * (prev - now);
    memory.ballDistToEnemyGoal[team] = now;

    // Possession.
    const holder = state.match.ball.holderId
      ? state.combatants.find((c) => c.id === state.match.ball.holderId)
      : null;
    if (holder && holder.team === team) r += config.possession;

    // Goals.
    if (events.goal === team) r += config.goalScored;
    else if (events.goal && events.goal !== team) r -= config.goalConceded;

    // Kills / deaths (team-attributed).
    for (const k of events.kills) {
      const attacker = state.combatants.find((c) => c.id === k.attackerId);
      const victim = state.combatants.find((c) => c.id === k.victimId);
      if (attacker?.team === team) r += config.kill;
      if (victim?.team === team) r -= config.death;
    }

    // Terminal.
    if (events.matchEnded && state.match.winningTeam) {
      r += state.match.winningTeam === team ? config.win : -config.win;
    }

    // Time penalty.
    r -= config.timePenalty;

    perTeam[team] = r;
  }

  const out: Record<string, number> = {};
  for (const c of state.combatants) out[c.id] = perTeam[c.team] ?? 0;
  return out;
}
