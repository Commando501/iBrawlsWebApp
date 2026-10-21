import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { RunnerPlan, SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { GRIFBALL_ESCORT_POSITION_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { assessGrifballSupportPosition, type SupportPositionAssessment } from './aiGrifballSupportPosition';
import { fieldDistance } from './grifballSpaceGeometry';

export interface EscortPositionDecision extends Omit<SupportPositionAssessment, 'rejection'> {
  style: GrifballPlayerStyle; strength: number; applied: boolean; reason: string;
  teamPoint: FieldPoint; preferredPoint: FieldPoint;
}

const segmentDistance = (point: FieldPoint, from: FieldPoint, to: FieldPoint) => {
  const dx = to.x - from.x, dz = to.z - from.z;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / Math.max(.000001, dx * dx + dz * dz)));
  return fieldDistance(point, { x: from.x + dx * t, z: from.z + dz * t });
};

/** Adjust only uncommitted escorts, after passing and engagement owners have
 * reserved their jobs. Existing routing and combat still execute the orders. */
export function applyGrifballEscortPosition(snapshot: GrifballTacticalSnapshot, assignments: GrifballAssignment[],
  play: RunnerPlan, tuning: TeamTactics, routers: SpaceRouters): void {
  if (!tuning.escortAgencyStrength || !tuning.enabled || !tuning.spaceEnabled || !tuning.runnerEnabled ||
    !snapshot.playing || !snapshot.geometry || play.carrierId !== snapshot.holderId) return;
  const carrier = snapshot.players.find(p => p.id === snapshot.holderId);
  if (!carrier || carrier.team !== assignments[0]?.team) return;
  const h = play.heading;
  for (const a of [...assignments].sort((a, b) => a.botId.localeCompare(b.botId))) {
    const bot = snapshot.players.find(p => p.id === a.botId);
    if (!bot?.scripted || a.botId === carrier.id || a.role === 'runner' || a.role === 'retriever' || a.role === 'safety' || a.receive || a.defense ||
      a.escort?.kind === 'rear-guard' || a.escort?.targetId ||
      a.tanking && (a.tanking.mode !== 'cover' || a.tanking.attack || a.tanking.recoveryId === a.botId || a.tanking.targetId) ||
      a.agency?.choice === 'initiative' || !a.escort && !a.tanking) continue;
    const teamPoint = { ...a.destination }, style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, a.botId);
    const preference = GRIFBALL_ESCORT_POSITION_PREFERENCES[style], strength = tuning.escortAgencyStrength;
    const lateral = (teamPoint.x - carrier.pos.x) * -h.z + (teamPoint.z - carrier.pos.z) * h.x;
    const side = Math.abs(lateral) > 1e-9 ? Math.sign(lateral) : a.slot % 2 ? -1 : 1;
    const preferredPoint = { x: teamPoint.x + (h.x * preference.forward - h.z * preference.width * side) * strength,
      z: teamPoint.z + (h.z * preference.forward + h.x * preference.width * side) * strength };
    const { rejection, ...estimates } = assessGrifballSupportPosition({ snapshot, botId: a.botId, tuning, routers, teamPoint, preferredPoint,
      reserved: [carrier.pos, ...assignments.filter(other => other !== a && other.botId !== carrier.id).map(other => other.destination)] });
    let from = carrier.pos, clearance = Infinity;
    for (const to of play.selected.route.points.length ? play.selected.route.points : [play.selected.destination]) {
      clearance = Math.min(clearance, segmentDistance(preferredPoint, from, to)); from = to;
    }
    const reason = !preference.forward && !preference.width ? preference.reason
      : play.selected.action === 'finish' ? 'Keep the team escort during the scoring approach.'
      : clearance + 1e-9 < tuning.escortLaneWidth ? 'Preferred escort enters the runner corridor; keep the team position.'
      : rejection;
    const applied = !reason && fieldDistance(teamPoint, preferredPoint) > 1e-9;
    a.escortPosition = { style, strength, applied, reason: reason ?? preference.reason, teamPoint, preferredPoint, ...estimates };
    if (applied) {
      a.destination = { ...preferredPoint };
      if (a.escort) a.escort.destination = { ...preferredPoint };
    }
    a.reason += `; ${a.escortPosition.reason}`;
  }
}
