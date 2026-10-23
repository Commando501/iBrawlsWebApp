import type { UniversalSettings } from '../types';
import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer } from './aiGrifballTeamPlan';
import { createSpaceRouter, fieldDistance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { resolveHammerSlamTiming } from './hammerSlamTiming';
import { getSprintSpeedMultiplier } from './aiMovementMechanics';
import { resolveAICombatDangerZone } from './aiCombatDecision';

export interface RunnerPursuitRules {
  speed: number; hammerReach: number; hammerImpact: number;
  lungeMinDistance: number; lungeDistance: number; lungeSpeed: number; swordImpact: number; swapReady: number;
}
export interface RunnerPursuitDecision {
  weapon: 'sword' | null; reason: string;
  hammerETA: number | null; swordETA: number | null; horizon: number;
  intercept: FieldPoint | null;
}
export interface RunnerPursuitPlan extends RunnerPursuitDecision {
  rules: RunnerPursuitRules; goal: FieldPoint;
}

/** Physical budgets only. Weapon preferences and action ownership stay in combat. */
export function runnerPursuitRules(settings: UniversalSettings): RunnerPursuitRules {
  const slam = resolveHammerSlamTiming(settings);
  return { speed: 5.2 * settings.speedForward / 100 *
    (settings.enableSprint ? Math.max(1, getSprintSpeedMultiplier(settings.speedSprint)) : 1),
    hammerReach: settings.attackRange + settings.attackRadius,
    hammerImpact: slam.windupTime + slam.attackTime,
    lungeMinDistance: resolveAICombatDangerZone(settings, 'ball') * .85,
    lungeDistance: Math.min(18, settings.swordLungeDistance ?? 14.5),
    lungeSpeed: settings.swordLungeSpeed ?? 24, swordImpact: (settings.swordSlashSpeed ?? .22) * .5,
    swapReady: Math.max(0, settings.weaponReadyTime) };
}

/** Bounded constant-velocity forecast, recomputed from public observations at
 * handoff and weapon choice. Null ETAs mean no feasible contact within the horizon.
 * A sword needs an open direct flight; it never inherits a routed ground shortcut. */
export function chooseGrifballRunnerPursuit(assignment: GrifballAssignment,
  players: readonly GrifballTacticalPlayer[], position?: FieldPoint): RunnerPursuitDecision | null {
  const tuning = assignment.tuning, plan = assignment.defense?.pursuit, geometry = assignment.geometry;
  if (!tuning?.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !tuning.runnerPursuitEnabled || !plan || !geometry) return null;
  const self = players.find(p => p.id === assignment.botId), runner = players.find(p => p.id === assignment.carrierId);
  const result: RunnerPursuitDecision = { weapon: null, reason: '', hammerETA: null, swordETA: null,
    horizon: tuning.defenseLookahead, intercept: null };
  const keep = (reason: string) => ({ ...result, reason });
  if (!self?.scripted || self.difficulty === 'easy' || !runner || runner.team === self.team || runner.space?.weapon !== 'ball' ||
    assignment.defense?.targetId !== runner.id) return keep('No eligible assigned enemy runner.');
  const order = assignment.defense!;
  const start = position ?? self.pos;
  const goalX = plan.goal.x - runner.pos.x, goalZ = plan.goal.z - runner.pos.z;
  const beatenSafety = order.mode === 'last-defender' &&
    (start.x - runner.pos.x) * goalX + (start.z - runner.pos.z) * goalZ <= 0 &&
    runner.vel.x * goalX + runner.vel.z * goalZ > 0;
  if (!order.emergency && order.mode !== 'intercept' && !beatenSafety) return keep('Keep the assigned defensive coverage.');
  if (!self.space || !['hammer', 'sword'].includes(self.space.weapon) || self.space.phase !== 'ready' ||
    self.space.mobileIn > 0 || runner.space.mobileIn > 0 || (self.height ?? 0) > .01 || (runner.height ?? 0) > .01)
    return keep('Committed, airborne or recovering actors keep ordinary action ownership.');
  if ((self.swapLockoutRemaining ?? 0) > 0 && self.space.weapon !== 'sword') return keep('Weapon swap is locked.');
  if ((runner.invulnerabilityTimer ?? 0) > 0) return keep('Runner is protected.');
  const rules = plan.rules;
  if (![start.x, start.z, runner.pos.x, runner.pos.z, runner.vel.x, runner.vel.z,
    ...Object.values(rules), result.horizon].every(Number.isFinite) || rules.lungeSpeed <= 0 || rules.lungeDistance <= 0)
    return keep('Pursuit observations or movement budgets are unavailable.');
  const gap = fieldDistance(start, runner.pos), speed = Math.hypot(runner.vel.x, runner.vel.z);
  if (speed <= .5) return keep('Runner is not moving; keep ordinary interception.');
  if (!isSpaceSegmentOpen(geometry, start, runner.pos)) return keep('No open sword approach; keep the routed ground cut.');
  const point = (t: number): FieldPoint => ({ x: runner.pos.x + runner.vel.x * t, z: runner.pos.z + runner.vel.z * t });
  // Cap the forecast before a plausible score, rather than catching a runner
  // beyond the defended goal. The margin is conservative, not a scoring query.
  const goalDistance = fieldDistance(runner.pos, plan.goal);
  const goalClosing = ((plan.goal.x - runner.pos.x) * runner.vel.x + (plan.goal.z - runner.pos.z) * runner.vel.z) / Math.max(.001, goalDistance);
  if (goalClosing > .5) result.horizon = Math.min(result.horizon, Math.max(0, goalDistance - 2) / goalClosing);
  const hammerReady = self.space.weapon === 'hammer' ? self.space.attackIn : rules.swapReady + rules.hammerImpact;
  const swordReady = self.space.weapon === 'sword' ? Math.max(0, self.space.attackIn - rules.swordImpact)
    : Math.max(rules.swapReady, self.space.attackIn - rules.hammerImpact);
  const launch = point(swordReady);
  const launchInRange = fieldDistance(start, launch) <= rules.lungeDistance &&
    gap >= rules.lungeMinDistance && gap <= rules.lungeDistance;
  const route = createSpaceRouter(geometry, start);
  // 60 samples bound the cost independently of the configured horizon.
  for (let i = 0; i <= 60; i++) {
    const t = result.horizon * i / 60, target = point(t);
    if (!isSpaceSegmentOpen(geometry, runner.pos, target)) break;
    if (result.hammerETA === null) {
      const path = route(target);
      // Only subtract reach from the final straight segment: a hammer cannot
      // strike around the last bend of a routed approach.
      const beforeTarget = path.points.length > 1 ? path.points[path.points.length - 2] : start;
      const walk = Math.max(0, path.length - Math.min(rules.hammerReach, fieldDistance(beforeTarget, target)));
      const arrival = (walk <= 0 ? 0 : rules.speed > 0 ? walk / rules.speed : Infinity) + hammerReady;
      if (path.status !== 'blocked' && arrival <= t + 1e-9) result.hammerETA = t;
    }
    const flight = t - swordReady, travel = fieldDistance(start, target);
    if (result.swordETA === null && launchInRange && flight >= 0 && flight <= rules.lungeDistance / rules.lungeSpeed &&
      travel <= rules.lungeSpeed * flight + 1.5 && isSpaceSegmentOpen(geometry, start, target)) {
      result.swordETA = t; result.intercept = target;
    }
  }
  if (result.hammerETA !== null) return keep('A hammer interception remains feasible; keep ordinary weapon preference.');
  if (result.swordETA === null) return keep('Neither weapon has a feasible contact in this forecast; keep the ground cut.');
  // Visible punches can cancel a sword. Do not force a new chase into a punch
  // facing this defender; the existing punch guard remains the timing owner.
  const facing = runner.heading && (start.x - runner.pos.x) * runner.heading.x + (start.z - runner.pos.z) * runner.heading.z;
  if (['swing_up', 'swing_down', 'windup', 'active'].includes(runner.space.phase) && (facing === undefined || facing > 0) && !order.emergency)
    return keep('Visible runner punch faces the approach; wait for ordinary punch defense.');
  return { ...result, weapon: 'sword', reason: 'Hammer cannot intercept within the forecast; a clear sword pursuit can.' };
}
