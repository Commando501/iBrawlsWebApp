import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { BallRecovery } from './aiGrifballPassing';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { GRIFBALL_PASS_SUPPORT_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { fieldDistance as distance } from './grifballSpaceGeometry';
import { estimateSpaceAttackTime } from './aiGrifballSpace';

export interface PassLandingSupport {
  receiverId: string;
  point: FieldPoint;
  settleIn: number;
  individuality?: PassSupportIndividuality;
}

export interface PassSupportIndividuality {
  style: GrifballPlayerStyle; strength: number; applied: boolean; reason: string;
  teamPoint: FieldPoint; preferredPoint: FieldPoint;
  teamArrival: number; preferredArrival: number;
  teamAttackMargin: number; preferredAttackMargin: number;
}

/** Support the current retriever of our released pass, including after a handoff.
 * A reservation alone is insufficient: observed players may own the pickup. */
export function resolveGrifballPassSupport(input: {
  snapshot: GrifballTacticalSnapshot; assignments: GrifballAssignment[]; team: string;
  flight: { team: string } | null; tuning: TeamTactics; routers: SpaceRouters;
  recovery: BallRecovery | undefined;
}): PassLandingSupport | undefined {
  const { snapshot, assignments, team, flight, tuning, routers, recovery } = input;
  if (!tuning.passSupportEnabled || !tuning.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled ||
    !tuning.passingEnabled || flight?.team !== team || !snapshot.playing || snapshot.holderId ||
    !snapshot.geometry || !snapshot.passing || !['thrown', 'loose'].includes(snapshot.ballPhysics?.state ?? '') ||
    snapshot.ballPhysics?.state === 'thrown' && !recovery?.settled) return;
  const receiver = assignments.find(a => a.team === team && a.role === 'retriever');
  const player = snapshot.players.find(p => p.id === receiver?.botId && p.team === team && p.scripted);
  if (!player || (player.height ?? 0) > .01 || player.space?.phase === 'lunging') return;
  const point = snapshot.ballPhysics?.state === 'thrown' ? recovery!.point : snapshot.ball;
  const route = routers.get(player.id)?.(point, true);
  if (!route || route.status === 'blocked') return;
  return { receiverId: player.id, point: { ...point }, settleIn: snapshot.ballPhysics?.state === 'thrown' ? recovery!.seconds : 0 };
}

/** Compare a bounded personal cover position with the team's slot. The caller
 * reserves the receiver and last defender before varying any lateral covers. */
export function chooseGrifballPassSupportPosition(input: {
  snapshot: GrifballTacticalSnapshot; botId: string; support: PassLandingSupport;
  tuning: TeamTactics; routers: SpaceRouters; teamPoint: FieldPoint; goal: FieldPoint;
  side: number; reserved: FieldPoint[];
}): { point: FieldPoint; individuality?: PassSupportIndividuality } {
  const { snapshot, botId, support, tuning, routers, teamPoint, goal, side, reserved } = input;
  const strength = tuning.passSupportAgencyStrength;
  if (!strength || !tuning.passSupportEnabled || !tuning.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !tuning.passingEnabled)
    return { point: teamPoint };
  const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, botId), preference = GRIFBALL_PASS_SUPPORT_PREFERENCES[style];
  const anchor = support.point, d = distance(anchor, goal);
  const depth = Math.min(d, Math.max(2, Math.min(10, tuning.passSupportDepth + preference.depth * strength)));
  const width = Math.abs(side) + preference.width * strength, sign = side < 0 ? -1 : 1;
  const dx = (goal.x - anchor.x) / Math.max(.001, d), dz = (goal.z - anchor.z) / Math.max(.001, d);
  const preferredPoint = { x: anchor.x + dx * depth - dz * width * sign, z: anchor.z + dz * depth + dx * width * sign };
  const player = snapshot.players.find(p => p.id === botId)!;
  const arrival = (point: FieldPoint) => {
    const route = routers.get(botId)?.(point, true);
    return !route || route.status === 'blocked' ? Infinity : Math.max(0, player.space?.mobileIn ?? 0) + route.length / Math.max(.1, player.space?.speed ?? 5.2);
  };
  const attackMargin = (point: FieldPoint, eta: number) => {
    if (!Number.isFinite(eta)) return -Infinity;
    return Math.min(Infinity, ...snapshot.players.filter(p => p.team !== player.team).map(p => {
      const route = routers.get(p.id)?.(point, true);
      return estimateSpaceAttackTime(p, point, !route || route.status === 'blocked' ? Infinity : route.length);
    })) - eta;
  };
  const teamArrival = arrival(teamPoint), preferredArrival = arrival(preferredPoint);
  const teamAttackMargin = attackMargin(teamPoint, teamArrival), preferredAttackMargin = attackMargin(preferredPoint, preferredArrival);
  const individuality: PassSupportIndividuality = { style, strength, applied: false, reason: preference.reason,
    teamPoint: { ...teamPoint }, preferredPoint, teamArrival, preferredArrival, teamAttackMargin, preferredAttackMargin };
  let rejection: string | undefined;
  if (!preference.depth && !preference.width) rejection = preference.reason;
  else if ((player.height ?? 0) > .01 || player.space?.phase === 'lunging') rejection = 'Committed airborne or lunge movement keeps the team position.';
  else if (d < .01) rejection = 'The landing area is at the defended goal; keep the team position.';
  else if (!Number.isFinite(teamArrival) || !Number.isFinite(preferredArrival)) rejection = 'A blocked ground route keeps the team position.';
  else if (Math.max(support.settleIn, preferredArrival) > Math.max(support.settleIn, teamArrival) + .35 + 1e-9)
    rejection = 'Preferred cover would arrive more than 0.35 s later; keep the team position.';
  else if (Math.min(tuning.threatHorizon, preferredAttackMargin) + 1e-9 < Math.min(tuning.threatHorizon, teamAttackMargin))
    rejection = 'Preferred cover loses visible attack margin within the threat horizon; keep the team position.';
  else if (reserved.some(p => distance(preferredPoint, p) + 1e-9 < Math.min(tuning.separation, distance(teamPoint, p))))
    rejection = 'Preferred cover crowds a reserved teammate position; keep the team position.';
  if (rejection) individuality.reason = rejection;
  else {
    individuality.applied = distance(preferredPoint, teamPoint) > 1e-9;
    if (!individuality.applied) individuality.reason = 'The depth limit leaves the preferred cover at the team position.';
  }
  return { point: individuality.applied ? preferredPoint : teamPoint, individuality };
}
