import * as THREE from 'three';
import {
  getGrifballRunnerSteering,
} from '../../game/aiGrifballRoles';
import { computeSpacedGroundMovement, resolveGrifballSupportSteering } from '../../game/aiGrifballObjectiveSteering';
import { selectGrifballAssignmentThreat } from '../../game/aiGrifballTeamPlan';
import { getGrifballSpaceWaypoint } from '../../game/aiGrifballSpace';
import { isSpaceSegmentOpen } from '../../game/grifballSpaceGeometry';
import { resolveDirectionalSpeedMultiplier, resolvePunchCooldown } from '../../game/runnerBallSettings';
import { getYawForHeading } from '../../game/yaw';
import { type AIBehaviorState, type WeaponState } from '../../types';
import { type GrifballAwarenessPoint } from './grifballAITeamAwareness';
import { type GrifballCombatantRef } from './grifballObjectiveRuntime';
import { type GrifballRuntimeState } from './runtimeState';

export interface GrifballAIObjectiveFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIBehaviorState | undefined;
  timer: number;
  dashRemaining: number;
  slideActive: boolean;
  weaponState: WeaponState | string;
  pickupRequested: boolean;
}

type CombatantLike = any;
type GroundConstraint = (pos: THREE.Vector3, vel: THREE.Vector3) => void;

const applyGroundDirection = (
  frame: GrifballAIObjectiveFrame,
  dirX: number,
  dirZ: number,
  speed: number,
  dt: number
): void => {
  frame.yaw = getYawForHeading(dirX, dirZ);
  frame.vel.set(dirX * speed, 0, dirZ * speed);
  frame.pos.x += frame.vel.x * dt;
  frame.pos.z += frame.vel.z * dt;
};

const applySpacedGroundMove = ({
  frame,
  targetX,
  targetZ,
  spacing,
  arrivalRadius,
  speed,
  dt,
}: {
  frame: GrifballAIObjectiveFrame;
  targetX: number;
  targetZ: number;
  spacing: { x: number; z: number };
  arrivalRadius: number;
  speed: number;
  dt: number;
}): void => {
  const movement = computeSpacedGroundMovement({ pos: frame.pos, target: { x: targetX, z: targetZ }, spacing, arrivalRadius, speed, dt });
  if (!movement.heading) {
    frame.vel.x = 0;
    frame.vel.z = 0;
    return;
  }
  frame.vel.set(movement.velocity.x, 0, movement.velocity.z);
  frame.pos.x += frame.vel.x * dt; frame.pos.z += frame.vel.z * dt;
  if (frame.weaponState === 'ready') frame.yaw = getYawForHeading(movement.heading.x, movement.heading.z);
};

const settleAsApproaching = (
  frame: GrifballAIObjectiveFrame,
  resetMobility: boolean,
  dt: number,
): void => {
  frame.pos.y = 0;
  // Objective movement must not erase an attack's reload when returning from combat.
  if (frame.aiState === 'COOLDOWN' && frame.timer > 0) {
    frame.timer = Math.max(0, frame.timer - dt);
  } else {
    frame.aiState = 'APPROACHING';
    frame.timer = 0;
  }
  if (resetMobility) {
    frame.dashRemaining = 0;
    frame.slideActive = false;
  }
};

