import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance as distance, isSpaceSegmentOpen, createSpaceRouter, type SpaceRoute } from './grifballSpaceGeometry';
import { pointAlongRunnerRoute, type SpaceRouters } from './aiGrifballRunner';
import { grifballDefenseStyleBonus, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { chooseGrifballPassSupportPosition, type PassLandingSupport } from './aiGrifballPassSupport';
import { applyGrifballMarkPosition, type MarkPositionDecision } from './aiGrifballMarkPosition';
import type { PickupSupportDecision } from './aiGrifballPickupSupport';

export interface DefensePressureCandidate {
  botId: string; style: GrifballPlayerStyle; arrival: number; bonus: number;
  recoveryOpening: boolean; eligible: boolean; reason: string;
}

export interface DefenseOrder {
  mode: 'intercept' | 'contain' | 'mark' | 'last-defender' | 'recover';
  targetId: string | null; intercept: FieldPoint; arrivalETA: number; carrierETA: number;
  advantage: number; reinforcementIn: number; emergency: boolean; transitioning: boolean;
  passSupport?: PassLandingSupport;
  positioning?: MarkPositionDecision;
  pickupSupport?: PickupSupportDecision;
  individuality?: {
    style: GrifballPlayerStyle; strength: number; reason: string;
    pressureCandidates?: DefensePressureCandidate[];
    marking?: { baseCost: number; bonus: number; recoveryOpening: boolean };
  };
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
  tuning: TeamTactics, routers: SpaceRouters, previous: Map<string, GrifballAssignment>, transition: number, carrierStationarySeconds = 0,
  passSupport?: PassLandingSupport): void {
  if (!assignments.length) return;
  const team = assignments[0].team, goal = snapshot.goals[team];
  const carrier = snapshot.players.find(p => p.id === snapshot.holderId);
  if (!goal || carrier?.team === team) return;
  const players = snapshot.players, allies = players.filter(p => p.team === team), enemies = players.filter(p => p.team !== team);
  let defenders = assignments.filter(a => a.role !== 'retriever');
  if (!defenders.length) return;
  const anchor = carrier?.pos ?? passSupport?.point ?? snapshot.ball;
  const advantage = allies.length - enemies.length;
  const reinforcementIn = Math.min(Infinity, ...(snapshot.respawns ?? []).filter(p => p.team === team).map(p => {
    const router = createSpaceRouter(snapshot.geometry!, p.pos), route = router(anchor, true);
    return p.seconds + (route.status === 'blocked' ? Infinity : route.length / Math.max(0.1, p.speed));
  }));
  const emergency = !!carrier && distance(carrier.pos, goal) <= tuning.defenseEmergencyDistance;
  const contain = !emergency && (advantage < 0 || transition > 0 || tuning.defensePressure < 0.4 ||
    (reinforcementIn <= tuning.defenseRespawnWait && advantage <= 0));
  const strength = tuning.enabled && tuning.spaceEnabled && tuning.defenseEnabled ? tuning.defenseAgencyStrength : 0;
  const styleOf = (id: string) => resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, id);
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
  const recoveryOpening = (id: string, target: GrifballTacticalPlayer, notBefore: number) => {
    const self = players.find(p => p.id === id)!;
    return !!target.space?.phase.includes('recover') &&
      isSpaceSegmentOpen(snapshot.geometry!, self.pos, target.pos) &&
      Math.max(notBefore, estimateSpaceAttackTime(self, target.pos, routeLength(id, target.pos))) + .1 < target.space.attackIn;
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
  const interceptions = new Map<string, { point: FieldPoint; time: number; arrival: number; reachable: boolean }>();
  const interception = (a: GrifballAssignment) => {
    const cached = interceptions.get(a.botId);
    if (cached) return cached;
    const self = players.find(p => p.id === a.botId)!;
    let arrival = Infinity;
    for (let i = 1; i <= 6; i++) {
      const t = tuning.defenseLookahead * i / 6, fraction = i / 6;
      // A routed forecast follows its bends at carrier speed. The chord to its
      // endpoint can cross obstacles and invent earlier interception locations.
      const point = carrierRoute ? pointAlongRunnerRoute(anchor, carrierRoute, carrierTravel * fraction) :
        { x: anchor.x + (projected.x - anchor.x) * fraction, z: anchor.z + (projected.z - anchor.z) * fraction };
      arrival = estimateSpaceAttackTime(self, point, routeLength(self.id, point));
      if (arrival <= t + tuning.defensePressure * 0.25) {
        const result = { point, time: t, arrival, reachable: true };
        interceptions.set(a.botId, result);
        return result;
      }
    }
    const result = { point: projected, time: tuning.defenseLookahead, arrival, reachable: false };
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
    if (passSupport) a.defense.passSupport = { ...passSupport, point: { ...passSupport.point } };
    if (strength > 0 && carrier) a.defense.individuality = {
      style: styleOf(a.botId), strength,
      reason: emergency ? 'Goal emergency overrides player preferences.'
        : contain ? 'Team containment overrides player preferences.'
        : mode === 'last-defender' ? 'Reserved goal-side coverage overrides player preferences.'
        : 'Keep team coverage when no similarly useful individual job is available.',
    };
    a.reason = `${mode}: ${emergency ? 'contest the scoring threat' : transition > 0 ? 'recover shape after possession loss' : contain ? 'hold the goal side until pressure is safe' : expiredMotion ? 'pressure the stationary carrier and protect the goal' : 'cut the carrier route and protect the goal'}`;
    if (passSupport) a.reason = `${mode}: ${mode === 'last-defender' ? 'protect the goal side of' : 'cover beside'} ${passSupport.receiverId}'s pass landing area`;
  };
  let safetyDestination = emergency ? anchor : safetyPoint;
  let safetyCarrierETA = 0;
  if (carrier?.space?.weapon === 'ball' && !carrierSafety && !emergency && !expiredMotion && !carrierRoute && tuning.defensePressure >= .4) {
    const self = players.find(p => p.id === safety.botId)!;
    const dx = self.pos.x - anchor.x, dz = self.pos.z - anchor.z;
    const fx = projected.x - anchor.x, fz = projected.z - anchor.z;
    const fraction = Math.max(0, Math.min(1, (dx * fx + dz * fz) / Math.max(.001, fx * fx + fz * fz)));
    const crossing = { x: anchor.x + fx * fraction, z: anchor.z + fz * fraction };
    // Do not keep moving the last defender's line away from an approaching
    // runner. A ready defender already covering a reachable cut can hold it
    // and let the existing strike-range counter take over, without tail chasing.
    // Teammates providing pressure do not invalidate that cut. An earned tanking
    // attack still needs its separately timed backup at the agreed safety point.
    if (self.space?.phase === 'ready' && self.space.mobileIn <= 0 &&
      dx * (goal.x - anchor.x) + dz * (goal.z - anchor.z) > 0 &&
      dx * carrier.vel.x + dz * carrier.vel.z > .5 * distance(self.pos, anchor) &&
      distance(self.pos, crossing) <= self.space.reach &&
      self.space.attackIn <= fraction * tuning.defenseLookahead + tuning.defensePressure * .25 &&
      carrier.space.mobileIn <= fraction * tuning.defenseLookahead &&
      isSpaceSegmentOpen(snapshot.geometry!, self.pos, anchor)) {
      safetyDestination = { ...self.pos };
      safetyCarrierETA = fraction * tuning.defenseLookahead;
    }
  }
  assign(safety, 'last-defender', safetyDestination, carrier, safetyCarrierETA);
  if (safetyDestination !== safetyPoint && !emergency) safety.reason = 'last-defender: hold the goal-side cut against the approaching runner';
  safety.role = 'safety';
  const rest = defenders.filter(a => a !== safety);
  if (!carrier) {
    const slots = rest.map((a, i) => {
      const center = toward(anchor, goal, passSupport ? tuning.passSupportDepth : 4), d = Math.max(0.001, distance(anchor, goal));
      const side = (i % 2 ? -1 : 1) * tuning.lateralSpacing * (1 + Math.floor(i / 2));
      return { a, side, point: { x: center.x - (goal.z - anchor.z) / d * side, z: center.z + (goal.x - anchor.x) / d * side } };
    });
    // Retain earlier personal choices and later team slots, so each choice has
    // space without moving the receiver, safety or an earned tanking assignment.
    const reserved = assignments.filter(a => !rest.includes(a)).map(a => a.destination);
    for (const slot of slots) {
      const choice = passSupport ? chooseGrifballPassSupportPosition({ snapshot, botId: slot.a.botId, support: passSupport,
        tuning, routers, teamPoint: slot.point, goal, side: slot.side,
        reserved: [...reserved, ...slots.filter(other => other !== slot).map(other => other.point)] }) : { point: slot.point };
      slot.point = choice.point;
      assign(slot.a, 'recover', choice.point, undefined);
      if (choice.individuality) {
        slot.a.defense!.passSupport!.individuality = choice.individuality;
        slot.a.reason += `; ${choice.individuality.reason}`;
      }
    }
    return;
  }
  // A lone defender keeps its goal-side line; no secondary pressure or marks.
  if (!rest.length) return;
  rest.sort((a, b) => {
    const aReachable = reachable.includes(a), bReachable = reachable.includes(b);
    // Contest the earliest feasible cut. Distance to the horizon's endpoint can
    // otherwise send the nearby defender away to mark while a later one chases.
    // At the same sampled cut, readiness precedes proximity: the closer actor
    // may still be recovering or airborne while another can already attack.
    return Number(bReachable) - Number(aReachable) || (aReachable && bReachable ?
      interception(a).time - interception(b).time ||
      interception(a).arrival - interception(b).arrival ||
      routeLength(a.botId, interception(a).point) - routeLength(b.botId, interception(b).point) : 0) ||
      routeLength(a.botId, projected) - routeLength(b.botId, projected) || a.botId.localeCompare(b.botId);
  });
  let pressureCandidates: DefensePressureCandidate[] | undefined;
  if (strength > 0 && !contain && !emergency && !carrierSafety) {
    const first = interception(rest[0]);
    const scoringDeadline = routeLength(carrier.id, goal) / Math.max(.1, carrier.space?.speed ?? 5.8);
    pressureCandidates = rest.map(a => {
      const cut = interception(a), style = styleOf(a.botId);
      // An opening must survive until both the defender and carrier reach the cut.
      const opening = recoveryOpening(a.botId, carrier, Math.max(cut.time, cut.arrival));
      // Compare only defenders who can make the SAME earliest cut. A preference
      // cannot exchange the only viable interceptor for a later or blocked one.
      const eligible = first.reachable && cut.reachable && cut.time === first.time &&
        cut.arrival <= first.arrival + .25 && cut.arrival <= scoringDeadline;
      return { botId: a.botId, style, arrival: cut.arrival, recoveryOpening: opening,
        bonus: eligible ? grifballDefenseStyleBonus(style, strength, 'pressure', opening) : 0, eligible,
        reason: !cut.reachable ? 'Cannot reach a timely cut.'
          : cut.time !== first.time ? 'Would miss the earliest cut.'
          : cut.arrival > scoringDeadline ? 'Would miss the scoring deadline.'
          : !eligible ? 'Arrival is more than 0.25 s behind the first defender.'
          : 'Can contest the earliest cut within the readiness margin.' };
    });
    const preferred = pressureCandidates.filter(c => c.eligible)
      .sort((a, b) => (a.arrival - a.bonus) - (b.arrival - b.bonus))[0];
    if (preferred) {
      const index = rest.findIndex(a => a.botId === preferred.botId);
      rest.unshift(...rest.splice(index, 1));
    }
  }
  if (emergency) {
    const arrival = (a: GrifballAssignment) => estimateSpaceAttackTime(
      players.find(p => p.id === a.botId)!, anchor, routeLength(a.botId, anchor));
    const deadline = routeLength(carrier.id, goal) / Math.max(.1, carrier.space?.speed ?? 5.8);
    // Keep a viable goal-side challenger. Override only a missed scoring deadline,
    // rather than shuffling viable assignments for small readiness differences.
    if (Number.isFinite(deadline) && arrival(rest[0]) > deadline) {
      const timely = rest.filter(a => arrival(a) <= deadline)
        .sort((a, b) => arrival(a) - arrival(b) || a.botId.localeCompare(b.botId))[0];
      if (timely) { rest.splice(rest.indexOf(timely), 1); rest.unshift(timely); }
    }
  }
  if (!carrierSafety) {
    const primary = rest.shift()!, intercept = interception(primary);
    const containment = toward(projected, goal, containmentDepth);
    assign(primary, contain ? 'contain' : 'intercept', emergency ? anchor : contain ? containment : intercept.point, carrier, intercept.time);
    primary.role = 'chaser';
    if (primary.defense!.individuality && pressureCandidates) {
      primary.defense!.individuality.pressureCandidates = pressureCandidates;
      primary.defense!.individuality.reason = pressureCandidates.some(c => c.eligible && c.bonus !== 0)
        ? 'Player preference ranks timely defenders at the same earliest cut; goal coverage stays reserved.'
        : 'Team interception timing remains decisive; no eligible style advantage.';
    }
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
      const coverageDistance = routeLength(a.botId, point);
      const baseCost = coverageDistance -
        (old?.mode === 'mark' && old.targetId === target.id ? tuning.reassignmentAdvantage : 0);
      const self = players.find(p => p.id === a.botId)!;
      const coverageETA = Math.max(self.space?.mobileIn ?? Infinity,
        coverageDistance / Math.max(.1, self.space?.speed ?? 0)) + (self.space?.attackIn ?? Infinity);
      const opening = strength > 0 && !contain && !emergency && recoveryOpening(a.botId, target, coverageETA);
      const bonus = !contain && !emergency ? grifballDefenseStyleBonus(styleOf(a.botId), strength, 'mark', opening) : 0;
      return { assignment: a, baseCost, bonus, recoveryOpening: opening, cost: baseCost - bonus };
    }).filter(c => Number.isFinite(c.cost))
      .sort((a, b) => a.cost - b.cost || a.assignment.botId.localeCompare(b.assignment.botId));
    const choice = choices[0], marker = choice?.assignment;
    if (marker) {
      assign(marker, 'mark', point, target); available.delete(marker);
      if (marker.defense!.individuality && !contain && !emergency) {
        marker.defense!.individuality.marking = { baseCost: choice.baseCost, bonus: choice.bonus, recoveryOpening: choice.recoveryOpening };
        marker.defense!.individuality.reason = 'Pair reachable escort marks by coverage distance and player preference, retaining useful existing marks.';
      }
    }
  }
  [...available].forEach((a, i) => {
    const d = Math.max(0.001, distance(anchor, goal)), side = (i % 2 ? -1 : 1) * tuning.lateralSpacing;
    assign(a, 'recover', { x: safetyPoint.x - (goal.z - anchor.z) / d * side, z: safetyPoint.z + (goal.x - anchor.x) / d * side }, carrier);
  });
  applyGrifballMarkPosition(snapshot, assignments, tuning, routers, contain);
}

