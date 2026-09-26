import { createSnapshotRouters, tickRunnerMemory, planGrifballRunner, createRunnerEscortPlanner, type RunnerMemory, type RunnerPlan, type EscortOrder } from './aiGrifballRunner';
import { TACTICS_FIELDS, type TacticalNumber, defaultGrifballTactics, resolveTeamTactics, type GrifballTacticsConfig, type TeamTactics } from './grifballTacticsConfig';
import type { TeamId } from './teamScoring';
import { createGrifballSpaceEvaluator, estimateSpaceAttackTime, type GrifballSpaceDecision, type SpaceObservation } from './aiGrifballSpace';
import { isSpaceSegmentOpen, type GrifballSpaceGeometry } from './grifballSpaceGeometry';

export type FieldPoint = { x: number; z: number };
export type GrifballTeamRole = 'runner' | 'retriever' | 'lead' | 'cover' | 'safety' | 'chaser';
export interface GrifballTacticalPlayer {
  id: string;
  team: TeamId;
  pos: FieldPoint;
  vel: FieldPoint;
  /** Only scripted bots accept assignments; humans and neural bots remain autonomous. */
  scripted: boolean;
  pickupRequested?: boolean;
  heading?: FieldPoint;
  space?: SpaceObservation;
}
export interface GrifballTacticalSnapshot {
  round: number;
  playing: boolean;
  ball: FieldPoint;
  holderId: string | null;
  players: GrifballTacticalPlayer[]; // alive, active participants only
  goals: Record<TeamId, FieldPoint | null>; // own goals
  spacing: number;
  tactics?: GrifballTacticsConfig;
  geometry?: GrifballSpaceGeometry;
}
export interface GrifballAssignment {
  botId: string;
  team: TeamId;
  role: GrifballTeamRole;
  slot: number;
  destination: FieldPoint;
  anchor: FieldPoint;
  carrierId: string | null;
  reason: string;
  tuning?: TeamTactics;
  runner?: RunnerPlan;
  escort?: EscortOrder;
  space?: GrifballSpaceDecision;
  geometry?: GrifballSpaceGeometry;
}
export interface GrifballTeamPlanState {
  assignments: Map<string, GrifballAssignment>;
  snapshot: GrifballTacticalSnapshot | null;
  signature: string;
  untilRefresh: number;
  revision: number;
  teamRefresh: Record<string, number>;
  runnerMemory: Record<string, RunnerMemory>;
  runnerPlans: Record<string, RunnerPlan>;
}

export const createGrifballTeamPlanState = (): GrifballTeamPlanState => ({
  assignments: new Map(), snapshot: null, signature: '', untilRefresh: 0, revision: 0, teamRefresh: {}, runnerMemory: {}, runnerPlans: {},
});

export function resetGrifballTeamPlan(state: GrifballTeamPlanState): void {
  state.assignments.clear();
  state.snapshot = null;
  state.signature = '';
  state.untilRefresh = 0;
  state.revision = 0;
  state.teamRefresh = {};
  state.runnerMemory = {}; state.runnerPlans = {};
}

