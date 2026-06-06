import * as THREE from 'three';
import { type Combatant } from '../../types';

export function recoverAirborneCombatantForFrame({
  self,
  pos,
  vel,
  dt,
  gravityAcceleration,
  recoverCombatantAltitude,
  constrainCombatantToArena,
}: {
  self: Combatant;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dt: number;
  gravityAcceleration: number;
  recoverCombatantAltitude: (self: Combatant, pos: THREE.Vector3, vel: THREE.Vector3) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
}): boolean {
  if (!self.isJumping && pos.y <= 0.01 && Math.abs(vel.y) <= 0.01) {
    return false;
  }

  vel.y -= gravityAcceleration * dt;
  pos.addScaledVector(vel, dt);
  recoverCombatantAltitude(self, pos, vel);
  if (pos.y <= 0) {
    pos.y = 0;
    vel.set(0, 0, 0);
    self.isJumping = false;
  }
  const airDamping = Math.max(0, 1 - 5 * dt);
  vel.x *= airDamping;
  vel.z *= airDamping;
  constrainCombatantToArena(pos, vel);

  return true;
}

export type PreGroundMovementRecoveryMode = 'continue' | 'sync_return';

export function resolvePreGroundMovementRecoveryForCombatant({
  self,
  pos,
  vel,
  dt,
  movementComplexity,
  swayTimer,
  toTarget,
  recoverCombatantAltitude,
  constrainCombatantToArena,
}: {
  self: Combatant;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dt: number;
  movementComplexity: number;
  swayTimer: number;
  toTarget: THREE.Vector3;
  recoverCombatantAltitude: (self: Combatant, pos: THREE.Vector3, vel: THREE.Vector3) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
}): PreGroundMovementRecoveryMode {
  const isAirborneBeforeGroundMovement = self.isJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01;

  if (isAirborneBeforeGroundMovement) {
    const airDamping = Math.max(0, 1 - 5 * dt);
    vel.x *= airDamping;
    vel.z *= airDamping;
    recoverCombatantAltitude(self, pos, vel);
    constrainCombatantToArena(pos, vel);
    return 'sync_return';
  }

  pos.y = 0;
  vel.y = 0;
  self.isJumping = false;
  self.aiHammerJumpsInAir = 0;

  if (vel.y > 0) {
    if (movementComplexity >= 45) {
      const lookHeading = toTarget.clone().normalize();
      const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
      const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
      vel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
      vel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
    }
    return 'sync_return';
  }

  return 'continue';
}
