import * as THREE from 'three';
import {
  applyWeaponPose,
  getFirstPersonHammerPose,
  getHammerAttackAnimationStyle,
} from './attackAnimationPresets';
import { resolveHammerSlamTiming } from '../../game/hammerSlamTiming';
import { type GrifballRuntimeState } from './runtimeState';
import { sampleV3FirstPersonWeaponPose } from './v3AnimationFidelity';

const applyV3HammerPose = (
  playerHammer: THREE.Group,
  state: GrifballRuntimeState,
  idleXBob: number,
  idleYBob: number,
  idleZRotBob: number
): void => {
  const pose = sampleV3FirstPersonWeaponPose({
    activeWeapon: 'hammer',
    weaponState: state.pWeaponState,
    weaponTimer: state.pWeaponTimer,
    isLunging: false,
    settings: state.settings,
  });
  playerHammer.position.set(pose.position[0], pose.position[1] + idleYBob, pose.position[2] + idleXBob);
  playerHammer.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2] + idleZRotBob);
};

export function updatePlayerHammerAnimationForState({
  state,
  playerHammer,
  dt,
  idleXBob,
  idleYBob,
  idleZRotBob,
  applyHammerStrikeImpact,
  applyPlayerHammerMeleeImpact,
}: {
  state: GrifballRuntimeState;
  playerHammer: THREE.Group;
  dt: number;
  idleXBob: number;
  idleYBob: number;
  idleZRotBob: number;
  applyHammerStrikeImpact: (isPlayerStriking: boolean) => void;
  applyPlayerHammerMeleeImpact: () => void;
}): void {
  const isV3Hammer = playerHammer.userData.modelSystem === 'v3';

  if (state.activeWeapon === 'hammer') {
    playerHammer.visible = true;

    if (state.pWeaponState === 'ready') {
      if (isV3Hammer) {
        applyV3HammerPose(playerHammer, state, idleXBob, idleYBob, idleZRotBob);
      } else {
        playerHammer.position.set(0.35, -0.38 + idleYBob, -0.65 + idleXBob);
        playerHammer.rotation.set(0.15, -0.3, -0.15 + idleZRotBob);
      }
      if (state.swapCooldownTimer > 0) {
        state.pWeaponReady = false;
        state.pWeaponCooldown = state.swapCooldownDuration > 0
          ? (1.0 - state.swapCooldownTimer / state.swapCooldownDuration)
          : 1.0;
      } else {
        state.pWeaponReady = true;
        state.pWeaponCooldown = 1.0;
      }
    } else if (state.pWeaponState === 'swing_up') {
      state.pWeaponTimer += dt;
      const { windupTime: windupDuration } = resolveHammerSlamTiming(state.settings);
      const pct = Math.min(1.0, state.pWeaponTimer / windupDuration);

      if (isV3Hammer) {
        applyV3HammerPose(playerHammer, state, idleXBob, idleYBob, idleZRotBob);
      } else if (getHammerAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerHammer, getFirstPersonHammerPose('windup', pct, idleYBob));
      } else {
        const targetY = -0.1;
        const targetZ = -0.4;
        const targetXRot = -1.13;
        const targetYRot = -0.5;

        playerHammer.position.y = THREE.MathUtils.lerp(-0.38, targetY, pct);
        playerHammer.position.z = THREE.MathUtils.lerp(-0.65, targetZ, pct);
        playerHammer.rotation.x = THREE.MathUtils.lerp(0.15, targetXRot, pct);
        playerHammer.rotation.y = THREE.MathUtils.lerp(-0.3, targetYRot, pct);
      }

      state.pWeaponCooldown = 1.0 - (pct * 0.3);

      if (pct >= 1.0) {
        state.pWeaponState = 'swing_down';
        state.pWeaponTimer = 0;
      }
    } else if (state.pWeaponState === 'swing_down') {
      state.pWeaponTimer += dt;
      const { attackTime: strikeDuration } = resolveHammerSlamTiming(state.settings);
      const pct = Math.min(1.0, state.pWeaponTimer / strikeDuration);

      if (isV3Hammer) {
        applyV3HammerPose(playerHammer, state, idleXBob, idleYBob, idleZRotBob);
      } else if (getHammerAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerHammer, getFirstPersonHammerPose('strike', pct, idleYBob));
      } else {
        const startXRot = -1.13;
        const targetXRot = 0.95;
        const targetY = -0.48;
        const targetZ = -0.85;

        playerHammer.position.y = THREE.MathUtils.lerp(-0.1, targetY, pct);
        playerHammer.position.z = THREE.MathUtils.lerp(-0.4, targetZ, pct);
        playerHammer.rotation.x = THREE.MathUtils.lerp(startXRot, targetXRot, pct);
      }

      state.pWeaponCooldown = 0.7 - (pct * 0.5);

      if (pct >= 1.0) {
        state.pWeaponState = 'recovering';
        state.pWeaponTimer = 0;
        applyHammerStrikeImpact(true);
      }
    } else if (state.pWeaponState === 'recovering') {
      state.pWeaponTimer += dt;
      const recoveryDuration = state.settings.hammerReloadTime ?? 0.6;
      const pct = Math.min(1.0, state.pWeaponTimer / recoveryDuration);

      if (isV3Hammer) {
        applyV3HammerPose(playerHammer, state, idleXBob, idleYBob, idleZRotBob);
      } else if (getHammerAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerHammer, getFirstPersonHammerPose('recover', pct, idleYBob));
      } else {
        const startXRot = 0.95;
        const targetXRot = 0.15;
        const startY = -0.48;
        const targetY = -0.38;
        const startZ = -0.85;
        const targetZ = -0.65;

        playerHammer.position.y = THREE.MathUtils.lerp(startY, targetY, pct);
        playerHammer.position.z = THREE.MathUtils.lerp(
          startXRot === 0.95 ? startZ : playerHammer.position.z,
          targetZ,
          pct
        );
        playerHammer.rotation.x = THREE.MathUtils.lerp(startXRot, targetXRot, pct);
        playerHammer.rotation.y = THREE.MathUtils.lerp(-0.5, -0.3, pct);
      }

      state.pWeaponCooldown = 0.2 + (pct * 0.8);

      if (pct >= 1.0) {
        state.pWeaponState = 'ready';
        state.pWeaponCooldown = 1.0;
        state.pWeaponReady = true;
      }
    } else if (state.pWeaponState === 'melee_swing') {
      state.pWeaponTimer += dt;
      const duration = state.settings.hammerMeleeSpeed ?? 0.24;
      const pct = Math.min(1.0, state.pWeaponTimer / duration);

      if (isV3Hammer) {
        applyV3HammerPose(playerHammer, state, idleXBob, idleYBob, idleZRotBob);
      } else if (getHammerAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerHammer, getFirstPersonHammerPose('melee_swing', pct, idleYBob));
      } else {
        playerHammer.position.x = THREE.MathUtils.lerp(0.35, -0.45, pct);
        playerHammer.position.y = THREE.MathUtils.lerp(-0.38, -0.28, pct) + idleYBob;
        playerHammer.position.z = THREE.MathUtils.lerp(-0.65, -0.85, pct) + (pct < 0.5 ? -0.1 : 0.1);

        playerHammer.rotation.x = THREE.MathUtils.lerp(0.15, 0.45, pct);
        playerHammer.rotation.y = THREE.MathUtils.lerp(-0.3, -1.8, pct);
        playerHammer.rotation.z = THREE.MathUtils.lerp(-0.15, -0.8, pct);
      }

      state.pWeaponCooldown = 1.0 - pct * 0.4;

      if (pct >= 0.5 && (state.pWeaponTimer - dt) < duration * 0.5) {
        applyPlayerHammerMeleeImpact();
      }

      if (pct >= 1.0) {
        state.pWeaponState = 'melee_recover';
        state.pWeaponTimer = 0;
      }
    } else if (state.pWeaponState === 'melee_recover') {
      state.pWeaponTimer += dt;
      const recoveryDuration = state.settings.hammerMeleeReload ?? 0.5;
      const pct = Math.min(1.0, state.pWeaponTimer / recoveryDuration);

      if (isV3Hammer) {
        applyV3HammerPose(playerHammer, state, idleXBob, idleYBob, idleZRotBob);
      } else if (getHammerAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerHammer, getFirstPersonHammerPose('melee_recover', pct, idleYBob));
      } else {
        playerHammer.position.x = THREE.MathUtils.lerp(-0.45, 0.35, pct);
        playerHammer.position.y = THREE.MathUtils.lerp(-0.28, -0.38, pct) + idleYBob;
        playerHammer.position.z = THREE.MathUtils.lerp(-0.85, -0.65, pct);

        playerHammer.rotation.x = THREE.MathUtils.lerp(0.45, 0.15, pct);
        playerHammer.rotation.y = THREE.MathUtils.lerp(-1.8, -0.3, pct);
        playerHammer.rotation.z = THREE.MathUtils.lerp(-0.8, -0.15, pct);
      }

      state.pWeaponCooldown = 0.6 + pct * 0.4;

      if (pct >= 1.0) {
        state.pWeaponState = 'ready';
        state.pWeaponCooldown = 1.0;
        state.pWeaponReady = true;
      }
    }
  } else {
    playerHammer.visible = false;
  }
}
