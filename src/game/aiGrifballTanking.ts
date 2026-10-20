import { chooseTacticalAlternative, type TacticalChoice } from './aiGrifballStyle';
import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { RunnerPlan, SpaceRouters } from './aiGrifballRunner';
import type { TeamTactics } from './grifballTacticsConfig';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { grifballPlayerStyleBonus, resolveGrifballPlayerStyle } from './grifballPlayerStyles';
import { supportInitiativeStillUseful } from './aiGrifballAgency';

export type TankingMode = 'engage' | 'punish' | 'cover' | 'delay' | 'release';
export interface EngagementScore {
  targetId: string; score: number; protection: number; opening: number; delay: number;
  trade: number; coverageLost: number; attackETA: number; opponentETA: number; purpose: number;
}
export interface TankingOrder {
  mode: TankingMode; targetId: string | null; partnerId: string | null; recoveryId: string | null;
  attack: boolean; doubleCommit: boolean; reason: string; candidates: EngagementScore[];
}
export interface TankingMemory {
  targetId: string | null; primaryId: string | null; commitment: number;
  releaseRemaining: Record<string, number>;
}
export function tickTankingMemory(memory: TankingMemory | undefined, dt: number): TankingMemory {
  const next = memory ?? { targetId: null, primaryId: null, commitment: 0, releaseRemaining: {} };
  next.commitment = Math.max(0, next.commitment - Math.max(0, dt));
  for (const id of Object.keys(next.releaseRemaining)) {
    next.releaseRemaining[id] -= Math.max(0, dt);
    if (next.releaseRemaining[id] <= 0) delete next.releaseRemaining[id];
  }
  return next;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const recovering = (p: GrifballTacticalPlayer) => p.space?.phase.includes('recover') === true;
const toward = (from: FieldPoint, to: FieldPoint, distance: number): FieldPoint => {
  const length = fieldDistance(from, to);
  return length > 0.001 ? { x: from.x + (to.x - from.x) / length * distance, z: from.z + (to.z - from.z) / length * distance } : { ...from };
};
const segmentDistance = (p: FieldPoint, a: FieldPoint, b: FieldPoint) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / Math.max(0.001, dx * dx + dz * dz));
  return fieldDistance(p, { x: a.x + dx * t, z: a.z + dz * t });
};

