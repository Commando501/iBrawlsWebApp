import type { FieldPoint, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import type { SpaceRouters } from './aiGrifballRunner';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance as distance, isSpaceSegmentOpen, createSpaceRouter } from './grifballSpaceGeometry';
import { createInitialBall, throwBall, tickBallPhysics, type BallArenaBounds, type GrifballBall, type Vec3 } from './grifballBall';
import { GRIFBALL_PASS_PREFERENCES, grifballPassStyleBonus, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { findPassDeflectionThreat, type PassDeflectionThreat } from './aiGrifballPassDeflection';

export interface PassingRules { allowed: boolean; minSpeed: number; maxSpeed: number; chargeMax: number; pickupRadius: number; bounds: BallArenaBounds; hammerDeflection?: boolean }
export interface BallRecovery { point: FieldPoint; seconds: number; path: Vec3[]; settled: boolean }
export interface PassCandidate extends BallRecovery {
  receiverId: string; direction: FieldPoint; speed: number; chargeSeconds: number;
  receiverETA: number; opponentETA: number; attackETA: number; progress: number; score: number;
  viable: boolean; reason: string;
  deflection?: PassDeflectionThreat;
  individuality?: { baseScore: number; bonus: number; pickupMargin: number; attackMargin: number };
}
export interface PassPlan { carrierId: string; selected: PassCandidate | null; candidates: PassCandidate[]; reason: string;
  individuality?: { style: GrifballPlayerStyle; strength: number; reason: string } }
export interface PassCharge { carrierId: string; receiverId: string; speed: number; elapsed: number }
export interface ReceiveOrder { carrierId: string | null; point: FieldPoint; seconds: number }

/** Use the actual bounce/settling rules: thrown balls cannot be caught in flight. */
export function predictBallRecovery(source: GrifballBall, bounds: BallArenaBounds): BallRecovery {
  const ball: GrifballBall = { ...source, pos: { ...source.pos }, vel: { ...source.vel }, home: { ...source.home } };
  const path = [{ ...ball.pos }]; let ticks = 0;
  while (ball.state === 'thrown' && ticks < 600) {
    tickBallPhysics(ball, 1 / 60, Infinity, bounds); ticks++;
    if (ticks % 6 === 0 || ball.state !== 'thrown') path.push({ ...ball.pos });
  }
  return { point: { x: ball.pos.x, z: ball.pos.z }, seconds: ticks / 60, path, settled: ball.state === 'loose' || ball.state === 'idle' };
}
const arrival = (player: GrifballTacticalPlayer, point: FieldPoint, routers: SpaceRouters, radius: number): number => {
  const route = routers.get(player.id)!(point, true);
  return route.status === 'blocked' ? Infinity : (player.space?.mobileIn ?? 0) + Math.max(0, route.length - radius) / Math.max(0.1, player.space?.speed ?? 5.2);
};

export function planGrifballPass(snapshot: GrifballTacticalSnapshot, carrier: GrifballTacticalPlayer, tuning: TeamTactics, routers: SpaceRouters): PassPlan {
  const plan: PassPlan = { carrierId: carrier.id, selected: null, candidates: [], reason: 'Carry: no viable receiver' };
  const rules = snapshot.passing, geometry = snapshot.geometry;
  if (!rules?.allowed || !geometry || !tuning.enabled || !tuning.spaceEnabled || !tuning.passingEnabled) { plan.reason = 'Passing disabled'; return plan; }
  if (!carrier.scripted || (carrier.height ?? 0) > 0.01 || carrier.space?.phase !== 'ready' || (carrier.space?.mobileIn ?? 0) > 0) { plan.reason = 'Carrier unavailable to throw'; return plan; }
  const goal = snapshot.goals[carrier.team === 'blue' ? 'red' : 'blue'];
  if (!goal || distance(carrier.pos, goal) <= tuning.runnerFinishDistance) { plan.reason = 'Keep the scoring run'; return plan; }
  if (tuning.passAgencyStrength > 0) {
    const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, carrier.id);
    plan.individuality = { style, strength: tuning.passAgencyStrength, reason: GRIFBALL_PASS_PREFERENCES[style] };
  }
  const enemies = snapshot.players.filter(p => p.team !== carrier.team);
  // Scripted receivers can honor a rendezvous. Observed humans/neural players are never assumed to accept an order.
  const receivers = snapshot.players.filter(p => p.team === carrier.team && p.id !== carrier.id && p.scripted &&
    (p.height ?? 0) <= 0.01 && p.space?.phase === 'ready' && (p.space?.mobileIn ?? 0) <= 0.01);
  for (const receiver of receivers.sort((a, b) => a.id.localeCompare(b.id))) {
    const d = distance(carrier.pos, receiver.pos); if (d < 0.5) continue;
    const direction = { x: (receiver.pos.x - carrier.pos.x) / d, z: (receiver.pos.z - carrier.pos.z) / d };
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const speed = rules.minSpeed + fraction * (rules.maxSpeed - rules.minSpeed);
      if (!(speed > 0) || !Number.isFinite(speed)) continue;
      const chargeSeconds = fraction * rules.chargeMax;
      const ball = createInitialBall({ ...carrier.pos, y: 0 });
      throwBall(ball, { ...carrier.pos, y: (carrier.height ?? 0) + 1.1 }, { ...direction, y: 0 }, speed);
      const recovery = predictBallRecovery(ball, rules.bounds);
      const receiverETA = arrival(receiver, recovery.point, routers, rules.pickupRadius * 0.6);
      const pickupTime = Math.max(chargeSeconds + recovery.seconds, receiverETA);
      const opponentETA = Math.min(Infinity, ...enemies.map(p => arrival(p, recovery.point, routers, rules.pickupRadius)),
        ...(snapshot.respawns ?? []).filter(p => p.team !== carrier.team).map(p => {
          const route = createSpaceRouter(geometry, p.pos)(recovery.point, true);
          return p.seconds + (route.status === 'blocked' ? Infinity : Math.max(0, route.length - rules.pickupRadius) / Math.max(0.1, p.speed));
        }));
      const attackETA = Math.min(Infinity, ...enemies.map(p => {
        const route = routers.get(p.id)!(recovery.point, true);
        return route.status === 'blocked' ? Infinity : estimateSpaceAttackTime(p, recovery.point, route.length);
      }));
      const progress = distance(carrier.pos, goal) - distance(recovery.point, goal);
      const pathOpen = recovery.path.every((p, i, all) => !i || isSpaceSegmentOpen(geometry, all[i - 1], p));
      const chargeThreat = [...enemies].sort((a, b) => a.id.localeCompare(b.id)).find(p => {
        const route = routers.get(p.id)!(carrier.pos, true);
        return route.status !== 'blocked' && estimateSpaceAttackTime(p, carrier.pos, route.length) <= chargeSeconds + 0.15;
      });
      let reason = !recovery.settled ? 'Ball does not settle in the prediction window' : !pathOpen ? 'Throw crosses blocked space' :
        chargeThreat ? chargeThreat.space?.weapon === 'sword' ? 'Carrier exposed to a lethal sword hit while charging' : 'Carrier cannot safely charge' : !Number.isFinite(receiverETA) ? 'Receiver route blocked' :
        receiverETA > tuning.passMaxReceiveSeconds ? 'Receiver too far from recovery' : progress < tuning.passMinProgress ? 'Insufficient goal progress' :
        opponentETA <= pickupTime + tuning.passSafetyMargin ? 'Opponent can contest the pickup' :
        attackETA <= pickupTime + tuning.passThreatMargin ? 'Receiver exposed to an attack' : 'Clear receiver and recovery margin';
      const deflection = reason === 'Clear receiver and recovery margin' ? findPassDeflectionThreat(snapshot, carrier, recovery, chargeSeconds, routers) : undefined;
      if (deflection) reason = 'Opponent can deflect the ball in flight';
      const viable = reason === 'Clear receiver and recovery margin';
      const baseScore = progress - pickupTime * 2 - receiverETA + Math.min(3, opponentETA - pickupTime);
      const margins = { pickupMargin: opponentETA - pickupTime, attackMargin: attackETA - pickupTime };
      const bonus = plan.individuality && viable
        ? grifballPassStyleBonus(plan.individuality.style, plan.individuality.strength, { progress, chargeSeconds, ...margins }) : 0;
      plan.candidates.push({ ...recovery, receiverId: receiver.id, direction, speed, chargeSeconds, receiverETA, opponentETA, attackETA, progress,
        viable, reason, score: baseScore + bonus,
        ...(deflection ? { deflection } : {}),
        ...(plan.individuality ? { individuality: { baseScore, bonus, ...margins } } : {}) });
    }
  }
  plan.selected = plan.candidates.filter(c => c.viable).sort((a, b) => b.score - a.score || a.receiverId.localeCompare(b.receiverId) || a.speed - b.speed)[0] ?? null;
  if (plan.selected) plan.reason = `Pass to ${plan.selected.receiverId}: ${plan.selected.reason.toLowerCase()}`;
  return plan;
}
