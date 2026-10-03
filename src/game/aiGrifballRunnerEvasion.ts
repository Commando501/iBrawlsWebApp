import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { resolveTeamTactics } from './grifballTacticsConfig';

function minimumSeparation(origin: FieldPoint, velocity: FieldPoint, other: GrifballTacticalPlayer, from: number, to: number) {
  const x = origin.x - other.pos.x, z = origin.z - other.pos.z;
  const vx = velocity.x - other.vel.x, vz = velocity.z - other.vel.z;
  const speed2 = vx * vx + vz * vz;
  const time = speed2 > 0 ? Math.max(from, Math.min(to, -(x * vx + z * vz) / speed2)) : from;
  return Math.hypot(x + vx * time, z + vz * time);
}

const committed = (player: GrifballTacticalPlayer) =>
  ['swing_up', 'swing_down', 'melee_up', 'melee_down', 'melee_swing', 'slashing', 'lunging'].includes(player.space!.phase);

/** A runner escape decision from fresh public observations. The caller owns
 * grounded/weapon readiness, thrust permission, cooldowns and physical execution.
 * This function neither advances time nor predicts future enemy decisions. */
export function selectGrifballRunnerEvasion(input: {
  snapshot: GrifballTacticalSnapshot; assignment?: GrifballAssignment; botId: string;
  origin: FieldPoint; movement: FieldPoint; distance: number; duration: number;
}): FieldPoint | null {
  const { snapshot: s, assignment: a, botId, origin, movement, distance, duration } = input;
  const self = s.players.find(p => p.id === botId);
  if (!s.playing || !s.geometry || !s.tactics || s.holderId !== botId || !self?.scripted ||
    !a || a.botId !== botId || a.team !== self.team || a.role !== 'runner' || a.carrierId !== botId ||
    !a.runner || !(distance > 0) || !(duration > 0) ||
    ![origin.x, origin.z, movement.x, movement.z, distance, duration].every(Number.isFinite)) return null;
  const tuning = resolveTeamTactics(s.tactics, self.team);
  if (!tuning.enabled || !tuning.spaceEnabled || !tuning.runnerEnabled) return null;
  const goal = s.goals[self.team === 'blue' ? 'red' : 'blue'];
  if (!goal) return null;
  const dx = goal.x - origin.x, dz = goal.z - origin.z, length = Math.hypot(dx, dz);
  if (length < .001) return null;
  const enemies = s.players.filter(p => p.team !== self.team);
  if (!enemies.length || enemies.some(p => !p.space)) return null;
  const measure = (velocity: FieldPoint) => {
    const end = { x: origin.x + velocity.x * duration, z: origin.z + velocity.z * duration };
    const clearances = enemies.map(enemy => {
      const observation = enemy.space!, from = observation.phase === 'lunging' ? 0 : Math.max(0, observation.attackIn);
      const during = from <= duration ? minimumSeparation(origin, velocity, enemy, from, duration) - observation.reach : Infinity;
      // A windup can land just after the thrust ends. Do not assume a future
      // steering decision will rescue a landing point inside that attack.
      const landing = committed(enemy) && from > duration && from <= tuning.threatHorizon
        ? Math.hypot(end.x - enemy.pos.x - enemy.vel.x * from, end.z - enemy.pos.z - enemy.vel.z * from) - observation.reach : Infinity;
      return Math.min(during, landing);
    });
    return { end, clearances, minimum: Math.min(...clearances), goalDistance: Math.hypot(goal.x - end.x, goal.z - end.z) };
  };
  const normal = measure(movement);
  if (!enemies.some((enemy, index) => committed(enemy) && normal.clearances[index] < 0)) return null;
  let best: (ReturnType<typeof measure> & { direction: FieldPoint }) | null = null;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, cos = Math.cos(angle), sin = Math.sin(angle);
    const direction = { x: (dx * cos - dz * sin) / length, z: (dx * sin + dz * cos) / length };
    const candidate = measure({ x: direction.x * distance / duration, z: direction.z * distance / duration });
    if (!isSpaceSegmentOpen(s.geometry, origin, candidate.end) ||
      candidate.minimum <= normal.minimum + tuning.positionHysteresis ||
      candidate.clearances.some((clearance, index) => clearance + 1e-9 < Math.min(0, normal.clearances[index]))) continue;
    // Once a route clears every observed threat, spend the escape on the
    // objective instead of buying unlimited clearance by retreating. If all
    // routes remain exposed, maximize clearance as before. This is predicted
    // exposure, not a guarantee against enemy steering or subsequent attacks.
    const clear = candidate.minimum > 0, bestClear = !!best && best.minimum > 0;
    if (!best || clear && !bestClear || clear === bestClear && (clear
      ? candidate.goalDistance < best.goalDistance - 1e-9 ||
        Math.abs(candidate.goalDistance - best.goalDistance) <= 1e-9 && candidate.minimum > best.minimum + 1e-9
      : candidate.minimum > best.minimum + 1e-9 ||
        Math.abs(candidate.minimum - best.minimum) <= 1e-9 && candidate.goalDistance < best.goalDistance - 1e-9))
      best = { ...candidate, direction };
  }
  return best?.direction ?? null;
}
