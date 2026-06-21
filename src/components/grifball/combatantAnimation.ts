import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { UniversalSettings } from '../../types';
import {
  applyWeaponPose,
  getThirdPersonCombatantArmPose,
  getHammerAttackAnimationStyle,
  getSwordAttackAnimationStyle,
  getThirdPersonHammerPose,
  getThirdPersonSwordLungePose,
  getThirdPersonSwordSlashPose,
  toThirdPersonHandPose,
  type CombatantArmPose,
  type WeaponPose,
} from './attackAnimationPresets';
import { animateV3CombatantModel, animateV3WeaponMeshes } from './combatantAnimationV3';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { type GrifballThreeRefs } from './threeRefs';
import { isV1CombatantModelSystem } from './grifballBallCarryVisuals';

const spawnFrictionSparkParticle = (refs: GrifballThreeRefs, pos: THREE.Vector3): void => {
  const scene = refs.scene;
  if (!scene) return;

  const voxelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'),
  });
  const cube = new THREE.Mesh(voxelGeo, mat);
  cube.position.copy(pos);
  cube.position.y += 0.05;
  cube.position.x += (Math.random() - 0.5) * 0.4;
  cube.position.z += (Math.random() - 0.5) * 0.4;

  scene.add(cube);
  refs.damageExplosionParticles.push({
    mesh: cube,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 2 + 1,
      (Math.random() - 0.5) * 2
    ),
    life: 0,
    maxLife: 0.4,
  });
};

const spawnSprintDustParticle = (refs: GrifballThreeRefs, pos: THREE.Vector3): void => {
  const scene = refs.scene;
  if (!scene) return;

  const voxelGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#e2e8f0'),
    transparent: true,
    opacity: 0.6,
  });
  const cube = new THREE.Mesh(voxelGeo, mat);
  cube.position.copy(pos);
  cube.position.y += 0.05;

  scene.add(cube);
  refs.damageExplosionParticles.push({
    mesh: cube,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 1,
      Math.random() * 0.5 + 0.2,
      (Math.random() - 0.5) * 1
    ),
    life: 0,
    maxLife: 0.5,
  });
};

const applyThirdPersonWeaponPose = (group: THREE.Group, pose: WeaponPose): void => {
  applyWeaponPose(group, toThirdPersonHandPose(pose));
};

const lerpArmRotation = (
  arm: THREE.Group,
  target: [number, number, number],
  alpha: number
): void => {
  arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, target[0], alpha);
  arm.rotation.y = THREE.MathUtils.lerp(arm.rotation.y, target[1], alpha);
  arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, target[2], alpha);
};

const getV2VoxelScale = (mesh: THREE.Group): number => {
  const scale = mesh.userData.characterModelProfile?.voxelScale;
  return typeof scale === 'number' && Number.isFinite(scale) ? scale : 0.045;
};

const getV2PelvisRestY = (pelvis: THREE.Group, scale: number): number => {
  return pelvis.userData.articulationController instanceof THREE.Group ? 0 : 10 * scale;
};

export const applyCombatantArmPose = (
  mesh: THREE.Group | null | undefined,
  pose: CombatantArmPose,
  dt: number
): void => {
  if (!mesh) return;
  const rightArm = mesh.userData.rightArm as THREE.Group | undefined;
  const leftArm = mesh.userData.leftArm as THREE.Group | undefined;
  if (!rightArm || !leftArm) return;

  const alpha = dt > 0 ? Math.min(1, dt * 18) : 1;
  lerpArmRotation(rightArm, pose.rightArmRotation, alpha);
  lerpArmRotation(leftArm, pose.leftArmRotation, alpha);
};

