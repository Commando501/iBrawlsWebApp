import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import {
  applyWeaponPose,
  getHammerAttackAnimationStyle,
  getSwordAttackAnimationStyle,
  getThirdPersonHammerPose,
  getThirdPersonSwordLungePose,
  getThirdPersonSwordSlashPose,
} from './attackAnimationPresets';
import { type GrifballThreeRefs } from './threeRefs';

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

export function animateSpartanCombatantModel({
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
}): void {
  if (!mesh) return;

  const lowerTorso = mesh.userData.lowerTorso as THREE.Group | undefined;
  const upperTorso = mesh.userData.upperTorso as THREE.Group | undefined;
  const leftLeg = mesh.userData.leftLeg as THREE.Group | undefined;
  const rightLeg = mesh.userData.rightLeg as THREE.Group | undefined;

  if (!lowerTorso || !upperTorso || !leftLeg || !rightLeg) return;

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
}

export function animateCombatantWeaponMeshes({
  hammerModel,
  swordModel,
  activeWeapon,
  weaponState,
  weaponTimer,
  isLunging,
  dt,
  settings,
}: {
  hammerModel: THREE.Group | undefined | null;
  swordModel: THREE.Group | undefined | null;
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  dt: number;
  settings: any;
}): void {
  if (hammerModel) {
    hammerModel.visible = activeWeapon === 'hammer';
  }
  if (swordModel) {
    swordModel.visible = activeWeapon === 'sword';
  }

  // Animating Gravity Hammer
  if (hammerModel && activeWeapon === 'hammer') {
    const hammerAttackAnimation = getHammerAttackAnimationStyle(settings);
    if (weaponState === 'ready') {
      hammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
      hammerModel.rotation.set(0.2, 0.1, -0.15);
    } 
    else if (weaponState === 'swing_up') {
      const windup = 0.28;
      const pct = Math.min(1.0, weaponTimer / windup);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('windup', pct));
      } else {
      hammerModel.position.set(
        THREE.MathUtils.lerp(0.48, 0.4, pct),
        THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64,
        THREE.MathUtils.lerp(-0.48, -0.15, pct)
      );
      hammerModel.rotation.set(
        THREE.MathUtils.lerp(0.2, -1.3, pct),
        0.1,
        -0.15
      );
      }
    } 
    else if (weaponState === 'swing_down') {
      const strike = 0.12;
      const pct = Math.min(1.0, weaponTimer / strike);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('strike', pct));
      } else {
      hammerModel.position.set(
        THREE.MathUtils.lerp(0.4, 0.2, pct),
        THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64,
        THREE.MathUtils.lerp(-0.15, -0.9, pct)
      );
      hammerModel.rotation.set(
        THREE.MathUtils.lerp(-1.3, 1.1, pct),
        0.1,
        -0.15
      );
      }
    } 
    else if (weaponState === 'recovering') {
      const recover = settings.hammerReloadTime ?? 0.6;
      const pct = Math.min(1.0, weaponTimer / recover);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('recover', pct));
      } else {
      hammerModel.position.set(
        THREE.MathUtils.lerp(0.2, 0.48, pct),
        THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
        THREE.MathUtils.lerp(-0.9, -0.48, pct)
      );
      hammerModel.rotation.set(
        THREE.MathUtils.lerp(1.1, 0.2, pct),
        0.1,
        -0.15
      );
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
        hammerModel.position.set(
          THREE.MathUtils.lerp(0.58, 0.18, pct),
          THREE.MathUtils.lerp(0.90, 1.20, pct) - 0.64,
          THREE.MathUtils.lerp(-0.3, -0.8, pct)
        );
        hammerModel.rotation.set(
          THREE.MathUtils.lerp(0.35, 0.55, pct),
          THREE.MathUtils.lerp(0.4, -0.8, pct),
          THREE.MathUtils.lerp(-0.25, -0.5, pct)
        );
      } else {
        const pct = Math.min(1.0, weaponTimer / windup);
        hammerModel.position.set(
          THREE.MathUtils.lerp(0.48, 0.58, pct),
          THREE.MathUtils.lerp(1.08, 0.90, pct) - 0.64,
          THREE.MathUtils.lerp(-0.48, -0.3, pct)
        );
        hammerModel.rotation.set(
          THREE.MathUtils.lerp(0.2, 0.35, pct),
          THREE.MathUtils.lerp(0.1, 0.4, pct),
          THREE.MathUtils.lerp(-0.15, -0.25, pct)
        );
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
      hammerModel.position.set(
        THREE.MathUtils.lerp(0.58, 0.18, pct),
        THREE.MathUtils.lerp(0.90, 1.20, pct) - 0.64,
        THREE.MathUtils.lerp(-0.3, -0.8, pct)
      );
      hammerModel.rotation.set(
        THREE.MathUtils.lerp(0.35, 0.55, pct),
        THREE.MathUtils.lerp(0.4, -0.8, pct),
        THREE.MathUtils.lerp(-0.25, -0.5, pct)
      );
      }
    }
    else if (weaponState === 'melee_recover') {
      const recover = settings.hammerMeleeReload ?? 0.5;
      const pct = Math.min(1.0, weaponTimer / recover);
      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(hammerModel, getThirdPersonHammerPose('melee_recover', pct));
      } else {
      hammerModel.position.set(
        THREE.MathUtils.lerp(0.18, 0.48, pct),
        THREE.MathUtils.lerp(1.20, 1.08, pct) - 0.64,
        THREE.MathUtils.lerp(-0.8, -0.48, pct)
      );
      hammerModel.rotation.set(
        THREE.MathUtils.lerp(0.55, 0.2, pct),
        THREE.MathUtils.lerp(-0.8, 0.1, pct),
        THREE.MathUtils.lerp(-0.5, -0.15, pct)
      );
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
        swordModel.position.set(0.0, 1.2 - 0.64, -0.75);
        swordModel.rotation.set(Math.PI / 2 + 0.15, 0, 0);
      }
    } else if (weaponState === 'ready') {
      swordModel.userData.lungePoseTimer = 0;
      swordModel.position.set(0.48, 1.08 - 0.64, -0.32);
      swordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    } 
    else if (weaponState === 'swing_up') {
      swordModel.userData.lungePoseTimer = 0;
      const windup = (settings.swordSlashSpeed ?? 0.22) * 0.5;
      const pct = Math.min(1.0, weaponTimer / windup);
      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(swordModel, getThirdPersonSwordSlashPose('slash', pct * 0.5));
      } else {
      swordModel.position.set(
        THREE.MathUtils.lerp(0.48, 0.62, pct),
        THREE.MathUtils.lerp(1.08, 1.2, pct) - 0.64,
        THREE.MathUtils.lerp(-0.32, -0.15, pct)
      );
      swordModel.rotation.set(
        Math.PI / 2,
        THREE.MathUtils.lerp(0, 0.6, pct),
        THREE.MathUtils.lerp(-Math.PI / 8, Math.PI / 4, pct)
      );
      }
    }
    else if (weaponState === 'swing_down') {
      const strike = (settings.swordSlashSpeed ?? 0.22) * 0.5;
      const pct = Math.min(1.0, weaponTimer / strike);
      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(swordModel, getThirdPersonSwordSlashPose('slash', 0.5 + pct * 0.5));
      } else {
      swordModel.position.set(
        THREE.MathUtils.lerp(0.62, 0.2, pct),
        THREE.MathUtils.lerp(1.2, 0.9, pct) - 0.64,
        THREE.MathUtils.lerp(-0.15, -0.75, pct)
      );
      swordModel.rotation.set(
        Math.PI / 2,
        THREE.MathUtils.lerp(0.6, -0.8, pct),
        THREE.MathUtils.lerp(Math.PI / 4, -Math.PI / 3, pct)
      );
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
      swordModel.position.set(
        THREE.MathUtils.lerp(0.2, 0.48, pct),
        THREE.MathUtils.lerp(0.9, 1.08, pct) - 0.64,
        THREE.MathUtils.lerp(-0.75, -0.32, pct)
      );
      swordModel.rotation.set(
        Math.PI / 2,
        THREE.MathUtils.lerp(-0.8, 0, pct),
        THREE.MathUtils.lerp(-Math.PI / 3, -Math.PI / 8, pct)
      );
      }
    }
  }
}
