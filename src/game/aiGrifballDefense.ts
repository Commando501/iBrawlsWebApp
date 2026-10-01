import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance as distance, isSpaceSegmentOpen, createSpaceRouter, type SpaceRoute } from './grifballSpaceGeometry';
import { pointAlongRunnerRoute, type SpaceRouters } from './aiGrifballRunner';

export interface DefenseOrder {
  mode: 'intercept' | 'contain' | 'mark' | 'last-defender' | 'recover';
  targetId: string | null; intercept: FieldPoint; arrivalETA: number; carrierETA: number;
  advantage: number; reinforcementIn: number; emergency: boolean; transitioning: boolean;
}
export interface DefenseCarrierMotion {
  carrierId: string; team: string; anchor: FieldPoint; stationarySeconds: number;
}
/** Track actual displacement, including a carrier whose attempted movement is blocked. */
export function observeDefenseCarrierMotion(memory: DefenseCarrierMotion | null | undefined,
  carrier: GrifballTacticalPlayer | undefined, dt: number): DefenseCarrierMotion | null {
  if (!carrier) return null;
  if (!memory || memory.carrierId !== carrier.id || memory.team !== carrier.team || distance(memory.anchor, carrier.pos) > .5)
    return { carrierId: carrier.id, team: carrier.team, anchor: { ...carrier.pos }, stationarySeconds: 0 };
  memory.stationarySeconds += Math.max(0, dt);
  return memory;
}
const toward = (from: FieldPoint, to: FieldPoint, amount: number): FieldPoint => {
  const d = distance(from, to), scale = Math.min(d, amount) / Math.max(d, 0.001);
  return { x: from.x + (to.x - from.x) * scale, z: from.z + (to.z - from.z) * scale };
};