export function animateSpartanCombatantModelV2({
  refs,
  mesh,
  vel,
  yaw,
  hp,
  weaponState,
  weaponTimer,
  dt,
  isSliding = false,
  isSprinting = false,
  hammerReloadTime = 0.6,
  hammerMeleeReload = 0.5,
  hammerSlamWindupTime = DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  hammerSlamAttackTime = DEFAULT_HAMMER_SLAM_ATTACK_TIME,
}: {
  refs: GrifballThreeRefs;
  mesh: THREE.Group | null;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  weaponState: string;
  weaponTimer: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  hammerReloadTime?: number;
  hammerMeleeReload?: number;
  hammerSlamWindupTime?: number;
  hammerSlamAttackTime?: number;
}): void {
  if (!mesh) return;

  const pelvis = mesh.userData.pelvis as THREE.Group | undefined;
  const stomach = mesh.userData.stomach as THREE.Group | undefined;
  const chest = mesh.userData.chest as THREE.Group | undefined;
  const neck = mesh.userData.neck as THREE.Group | undefined;
  const head = mesh.userData.head as THREE.Group | undefined;

  const shoulder_l = mesh.userData.shoulder_l as THREE.Group | undefined;
  const arm_upper_l = mesh.userData.arm_upper_l as THREE.Group | undefined;
  const arm_lower_l = mesh.userData.arm_lower_l as THREE.Group | undefined;
  const hand_l = mesh.userData.hand_l as THREE.Group | undefined;

  const shoulder_r = mesh.userData.shoulder_r as THREE.Group | undefined;
  const arm_upper_r = mesh.userData.arm_upper_r as THREE.Group | undefined;
  const arm_lower_r = mesh.userData.arm_lower_r as THREE.Group | undefined;
  const hand_r = mesh.userData.hand_r as THREE.Group | undefined;

  const leg_upper_l = mesh.userData.leg_upper_l as THREE.Group | undefined;
  const leg_lower_l = mesh.userData.leg_lower_l as THREE.Group | undefined;
  const foot_l = mesh.userData.foot_l as THREE.Group | undefined;
  const toes_l = mesh.userData.toes_l as THREE.Group | undefined;

  const leg_upper_r = mesh.userData.leg_upper_r as THREE.Group | undefined;
  const leg_lower_r = mesh.userData.leg_lower_r as THREE.Group | undefined;
  const foot_r = mesh.userData.foot_r as THREE.Group | undefined;
  const toes_r = mesh.userData.toes_r as THREE.Group | undefined;

  if (!pelvis || !stomach || !chest || !neck || !head || 
      !shoulder_l || !arm_upper_l || !arm_lower_l || !hand_l ||
      !shoulder_r || !arm_upper_r || !arm_lower_r || !hand_r ||
      !leg_upper_l || !leg_lower_l || !foot_l || !toes_l ||
      !leg_upper_r || !leg_lower_r || !foot_r || !toes_r) {
    return;
  }

  const lerp = THREE.MathUtils.lerp;
  const scale = getV2VoxelScale(mesh);
  const pelvisRestY = getV2PelvisRestY(pelvis, scale);
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  if (hp <= 0) {
    // Reset poses on death
    pelvis.position.y = lerp(pelvis.position.y, pelvisRestY, dt * 10.0);
    pelvis.rotation.set(0, 0, 0);
    stomach.rotation.set(0, 0, 0);
    chest.rotation.set(0, 0, 0);
    neck.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    shoulder_l.rotation.set(0, 0, 0);
    arm_upper_l.rotation.set(0, 0, 0);
    arm_lower_l.rotation.set(0, 0, 0);
    hand_l.rotation.set(0, 0, 0);
    shoulder_r.rotation.set(0, 0, 0);
    arm_upper_r.rotation.set(0, 0, 0);
    arm_lower_r.rotation.set(0, 0, 0);
    hand_r.rotation.set(0, 0, 0);
    leg_upper_l.rotation.set(0, 0, 0);
    leg_lower_l.rotation.set(0, 0, 0);
    foot_l.rotation.set(0, 0, 0);
    toes_l.rotation.set(0, 0, 0);
    leg_upper_r.rotation.set(0, 0, 0);
    leg_lower_r.rotation.set(0, 0, 0);
    foot_r.rotation.set(0, 0, 0);
    toes_r.rotation.set(0, 0, 0);
    return;
  }

  // Pelvis Yawing (aim-movement twist)
  let targetPelvisYaw = 0;
  if (speed > 0.15) {
    const moveYaw = getYawForHeading(vel.x, vel.z);
    let diff = moveYaw - yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTwist = Math.PI / 3;
    targetPelvisYaw = Math.abs(diff) > maxTwist ? Math.sign(diff) * maxTwist : diff;
  }
  pelvis.rotation.y = lerp(pelvis.rotation.y, targetPelvisYaw, dt * 9.0);

  // Stomach & Chest Counter-rotation
  stomach.rotation.y = lerp(stomach.rotation.y, -pelvis.rotation.y * 0.4, dt * 10.0);
  chest.rotation.y = lerp(chest.rotation.y, -pelvis.rotation.y * 0.6, dt * 10.0);

  // Setup/Advance Walk Phase
  if (mesh.userData.walkPhase === undefined) {
    mesh.userData.walkPhase = 0;
  }

  if (isSliding) {
    // Sliding Posture
    pelvis.position.y = lerp(pelvis.position.y, pelvisRestY - 4.5 * scale, dt * 10.0);
    pelvis.rotation.x = lerp(pelvis.rotation.x, -0.28, dt * 10.0);
    stomach.rotation.x = lerp(stomach.rotation.x, 0.12, dt * 10.0);
    chest.rotation.x = lerp(chest.rotation.x, 0.1, dt * 10.0);

    // Left leg folded
    leg_upper_l.rotation.x = lerp(leg_upper_l.rotation.x, -1.3, dt * 10.0);
    leg_lower_l.rotation.x = lerp(leg_lower_l.rotation.x, 1.4, dt * 10.0);
    foot_l.rotation.x = lerp(foot_l.rotation.x, -0.2, dt * 10.0);
    toes_l.rotation.x = lerp(toes_l.rotation.x, 0.1, dt * 10.0);

    // Right leg extended
    leg_upper_r.rotation.x = lerp(leg_upper_r.rotation.x, -0.3, dt * 10.0);
    leg_lower_r.rotation.x = lerp(leg_lower_r.rotation.x, 0.2, dt * 10.0);
    foot_r.rotation.x = lerp(foot_r.rotation.x, 0.1, dt * 10.0);
    toes_r.rotation.x = lerp(toes_r.rotation.x, 0.0, dt * 10.0);

    // Arms out for balance
    shoulder_l.rotation.z = lerp(shoulder_l.rotation.z, -0.6, dt * 10.0);
    shoulder_r.rotation.z = lerp(shoulder_r.rotation.z, 0.6, dt * 10.0);
    shoulder_l.rotation.x = lerp(shoulder_l.rotation.x, -0.2, dt * 10.0);
    shoulder_r.rotation.x = lerp(shoulder_r.rotation.x, -0.2, dt * 10.0);
    arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -0.4, dt * 10.0);
    arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -0.4, dt * 10.0);

    if (Math.random() < 0.28) {
      spawnFrictionSparkParticle(refs, mesh.position);
    }
  } else if (isSprinting && speed > 0.15) {
    // Sprint posture
    stomach.rotation.x = lerp(stomach.rotation.x, 0.28, dt * 10.0);
    chest.rotation.x = lerp(chest.rotation.x, 0.18, dt * 10.0);
    pelvis.rotation.x = lerp(pelvis.rotation.x, 0.1, dt * 10.0);

    const frequency = 8.5 * (speed / 5.8);
    mesh.userData.walkPhase += dt * frequency * Math.PI * 2;
    const phase = mesh.userData.walkPhase;

    // Legs gait swing
    leg_upper_l.rotation.x = Math.sin(phase) * 0.75;
    leg_upper_r.rotation.x = -Math.sin(phase) * 0.75;

    // Knees bend
    leg_lower_l.rotation.x = Math.sin(phase) < 0 ? -Math.sin(phase) * 0.9 : 0.05;
    leg_lower_r.rotation.x = -Math.sin(phase) < 0 ? Math.sin(phase) * 0.9 : 0.05;

    // Ankle flex
    foot_l.rotation.x = Math.sin(phase) > 0 ? Math.sin(phase) * 0.35 + 0.1 : -Math.sin(phase) * 0.1;
    foot_r.rotation.x = -Math.sin(phase) > 0 ? -Math.sin(phase) * 0.35 + 0.1 : Math.sin(phase) * 0.1;

    // Toes flex
    toes_l.rotation.x = Math.sin(phase) < 0 ? -Math.sin(phase) * 0.45 : 0.0;
    toes_r.rotation.x = -Math.sin(phase) < 0 ? Math.sin(phase) * 0.45 : 0.0;

    // Hips bob and roll
    pelvis.position.y = pelvisRestY - Math.abs(Math.sin(phase)) * 0.6 * scale;
    pelvis.rotation.z = Math.sin(phase) * 0.08;

    // Arm swing overlays (only if ready)
    if (weaponState === 'ready') {
      shoulder_l.rotation.x = lerp(shoulder_l.rotation.x, -Math.sin(phase) * 0.75, dt * 18.0);
      shoulder_r.rotation.x = lerp(shoulder_r.rotation.x, Math.sin(phase) * 0.75, dt * 18.0);
      arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -1.2 - Math.cos(phase) * 0.2, dt * 18.0);
      arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -1.2 + Math.cos(phase) * 0.2, dt * 18.0);
    }

    if (Math.random() < 0.18) {
      const footPos = mesh.position.clone();
      footPos.x += (Math.random() - 0.5) * 0.3;
      footPos.z += (Math.random() - 0.5) * 0.3;
      spawnSprintDustParticle(refs, footPos);
    }
  } else if (speed > 0.15) {
    // Normal Run/Walk posture
    stomach.rotation.x = lerp(stomach.rotation.x, 0.12, dt * 10.0);
    chest.rotation.x = lerp(chest.rotation.x, 0.08, dt * 10.0);
    pelvis.rotation.x = lerp(pelvis.rotation.x, 0.05, dt * 10.0);

    const frequency = 5.2 * (speed / 4.0);
    mesh.userData.walkPhase += dt * frequency * Math.PI * 2;
    const phase = mesh.userData.walkPhase;

    // Legs gait swing
    leg_upper_l.rotation.x = Math.sin(phase) * 0.52;
    leg_upper_r.rotation.x = -Math.sin(phase) * 0.52;

    // Knees bend
    leg_lower_l.rotation.x = Math.sin(phase) < 0 ? -Math.sin(phase) * 0.6 : 0.05;
    leg_lower_r.rotation.x = -Math.sin(phase) < 0 ? Math.sin(phase) * 0.6 : 0.05;

    // Ankle flex
    foot_l.rotation.x = Math.sin(phase) > 0 ? Math.sin(phase) * 0.22 + 0.08 : -Math.sin(phase) * 0.05;
    foot_r.rotation.x = -Math.sin(phase) > 0 ? -Math.sin(phase) * 0.22 + 0.08 : Math.sin(phase) * 0.05;

    // Toes flex
    toes_l.rotation.x = Math.sin(phase) < 0 ? -Math.sin(phase) * 0.28 : 0.0;
    toes_r.rotation.x = -Math.sin(phase) < 0 ? Math.sin(phase) * 0.28 : 0.0;

    // Hips bob and roll
    pelvis.position.y = pelvisRestY - Math.abs(Math.sin(phase)) * 0.4 * scale;
    pelvis.rotation.z = Math.sin(phase) * 0.05;

    // Arm swing overlays (only if ready)
    if (weaponState === 'ready') {
      arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -0.6 - Math.cos(phase) * 0.15, dt * 10.0);
      arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -0.6 + Math.cos(phase) * 0.15, dt * 10.0);
    }
  } else {
    // Standing Still
    stomach.rotation.x = lerp(stomach.rotation.x, 0.0, dt * 10.0);
    chest.rotation.x = lerp(chest.rotation.x, 0.0, dt * 10.0);
    pelvis.rotation.x = lerp(pelvis.rotation.x, 0.0, dt * 10.0);
    pelvis.position.y = lerp(pelvis.position.y, pelvisRestY, dt * 10.0);

    leg_upper_l.rotation.x = lerp(leg_upper_l.rotation.x, 0.0, dt * 10.0);
    leg_upper_r.rotation.x = lerp(leg_upper_r.rotation.x, 0.0, dt * 10.0);
    leg_lower_l.rotation.x = lerp(leg_lower_l.rotation.x, 0.05, dt * 10.0);
    leg_lower_r.rotation.x = lerp(leg_lower_r.rotation.x, 0.05, dt * 10.0);
    foot_l.rotation.x = lerp(foot_l.rotation.x, 0.0, dt * 10.0);
    foot_r.rotation.x = lerp(foot_r.rotation.x, 0.0, dt * 10.0);
    toes_l.rotation.x = lerp(toes_l.rotation.x, 0.0, dt * 10.0);
    toes_r.rotation.x = lerp(toes_r.rotation.x, 0.0, dt * 10.0);

    shoulder_l.rotation.z = lerp(shoulder_l.rotation.z, 0.0, dt * 10.0);
    shoulder_r.rotation.z = lerp(shoulder_r.rotation.z, 0.0, dt * 10.0);

    // Idle breathing cycle
    const breathe = Math.sin(Date.now() * 0.002) * 0.02;
    stomach.rotation.x = breathe;
    chest.rotation.x = breathe * 0.5;
    head.rotation.x = Math.sin(Date.now() * 0.001) * 0.015;

    if (weaponState === 'ready') {
      arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -0.2, dt * 10.0);
      arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -0.2, dt * 10.0);
      hand_l.rotation.x = lerp(hand_l.rotation.x, 0.05, dt * 10.0);
      hand_r.rotation.x = lerp(hand_r.rotation.x, 0.05, dt * 10.0);
    }

    mesh.userData.walkPhase = 0;
  }

  // Weapon Attack Joint Overlays
  if (weaponState === 'swing_up') {
    const windup = hammerSlamWindupTime;
    const pct = Math.min(1.0, weaponTimer / windup);
    // Bend elbows for backswing
    arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -1.6, dt * 15.0);
    arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -1.1, dt * 15.0);
    hand_r.rotation.x = lerp(hand_r.rotation.x, 0.4, dt * 15.0);
  } else if (weaponState === 'swing_down') {
    const strike = hammerSlamAttackTime;
    const pct = Math.min(1.0, weaponTimer / strike);
    // Extend elbows for forward strike
    arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -0.1, dt * 25.0);
    arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -0.1, dt * 25.0);
    hand_r.rotation.x = lerp(hand_r.rotation.x, -0.6, dt * 25.0);
  } else if (weaponState === 'recovering') {
    // Smoothly settle back
    arm_lower_r.rotation.x = lerp(arm_lower_r.rotation.x, -0.2, dt * 10.0);
    arm_lower_l.rotation.x = lerp(arm_lower_l.rotation.x, -0.2, dt * 10.0);
    hand_r.rotation.x = lerp(hand_r.rotation.x, 0.0, dt * 10.0);
  }
}