/** One shared engagement owner per team; combat mechanics still decide and execute attacks. */
export function applyGrifballTanking(snapshot: GrifballTacticalSnapshot, assignments: GrifballAssignment[], runner: RunnerPlan | undefined,
  tuning: TeamTactics, memory: TankingMemory, routers: SpaceRouters, previous: Map<string, GrifballAssignment>, choice?: TacticalChoice): void {
  if (!assignments.length) return;
  const team = assignments[0].team, ownGoal = snapshot.goals[team]!;
  const teammates = snapshot.players.filter(p => p.team === team);
  const enemies = snapshot.players.filter(p => p.team !== team).sort((a, b) => a.id.localeCompare(b.id));
  const carrier = snapshot.players.find(p => p.id === snapshot.holderId);
  const friendly = carrier?.team === team;
  const anchor = carrier?.pos ?? snapshot.ball;
  const support = assignments.filter(a => a.role !== 'runner' && a.role !== 'retriever');
  const actor = (a: GrifballAssignment) => teammates.find(p => p.id === a.botId)!;
  const eta = (p: GrifballTacticalPlayer, point: FieldPoint) => estimateSpaceAttackTime(p, point, routers.get(p.id)!(point, true).length);
  const emergency = !!carrier && !friendly && fieldDistance(carrier.pos, ownGoal) <= tuning.tankEmergencyDistance;
  const scores = new Map<string, EngagementScore[]>();
  const heading = runner?.heading ?? (() => { const goal = snapshot.goals[team === 'blue' ? 'red' : 'blue']!; const end = toward(anchor, goal, 1); return { x: end.x - anchor.x, z: end.z - anchor.z }; })();
  const routePoints = runner?.selected.route.points ?? [toward(anchor, snapshot.goals[team === 'blue' ? 'red' : 'blue']!, tuning.runnerLookahead)];
  for (const a of support) {
    const bot = actor(a);
    scores.set(a.botId, enemies.map(enemy => {
      const attackETA = eta(bot, enemy.pos), opponentETA = eta(enemy, bot.pos);
      const anchorETA = eta(enemy, anchor);
      const projection = (enemy.pos.x - anchor.x) * heading.x + (enemy.pos.z - anchor.z) * heading.z;
      const obsolete = friendly && projection < -tuning.tankReleaseDistance && anchorETA > tuning.threatHorizon;
      let protection = carrier ? friendly ? clamp(1 - anchorETA / Math.max(0.1, tuning.threatHorizon + 1)) : enemy.id === carrier.id ? 1 : 0 : 0;
      let opening = 0;
      if (friendly) {
        let from = anchor, near = Infinity;
        for (const point of routePoints) { near = Math.min(near, segmentDistance(enemy.pos, from, point)); from = point; }
        opening = projection >= -1 ? clamp(1 - near / Math.max(1, (enemy.space?.reach ?? 0) + tuning.escortLaneWidth)) : 0;
      } else if (!carrier) opening = clamp(1 - fieldDistance(enemy.pos, snapshot.ball) / Math.max(1, tuning.engagementDistance + 2));
      const goalSide = fieldDistance(enemy.pos, ownGoal) < fieldDistance(anchor, ownGoal) + 3;
      const delay = !friendly && goalSide ? clamp(1 - fieldDistance(enemy.pos, anchor) / Math.max(1, tuning.tankReleaseDistance)) : 0;
      if (obsolete) { protection = 0; opening = 0; }
      const purpose = protection * tuning.tankProtectionWeight + opening * tuning.tankOpeningWeight + delay * tuning.tankDelayWeight;
      const trade = Number.isFinite(attackETA) && Number.isFinite(opponentETA) ? Math.max(-1, Math.min(1, opponentETA - attackETA)) + protection * 0.5 : -1;
      // Fighting an immediate carrier threat also protects the current carrier
      // position. A retreating runner's screen destination must not make that
      // protection look like abandoning all coverage.
      const coverageDistance = friendly && anchorETA <= tuning.threatHorizon
        ? Math.min(fieldDistance(a.destination, enemy.pos), fieldDistance(anchor, enemy.pos))
        : fieldDistance(a.destination, enemy.pos);
      const coverageLost = Math.min(2, coverageDistance / Math.max(1, tuning.coverageBoundary)) + (a.role === 'safety' ? 0.5 : 0);
      let score = !Number.isFinite(attackETA) || purpose <= 0 || obsolete || attackETA > tuning.threatHorizon + 1 ? -Infinity
        : purpose + trade * tuning.tankTradeWeight - coverageLost * tuning.tankCoverageWeight - attackETA * 0.25;
      if (friendly && tuning.agencyStrength > 0 && Number.isFinite(score))
        score += grifballPlayerStyleBonus(resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, bot.id), tuning.agencyStrength, { protection, opening, trade, coverageLost });
      return { targetId: enemy.id, score, protection, opening, delay, trade, coverageLost, attackETA, opponentETA, purpose };
    }).sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId)));
  }
  // Never count an idle human or an unreachable teammate as guaranteed recovery coverage.
  const retriever = assignments.find(a => a.role === 'retriever' && routers.get(a.botId)!(a.destination, true).status !== 'blocked');
  const recoveryOptions = support.filter(a => routers.get(a.botId)!(a.destination, true).status !== 'blocked');
  const recoveryArrival = (a: GrifballAssignment) => Math.max(actor(a).space?.mobileIn ?? 0,
    routers.get(a.botId)!(anchor, true).length / Math.max(.1, actor(a).space?.speed ?? .1));
  let reserve = retriever ?? (support.length > 1 ? [...recoveryOptions]
    .sort((a, b) => Number(b.role === 'safety') - Number(a.role === 'safety') ||
      fieldDistance(actor(a).pos, anchor) - fieldDistance(actor(b).pos, anchor) || a.botId.localeCompare(b.botId))[0] : undefined);
  // A distant respawn must not leave the only useful runner protector reserved
  // while every other escort has no viable engagement. Keep a separate recovery
  // assignment, but do not count its travel time as ready double-team coverage.
  if (friendly && reserve && !retriever && !memory.releaseRemaining[reserve.botId] &&
    actor(reserve).space?.phase === 'ready' && (actor(reserve).space?.mobileIn ?? Infinity) <= 0 &&
    scores.get(reserve.botId)!.some(s => s.score >= tuning.tankMinimumScore && s.protection > 0 && s.attackETA <= tuning.supportSeconds) &&
    !support.some(a => a !== reserve && !memory.releaseRemaining[a.botId] && scores.get(a.botId)!.some(s => s.score >= tuning.tankMinimumScore))) {
    const replacement = recoveryOptions.filter(a => a !== reserve && Number.isFinite(routers.get(a.botId)!(anchor, true).length))
      .sort((a, b) => recoveryArrival(a) - recoveryArrival(b) || a.botId.localeCompare(b.botId))[0];
    if (replacement) reserve = replacement;
  }
  const recoveryId = reserve?.botId ?? null;
  const coverageReady = !!reserve && recoveryArrival(reserve) <= tuning.supportSeconds + tuning.threatHorizon;
  for (const a of support) a.tanking = { mode: 'cover', targetId: null, partnerId: null, recoveryId, attack: false, doubleCommit: false,
    reason: a.botId === recoveryId ? 'Preserve recovery coverage' : 'No engagement worth leaving coverage', candidates: scores.get(a.botId)! };
  const place = (a: GrifballAssignment, desired: FieldPoint) => {
    // A blocked tactical destination never becomes a straight-line movement order.
    if (routers.get(a.botId)!(desired, true).status !== 'blocked') a.destination = { ...desired };
  };
  if (reserve && reserve.role !== 'retriever') place(reserve, toward(anchor, ownGoal, Math.min(tuning.escortRearDistance, fieldDistance(anchor, ownGoal))));
  const localEnemies = enemies.filter(p => fieldDistance(p.pos, anchor) <= tuning.tankReleaseDistance + 4).length;
  const localAllies = teammates.filter(p => fieldDistance(p.pos, anchor) <= tuning.tankReleaseDistance + 4).length;
  const outnumbered = !friendly && localEnemies > localAllies;
  if (outnumbered && !emergency) {
    for (const [index, a] of support.entries()) {
      const threat = carrier ?? enemies[0]; if (!threat) continue;
      const length = Math.max(0.001, fieldDistance(threat.pos, ownGoal));
      const dx = (ownGoal.x - threat.pos.x) / length, dz = (ownGoal.z - threat.pos.z) / length;
      const lateral = (index - (support.length - 1) / 2) * Math.max(tuning.separation, (threat.space?.blastRadius ?? 0) * 2 + 0.6);
      const base = { x: threat.pos.x - dz * lateral, z: threat.pos.z + dx * lateral };
      let depth = 0;
      // Stand outside the whole nearby push, not just the carrier's shorter punch reach.
      for (const enemy of enemies) if (fieldDistance(enemy.pos, anchor) <= tuning.tankReleaseDistance + 4) {
        const reach = Math.max(enemy.space?.reach ?? 2.5, enemy.space?.lungeReach ?? 0) + tuning.tankDelayMargin;
        const ex = enemy.pos.x - base.x, ez = enemy.pos.z - base.z;
        const across = ex * -dz + ez * dx;
        if (Math.abs(across) <= reach) depth = Math.max(depth, ex * dx + ez * dz + Math.sqrt(Math.max(0, reach * reach - across * across)));
      }
      place(a, { x: base.x + dx * Math.min(depth, length), z: base.z + dz * Math.min(depth, length) });
      a.tanking = { ...a.tanking!, mode: 'delay', targetId: threat.id, reason: 'Outnumbered: hold the goal side outside immediate reach' };
    }
    memory.targetId = null; memory.primaryId = null; memory.commitment = 0;
  } else {
    const options = support.filter(a => a.botId !== recoveryId && (emergency || !memory.releaseRemaining[a.botId]))
      .flatMap(a => scores.get(a.botId)!.filter(s => s.score >= tuning.tankMinimumScore).map(score => ({ a, bot: actor(a), score })));
    options.sort((a, b) => b.score.score - a.score.score || a.a.botId.localeCompare(b.a.botId) || a.score.targetId.localeCompare(b.score.targetId));
    let primary = emergency ? options[0] : chooseTacticalAlternative(options, o => o.score.score, o => `${o.a.botId}:${o.score.targetId}`, choice);
    const incumbent = options.find(o => o.a.botId === memory.primaryId && o.score.targetId === memory.targetId);
    if (incumbent && primary && memory.commitment > 0 && !recovering(incumbent.bot) &&
      primary.score.score < incumbent.score.score + 1.5) primary = incumbent;
    if (primary) {
      const target = enemies.find(p => p.id === primary.score.targetId)!;
      // A ready partner takes over when the current tank enters observable recovery.
      const ready = options.filter(o => o.score.targetId === target.id && !recovering(o.bot)).sort((a, b) => a.score.attackETA - b.score.attackETA || a.a.botId.localeCompare(b.a.botId))[0];
      if (recovering(primary.bot) && ready && ready.score.attackETA + 0.1 < primary.score.attackETA) primary = ready;
      const oldTarget = memory.targetId, oldPrimary = memory.primaryId;
      memory.targetId = target.id; memory.primaryId = primary.a.botId;
      if (oldTarget !== target.id || oldPrimary !== primary.a.botId) memory.commitment = tuning.tankCommitSeconds;
      primary.a.tanking = { ...primary.a.tanking!, mode: 'engage', targetId: target.id, attack: true,
        reason: emergency ? 'Contest the carrier before the goal' : oldPrimary && oldPrimary !== primary.a.botId && oldTarget === target.id ? 'Rotate a ready tank into the engagement' : `Commit to a useful engagement${primary !== options[0] && primary !== incumbent ? ' (seeded near-equal alternative)' : ''}` };
      place(primary.a, toward(target.pos, primary.bot.pos, Math.max(1, Math.min(3, (primary.bot.space?.reach ?? 2.5) * 0.7))));
      const second = options.filter(o => o.a.botId !== primary.a.botId && o.score.targetId === target.id)
        .sort((a, b) => a.score.attackETA - b.score.attackETA || a.a.botId.localeCompare(b.a.botId))[0];
      if (second && recoveryId) {
        // Evaluate both attackers at weapon-scaled standoff distances. The
        // single-tank three-unit cap otherwise makes every default-hammer pair
        // appear to share one blast, even when they approach opposite flanks.
        const primaryAttackPoint = toward(target.pos, primary.bot.pos, Math.max(1, (primary.bot.space?.reach ?? 2.5) * 0.7));
        const attackPoint = toward(target.pos, second.bot.pos, Math.max(1, (second.bot.space?.reach ?? 2.5) * 0.7));
        const sharedBlast = enemies.some(e => (e.space?.blastRadius ?? 0) > 0 &&
          ((fieldDistance(primary.bot.pos, second.bot.pos) <= e.space!.blastRadius * 2 + 0.5 &&
            eta(e, primary.bot.pos) < tuning.threatHorizon && eta(e, second.bot.pos) < tuning.threatHorizon) ||
           (fieldDistance(primaryAttackPoint, attackPoint) <= e.space!.blastRadius * 2 + 0.5 &&
            eta(e, primaryAttackPoint) < tuning.threatHorizon && eta(e, attackPoint) < tuning.threatHorizon)));
        const opening = recovering(target) && (target.space?.attackIn ?? 0) > second.score.attackETA + 0.1;
        const doubleCommit = opening && coverageReady && routers.get(primary.bot.id)!(primaryAttackPoint, true).status !== 'blocked' &&
          routers.get(second.bot.id)!(attackPoint, true).status !== 'blocked' && !sharedBlast && second.score.score >= tuning.tankDoubleThreshold && !recovering(second.bot);
        second.a.tanking = { ...second.a.tanking!, mode: 'punish', targetId: target.id, partnerId: primary.a.botId,
          attack: doubleCommit, doubleCommit, reason: doubleCommit ? 'Two-player commit: opening and recovery coverage available' : !coverageReady ? 'Wait for recovery coverage to arrive' : sharedBlast ? 'Cover the tank; avoid shared hammer exposure' : second.score.score < tuning.tankDoubleThreshold ? 'Second attacker is below the double-team value threshold' : 'Cover the tank and wait for a recovery opening' };
        primary.a.tanking.partnerId = second.a.botId; primary.a.tanking.doubleCommit = doubleCommit;
        if (doubleCommit) place(primary.a, primaryAttackPoint);
        const reach = Math.max(target.space?.reach ?? 2.5, target.space?.lungeReach ?? 0);
        place(second.a, toward(target.pos, second.bot.pos, doubleCommit ? Math.max(1, (second.bot.space?.reach ?? 2.5) * 0.7) : reach + tuning.tankDelayMargin));
      }
    } else { memory.targetId = null; memory.primaryId = null; memory.commitment = 0; }
  }
  for (const a of support) {
    const old = previous.get(a.botId)?.tanking, order = a.tanking!;
    if (old?.attack && !order.attack && order.mode === 'cover' &&
      !(friendly && tuning.agencyStrength > 0 && previous.get(a.botId)?.agency?.choice === 'initiative')) {
      memory.releaseRemaining[a.botId] = tuning.tankReleaseSeconds;
      order.mode = 'release'; order.reason = 'Release the duel and restore coverage';
    } else if (order.mode === 'cover' && memory.releaseRemaining[a.botId]) {
      order.mode = 'release'; order.reason = 'Return to coverage before recommitting';
    }
    // The engagement order now owns the target; do not expose a conflicting escort target.
    delete a.escort;
    a.reason = `${a.role}: ${order.reason}`;
  }
  for (const id of Object.keys(memory.releaseRemaining)) if (!support.some(a => a.botId === id)) delete memory.releaseRemaining[id];
}