export function selectDefenseThreat(a: GrifballAssignment, self: FieldPoint, players: GrifballTacticalPlayer[]): string | null {
  const order = a.defense!;
  const enemies = players.filter(p => p.team !== a.team && (!a.geometry || isSpaceSegmentOpen(a.geometry, self, p.pos)));
  const immediate = enemies.filter(p => distance(self, p.pos) <= 2.5 || ['swing_up', 'swing_down', 'slashing'].includes(p.space?.phase ?? '') && distance(self, p.pos) <= (p.space?.reach ?? 3))
    .sort((x, y) => distance(self, x.pos) - distance(self, y.pos) || x.id.localeCompare(y.id));
  if (immediate.length) return immediate[0].id;
  const target = enemies.find(p => p.id === order.targetId);
  if (!target) return null;
  const defender = players.find(p => p.id === a.botId);
  const reach = defender?.space?.reach ?? 3;
  const inEngagementRange = distance(self, target.pos) <= (a.tuning?.engagementDistance ?? 6);
  // A closing carrier can enter the safety's current strike reach well before
  // the projected goal-side destination. Counter from that position instead of
  // withdrawing until the runner can punch. Do not release a tail chase, a
  // stationary/retreating target, or a defender still recovering/airborne.
  const dx = self.x - target.pos.x, dz = self.z - target.pos.z;
  if (order.mode === 'last-defender' && target.id === a.carrierId && target.space?.weapon === 'ball' &&
    defender?.space?.phase === 'ready' && defender.space.mobileIn <= 0 && inEngagementRange && distance(self, target.pos) <= reach &&
    dx * target.vel.x + dz * target.vel.z > 0 &&
    dx * (order.intercept.x - target.pos.x) + dz * (order.intercept.z - target.pos.z) > 0) return target.id;
  const emergency = order.emergency && target.id === a.carrierId;
  if (!emergency && ['contain', 'last-defender', 'recover'].includes(order.mode)) return null;
  // Intercept first; switching to a duel early would turn the cut into tail pursuit.
  // Own reach is a bound, not permission to abandon the cut from farther away.
  // Preserve the target-threat approach distance as well: a long-range hammer
  // must still establish its interception before switching to pursuit.
  const handoffDistance = Math.max(1, Math.min(reach, target.space?.reach ?? 3));
  return inEngagementRange &&
    (emergency || distance(self, order.intercept) <= handoffDistance) ? target.id : null;
}
