import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { fieldDistance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { resolveTeamTactics } from './grifballTacticsConfig';

/** Closest separation during a straight dash against observed linear motion.
 * Checking the continuous segment also catches fast crossing lunges. */
function separation(origin: FieldPoint, velocity: FieldPoint, other: GrifballTacticalPlayer, from: number, to: number) {
  const x = origin.x - other.pos.x, z = origin.z - other.pos.z;
  const vx = velocity.x - other.vel.x, vz = velocity.z - other.vel.z;
  const speed2 = vx * vx + vz * vz;
  const t = speed2 > 0 ? Math.max(from, Math.min(to, -(x * vx + z * vz) / speed2)) : from;
  return Math.hypot(x + vx * t, z + vz * t);
}

/** Direction only, after the combat FSM has committed to a defensive dash.
 * No random draws, movement, cooldown changes, or new attack permissions.
 * Missing observations leave the existing combat decision intact. */
export function selectGrifballEscortEvasion(input: {
  snapshot: GrifballTacticalSnapshot; assignment?: GrifballAssignment;
  botId: string; origin: FieldPoint; fallback: FieldPoint; distance: number; duration: number;
}): FieldPoint {
  const { snapshot: s, assignment: a, botId, origin, fallback, distance, duration } = input;
  const self = s.players.find(p => p.id === botId), carrier = s.players.find(p => p.id === s.holderId);
  if (!s.playing || !s.geometry || !s.tactics || !self?.scripted || !carrier || carrier.id === botId ||
    carrier.team !== self.team || !a || a.botId !== botId || a.team !== self.team || a.carrierId !== carrier.id ||
    !['lead', 'cover', 'safety'].includes(a.role) || !(distance > 0) || !(duration > 0)) return fallback;
  const tuning = resolveTeamTactics(s.tactics, self.team);
  if (!tuning.enabled || !tuning.spacingEnabled || !tuning.spaceEnabled || !tuning.runnerEnabled) return fallback;
  const length = Math.hypot(fallback.x, fallback.z);
  if (!Number.isFinite(length) || length < .001) return fallback;
  const enemies = s.players.filter(p => p.team !== self.team), allies = s.players.filter(p => p.team === self.team && p.id !== botId);
  if (enemies.some(p => !p.space)) return fallback;
  const original = { x: fallback.x / length, z: fallback.z / length };
  const carrierEnd = { x: carrier.pos.x + carrier.vel.x * duration, z: carrier.pos.z + carrier.vel.z * duration };
  const measure = (direction: FieldPoint) => {
    const velocity = { x: direction.x * distance / duration, z: direction.z * distance / duration };
    const end = { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance };
    // Observe every enemy, not just the current combat target. An attack that
    // can become ready during the dash is conservatively dangerous thereafter.
    const clearance = enemies.map(enemy => {
      const o = enemy.space!, from = o.phase === 'lunging' ? 0 : Math.max(0, o.attackIn);
      const during = from <= duration ? separation(origin, velocity, enemy, from, duration) - o.reach : Infinity;
      // A visible windup must not be forgotten just because its impact is after
      // dash release. Check the landing point at that impact without assuming
      // a future escape decision will rescue it. Uncommitted future attacks
      // beyond the dash remain the next combat decision's responsibility.
      const committed = ['swing_up', 'swing_down', 'melee_up', 'melee_down', 'melee_swing', 'slashing', 'lunging'].includes(o.phase);
      const landing = committed && from > duration && from <= tuning.threatHorizon
        ? Math.hypot(end.x - enemy.pos.x - enemy.vel.x * from, end.z - enemy.pos.z - enemy.vel.z * from) - o.reach : Infinity;
      return Math.min(during, landing);
    });
    const allyClearance = allies.map(ally => separation(origin, velocity, ally, 0, duration));
    const gap = fieldDistance(end, carrierEnd);
    return { direction, end, clearance, allyClearance,
      cost: Math.max(0, gap - tuning.coverageBoundary) + .25 * fieldDistance(end, a.destination) };
  };
  const baseline = measure(original);
  let best = baseline;
  for (const direction of [{ x: -original.z, z: original.x }, { x: original.z, z: -original.x }]) {
    const candidate = measure(direction);
    if (!isSpaceSegmentOpen(s.geometry, origin, candidate.end)) continue;
    // Coverage never purchases a new attack exposure or worse existing one.
    if (candidate.clearance.some((value, i) => value + 1e-9 < Math.min(0, baseline.clearance[i]))) continue;
    if (candidate.allyClearance.some((value, i) => value + 1e-9 < Math.min(tuning.separation, baseline.allyClearance[i]))) continue;
    if (candidate.cost + tuning.positionHysteresis < best.cost) best = candidate;
  }
  return best === baseline ? fallback : best.direction;
}