/** Defenders share one projection, one safety, and distinct marks. No orders for observed players. */
export function applyGrifballDefense(snapshot: GrifballTacticalSnapshot, assignments: GrifballAssignment[],
  tuning: TeamTactics, routers: SpaceRouters, previous: Map<string, GrifballAssignment>, transition: number, carrierStationarySeconds = 0): void {
  if (!assignments.length) return;
  const team = assignments[0].team, goal = snapshot.goals[team];
  const carrier = snapshot.players.find(p => p.id === snapshot.holderId);
  if (!goal || carrier?.team === team) return;
  const players = snapshot.players, allies = players.filter(p => p.team === team), enemies = players.filter(p => p.team !== team);
  let defenders = assignments.filter(a => a.role !== 'retriever');
  if (!defenders.length) return;
  const anchor = carrier?.pos ?? snapshot.ball;
  const advantage = allies.length - enemies.length;
  const reinforcementIn = Math.min(Infinity, ...(snapshot.respawns ?? []).filter(p => p.team === team).map(p => {
    const router = createSpaceRouter(snapshot.geometry!, p.pos), route = router(anchor, true);
    return p.seconds + (route.status === 'blocked' ? Infinity : route.length / Math.max(0.1, p.speed));
  }));
  const emergency = !!carrier && distance(carrier.pos, goal) <= tuning.defenseEmergencyDistance;
  const contain = !emergency && (advantage < 0 || transition > 0 || tuning.defensePressure < 0.4 ||
    (reinforcementIn <= tuning.defenseRespawnWait && advantage <= 0));
  let projected = { ...anchor };
  let carrierRoute: SpaceRoute | undefined, carrierTravel = 0;
  const expiredMotion = !!carrier && carrierStationarySeconds >= tuning.defenseLookahead;
  // A short pause retains the cut. Once observed displacement contradicts the
  // full forecast horizon, pressure the actual position instead of waiting forever.
  if (carrier && !expiredMotion) {
    const speed = Math.max(0.1, carrier.space?.speed ?? 5.8), velocity = Math.hypot(carrier.vel.x, carrier.vel.z);
    const scale = Math.min(1, speed / Math.max(0.001, velocity)) * tuning.defenseLookahead;
    const moving = { x: anchor.x + carrier.vel.x * scale, z: anchor.z + carrier.vel.z * scale };
    const route = routers.get(carrier.id)!(goal);
    if (velocity > 0.5 && isSpaceSegmentOpen(snapshot.geometry!, anchor, moving)) projected = moving;
    else if (route.status !== 'blocked') {
      carrierRoute = route;
      carrierTravel = speed * tuning.defenseLookahead;
      projected = pointAlongRunnerRoute(anchor, route, carrierTravel);
    }
  }
  const routeLength = (id: string, point: FieldPoint) => {
    const route = routers.get(id)!(point, true); return route.status === 'blocked' ? Infinity : route.length;
  };
  const pressureMargin = tuning.defenseContainMargin * (1.5 - tuning.defensePressure * 0.5);
  const enemyReach = Math.max(0, ...enemies.filter(p => distance(p.pos, anchor) < 12).map(p => Math.max(p.space?.reach ?? 3, p.space?.lungeReach ?? 0)));
  // Containment already stands outside hostile reach. Keep the last defender
  // another spacing interval goal-side when room permits, rather than stacking
  // both roles on that same standoff point. A lone defender needs no extra layer.
  const containmentDepth = enemyReach + pressureMargin;
  const safetyDepth = Math.max(tuning.defenseSafetyDepth,
    contain ? containmentDepth + (carrier && defenders.length > 1 ? tuning.lateralSpacing : 0) : 0);
  const safetyPoint = toward(projected, goal, Math.min(safetyDepth, distance(projected, goal) * 0.85));
  let carrierSafety: GrifballAssignment | undefined;
  if (!contain && !emergency && snapshot.ballPhysics?.state !== 'thrown') {
    // Keep an earned loose-ball screen or a punishable carrier recovery window
    // together with its partner, provided separate goal-side coverage remains.
    // A ready carrier still requires the earliest feasible interception.
    const primary = defenders.find(a => {
      if (a.tanking?.mode !== 'engage' || !a.tanking.attack) return false;
      if (!carrier) return true;
      if (a.tanking.targetId !== carrier.id || !carrier.space?.phase.includes('recover')) return false;
      const actor = players.find(p => p.id === a.botId)!;
      return estimateSpaceAttackTime(actor, anchor, routeLength(actor.id, anchor)) + 0.1 < carrier.space.attackIn;
    });
    if (primary) {
      const recovery = defenders.filter(a => a !== primary && !(a.tanking?.mode === 'punish' &&
        a.tanking.partnerId === primary.botId && a.tanking.targetId === primary.tanking!.targetId));
      if (carrier) {
        // A carrier commitment must keep a separate defender already goal-side
        // who can cover the cut before the carrier arrives, including visible
        // airborne/reload delays. Reachability alone does not establish coverage.
        const carrierETA = routeLength(carrier.id, safetyPoint) / Math.max(.1, carrier.space?.speed ?? 5.8);
        const coverage = recovery.map(a => {
          const actor = players.find(p => p.id === a.botId)!;
          const goalSide = (actor.pos.x - anchor.x) * (goal.x - anchor.x) + (actor.pos.z - anchor.z) * (goal.z - anchor.z) > 0;
          const arrival = goalSide ? Math.max(actor.space?.mobileIn ?? Infinity,
            routeLength(actor.id, safetyPoint) / Math.max(.1, actor.space?.speed ?? 0)) + (actor.space?.attackIn ?? Infinity) : Infinity;
          return { assignment: a, arrival };
        });
        carrierSafety = coverage.filter(c => Number.isFinite(c.arrival) && c.arrival <= carrierETA)
          .sort((a, b) => a.arrival - b.arrival || a.assignment.botId.localeCompare(b.assignment.botId))[0]?.assignment;
        if (carrierSafety) defenders = recovery;
      } else if (recovery.some(a => Number.isFinite(routeLength(a.botId, safetyPoint)))) defenders = recovery;
    }
  }
  const ranked = [...defenders].sort((a, b) => {
    const cost = (a: GrifballAssignment) => routeLength(a.botId, safetyPoint) - (previous.get(a.botId)?.defense?.mode === 'last-defender' ? tuning.reassignmentAdvantage : 0);
    return cost(a) - cost(b) || a.botId.localeCompare(b.botId);
  });
  const interceptions = new Map<string, { point: FieldPoint; time: number; reachable: boolean }>();
  const interception = (a: GrifballAssignment) => {
    const cached = interceptions.get(a.botId);
    if (cached) return cached;
    const self = players.find(p => p.id === a.botId)!;
    for (let i = 1; i <= 6; i++) {
      const t = tuning.defenseLookahead * i / 6, fraction = i / 6;
      // A routed forecast follows its bends at carrier speed. The chord to its
      // endpoint can cross obstacles and invent earlier interception locations.
      const point = carrierRoute ? pointAlongRunnerRoute(anchor, carrierRoute, carrierTravel * fraction) :
        { x: anchor.x + (projected.x - anchor.x) * fraction, z: anchor.z + (projected.z - anchor.z) * fraction };
      if (estimateSpaceAttackTime(self, point, routeLength(self.id, point)) <= t + tuning.defensePressure * 0.25) {
        const result = { point, time: t, reachable: true };
        interceptions.set(a.botId, result);
        return result;
      }
    }
    const result = { point: projected, time: tuning.defenseLookahead, reachable: false };
    interceptions.set(a.botId, result);
    return result;
  };
  let safety = carrierSafety ?? ranked[0];
  // Do not reserve the only viable cut for a safety while a slower teammate tail-chases.
  // Containment and lone-defender coverage still take precedence over pressure.
  const reachable = carrier && !carrierSafety && !contain && !emergency && defenders.length > 1
    ? defenders.filter(a => interception(a).reachable) : [];
  if (reachable.length === 1 && reachable[0] === safety && distance(projected, goal) < distance(anchor, goal)) safety = ranked[1];
  const assign = (a: GrifballAssignment, mode: DefenseOrder['mode'], point: FieldPoint, target: GrifballTacticalPlayer | undefined, carrierETA = 0) => {
    const self = players.find(p => p.id === a.botId)!;
    delete a.tanking; delete a.escort;
    a.role = mode === 'last-defender' ? 'safety' : mode === 'intercept' || mode === 'contain' ? 'chaser' : 'cover';
    a.destination = point; a.anchor = { ...anchor };
    a.defense = { mode, targetId: target?.id ?? null, intercept: { ...point },
      arrivalETA: estimateSpaceAttackTime(self, point, routeLength(self.id, point)), carrierETA,
      advantage, reinforcementIn, emergency, transitioning: transition > 0 };
    a.reason = `${mode}: ${emergency ? 'contest the scoring threat' : transition > 0 ? 'recover shape after possession loss' : contain ? 'hold the goal side until pressure is safe' : expiredMotion ? 'pressure the stationary carrier and protect the goal' : 'cut the carrier route and protect the goal'}`;
  };
  assign(safety, 'last-defender', emergency ? anchor : safetyPoint, carrier);
  safety.role = 'safety';
  const rest = defenders.filter(a => a !== safety);
  if (!carrier) {
    rest.forEach((a, i) => {
      const center = toward(anchor, goal, 4), d = Math.max(0.001, distance(anchor, goal));
      const side = (i % 2 ? -1 : 1) * tuning.lateralSpacing * (1 + Math.floor(i / 2));
      assign(a, 'recover', { x: center.x - (goal.z - anchor.z) / d * side, z: center.z + (goal.x - anchor.x) / d * side }, undefined);
    });
    return;
  }
  // A lone defender preserves the goal side until the emergency range is reached.
  if (!rest.length) return;
  rest.sort((a, b) => {
    const aReachable = reachable.includes(a), bReachable = reachable.includes(b);
    // Contest the earliest feasible cut. Distance to the horizon's endpoint can
    // otherwise send the nearby defender away to mark while a later one chases.
    return Number(bReachable) - Number(aReachable) || (aReachable && bReachable ?
      interception(a).time - interception(b).time ||
      routeLength(a.botId, interception(a).point) - routeLength(b.botId, interception(b).point) : 0) ||
      routeLength(a.botId, projected) - routeLength(b.botId, projected) || a.botId.localeCompare(b.botId);
  });
  if (!carrierSafety) {
    const primary = rest.shift()!, intercept = interception(primary);
    const containment = toward(projected, goal, containmentDepth);
    assign(primary, contain ? 'contain' : 'intercept', emergency ? anchor : contain ? containment : intercept.point, carrier, intercept.time);
    primary.role = 'chaser';
  }
  const marks = enemies.filter(p => p !== carrier).sort((a, b) => distance(a.pos, goal) - distance(b.pos, goal) || a.id.localeCompare(b.id));
  const available = new Set(rest);
  for (const target of marks) {
    if (!available.size) break;
    const point = toward(target.pos, goal, tuning.defenseContainMargin + (target.space?.reach ?? 3));
    // Do not abandon the threatened corridor to mark an irrelevant distant escort.
    if (distance(point, anchor) > 18) continue;
    // Pair by reachable coverage distance, not by two unrelated sort orders
    // that can make flank defenders cross through the carrier's lane.
    const choices = [...available].map(a => {
      const old = previous.get(a.botId)?.defense;
      return { assignment: a, cost: routeLength(a.botId, point) -
        (old?.mode === 'mark' && old.targetId === target.id ? tuning.reassignmentAdvantage : 0) };
    }).filter(c => Number.isFinite(c.cost))
      .sort((a, b) => a.cost - b.cost || a.assignment.botId.localeCompare(b.assignment.botId));
    const marker = choices[0]?.assignment;
    if (marker) { assign(marker, 'mark', point, target); available.delete(marker); }
  }
  [...available].forEach((a, i) => {
    const d = Math.max(0.001, distance(anchor, goal)), side = (i % 2 ? -1 : 1) * tuning.lateralSpacing;
    assign(a, 'recover', { x: safetyPoint.x - (goal.z - anchor.z) / d * side, z: safetyPoint.z + (goal.x - anchor.x) / d * side }, carrier);
  });
}