/** Recheck short-lived punish openings and immediate defense against the latest public snapshot. */
export function selectTankingThreat(assignment: GrifballAssignment, self: FieldPoint, players: GrifballTacticalPlayer[]): string | null {
  const order = assignment.tanking!;
  const visible = (p: GrifballTacticalPlayer) => p.team !== assignment.team &&
    (!assignment.geometry || isSpaceSegmentOpen(assignment.geometry, self, p.pos));
  const target = players.find(p => p.id === order.targetId && visible(p));
  const attacker = players.find(p => p.id === assignment.botId);
  const punishOpen = target && attacker && recovering(target) && (target.space?.attackIn ?? 0) >
    estimateSpaceAttackTime({ ...attacker, pos: self }, target.pos, fieldDistance(self, target.pos)) + 0.1;
  if (order.attack && target && (assignment.agency?.choice !== 'initiative' || supportInitiativeStillUseful(assignment, self, players)) && (order.mode !== 'punish' || punishOpen) &&
    fieldDistance(self, target.pos) <= (assignment.tuning?.engagementDistance ?? 6) &&
    fieldDistance(self, assignment.destination) <= (assignment.tuning?.coverageBoundary ?? 9)) return target.id;
  return players.filter(p => visible(p) && (fieldDistance(self, p.pos) <= 2.5 ||
    ['swing_up', 'swing_down', 'slashing'].includes(p.space?.phase ?? '') && fieldDistance(self, p.pos) <= (p.space?.reach ?? 2.5)))
    .sort((a, b) => fieldDistance(self, a.pos) - fieldDistance(self, b.pos) || a.id.localeCompare(b.id))[0]?.id ?? null;
}
