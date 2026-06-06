import { type Combatant } from '../../types';
import { updateMainAIWeaponAnimationsForState } from './mainAIWeaponAnimationRuntime';
import { updatePlayerHammerAnimationForState } from './playerHammerAnimationRuntime';
import { updatePlayerPistolAnimationForState } from './playerPistolAnimationRuntime';
import { updatePlayerSwordAnimationForState } from './playerSwordAnimationRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

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
}
