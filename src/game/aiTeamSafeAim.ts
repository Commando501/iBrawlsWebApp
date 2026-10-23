import type { CharacterModelType, CustomMapData, UniversalSettings } from '../types';
import { getCharacterModelCollisionProfile } from '../characterModelTypes';
import { adjustRangeForTargetModel } from '../components/grifball/modelHitbox';
import { SWORD_SLASH_FORWARD_FACTOR, SWORD_SLASH_RADIUS } from '../components/grifball/combatGeometry';
import { getRectHalfExtents } from './arenaDimensions';
import { advancePunch, beginPunch, BALL_PUNCH_REACH, punchContactDistance, punchPathIsClear, type PunchAttack } from './ballPunch';
import { resolveHammerSlamTiming } from './hammerSlamTiming';

type Point = { x: number; y: number; z: number };
export interface TeamAimBody {
  id: string; team?: string; pos: Point; vel: Point; modelType?: CharacterModelType;
  isCrouching?: boolean; invulnerabilityTimer?: number;
}
export interface TeamAimInput {
  self: TeamAimBody; bodies: readonly TeamAimBody[]; weapon: 'hammer' | 'sword' | 'ball';
  /** World heading, independent of either host's yaw convention. */
  heading: Point; settings: UniversalSettings; targetId?: string;
  impactIn: number; attacking?: boolean; lunge?: boolean; downward?: boolean;
  punchAttack?: PunchAttack;
  map?: CustomMapData | null; arenaRadius: number;
}
export type TeamAimPlan = { kind: 'unchanged' }
  | { kind: 'aim'; heading: Point; enemyIds: string[] }
  | { kind: 'reposition'; destination: Point }
  | { kind: 'hold' };

const ALLY_MARGIN = .22;
const ENEMY_MARGIN = .06;
const bodyY = (b: TeamAimBody) => b.pos.y + (b.isCrouching ? .52 : .825);
const angle = (v: Point) => Math.atan2(v.x, v.z);
const heading = (a: number): Point => ({ x: Math.sin(a), y: 0, z: Math.cos(a) });
const deltaAngle = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const predict = (body: TeamAimBody, seconds: number): TeamAimBody => ({ ...body, pos: {
  x: body.pos.x + body.vel.x * seconds,
  y: Math.max(0, body.pos.y + body.vel.y * seconds - (body.pos.y > .01 || body.vel.y > .01 ? 9 * seconds * seconds : 0)),
  z: body.pos.z + body.vel.z * seconds,
} });

export function teamAimImpactDelay(settings: UniversalSettings, weapon: TeamAimInput['weapon'], phase: string, elapsed: number): number {
  const down = phase.endsWith('down');
  if (weapon === 'sword') return down ? 0 : Math.max(0, (settings.swordSlashSpeed ?? .22) * .5 - elapsed);
  const melee = settings.hammerMeleeSpeed ?? .24;
  if (weapon === 'ball') return Math.max(0, (down ? 0 : melee) + Math.max(.03, melee * .5) - elapsed);
  const swipe = phase.startsWith('melee');
  const timing = resolveHammerSlamTiming(settings);
  const remainingPhase = swipe ? melee * (down ? .6 : 1) : down ? timing.attackTime : timing.windupTime + timing.attackTime;
  return Math.max(0, remainingPhase - elapsed);
}

/** Sword contact happens at the up/down transition; never cancel its recovery
 * after it has already dealt damage. Other roster attacks hit at the end. */
export function isTeamAimAttackPending(weapon: TeamAimInput['weapon'], phase: string): boolean {
  return weapon === 'sword' ? phase === 'swing_up' : ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(phase);
}

/** Choose damage-volume placement, not a ray to the selected enemy's center.
 * Exact angular boundaries partition the reachable sphere centers; interval
 * midpoints cover narrow safe arcs that a fixed coarse angle sweep would miss.
 * No RNG, gameplay mutation, or changes to the actual damage rules. */
