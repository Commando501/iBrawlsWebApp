import * as THREE from 'three';
import {
  getCombatBodyCenter,
  HAMMER_STRIKE_FORWARD_FACTOR,
  SWORD_SLASH_FORWARD_FACTOR,
  SWORD_SLASH_RADIUS,
} from './combatGeometry';

export function resolveAICombatRangeFrame({
  botPos,
  botVel,
  botIsCrouching,
  botIsJumping,
  targetIsCrouching,
  targetHp,
  targetProtected,
  predictedTargetPos,
  distanceToTarget,
  activeWeapon,
  attackRange,
  attackRadius,
  resolvedAiReach,
}: {
  botPos: THREE.Vector3;
  botVel: THREE.Vector3;
  botIsCrouching: boolean;
  botIsJumping: boolean;
  targetIsCrouching: boolean;
  targetHp: number;
  targetProtected: boolean;
  predictedTargetPos: THREE.Vector3;
  distanceToTarget: number;
  activeWeapon: 'hammer' | 'sword';
  attackRange: number;
  attackRadius: number;
  resolvedAiReach: number;
}): {
  combatDistanceToTarget: number;
  verticalDeltaToTarget: number;
  attackDistanceToTarget: number;
  guaranteedKillRange: number;
  enemyInKillRange: boolean;
  selfGrounded: boolean;
  stationarySwingReach: number;
} {
  // Keep stationary swing commits tied to the actual weapon damage volume.
  const botBodyCenter = getCombatBodyCenter(botPos, botIsCrouching);
  const targetBodyCenter = getCombatBodyCenter(predictedTargetPos, targetIsCrouching);
  const combatDistanceToTarget = botBodyCenter.distanceTo(targetBodyCenter);
  const verticalDeltaToTarget = targetBodyCenter.y - botBodyCenter.y;
  const verticalThreat = Math.abs(verticalDeltaToTarget) > 1.1;
  const attackDistanceToTarget = verticalThreat ? combatDistanceToTarget : distanceToTarget;

  const weaponForwardReach =
    (attackRange ?? 3.2) *
    (activeWeapon === 'hammer' ? HAMMER_STRIKE_FORWARD_FACTOR : SWORD_SLASH_FORWARD_FACTOR);
  const weaponStrikeRadius = activeWeapon === 'hammer' ? (attackRadius ?? 4.5) : SWORD_SLASH_RADIUS;
  const guaranteedKillRange = weaponForwardReach + weaponStrikeRadius * 0.8;
  const enemyInKillRange =
    targetHp > 0 && !targetProtected && attackDistanceToTarget <= guaranteedKillRange;
  const selfGrounded = botPos.y <= 0.05 && !botIsJumping && Math.abs(botVel.y) <= 0.01;

  const stationarySwingReach =
    activeWeapon === 'hammer' ? resolvedAiReach : Math.min(resolvedAiReach, guaranteedKillRange);

  return {
    combatDistanceToTarget,
    verticalDeltaToTarget,
    attackDistanceToTarget,
    guaranteedKillRange,
    enemyInKillRange,
    selfGrounded,
    stationarySwingReach,
  };
}
