import type { UniversalSettings } from '../types';
import type { FieldPoint, GrifballAssignment, GrifballTeamPlanState } from './aiGrifballTeamPlan';
import { tickBallPhysics, GRIFBALL_BALL_RADIUS, type GrifballBall, type BallArenaBounds, type Vec3 } from './grifballBall';
import { isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { resolveHammerSlamTiming } from './hammerSlamTiming';

export interface HammerDefenseDecision {
  action: 'continue' | 'strike' | 'committed'; reason: string;
  reaction: number; throwAge: number; impactIn: number;
  heading?: FieldPoint; predictedBall?: Vec3;
}
export interface ObservedGrifballThrow { team: string; carrierId: string; age: number }

/** Roster animation discards overshoot at each phase boundary. Ball physics runs
 * before the roster's impact, including the first animation tick on commitment. */
export function hammerDefenseImpactTicks(settings: UniversalSettings, dt: number): number {
  const timing = resolveHammerSlamTiming(settings);
  let ticks = 0;
  for (const duration of [timing.windupTime, timing.attackTime])
    for (let elapsed = 0; elapsed < duration; elapsed += dt) ticks++;
  return ticks;
}

/** Plan a stationary blast using visible ball motion. Never mutates the ball or
 * guarantees contact after another actor/body/weapon changes its trajectory. */
export function chooseGrifballHammerDefense(input: {
  assignment: GrifballAssignment | undefined; settings: UniversalSettings; dt: number;
  pos: Vec3; team: string; ball: GrifballBall; bounds: BallArenaBounds | undefined;
  ownGoal: FieldPoint | null | undefined; observedThrow: ObservedGrifballThrow | undefined;
  eligible: boolean; nearbyEnemy: boolean;
}): HammerDefenseDecision | null {
  const { assignment, settings, ball, pos, observedThrow, dt } = input, tuning = assignment?.tuning;
  if (!tuning?.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !tuning.hammerDefenseEnabled ||
    !assignment.geometry || !input.eligible || !Number.isFinite(dt) || dt <= 0) return null;
  const decision = (reason: string): HammerDefenseDecision => ({ action: 'continue', reason,
    reaction: tuning.hammerDefenseReaction, throwAge: observedThrow?.age ?? 0, impactIn: 0 });
  if (ball.state !== 'thrown') return decision('No ball in flight');
  if (!(settings.hammerBallDeflectionEnabled ?? true) || !((settings.hammerBallDeflectionStrength ?? 1) > 0))
    return decision('Hammer ball deflection is disabled in match rules');
  if (!observedThrow || observedThrow.team === input.team) return decision('Preserve friendly or unidentified throws');
  if (observedThrow.age + 1e-9 < tuning.hammerDefenseReaction) return decision('Observed throw has not reached the reaction delay');
  if (input.nearbyEnemy) return decision('Nearby combat takes priority over pass defense');
  const goal = input.ownGoal;
  if (!goal || !input.bounds) return decision('Goal or court observation unavailable');
  if (ball.vel.x * (goal.x - ball.pos.x) + ball.vel.z * (goal.z - ball.pos.z) <= 0)
    return decision('Ball is not advancing toward our goal');
  const ticks = hammerDefenseImpactTicks(settings, dt), impactIn = ticks * dt;
  const predicted = { ...ball, pos: { ...ball.pos }, vel: { ...ball.vel }, home: { ...ball.home } };
  const range = settings.attackRange ?? 3.2, radius = settings.attackRadius ?? 4.5;
  if (Math.hypot(ball.pos.x - pos.x, ball.pos.z - pos.z) > range + radius + GRIFBALL_BALL_RADIUS + Math.hypot(ball.vel.x, ball.vel.z) * impactIn)
    return decision('Ball cannot reach this defender during the strike');
  for (let tick = 0; tick < ticks; tick++) {
    const previous = { ...predicted.pos };
    tickBallPhysics(predicted, dt, Infinity, input.bounds);
    if (!isSpaceSegmentOpen(assignment.geometry, previous, predicted.pos)) return decision('Predicted flight crosses blocked space');
  }
  const dx = predicted.pos.x - pos.x, dz = predicted.pos.z - pos.z, distance = Math.hypot(dx, dz);
  if (predicted.state !== 'thrown' || distance < .001) return decision('No airborne strike opportunity');
  if (dx * (goal.x - pos.x) + dz * (goal.z - pos.z) >= 0)
    return decision('Deflection could send the ball toward our goal');
  if (!isSpaceSegmentOpen(assignment.geometry, pos, predicted.pos)) return decision('Strike path is blocked');
  const heading = { x: dx / distance, z: dz / distance };
  const miss = Math.hypot(dx - heading.x * range, predicted.pos.y - pos.y - 1.2, dz - heading.z * range);
  if (miss > radius + GRIFBALL_BALL_RADIUS - .2) return { ...decision('Ball will be outside the blast margin'), impactIn };
  return { ...decision('Strike the incoming enemy pass away from our goal'), action: 'strike', impactIn,
    heading, predictedBall: { ...predicted.pos } };
}

/** Keep a selected strike's heading and position until its own animation ends.
 * Death, flight, weapon changes and reset revoke this short commitment. */
export function resolveGrifballHammerDefense(plan: GrifballTeamPlanState, botId: string,
  allowed: boolean, activeStrike: boolean, input: Omit<Parameters<typeof chooseGrifballHammerDefense>[0], 'assignment'>) {
  const assignment = plan.assignments.get(botId);
  if (assignment) delete assignment.hammerDefense;
  const committed = plan.hammerDefenseCommitments?.[botId];
  if (allowed && activeStrike && committed) {
    const result: HammerDefenseDecision = { ...committed, action: 'committed', reason: 'Finish the committed pass-defense strike',
      impactIn: Math.max(0, committed.impactIn - input.dt), throwAge: input.observedThrow?.age ?? committed.throwAge };
    plan.hammerDefenseCommitments![botId] = result;
    if (assignment) assignment.hammerDefense = result;
    return result;
  }
  if (plan.hammerDefenseCommitments) delete plan.hammerDefenseCommitments[botId];
  if (!allowed) return null;
  const result = chooseGrifballHammerDefense({ ...input, assignment });
  if (result?.action === 'strike') (plan.hammerDefenseCommitments ??= {})[botId] = result;
  if (assignment && result) assignment.hammerDefense = result;
  return result;
}
