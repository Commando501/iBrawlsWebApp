import type { GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance } from './grifballSpaceGeometry';
import { BALL_REST_Y } from './grifballBall';
import { GRIFBALL_PICKUP_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';

export interface PickupAgencyCandidate {
  botId: string;
  style: GrifballPlayerStyle;
  arrival: number;
  bonus: number;
  commitment: number;
  opening: boolean;
  eligible: boolean;
  reason: string;
}
export interface PickupAgencyDecision {
  strength: number;
  teamRetrieverId: string;
  retrieverId: string;
  reason: string;
  enemyArrival: number;
  enemyAttack: number;
  candidates: PickupAgencyCandidate[];
}

/** Rank closely matched ordinary ground recoveries. The caller owns arrival
 * estimates and observed-player priority, shared with its existing team choice. */
export function chooseGrifballPickupAgency(input: {
  snapshot: GrifballTacticalSnapshot;
  team: string;
  tuning: TeamTactics;
  routers: SpaceRouters;
  teamRetrieverId: string;
  incumbentId?: string;
  reservedPass: boolean;
  arrival: (player: GrifballTacticalPlayer) => number;
  observedHasPriority: (player: GrifballTacticalPlayer) => boolean;
}): PickupAgencyDecision | undefined {
  const { snapshot, team, tuning, routers, teamRetrieverId, incumbentId, reservedPass, arrival, observedHasPriority } = input;
  const strength = tuning.pickupAgencyStrength;
  if (
    !strength ||
    !tuning.enabled ||
    !tuning.spaceEnabled ||
    !snapshot.playing ||
    !snapshot.geometry ||
    snapshot.holderId ||
    reservedPass ||
    !snapshot.ballPhysics ||
    !['idle', 'loose'].includes(snapshot.ballPhysics.state) ||
    snapshot.ballPhysics.pos.y > BALL_REST_Y + 0.01 ||
    Math.abs(snapshot.ballPhysics.vel.y) > 0.01
  )
    return;
  const bots = snapshot.players.filter((p) => p.team === team && p.scripted);
  const baseline = bots.find((p) => p.id === teamRetrieverId);
  if (!baseline || observedHasPriority(baseline)) return;
  const enemies = snapshot.players.filter((p) => p.team !== team);
  const enemyArrival = Math.min(Infinity, ...enemies.map(arrival));
  const enemyAttack = Math.min(
    Infinity,
    ...enemies.map((p) => {
      const route = routers.get(p.id)?.(snapshot.ball, true);
      return estimateSpaceAttackTime(p, snapshot.ball, !route || route.status === 'blocked' ? Infinity : route.length);
    }),
  );
  const teamArrival = arrival(baseline),
    earliest = Math.min(...bots.map(arrival));
  // Preserve a won arrival race with a small cushion. If the team is already
  // late, individuality cannot select an even later recovery.
  const deadline = Math.max(teamArrival, enemyArrival - 0.1);
  const candidates = bots
    .map((p) => {
      const eta = arrival(p),
        style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, p.id);
      const preference = GRIFBALL_PICKUP_PREFERENCES[style],
        opening = Number.isFinite(eta) && enemyAttack >= eta + 0.5;
      let reason: string | undefined;
      if ((p.height ?? 0) > 0.01 || p.space?.phase === 'lunging' || (p.space?.mobileIn ?? 0) > 0)
        reason = 'Committed movement keeps this bot out of individual pickup bidding.';
      else if (!Number.isFinite(eta)) reason = 'No reachable ground recovery.';
      else if (eta > earliest + 0.25 + 1e-9) reason = 'More than 0.25 s behind the earliest team arrival.';
      else if (eta > deadline + 1e-9) reason = 'Would surrender the team arrival margin against an opponent.';
      else if (observedHasPriority(p)) reason = 'Observed human or neural pursuit has pickup priority.';
      const eligible = !reason;
      const bonus = eligible && (!preference.needsOpening || opening) ? preference.bonus * strength : 0;
      const commitment = p.id === incumbentId ? tuning.reassignmentAdvantage / Math.max(0.1, p.space?.speed ?? 5.2) : 0;
      return {
        botId: p.id,
        style,
        arrival: eta,
        bonus,
        commitment,
        opening,
        eligible,
        reason:
          reason ??
          (preference.needsOpening && !opening ? 'No 0.5 s attack window; use ordinary pickup priority.' : preference.reason),
      };
    })
    .sort((a, b) => a.botId.localeCompare(b.botId));
  const teamCandidate = candidates.find((c) => c.botId === teamRetrieverId)!;
  const score = (c: PickupAgencyCandidate) => c.arrival - c.bonus - c.commitment;
  const preferred = candidates.filter((c) => c.eligible).sort((a, b) => score(a) - score(b) || a.botId.localeCompare(b.botId))[0];
  let reason = 'Keep the team retriever: no individual bid beats its arrival and commitment.';
  let retrieverId = teamRetrieverId;
  const goal = snapshot.goals[team];
  if (goal && fieldDistance(snapshot.ball, goal) <= tuning.defenseEmergencyDistance)
    reason = 'Recovery near the defended goal keeps the team retriever.';
  else if (!teamCandidate.eligible)
    reason = 'Team recovery readiness or existing commitment takes priority over individual bids.';
  else if (preferred && score(preferred) + 1e-9 < score(teamCandidate)) {
    retrieverId = preferred.botId;
    reason = 'A closely matched individual pickup bid wins; teammates keep coverage jobs.';
  }
  return { strength, teamRetrieverId, retrieverId, reason, enemyArrival, enemyAttack, candidates };
}
