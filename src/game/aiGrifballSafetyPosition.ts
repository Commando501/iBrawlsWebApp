import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { fieldDistance as distance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { assessGrifballSupportPosition, type SupportPositionAssessment } from './aiGrifballSupportPosition';
import {
  GRIFBALL_SAFETY_POSITION_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface SafetyPositionDecision extends Omit<SupportPositionAssessment, 'rejection'> {
  style: GrifballPlayerStyle;
  strength: number;
  applied: boolean;
  reason: string;
  teamPoint: FieldPoint;
  preferredPoint: FieldPoint;
  shadeTargetId: string | null;
  cutPoint: FieldPoint | null;
  carrierETA: number;
  teamReady: number;
  preferredReady: number;
}

/** Project the TEAM safety point onto every segment of the actual ground route.
 * Both positions must cover this same cut, including on routes with bends. */
function routeCut(point: FieldPoint, path: FieldPoint[]) {
  let best: { point: FieldPoint; travel: number; clearance: number } | undefined;
  let travel = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const length = distance(a, b);
    if (length <= 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length)));
    const cut = { x: a.x + dx * t, z: a.z + dz * t },
      clearance = distance(point, cut);
    if (!best || clearance < best.clearance - 1e-9) best = { point: cut, travel: travel + t * length, clearance };
    travel += length;
  }
  return best;
}

/** Vary only an ordinary last-defender position after every defensive job is
 * reserved. A held cut or the timed backup for an earned tank remains exact. */
export function applyGrifballSafetyPosition(
  snapshot: GrifballTacticalSnapshot,
  assignments: GrifballAssignment[],
  tuning: TeamTactics,
  routers: SpaceRouters,
  contain: boolean,
  protectedCut: boolean,
): void {
  const strength = tuning.safetyAgencyStrength;
  if (!strength || !tuning.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !snapshot.playing || !snapshot.geometry)
    return;
  const a = assignments.find((a) => a.defense?.mode === 'last-defender');
  const carrier = snapshot.players.find((p) => p.id === snapshot.holderId);
  const bot = snapshot.players.find((p) => p.id === a?.botId && p.scripted);
  if (!a || !bot || !carrier || carrier.team === a.team || !snapshot.goals[a.team] || a.tanking || a.receive || a.escort) return;
  const order = a.defense!,
    goal = snapshot.goals[a.team],
    teamPoint = { ...a.destination };
  const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, a.botId),
    preference = GRIFBALL_SAFETY_POSITION_PREFERENCES[style];
  const d = distance(carrier.pos, goal),
    dx = (goal.x - carrier.pos.x) / Math.max(0.001, d),
    dz = (goal.z - carrier.pos.z) / Math.max(0.001, d);
  const threat = snapshot.players
    .filter((p) => p.team !== a.team && p !== carrier && distance(p.pos, carrier.pos) <= 18)
    .sort((p, q) => distance(p.pos, goal) - distance(q.pos, goal) || p.id.localeCompare(q.id))[0];
  const side = threat ? Math.sign(-dz * (threat.pos.x - teamPoint.x) + dx * (threat.pos.z - teamPoint.z)) : 0;
  const preferredPoint = {
    x: teamPoint.x + dx * preference.depth * strength - dz * side * preference.width * strength,
    z: teamPoint.z + dz * preference.depth * strength + dx * side * preference.width * strength,
  };
  const { rejection, ...estimates } = assessGrifballSupportPosition({
    snapshot,
    botId: bot.id,
    tuning,
    routers,
    teamPoint,
    preferredPoint,
    reserved: [
      ...assignments.filter((other) => other !== a).map((other) => other.destination),
      ...snapshot.players.filter((p) => p.team === a.team && !p.scripted).map((p) => p.pos),
    ],
  });
  const route = routers.get(carrier.id)?.(goal);
  const cut = route && route.status !== 'blocked' ? routeCut(teamPoint, [carrier.pos, ...route.points]) : undefined;
  const carrierETA = cut ? cut.travel / Math.max(0.1, carrier.space?.speed ?? 5.8) : Infinity;
  // Require stationary melee coverage: no speculative lunge, blast extension,
  // or movement from the personal position may be needed to reach the cut.
  const ready = (point: FieldPoint, arrival: number) =>
    cut &&
    bot.space &&
    distance(point, cut.point) <= bot.space.reach + 1e-9 &&
    isSpaceSegmentOpen(snapshot.geometry!, point, cut.point)
      ? arrival + Math.max(0, bot.space.attackIn)
      : Infinity;
  const teamReady = ready(teamPoint, estimates.teamArrival),
    preferredReady = ready(preferredPoint, estimates.preferredArrival);
  const depth = (preferredPoint.x - carrier.pos.x) * dx + (preferredPoint.z - carrier.pos.z) * dz;
  const reason = order.emergency
    ? 'Goal emergency keeps the team last-defender position.'
    : contain || order.transitioning
      ? 'Team containment and turnover recovery keep the team last-defender position.'
      : protectedCut
        ? 'A held interception or earned tank backup keeps its exact team position.'
        : assignments.length < 2
          ? 'A lone defender keeps the team goal-side position.'
          : !preference.depth && !preference.width
            ? preference.reason
            : preference.width && !side
              ? 'No nearby escort flank to shade; keep the team position.'
              : (bot.space?.mobileIn ?? 0) > 0
                ? 'Committed movement keeps the team last-defender position.'
                : depth <= 0 || depth >= d
                  ? 'Preferred position leaves the goal-side coverage line; keep the team position.'
                  : !cut || cut.travel <= 0.01 || distance(cut.point, goal) <= 0.01
                    ? 'No ground-route cut before the goal; keep the team position.'
                    : !Number.isFinite(teamReady) || !Number.isFinite(preferredReady)
                      ? 'A blocked or out-of-reach response to the same runner cut keeps the team position.'
                      : teamReady > carrierETA || preferredReady > carrierETA
                        ? 'Cannot be ready before the runner reaches the same cut; keep the team position.'
                        : rejection;
  const applied = !reason && distance(teamPoint, preferredPoint) > 1e-9;
  order.safetyPosition = {
    style,
    strength,
    applied,
    reason: reason ?? preference.reason,
    teamPoint,
    preferredPoint,
    shadeTargetId: preference.width && side ? threat!.id : null,
    cutPoint: cut?.point ?? null,
    carrierETA,
    teamReady,
    preferredReady,
    ...estimates,
  };
  if (applied) {
    a.destination = { ...preferredPoint };
    order.intercept = { ...preferredPoint };
    order.arrivalETA = estimateSpaceAttackTime(bot, preferredPoint, routers.get(bot.id)!(preferredPoint, true).length);
  }
  a.reason += `; ${order.safetyPosition.reason}`;
}
