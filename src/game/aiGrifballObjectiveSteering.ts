import { getGrifballSpacingOffset } from './aiGrifballRoles';
import { getGrifballSpaceWaypoint } from './aiGrifballSpace';
import { selectGrifballAssignmentThreat, type FieldPoint, type GrifballAssignment, type GrifballTacticalPlayer } from './aiGrifballTeamPlan';
import { isSpaceSegmentOpen } from './grifballSpaceGeometry';

export interface GrifballGroundMovement {
  velocity: FieldPoint;
  /** Omitted when arrival produces no steering; preserve the existing facing. */
  heading?: FieldPoint;
}

export function computeSpacedGroundMovement({ pos, target, spacing, arrivalRadius, speed, dt }: {
  pos: FieldPoint; target: FieldPoint; spacing: FieldPoint; arrivalRadius: number; speed: number; dt: number;
}): GrifballGroundMovement {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const distance = Math.hypot(dx, dz);
  const arrival = Math.min(1, distance / arrivalRadius);
  const steerX = (distance > .01 ? dx / distance * arrival : 0) + spacing.x;
  const steerZ = (distance > .01 ? dz / distance * arrival : 0) + spacing.z;
  const length = Math.hypot(steerX, steerZ);
  if (length < .01) return { velocity: { x: 0, z: 0 } };
  const moveSpeed = Math.min(speed * Math.min(1, length), (distance + Math.hypot(spacing.x, spacing.z)) / Math.max(dt, .001));
  const heading = { x: steerX / length, z: steerZ / length };
  return { velocity: { x: heading.x * moveSpeed, z: heading.z * moveSpeed }, heading };
}

/** Shared decision only. Each host integrates and constrains its own position.
 * Null delegates runner/combat behavior to the caller's existing controller. */
export function resolveGrifballSupportSteering({ assignment, pos, allies, players, ball, heldByAnyone, separation, speed, dt }: {
  assignment: GrifballAssignment | undefined; pos: FieldPoint; allies: FieldPoint[];
  players: GrifballTacticalPlayer[]; ball: FieldPoint; heldByAnyone: boolean;
  separation: number; speed: number; dt: number;
}): (GrifballGroundMovement & { pickupRequested: boolean }) | null {
  if (!assignment || assignment.role === 'runner' || selectGrifballAssignmentThreat(assignment, pos, players)) return null;
  const { geometry, space } = assignment;
  const waypoint = geometry && space ? getGrifballSpaceWaypoint(geometry, pos, space) : null;
  if (space && !waypoint) return { velocity: { x: 0, z: 0 }, pickupRequested: !heldByAnyone && assignment.role === 'retriever' };
  const pickupRequested = !heldByAnyone && (assignment.role === 'retriever' || !!assignment.receive);
  const spacing = getGrifballSpacingOffset(pos, assignment.role === 'retriever' || assignment.receive ? [] : allies,
    assignment.tuning?.spacingEnabled === false ? 4 : (assignment.tuning?.separation ?? separation));
  let movement = computeSpacedGroundMovement({ pos,
    target: waypoint ?? (pickupRequested && !assignment.receive ? ball : assignment.destination), spacing,
    arrivalRadius: space?.route.status === 'routed' ? .25 : assignment.tuning?.spacingEnabled === false ? 1.5 : (assignment.tuning?.arrivalRadius ?? 1.5), speed, dt });
  // Predict only to veto/retry steering. Never return a replacement engine pose.
  const open = () => !geometry || isSpaceSegmentOpen(geometry, pos,
    { x: pos.x + movement.velocity.x * dt, z: pos.z + movement.velocity.z * dt });
  if (!open()) {
    movement = { ...movement, velocity: { x: 0, z: 0 } };
    if (waypoint) {
      const retry = computeSpacedGroundMovement({ pos, target: waypoint, spacing: { x: 0, z: 0 }, arrivalRadius: .25, speed, dt });
      movement = { ...retry, heading: retry.heading ?? movement.heading };
    }
    if (!open()) movement = { ...movement, velocity: { x: 0, z: 0 } };
  }
  return { ...movement, pickupRequested };
}