const distance = (a: FieldPoint, b: FieldPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const byId = (a: GrifballTacticalPlayer, b: GrifballTacticalPlayer) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const otherTeam = (team: TeamId): TeamId => team === 'blue' ? 'red' : 'blue';

function offset(anchor: FieldPoint, goal: FieldPoint, forward: number, lateral: number): FieldPoint {
  const length = distance(anchor, goal);
  const dx = length > 0.001 ? (goal.x - anchor.x) / length : 1;
  const dz = length > 0.001 ? (goal.z - anchor.z) / length : 0;
  // Do not place a lead beyond the opponent's goal when close to finishing.
  const advance = forward > 0 ? Math.min(forward, length) : forward;
  return { x: anchor.x + dx * advance - dz * lateral, z: anchor.z + dz * advance + dx * lateral };
}

/** Shared, deterministic assignments. Positions are copied by the runtime adapter. */
export function updateGrifballTeamPlan(
  state: GrifballTeamPlanState, snapshot: GrifballTacticalSnapshot, dt: number,
): void {
  const players = [...snapshot.players].sort(byId);
  const signature = JSON.stringify([
    snapshot.round, snapshot.playing, snapshot.holderId, snapshot.goals, snapshot.spacing, snapshot.tactics, snapshot.geometry?.key,
    players.map(p => p.space && [p.space.reach, p.space.blastRadius, p.space.speed, p.space.lungeReach]),
    players.map(p => [p.id, p.team, p.scripted]),
  ]);
  const samePlay = state.snapshot?.round === snapshot.round && state.snapshot?.playing === snapshot.playing && state.snapshot?.holderId === snapshot.holderId;
  const config = snapshot.tactics ?? defaultGrifballTactics();
  const holder = players.find(p => p.id === snapshot.holderId);
  if (!samePlay) { state.runnerMemory = {}; state.runnerPlans = {}; }
  for (const team of ['blue', 'red']) {
    const tuning = resolveTeamTactics(config, team);
    const goal = snapshot.goals[otherTeam(team)];
    if (snapshot.playing && holder?.team === team && holder.space && goal && snapshot.geometry && tuning.enabled && tuning.spaceEnabled && tuning.runnerEnabled) {
      state.runnerMemory[team] = tickRunnerMemory(state.runnerMemory[team], holder, goal, dt);
    } else { delete state.runnerMemory[team]; delete state.runnerPlans[team]; }
  }
  for (const team of ['blue', 'red']) state.teamRefresh[team] = (state.teamRefresh[team] ?? 0) - Math.max(0, dt);
  const changed = signature !== state.signature;
  state.untilRefresh -= Math.max(0, dt);
  // Always refresh observations, but assign roles at 5 Hz or immediately on events.
  state.snapshot = snapshot;
  if (!changed && ['blue', 'red'].every(team => state.teamRefresh[team] > 0)) return;
  const previous = samePlay ? state.assignments : new Map<string, GrifballAssignment>();
  state.signature = signature;
  state.untilRefresh = Math.min(...['blue', 'red'].map(team => resolveTeamTactics(config, team).refreshSeconds));
  state.revision += 1;
  const next = new Map<string, GrifballAssignment>();
  state.assignments = next;
  if (!snapshot.playing) return;

  const routers = snapshot.geometry ? createSnapshotRouters(snapshot) : undefined;
  const evaluateSpace = routers ? createGrifballSpaceEvaluator(snapshot, routers) : undefined;

  for (const team of ['blue', 'red'] as const) {
    const tuning = resolveTeamTactics(config, team);
    if (!tuning.spacingEnabled) {
      for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'spacing') tuning[key as TacticalNumber] = field.value;
    }
    if (!changed && state.teamRefresh[team] > 0) {
      for (const [id, assignment] of previous) if (assignment.team === team) next.set(id, assignment);
      continue;
    }
    state.teamRefresh[team] = tuning.refreshSeconds;
    const spacing = tuning.spacingEnabled ? (snapshot.tactics ? tuning.lateralSpacing : Math.max(1.5, snapshot.spacing)) : 4;
    const goal = snapshot.goals[otherTeam(team)];
    const ownGoal = snapshot.goals[team];
    if (!goal || !ownGoal) continue;
    const teammates = players.filter(p => p.team === team);
    const bots = teammates.filter(p => p.scripted && p.id !== holder?.id);
    const friendly = holder?.team === team;
    const anchor = holder?.pos ?? snapshot.ball;
    const runnerPlay = friendly && state.runnerMemory[team] && routers
      ? planGrifballRunner(snapshot, holder!, tuning, state.runnerMemory[team], routers) : undefined;
    if (runnerPlay) state.runnerPlans[team] = runnerPlay;
    const escortPlanner = runnerPlay && routers ? createRunnerEscortPlanner(snapshot, holder!, runnerPlay, tuning, routers) : undefined;
    const add = (bot: GrifballTacticalPlayer, role: GrifballTeamRole, slot: number, destination: FieldPoint, reason: string) => {
      const assignment: GrifballAssignment = { botId: bot.id, team, role, slot, destination, anchor: { ...anchor }, carrierId: holder?.id ?? null, reason, tuning };
      if (runnerPlay && role === 'runner') {
        assignment.runner = runnerPlay; assignment.destination = { ...runnerPlay.selected.destination };
        assignment.reason = runnerPlay.reason;
      } else if (escortPlanner && slot >= 0) {
        assignment.escort = escortPlanner(bot, role, slot);
        assignment.destination = assignment.escort.destination;
        assignment.reason = `${assignment.escort.kind}: support ${runnerPlay!.selected.action} route`;
      }
      if (tuning.enabled && tuning.spaceEnabled && evaluateSpace) {
        assignment.geometry = snapshot.geometry;
        evaluateSpace(assignment, bot, previous.get(bot.id), !!assignment.escort);
      }
      next.set(bot.id, assignment);
    };
    if (holder?.scripted && friendly) add(holder, 'runner', -1, { ...goal }, 'Carry to the opposing goal');
    if (!tuning.enabled) {
      for (const bot of bots) add(bot, holder ? 'chaser' : 'retriever', -1,
        { ...(friendly ? goal : anchor) }, 'Independent objective fallback: team coordination disabled');
      continue;
    }


    if (!holder && bots.length) {
      const ranked = [...bots].sort((a, b) => distance(a.pos, snapshot.ball) - distance(b.pos, snapshot.ball) || byId(a, b));
      let retriever = ranked[0];
      const incumbent = ranked.find(p => previous.get(p.id)?.role === 'retriever');
      // A small advantage must not cause repeated handoffs between nearby bots.
      if (incumbent && distance(incumbent.pos, snapshot.ball) <= distance(retriever.pos, snapshot.ball) + tuning.reassignmentAdvantage) retriever = incumbent;
      const externalRetriever = teammates.find(p => {
        if (p.scripted) return false;
        const d = distance(p.pos, snapshot.ball);
        const closingSpeed = ((snapshot.ball.x - p.pos.x) * p.vel.x + (snapshot.ball.z - p.pos.z) * p.vel.z) / Math.max(d, 0.001);
        return (d <= 1.5 && p.pickupRequested === true) || (d <= 10 && closingSpeed > 0.5 && d <= distance(retriever.pos, snapshot.ball) + 1);
      });
      if (!externalRetriever) {
        add(retriever, 'retriever', -1, { ...snapshot.ball }, incumbent?.id === retriever.id ? 'Keep the ball recovery assignment' : 'Nearest available ball retriever');
        bots.splice(bots.indexOf(retriever), 1);
      }
    }

    const defending = !!holder && !friendly;
    const remaining = [...bots];
    // Reserve surviving slots first; newcomers fill vacancies, never steal a held slot.
    const slots = new Map<number, GrifballTacticalPlayer>();
    for (const bot of bots) {
      const old = previous.get(bot.id);
      if (tuning.preserveSlots && old && old.slot >= 0 && old.slot < bots.length && !slots.has(old.slot)) {
        slots.set(old.slot, bot);
        remaining.splice(remaining.indexOf(bot), 1);
      }
    }
    for (let slot = 0; slot < bots.length; slot++) {
      const role: GrifballTeamRole = slot === (tuning.safetyFirst ? 0 : 2) ? 'safety' : slot === (tuning.safetyFirst ? 1 : 0) ? (defending ? 'chaser' : 'lead') : 'cover';
      const lateral = (slot % 2 ? -1 : 1) * spacing * Math.ceil(slot / 2);
      let destination = offset(anchor, defending ? ownGoal : goal, role === 'lead' ? (tuning.spacingEnabled ? tuning.leadForward : 6.5) : (tuning.spacingEnabled ? tuning.coverForward : 2.5), role === 'lead' ? 0 : lateral);
      if (role === 'chaser') destination = { ...anchor };
      if (role === 'safety') destination = offset(anchor, ownGoal, Math.min(tuning.spacingEnabled ? tuning.safetyDistance : 10, distance(anchor, ownGoal) * 0.5), 0);
      let bot = slots.get(slot);
      if (!bot) {
        remaining.sort((a, b) => distance(a.pos, destination) - distance(b.pos, destination) || byId(a, b));
        bot = remaining.shift()!;
      }
      add(bot, role, slot, destination, defending ? 'Pressure with goal-side coverage' : holder ? 'Protect the carrier and preserve recovery coverage' : 'Screen the pickup and cover a turnover');
    }
  }
}

