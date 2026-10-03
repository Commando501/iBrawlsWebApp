import { getGrifballSpacingOffset, getGrifballRunnerSteering } from './aiGrifballRoles';
import { getGrifballSpaceWaypoint } from './aiGrifballSpace';
import { selectGrifballAssignmentThreat, type FieldPoint, type GrifballAssignment, type GrifballTacticalPlayer } from './aiGrifballTeamPlan';
import { isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { resolveDirectionalSpeedMultiplier } from './runnerBallSettings';
import type { UniversalSettings } from '../types';

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
export function resolveGrifballSupportSteering({ assignment, pos, allies, players, ball, heldByAnyone, separation, speed, retrySpeed = speed, dt }: {
  assignment: GrifballAssignment | undefined; pos: FieldPoint; allies: FieldPoint[];
  players: GrifballTacticalPlayer[]; ball: FieldPoint; heldByAnyone: boolean;
  separation: number; speed: number; retrySpeed?: number; dt: number;
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
      const retry = computeSpacedGroundMovement({ pos, target: waypoint, spacing: { x: 0, z: 0 }, arrivalRadius: .25, speed: retrySpeed, dt });
      movement = { ...retry, heading: retry.heading ?? movement.heading };
    }
    if (!open()) movement = { ...movement, velocity: { x: 0, z: 0 } };
  }
  return { ...movement, pickupRequested };
}

export interface GrifballCarrierDecision extends GrifballGroundMovement {
  kind: 'move' | 'blocked' | 'committed-punch' | 'punch' | 'pass' | 'wait';
}

/** Decide carrier intent from public observations. Punch/pass commitment and all
 * state integration remain owned by the host. Threat order breaks equal ranges. */
export function resolveGrifballCarrierDecision({ assignment, pos, players, threats, avoidanceEnemies, goal,
  weaponState, canStartWeaponAction, settings, dt }: {
  assignment: GrifballAssignment | undefined; pos: FieldPoint & { y: number };
  players: GrifballTacticalPlayer[];
  threats: { pos: FieldPoint & { y: number }; invulnerabilityTimer?: number }[];
  avoidanceEnemies: FieldPoint[]; goal: FieldPoint | null; weaponState: string;
  canStartWeaponAction: boolean; settings: UniversalSettings; dt: number;
}): GrifballCarrierDecision | null {
  const { geometry, space } = assignment ?? {};
  const waypoint = geometry && space ? getGrifballSpaceWaypoint(geometry, pos, space) : null;
  const stopped = (kind: GrifballCarrierDecision['kind'], heading?: FieldPoint): GrifballCarrierDecision =>
    ({ kind, velocity: { x: 0, z: 0 }, ...(heading ? { heading } : {}) });
  if (space && !waypoint) {
    if (assignment && selectGrifballAssignmentThreat(assignment, pos, players)) return null;
    return stopped('blocked');
  }
  if (!goal) return null;
  if (weaponState === 'swing_up' || weaponState === 'swing_down') return stopped('committed-punch');
  const routeDistance = waypoint ? Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z) : 0;
  const speed = 5.8 * resolveDirectionalSpeedMultiplier(settings, 'forward', true);
  const finishBeforePunch = assignment?.runner?.selected.action === 'finish' && geometry && waypoint &&
    waypoint.x === goal.x && waypoint.z === goal.z && isSpaceSegmentOpen(geometry, pos, goal) &&
    routeDistance / speed < (settings.hammerMeleeSpeed ?? .24);
  const escaping = assignment?.runner && assignment.runner.selected.action !== 'wait' && waypoint && routeDistance > .1;
  let closest: FieldPoint | undefined, distance = Infinity;
  for (const enemy of threats) {
    if ((enemy.invulnerabilityTimer ?? 0) > 0) continue;
    const dx = enemy.pos.x - pos.x, dy = enemy.pos.y - pos.y, dz = enemy.pos.z - pos.z;
    if (escaping && dx * (waypoint.x - pos.x) + dz * (waypoint.z - pos.z) < 0) continue;
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (range < distance) { distance = range; closest = { x: dx, z: dz }; }
  }
  if (!finishBeforePunch && closest && distance <= 2.2 && canStartWeaponAction && weaponState === 'ready') return stopped('punch', closest);
  if (assignment?.pass?.selected && canStartWeaponAction && weaponState === 'ready') return stopped('pass', assignment.pass.selected.direction);
  if (assignment?.runner?.selected.action === 'wait') return stopped('wait');
  // Refresh local avoidance between team-plan updates without replacing a routed
  // waypoint, an intentional zero-risk route, or an immediately reachable finish.
  const avoidOnDirectRoute = assignment?.runner && waypoint && space?.route.status === 'direct' &&
    (assignment.tuning?.runnerRiskWeight ?? 1) > 0 && !finishBeforePunch;
  const heading = assignment?.runner && waypoint && !avoidOnDirectRoute
    ? { x: (waypoint.x - pos.x) / Math.max(.001, routeDistance), z: (waypoint.z - pos.z) / Math.max(.001, routeDistance) }
    : getGrifballRunnerSteering(pos, waypoint ?? goal,
      avoidOnDirectRoute ? avoidanceEnemies.filter(enemy => isSpaceSegmentOpen(geometry!, pos, enemy)) : avoidanceEnemies, 8,
      avoidOnDirectRoute ? settings.attackRadius : 0);
  const moveSpeed = waypoint ? Math.min(speed, Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z) / Math.max(dt, .001)) : speed;
  let movement: GrifballGroundMovement = { heading, velocity: { x: heading.x * moveSpeed, z: heading.z * moveSpeed } };
  const open = () => !geometry || isSpaceSegmentOpen(geometry, pos,
    { x: pos.x + movement.velocity.x * dt, z: pos.z + movement.velocity.z * dt });
  if (!open()) {
    movement = { ...movement, velocity: { x: 0, z: 0 } };
    if (waypoint) {
      const retry = computeSpacedGroundMovement({ pos, target: waypoint, spacing: { x: 0, z: 0 }, arrivalRadius: .25,
        speed: 5.2 * resolveDirectionalSpeedMultiplier(settings, 'forward', true), dt });
      movement = { ...retry, heading: retry.heading ?? movement.heading };
    }
    if (!open()) movement = { ...movement, velocity: { x: 0, z: 0 } };
  }
  return { kind: 'move', ...movement };
}
