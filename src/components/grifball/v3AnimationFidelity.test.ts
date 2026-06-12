import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_ANIMATION_PROFILE_VERSION,
  getV3AnimationTrackDefinition,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
} from './v3AnimationFidelity';

const finiteTuple = (tuple: readonly number[]) => tuple.every(Number.isFinite);

describe('V3 animation fidelity profiles', () => {
  it('declares a stable profile version and known editor track ids', () => {
    assert.equal(V3_ANIMATION_PROFILE_VERSION, 1);
    assert.equal(getV3AnimationTrackDefinition('hammer_windup').weapon, 'hammer');
    assert.equal(getV3AnimationTrackDefinition('sword_lunge').weapon, 'sword');
    assert.equal(getV3AnimationTrackDefinition('pistol_fire').weapon, 'pistol');
  });

  it('samples synchronized first-person and third-person pistol recoil curves', () => {
    const firstPerson = sampleV3FirstPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });
    const thirdPerson = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });
    const recovered = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.18,
      isLunging: false,
      settings: {},
    });

    assert.equal(finiteTuple(firstPerson.position), true);
    assert.equal(finiteTuple(firstPerson.rotation), true);
    assert.equal(firstPerson.rotation[0] < -0.1, true);
    assert.equal(thirdPerson.rotation[0] < recovered.rotation[0], true);
    assert.equal(thirdPerson.position[2] > recovered.position[2], true);
  });

  it('samples expressive upper-body poses without lower-body data', () => {
    const hammer = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.2,
      isLunging: false,
      settings: { hammerSlamWindupTime: 0.45, hammerSlamAttackTime: 0.3 },
    });
    const sword = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'sword',
      weaponState: 'ready',
      weaponTimer: 0.08,
      isLunging: true,
      settings: {},
    });

    assert.equal(hammer.rightArmRotation[0] < -0.8, true);
    assert.equal(hammer.leftArmRotation[0] < -0.45, true);
    assert.equal(Math.abs(hammer.headRotation[1]) > 0.02, true);
    assert.equal(sword.upperTorsoRotation[0] > 0.1, true);
    assert.equal(sword.rightArmRotation[0] < -0.6, true);
  });
});