export function animateSpartanCombatantModel({
  refs,
  mesh,
  vel,
  yaw,
  hp,
  activeWeapon = 'hammer',
  weaponState,
  weaponTimer,
  dt,
  isSliding = false,
  isSprinting = false,
  isLunging = false,
  hammerReloadTime = 0.6,
  hammerMeleeReload = 0.5,
  hammerSlamWindupTime = DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  hammerSlamAttackTime = DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  settings = {},
  v3QualityTier,
  isLocalV3Animation = false,
  animationClockMs,
  lookPitch,
}: {
  refs: GrifballThreeRefs;
  mesh: THREE.Group | null;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  activeWeapon?: string;
  weaponState: string;
  weaponTimer: number;
  dt: number;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
  hammerReloadTime?: number;
  hammerMeleeReload?: number;
  hammerSlamWindupTime?: number;
  hammerSlamAttackTime?: number;
  settings?: Partial<UniversalSettings>;
  v3QualityTier?: V3QualityTier;
  isLocalV3Animation?: boolean;
  animationClockMs?: number;
  lookPitch?: number;
}): boolean {
  if (!mesh) return false;

  if (mesh.userData.modelSystem === 'v3') {
    return animateV3CombatantModel({
      refs,
      mesh,
      vel,
      yaw,
      hp,
      activeWeapon,
      weaponState,
      weaponTimer,
      dt,
      isSliding,
      isSprinting,
      isLunging,
      hammerSlamWindupTime,
      hammerSlamAttackTime,
      settings,
      v3QualityTier,
      isLocalV3Animation,
      animationClockMs,
      lookPitch,
    });
  }

  if (mesh.userData.modelSystem === 'v2') {
    animateSpartanCombatantModelV2({
      refs,
      mesh,
      vel,
      yaw,
      hp,
      weaponState,
      weaponTimer,
      dt,
      isSliding,
      isSprinting,
      hammerReloadTime,
      hammerMeleeReload,
      hammerSlamWindupTime,
      hammerSlamAttackTime,
    });
    return true;
  }

  const lowerTorso = mesh.userData.lowerTorso as THREE.Group | undefined;
  const upperTorso = mesh.userData.upperTorso as THREE.Group | undefined;
  const leftLeg = mesh.userData.leftLeg as THREE.Group | undefined;
  const rightLeg = mesh.userData.rightLeg as THREE.Group | undefined;

  if (!lowerTorso || !upperTorso || !leftLeg || !rightLeg) return false;

  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  if (hp > 0) {
    if (isSliding) {
      lowerTorso.position.y = THREE.MathUtils.lerp(lowerTorso.position.y, -0.48, dt * 10.0);
      lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, -0.24, dt * 10.0);

      leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, -1.2, dt * 10.0);
      rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, -0.9, dt * 10.0);
      leftLeg.rotation.z = THREE.MathUtils.lerp(leftLeg.rotation.z, -0.12, dt * 10.0);
      rightLeg.rotation.z = THREE.MathUtils.lerp(rightLeg.rotation.z, 0.12, dt * 10.0);

      if (Math.random() < 0.28) {
        spawnFrictionSparkParticle(refs, mesh.position);
      }
    } else if (isSprinting && speed > 0.15) {
      lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, 0.28, dt * 10.0);

      if (mesh.userData.walkPhase === undefined) {
        mesh.userData.walkPhase = 0;
      }

      const frequency = 8.5 * (speed / 5.8);
      mesh.userData.walkPhase += dt * frequency * Math.PI * 2;

      const phase = mesh.userData.walkPhase;
      const maxSwing = 0.68;

      leftLeg.rotation.x = Math.sin(phase) * maxSwing;
      rightLeg.rotation.x = -Math.sin(phase) * maxSwing;
      leftLeg.rotation.z = Math.cos(phase) * 0.06;
      rightLeg.rotation.z = -Math.cos(phase) * 0.06;

      const bobAmount = Math.abs(Math.sin(phase)) * 0.05;
      lowerTorso.position.y = -bobAmount;

      if (Math.random() < 0.18) {
        const footPos = mesh.position.clone();
        footPos.x += (Math.random() - 0.5) * 0.3;
        footPos.z += (Math.random() - 0.5) * 0.3;
        spawnSprintDustParticle(refs, footPos);
      }
    } else if (speed > 0.15) {
      lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, 0, dt * 10.0);

      if (mesh.userData.walkPhase === undefined) {
        mesh.userData.walkPhase = 0;
      }

      const frequency = 5.2 * (speed / 4.0);
      mesh.userData.walkPhase += dt * frequency * Math.PI * 2;

      const phase = mesh.userData.walkPhase;
      const maxSwing = 0.52;

      leftLeg.rotation.x = Math.sin(phase) * maxSwing;
      rightLeg.rotation.x = -Math.sin(phase) * maxSwing;
      leftLeg.rotation.z = Math.cos(phase) * 0.05;
      rightLeg.rotation.z = -Math.cos(phase) * 0.05;

      const bobAmount = Math.abs(Math.sin(phase)) * 0.04;
      lowerTorso.position.y = -bobAmount;
    } else {
      lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, 0, dt * 10.0);
      leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, 0, dt * 10.0);
      leftLeg.rotation.z = THREE.MathUtils.lerp(leftLeg.rotation.z, 0, dt * 10.0);
      rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, 0, dt * 10.0);
      rightLeg.rotation.z = THREE.MathUtils.lerp(rightLeg.rotation.z, 0, dt * 10.0);
      lowerTorso.position.y = THREE.MathUtils.lerp(lowerTorso.position.y, 0, dt * 10.0);
      mesh.userData.walkPhase = 0;
    }
  } else {
    lowerTorso.rotation.x = 0;
    leftLeg.rotation.x = 0;
    leftLeg.rotation.z = 0;
    rightLeg.rotation.x = 0;
    rightLeg.rotation.z = 0;
    lowerTorso.position.y = 0;
  }

  let targetLowerTorsoYaw = 0;
  if (speed > 0.15 && hp > 0) {
    const moveYaw = getYawForHeading(vel.x, vel.z);
    let diff = moveYaw - yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));

    const maxTwist = Math.PI / 3;
    targetLowerTorsoYaw = Math.abs(diff) > maxTwist
      ? Math.sign(diff) * maxTwist
      : diff;
  }

  lowerTorso.rotation.y = THREE.MathUtils.lerp(
    lowerTorso.rotation.y,
    targetLowerTorsoYaw,
    dt * 9.0
  );

  let targetUpperTorsoYaw = 0;
  let targetUpperTorsoPitch = 0;
  let targetUpperTorsoRoll = 0;

  if (hp > 0) {
    if (weaponState === 'swing_up') {
      targetUpperTorsoYaw = -0.32;
      targetUpperTorsoPitch = -0.12;
    } else if (weaponState === 'swing_down') {
      targetUpperTorsoYaw = 0.42;
      targetUpperTorsoPitch = 0.22;
      targetUpperTorsoRoll = -0.08;
    } else if (weaponState === 'recovering') {
      const recoveredPct = Math.min(1.0, weaponTimer / hammerReloadTime);
      targetUpperTorsoYaw = THREE.MathUtils.lerp(0.42, 0, recoveredPct);
      targetUpperTorsoPitch = THREE.MathUtils.lerp(0.22, 0, recoveredPct);
    } else if (weaponState === 'melee_swing' || weaponState === 'melee_up') {
      targetUpperTorsoYaw = 0.5;
      targetUpperTorsoPitch = 0.05;
      targetUpperTorsoRoll = 0.1;
    } else if (weaponState === 'melee_recover' || weaponState === 'melee_down') {
      const recoveredPct = Math.min(1.0, weaponTimer / hammerMeleeReload);
      targetUpperTorsoYaw = THREE.MathUtils.lerp(0.5, 0, recoveredPct);
      targetUpperTorsoPitch = THREE.MathUtils.lerp(0.05, 0, recoveredPct);
      targetUpperTorsoRoll = THREE.MathUtils.lerp(0.1, 0, recoveredPct);
    }
  }

  upperTorso.rotation.y = THREE.MathUtils.lerp(upperTorso.rotation.y, targetUpperTorsoYaw, dt * 10.0);
  upperTorso.rotation.x = THREE.MathUtils.lerp(upperTorso.rotation.x, targetUpperTorsoPitch, dt * 10.0);
  upperTorso.rotation.z = THREE.MathUtils.lerp(upperTorso.rotation.z, targetUpperTorsoRoll, dt * 10.0);
  return true;
}