export function planTeamSafeAim(input: TeamAimInput): TeamAimPlan {
  const { self, settings, weapon } = input;
  if (settings.gameMode !== 'grifball' || !self.team) return { kind: 'unchanged' };
  const horizon = Math.min(.8, Math.max(0, input.impactIn));
  const reach = weapon === 'hammer' ? settings.attackRange : weapon === 'sword' ? settings.attackRange * SWORD_SLASH_FORWARD_FACTOR : BALL_PUNCH_REACH;
  const radius = weapon === 'hammer' ? settings.attackRadius : weapon === 'sword' ? SWORD_SLASH_RADIUS : 0;
  // Flight ends at the physical 16-unit/.8-second cap, not the acquisition range.
  const range = input.lunge ? 16 : reach + radius;
  const nearby = input.bodies.filter(b => b.id !== self.id && distance(b.pos, self.pos) <= range + 6 + Math.min(12, Math.hypot(b.vel.x, b.vel.z) * .8));
  const allies = nearby.filter(b => b.team === self.team);
  if (!allies.length) return { kind: 'unchanged' };
  const enemies = nearby.filter(b => b.team !== self.team && (b.invulnerabilityTimer ?? 0) <= horizon);
  const original = angle(input.heading);

  if (input.lunge) {
    // Commitment only: once launched, the real flight remains unsteerable and
    // can still hit someone who unexpectedly crosses it afterward.
    const speed = settings.swordLungeSpeed ?? 24;
    const maxTime = Math.min(.8, range / Math.max(.1, speed)) + 1 / 30;
    const sampleStep = Math.min(1 / 60, .5 / Math.max(1, speed));
    const trace = (a: number) => {
      const flat = Math.hypot(input.heading.x, input.heading.z);
      const dir = { x: Math.sin(a) * flat, y: input.heading.y, z: Math.cos(a) * flat };
      for (let time = 0; time <= maxTime; time += sampleStep) {
        const p = { x: self.pos.x + dir.x * speed * time,
          y: Math.max(0, self.pos.y + Math.max(self.vel.y, dir.y * speed) * time - 9 * time * time), z: self.pos.z + dir.z * speed * time };
        const separation = (b: TeamAimBody) => {
          const predicted = predict(b, time);
          return Math.hypot(predicted.pos.x - p.x, bodyY(predicted) - p.y - (self.isCrouching ? .52 : .825), predicted.pos.z - p.z);
        };
        if (allies.some(b => (b.invulnerabilityTimer ?? 0) <= time && separation(b) <= adjustRangeForTargetModel(1.5, b.modelType) + ALLY_MARGIN)) return null;
        const hits = enemies.filter(b => (b.invulnerabilityTimer ?? 0) <= time && separation(b) < adjustRangeForTargetModel(1.5, b.modelType) - ENEMY_MARGIN);
        if (hits.length) return { heading: dir, enemyIds: hits.map(b => b.id) };
      }
      return undefined;
    };
    const direct = trace(original);
    if (direct !== null) return { kind: 'unchanged' };
    for (const offset of [.08, -.08, .16, -.16, .25, -.25, .35, -.35]) {
      const result = trace(original + offset);
      if (result) return { kind: 'aim', ...result };
    }
    return { kind: 'hold' };
  }

  const predictedEnemies = enemies.map(b => predict(b, horizon));
  // Cover the observed position as well as the forecast, so turning or slowing
  // teammates are not assumed to vacate the blast at an exact future instant.
  const allySamples = allies.flatMap(b => {
    const stationary = b.pos.y <= .01 && Math.hypot(b.vel.x, b.vel.y, b.vel.z) < .001;
    return (stationary || horizon === 0 ? [horizon] : [0, horizon / 2, horizon])
      .filter(t => (b.invulnerabilityTimer ?? 0) <= t).map(t => predict(b, t));
  });
  const measure = (origin: Point, a: number) => {
    const dir = heading(a);
    if (weapon === 'ball') {
      const actor = { ...self, pos: origin, heading: dir, eyeHeight: self.isCrouching ? .9 : 1.2 };
      const hit = predictedEnemies.map(b => ({ b, d: punchContactDistance(actor, b) })).filter(h => h.d !== null)
        .sort((a, b) => a.d! - b.d!)[0];
      const blocked = allySamples.some(b => {
        const d = punchContactDistance(actor, b, BALL_PUNCH_REACH + ALLY_MARGIN);
        return d !== null && (!hit || d <= hit.d! + ALLY_MARGIN);
      });
      return { blocked, hits: hit ? [hit.b.id] : [], clearance: 0 };
    }
    const impact = input.downward ? { x: origin.x, y: origin.y + 1.2 - reach, z: origin.z }
      : { x: origin.x + dir.x * reach, y: origin.y + 1.2, z: origin.z + dir.z * reach };
    const gap = (b: TeamAimBody) => Math.hypot(b.pos.x - impact.x, bodyY(b) - impact.y, b.pos.z - impact.z) - adjustRangeForTargetModel(radius, b.modelType);
    const clearance = Math.min(3, ...allySamples.map(gap));
    return { blocked: clearance <= ALLY_MARGIN + 1e-6, clearance,
      hits: predictedEnemies.filter(b => gap(b) < -ENEMY_MARGIN - 1e-6).map(b => b.id) };
  };
  const choose = (origin: Point) => {
    const cuts = [original];
    for (const b of [...predictedEnemies, ...allySamples]) {
      const dx = b.pos.x - origin.x, dz = b.pos.z - origin.z, d = Math.hypot(dx, dz);
      const center = Math.atan2(dx, dz);
      cuts.push(center);
      if (weapon === 'ball') { cuts.push(center - .12, center + .12); continue; }
      const effective = adjustRangeForTargetModel(radius, b.modelType) + (b.team === self.team ? ALLY_MARGIN : -ENEMY_MARGIN);
      const dy = bodyY(b) - origin.y - 1.2;
      const cosine = (d * d + reach * reach + dy * dy - effective * effective) / (2 * d * reach);
      if (cosine > -1 && cosine < 1) {
        const half = Math.acos(cosine);
        cuts.push(center - half, center + half);
      }
    }
    const sorted = cuts.map(a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b)
      .filter((a, i, values) => i === 0 || a - values[i - 1] > 1e-8);
    const candidates = [...sorted, ...sorted.map((a, i) => (a + (sorted[i + 1] ?? sorted[0] + 2 * Math.PI)) / 2)];
    let best: { angle: number; score: number; hits: string[] } | undefined;
    for (const a of candidates) {
      const m = measure(origin, a);
      if (m.blocked || !m.hits.length) continue;
      const score = m.hits.length * 100 + (input.targetId && m.hits.includes(input.targetId) ? 10 : 0)
        + Math.min(1, m.clearance) * 2 - Math.abs(deltaAngle(a, original));
      if (!best || score > best.score + 1e-8) best = { angle: a, score, hits: m.hits };
    }
    return best;
  };
  const best = choose(self.pos);
  if (best) return { kind: 'aim', heading: heading(best.angle), enemyIds: best.hits };
  let blocked = measure(self.pos, original).blocked;
  if (weapon === 'ball' && !blocked) {
    // A punch can travel and magnetize before contact. Forecast the actual
    // assistance, including an already locked direction, before allowing it.
    const actor = { ...self, pos: { ...self.pos }, heading: input.heading, eyeHeight: self.isCrouching ? .9 : 1.2 };
    const attack = input.punchAttack ? { ...input.punchAttack, direction: { ...input.punchAttack.direction } }
      : beginPunch(actor, enemies, settings, input.map);
    for (let t = 0; t <= horizon; t += 1 / 60) {
      if (t > 0) advancePunch(actor, attack, enemies.map(b => predict(b, t)), settings, 1 / 60, input.map);
      actor.heading = attack.targetId ? attack.direction : input.heading;
      if (allies.some(b => (b.invulnerabilityTimer ?? 0) <= t &&
        punchContactDistance(actor, predict(b, t), BALL_PUNCH_REACH + ALLY_MARGIN) !== null)) { blocked = true; break; }
    }
  }
  if (!blocked) return { kind: 'unchanged' };

  // Only change locomotion when a reachable enemy is being screened. Otherwise
  // ordinary pursuit/objective movement can bring the bot into fighting range.
  if (!predictedEnemies.some(b => distance(self.pos, b.pos) <= reach + radius + .5)) return { kind: input.attacking ? 'hold' : 'unchanged' };
  let move: { destination: Point; score: number } | undefined;
  const ownRadius = getCharacterModelCollisionProfile(self.modelType).radius;
  for (const step of [.9, 1.8, 2.7, 3.6]) for (let index = 0; index < 12; index++) {
    const dir = heading(original + index * Math.PI / 6);
    const destination = { x: self.pos.x + dir.x * step, y: self.pos.y, z: self.pos.z + dir.z * step };
    const arena = input.map?.arenaRadius ?? input.arenaRadius;
    if (input.map?.mapShape === 'rectangular') {
      const bounds = getRectHalfExtents(arena, input.map.arenaHalfExtents);
      if (Math.abs(destination.x) > bounds.x - ownRadius - .1 || Math.abs(destination.z) > bounds.z - ownRadius - .1) continue;
    } else if (Math.hypot(destination.x, destination.z) > arena - ownRadius - .1) continue;
    const from = { ...self.pos, y: self.pos.y + .8 }, to = { ...destination, y: destination.y + .8 };
    if (!punchPathIsClear(from, to, input.map, ownRadius)) continue;
    // Don't pick a lane which requires walking through another combatant.
    if (nearby.some(b => {
      const t = Math.max(0, Math.min(step, (b.pos.x - self.pos.x) * dir.x + (b.pos.z - self.pos.z) * dir.z));
      const gap = Math.hypot(b.pos.x - self.pos.x - dir.x * t, b.pos.z - self.pos.z - dir.z * t);
      const initialGap = Math.hypot(b.pos.x - self.pos.x, b.pos.z - self.pos.z);
      // Already crowded actors may separate, but cannot move deeper into or
      // through the overlap while seeking an attack lane.
      return Math.abs(b.pos.y - self.pos.y) < 1.5 && gap < ownRadius + getCharacterModelCollisionProfile(b.modelType).radius + .1 &&
        (t > .001 || Math.hypot(b.pos.x - destination.x, b.pos.z - destination.z) <= initialGap);
    })) continue;
    const shot = choose(destination);
    if (!shot) continue;
    const score = shot.score - step * 12;
    if (!move || score > move.score + 1e-8) move = { destination, score };
  }
  return move ? { kind: 'reposition', destination: move.destination } : { kind: 'hold' };
}
