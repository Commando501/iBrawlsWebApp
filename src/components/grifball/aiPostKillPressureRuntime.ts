import * as THREE from 'three';
import {
  getPostKillApproachSpeed,
  getPostKillHoldDistance,
  shouldTelegraphSwordAtSpawn,
  type PostKillPressure,
} from '../../game/aiPsychologicalPressure';
import { getSpawnGuardAimAngle } from '../../game/aiSpatialStrategy';
import { type AIBehaviorState, type Combatant } from '../../types';
import { recoverAirborneCombatantForFrame } from './aiAirborneRecoveryRuntime';
import { type GrifballRuntimeState } from './runtimeState';

export interface AIPostKillPressureFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIBehaviorState | undefined;
  timer: number;
  swayTimer: number;
  activeWeapon: Combatant['activeWeapon'];
}

export type AIPostKillPressureMode = 'airborne' | 'grounded';

export function resolvePostKillPressureForCombatant({
  state,
  self,
  frame,
  pressure,
  spatialIQ,
  effectivePressureAggression,
  swordForbidden,
  dt,
  gravityAcceleration,
  recoverCombatantAltitude,
  constrainCombatantToArena,
  swapCombatantWeapon,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  frame: AIPostKillPressureFrame;
  pressure: PostKillPressure;
  spatialIQ: number;
  effectivePressureAggression: number;
  swordForbidden: boolean;
  dt: number;
  gravityAcceleration: number;
  recoverCombatantAltitude: (self: Combatant, pos: THREE.Vector3, vel: THREE.Vector3) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
  swapCombatantWeapon: (self: Combatant, weapon: 'sword') => void;
}): AIPostKillPressureMode {
  if (recoverAirborneCombatantForFrame({
    self,
    pos: frame.pos,
    vel: frame.vel,
    dt,
    gravityAcceleration,
    recoverCombatantAltitude,
    constrainCombatantToArena,
  })) {
    frame.aiState = 'SPAWN_GUARDING';
    frame.timer = pressure.timerRemaining;
    frame.swayTimer += dt;
    return 'airborne';
  }

  const spawnPoint = new THREE.Vector3(pressure.spawnX, 0, pressure.spawnZ);
  const toSpawn = spawnPoint.clone().sub(frame.pos);
  toSpawn.y = 0;
  const spawnDist = toSpawn.length();
  const holdDistance = getPostKillHoldDistance();

  frame.swayTimer += dt;

  if (spawnDist > 0.1) {
    frame.yaw = getSpawnGuardAimAngle({
      botX: frame.pos.x,
      botZ: frame.pos.z,
      spawnX: spawnPoint.x,
      spawnZ: spawnPoint.z,
      spatialIQ,
    });
  }

  if (!swordForbidden && shouldTelegraphSwordAtSpawn(pressure.lungeKill, spawnDist)) {
    if (self.activeWeapon !== 'sword') {
      swapCombatantWeapon(self, 'sword');
    }
    frame.activeWeapon = 'sword';
  }

  frame.aiState = 'SPAWN_GUARDING';

  if (spawnDist > holdDistance + 1.2) {
    const moveHeading = toSpawn.clone().normalize();
    const approachSpeed = getPostKillApproachSpeed(pressure.lungeKill, effectivePressureAggression);
    frame.vel.copy(moveHeading).multiplyScalar(approachSpeed * (state.settings.speedForward / 100));
    frame.pos.addScaledVector(frame.vel, dt);
  } else if (spawnDist < holdDistance - 0.8) {
    const moveHeading = toSpawn.clone().normalize();
    frame.vel.copy(moveHeading).multiplyScalar(-2.0 * (state.settings.speedBackward / 100));
    frame.pos.addScaledVector(frame.vel, dt);
  } else {
    const guardHeading = spawnDist > 0.001 ? toSpawn.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const strafeDir = new THREE.Vector3(-guardHeading.z, 0, guardHeading.x);
    const sideSign = Math.sin(frame.swayTimer * 2.4) > 0 ? 1 : -1;
    const strafeSpeed = 3.2 * (state.settings.speedSide / 100);
    const radialCorrection = Math.max(-1, Math.min(1, spawnDist - holdDistance));
    frame.vel.copy(strafeDir).multiplyScalar(strafeSpeed * sideSign);
    frame.vel.addScaledVector(guardHeading, radialCorrection * 1.5 * (state.settings.speedForward / 100));
    frame.pos.addScaledVector(frame.vel, dt);
  }
  constrainCombatantToArena(frame.pos, frame.vel);
  frame.timer = pressure.timerRemaining;

  return 'grounded';
}
