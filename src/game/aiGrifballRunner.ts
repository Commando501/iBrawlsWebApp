import { chooseTacticalAlternative, type TacticalChoice } from './aiGrifballStyle';
import type { FieldPoint, GrifballTacticalPlayer, GrifballTacticalSnapshot, GrifballTeamRole } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { createSpaceRouter, createSpaceRouterFactory, fieldDistance, isSpaceSegmentOpen, type SpaceRoute } from './grifballSpaceGeometry';

export type RunnerAction = 'advance' | 'cut-left' | 'cut-right' | 'wait' | 'retreat' | 'finish' | 'observed';
export interface RunnerCandidate {
  action: RunnerAction; destination: FieldPoint; route: SpaceRoute;
  score: number; risk: number; supportETA: number; progress: number;
}
export interface RunnerPlan {
  carrierId: string; origin: FieldPoint; heading: FieldPoint;
  selected: RunnerCandidate; candidates: RunnerCandidate[];
  reason: string; forcedProgress: boolean; waitUsed: number; stalledSeconds: number;
}
export interface RunnerMemory {
  carrierId: string; bestGoalDistance: number; stalledSeconds: number;
  waitUsed: number; retreatUsed: number; commitRemaining: number;
  previous: RunnerCandidate | null;
}
export interface EscortOrder {
  kind: 'screen' | 'intercept' | 'rear-guard'; targetId: string | null;
  destination: FieldPoint; routePoint: FieldPoint;
}
export type SpaceRouters = Map<string, ReturnType<typeof createSpaceRouter>>;
export function createSnapshotRouters(snapshot: GrifballTacticalSnapshot): SpaceRouters {
  const createRouter = createSpaceRouterFactory(snapshot.geometry!);
  return new Map(snapshot.players.map(p => [p.id, createRouter(p.pos)]));
}

export function tickRunnerMemory(memory: RunnerMemory | undefined, carrier: GrifballTacticalPlayer, goal: FieldPoint, dt: number): RunnerMemory {
  const distance = fieldDistance(carrier.pos, goal);
  if (!memory || memory.carrierId !== carrier.id) return { carrierId: carrier.id, bestGoalDistance: distance, stalledSeconds: 0, waitUsed: 0, retreatUsed: 0, commitRemaining: 0, previous: null };
  const elapsed = Math.max(0, dt);
  memory.commitRemaining = Math.max(0, memory.commitRemaining - elapsed);
  memory.stalledSeconds += elapsed;
  if (memory.previous?.action === 'wait') memory.waitUsed += elapsed;
  if (memory.previous?.action === 'retreat') memory.retreatUsed += elapsed;
  // Only real net progress replenishes patience; shuffling/retreating cannot reset the timeout.
  if (distance < memory.bestGoalDistance - 1.5) {
    memory.bestGoalDistance = distance; memory.stalledSeconds = 0; memory.waitUsed = 0; memory.retreatUsed = 0;
  }
  return memory;
}

const direction = (from: FieldPoint, to: FieldPoint): FieldPoint => {
  const d = fieldDistance(from, to);
  return d > 0.001 ? { x: (to.x - from.x) / d, z: (to.z - from.z) / d } : { x: 1, z: 0 };
};
const offset = (p: FieldPoint, heading: FieldPoint, forward: number, lateral = 0): FieldPoint => ({ x: p.x + heading.x * forward - heading.z * lateral, z: p.z + heading.z * forward + heading.x * lateral });
export function pointAlongRunnerRoute(start: FieldPoint, route: SpaceRoute, distance: number): FieldPoint {
  let from = start;
  for (const point of route.points) {
    const segment = fieldDistance(from, point);
    if (segment >= distance) return offset(from, direction(from, point), distance);
    distance -= segment; from = point;
  }
  return { ...from };
}

