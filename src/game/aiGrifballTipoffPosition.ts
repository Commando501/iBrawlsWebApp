import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import type { SpaceRouters } from './aiGrifballRunner';
import { fieldDistance as distance } from './grifballSpaceGeometry';
import {
  assessGrifballSupportPosition,
  supportRouteClearance,
  type SupportPositionAssessment,
} from './aiGrifballSupportPosition';
import {
  GRIFBALL_TIPOFF_POSITION_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface TipoffPositionDecision extends Omit<SupportPositionAssessment, 'rejection'> {
  style: GrifballPlayerStyle;
  strength: number;
  collectorId: string;
  applied: boolean;
  reason: string;
  teamPoint: FieldPoint;
  preferredPoint: FieldPoint;
  teamClearance: number;
  preferredClearance: number;
}

/** Personal lanes are considered after pickup, reserve and combat jobs are final.
 * Only passive lateral jobs may move; each accepted lane becomes a reservation. */
export function applyGrifballTipoffPosition(
  snapshot: GrifballTacticalSnapshot,
  assignments: GrifballAssignment[],
  tuning: TeamTactics,
  routers: SpaceRouters,
  contain: boolean,
): void {
  const strength = tuning.tipoffPositionAgencyStrength;
  if (
    !strength ||
    !tuning.tipoffEnabled ||
    !tuning.enabled ||
    !tuning.spaceEnabled ||
    !snapshot.playing ||
    snapshot.holderId ||
    !snapshot.geometry
  )
    return;
  const team = assignments[0]?.team,
    goal = snapshot.goals[team];
  if (!goal) return;
  const anchor = snapshot.ball,
    goalDistance = distance(anchor, goal);
  const dx = (goal.x - anchor.x) / Math.max(0.001, goalDistance),
    dz = (goal.z - anchor.z) / Math.max(0.001, goalDistance);
  for (const a of [...assignments].sort((a, b) => a.botId.localeCompare(b.botId))) {
    const order = a.tipoff,
      bot = snapshot.players.find((p) => p.id === a.botId && p.team === team && p.scripted);
    if (!bot || !order || !['screen', 'support'].includes(order.job)) continue;
    const collector = snapshot.players.find((p) => p.id === order.collectorId && p.team === team);
    const reserve = snapshot.players.find((p) => p.id === order.reserveId && p.team === team);
    const route = collector && routers.get(collector.id)?.(anchor);
    const path = collector && route && route.status !== 'blocked' ? [collector.pos, ...route.points] : undefined;
    const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, a.botId),
      preference = GRIFBALL_TIPOFF_POSITION_PREFERENCES[style];
    const teamPoint = { ...a.destination };
    const depth = (teamPoint.x - anchor.x) * dx + (teamPoint.z - anchor.z) * dz + preference.depth * strength;
    const lateral = -dz * (teamPoint.x - anchor.x) + dx * (teamPoint.z - anchor.z);
    const width = lateral + Math.sign(lateral) * preference.width * strength;
    const preferredPoint = { x: anchor.x + dx * depth - dz * width, z: anchor.z + dz * depth + dx * width };
    const { rejection, ...estimates } = assessGrifballSupportPosition({
      snapshot,
      botId: bot.id,
      tuning: { ...tuning, separation: order.spacing },
      routers,
      teamPoint,
      preferredPoint,
      reserved: [
        ...assignments.filter((other) => other !== a).map((other) => other.destination),
        ...snapshot.players.filter((p) => p.team === team && !p.scripted).map((p) => p.pos),
      ],
    });
    const teamClearance = path ? supportRouteClearance(teamPoint, path) : 0;
    const preferredClearance = path ? supportRouteClearance(preferredPoint, path) : 0;
    const reason =
      order.phase === 'regroup'
        ? 'Opening regrouping keeps the recovery lane.'
        : contain || order.phase === 'contain'
          ? 'Opening containment keeps the team lane.'
          : order.attack
            ? 'An earned screen challenge keeps its exact combat position.'
            : !reserve ||
                !reserve.space ||
                (reserve.height ?? 0) > 0.01 ||
                reserve.space.mobileIn > 0 ||
                reserve.space.phase === 'lunging'
              ? 'No available rear reserve; keep the team lane.'
              : !collector ||
                  !collector.space ||
                  (collector.height ?? 0) > 0.01 ||
                  collector.space.mobileIn > 0 ||
                  collector.space.phase === 'lunging' ||
                  !path
                ? 'No available collector route; keep the team lane.'
                : !preference.depth && !preference.width
                  ? preference.reason
                  : !bot.space || bot.space.phase !== 'ready' || bot.space.mobileIn > 0
                    ? 'A committed combat action keeps the team lane.'
                    : depth <= 0 || depth >= goalDistance || Math.abs(lateral) < 0.01
                      ? 'Keep the opening lane on its original goal-side flank.'
                      : preferredClearance + 1e-9 < Math.min(order.spacing, teamClearance)
                        ? 'Preferred lane crowds the collector route; keep the team lane.'
                        : rejection;
    const applied = !reason && distance(teamPoint, preferredPoint) > 1e-9;
    order.positioning = {
      style,
      strength,
      collectorId: order.collectorId,
      applied,
      reason: reason ?? preference.reason,
      teamPoint,
      preferredPoint,
      teamClearance,
      preferredClearance,
      ...estimates,
    };
    if (applied) a.destination = { ...preferredPoint };
    a.reason += `; ${order.positioning.reason}`;
  }
}
