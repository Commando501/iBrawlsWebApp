import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { BallRecovery } from './aiGrifballPassing';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';

export interface PassLandingSupport {
  receiverId: string;
  point: FieldPoint;
  settleIn: number;
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
