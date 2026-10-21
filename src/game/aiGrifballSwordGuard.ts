import type { UniversalSettings } from '../types';
import type { FieldPoint, GrifballAssignment } from './aiGrifballTeamPlan';
import { isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { GRIFBALL_PUNCH_RADIUS, resolvePunchLungeDistance } from './runnerBallSettings';
import { isOverGoalPlate, type GoalPlate } from './grifballGoals';
import { GRIFBALL_SWORD_GUARD_PREFERENCES, type GrifballPlayerStyle } from './grifballPlayerStyles';

type Point = FieldPoint & { y: number };
export interface ObservedRunnerPunch {
  id: string; pos: Point; heading: Point; originHeight: number; bodyHeight: number;
  radiusBonus: number; age: number; remaining: number;
}
export interface SwordGuardDecision {
  action: 'space' | 'continue'; reason: string; targetId: string;
  reaction: number; punchAge: number; punchRemaining: number;
  velocity?: FieldPoint;
  individuality?: { style: GrifballPlayerStyle; strength: number; reason: string;
    teamReaction: number; teamClearance: number; clearance: number };
}

/** A short, visible-punch response before ordinary combat arbitration. It never
 * starts/cancels an attack or changes a cooldown. Hosts retain action ownership. */
export function chooseGrifballSwordGuard(input: {
  assignment: GrifballAssignment | undefined; settings: UniversalSettings; dt: number;
  pos: Point; bodyHeight: number; radiusBonus: number; ownGoals?: readonly GoalPlate[];
  eligible: boolean; punch: ObservedRunnerPunch | null;
  playerStyle?: GrifballPlayerStyle;
}): SwordGuardDecision | null {
  const { assignment, punch, settings, pos, dt } = input, tuning = assignment?.tuning;
  if (!tuning?.enabled || !tuning.spaceEnabled || !tuning.defenseEnabled || !tuning.swordGuardEnabled ||
    !assignment?.geometry || !input.eligible || !punch) return null;
  const strength = tuning.swordGuardAgencyStrength ?? 0, style = input.playerStyle ?? 'balanced';
  const preference = GRIFBALL_SWORD_GUARD_PREFERENCES[style], teamClearance = .25;
  const reaction = Math.max(0, Math.min(.3, tuning.swordGuardReaction + strength * preference.reaction));
  const clearance = teamClearance + strength * preference.clearance;
  const individuality = strength > 0 ? { style, strength, reason: preference.reason,
    teamReaction: tuning.swordGuardReaction, teamClearance, clearance } : undefined;
  const decision = (reason: string): SwordGuardDecision => ({ action: 'continue', reason, targetId: punch.id,
    reaction, punchAge: punch.age, punchRemaining: punch.remaining, ...(individuality ? { individuality } : {}) });
  if (punch.remaining <= 0) return decision('Runner punch is inactive; resume ordinary combat');
  if (punch.age + 1e-9 < reaction) return decision('Visible punch has not reached the reaction delay');
  const dx = pos.x - punch.pos.x, dz = pos.z - punch.pos.z, distance = Math.hypot(dx, dz);
  if (distance < .001 || !isSpaceSegmentOpen(assignment.geometry, pos, punch.pos))
    return decision('No clear approach to the runner');
  // Conservative first-contact estimate for a new lunge. A slash uses its actual
  // midpoint; both must arrive after the punch before normal combat is released.
  const contactRadius = 1.5 + punch.radiusBonus;
  const lungeIn = distance <= Math.min(18, settings.swordLungeDistance ?? 14.5)
    ? Math.max(0, distance - contactRadius) / Math.max(.01, settings.swordLungeSpeed ?? 24) : Infinity;
  const slashIn = Math.hypot(distance, pos.y + 1.65 - punch.pos.y - punch.bodyHeight) <= 2.8 + punch.radiusBonus
    ? (settings.swordSlashSpeed ?? .22) * .5 : Infinity;
  const reach = resolvePunchLungeDistance(settings), radius = GRIFBALL_PUNCH_RADIUS + input.radiusBonus;
  const impact = { x: punch.pos.x + punch.heading.x * reach, y: punch.pos.y + punch.originHeight + punch.heading.y * reach,
    z: punch.pos.z + punch.heading.z * reach };
  const exposedAt = (range: number) => Math.hypot(punch.pos.x + dx / distance * range - impact.x,
    pos.y + input.bodyHeight - impact.y, punch.pos.z + dz / distance * range - impact.z) <= radius;
  // A normal punch landing during sword windup also cancels it. Already inside
  // the punch volume, wait for recovery even if our own impact would come later.
  const exposedNow = exposedAt(distance);
  if (!exposedNow && Math.min(lungeIn, slashIn) >= punch.remaining + dt)
    return decision('Punch should end before a new sword attack reaches the runner');
  if (!exposedNow && !(lungeIn < punch.remaining + dt && exposedAt(Math.min(distance, contactRadius))))
    return decision('Observed punch is facing away from the sword approach');
  // Do not concede an immediate score for a cleaner duel. Expand the actual goal
  // footprint by plausible travel during this short wait, including a small margin.
  const goalMargin = .5 + Math.max(0, 5.2 * settings.speedForward / 100) * Math.min(.6, punch.remaining + .15);
  if (input.ownGoals?.some(goal => isOverGoalPlate(punch.pos.x, punch.pos.z, goal, goalMargin)))
    return decision('Immediate goal threat takes priority over waiting for the punch');
  const gap = reach + radius + clearance;
  // Keep this short retreat within the shared grounded objective walk budget.
  const speed = Math.min(Math.max(0, 5.2 * Math.min(settings.speedBackward, settings.speedForward) / 100), Math.max(0, gap - distance) / dt);
  const velocity = { x: dx / distance * speed, z: dz / distance * speed };
  if (!isSpaceSegmentOpen(assignment.geometry, pos, { x: pos.x + velocity.x * dt, z: pos.z + velocity.z * dt }))
    velocity.x = velocity.z = 0;
  return { ...decision('Give the visible punch room, then resume ordinary combat'), action: 'space', velocity };
}

/** Both hosts normalize to elapsed age and remaining active time at observation. */
export function runnerPunchClock(phase: string, phaseElapsed: number, settings: UniversalSettings) {
  const up = settings.hammerMeleeSpeed ?? .24, down = Math.max(.03, up * .5);
  return phase === 'swing_up' ? { age: phaseElapsed, remaining: Math.max(0, up - phaseElapsed) + down }
    : phase === 'swing_down' ? { age: up + phaseElapsed, remaining: Math.max(0, down - phaseElapsed) }
    : { age: 0, remaining: 0 };
}
