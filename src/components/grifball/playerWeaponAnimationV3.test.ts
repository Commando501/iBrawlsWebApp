import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3HammerModel, buildV3PistolModel, buildV3SwordModel } from '../v3/VoxelModelsV3';
import { updatePlayerHammerAnimationForState } from './playerHammerAnimationRuntime';
import { updatePlayerPistolAnimationForState } from './playerPistolAnimationRuntime';
import { updatePlayerSwordAnimationForState } from './playerSwordAnimationRuntime';
import type { GrifballRuntimeState } from './runtimeState';
import { sampleV3FirstPersonWeaponPose } from './v3AnimationFidelity';

const baseState = (): GrifballRuntimeState => ({
  activeWeapon: 'hammer',
  pWeaponState: 'ready',
  pWeaponTimer: 0,
  pWeaponReady: true,
  pWeaponCooldown: 1,
  pSwordState: 'ready',
  pSwordTimer: 0,
  pSwordReady: true,
  pSwordCooldown: 1,
  pPistolState: 'ready',
  pPistolTimer: 0,
  pPistolReady: true,
  pPistolCooldown: 1,
  pSwordRecoverDuration: 0.6,
  isLunging: false,
  lungeTimer: 0,
  swapCooldownTimer: 0,
  swapCooldownDuration: 0,
  settings: {},
} as GrifballRuntimeState);

const assertPoseClose = (
  actual: THREE.Object3D,
  expected: ReturnType<typeof sampleV3FirstPersonWeaponPose>
) => {
  assert.equal(Math.abs(actual.position.x - expected.position[0]) < 0.0001, true);
  assert.equal(Math.abs(actual.position.y - expected.position[1]) < 0.0001, true);
  assert.equal(Math.abs(actual.position.z - expected.position[2]) < 0.0001, true);
  assert.equal(Math.abs(actual.rotation.x - expected.rotation[0]) < 0.0001, true);
  assert.equal(Math.abs(actual.rotation.y - expected.rotation[1]) < 0.0001, true);
  assert.equal(Math.abs(actual.rotation.z - expected.rotation[2]) < 0.0001, true);
};

describe('V3 first-person player weapon animation runtime', () => {
  it('uses the shared V3 hammer sampler for live first-person hammer windup', () => {
    const state = baseState();
    state.activeWeapon = 'hammer';
    state.pWeaponState = 'swing_up';
    Object.assign(state.settings, { hammerSlamWindupTime: 0.45, hammerSlamAttackTime: 0.3 });
    const hammer = buildV3HammerModel(192);

    updatePlayerHammerAnimationForState({
      state,
      playerHammer: hammer,
      dt: 0.1,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
      applyHammerStrikeImpact: () => {},
      applyPlayerHammerMeleeImpact: () => {},
    });

    assertPoseClose(hammer, sampleV3FirstPersonWeaponPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.1,
      isLunging: false,
      settings: state.settings,
    }));
  });

  it('uses the shared V3 sword sampler for live first-person lunge', () => {
    const state = baseState();
    state.activeWeapon = 'sword';
    state.isLunging = true;
    state.lungeTimer = 0.08;
    const sword = buildV3SwordModel(192);

    updatePlayerSwordAnimationForState({
      state,
      playerSword: sword,
      playerHammer: buildV3HammerModel(192),
      dt: 0,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
      applyPlayerSwordSlashImpact: () => false,
    });

    assertPoseClose(sword, sampleV3FirstPersonWeaponPose({
      activeWeapon: 'sword',
      weaponState: 'ready',
      weaponTimer: 0.08,
      isLunging: true,
      settings: state.settings,
    }));
  });

  it('uses the shared V3 pistol sampler for live first-person recoil', () => {
    const state = baseState();
    state.activeWeapon = 'pistol';
    state.pPistolState = 'firing';
    const pistol = buildV3PistolModel(192);

    updatePlayerPistolAnimationForState({
      state,
      playerPistol: pistol,
      playerHammer: buildV3HammerModel(192),
      playerSword: buildV3SwordModel(192),
      dt: 0,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
    });

    assertPoseClose(pistol, sampleV3FirstPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: state.settings,
    }));
  });
});
