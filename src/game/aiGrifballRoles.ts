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

/** Grifball AI Roles */
export type GrifballRole = 'runner' | 'escort' | 'chaser';

/** Resolves the tactical role of an AI bot. */
export function getGrifballRole(
  botId: string,
  botTeam: TeamId | undefined,
  ballHolderId: string | null,
  ballHolderTeam: TeamId | undefined
): GrifballRole {
  if (ballHolderId === botId) {
    return 'runner';
  }
  if (ballHolderId && ballHolderTeam && botTeam && ballHolderTeam === botTeam) {
    return 'escort';
  }
  return 'chaser';
}

/** Computes fanned screening position in front of the runner based on escort index. */
export function getGrifballEscortTarget(
  runnerPos: { x: number; y: number; z: number },
  goalPos: { x: number; y: number; z: number },
  escortIndex: number
): { x: number; z: number } {
  const dx = goalPos.x - runnerPos.x;
  const dz = goalPos.z - runnerPos.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len;
  const nz = dz / len;

  // Perpendicular vector for fanning lateral offsets
  const px = -nz;
  const pz = nx;

  let forwardOffset = 5.0;
  let lateralOffset = 0.0;

  if (escortIndex === 0) {
    forwardOffset = 6.5; // Lead block straight ahead
  } else if (escortIndex === 1) {
    forwardOffset = 4.5;
    lateralOffset = -4.5; // Left flank guard
  } else if (escortIndex === 2) {
    forwardOffset = 4.5;
    lateralOffset = 4.5; // Right flank guard
  } else {
    // Fallback/extra escorts fanned further out
    forwardOffset = 3.0;
    lateralOffset = escortIndex % 2 === 0 ? -6.0 : 6.0;
  }

  return {
    x: runnerPos.x + nx * forwardOffset + px * lateralOffset,
    z: runnerPos.z + nz * forwardOffset + pz * lateralOffset,
  };
}

/** Computes repulsion vector away from too-close allies to maintain spacing. */
export function getGrifballSpacingOffset(
  myPos: { x: number; z: number },
  allies: { x: number; z: number }[],
  minSpacing: number = 4.0
): { x: number; z: number } {
  let repelX = 0;
  let repelZ = 0;

  for (const ally of allies) {
    const dx = myPos.x - ally.x;
    const dz = myPos.z - ally.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0 && dist < minSpacing) {
      const force = (minSpacing - dist) / minSpacing;
      repelX += (dx / dist) * force * 2.2;
      repelZ += (dz / dist) * force * 2.2;
    }
  }

  return { x: repelX, z: repelZ };
}

/** Computes steering adjustments to steer the runner around blockers. */
export function getGrifballRunnerSteering(
  myPos: { x: number; z: number },
  goalPos: { x: number; z: number },
  enemies: { x: number; z: number }[],
  avoidRadius: number = 8.0
): { x: number; z: number } {
  const dx = goalPos.x - myPos.x;
  const dz = goalPos.z - myPos.z;
  const len = Math.hypot(dx, dz) || 1;
  const dirX = dx / len;
  const dirZ = dz / len;

  let avoidX = 0;
  let avoidZ = 0;
  let count = 0;

  for (const enemy of enemies) {
    const ex = enemy.x - myPos.x;
    const ez = enemy.z - myPos.z;
    const dist = Math.hypot(ex, ez);

    if (dist > 0 && dist < avoidRadius) {
      const toEnemyX = ex / dist;
      const toEnemyZ = ez / dist;
      const dot = toEnemyX * dirX + toEnemyZ * dirZ;

      if (dot > 0.25) { // Enemy blocks our path to the goal
        // Perpendicular vector
        const px = -toEnemyZ;
        const pz = toEnemyX;

        // Choose perpendicular direction closer to the goal heading
        const steerSign = (dirX * px + dirZ * pz) >= 0 ? 1 : -1;
        const weight = (avoidRadius - dist) / avoidRadius;

        avoidX += px * steerSign * weight * 3.5;
        avoidZ += pz * steerSign * weight * 3.5;
        count++;
      }
    }
  }

  if (count > 0) {
    const rx = dirX + avoidX;
    const rz = dirZ + avoidZ;
    const rLen = Math.hypot(rx, rz) || 1;
    return { x: rx / rLen, z: rz / rLen };
  }

  return { x: dirX, z: dirZ };
}