export function planGrifballRunner(snapshot: GrifballTacticalSnapshot, carrier: GrifballTacticalPlayer, tuning: TeamTactics, memory: RunnerMemory, routers: SpaceRouters, choice?: TacticalChoice): RunnerPlan {
  const geometry = snapshot.geometry!, goal = snapshot.goals[carrier.team === 'blue' ? 'red' : 'blue']!;
  const router = routers.get(carrier.id)!, goalDistance = fieldDistance(carrier.pos, goal);
  const goalHeading = direction(carrier.pos, goal), speed = Math.max(0.1, carrier.space!.speed);
  const allies = snapshot.players.filter(p => p.team === carrier.team && p.id !== carrier.id);
  const enemies = snapshot.players.filter(p => p.team !== carrier.team);
  const forcedProgress = memory.stalledSeconds >= tuning.runnerProgressTimeout;
  const evaluate = (action: RunnerAction, destination: FieldPoint): RunnerCandidate => {
    const route = router(destination), progress = goalDistance - fieldDistance(destination, goal);
    let risk = 0, supportETA = Infinity;
    if (route.status === 'blocked') return { action, destination, route, progress, risk: 1, supportETA, score: -Infinity };
    for (const fraction of [0.25, 0.6, 1]) {
      const point = pointAlongRunnerRoute(carrier.pos, route, route.length * fraction);
      const arrival = route.length * fraction / speed;
      let enemyETA = Infinity, allyETA = Infinity;
      for (const enemy of enemies) enemyETA = Math.min(enemyETA, estimateSpaceAttackTime(enemy, point, routers.get(enemy.id)!(point, true).length));
      for (const ally of allies) allyETA = Math.min(allyETA, estimateSpaceAttackTime(ally, point, routers.get(ally.id)!(point, true).length));
      supportETA = Math.min(supportETA, allyETA);
      const exposure = Math.max(0, Math.min(1, (arrival + tuning.runnerDangerMargin - enemyETA) / Math.max(0.25, tuning.runnerDangerMargin)));
      // Coverage reduces risk, but an escort is never assumed to win its fight.
      risk = Math.max(risk, exposure * (allyETA <= arrival + 0.25 ? 0.55 : 1));
    }
    const score = route.length > tuning.runnerLookahead * 1.75 ? -Infinity : progress * tuning.runnerProgressWeight - risk * tuning.runnerRiskWeight - route.length * 0.08;
    return { action, destination: { ...destination }, route, progress, risk, supportETA, score };
  };

  // A human/neural carrier supplies observed motion, never receives movement orders.
  if (!carrier.scripted) {
    const moving = Math.hypot(carrier.vel.x, carrier.vel.z) > 0.25;
    const heading = moving ? direction({ x: 0, z: 0 }, carrier.vel) : carrier.heading ?? goalHeading;
    let destination = offset(carrier.pos, heading, moving ? Math.min(tuning.runnerLookahead, Math.hypot(carrier.vel.x, carrier.vel.z) * 0.8) : tuning.runnerLookahead * 0.5);
    for (let i = 0; i < 5 && !isSpaceSegmentOpen(geometry, carrier.pos, destination); i++) destination = { x: (destination.x + carrier.pos.x) / 2, z: (destination.z + carrier.pos.z) / 2 };
    const selected = evaluate('observed', destination);
    return { carrierId: carrier.id, origin: { ...carrier.pos }, heading, selected, candidates: [selected], reason: moving ? 'Escort observed carrier velocity' : 'Screen observed carrier heading', forcedProgress: false, waitUsed: 0, stalledSeconds: 0 };
  }

  const goalRoute = router(goal);
  const advance = goalRoute.status === 'blocked' ? offset(carrier.pos, goalHeading, Math.min(goalDistance, tuning.runnerLookahead)) : pointAlongRunnerRoute(carrier.pos, goalRoute, tuning.runnerLookahead);
  const candidates = [
    evaluate('advance', advance),
    evaluate('cut-left', offset(carrier.pos, goalHeading, Math.min(goalDistance, tuning.runnerLookahead * 0.7), tuning.runnerCutWidth)),
    evaluate('cut-right', offset(carrier.pos, goalHeading, Math.min(goalDistance, tuning.runnerLookahead * 0.7), -tuning.runnerCutWidth)),
    evaluate('wait', carrier.pos),
    evaluate('retreat', offset(carrier.pos, goalHeading, -Math.min(3, tuning.runnerLookahead * 0.5))),
  ];
  if (goalDistance <= tuning.runnerFinishDistance) candidates.push(evaluate('finish', goal));
  const moving = candidates.filter(c => !['wait', 'retreat'].includes(c.action) && Number.isFinite(c.score));
  const lowestRisk = Math.min(...moving.map(c => c.risk));
  for (const c of candidates) {
    if (c.action === 'wait') {
      const coverageComing = allies.some(p => p.scripted && fieldDistance(p.pos, carrier.pos) > 2 && fieldDistance(p.pos, carrier.pos) / Math.max(0.1, p.space?.speed ?? 0.1) <= tuning.runnerMaxWait);
      // Waiting is a short coverage rendezvous, never the default when alone or fully covered.
      c.score = !forcedProgress && memory.waitUsed < tuning.runnerMaxWait && coverageComing && lowestRisk >= 0.75 && c.risk < 1 ? 1 - c.risk * tuning.runnerRiskWeight : -Infinity;
    }
    if (c.action === 'retreat' && (forcedProgress || memory.retreatUsed >= tuning.runnerMaxWait || lowestRisk < tuning.runnerRetreatRisk)) c.score = -Infinity;
    if (c.action === 'finish' && c.route.status !== 'blocked') c.score += 3;
  }
  let selected = candidates.reduce((best, c) => c.score > best.score ? c : best);
  const optimum = selected;
  if (!forcedProgress && !['finish', 'wait', 'retreat'].includes(selected.action)) {
    selected = chooseTacticalAlternative(candidates.filter(c => ['advance', 'cut-left', 'cut-right'].includes(c.action) && c.progress > 0 && c.risk <= optimum.risk + 0.05), c => c.score, c => c.action, choice) ?? selected;
  }
  if (forcedProgress) selected = candidates.find(c => c.action === 'finish' && Number.isFinite(c.score)) ?? candidates.find(c => c.action === 'advance' && Number.isFinite(c.score)) ?? selected;
  let reason = forcedProgress ? 'Progress timeout: take the reachable forward route' : `Choose ${selected.action} for progress and coverage`;
  const previous = memory.previous;
  if (!forcedProgress && previous && previous.action !== 'observed' && fieldDistance(carrier.pos, previous.destination) > 0.7 && !['wait', 'retreat'].includes(previous.action)) {
    const incumbent = evaluate(previous.action, previous.destination);
    const urgent = selected.action === 'finish' || incumbent.risk >= tuning.runnerRetreatRisk && selected.risk + 0.25 < incumbent.risk;
    if (!urgent && Number.isFinite(incumbent.score) && (memory.commitRemaining > 0 || selected.score < incumbent.score + tuning.runnerSwitchAdvantage)) {
      selected = incumbent; candidates.push(incumbent); reason = 'Keep the committed route';
    }
  }
  if (selected !== optimum && selected !== memory.previous && reason.startsWith('Choose')) reason += ' (seeded near-equal alternative)';
  if (selected.route.status === 'blocked') reason = 'No reachable runner route; keep explicit blocked status';
  if (!previous || selected.action !== previous.action || fieldDistance(selected.destination, previous.destination) > 0.1) memory.commitRemaining = tuning.runnerCommitSeconds;
  memory.previous = selected;
  const heading = selected.route.points.length && selected.route.length > 0.1 ? direction(carrier.pos, selected.route.points[0]) : goalHeading;
  return { carrierId: carrier.id, origin: { ...carrier.pos }, heading, selected, candidates, reason, forcedProgress, waitUsed: memory.waitUsed, stalledSeconds: memory.stalledSeconds };
}