export function resolvePrimaryGrifballAIObjectiveMovementForCombatant({
  state,
  botId,
  self,
  frame,
  alliesList,
  enemiesList,
  dt,
  canStartWeaponAction,
  triggerCombatantAttack,
  constrainCombatantToArena,
  getEnemyGoalPos,
}: {
  state: GrifballRuntimeState;
  botId: string;
  self: CombatantLike;
  frame: GrifballAIObjectiveFrame;
  alliesList: GrifballAwarenessPoint[];
  enemiesList: GrifballAwarenessPoint[];
  dt: number;
  canStartWeaponAction: boolean;
  triggerCombatantAttack: (self: CombatantLike, weapon: 'hammer' | 'sword', melee?: boolean) => void;
  constrainCombatantToArena: GroundConstraint;
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null;
}): boolean {
  if (state.settings.gameMode !== 'grifball') return false;
  if (state.grifball.phase !== 'playing') return false;
  if (self.isLunging || self.isJumping || frame.pos.y > 0.01 || frame.vel.y !== 0 || frame.dashRemaining > 0 || frame.slideActive) return false;

  const ball = state.grifball.ball;
  const heldByMe = ball.state === 'held' && ball.holderId === botId;
  const heldByAnyone = ball.state === 'held' && !!ball.holderId;
  const assignment = state.aiMatchContext.grifballTeamPlan.assignments.get(botId);
  if (!heldByMe && assignment && assignment.role !== 'runner') {
    const movement = resolveGrifballSupportSteering({ assignment, pos: frame.pos, allies: alliesList,
      players: state.aiMatchContext.grifballTeamPlan.snapshot?.players ?? [], ball: ball.pos, heldByAnyone,
      separation: state.settings.grifballEscortSpacing ?? 4, speed: 5.2 * (state.settings.speedForward / 100), dt });
    if (!movement) return false;
    frame.pickupRequested = movement.pickupRequested;
    frame.vel.set(movement.velocity.x, 0, movement.velocity.z);
    frame.pos.x += frame.vel.x * dt; frame.pos.z += frame.vel.z * dt;
    if (movement.heading && frame.weaponState === 'ready') frame.yaw = getYawForHeading(movement.heading.x, movement.heading.z);
    settleAsApproaching(frame, true, dt);
    self.isLunging = false;
    constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }
  const geometry = assignment?.geometry;
  const space = assignment?.space;
  const waypoint = geometry && space ? getGrifballSpaceWaypoint(geometry, frame.pos, space) : null;
  if (space && !waypoint) {
    if (assignment && selectGrifballAssignmentThreat(assignment, frame.pos, state.aiMatchContext.grifballTeamPlan.snapshot?.players ?? [])) return false;
    frame.vel.x = 0; frame.vel.z = 0;
    frame.pickupRequested = !heldByAnyone && assignment?.role === 'retriever';
    settleAsApproaching(frame, true, dt);
    constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }
  const beforeMove = { x: frame.pos.x, z: frame.pos.z };
  const validateMove = () => {
    if (geometry && !isSpaceSegmentOpen(geometry, beforeMove, frame.pos)) {
      frame.pos.x = beforeMove.x; frame.pos.z = beforeMove.z;
      frame.vel.x = 0; frame.vel.z = 0;
      // Separation/avoidance may steer into a wall. Retry along the verified route.
      if (waypoint) applySpacedGroundMove({ frame, targetX: waypoint.x, targetZ: waypoint.z, spacing: { x: 0, z: 0 }, arrivalRadius: 0.25, speed: 5.2 * resolveDirectionalSpeedMultiplier(state.settings, 'forward', heldByMe), dt });
      if (!isSpaceSegmentOpen(geometry, beforeMove, frame.pos)) { frame.pos.x = beforeMove.x; frame.pos.z = beforeMove.z; frame.vel.x = 0; frame.vel.z = 0; }
    }
  };

  if (heldByMe) {
    const goalPos = getEnemyGoalPos(self.team);
    if (!goalPos) return false;

    // Finish a committed punch before resuming the route. Advancing through the
    // windup carries the runner past a close target before the strike lands.
    if (frame.weaponState === 'swing_up' || frame.weaponState === 'swing_down') {
      frame.vel.x = 0; frame.vel.z = 0;
      settleAsApproaching(frame, true, dt);
      constrainCombatantToArena(frame.pos, frame.vel);
      return true;
    }

    const routeDistance = waypoint ? Math.hypot(waypoint.x - frame.pos.x, waypoint.z - frame.pos.z) : 0;
    const speed = 5.8 * resolveDirectionalSpeedMultiplier(state.settings, 'forward', true);
    // Honor a clear planned finish when reaching the goal center takes less time
    // than winding up a new punch. Committed strikes are handled above.
    const finishBeforePunch = assignment?.runner?.selected.action === 'finish' && geometry && waypoint &&
      waypoint.x === goalPos.x && waypoint.z === goalPos.z &&
      isSpaceSegmentOpen(geometry, frame.pos, goalPos) &&
      routeDistance / speed < (state.settings.hammerMeleeSpeed ?? 0.24);
    const escaping = assignment?.runner && assignment.runner.selected.action !== 'wait' && waypoint && routeDistance > 0.1;
    let closestEnemy: { pos: THREE.Vector3 } | null = null;
    let closestDist = Infinity;
    const considerEnemy = (pos: THREE.Vector3, invulnerabilityTimer = 0) => {
      // Match the combat controller's current-protection rule. Reconsider after
      // expiry instead of stopping the route to commit a punch into a shield.
      if (invulnerabilityTimer > 0) return;
      // Keep the planned escape instead of initiating a stationary duel behind it.
      // Filter before choosing the nearest threat so a pursuer cannot hide a blocker ahead.
      if (escaping && (pos.x - frame.pos.x) * (waypoint.x - frame.pos.x) +
        (pos.z - frame.pos.z) * (waypoint.z - frame.pos.z) < 0) return;
      const dist = frame.pos.distanceTo(pos);
      if (dist < closestDist) { closestEnemy = { pos }; closestDist = dist; }
    };

    if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode && state.localPlayerTeam !== self.team) {
      considerEnemy(state.playerPos, state.playerInvulnerabilityTimer);
    }
    state.otherPlayers.forEach((other) => {
      if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && other.team !== self.team) {
        considerEnemy(other.pos, other.invulnerabilityTimer);
      }
    });

    if (!finishBeforePunch && closestEnemy && closestDist <= 2.2 && canStartWeaponAction && frame.weaponState === 'ready') {
      const toEnemy = closestEnemy.pos.clone().sub(frame.pos);
      frame.vel.x = 0;
      frame.vel.z = 0;
      frame.yaw = getYawForHeading(toEnemy.x, toEnemy.z);
      frame.aiState = 'COOLDOWN';
      frame.timer = resolvePunchCooldown(state.settings);
      triggerCombatantAttack(self, 'hammer');
      frame.weaponState = 'swing_up';
      return true;
    }

    if (assignment?.pass?.selected && canStartWeaponAction && frame.weaponState === 'ready') {
      const direction = assignment.pass.selected.direction;
      frame.vel.x = 0; frame.vel.z = 0;
      frame.yaw = getYawForHeading(direction.x, direction.z);
      settleAsApproaching(frame, true, dt);
      return true;
    }
    if (assignment?.runner?.selected.action === 'wait') {
      frame.vel.x = 0; frame.vel.z = 0;
      settleAsApproaching(frame, true, dt);
      return true;
    }
    // Planned routes already account for pressure; local repulsion must not reverse a cut or finish.
    const steer = assignment?.runner && waypoint
      ? { x: (waypoint.x - frame.pos.x) / Math.max(0.001, routeDistance), z: (waypoint.z - frame.pos.z) / Math.max(0.001, routeDistance) }
      : getGrifballRunnerSteering(
      { x: frame.pos.x, z: frame.pos.z },
      waypoint ?? { x: goalPos.x, z: goalPos.z },
      enemiesList,
      8.0
    );

    const attackYaw = frame.yaw;
    applyGroundDirection(frame, steer.x, steer.z, waypoint ? Math.min(speed, Math.hypot(waypoint.x - frame.pos.x, waypoint.z - frame.pos.z) / Math.max(dt, 0.001)) : speed, dt);
    validateMove();
    // Preserve the attack facing during recovery while resuming the route.
    if (frame.weaponState !== 'ready') frame.yaw = attackYaw;
    settleAsApproaching(frame, true, dt);
    self.isLunging = false;
    constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }

  return false;
}

export function resolveSupportGrifballAIObjectiveMovementForCombatant({
  state,
  botId,
  self,
  frame,
  alliesList,
  dt,
  constrainCombatantToArena,
  getCombatantTeam,
  getCombatantRef,
  getEnemyGoalPos,
}: {
  state: GrifballRuntimeState;
  botId: string;
  self: CombatantLike;
  frame: GrifballAIObjectiveFrame;
  alliesList: GrifballAwarenessPoint[];
  dt: number;
  constrainCombatantToArena: GroundConstraint;
  getCombatantTeam: (id: string) => string | undefined;
  getCombatantRef: (id: string) => GrifballCombatantRef | null;
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null;
}): boolean {
  if (state.settings.gameMode !== 'grifball') return false;

  const ball = state.grifball.ball;
  if (ball.state !== 'held' || !ball.holderId || ball.holderId === botId) return false;

  return resolvePrimaryGrifballAIObjectiveMovementForCombatant({
    state, botId, self, frame, alliesList, enemiesList: [], dt,
    canStartWeaponAction: false,
    triggerCombatantAttack: () => {},
    constrainCombatantToArena, getEnemyGoalPos,
  });
}
