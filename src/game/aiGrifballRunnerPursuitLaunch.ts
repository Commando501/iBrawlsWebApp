import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { chooseGrifballRunnerPursuit } from './aiGrifballRunnerPursuit';
import { resolveTeamTactics } from './grifballTacticsConfig';
import { isSpaceSegmentOpen } from './grifballSpaceGeometry';

export type RunnerPursuitLaunch = { kind: 'ordinary' } | { kind: 'hold'; reason: string } |
  { kind: 'intercept'; point: FieldPoint; seconds: number };

/** Called only after combat permits a ready sword launch. Re-observe at that
 * boundary: neither the old plan's intercept nor its swap delay is a launch aim.
 * Flight remains straight once committed; this never steers an airborne sword. */
export function resolveGrifballRunnerPursuitLaunch(assignment: GrifballAssignment | undefined,
  snapshot: GrifballTacticalSnapshot, targetId: string): RunnerPursuitLaunch {
  const ordinary: RunnerPursuitLaunch = { kind: 'ordinary' };
  if (!assignment?.defense?.pursuit || targetId !== assignment.carrierId) return ordinary;
  const tuning = snapshot.tactics ? resolveTeamTactics(snapshot.tactics, assignment.team) : assignment.tuning;
  if (!tuning?.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !tuning.runnerPursuitEnabled) return ordinary;
  const previous = assignment.defense.pursuit;
  const hold = (reason: string): RunnerPursuitLaunch => ({ kind: 'hold', reason });
  const stale = (reason: string) => previous.weapon === 'sword' ? hold(reason) : ordinary;
  if (!snapshot.playing || snapshot.holderId !== targetId)
    return stale('The assigned runner no longer owns this pursuit.');
  const self = snapshot.players.find(p => p.id === assignment.botId);
  const runner = snapshot.players.find(p => p.id === targetId);
  if (!self?.scripted || self.difficulty === 'easy' || self.team !== assignment.team) return ordinary;
  const rules = snapshot.runnerPursuitRules, geometry = snapshot.geometry, goal = snapshot.goals[assignment.team];
  if (!rules || !geometry || !goal || !self.space || self.space.weapon !== 'sword' || !runner)
    return stale('Current pursuit observations are unavailable.');
  // Readiness was authorized by the combat owner immediately before this call.
  // A just-finished swap/AI clock in the public snapshot must not add a new delay.
  const players = snapshot.players.map(p => p.id === self.id
    ? { ...p, space: { ...self.space!, attackIn: rules.swordImpact } } : p);
  const current = chooseGrifballRunnerPursuit({ ...assignment, tuning, geometry,
    defense: { ...assignment.defense, pursuit: { ...previous, rules, goal } } }, players);
  if (current?.weapon !== 'sword') return current?.hammerETA !== null && current?.hammerETA !== undefined
    ? ordinary : stale(current?.reason || 'The sword pursuit is no longer feasible.');

  // Solve |runner + velocity*t - self| = swordSpeed*t for center contact.
  // Center aim leaves collision margin for discrete ticks; the weapon-selection
  // forecast can accept an edge contact that is too marginal to commit here.
  const x = runner.pos.x - self.pos.x, z = runner.pos.z - self.pos.z;
  const a = runner.vel.x ** 2 + runner.vel.z ** 2 - rules.lungeSpeed ** 2;
  const b = 2 * (x * runner.vel.x + z * runner.vel.z), c = x * x + z * z;
  const discriminant = b * b - 4 * a * c;
  const roots = Math.abs(a) < 1e-8 ? (Math.abs(b) > 1e-8 ? [-c / b] : [])
    : discriminant >= 0 ? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)] : [];
  const seconds = Math.min(...roots.filter(t => Number.isFinite(t) && t > 0));
  if (!Number.isFinite(seconds) || seconds > Math.min(current.horizon, rules.lungeDistance / rules.lungeSpeed))
    return hold('No center interception fits the remaining sword travel and goal deadline.');
  const point = { x: runner.pos.x + runner.vel.x * seconds, z: runner.pos.z + runner.vel.z * seconds };
  if (!isSpaceSegmentOpen(geometry, self.pos, point) || !isSpaceSegmentOpen(geometry, runner.pos, point))
    return hold('The updated interception crosses a blocker or court boundary.');
  return { kind: 'intercept', point, seconds };
}
