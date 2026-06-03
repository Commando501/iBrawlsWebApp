import { type TeamId } from './teamScoring';
import { type GoalPlate } from './grifballGoals';

/**
 * Objective-AI helpers for Grifball. Kept pure so the role logic is testable; the
 * component applies the resulting destinations/biases to the live AI tick.
 *
 * Emergent role play falls out of two rules layered on the existing combat AI:
 *  - the ball carrier (Runner) sprints to the enemy goal instead of fighting, and
 *  - the enemy team focus-fires the carrier (Chasers), which pulls their fight to
 *    the carrier's lane while the carrier's own teammates (Escorts) fight back.
 */

/** The plate a carrier on `team` is trying to reach: the enemy-owned plate. */
export function enemyGoalForTeam(team: TeamId | undefined, plates: GoalPlate[]): GoalPlate | null {
  if (!team) return null;
  return plates.find((p) => p.team !== team) ?? null;
}

/** The plate a defender on `team` protects: their own plate. */
export function ownGoalForTeam(team: TeamId | undefined, plates: GoalPlate[]): GoalPlate | null {
  if (!team) return null;
  return plates.find((p) => p.team === team) ?? null;
}
