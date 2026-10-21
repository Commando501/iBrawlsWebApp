import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { GRIFBALL_MARK_POSITION_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { assessGrifballSupportPosition, type SupportPositionAssessment } from './aiGrifballSupportPosition';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance as distance, isSpaceSegmentOpen } from './grifballSpaceGeometry';

export interface MarkPositionDecision extends Omit<SupportPositionAssessment, 'rejection'> {
  style: GrifballPlayerStyle;
  strength: number;
  applied: boolean;
  reason: string;
  teamPoint: FieldPoint;
  preferredPoint: FieldPoint;
  teamResponse: number;
  preferredResponse: number;
}

/** Run after all defensive jobs are reserved. Only escort marks may vary their
 * position; the interception, safety and target pairing remain team decisions. */
export function applyGrifballMarkPosition(
  snapshot: GrifballTacticalSnapshot,
  assignments: GrifballAssignment[],
  tuning: TeamTactics,
  routers: SpaceRouters,
  contain: boolean,
): void {
  const strength = tuning.markAgencyStrength;
  if (!strength || !tuning.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !snapshot.playing || !snapshot.geometry)
    return;
  const carrier = snapshot.players.find((p) => p.id === snapshot.holderId);
  if (!carrier || carrier.team === assignments[0]?.team) return;
  for (const a of [...assignments].sort((a, b) => a.botId.localeCompare(b.botId))) {
    const order = a.defense,
      bot = snapshot.players.find((p) => p.id === a.botId);
    const target = snapshot.players.find((p) => p.id === order?.targetId && p.team !== a.team);
    const goal = snapshot.goals[a.team];
    if (order?.mode !== 'mark' || !bot?.scripted || !target || target === carrier || !goal || a.receive || a.tanking) continue;
    const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, a.botId),
      preference = GRIFBALL_MARK_POSITION_PREFERENCES[style];
    const teamPoint = { ...a.destination },
      d = distance(target.pos, goal);
    const dx = (goal.x - target.pos.x) / Math.max(0.001, d),
      dz = (goal.z - target.pos.z) / Math.max(0.001, d);
    // Widen away from the carrier's corridor, using a stable slot only on its centerline.
    const lateral = (target.pos.x - carrier.pos.x) * -dz + (target.pos.z - carrier.pos.z) * dx;
    const side = Math.abs(lateral) > 1e-9 ? Math.sign(lateral) : a.slot % 2 ? -1 : 1;
    const depth = Math.min(
      d,
      Math.max((target.space?.reach ?? 3) + 0.25, distance(target.pos, teamPoint) + preference.depth * strength),
    );
    const width = preference.width * strength * side;
    const preferredPoint = { x: target.pos.x + dx * depth - dz * width, z: target.pos.z + dz * depth + dx * width };
    const { rejection, ...estimates } = assessGrifballSupportPosition({
      snapshot,
      botId: a.botId,
      tuning,
      routers,
      teamPoint,
      preferredPoint,
      reserved: assignments.filter((other) => other !== a).map((other) => other.destination),
    });
    // A wider/deeper mark must still be able to respond to its own opponent.
    const response = (point: FieldPoint) =>
      isSpaceSegmentOpen(snapshot.geometry!, point, target.pos)
        ? estimateSpaceAttackTime({ ...bot, pos: point }, target.pos, distance(point, target.pos))
        : Infinity;
    const teamResponse = response(teamPoint),
      preferredResponse = response(preferredPoint);
    const reason = order.emergency
      ? 'Goal emergency keeps the team marking position.'
      : contain || order.transitioning
        ? 'Team containment and turnover recovery keep the team marking position.'
        : !preference.depth && !preference.width
          ? preference.reason
          : d < 0.01
            ? 'The mark is at the defended goal; keep the team position.'
            : distance(preferredPoint, carrier.pos) > 18
              ? 'Preferred mark leaves the threatened corridor; keep the team position.'
              : !Number.isFinite(teamResponse) || !Number.isFinite(preferredResponse)
                ? 'A blocked response to the marked opponent keeps the team position.'
                : preferredResponse > teamResponse + 0.35 + 1e-9
                  ? 'Preferred mark would respond more than 0.35 s later; keep the team position.'
                  : rejection;
    const applied = !reason && distance(teamPoint, preferredPoint) > 1e-9;
    order.positioning = {
      style,
      strength,
      applied,
      reason: reason ?? preference.reason,
      teamPoint,
      preferredPoint,
      teamResponse,
      preferredResponse,
      ...estimates,
    };
    if (applied) {
      a.destination = { ...preferredPoint };
      order.intercept = { ...preferredPoint };
      order.arrivalETA = estimateSpaceAttackTime(bot, preferredPoint, routers.get(bot.id)!(preferredPoint, true).length);
    }
    a.reason += `; ${order.positioning.reason}`;
  }
}
