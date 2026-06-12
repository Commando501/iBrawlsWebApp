import * as THREE from 'three';
import {
  applyWeaponPose,
  getFirstPersonSwordLungePose,
  getFirstPersonSwordSlashPose,
  getSwordAttackAnimationStyle,
} from './attackAnimationPresets';
import { type GrifballRuntimeState } from './runtimeState';
import { sampleV3FirstPersonWeaponPose } from './v3AnimationFidelity';

const applyV3SwordPose = (
  playerSword: THREE.Group,
  state: GrifballRuntimeState,
  weaponState: string,
  weaponTimer: number,
  isLunging: boolean,
  idleXBob: number,
  idleYBob: number,
  idleZRotBob: number
): void => {
  const pose = sampleV3FirstPersonWeaponPose({
    activeWeapon: 'sword',
    weaponState,
    weaponTimer,
    isLunging,
    settings: state.settings,
  });
  playerSword.position.set(pose.position[0], pose.position[1] + idleYBob, pose.position[2] + idleXBob);
  playerSword.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2] + idleZRotBob);
};

export function updatePlayerSwordAnimationForState({
  state,
  playerSword,
  playerHammer,
  dt,
  idleXBob,
  idleYBob,
  idleZRotBob,
  applyPlayerSwordSlashImpact,
}: {
  state: GrifballRuntimeState;
  playerSword: THREE.Group | null | undefined;
  playerHammer: THREE.Group | null | undefined;
  dt: number;
  idleXBob: number;
  idleYBob: number;
  idleZRotBob: number;
  applyPlayerSwordSlashImpact: () => boolean;
}): boolean {
  if (!playerSword) return false;
  const isV3Sword = playerSword.userData.modelSystem === 'v3';

  if (state.activeWeapon === 'sword') {
    playerSword.visible = true;
    if (playerHammer) playerHammer.visible = false;

    if (state.isLunging) {
      if (isV3Sword) {
        applyV3SwordPose(playerSword, state, 'ready', state.lungeTimer, true, idleXBob, idleYBob, idleZRotBob);
      } else if (getSwordAttackAnimationStyle(state.settings) === 'highFidelity') {
        const pose = getFirstPersonSwordLungePose(state.lungeTimer, idleYBob);
        pose.position[2] += idleXBob;
        applyWeaponPose(playerSword, pose);
      } else {
        playerSword.position.set(0.0, -0.22 + idleYBob, -0.7 + idleXBob);
        playerSword.rotation.set(-Math.PI / 2 - 0.15, 0, 0);
      }

      state.pSwordReady = false;
      state.pSwordCooldown = 0.5;
    } else if (state.pSwordState === 'ready') {
      if (isV3Sword) {
        applyV3SwordPose(playerSword, state, state.pSwordState, state.pSwordTimer, false, idleXBob, idleYBob, idleZRotBob);
      } else {
        playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
        playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
      }

      if (state.swapCooldownTimer > 0) {
        state.pSwordReady = false;
        state.pSwordCooldown = state.swapCooldownDuration > 0
          ? (1.0 - state.swapCooldownTimer / state.swapCooldownDuration)
          : 1.0;
      } else {
        state.pSwordReady = true;
        state.pSwordCooldown = 1.0;
      }
    } else if (state.pSwordState === 'slashing') {
      state.pSwordTimer += dt;
      const duration = state.settings.swordSlashSpeed ?? 0.22;
      const pct = Math.min(1.0, state.pSwordTimer / duration);

      if (isV3Sword) {
        applyV3SwordPose(playerSword, state, state.pSwordState, state.pSwordTimer, false, idleXBob, idleYBob, idleZRotBob);
      } else if (getSwordAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerSword, getFirstPersonSwordSlashPose('slash', pct, idleYBob));
      } else {
        playerSword.position.x = THREE.MathUtils.lerp(-0.45, 0.45, pct);
        playerSword.position.y = THREE.MathUtils.lerp(-0.35, -0.28, pct) + idleYBob;
        playerSword.position.z = THREE.MathUtils.lerp(-0.4, -0.75, pct) + (pct < 0.5 ? -0.15 : 0.15);

        playerSword.rotation.x = -Math.PI / 2;
        playerSword.rotation.y = THREE.MathUtils.lerp(-1.2, 1.2, pct);
        playerSword.rotation.z = THREE.MathUtils.lerp(0.6, -1.5, pct);
      }

      state.pSwordCooldown = 1.0 - pct * 0.4;

      if (pct >= 0.5 && (state.pSwordTimer - dt) < duration * 0.5) {
        if (applyPlayerSwordSlashImpact()) return true;
      }

      if (pct >= 1.0) {
        state.pSwordState = 'recovering';
        state.pSwordTimer = 0;
        state.pSwordRecoverDuration = state.settings.swordSlashReload ?? 0.6;
      }
    } else if (state.pSwordState === 'recovering') {
      state.pSwordTimer += dt;
      const recover = state.pSwordRecoverDuration ?? 0.6;
      const pct = Math.min(1.0, state.pSwordTimer / recover);

      if (isV3Sword) {
        applyV3SwordPose(playerSword, state, state.pSwordState, state.pSwordTimer, false, idleXBob, idleYBob, idleZRotBob);
      } else if (getSwordAttackAnimationStyle(state.settings) === 'highFidelity') {
        applyWeaponPose(playerSword, getFirstPersonSwordSlashPose('recover', pct, idleYBob));
      } else {
        playerSword.position.x = THREE.MathUtils.lerp(0.45, 0.35, pct);
        playerSword.position.y = THREE.MathUtils.lerp(-0.28, -0.38, pct) + idleYBob;
        playerSword.position.z = THREE.MathUtils.lerp(-0.75, -0.5, pct);

        playerSword.rotation.x = -Math.PI / 2;
        playerSword.rotation.y = THREE.MathUtils.lerp(1.2, 0, pct);
        playerSword.rotation.z = THREE.MathUtils.lerp(-1.5, -Math.PI / 8, pct);
      }

      state.pSwordCooldown = 0.2 + pct * 0.8;

      if (pct >= 1.0) {
        state.pSwordState = 'ready';
        state.pSwordReady = true;
        state.pSwordCooldown = 1.0;
      }
    }
  } else {
    playerSword.visible = false;
  }

  return false;
}
