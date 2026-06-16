import { type CustomMapData } from '../types';
import { CHARACTER_MODEL_PROFILES } from '../characterModelTypes';
import { type TeamId } from './teamScoring';

export const GRIFBALL_GOAL_PLATE_RADIUS = CHARACTER_MODEL_PROFILES.medium.collision.radius;
export const GRIFBALL_GOAL_PLATE_HEIGHT = 0.12;
export const DEFAULT_GRIFBALL_GOAL_PLATE_SCALE = {
  x: GRIFBALL_GOAL_PLATE_RADIUS * 2,
  y: GRIFBALL_GOAL_PLATE_HEIGHT,
  z: GRIFBALL_GOAL_PLATE_RADIUS * 2,
} as const;

export type GoalPlateShape = 'rectangle' | 'ellipse';

/**
 * A resolved Grifball goal plate: the flat trigger volume a carrier must reach.
 * `team` is the OWNING team — an *enemy* carrier standing here scores.
 */
export interface GoalPlate {
  team: TeamId;
  position: { x: number; y: number; z: number };
  halfExtents: { x: number; z: number };
  shape?: GoalPlateShape;
}

/** Extract goal plates from a map's objects (those flagged with `goalPlateTeam`). */
export function getGoalPlates(map: CustomMapData | null | undefined): GoalPlate[] {
  if (!map?.objects?.length) return [];
  const plates: GoalPlate[] = [];
  for (const obj of map.objects) {
    const team =
      obj.goalPlateTeam ||
      (obj.texture === 'goal_plate_blue' ? 'blue' : obj.texture === 'goal_plate_red' ? 'red' : undefined);
    if (!team) continue;
    plates.push({
      team,
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      halfExtents: { x: Math.max(0.1, obj.scale.x / 2), z: Math.max(0.1, obj.scale.z / 2) },
      shape: obj.type === 'cylinder' || obj.type === 'sphere' ? 'ellipse' : 'rectangle',
    });
  }
  return plates;
}

/** True if a horizontal position sits over the plate's footprint (with optional margin). */
export function isOverGoalPlate(
  x: number,
  z: number,
  plate: GoalPlate,
  margin = 0
): boolean {
  if (plate.shape === 'ellipse') {
    const rx = Math.max(0.1, plate.halfExtents.x + margin);
    const rz = Math.max(0.1, plate.halfExtents.z + margin);
    const nx = (x - plate.position.x) / rx;
    const nz = (z - plate.position.z) / rz;
    return nx * nx + nz * nz <= 1;
  }

  return (
    Math.abs(x - plate.position.x) <= plate.halfExtents.x + margin &&
    Math.abs(z - plate.position.z) <= plate.halfExtents.z + margin
  );
}

/**
 * Find the goal a carrier on `carrierTeam` would score on by standing at (x,z):
 * an *enemy*-owned plate they are currently over. Returns the owning team of that
 * plate (i.e. the team that gets scored against), or null.
 */
export function findScoringPlate(
  x: number,
  z: number,
  carrierTeam: TeamId,
  plates: GoalPlate[],
  margin = 0
): GoalPlate | null {
  for (const plate of plates) {
    if (plate.team === carrierTeam) continue; // own goal never scores
    if (isOverGoalPlate(x, z, plate, margin)) return plate;
  }
  return null;
}
