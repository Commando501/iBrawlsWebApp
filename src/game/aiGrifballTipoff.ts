import type {
  FieldPoint,
  GrifballAssignment,
  GrifballTacticalPlayer,
  GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import type { SpaceRouters } from './aiGrifballRunner';
import { BALL_REST_Y } from './grifballBall';
import { fieldDistance as distance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { resolveGrifballTipoffAgency, type TipoffAgencyDecision } from './aiGrifballTipoffAgency';
import { applyGrifballTipoffPosition, type TipoffPositionDecision } from './aiGrifballTipoffPosition';
import { chooseTipoffScreen, tipoffScreenReadiness, type TipoffScreenDecision } from './aiGrifballTipoffScreen';
import { chooseTipoffCollector, type TipoffCollectorDecision } from './aiGrifballTipoffCollector';
import { chooseTipoffReserve, isTipoffReserveCovering, type TipoffReserveDecision } from './aiGrifballTipoffReserve';
import { planTipoffLanes, type TipoffLaneDecision } from './aiGrifballTipoffLanes';
import {
  applyGrifballTipoffReservePosition,
  type TipoffReservePositionDecision,
} from './aiGrifballTipoffReservePosition';
import { observedGrifballPickupHasPriority } from './aiGrifballPickupAgency';
import { chooseTipoffTarget, type TipoffTargetDecision } from './aiGrifballTipoffTarget';
import {
  resolveGrifballTipoffRecoveryAgency,
  type TipoffRecovery,
  type TipoffRecoveryDecision,
  type TipoffRecoveryAgencyDecision,
} from './aiGrifballTipoffRecovery';

export interface TipoffMemory {
  round: number;
  started: boolean;
  closed: boolean;
  elapsed: number;
  recovery?: Record<string, TipoffRecovery>;
}
export interface TipoffOrder {
  job: 'collector' | 'screen' | 'support' | 'reserve';
  phase: 'claim' | 'contest' | 'contain' | 'regroup';
  collectorId: string;
  reserveId: string | null;
  targetId: string | null;
  attack: boolean;
  pickupETA: number;
  enemyAttackETA: number;
  spacing: number;
  elapsed: number;
  reason: string;
  agency?: TipoffAgencyDecision;
  positioning?: TipoffPositionDecision;
  recovery?: TipoffRecoveryDecision;
  recoveryAgency?: TipoffRecoveryAgencyDecision;
  screenSelection?: TipoffScreenDecision;
  targetSelection?: TipoffTargetDecision;
  collectorSelection?: TipoffCollectorDecision;
  reserveSelection?: TipoffReserveDecision;
  reservePosition?: TipoffReservePositionDecision;
  laneSelection?: TipoffLaneDecision;
}

/** Once per round, from a known untouched home ball. Observing possession or a
 * displaced ball closes the opening even while the control is disabled. */
export function observeGrifballTipoff(
  memory: TipoffMemory | undefined,
  snapshot: GrifballTacticalSnapshot,
  dt: number,
): TipoffMemory {
  const next =
    memory?.round === snapshot.round ? memory : { round: snapshot.round, started: false, closed: false, elapsed: 0 };
  const ball = snapshot.ballPhysics;
  if (next.closed) return next;
  if (!snapshot.playing) {
    if (next.started) next.closed = true;
    return next;
  }
  if (
    snapshot.holderId ||
    !ball ||
    ball.state !== 'idle' ||
    distance(ball.pos, ball.home) > 0.5 ||
    ball.pos.y > BALL_REST_Y + 0.01 ||
    Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) > 0.01
  ) {
    next.closed = true;
    return next;
  }
  if (!next.started && ball.looseTimer > 0.5) {
    next.closed = true;
    return next;
  }
  next.started = true;
  next.elapsed += Math.max(0, dt);
  return next;
}

const grounded = (p: GrifballTacticalPlayer) =>
  !!p.space && (p.height ?? 0) <= 0.01 && p.space.mobileIn <= 0 && p.space.phase !== 'lunging';

/** Lower-bound enemy attack times are deliberately conservative between planner
 * refreshes: a wall never grants permission to run into an otherwise unsafe pickup. */
export function tipoffPickupAllowed(
  a: GrifballAssignment,
  pos: FieldPoint,
  players: GrifballTacticalPlayer[],
  ball: FieldPoint,
): boolean {
  const self = players.find((p) => p.id === a.botId),
    margin = a.tipoff?.agency?.pickupMargin ?? a.tuning?.tipoffPickupMargin ?? 0.35;
  if (!self || !grounded(self) || (a.tipoff?.collectorSelection && tipoffScreenReadiness(self) !== 'ready'))
    return false;
  const arrival = distance(pos, ball) / Math.max(0.1, self.space!.speed);
  return players
    .filter((p) => p.team !== a.team)
    .every((p) => estimateSpaceAttackTime(p, ball, distance(p.pos, ball)) >= arrival + margin);
}

/** Opening orders own positioning and combat permission together. No order is
 * issued to an observed human/neural teammate, even when they own the pickup. */
export function applyGrifballTipoff(
  snapshot: GrifballTacticalSnapshot,
  assignments: GrifballAssignment[],
  tuning: TeamTactics,
  routers: SpaceRouters,
  memory: TipoffMemory,
  previous: Map<string, GrifballAssignment>,
): boolean {
  if (
    !tuning.tipoffEnabled ||
    !tuning.enabled ||
    !tuning.spaceEnabled ||
    !memory.started ||
    memory.closed ||
    memory.elapsed > tuning.tipoffSeconds ||
    !assignments.length ||
    !snapshot.geometry ||
    snapshot.holderId
  )
    return false;
  const team = assignments[0].team,
    goal = snapshot.goals[team];
  if (!goal) return false;
  const allies = snapshot.players.filter((p) => p.team === team),
    enemies = snapshot.players.filter((p) => p.team !== team);
  const bot = (a: GrifballAssignment) => allies.find((p) => p.id === a.botId)!;
  const travel = (p: GrifballTacticalPlayer, point: FieldPoint) => {
    const route = routers.get(p.id)?.(point, true);
    return !route || route.status === 'blocked'
      ? Infinity
      : Math.max(0, p.space?.mobileIn ?? 0) + route.length / Math.max(0.1, p.space?.speed ?? 5.2);
  };
  let collection = assignments.find((a) => a.role === 'retriever');
  const baselineCollection = collection;
  const enemyAttackETA = Math.min(
    Infinity,
    ...enemies.map((p) => estimateSpaceAttackTime(p, snapshot.ball, routers.get(p.id)!(snapshot.ball, true).length)),
  );
  let collectorSelection: TipoffCollectorDecision | undefined;
  if (collection && tuning.tipoffCollectorHandoffEnabled) {
    const previousId =
      [...previous.values()].find((a) => a.team === team && a.tipoff?.job === 'collector')?.botId ?? null;
    collectorSelection = chooseTipoffCollector(
      assignments.map((a) => {
        const p = bot(a),
          old = previous.get(a.botId)?.tipoff;
        const arrival = travel(p, snapshot.ball);
        let rejection: string | null = null;
        if (tipoffScreenReadiness(p) !== 'ready') rejection = 'Ground mobility and a ready weapon are required.';
        else if (!Number.isFinite(arrival)) rejection = 'No reachable route to the opening ball.';
        else if (old?.job === 'reserve') rejection = 'Keep the rear reserve in coverage.';
        else if (old?.job === 'screen' && old.attack) rejection = 'Keep the screen on its current challenge.';
        else if (
          old?.job !== 'collector' &&
          resolveGrifballTipoffRecoveryAgency(
            memory.recovery?.[team],
            memory.elapsed,
            tuning,
            snapshot.tactics?.botStyles,
            p.id,
          )?.holding
        )
          rejection = 'Finish the personal regroup interval before collecting.';
        else if (
          observedGrifballPickupHasPriority(allies, p, snapshot.ball, (other) =>
            Number.isFinite(routers.get(other.id)?.(snapshot.ball, true).length),
          )
        )
          rejection = 'Observed human or neural pursuit has pickup priority.';
        const pickupMargin =
          tuning.tipoffCollectorAgencyStrength > 0
            ? (resolveGrifballTipoffAgency(tuning, snapshot.tactics?.botStyles, p.id)?.pickupMargin ??
              tuning.tipoffPickupMargin)
            : tuning.tipoffPickupMargin;
        return {
          botId: p.id,
          arrival,
          rejection,
          ...(tuning.tipoffCollectorAgencyStrength > 0
            ? { pickupSafe: Number.isFinite(arrival) && enemyAttackETA >= arrival + pickupMargin }
            : {}),
        };
      }),
      collection.botId,
      previousId,
      tuning.tipoffCollectorAdvantage,
      { strength: tuning.tipoffCollectorAgencyStrength, styles: snapshot.tactics?.botStyles ?? {} },
    );
    collection = assignments.find((a) => a.botId === collectorSelection!.selectedId);
  }
  // The ordinary retriever selection has already yielded to observed pursuit.
  const collector = collection
    ? bot(collection)
    : // A nominal reference keeps the opening geometry available while every bot
      // holds coverage. No collector job or pickup is issued without eligibility.
      collectorSelection
      ? bot(baselineCollection!)
      : allies
          .filter(
            (p) =>
              !p.scripted &&
              (p.pickupRequested ||
                (distance(p.pos, snapshot.ball) <= 10 &&
                  (snapshot.ball.x - p.pos.x) * p.vel.x + (snapshot.ball.z - p.pos.z) * p.vel.z >
                    0.5 * distance(p.pos, snapshot.ball))),
          )
          .sort((a, b) => travel(a, snapshot.ball) - travel(b, snapshot.ball) || a.id.localeCompare(b.id))[0];
  if (!collector) return false;
  const pickupETA =
    grounded(collector) && (!collectorSelection || collectorSelection.selectedId === collector.id)
      ? travel(collector, snapshot.ball)
      : Infinity;
  const collectorAgency = collection
    ? resolveGrifballTipoffAgency(tuning, snapshot.tactics?.botStyles, collector.id)
    : undefined;
  const teamClaim = Number.isFinite(pickupETA) && enemyAttackETA >= pickupETA + tuning.tipoffPickupMargin;
  const claim =
    Number.isFinite(pickupETA) &&
    enemyAttackETA >= pickupETA + (collectorAgency?.pickupMargin ?? tuning.tipoffPickupMargin);
  const goalDistance = distance(snapshot.ball, goal),
    dx = (goal.x - snapshot.ball.x) / Math.max(0.001, goalDistance),
    dz = (goal.z - snapshot.ball.z) / Math.max(0.001, goalDistance);
  const nearby = enemies.filter((p) => distance(p.pos, snapshot.ball) <= 18);
  const spacing = Math.max(
    tuning.tipoffSpacing,
    tuning.separation,
    ...nearby.map((p) => (p.space?.blastRadius ?? 0) * 2 + 0.75),
  );
  const reach = Math.max(3, ...nearby.map((p) => Math.max(p.space?.reach ?? 3, p.space?.lungeReach ?? 0)));
  const point = (depth: number, side: number): FieldPoint => ({
    x: snapshot.ball.x + dx * Math.min(depth, goalDistance * 0.85) - dz * side,
    z: snapshot.ball.z + dz * Math.min(depth, goalDistance * 0.85) + dx * side,
  });
  const support = assignments.filter((a) => a !== collection);
  const reservePoint = point(Math.max(tuning.defenseSafetyDepth, reach + 1.5 + spacing), 0);
  const ranked = [...support]
    .filter((a) => grounded(bot(a)) && Number.isFinite(travel(bot(a), reservePoint)))
    .sort(
      (a, b) =>
        Number(previous.get(b.botId)?.tipoff?.job === 'reserve') -
          Number(previous.get(a.botId)?.tipoff?.job === 'reserve') ||
        (bot(b).pos.x - bot(a).pos.x) * dx + (bot(b).pos.z - bot(a).pos.z) * dz ||
        travel(bot(a), reservePoint) - travel(bot(b), reservePoint) ||
        a.botId.localeCompare(b.botId),
    );
  const reserveSelection = tuning.tipoffReserveHandoffEnabled
    ? chooseTipoffReserve(
        assignments.map((a) => {
          const p = bot(a),
            old = previous.get(a.botId)?.tipoff;
          const arrival = travel(p, reservePoint);
          const rejection =
            a === collection
              ? 'Keep the collector on the opening ball.'
              : tipoffScreenReadiness(p) !== 'ready'
                ? 'Ground mobility and a ready weapon are required.'
                : !Number.isFinite(arrival)
                  ? 'No reachable route to the rear lane.'
                  : old?.job === 'screen' && old.attack
                    ? 'Let the assigned screen challenge finish before taking rear coverage.'
                    : null;
          return {
            botId: p.id,
            arrival,
            rejection,
            covered: !rejection && isTipoffReserveCovering(p, snapshot.ball, reservePoint, spacing / 2),
          };
        }),
        [...previous.values()].find((a) => a.team === team && a.tipoff?.job === 'reserve')?.botId ?? null,
        reservePoint,
        spacing / 2,
        { strength: tuning.tipoffReserveAgencyStrength, styles: snapshot.tactics?.botStyles ?? {} },
      )
    : undefined;
  const reserve = reserveSelection ? support.find((a) => a.botId === reserveSelection.selectedId) : ranked[0];
  const available = allies.filter((p) => grounded(p) && Number.isFinite(travel(p, snapshot.ball)));
  const localAllies = available.filter((p) => distance(p.pos, snapshot.ball) <= 18);
  const recovering = memory.recovery?.[team];
  const recovery =
    recovering && tuning.tipoffRegroupSeconds > 0 && memory.elapsed + 1e-9 < recovering.startedAt + recovering.duration
      ? {
          startedAt: recovering.startedAt,
          duration: recovering.duration,
          reason: recovering.reason,
          affectedIds: [...recovering.affectedIds],
          remaining: recovering.startedAt + recovering.duration - memory.elapsed,
        }
      : undefined;
  const contain =
    !!recovery ||
    collectorSelection?.selectedId === null ||
    (reserveSelection && !reserveSelection.covered) ||
    available.length < 3 ||
    nearby.length > localAllies.length;
  const phase = recovery ? 'regroup' : claim ? 'claim' : contain ? 'contain' : 'contest';
  const slots = new Map<GrifballAssignment, FieldPoint>();
  if (collection) slots.set(collection, claim ? { ...snapshot.ball } : point(reach + 1.5, 0));
  if (reserve) slots.set(reserve, reservePoint);
  const remaining = support
    .filter((a) => a !== reserve)
    .sort(
      (a, b) =>
        Number(previous.get(b.botId)?.tipoff?.job === 'screen') -
          Number(previous.get(a.botId)?.tipoff?.job === 'screen') ||
        travel(bot(a), snapshot.ball) - travel(bot(b), snapshot.ball) ||
        a.botId.localeCompare(b.botId),
    );
  const personalRecovery = new Map(
    remaining.map((a) => [
      a.botId,
      resolveGrifballTipoffRecoveryAgency(recovering, memory.elapsed, tuning, snapshot.tactics?.botStyles, a.botId),
    ]),
  );
  const screenSelection = tuning.tipoffScreenHandoffEnabled
    ? chooseTipoffScreen(
        remaining.map((a) => ({
          player: bot(a),
          reachable: Number.isFinite(travel(bot(a), snapshot.ball)),
          holding: !!personalRecovery.get(a.botId)?.holding,
          arrival: travel(bot(a), snapshot.ball),
          recoveryOpening:
            tuning.tipoffScreenAgencyStrength > 0 &&
            nearby.some((p) => {
              if (
                !p.space?.phase.includes('recover') ||
                distance(p.pos, snapshot.ball) > spacing + tuning.engagementDistance
              )
                return false;
              const eta = estimateSpaceAttackTime(bot(a), p.pos, routers.get(a.botId)!(p.pos, true).length);
              const response = estimateSpaceAttackTime(p, bot(a).pos, routers.get(p.id)!(bot(a).pos, true).length);
              return Number.isFinite(eta) && eta <= tuning.threatHorizon + 1 && eta <= response + 0.1;
            }),
        })),
        [...previous.values()].find((a) => a.team === team && a.tipoff?.job === 'screen')?.botId ?? null,
        !!reserve && !contain,
        { strength: tuning.tipoffScreenAgencyStrength, styles: snapshot.tactics?.botStyles ?? {} },
      )
    : undefined;
  const screen = screenSelection
    ? remaining.find((a) => a.botId === screenSelection.selectedId)
    : reserve && !contain
      ? remaining.find((a) => !personalRecovery.get(a.botId)?.holding)
      : undefined;
  const screenAgency = screen
    ? resolveGrifballTipoffAgency(tuning, snapshot.tactics?.botStyles, screen.botId)
    : undefined;
  const sideOf = (p: FieldPoint) => Math.sign(-dz * (p.x - snapshot.ball.x) + dx * (p.z - snapshot.ball.z)) || 1;
  const firstSide = remaining[0] ? sideOf(bot(remaining[0]).pos) : 1;
  const laneDepth = (a: GrifballAssignment) =>
    contain || personalRecovery.get(a.botId)?.holding ? reach + spacing : a === screen ? 2 : reach + 1.5;
  remaining.forEach((a, i) =>
    slots.set(a, point(laneDepth(a), firstSide * (i % 2 ? -1 : 1) * spacing * (1 + Math.floor(i / 2)))),
  );
  const laneSelections = tuning.tipoffLaneContinuityEnabled
    ? planTipoffLanes({
        snapshot,
        remaining,
        slots,
        previous,
        tuning,
        routers,
        collectorId: collector.id,
        spacing,
        firstSide,
        point,
        depth: laneDepth,
      })
    : undefined;
  // A small roster may consist only of the collector; no fictitious reserve.
  // Keep all destinations reachable or keep that bot at its current position.
  for (const [a, destination] of slots)
    if (!Number.isFinite(travel(bot(a), destination))) slots.set(a, { ...bot(a).pos });
  let target: GrifballTacticalPlayer | undefined,
    attack = false,
    teamAttack = false;
  let targetSelection: TipoffTargetDecision | undefined;
  if (screen && !claim) {
    const self = bot(screen);
    const candidates = nearby
      .filter((p) => distance(p.pos, snapshot.ball) <= spacing + tuning.engagementDistance)
      .map((p) => ({
        p,
        eta: estimateSpaceAttackTime(self, p.pos, routers.get(self.id)!(p.pos, true).length),
      }))
      .filter((c) => Number.isFinite(c.eta))
      .sort((a, b) => a.eta - b.eta || a.p.id.localeCompare(b.p.id));
    const evaluate = ({ p: target, eta }: (typeof candidates)[number]) => {
      const d = distance(self.pos, target.pos),
        stand = Math.max(1, (self.space?.reach ?? 3) * 0.75);
      const engage = {
        x: target.pos.x + ((self.pos.x - target.pos.x) / Math.max(0.001, d)) * stand,
        z: target.pos.z + ((self.pos.z - target.pos.z) / Math.max(0.001, d)) * stand,
      };
      const protectedPoints = [...slots]
        .filter(([a]) => a !== screen)
        .map(([, p]) => p)
        .concat(allies.filter((p) => !p.scripted).map((p) => p.pos));
      const separate =
        protectedPoints.every((p) => distance(p, engage) >= spacing) &&
        allies
          .filter((p) => p.id !== self.id)
          .every(
            (p) =>
              !nearby.some(
                (e) =>
                  (e.space?.blastRadius ?? 0) > 0 &&
                  estimateSpaceAttackTime(e, self.pos, distance(e.pos, self.pos)) < tuning.threatHorizon &&
                  distance(p.pos, self.pos) < e.space!.blastRadius * 2 + 0.5,
              ),
          );
      const response = estimateSpaceAttackTime(target, self.pos, routers.get(target.id)!(self.pos, true).length);
      const rejection =
        !grounded(self) || self.space!.phase !== 'ready' || !reserve || !grounded(bot(reserve))
          ? 'Screen or reserve is not ready.'
          : !separate
            ? 'Teammate spacing or shared hammer exposure is unsafe.'
            : !Number.isFinite(travel(self, engage))
              ? 'The challenge position is unreachable.'
              : eta > tuning.threatHorizon + 1
                ? 'The challenge is too far away.'
                : eta > response + 0.1
                  ? 'The enemy can attack before the screen arrives.'
                  : null;
      const personalRejection =
        rejection ??
        (eta + (screenAgency?.challengeCushion ?? 0) > response + 0.1
          ? 'The screen needs a clearer personal challenge window.'
          : null);
      return {
        p: target,
        eta,
        engage,
        response,
        teamAttack: !rejection,
        attack: !personalRejection,
        targetId: target.id,
        rejection: personalRejection,
        contestsBall: distance(target.pos, snapshot.ball) <= 4,
        threatensCollector:
          estimateSpaceAttackTime(target, collector.pos, routers.get(target.id)!(collector.pos, true).length) <=
          tuning.threatHorizon,
        recovering: target.space?.phase.includes('recover') ?? false,
      };
    };
    // At zero, preserve the original single-candidate choice exactly. Positive
    // strength checks alternatives before applying bounded style preferences.
    const evaluated = (tuning.tipoffTargetAgencyStrength > 0 ? candidates : candidates.slice(0, 1)).map(evaluate);
    const oldOrder = previous.get(self.id)?.tipoff;
    if (tuning.tipoffTargetAgencyStrength > 0)
      targetSelection = chooseTipoffTarget(
        evaluated.map(({ p, engage, teamAttack, attack, ...c }) => c),
        tuning.tipoffTargetAgencyStrength,
        snapshot.tactics?.botStyles,
        self.id,
        {
          elapsed: memory.elapsed,
          seconds: tuning.tipoffTargetCommitSeconds,
          agencyStrength: tuning.tipoffTargetCommitAgencyStrength,
          previous:
            oldOrder?.job === 'screen' &&
            oldOrder.phase === 'contest' &&
            oldOrder.collectorId === collector.id &&
            oldOrder.reserveId === reserve?.botId
              ? oldOrder.targetSelection
              : undefined,
        },
      );
    const selected = targetSelection ? evaluated.find((c) => c.targetId === targetSelection.selectedId) : evaluated[0];
    target = selected?.p;
    teamAttack = selected?.teamAttack ?? false;
    attack = selected?.attack ?? false;
    if (attack && selected) slots.set(screen, selected.engage);
  }
  for (const a of assignments) {
    const job: TipoffOrder['job'] =
      a === collection ? 'collector' : a === reserve ? 'reserve' : a === screen ? 'screen' : 'support';
    const agency = a === collection ? collectorAgency : a === screen ? screenAgency : undefined;
    const recoveryAgency = personalRecovery.get(a.botId);
    const reason =
      job === 'collector'
        ? claim
          ? 'Take the pickup before an enemy can attack it.'
          : 'Hold outside the clash until the pickup has an attack margin.'
        : job === 'reserve'
          ? 'Keep a separate goal-side survivor and recovery route.'
          : job === 'screen'
            ? attack
              ? 'One screen challenges the contest; collector and reserve stay separate.'
              : 'Approach a separate lane; wait for a reachable, spaced combat opening.'
            : recoveryAgency?.holding && !recovery
              ? 'Hold a separate recovery lane until the personal regroup interval ends.'
              : recovery
                ? 'Restore a separate goal-side support lane before another opening challenge.'
                : contain
                  ? 'Numbers or readiness are insufficient; spread and contain the opening.'
                  : 'Keep a separate support lane instead of joining the same clash.';
    delete a.defense;
    delete a.escort;
    delete a.receive;
    delete a.pickupAgency;
    a.destination = { ...slots.get(a)! };
    a.role =
      job === 'collector' && claim ? 'retriever' : job === 'reserve' ? 'safety' : job === 'screen' ? 'lead' : 'cover';
    a.tipoff = {
      job,
      phase: recoveryAgency?.holding ? 'regroup' : phase,
      collectorId: collector.id,
      reserveId: reserve?.botId ?? null,
      targetId: a === screen ? (target?.id ?? null) : null,
      attack: a === screen && attack,
      pickupETA,
      enemyAttackETA,
      spacing,
      elapsed: memory.elapsed,
      reason,
      ...(recovery ? { recovery } : {}),
      ...(recoveryAgency ? { recoveryAgency } : {}),
      ...(screenSelection ? { screenSelection } : {}),
      ...(collectorSelection ? { collectorSelection } : {}),
      ...(reserveSelection ? { reserveSelection } : {}),
      ...(laneSelections?.has(a.botId) ? { laneSelection: laneSelections.get(a.botId)! } : {}),
      ...(a === screen && targetSelection ? { targetSelection } : {}),
      ...(agency
        ? {
            agency: {
              ...agency,
              changedDecision: a === collection ? claim !== teamClaim : attack !== teamAttack,
            },
          }
        : {}),
    };
    a.tanking = {
      mode: a.tipoff.attack ? 'engage' : contain || recoveryAgency?.holding ? 'delay' : 'cover',
      targetId: a.tipoff.targetId,
      partnerId: null,
      recoveryId: reserve?.botId ?? null,
      attack: a.tipoff.attack,
      doubleCommit: false,
      reason,
      candidates: [],
    };
    a.reason = `tip-off ${job}: ${reason}`;
  }
  applyGrifballTipoffReservePosition(snapshot, assignments, tuning, routers, contain);
  applyGrifballTipoffPosition(snapshot, assignments, tuning, routers, contain);
  return true;
}

/** Permit a single planned challenge near the ball; all other jobs only defend
 * themselves against immediate contacts. Refreshes can withdraw permission. */
export function selectGrifballTipoffThreat(
  a: GrifballAssignment,
  self: FieldPoint,
  players: GrifballTacticalPlayer[],
): string | null {
  const visible = players.filter(
    (p) => p.team !== a.team && (!a.geometry || isSpaceSegmentOpen(a.geometry, self, p.pos)),
  );
  const immediate = visible
    .filter(
      (p) =>
        distance(self, p.pos) <= 2.5 ||
        (['swing_up', 'swing_down', 'slashing'].includes(p.space?.phase ?? '') &&
          distance(self, p.pos) <= (p.space?.reach ?? 3)),
    )
    .sort((a, b) => distance(self, a.pos) - distance(self, b.pos) || a.id.localeCompare(b.id))[0];
  if (immediate) return immediate.id;
  const order = a.tipoff!,
    target = visible.find((p) => p.id === order.targetId);
  const reserve = players.find((p) => p.id === order.reserveId && p.team === a.team);
  const allies = players.filter((p) => p.team === a.team),
    attacker = allies.find((p) => p.id === a.botId);
  const nearby = visible.filter((p) => distance(p.pos, a.anchor) <= 18);
  if (
    !order.attack ||
    !target ||
    !attacker ||
    !grounded(attacker) ||
    !reserve ||
    !grounded(reserve) ||
    (order.reserveSelection &&
      !isTipoffReserveCovering(reserve, a.anchor, order.reserveSelection.point, order.reserveSelection.halfWidth)) ||
    // A clearer timing window must still exist when the combat adapter consumes
    // the order. Immediate self-defense above never waits for a style preference.
    (((order.agency?.challengeCushion ?? 0) > 0 || order.targetSelection) &&
      estimateSpaceAttackTime(attacker, target.pos, distance(self, target.pos)) +
        (order.agency?.challengeCushion ?? 0) >
        estimateSpaceAttackTime(target, self, distance(self, target.pos)) + 0.1) ||
    (order.targetSelection &&
      estimateSpaceAttackTime(attacker, target.pos, distance(self, target.pos)) >
        (a.tuning?.threatHorizon ?? 1.5) + 1) ||
    allies.filter(grounded).length < 3 ||
    nearby.length > allies.filter((p) => grounded(p) && distance(p.pos, a.anchor) <= 18).length ||
    nearby.some(
      (e) =>
        (e.space?.blastRadius ?? 0) > 0 &&
        estimateSpaceAttackTime(e, self, distance(e.pos, self)) < (a.tuning?.threatHorizon ?? 1.5) &&
        allies.some((p) => p.id !== a.botId && distance(p.pos, self) < e.space!.blastRadius * 2 + 0.5),
    ) ||
    distance(target.pos, a.anchor) > order.spacing + (a.tuning?.engagementDistance ?? 6) ||
    distance(self, target.pos) > (a.tuning?.engagementDistance ?? 6) ||
    distance(self, a.destination) > (a.tuning?.coverageBoundary ?? 9)
  )
    return null;
  return target.id;
}
