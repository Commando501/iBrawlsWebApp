import * as THREE from 'three';
import { type GrifballRuntimeState } from './runtimeState';
import { sampleV3FirstPersonWeaponPose } from './v3AnimationFidelity';

const applyV3PistolPose = (
  playerPistol: THREE.Group,
  state: GrifballRuntimeState,
  idleXBob: number,
  idleYBob: number,
  idleZRotBob: number
): void => {
  const pose = sampleV3FirstPersonWeaponPose({
    activeWeapon: 'pistol',
    weaponState: state.pPistolState,
    weaponTimer: state.pPistolTimer,
    isLunging: false,
    settings: state.settings,
  });
  playerPistol.position.set(pose.position[0], pose.position[1] + idleYBob, pose.position[2] + idleXBob);
  playerPistol.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2] + idleZRotBob);
};

export function updatePlayerPistolAnimationForState({
  state,
  playerPistol,
  playerHammer,
  playerSword,
  dt,
  idleXBob,
  idleYBob,
  idleZRotBob,
}: {
  state: GrifballRuntimeState;
  playerPistol: THREE.Group | null | undefined;
  playerHammer: THREE.Group | null | undefined;
  playerSword: THREE.Group | null | undefined;
  dt: number;
  idleXBob: number;
  idleYBob: number;
  idleZRotBob: number;
}): void {
  if (!playerPistol) return;
  const isV3Pistol = playerPistol.userData.modelSystem === 'v3';

  if (state.activeWeapon === 'pistol') {
    playerPistol.visible = true;
    if (playerHammer) playerHammer.visible = false;
    if (playerSword) playerSword.visible = false;

    if (state.pPistolState === 'ready') {
      if (isV3Pistol) {
        applyV3PistolPose(playerPistol, state, idleXBob, idleYBob, idleZRotBob);
      } else {
        playerPistol.position.set(0.25, -0.28 + idleYBob, -0.4 + idleXBob);
        playerPistol.rotation.set(0, 0, idleZRotBob);
      }
      state.pPistolReady = true;
      state.pPistolCooldown = 1.0;
    } else if (state.pPistolState === 'firing') {
      state.pPistolTimer += dt;
      const fireDuration = 0.08;
      const pct = Math.min(1.0, state.pPistolTimer / fireDuration);
      if (isV3Pistol) {
        applyV3PistolPose(playerPistol, state, idleXBob, idleYBob, idleZRotBob);
      } else {
        playerPistol.position.x = 0.25;
        playerPistol.position.y = THREE.MathUtils.lerp(-0.28, -0.22, pct) + idleYBob;
        playerPistol.position.z = THREE.MathUtils.lerp(-0.4, -0.3, pct) + idleXBob;
        playerPistol.rotation.x = THREE.MathUtils.lerp(0, -0.4, pct);
        playerPistol.rotation.y = 0;
        playerPistol.rotation.z = idleZRotBob;
      }

      state.pPistolCooldown = 1.0 - (pct * 0.4);

      if (pct >= 1.0) {
        state.pPistolState = 'recovering';
        state.pPistolTimer = 0;
      }
    } else if (state.pPistolState === 'recovering') {
      state.pPistolTimer += dt;
      const recoverDuration = 0.15;
      const pct = Math.min(1.0, state.pPistolTimer / recoverDuration);
      if (isV3Pistol) {
        applyV3PistolPose(playerPistol, state, idleXBob, idleYBob, idleZRotBob);
      } else {
        playerPistol.position.x = 0.25;
        playerPistol.position.y = THREE.MathUtils.lerp(-0.22, -0.28, pct) + idleYBob;
        playerPistol.position.z = THREE.MathUtils.lerp(-0.3, -0.4, pct) + idleXBob;
        playerPistol.rotation.x = THREE.MathUtils.lerp(-0.4, 0, pct);
        playerPistol.rotation.y = 0;
        playerPistol.rotation.z = idleZRotBob;
      }

      state.pPistolCooldown = pct;

      if (pct >= 1.0) {
        state.pPistolState = 'ready';
        state.pPistolCooldown = 1.0;
        state.pPistolReady = true;
      }
    }
  } else {
    playerPistol.visible = false;
  }
}
