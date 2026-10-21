import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import type { EngagementScore, TankingMemory } from './aiGrifballTanking';
import type { TeamTactics } from './grifballTacticsConfig';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { fieldDistance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { GRIFBALL_PLAYER_STYLES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { grifballEngagementTiming, startGrifballTankRelease } from './aiGrifballEngagement';

export interface SupportAgencyDecision {
  style: GrifballPlayerStyle;
  choice: 'team-play' | 'initiative' | 'cover';
  reason: string;
  alternatives: { targetId: string; score: number; reason: string }[];
}
const recovering = (p: GrifballTacticalPlayer) => p.space?.phase.includes('recover') === true;
const attackPoint = (bot: GrifballTacticalPlayer, enemy: GrifballTacticalPlayer): FieldPoint => {
  const distance = fieldDistance(bot.pos, enemy.pos), standOff = Math.min(distance, Math.max(1, (bot.space?.reach ?? 2.5) * 0.7));
  return distance > 0.001 ? { x: enemy.pos.x + (bot.pos.x - enemy.pos.x) / distance * standOff,
    z: enemy.pos.z + (bot.pos.z - enemy.pos.z) / distance * standOff } : { ...bot.pos };
};

/** Each available support proposes a useful separate engagement. Shared recovery,
 * passing and committed attacks retain priority; arbitration only resolves conflicts. */
export function applyGrifballSupportInitiative(snapshot: GrifballTacticalSnapshot, assignments: GrifballAssignment[],
  tuning: TeamTactics, memory: TankingMemory, routers: SpaceRouters, previous: Map<string, GrifballAssignment>): void {
  if (!(tuning.agencyStrength > 0) || !tuning.enabled || !tuning.spaceEnabled || !tuning.tankingEnabled) return;
  const carrier = snapshot.players.find(p => p.id === snapshot.holderId);
  if (!carrier || carrier.team !== assignments[0]?.team) return;
  const actors = new Map(snapshot.players.map(p => [p.id, p]));
  const support = assignments.filter(a => a.tanking && a.role !== 'runner' && a.role !== 'retriever' && !a.receive);
  const enemies = snapshot.players.filter(p => p.team !== carrier.team);
  const claimed = new Set(support.filter(a => a.tanking!.attack).map(a => a.tanking!.targetId));
  const eta = (bot: GrifballTacticalPlayer, point: FieldPoint) => estimateSpaceAttackTime(bot, point, routers.get(bot.id)!(point, true).length);
  const proposed = new Map<string, { score: EngagementScore; point: FieldPoint }[]>();
  const unavailable = (a: GrifballAssignment, score: EngagementScore, point: FieldPoint): string | null => {
    const bot = actors.get(a.botId)!, enemy = actors.get(score.targetId)!;
    const reserve = assignments.find(r => r.botId === a.tanking!.recoveryId);
    if (a.botId === a.tanking!.recoveryId) return 'Keep recovery coverage';
    if (a.tanking!.attack) return 'Already executing a team engagement';
    if (!reserve || reserve.receive || reserve.tanking?.attack || !actors.has(reserve.botId)) return 'No available recovery cover';
    const cover = actors.get(reserve.botId)!;
    if (Math.max(cover.space?.mobileIn ?? 0, routers.get(cover.id)!(carrier.pos, true).length / Math.max(.1, cover.space?.speed ?? .1)) > tuning.supportSeconds + tuning.threatHorizon)
      return 'Recovery cover cannot arrive in time';
    if (memory.releaseRemaining[a.botId]) return 'Return to coverage before recommitting';
    if (recovering(bot) || (bot.space?.mobileIn ?? Infinity) > 0) return 'Recover before starting another engagement';
    if (claimed.has(enemy.id)) return 'A teammate already owns this engagement';
    const style = a.agency!.style, profile = GRIFBALL_PLAYER_STYLES[style];
    if (!Number.isFinite(score.score) || score.score < tuning.tankMinimumScore + profile.threshold + (1 - tuning.agencyStrength) * 3)
      return 'Opportunity does not outweigh covering';
    if (fieldDistance(bot.pos, enemy.pos) > tuning.engagementDistance || fieldDistance(bot.pos, a.anchor) > tuning.coverageBoundary + tuning.escortLeadDistance)
      return 'Stay within useful support range';
    if (fieldDistance(enemy.pos, carrier.pos) > tuning.tankReleaseDistance && eta(enemy, carrier.pos) > tuning.threatHorizon)
      return 'Opponent is outside the current push';
    if (style === 'opportunist' && (!recovering(enemy) || (enemy.space?.attackIn ?? 0) <= score.attackETA + .1))
      return 'Wait for a punishable recovery window';
    if (style === 'guardian' && score.protection < .5) return 'Hold coverage unless the runner needs protection';
    if (routers.get(bot.id)!(point, true).status === 'blocked' || !isSpaceSegmentOpen(snapshot.geometry!, bot.pos, enemy.pos))
      return 'No clear engagement route';
    // Do not open a second duel by walking into the first tank's hammer exposure.
    for (const ally of support.filter(other => other !== a && other.tanking!.attack)) {
      const allyBot = actors.get(ally.botId)!;
      if (enemies.some(e => (e.space?.blastRadius ?? 0) > 0 &&
        ((fieldDistance(bot.pos, allyBot.pos) <= e.space!.blastRadius * 2 + .5 && eta(e, bot.pos) < tuning.threatHorizon && eta(e, allyBot.pos) < tuning.threatHorizon) ||
         (fieldDistance(point, ally.destination) <= e.space!.blastRadius * 2 + .5 && eta(e, point) < tuning.threatHorizon && eta(e, ally.destination) < tuning.threatHorizon))))
        return 'Avoid sharing hammer exposure with the committed tank';
    }
    return null;
  };
  for (const a of support) {
    a.agency = { style: resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, a.botId),
      choice: a.tanking!.attack ? 'team-play' : 'cover', reason: a.tanking!.reason, alternatives: [] };
    proposed.set(a.botId, a.tanking!.candidates.filter(s => actors.has(s.targetId)).map(score => ({
      score, point: attackPoint(actors.get(a.botId)!, actors.get(score.targetId)!),
    })));
  }
  const proposals = support.flatMap(a => proposed.get(a.botId)!.map(candidate => ({ a, ...candidate })));
  const rank = (p: typeof proposals[number]) => p.score.score +
    (previous.get(p.a.botId)?.agency?.choice === 'initiative' && previous.get(p.a.botId)?.tanking?.targetId === p.score.targetId ? .5 * tuning.agencyStrength : 0);
  proposals.sort((a, b) => rank(b) - rank(a) || a.a.botId.localeCompare(b.a.botId) || a.score.targetId.localeCompare(b.score.targetId));
  for (const { a, score, point } of proposals) {
    if (unavailable(a, score, point)) continue;
    const oldPartner = support.find(other => other.botId === a.tanking!.partnerId);
    if (oldPartner?.tanking?.partnerId === a.botId) oldPartner.tanking.partnerId = null;
    a.tanking = { ...a.tanking!, mode: 'engage', targetId: score.targetId, attack: true, partnerId: null, doubleCommit: false,
      reason: `${GRIFBALL_PLAYER_STYLES[a.agency!.style].label}: take a separate useful engagement` };
    delete a.tanking.doubleTeam;
    a.destination = point;
    a.agency!.choice = 'initiative'; a.agency!.reason = a.tanking.reason;
    claimed.add(score.targetId);
  }
  for (const a of support) {
    a.agency!.alternatives = proposed.get(a.botId)!.map(({ score, point }) => ({ targetId: score.targetId, score: score.score,
      reason: a.tanking!.attack && a.tanking!.targetId === score.targetId ? 'Selected' : unavailable(a, score, point) ?? 'Another opportunity has greater value' }));
    if (previous.get(a.botId)?.agency?.choice === 'initiative' && !a.tanking!.attack && a.tanking!.mode === 'cover') {
      startGrifballTankRelease(memory, a.botId, grifballEngagementTiming(snapshot, a.botId, tuning));
      a.tanking!.mode = 'release'; a.tanking!.reason = 'Opportunity ended: restore coverage before recommitting';
    }
    if (a.tanking!.persistence) a.tanking!.persistence.releaseRemaining = memory.releaseRemaining[a.botId] ?? 0;
    a.agency!.reason = a.tanking!.reason;
    a.reason = `${a.role}: ${a.agency!.reason}`;
  }
}

/** Fresh observations can close an opportunity before the next planner refresh. */
export function supportInitiativeStillUseful(assignment: GrifballAssignment, self: FieldPoint, players: GrifballTacticalPlayer[]): boolean {
  const order = assignment.tanking!, carrier = players.find(p => p.id === assignment.carrierId && p.team === assignment.team);
  const target = players.find(p => p.id === order.targetId && p.team !== assignment.team);
  const bot = players.find(p => p.id === assignment.botId), cover = players.find(p => p.id === order.recoveryId && p.team === assignment.team);
  if (!carrier || !target || !bot || !cover || !cover.scripted) return false;
  const tuning = assignment.tuning!;
  // A fresh distance lower bound can revoke stale cover between route refreshes.
  if (Math.max(cover.space?.mobileIn ?? 0, fieldDistance(cover.pos, carrier.pos) / Math.max(.1, cover.space?.speed ?? .1)) >
    tuning.supportSeconds + tuning.threatHorizon) return false;
  const threatETA = estimateSpaceAttackTime(target, carrier.pos, fieldDistance(target.pos, carrier.pos));
  if (fieldDistance(target.pos, carrier.pos) > tuning.tankReleaseDistance && threatETA > tuning.threatHorizon) return false;
  if (assignment.agency?.style === 'opportunist' && (!recovering(target) || (target.space?.attackIn ?? 0) <=
    estimateSpaceAttackTime({ ...bot, pos: self }, target.pos, fieldDistance(self, target.pos)) + .1)) return false;
  if (assignment.agency?.style === 'guardian' && threatETA > (tuning.threatHorizon + 1) * .5) return false;
  return true;
}
