import * as THREE from 'three';
import { type AIBehaviorState, type Combatant } from '../../types';

type AICombatantLike = any;

export function syncAICombatantPoseAndState({
  self,
  mesh,
  pos,
  vel,
  yaw,
  aiState,
  timer,
  activeWeapon,
  swayTimer,
}: {
  self: AICombatantLike;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  activeWeapon?: Combatant['activeWeapon'];
  swayTimer?: number;
}): void {
  self.yaw = yaw;
  self.aiState = aiState;
  self.aiTimer = timer;
  if (activeWeapon !== undefined) {
    self.activeWeapon = activeWeapon;
  }
  if (swayTimer !== undefined) {
    self.aiSwayTimer = swayTimer;
  }
  self.pos.copy(pos);
  self.vel.copy(vel);
  mesh.rotation.y = yaw;
  mesh.position.copy(pos);
}

export function syncAICombatantFrameToState({
  self,
  mesh,
  pos,
  vel,
  yaw,
  aiState,
  timer,
  swayTimer,
  dashCooldownTimer,
  dashRemaining,
  dashDir,
  slideActive,
  slideDistanceTraveled,
  slideCooldownTimer,
  isSprinting,
  hammerJumpCooldownTimer,
  pendingPostEvasionCharge,
  coordCommitTimer,
}: {
  self: AICombatantLike;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  swayTimer: number | undefined;
  dashCooldownTimer: number | undefined;
  dashRemaining: number | undefined;
  dashDir: THREE.Vector3;
  slideActive: boolean;
  slideDistanceTraveled: number;
  slideCooldownTimer: number;
  isSprinting: boolean;
  hammerJumpCooldownTimer: number | undefined;
  pendingPostEvasionCharge: boolean;
  coordCommitTimer: number;
}): void {
  syncAICombatantPoseAndState({
    self,
    mesh,
    pos,
    vel,
    yaw,
    aiState,
    timer,
    swayTimer,
  });
  self.aiDashCooldownTimer = dashCooldownTimer;
  self.aiDashRemaining = dashRemaining;
  self.aiDashDir = { x: dashDir.x, y: dashDir.y, z: dashDir.z };
  self.aiSlideActive = slideActive;
  self.aiSlideDistanceTraveled = slideDistanceTraveled;
  self.aiSlideCooldownTimer = slideCooldownTimer;
  self.aiIsSprinting = isSprinting;
  self.aiHammerJumpCooldownTimer = hammerJumpCooldownTimer;
  self.aiPendingPostEvasionCharge = pendingPostEvasionCharge;
  self.aiCoordCommitTimer = coordCommitTimer;
  mesh.scale.set(1, self.isCrouching ? 0.65 : 1, 1);
}
