import * as THREE from 'three';
import {
  getGrifballEscortTarget,
  getGrifballRunnerSteering,
  getGrifballSpacingOffset,
} from '../../game/aiGrifballRoles';
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
  speed,
  dt,
}: {
  frame: GrifballAIObjectiveFrame;
  targetX: number;
  targetZ: number;
  spacing: { x: number; z: number };
  speed: number;
  dt: number;
}): void => {
  const toTarget = new THREE.Vector3(targetX - frame.pos.x, 0, targetZ - frame.pos.z);
  const distance = toTarget.length();

  let steerX = toTarget.x;
  let steerZ = toTarget.z;
  if (distance > 0.01) {
    steerX = steerX / distance + spacing.x;
    steerZ = steerZ / distance + spacing.z;
  }

  const steerLen = Math.hypot(steerX, steerZ) || 1;
  applyGroundDirection(frame, steerX / steerLen, steerZ / steerLen, speed, dt);
};

const settleAsApproaching = (
  frame: GrifballAIObjectiveFrame,
  resetMobility: boolean
): void => {
  frame.pos.y = 0;
  frame.aiState = 'APPROACHING';
  frame.timer = 0;
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

  const ball = state.grifball.ball;
  const heldByMe = ball.state === 'held' && ball.holderId === botId;
  const heldByAnyone = ball.state === 'held' && !!ball.holderId;

  if (heldByMe) {
    const goalPos = getEnemyGoalPos(self.team);
    if (!goalPos) return false;

    let closestEnemy: { pos: THREE.Vector3 } | null = null;
    let closestDist = Infinity;

    if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode && state.localPlayerTeam !== self.team) {
      const dist = frame.pos.distanceTo(state.playerPos);
      if (dist < closestDist) {
        closestEnemy = { pos: state.playerPos };
        closestDist = dist;
      }
    }
    state.otherPlayers.forEach((other) => {
      if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && other.team !== self.team) {
        const dist = frame.pos.distanceTo(other.pos);
        if (dist < closestDist) {
          closestEnemy = { pos: other.pos };
          closestDist = dist;
        }
      }
    });

    if (closestEnemy && closestDist <= 2.2 && canStartWeaponAction && frame.weaponState === 'ready') {
      const toEnemy = closestEnemy.pos.clone().sub(frame.pos);
      frame.yaw = getYawForHeading(toEnemy.x, toEnemy.z);
      frame.aiState = 'COOLDOWN';
      frame.timer = resolvePunchCooldown(state.settings);
      triggerCombatantAttack(self, 'hammer');
      frame.weaponState = 'swing_up';
      return true;
    }

    const steer = getGrifballRunnerSteering(
      { x: frame.pos.x, z: frame.pos.z },
      { x: goalPos.x, z: goalPos.z },
      enemiesList,
      8.0
    );

    applyGroundDirection(frame, steer.x, steer.z, 5.8 * resolveDirectionalSpeedMultiplier(state.settings, 'forward', true), dt);
    settleAsApproaching(frame, true);
    self.isLunging = false;
    constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }

  if (!heldByAnyone) {
    frame.pickupRequested = true;
    const spacing = getGrifballSpacingOffset(
      { x: frame.pos.x, z: frame.pos.z },
      alliesList,
      state.settings.grifballEscortSpacing ?? 4.0
    );
    applySpacedGroundMove({
      frame,
      targetX: ball.pos.x,
      targetZ: ball.pos.z,
      spacing,
      speed: 5.2 * (state.settings.speedForward / 100),
      dt,
    });

    settleAsApproaching(frame, true);
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

  let closestEnemyDist = Infinity;
  if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode && state.localPlayerTeam !== self.team) {
    closestEnemyDist = frame.pos.distanceTo(state.playerPos);
  }
  state.otherPlayers.forEach((other) => {
    if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && other.team !== self.team) {
      const dist = frame.pos.distanceTo(other.pos);
      if (dist < closestEnemyDist) {
        closestEnemyDist = dist;
      }
    }
  });

  if (closestEnemyDist <= 6.0) return false;

  const carrierTeam = getCombatantTeam(ball.holderId);
  const carrierRef = getCombatantRef(ball.holderId);

  if (carrierTeam && carrierTeam !== self.team && carrierRef) {
    const spacing = getGrifballSpacingOffset(
      { x: frame.pos.x, z: frame.pos.z },
      alliesList,
      state.settings.grifballEscortSpacing ?? 4.0
    );
    applySpacedGroundMove({
      frame,
      targetX: carrierRef.pos.x,
      targetZ: carrierRef.pos.z,
      spacing,
      speed: 4.8 * (state.settings.speedForward / 100),
      dt,
    });
  } else if (carrierRef) {
    let escortIndex = 0;
    const escortIds = Array.from(state.otherPlayers.values())
      .filter((other: any) => other.id !== botId && other.team === self.team && other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && ball.holderId !== other.id)
      .map((other: any) => other.id);
    if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && state.localPlayerTeam === self.team && ball.holderId !== 'player') {
      escortIds.push('player');
    }
    escortIds.sort();
    const myIdx = escortIds.indexOf(botId);
    if (myIdx >= 0) escortIndex = myIdx;

    const goalPos = getEnemyGoalPos(self.team);
    if (goalPos) {
      const escortTarget = getGrifballEscortTarget(
        { x: carrierRef.pos.x, y: carrierRef.pos.y, z: carrierRef.pos.z },
        { x: goalPos.x, y: 0, z: goalPos.z },
        escortIndex
      );
      const spacing = getGrifballSpacingOffset(
        { x: frame.pos.x, z: frame.pos.z },
        alliesList,
        state.settings.grifballEscortSpacing ?? 4.0
      );
      applySpacedGroundMove({
        frame,
        targetX: escortTarget.x,
        targetZ: escortTarget.z,
        spacing,
        speed: 4.8 * (state.settings.speedForward / 100),
        dt,
      });
    }
  }

  settleAsApproaching(frame, false);
  constrainCombatantToArena(frame.pos, frame.vel);
  return true;
}
