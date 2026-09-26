import { type Combatant } from '../../types';
import { updateMainAIWeaponAnimationsForState } from './mainAIWeaponAnimationRuntime';
import { updatePlayerHammerAnimationForState } from './playerHammerAnimationRuntime';
import { updatePlayerPistolAnimationForState } from './playerPistolAnimationRuntime';
import { updatePlayerSwordAnimationForState } from './playerSwordAnimationRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { sampleV3GameplayFirstPersonWeaponPose } from './v3GameplayAnimation';
import { applyV3WeaponSocketBasis } from './v3WeaponSocketBasis';

export function updateWeaponAnimationFrameForState({
  state,
  refs,
  mainAI,
  dt,
  getPlayerSwordLockTarget,
  applyHammerStrikeImpact,
  applyPlayerHammerMeleeImpact,
  applyPlayerSwordSlashImpact,
  applyEnemyHammerMeleeImpact,
  applyEnemySwordSlashImpact,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  mainAI: Combatant | undefined;
  dt: number;
  getPlayerSwordLockTarget: () => unknown;
  applyHammerStrikeImpact: (isPlayerStriking: boolean) => void;
  applyPlayerHammerMeleeImpact: () => void;
  applyPlayerSwordSlashImpact: () => boolean;
  applyEnemyHammerMeleeImpact: () => void;
  applyEnemySwordSlashImpact: () => void;
}): void {
  if (state.swapCooldownTimer > 0) {
    state.swapCooldownTimer = Math.max(0, state.swapCooldownTimer - dt);
  }
  if (mainAI) {
    if (mainAI.swapCooldownTimer > 0) {
      mainAI.swapCooldownTimer = Math.max(0, mainAI.swapCooldownTimer - dt);
    }
    if (mainAI.swapLockoutTimer > 0) {
      mainAI.swapLockoutTimer = Math.max(0, mainAI.swapLockoutTimer - dt);
    }
  }
  if (state.swapLockoutTimer > 0) {
    state.swapLockoutTimer = Math.max(0, state.swapLockoutTimer - dt);
  }

  const playerHammer = refs.playerHammer;
  const playerSword = refs.playerSword;
  const camera = refs.camera;

  if (!playerHammer || !camera) return;

  if (state.isObserverMode) {
    playerHammer.visible = false;
    if (playerSword) playerSword.visible = false;
    return;
  }

  const isMoving = Math.sqrt(
    state.playerVel.x * state.playerVel.x +
    state.playerVel.z * state.playerVel.z
  ) > 0.5;
  const speedCoeff = state.isCrouching ? 0.5 : 1.0;
  const timeScale = performance.now() * 0.005 * speedCoeff;

  let idleXBob = 0;
  let idleYBob = 0;
  let idleZRotBob = 0;

  if (isMoving && !state.isJumping) {
    idleXBob = Math.sin(timeScale * 2.5) * 0.04;
    idleYBob = Math.cos(timeScale * 5) * 0.03;
    idleZRotBob = Math.sin(timeScale * 2.5) * 0.05;
  } else {
    idleYBob = Math.sin(timeScale * 1.5) * 0.008;
  }

  state.crosshairColor = getPlayerSwordLockTarget() ? 'red' : 'white';

  if (state.playerHP <= 0) {
    for (const model of [playerHammer, playerSword, refs.playerPistol]) {
      if (model) { delete model.userData.v3GameplayPlayback; delete model.userData.v3GameplaySample; }
    }
    state.pWeaponState = 'ready';
    state.pWeaponTimer = 0;
    state.pWeaponReady = true;
    state.pSwordState = 'ready';
    state.pSwordTimer = 0;
    state.pSwordReady = true;
    state.isLunging = false;
    state.lungeTimer = 0;

    playerHammer.position.set(0.35, -0.38 + idleYBob, -0.65 + idleXBob);
    playerHammer.rotation.set(0.15, -0.3, -0.15 + idleZRotBob);
    playerHammer.visible = false;
    if (playerSword) {
      playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
      playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
      playerSword.visible = false;
    }
  } else {
    if (updatePlayerSwordAnimationForState({
      state,
      playerSword,
      playerHammer,
      dt,
      idleXBob,
      idleYBob,
      idleZRotBob,
      applyPlayerSwordSlashImpact,
    })) return;

    updatePlayerHammerAnimationForState({
      state,
      playerHammer,
      dt,
      idleXBob,
      idleYBob,
      idleZRotBob,
      applyHammerStrikeImpact,
      applyPlayerHammerMeleeImpact,
    });

    updatePlayerPistolAnimationForState({
      state,
      playerPistol: refs.playerPistol,
      playerHammer,
      playerSword,
      dt,
      idleXBob,
      idleYBob,
      idleZRotBob,
    });
  }

  updateMainAIWeaponAnimationsForState({
    state,
    refs,
    mainAI,
    dt,
    applyHammerStrikeImpact,
    applyEnemyHammerMeleeImpact,
    applyEnemySwordSlashImpact,
  });

  const weapon = state.activeWeapon;
  const model = weapon === 'hammer' ? refs.playerHammer : weapon === 'sword' ? refs.playerSword : weapon === 'pistol' ? refs.playerPistol : null;
  if (model?.userData.modelSystem === 'v3' && state.playerHP > 0) {
    // Bakes use the same corrected geometry basis as the third-person sockets.
    if (model.userData.v3WeaponSocketBasis?.socketName !== 'thirdPersonPrimaryGrip') {
      applyV3WeaponSocketBasis(model, weapon as 'hammer' | 'sword' | 'pistol', 'thirdPersonPrimaryGrip');
    }
    // Share posture across weapon swaps instead of replaying crouch entry.
    if (refs.playerHammer?.userData.v3GameplayPlayback) model.userData.v3GameplayPlayback = refs.playerHammer.userData.v3GameplayPlayback;
    const pose = sampleV3GameplayFirstPersonWeaponPose({
      activeWeapon: weapon,
      weaponState: weapon === 'sword' ? state.pSwordState : weapon === 'pistol' ? state.pPistolState : state.pWeaponState,
      weaponTimer: weapon === 'sword' ? state.pSwordTimer : weapon === 'pistol' ? state.pPistolTimer : state.pWeaponTimer,
      settings: state.settings, isLunging: state.isLunging, isSliding: state.playerSlideActive,
      isCrouching: state.isCrouching,
      // Camera movement already applies the physical crouch height.
      eyeHeight: 1.65,
      velocityLength: Math.hypot(state.playerVel.x, state.playerVel.z),
    }, model, dt);
    if (refs.playerHammer) refs.playerHammer.userData.v3GameplayPlayback = model.userData.v3GameplayPlayback;
    model.position.set(...pose.position);
    model.rotation.set(...pose.rotation);
    model.userData.v3CleanMotionSource = 'blenderAuthored';
  }
}
