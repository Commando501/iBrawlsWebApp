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
import { type ActionsById, type ActionInput } from '../actions';
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
  /**
   * Dense: per metre your team's nearest member closes on the objective — the free ball
   * (grifball) or the nearest enemy (combat). This is the exploration foothold: it leads a
   * from-scratch policy to the objective so it can start earning the sparser rewards.
   */
  approach: number;
  /** Dense: small per-tick penalty to discourage stalling. */
  timePenalty: number;
  /** Action-discipline penalties: wasted inputs that make bots look spammy/robotic. */
  invalidAttack: number;
  invalidDash: number;
  invalidJump: number;
  invalidSwap: number;
  /** Penalty for repeating the exact same BUTTON combo (attack/jump/dash/swap) on
   * consecutive ticks — catches robotic mash loops. Movement is excluded on purpose:
   * holding a heading is human. */
  actionRepeatPenalty: number;
}

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  win: 1.0,
  goalScored: 1.0,
  goalConceded: 1.0,
  possession: 0.002,
  ballProgress: 0.01,
  kill: 0.1,
  death: 0.1,
  approach: 0.01,
  timePenalty: 0.0005,
  invalidAttack: 0,
  invalidDash: 0,
  invalidJump: 0,
  invalidSwap: 0,
  actionRepeatPenalty: 0,
};

/** Cap per-tick approach delta so respawn/teleport position jumps can't spike the reward. */
const MAX_APPROACH_DELTA = 1.0;

export const REWARD_COMPONENT_KEYS = [
  'ballProgress',
  'possession',
  'goal',
  'win',
  'timePenalty',
  'approach',
  'kill',
  'death',
  'invalidAttack',
  'invalidDash',
  'invalidJump',
  'invalidSwap',
  'actionRepeat',
] as const;

export type RewardComponentKey = (typeof REWARD_COMPONENT_KEYS)[number];
export type RewardComponents = Record<RewardComponentKey, number>;

export interface RewardDetails {
  rewards: Record<string, number>;
  components: RewardComponents;
}

export interface RewardMemory {
  /** Per-team distance from the ball to that team's enemy goal, captured pre-step. */
  ballDistToEnemyGoal: Record<TeamId, number>;
  /** Per-AGENT distance to its approach objective (free ball / nearest enemy), captured pre-step. */
  approachDist: Record<string, number | null>;
  /** Previous button-combo signature per agent, used to discourage mash loops. */
  previousActionSignature: Record<string, string | null>;
}

/**
 * Distance from a single agent to the objective it should approach: the free ball in grifball
 * (null while held or if dead), or its nearest alive enemy in combat. Per-agent (not per-team)
 * so each agent gets credit for its OWN navigation — the key to the policy actually committing.
 */
function approachDistForAgent(state: SimState, agentId: string): number | null {
  const me = state.combatants.find((c) => c.id === agentId);
  if (!me || !me.alive) return null;
  if (state.mode === 'combat') {
    let best: number | null = null;
    for (const e of state.combatants) {
      if (e.team === me.team || !e.alive) continue;
      const d = Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z);
      if (best === null || d < best) best = d;
    }
    return best;
  }
  if (state.match.ball.state === 'held') return null; // possession/progress take over
  const b = state.match.ball;
  return Math.hypot(me.pos.x - b.pos.x, me.pos.z - b.pos.z);
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
  const app: Record<string, number | null> = {};
  for (const c of state.combatants) app[c.id] = approachDistForAgent(state, c.id);
  return { ballDistToEnemyGoal: dist, approachDist: app, previousActionSignature: {} };
}

function teamsInMatch(state: SimState): TeamId[] {
  const seen = new Set<TeamId>();
  for (const c of state.combatants) seen.add(c.team);
  return [...seen];
}

export function zeroRewardComponents(): RewardComponents {
  const out = {} as RewardComponents;
  for (const key of REWARD_COMPONENT_KEYS) out[key] = 0;
  return out;
}

function addComponent(components: RewardComponents, key: RewardComponentKey, value: number): void {
  if (value !== 0 && Number.isFinite(value)) components[key] += value;
}

function addReward(
  out: Record<string, number>,
  components: RewardComponents,
  id: string,
  amount: number,
  key: RewardComponentKey
): void {
  if (amount === 0 || !Number.isFinite(amount)) return;
  out[id] = (out[id] ?? 0) + amount;
  addComponent(components, key, amount);
}

/**
 * Signature of the BUTTON inputs only (attack/jump/dash/swap). Movement is deliberately
 * excluded: humans HOLD a heading for whole seconds, so penalizing a repeated move
 * direction would reward twitchy direction-flipping — the opposite of human-like play.
 * The repeat penalty exists to catch button-mash loops (attack held every decision),
 * which is exactly what reads as robotic.
 */
function actionSignature(action: ActionInput): string | null {
  const anyButton =
    action.attackPrimary ||
    action.attackSecondary ||
    action.jump ||
    action.dash ||
    action.swapWeapon;
  if (!anyButton) return null;
  return [
    action.attackPrimary ? 1 : 0,
    action.attackSecondary ? 1 : 0,
    action.jump ? 1 : 0,
    action.dash ? 1 : 0,
    action.swapWeapon ? 1 : 0,
  ].join('|');
}

