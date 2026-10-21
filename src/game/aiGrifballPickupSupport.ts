import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { BALL_REST_Y } from './grifballBall';
import { fieldDistance as distance } from './grifballSpaceGeometry';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { assessGrifballSupportPosition, type SupportPositionAssessment } from './aiGrifballSupportPosition';
import {
  GRIFBALL_PICKUP_SUPPORT_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface PickupSupportDecision extends Omit<SupportPositionAssessment, 'rejection'> {
  style: GrifballPlayerStyle;
  strength: number;
  retrieverId: string;
  applied: boolean;
  reason: string;
  teamPoint: FieldPoint;
  preferredPoint: FieldPoint;
  teamClearance: number;
  preferredClearance: number;
}

/** Distance from a cover destination to every segment of the retriever's actual
 * ground route. A straight chord would miss detours around arena obstacles. */
function routeClearance(point: FieldPoint, path: FieldPoint[]): number {
  let clearance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    clearance = Math.min(clearance, distance(point, { x: a.x + dx * t, z: a.z + dz * t }));
  }
  return clearance;
}

/** Vary lateral recovery covers only after the team has reserved its retriever,
 * last defender and any earned tanking jobs. Released passes have their own owner. */
export function applyGrifballPickupSupport(
  snapshot: GrifballTacticalSnapshot,
  assignments: GrifballAssignment[],
  tuning: TeamTactics,
  routers: SpaceRouters,
  reservedPass: boolean,
): void {
  const strength = tuning.pickupSupportAgencyStrength,
    ball = snapshot.ballPhysics;
  if (
    !strength ||
    !tuning.enabled ||
    !tuning.spaceEnabled ||
    !tuning.defenseEnabled ||
    !snapshot.playing ||
    !snapshot.geometry ||
    snapshot.holderId ||
    reservedPass ||
    !ball ||
    !['idle', 'loose'].includes(ball.state) ||
    ball.pos.y > BALL_REST_Y + 0.01 ||
    Math.abs(ball.vel.y) > 0.01
  )
    return;
  const team = assignments[0]?.team,
    goal = snapshot.goals[team];
  const recovery = assignments.find((a) => a.role === 'retriever' && a.team === team);
  const retriever = snapshot.players.find((p) => p.id === recovery?.botId && p.team === team && p.scripted);
  if (
    !goal ||
    !retriever ||
    (retriever.height ?? 0) > 0.01 ||
    retriever.space?.phase === 'lunging' ||
    (retriever.space?.mobileIn ?? 0) > 0 ||
    !assignments.some((a) => a.defense?.mode === 'last-defender')
  )
    return;
  const route = routers.get(retriever.id)?.(snapshot.ball);
  if (!route || route.status === 'blocked') return;
  const path = [retriever.pos, ...route.points],
    anchor = snapshot.ball,
    d = distance(anchor, goal);
  const dx = (goal.x - anchor.x) / Math.max(0.001, d),
    dz = (goal.z - anchor.z) / Math.max(0.001, d);
  for (const a of [...assignments].sort((a, b) => a.botId.localeCompare(b.botId))) {
    const order = a.defense,
      bot = snapshot.players.find((p) => p.id === a.botId && p.team === team && p.scripted);
    if (!bot || order?.mode !== 'recover' || order.passSupport || a.receive || a.tanking || a.escort) continue;
    const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, a.botId),
      preference = GRIFBALL_PICKUP_SUPPORT_PREFERENCES[style];
    const teamPoint = { ...a.destination },
      x = teamPoint.x - anchor.x,
      z = teamPoint.z - anchor.z;
    const lateral = -dz * x + dx * z,
      side = Math.abs(lateral) > 1e-9 ? Math.sign(lateral) : a.slot % 2 ? -1 : 1;
    const depth = Math.min(d, Math.max(2, Math.min(10, dx * x + dz * z + preference.depth * strength)));
    const width = lateral + side * preference.width * strength;
    const preferredPoint = { x: anchor.x + dx * depth - dz * width, z: anchor.z + dz * depth + dx * width };
    const { rejection, ...estimates } = assessGrifballSupportPosition({
      snapshot,
      botId: bot.id,
      tuning,
      routers,
      teamPoint,
      preferredPoint,
      reserved: [
        ...assignments.filter((other) => other !== a).map((other) => other.destination),
        ...snapshot.players.filter((p) => p.team === team && !p.scripted).map((p) => p.pos),
      ],
    });
    const teamClearance = routeClearance(teamPoint, path),
      preferredClearance = routeClearance(preferredPoint, path);
    const contain =
      order.transitioning ||
      order.advantage < 0 ||
      tuning.defensePressure < 0.4 ||
      (order.reinforcementIn <= tuning.defenseRespawnWait && order.advantage <= 0);
    const reason =
      d <= tuning.defenseEmergencyDistance
        ? 'Recovery near the defended goal keeps the team support position.'
        : contain
          ? 'Team containment and turnover recovery keep the team support position.'
          : !preference.depth && !preference.width
            ? preference.reason
            : (bot.space?.mobileIn ?? 0) > 0
              ? 'Committed movement keeps the team support position.'
              : preferredClearance + 1e-9 < Math.min(tuning.separation, teamClearance)
                ? 'Preferred support crowds the retriever route; keep the team position.'
                : rejection;
    const applied = !reason && distance(teamPoint, preferredPoint) > 1e-9;
    order.pickupSupport = {
      style,
      strength,
      retrieverId: retriever.id,
      applied,
      reason: reason ?? preference.reason,
      teamPoint,
      preferredPoint,
      teamClearance,
      preferredClearance,
      ...estimates,
    };
    if (applied) {
      a.destination = { ...preferredPoint };
      order.intercept = { ...preferredPoint };
      order.arrivalETA = estimateSpaceAttackTime(bot, preferredPoint, routers.get(bot.id)!(preferredPoint, true).length);
    }
    a.reason += `; ${order.pickupSupport.reason}`;
  }
}
