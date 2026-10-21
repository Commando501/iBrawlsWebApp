import type { FieldPoint, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { fieldDistance as distance } from './grifballSpaceGeometry';
import { estimateSpaceAttackTime } from './aiGrifballSpace';

export interface SupportPositionAssessment {
  teamArrival: number; preferredArrival: number;
  teamAttackMargin: number; preferredAttackMargin: number;
  rejection?: string;
}

/** Clearance to every segment, including detours around arena obstacles. */
export function supportRouteClearance(point: FieldPoint, path: FieldPoint[]): number {
  let clearance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    clearance = Math.min(clearance, distance(point, { x: a.x + dx * t, z: a.z + dz * t }));
  }
  return clearance;
}

/** Shared ground-cover safeguards. Arrival comparisons may include a known wait
 * for a loose ball to settle, but never assume future moving contacts. */
export function assessGrifballSupportPosition(input: {
  snapshot: GrifballTacticalSnapshot; botId: string; tuning: TeamTactics; routers: SpaceRouters;
  teamPoint: FieldPoint; preferredPoint: FieldPoint; reserved: FieldPoint[]; readyIn?: number;
}): SupportPositionAssessment {
  const { snapshot, botId, tuning, routers, teamPoint, preferredPoint, reserved, readyIn = 0 } = input;
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
  let rejection: string | undefined;
  if ((player.height ?? 0) > .01 || player.space?.phase === 'lunging') rejection = 'Committed airborne or lunge movement keeps the team position.';
  else if (!Number.isFinite(teamArrival) || !Number.isFinite(preferredArrival)) rejection = 'A blocked ground route keeps the team position.';
  else if (Math.max(readyIn, preferredArrival) > Math.max(readyIn, teamArrival) + .35 + 1e-9)
    rejection = 'Preferred cover would arrive more than 0.35 s later; keep the team position.';
  else if (Math.min(tuning.threatHorizon, preferredAttackMargin) + 1e-9 < Math.min(tuning.threatHorizon, teamAttackMargin))
    rejection = 'Preferred cover loses visible attack margin within the threat horizon; keep the team position.';
  else if (reserved.some(p => distance(preferredPoint, p) + 1e-9 < Math.min(tuning.separation, distance(teamPoint, p))))
    rejection = 'Preferred cover crowds a reserved teammate position; keep the team position.';
  return { teamArrival, preferredArrival, teamAttackMargin, preferredAttackMargin, ...(rejection ? { rejection } : {}) };
}