export function animateCombatantWeaponMeshes({
  hammerModel,
  swordModel,
  pistolModel,
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging,
  dt,
  settings,
  combatantModel,
}: {
  hammerModel: THREE.Group | undefined | null;
  swordModel: THREE.Group | undefined | null;
  pistolModel?: THREE.Group | undefined | null;
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  dt: number;
  settings: Partial<UniversalSettings>;
  combatantModel?: THREE.Group | null;
}): void {
  if (hammerModel) {
    hammerModel.visible = activeWeapon === 'hammer';
  }
  if (swordModel) {
    swordModel.visible = activeWeapon === 'sword';
  }
  if (pistolModel) {
    pistolModel.visible = activeWeapon === 'pistol';
  }

  if (
    hammerModel?.userData.modelSystem === 'v3' ||
    swordModel?.userData.modelSystem === 'v3' ||
    pistolModel?.userData.modelSystem === 'v3'
  ) {
    animateV3WeaponMeshes({
      hammerModel,
      swordModel,
      pistolModel,
      activeWeapon,
      weaponState,
      weaponTimer,
      isLunging,
      dt,
      settings,
      combatantModel,
    });
    return;
  }

  // Animating Gravity Hammer
  if (hammerModel && activeWeapon === 'hammer') {
    const hammerAttackAnimation = getHammerAttackAnimationStyle(settings);
    const hammerSlamTiming = resolveHammerSlamTiming(settings);
    if (weaponState === 'ready') {
      applyThirdPersonWeaponPose(hammerModel, {
        position: [0.48, 1.08 - 0.64, -0.48],
        rotation: [0.2, 0.1, -0.15],
      });
    } 
    else if (weaponState === 'swing_up') {
      const windup = hammerSlamTiming.windupTime;
      const pct = Math.min(1.0, weaponTimer / windup);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('windup', pct));
      } else {
      applyThirdPersonWeaponPose(hammerModel, {
        position: [
          THREE.MathUtils.lerp(0.48, 0.4, pct),
          THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64,
          THREE.MathUtils.lerp(-0.48, -0.15, pct),
        ],
        rotation: [
          THREE.MathUtils.lerp(0.2, -1.3, pct),
          0.1,
          -0.15,
        ],
      });
      }
    } 
    else if (weaponState === 'swing_down') {
      const strike = hammerSlamTiming.attackTime;
      const pct = Math.min(1.0, weaponTimer / strike);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('strike', pct));
      } else {
      applyThirdPersonWeaponPose(hammerModel, {
        position: [
          THREE.MathUtils.lerp(0.4, 0.2, pct),
          THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64,
          THREE.MathUtils.lerp(-0.15, -0.9, pct),
        ],
        rotation: [
          THREE.MathUtils.lerp(-1.3, 1.1, pct),
          0.1,
          -0.15,
        ],
      });
      }
    } 
    else if (weaponState === 'recovering') {
      const recover = settings.hammerReloadTime ?? 0.6;
      const pct = Math.min(1.0, weaponTimer / recover);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('recover', pct));
      } else {
      applyThirdPersonWeaponPose(hammerModel, {
        position: [
          THREE.MathUtils.lerp(0.2, 0.48, pct),
          THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
          THREE.MathUtils.lerp(-0.9, -0.48, pct),
        ],
        rotation: [
          THREE.MathUtils.lerp(1.1, 0.2, pct),
          0.1,
          -0.15,
        ],
      });
      }
    }
    else if (weaponState === 'melee_up' || weaponState === 'melee_swing') {
      const meleeSpeed = settings.hammerMeleeSpeed ?? 0.24;
      const windup = meleeSpeed * 0.4;
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('melee_swing', Math.min(1.0, weaponTimer / meleeSpeed)));
      } else {
      
      if (weaponState === 'melee_swing' && weaponTimer >= windup) {
        const strike = meleeSpeed * 0.6;
        const pct = Math.min(1.0, (weaponTimer - windup) / strike);
        applyThirdPersonWeaponPose(hammerModel, {
          position: [
            THREE.MathUtils.lerp(0.58, 0.18, pct),
            THREE.MathUtils.lerp(0.90, 1.20, pct) - 0.64,
            THREE.MathUtils.lerp(-0.3, -0.8, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(0.35, 0.55, pct),
            THREE.MathUtils.lerp(0.4, -0.8, pct),
            THREE.MathUtils.lerp(-0.25, -0.5, pct),
          ],
        });
      } else {
        const pct = Math.min(1.0, weaponTimer / windup);
        applyThirdPersonWeaponPose(hammerModel, {
          position: [
            THREE.MathUtils.lerp(0.48, 0.58, pct),
            THREE.MathUtils.lerp(1.08, 0.90, pct) - 0.64,
            THREE.MathUtils.lerp(-0.48, -0.3, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(0.2, 0.35, pct),
            THREE.MathUtils.lerp(0.1, 0.4, pct),
            THREE.MathUtils.lerp(-0.15, -0.25, pct),
          ],
        });
      }
      }
    }
    else if (weaponState === 'melee_down') {
      const meleeSpeed = settings.hammerMeleeSpeed ?? 0.24;
      const strike = meleeSpeed * 0.6;
      const pct = Math.min(1.0, weaponTimer / strike);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('melee_swing', 0.4 + pct * 0.6));
      } else {
      applyThirdPersonWeaponPose(hammerModel, {
        position: [
          THREE.MathUtils.lerp(0.58, 0.18, pct),
          THREE.MathUtils.lerp(0.90, 1.20, pct) - 0.64,
          THREE.MathUtils.lerp(-0.3, -0.8, pct),
        ],
        rotation: [
          THREE.MathUtils.lerp(0.35, 0.55, pct),
          THREE.MathUtils.lerp(0.4, -0.8, pct),
          THREE.MathUtils.lerp(-0.25, -0.5, pct),
        ],
      });
      }
    }
    else if (weaponState === 'melee_recover') {
      const recover = settings.hammerMeleeReload ?? 0.5;
      const pct = Math.min(1.0, weaponTimer / recover);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('melee_recover', pct));
      } else {
      applyThirdPersonWeaponPose(hammerModel, {
        position: [
          THREE.MathUtils.lerp(0.18, 0.48, pct),
          THREE.MathUtils.lerp(1.20, 1.08, pct) - 0.64,
          THREE.MathUtils.lerp(-0.8, -0.48, pct),
        ],
        rotation: [
          THREE.MathUtils.lerp(0.55, 0.2, pct),
          THREE.MathUtils.lerp(-0.8, 0.1, pct),
          THREE.MathUtils.lerp(-0.5, -0.15, pct),
        ],
      });
      }
    }
  }

  // Animating Katar Sword
  if (swordModel && activeWeapon === 'sword') {
    const swordAttackAnimation = getSwordAttackAnimationStyle(settings);
    if (isLunging) {
      if (swordAttackAnimation === 'highFidelity') {
        const lungeTimer = Number(swordModel.userData.lungePoseTimer ?? 0) + dt;
        swordModel.userData.lungePoseTimer = lungeTimer;
        applyWeaponPose(swordModel, getThirdPersonSwordLungePose(lungeTimer));
      } else {
        applyThirdPersonWeaponPose(swordModel, {
          position: [0.0, 1.2 - 0.64, -0.75],
          rotation: [Math.PI / 2 + 0.15, 0, 0],
        });
      }
    } else if (weaponState === 'ready') {
      swordModel.userData.lungePoseTimer = 0;
      applyThirdPersonWeaponPose(swordModel, {
        position: [0.48, 1.08 - 0.64, -0.32],
        rotation: [Math.PI / 2, 0, -Math.PI / 8],
      });
    } 
    else if (weaponState === 'swing_up') {
      swordModel.userData.lungePoseTimer = 0;
      const windup = (settings.swordSlashSpeed ?? 0.22) * 0.5;
      const pct = Math.min(1.0, weaponTimer / windup);
      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(swordModel, getThirdPersonSwordSlashPose('slash', pct * 0.5));
      } else {
      applyThirdPersonWeaponPose(swordModel, {
        position: [
          THREE.MathUtils.lerp(0.48, 0.62, pct),
          THREE.MathUtils.lerp(1.08, 1.2, pct) - 0.64,
          THREE.MathUtils.lerp(-0.32, -0.15, pct),
        ],
        rotation: [
          Math.PI / 2,
          THREE.MathUtils.lerp(0, 0.6, pct),
          THREE.MathUtils.lerp(-Math.PI / 8, Math.PI / 4, pct),
        ],
      });
      }
    }
    else if (weaponState === 'swing_down') {
      const strike = (settings.swordSlashSpeed ?? 0.22) * 0.5;
      const pct = Math.min(1.0, weaponTimer / strike);
      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(swordModel, getThirdPersonSwordSlashPose('slash', 0.5 + pct * 0.5));
      } else {
      applyThirdPersonWeaponPose(swordModel, {
        position: [
          THREE.MathUtils.lerp(0.62, 0.2, pct),
          THREE.MathUtils.lerp(1.2, 0.9, pct) - 0.64,
          THREE.MathUtils.lerp(-0.15, -0.75, pct),
        ],
        rotation: [
          Math.PI / 2,
          THREE.MathUtils.lerp(0.6, -0.8, pct),
          THREE.MathUtils.lerp(Math.PI / 4, -Math.PI / 3, pct),
        ],
      });
      }
    }
    else if (weaponState === 'slashing') {
      const slash = settings.swordSlashSpeed ?? 0.22;
      const pct = Math.min(1.0, weaponTimer / slash);
      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(swordModel, getThirdPersonSwordSlashPose('slash', pct));
      }
    }
    else if (weaponState === 'recovering') {
      const recover = settings.swordSlashReload ?? 0.6;
      const pct = Math.min(1.0, weaponTimer / recover);
      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(swordModel, getThirdPersonSwordSlashPose('recover', pct));
      } else {
      applyThirdPersonWeaponPose(swordModel, {
        position: [
          THREE.MathUtils.lerp(0.2, 0.48, pct),
          THREE.MathUtils.lerp(0.9, 1.08, pct) - 0.64,
          THREE.MathUtils.lerp(-0.75, -0.32, pct),
        ],
        rotation: [
          Math.PI / 2,
          THREE.MathUtils.lerp(-0.8, 0, pct),
          THREE.MathUtils.lerp(-Math.PI / 3, -Math.PI / 8, pct),
        ],
      });
      }
    }
  }

  const armTimer = isLunging && swordModel
    ? Number(swordModel.userData.lungePoseTimer ?? weaponTimer)
    : weaponTimer;
  const armActiveWeapon = activeWeapon === 'ball' && !isV1CombatantModelSystem(combatantModel?.userData.modelSystem)
    ? 'none'
    : activeWeapon;
  applyCombatantArmPose(
    combatantModel,
    getThirdPersonCombatantArmPose({
      activeWeapon: armActiveWeapon,
      weaponState,
      weaponTimer: armTimer,
      isLunging,
      settings,
    }),
    dt
  );
}