export function computeActionDisciplineRewards(
  state: SimState,
  config: RewardConfig,
  memory: RewardMemory,
  actions: ActionsById
): RewardDetails {
  const rewards: Record<string, number> = {};
  const components = zeroRewardComponents();

  for (const c of state.combatants) {
    const action = actions[c.id];
    if (!action || !c.alive) {
      memory.previousActionSignature[c.id] = null;
      continue;
    }

    const attackRequested = action.attackPrimary || action.attackSecondary;
    const attackBlocked =
      c.attackCooldown > 0 ||
      c.weaponReadyTimer > 0 ||
      c.weaponState !== 'idle' ||
      c.isLunging;
    if (attackRequested && attackBlocked) {
      addReward(rewards, components, c.id, -config.invalidAttack, 'invalidAttack');
    }

    if (action.dash && (c.dashCooldownTimer > 0 || c.dashRemaining > 0)) {
      addReward(rewards, components, c.id, -config.invalidDash, 'invalidDash');
    }

    if (action.jump && (c.isJumping || c.pos.y > 0.0001)) {
      addReward(rewards, components, c.id, -config.invalidJump, 'invalidJump');
    }

    if (action.swapWeapon && (c.weapon === 'ball' || c.weaponState !== 'idle' || c.swapLockoutTimer > 0)) {
      addReward(rewards, components, c.id, -config.invalidSwap, 'invalidSwap');
    }

    const signature = actionSignature(action);
    if (signature && signature === memory.previousActionSignature[c.id]) {
      addReward(rewards, components, c.id, -config.actionRepeatPenalty, 'actionRepeat');
    }
    memory.previousActionSignature[c.id] = signature;
  }

  return { rewards, components };
}

export function mergeRewardDetails(a: RewardDetails, b: RewardDetails): RewardDetails {
  for (const [id, reward] of Object.entries(b.rewards)) {
    a.rewards[id] = (a.rewards[id] ?? 0) + reward;
  }
  for (const key of REWARD_COMPONENT_KEYS) {
    a.components[key] += b.components[key];
  }
  return a;
}

/**
 * Compute this tick's reward for every combatant and advance `memory`. Call **after**
 * `stepSimulation`, passing the events it returned. Returns `agentId -> reward`.
 */
export function computeStepRewards(
  state: SimState,
  events: StepEvents,
  config: RewardConfig,
  memory: RewardMemory,
  actions?: ActionsById
): Record<string, number> {
  return computeStepRewardDetails(state, events, config, memory, actions).rewards;
}

export function computeStepRewardDetails(
  state: SimState,
  events: StepEvents,
  config: RewardConfig,
  memory: RewardMemory,
  actions?: ActionsById
): RewardDetails {
  // --- Team-shared component (genuine team outcomes: possession, progress, goals, win) ---
  const teams = teamsInMatch(state);
  const perTeam: Record<TeamId, number> = {} as Record<TeamId, number>;
  const perTeamComponents: Record<TeamId, RewardComponents> = {} as Record<TeamId, RewardComponents>;
  const holder = state.match.ball.holderId
    ? state.combatants.find((c) => c.id === state.match.ball.holderId)
    : null;

  const components = zeroRewardComponents();
  for (const team of teams) {
    let r = 0;
    const teamComponents = zeroRewardComponents();

    const prev = memory.ballDistToEnemyGoal[team] ?? 0;
    const now = ballDistanceToEnemyGoal(state, team);
    if (prev > 0 && now > 0) {
      const amount = config.ballProgress * (prev - now);
      r += amount;
      addComponent(teamComponents, 'ballProgress', amount);
    }
    memory.ballDistToEnemyGoal[team] = now;

    if (holder && holder.team === team) {
      r += config.possession;
      addComponent(teamComponents, 'possession', config.possession);
    }

    if (events.goal === team) {
      r += config.goalScored;
      addComponent(teamComponents, 'goal', config.goalScored);
    } else if (events.goal && events.goal !== team) {
      r -= config.goalConceded;
      addComponent(teamComponents, 'goal', -config.goalConceded);
    }

    if (events.matchEnded && state.match.winningTeam) {
      const amount = state.match.winningTeam === team ? config.win : -config.win;
      r += amount;
      addComponent(teamComponents, 'win', amount);
    }

    r -= config.timePenalty;
    addComponent(teamComponents, 'timePenalty', -config.timePenalty);
    perTeam[team] = r;
    perTeamComponents[team] = teamComponents;
  }

  // --- Per-agent component: each agent gets credit for ITS OWN approach + kills/deaths ---
  const out: Record<string, number> = {};
  for (const c of state.combatants) {
    let r = perTeam[c.team] ?? 0;
    for (const key of REWARD_COMPONENT_KEYS) addComponent(components, key, perTeamComponents[c.team]?.[key] ?? 0);
    const prevApp = memory.approachDist[c.id];
    const nowApp = approachDistForAgent(state, c.id);
    if (prevApp != null && nowApp != null) {
      const delta = Math.max(-MAX_APPROACH_DELTA, Math.min(MAX_APPROACH_DELTA, prevApp - nowApp));
      const amount = config.approach * delta;
      r += amount;
      addComponent(components, 'approach', amount);
    }
    memory.approachDist[c.id] = nowApp;
    out[c.id] = r;
  }

  // Kills/deaths credited to the specific attacker / victim (not the whole team).
  for (const k of events.kills) {
    if (k.attackerId in out) addReward(out, components, k.attackerId, config.kill, 'kill');
    if (k.victimId in out) addReward(out, components, k.victimId, -config.death, 'death');
  }

  const details = { rewards: out, components };
  if (actions) mergeRewardDetails(details, computeActionDisciplineRewards(state, config, memory, actions));
  return details;
}
