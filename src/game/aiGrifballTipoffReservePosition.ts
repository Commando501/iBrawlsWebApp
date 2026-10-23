import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import type { SpaceRouters } from './aiGrifballRunner';
import { fieldDistance as distance } from './grifballSpaceGeometry';
import { isTipoffReserveCovering } from './aiGrifballTipoffReserve';
import {
  assessGrifballSupportPosition,
  supportRouteClearance,
  type SupportPositionAssessment,
} from './aiGrifballSupportPosition';
import {
  GRIFBALL_TIPOFF_RESERVE_POSITION_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface TipoffReservePositionDecision extends Omit<SupportPositionAssessment, 'rejection'> {
  style: GrifballPlayerStyle;
  strength: number;
  applied: boolean;
  reason: string;
  teamPoint: FieldPoint;
  preferredPoint: FieldPoint;
  teamClearance: number;
  preferredClearance: number;
  routeCovered: boolean;
}

/** Only a reserve already in coverage may vary its position. The original rear
 * lane remains authoritative for selection and live combat permission. */
export function applyGrifballTipoffReservePosition(
  snapshot: GrifballTacticalSnapshot,
  assignments: GrifballAssignment[],
  tuning: TeamTactics,
  routers: SpaceRouters,
  contain: boolean,
): void {
  const strength = tuning.tipoffReservePositionAgencyStrength;
  if (
    !strength ||
    !tuning.tipoffEnabled ||
    !tuning.tipoffReserveHandoffEnabled ||
    !tuning.enabled ||
    !tuning.spaceEnabled ||
    !snapshot.playing ||
    snapshot.holderId ||
    !snapshot.geometry
  )
    return;
  const a = assignments.find((a) => a.tipoff?.job === 'reserve');
  const bot = snapshot.players.find((p) => p.id === a?.botId && p.scripted);
  const coverage = a?.tipoff?.reserveSelection;
  if (!a || !bot || !coverage || coverage.selectedId !== bot.id) return;
  const order = a.tipoff!,
    goal = snapshot.goals[a.team],
    anchor = snapshot.ball;
  if (!goal) return;
  const teamPoint = { ...a.destination },
    goalDistance = distance(anchor, goal);
  const dx = (goal.x - anchor.x) / Math.max(0.001, goalDistance),
    dz = (goal.z - anchor.z) / Math.max(0.001, goalDistance);
  const lateral = (p: FieldPoint) => -dz * (p.x - anchor.x) + dx * (p.z - anchor.z);
  const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, bot.id);
  const preference = GRIFBALL_TIPOFF_RESERVE_POSITION_PREFERENCES[style];
  // Keep an existing flank. From the center, shade a visibly occupied opening
  // flank, with stable ID ordering for equal distances; no arbitrary side flip.
  const flank = snapshot.players
    .filter((p) => p.team !== a.team && distance(p.pos, anchor) <= 18 && Math.abs(lateral(p.pos)) > 0.1)
    .sort((p, q) => distance(p.pos, anchor) - distance(q.pos, anchor) || p.id.localeCompare(q.id))[0];
  const side =
    Math.abs(lateral(bot.pos)) > 0.1 ? Math.sign(lateral(bot.pos)) : flank ? Math.sign(lateral(flank.pos)) : 0;
  const preferredPoint = {
    x: teamPoint.x + dx * preference.depth * strength - dz * side * preference.width * strength,
    z: teamPoint.z + dz * preference.depth * strength + dx * side * preference.width * strength,
  };
  const { rejection, ...estimates } = assessGrifballSupportPosition({
    snapshot,
    botId: bot.id,
    tuning: { ...tuning, separation: order.spacing },
    routers,
    teamPoint,
    preferredPoint,
    reserved: [
      ...assignments.filter((other) => other !== a).map((other) => other.destination),
      ...snapshot.players.filter((p) => p.team === a.team && p.id !== bot.id).map((p) => p.pos),
    ],
  });
  const collector = snapshot.players.find((p) => p.id === order.collectorId && p.team === a.team);
  const collectorRoute = collector && routers.get(collector.id)?.(anchor);
  const path =
    collector && collectorRoute && collectorRoute.status !== 'blocked'
      ? [collector.pos, ...collectorRoute.points]
      : undefined;
  const teamClearance = path ? supportRouteClearance(teamPoint, path) : 0;
  const preferredClearance = path ? supportRouteClearance(preferredPoint, path) : 0;
  const route = routers.get(bot.id)?.(preferredPoint);
  // The coverage strip intersected with the goal-side half-plane is convex:
  // checking every waypoint protects every straight segment of the ground route.
  const routeCovered =
    !!route &&
    route.status !== 'blocked' &&
    [bot.pos, ...route.points].every(
      (pos) =>
        isTipoffReserveCovering({ ...bot, pos }, anchor, coverage.point, coverage.halfWidth) &&
        (pos.x - anchor.x) * dx + (pos.z - anchor.z) * dz < goalDistance,
    );
  const reason =
    order.phase === 'regroup' || contain || order.phase === 'contain'
      ? 'Regrouping or containment keeps the team rear position.'
      : !coverage.covered || !isTipoffReserveCovering(bot, anchor, coverage.point, coverage.halfWidth)
        ? 'Reach ready rear coverage before applying a personal position.'
        : assignments.some((other) => other.tipoff?.attack)
          ? 'An earned screen challenge keeps its reserve backup position.'
          : !preference.depth && !preference.width
            ? preference.reason
            : preference.width && !side
              ? 'No occupied opening flank to shade; keep the center reserve position.'
              : !routeCovered
                ? 'The preferred ground route leaves ready rear coverage; keep the team position.'
                : !path
                  ? 'No reachable collector route; keep the team rear position.'
                  : preferredClearance + 1e-9 < Math.min(order.spacing, teamClearance)
                    ? 'The preferred rear position crowds the collector route; keep the team position.'
                    : rejection;
  const applied = !reason && distance(teamPoint, preferredPoint) > 1e-9;
  order.reservePosition = {
    style,
    strength,
    applied,
    reason: reason ?? preference.reason,
    teamPoint,
    preferredPoint,
    teamClearance,
    preferredClearance,
    routeCovered,
    ...estimates,
  };
  if (applied) a.destination = { ...preferredPoint };
  a.reason += `; ${order.reservePosition.reason}`;
}
