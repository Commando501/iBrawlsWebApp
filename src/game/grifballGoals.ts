import { type CustomMapData } from '../types';
import { type TeamId } from './teamScoring';

/**
 * A resolved Grifball goal plate: the flat trigger volume a carrier must reach.
 * `team` is the OWNING team — an *enemy* carrier standing here scores.
 */
export interface GoalPlate {
  team: TeamId;
  position: { x: number; y: number; z: number };
  halfExtents: { x: number; z: number };
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
