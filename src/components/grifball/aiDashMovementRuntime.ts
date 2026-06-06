import * as THREE from 'three';
import { shouldCommitChargeAfterEvasion } from '../../game/aiSpatialStrategy';
import { type AIBehaviorState, type Combatant } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export interface AIDashMovementFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dashDir: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  dashRemaining: number;
  slideActive: boolean;
  slideCooldownTimer: number;
  pendingPostEvasionCharge: boolean;
  isSprinting: boolean;
}

export function resolveAIDashMovementForCombatant({
  state,
  refs,
  frame,
  dt,
  activeWeapon,
  targetWeaponState,
  attackDistanceToTarget,
  resolvedAiReach,
  targetProtected,
  spatialIQ,
  weaponReady,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  frame: AIDashMovementFrame;
  dt: number;
  activeWeapon: Combatant['activeWeapon'];
  targetWeaponState: string;
  attackDistanceToTarget: number;
  resolvedAiReach: number;
  targetProtected: boolean;
  spatialIQ: number;
  weaponReady: boolean;
}): void {
  if (frame.slideActive) {
    frame.slideActive = false;
    frame.slideCooldownTimer = state.settings.slideCooldown ?? 1.5;
  }
  frame.isSprinting = false;
  frame.dashRemaining = Math.max(0, frame.dashRemaining - dt);
  const speed = state.settings.dashDistance / (state.settings.dashDuration || 0.25);
  frame.vel.copy(frame.dashDir).multiplyScalar(speed);
  frame.pos.addScaledVector(frame.vel, dt);

  if (frame.dashRemaining <= 0 && frame.pendingPostEvasionCharge) {
    if (
      shouldCommitChargeAfterEvasion({
        targetWeaponState,
        attackDistanceToTarget,
        resolvedAiReach,
        targetProtected,
        spatialIQ,
        weaponReady,
      })
    ) {
      frame.aiState = 'CHARGE_ATTACK';
    }
    frame.pendingPostEvasionCharge = false;
  }

  if (Math.random() <= 0.15) {
    return;
  }

  const scene = refs.scene;
  if (!scene) {
    return;
  }

  const trailPos = frame.pos.clone();
  trailPos.y += 0.5;
  const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(activeWeapon === 'hammer' ? '#f97316' : '#ef4444'),
    transparent: true,
    opacity: 0.75,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(trailPos);
  scene.add(mesh);
  refs.damageExplosionParticles.push({
    mesh,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
    life: 0.0,
    maxLife: 0.25 + Math.random() * 0.15,
  });
}