/** Allocate distinct threats to escorts; combat execution still owns how to attack. */
export function createRunnerEscortPlanner(snapshot: GrifballTacticalSnapshot, carrier: GrifballTacticalPlayer, play: RunnerPlan, tuning: TeamTactics, routers: SpaceRouters) {
  const usedThreats = new Set<string>();
  const heading = play.heading;
  const ahead = pointAlongRunnerRoute(carrier.pos, play.selected.route, Math.min(tuning.escortLeadDistance, play.selected.route.length));
  const supportCount = snapshot.players.filter(p => p.team === carrier.team && p.id !== carrier.id && p.scripted).length;
  const fallbackRearSlot = !tuning.safetyFirst && supportCount < 3 ? supportCount - 1 : -1;
  const rearPressure = snapshot.players.some(p => p.team !== carrier.team &&
    (p.pos.x - carrier.pos.x) * heading.x + (p.pos.z - carrier.pos.z) * heading.z < 0 &&
    estimateSpaceAttackTime(p, carrier.pos, routers.get(p.id)!(carrier.pos, true).length) <= tuning.threatHorizon + 1);
  return (bot: GrifballTacticalPlayer, role: GrifballTeamRole, slot: number): EscortOrder => {
    // Short-handed teams may have no safety slot; the last escort covers live rear pursuit.
    const rear = role === 'safety' || slot === fallbackRearSlot && rearPressure;
    const routePoint = rear ? offset(carrier.pos, heading, -tuning.escortRearDistance) : ahead;
    const threats = snapshot.players.filter(p => p.team !== carrier.team && !usedThreats.has(p.id)).map(p => {
      const forward = (p.pos.x - carrier.pos.x) * heading.x + (p.pos.z - carrier.pos.z) * heading.z;
      const eta = estimateSpaceAttackTime(p, rear ? carrier.pos : ahead, routers.get(p.id)!(rear ? carrier.pos : ahead, true).length);
      return { p, forward, eta };
    }).filter(t => t.eta <= tuning.threatHorizon + 1 && (rear ? t.forward < 0 : t.forward >= -1))
      .sort((a, b) => a.eta - b.eta || a.p.id.localeCompare(b.p.id));
    const target = threats[0]?.p;
    let side = slot % 2 ? -1 : 1;
    if (target) side = ((target.pos.x - routePoint.x) * -heading.z + (target.pos.z - routePoint.z) * heading.x) < 0 ? -1 : 1;
    const desired = target ? offset(routePoint, direction(routePoint, target.pos), tuning.escortLaneWidth) : offset(routePoint, heading, 0, side * tuning.escortLaneWidth);
    // Keep the carrier's corridor clear even when a threat is directly on its centerline.
    const lateral = (desired.x - carrier.pos.x) * -heading.z + (desired.z - carrier.pos.z) * heading.x;
    if (!rear && Math.abs(lateral) < tuning.escortLaneWidth) {
      desired.x += -heading.z * (side * tuning.escortLaneWidth - lateral);
      desired.z += heading.x * (side * tuning.escortLaneWidth - lateral);
    }
    const alternatives = [desired, offset(routePoint, heading, 0, -side * tuning.escortLaneWidth), routePoint, bot.pos];
    const destination = alternatives.find(p => routers.get(bot.id)!(p).status !== 'blocked') ?? bot.pos;
    if (target) usedThreats.add(target.id);
    return { kind: rear ? 'rear-guard' : target ? 'intercept' : 'screen', targetId: target?.id ?? null, destination: { ...destination }, routePoint: { ...routePoint } };
  };
}