/** Combat is allowed near the assigned area, or for immediate self defense. */
export function selectGrifballAssignmentThreat(
  assignment: GrifballAssignment, self: FieldPoint, players: GrifballTacticalPlayer[],
): string | null {
  if (assignment.role === 'runner' || assignment.role === 'retriever') return null;
  const escortTarget = assignment.escort?.targetId;
  if (escortTarget) {
    const target = players.find(p => p.id === escortTarget && p.team !== assignment.team);
    if (target && distance(self, target.pos) <= (assignment.tuning?.engagementDistance ?? 6) &&
      distance(self, assignment.destination) <= (assignment.tuning?.coverageBoundary ?? 9) &&
      (!assignment.geometry || isSpaceSegmentOpen(assignment.geometry, self, target.pos))) return target.id;
  }
  const candidates = players.filter(p => {
    if (p.team === assignment.team) return false;
    if (assignment.geometry && !isSpaceSegmentOpen(assignment.geometry, self, p.pos)) return false;
    const nearSelf = distance(self, p.pos);
    if (nearSelf <= (assignment.space ? Math.max(2.5, p.space?.reach ?? 2.5) : 2.5)) return true;
    if (assignment.escort) return false;
    if (nearSelf > (assignment.tuning?.engagementDistance ?? 6) || distance(self, assignment.destination) > (assignment.tuning?.coverageBoundary ?? 9)) return false;
    return distance(p.pos, assignment.destination) <= 8 ||
      (assignment.role !== 'safety' && distance(p.pos, assignment.anchor) <= 7);
  });
  candidates.sort((a, b) => {
    const score = (p: GrifballTacticalPlayer) => assignment.space && p.space
      ? estimateSpaceAttackTime(p, self, distance(p.pos, self)) - (p.id === assignment.carrierId ? 0.75 : 0)
      : distance(p.pos, assignment.destination) + distance(p.pos, self) - (p.id === assignment.carrierId ? 4 : 0);
    return score(a) - score(b) || byId(a, b);
  });
  return candidates[0]?.id ?? null;
}
