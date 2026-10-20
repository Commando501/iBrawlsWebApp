import type { FieldPoint, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { BallRecovery } from './aiGrifballPassing';
import type { TeamTactics } from './grifballTacticsConfig';

export interface PassRecoveryDecision {
  action: 'retain' | 'handoff' | 'unavailable';
  reason: string;
  previousReceiverId: string;
  receiverId: string | null;
  point: FieldPoint;
  settleIn: number;
  requiredAdvantage: number;
  candidates: { id: string; arrivalETA: number; pickupETA: number; reason: string }[];
}

/** Reconsider only our released pass. Use its current public trajectory, without
 * assuming which weapon/body changed it or predicting future moving contacts. */
export function chooseGrifballPassRecovery(input: {
  snapshot: GrifballTacticalSnapshot; team: string; receiverId: string;
  tuning: TeamTactics; routers: SpaceRouters; recovery: BallRecovery | undefined;
}): PassRecoveryDecision | null {
  const { snapshot, team, receiverId, tuning, routers, recovery } = input;
  if (!tuning.enabled || !tuning.spaceEnabled || !tuning.passingEnabled || !tuning.passRecoveryEnabled ||
    !snapshot.playing || !snapshot.geometry || !snapshot.passing || snapshot.holderId ||
    !['thrown', 'loose'].includes(snapshot.ballPhysics?.state ?? '') ||
    snapshot.ballPhysics?.state === 'thrown' && !recovery?.settled) return null;
  const point = recovery?.point ?? snapshot.ball, settleIn = recovery?.seconds ?? 0;
  const candidates = snapshot.players.filter(p => p.scripted && p.team === team).map(p => {
    const route = routers.get(p.id)?.(point, true);
    const available = (p.height ?? 0) <= .01 && p.space?.phase !== 'lunging';
    const arrivalETA = available && route && route.status !== 'blocked'
      ? Math.max(0, p.space?.mobileIn ?? 0) + Math.max(0, route.length - snapshot.passing!.pickupRadius * .6) / Math.max(.1, p.space?.speed ?? 5.2)
      : Infinity;
    return { id: p.id, arrivalETA, pickupETA: Math.max(settleIn, arrivalETA),
      reason: !available ? 'Committed airborne or lunge movement' : !Number.isFinite(arrivalETA) ? 'Recovery route unavailable' : 'Reachable ground recovery' };
  }).sort((a, b) => a.pickupETA - b.pickupETA || a.id.localeCompare(b.id));
  const best = candidates.find(c => Number.isFinite(c.pickupETA));
  const intended = candidates.find(c => c.id === receiverId && Number.isFinite(c.pickupETA));
  const retain = intended && best && intended.pickupETA <= best.pickupETA + tuning.passRecoveryAdvantage + 1e-9;
  const selected = retain ? intended : best;
  return { action: !selected ? 'unavailable' : selected.id === receiverId ? 'retain' : 'handoff',
    reason: !selected ? 'No available scripted ground receiver; use ordinary recovery' : retain
      ? 'Keep the receiver: no teammate can collect the ball sufficiently sooner'
      : intended ? 'Hand off the pass recovery to a teammate who can collect it sooner' : 'Replace the unavailable pass receiver',
    previousReceiverId: receiverId, receiverId: selected?.id ?? null, point: { ...point }, settleIn,
    requiredAdvantage: tuning.passRecoveryAdvantage, candidates };
}