export function selectDefenseThreat(a: GrifballAssignment, self: FieldPoint, players: GrifballTacticalPlayer[]): string | null {
  const order = a.defense!;
  const enemies = players.filter(p => p.team !== a.team && (!a.geometry || isSpaceSegmentOpen(a.geometry, self, p.pos)));
  const immediate = enemies.filter(p => distance(self, p.pos) <= 2.5 || ['swing_up', 'swing_down', 'slashing'].includes(p.space?.phase ?? '') && distance(self, p.pos) <= (p.space?.reach ?? 3))
    .sort((x, y) => distance(self, x.pos) - distance(self, y.pos) || x.id.localeCompare(y.id));
  if (immediate.length) return immediate[0].id;
  const target = enemies.find(p => p.id === order.targetId);
  if (!target) return null;
  const emergency = order.emergency && target.id === a.carrierId;
  if (!emergency && ['contain', 'last-defender', 'recover'].includes(order.mode)) return null;
  // Intercept first; switching to a duel early would turn the cut into tail pursuit.
  // Own reach is a bound, not permission to abandon the cut from farther away.
  // Preserve the target-threat approach distance as well: a long-range hammer
  // must still establish its interception before switching to pursuit.
  const reach = players.find(p => p.id === a.botId)?.space?.reach ?? 3;
  const handoffDistance = Math.max(1, Math.min(reach, target.space?.reach ?? 3));
  return distance(self, target.pos) <= (a.tuning?.engagementDistance ?? 6) &&
    (emergency || distance(self, order.intercept) <= handoffDistance) ? target.id : null;
}
