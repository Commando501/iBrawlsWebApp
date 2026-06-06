import * as THREE from 'three';
import { type AIBehaviorState, type Combatant } from '../../types';

export interface AIEngagementFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  dashCooldownTimer: number | undefined;
  slideCooldownTimer: number;
  hammerJumpCooldownTimer: number | undefined;
}

export function normalizeTargetEngagementFrameState(frame: AIEngagementFrame): void {
  if (frame.aiState !== 'SPAWN_GUARDING') {
    return;
  }
  frame.aiState = 'APPROACHING';
  frame.timer = 0;
}

export function integrateTargetEngagementGravityForCombatant({
  self,
  frame,
  dt,
  gravityAcceleration,
  recoverCombatantAltitude,
  constrainCombatantToArena,
}: {
  self: Combatant;
  frame: AIEngagementFrame;
  dt: number;
  gravityAcceleration: number;
  recoverCombatantAltitude: (self: Combatant, pos: THREE.Vector3, vel: THREE.Vector3) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
}): void {
  if (frame.vel.y !== 0 || frame.pos.y > 0) {
    frame.vel.y -= gravityAcceleration * dt;
    frame.pos.y += frame.vel.y * dt;

    frame.pos.x += frame.vel.x * dt;
    frame.pos.z += frame.vel.z * dt;
    recoverCombatantAltitude(self, frame.pos, frame.vel);

    if (frame.pos.y <= 0) {
      frame.pos.y = 0;
      frame.vel.set(0, 0, 0);
      self.isJumping = false;
    }
  } else {
    frame.pos.y = 0;
    frame.vel.y = 0;
    self.isJumping = false;
  }
  constrainCombatantToArena(frame.pos, frame.vel);
}

export function resolveCombatantCrouchPose({
  aiState,
  swayTimer,
  slideActive,
  movementComplexity,
}: {
  aiState: AIBehaviorState | undefined;
  swayTimer: number | undefined;
  slideActive: boolean;
  movementComplexity: number;
}): boolean {
  const isTacticalState = aiState === 'SIDE_STEPPING' || aiState === 'COOLDOWN';
  const crouchCycle = ((swayTimer ?? 0) % 4.0) < 1.5;
  return slideActive || (isTacticalState && crouchCycle && movementComplexity > 30);
}

export function tickAIEngagementCooldowns({
  frame,
  self,
  botId,
  mainAIId,
  dt,
}: {
  frame: AIEngagementFrame;
  self: Combatant;
  botId: string;
  mainAIId: string;
  dt: number;
}): void {
  if ((frame.dashCooldownTimer ?? 0) > 0) {
    frame.dashCooldownTimer = Math.max(0, (frame.dashCooldownTimer ?? 0) - dt);
  }
  if (frame.slideCooldownTimer > 0) {
    frame.slideCooldownTimer = Math.max(0, frame.slideCooldownTimer - dt);
  }
  if (botId !== mainAIId && (self.swapLockoutTimer ?? 0) > 0) {
    self.swapLockoutTimer = Math.max(0, (self.swapLockoutTimer ?? 0) - dt);
  }
  if (botId !== mainAIId && (self.swapCooldownTimer ?? 0) > 0) {
    self.swapCooldownTimer = Math.max(0, (self.swapCooldownTimer ?? 0) - dt);
  }
  if ((frame.hammerJumpCooldownTimer ?? 0) > 0) {
    frame.hammerJumpCooldownTimer = Math.max(0, (frame.hammerJumpCooldownTimer ?? 0) - dt);
  }
}
