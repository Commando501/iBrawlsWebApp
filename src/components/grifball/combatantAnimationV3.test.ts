import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  buildV3HammerModel,
  buildV3PistolModel,
  buildV3SpartanModel,
  buildV3SwordModel,
} from '../v3/VoxelModelsV3';
import { animateCombatantWeaponMeshes, animateSpartanCombatantModel } from './combatantAnimation';
import { buildCombatantRigForModel } from './combatantRig';
import {
  animateV3CombatantModel,
  getFirstPersonV3WeaponPose,
  getV3BodyMaskForLayer,
} from './combatantAnimationV3';
import {
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
} from './v3AnimationFidelity';
import { createInitialGrifballThreeRefs } from './threeRefs';

const createV3Model = () => {
  const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
  buildCombatantRigForModel(model);
  return model;
};

describe('combatantAnimationV3 body masks', () => {
  it('declares separate lower-body, upper-body, and full-body masks', () => {
    assert.deepEqual(getV3BodyMaskForLayer('locomotion'), ['lowerTorso', 'leftLeg', 'rightLeg']);
    assert.deepEqual(getV3BodyMaskForLayer('weapon'), ['upperTorso', 'head', 'leftArm', 'rightArm']);
    assert.deepEqual(getV3BodyMaskForLayer('death'), [
      'lowerTorso',
      'upperTorso',
      'head',
      'leftArm',
      'rightArm',
      'leftLeg',
      'rightLeg',
    ]);
  });
});

describe('animateV3CombatantModel', () => {
  it('keeps lower-body locomotion active during hammer windup upper-body animation', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.18,
      dt: 1,
      settings: { hammerAttackAnimation: 'highFidelity' },
    });

    assert.notEqual(model.userData.upperTorso.rotation.y, 0);
    assert.notEqual(model.userData.rightArm.rotation.x, 0);
    assert.notEqual(model.userData.leftArm.rotation.x, 0);
    assert.notEqual(model.userData.leftLeg.rotation.x, 0);
    assert.notEqual(model.userData.rightLeg.rotation.x, 0);
  });

  it('pistol recoil affects upper-body groups without disturbing planted feet', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.04,
      dt: 1,
      settings: {},
    });

    assert.notEqual(model.userData.upperTorso.rotation.x, 0);
    assert.notEqual(model.userData.rightArm.rotation.x, 0);
    assert.equal(model.userData.leftLeg.rotation.x, 0);
    assert.equal(model.userData.rightLeg.rotation.x, 0);
  });

  it('resets V3 broad rig groups on death', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    model.userData.upperTorso.rotation.set(1, 1, 1);
    model.userData.leftLeg.rotation.set(1, 1, 1);

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 0,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      settings: {},
    });

    assert.deepEqual(model.userData.upperTorso.rotation.toArray().slice(0, 3), [0, 0, 0]);
    assert.deepEqual(model.userData.leftLeg.rotation.toArray().slice(0, 3), [0, 0, 0]);
  });

  it('animateSpartanCombatantModel dispatches V3 models to the V3 layered runtime', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateSpartanCombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(2.5, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.04,
      dt: 1,
      settings: {},
    });

    assert.notEqual(model.userData.upperTorso.rotation.x, 0);
    assert.notEqual(model.userData.leftLeg.rotation.x, 0);
  });

  it('throttles remote mobileLow V3 animation without throttling local V3 animation', () => {
    const remoteModel = createV3Model();
    const localModel = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    const baseInput = {
      refs,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 0.016,
      settings: {},
      v3QualityTier: 'mobileLow' as const,
    };

    animateSpartanCombatantModel({
      ...baseInput,
      mesh: remoteModel,
      animationClockMs: 0,
      isLocalV3Animation: false,
    });
    const firstRemotePhase = remoteModel.userData.v3WalkPhase;
    const firstRemoteBreath = remoteModel.userData.v3BreathingPhase;
    animateSpartanCombatantModel({
      ...baseInput,
      mesh: remoteModel,
      animationClockMs: 20,
      isLocalV3Animation: false,
    });
    assert.equal(remoteModel.userData.v3WalkPhase, firstRemotePhase);
    assert.equal(remoteModel.userData.v3BreathingPhase, firstRemoteBreath);

    animateSpartanCombatantModel({
      ...baseInput,
      mesh: localModel,
      animationClockMs: 0,
      isLocalV3Animation: true,
    });
    const firstLocalPhase = localModel.userData.v3WalkPhase;
    animateSpartanCombatantModel({
      ...baseInput,
      mesh: localModel,
      animationClockMs: 20,
      isLocalV3Animation: true,
    });
    assert.notEqual(localModel.userData.v3WalkPhase, firstLocalPhase);
  });

  it('adds V3 hit reaction when hp drops without changing lower-body locomotion phase', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 0.1,
      settings: {},
    });
    const phaseBeforeHit = model.userData.v3WalkPhase;

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 75,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 0.1,
      settings: {},
    });

    assert.equal(model.userData.v3WalkPhase > phaseBeforeHit, true);
    assert.notEqual(model.userData.upperTorso.rotation.z, 0);
    assert.notEqual(model.userData.head.rotation.x, 0);
  });

  it('applies optional V3 look offsets only to additive upper-body groups', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'pistol',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      lookYawOffset: 0.35,
      lookPitch: -0.2,
      settings: {},
    });

    assert.equal(model.userData.head.rotation.y > 0.1, true);
    assert.equal(model.userData.head.rotation.x < 0, true);
    assert.equal(model.userData.leftLeg.rotation.x, 0);
    assert.equal(model.userData.rightLeg.rotation.x, 0);
  });
});

describe('getFirstPersonV3WeaponPose', () => {
  it('returns deterministic first-person poses for hammer, sword, and pistol', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const pose = getFirstPersonV3WeaponPose({
        activeWeapon: weapon,
        weaponState: weapon === 'pistol' ? 'firing' : 'ready',
        weaponTimer: 0.1,
        isLunging: weapon === 'sword',
        settings: {},
      });

      assert.equal(pose.position.length, 3);
      assert.equal(pose.rotation.length, 3);
      assert.equal(pose.position.every(Number.isFinite), true);
      assert.equal(pose.rotation.every(Number.isFinite), true);
    }
  });

  it('matches the shared V3 first-person weapon pose profiles', () => {
    const cases = [
      { activeWeapon: 'hammer' as const, weaponState: 'swing_up', weaponTimer: 0.1, isLunging: false },
      { activeWeapon: 'sword' as const, weaponState: 'ready', weaponTimer: 0.08, isLunging: true },
      { activeWeapon: 'pistol' as const, weaponState: 'firing', weaponTimer: 0, isLunging: false },
    ];

    for (const input of cases) {
      const expected = sampleV3FirstPersonWeaponPose({ ...input, settings: {} });
      const actual = getFirstPersonV3WeaponPose({ ...input, settings: {} });

      assert.deepEqual(actual, expected, `${input.activeWeapon} first-person pose should use shared profile`);
    }
  });
});

describe('animateCombatantWeaponMeshes V3 integration', () => {
  it('applies V3 hammer poses without legacy V1/V2 offsets', () => {
    const hammer = buildV3HammerModel(192);
    const model = createV3Model();

    animateCombatantWeaponMeshes({
      hammerModel: hammer,
      swordModel: buildV3SwordModel(192),
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.18,
      isLunging: false,
      dt: 1,
      settings: { hammerAttackAnimation: 'highFidelity' },
      combatantModel: model,
    });

    assert.equal(hammer.visible, true);
    assert.notEqual(hammer.rotation.x, 0);
    assert.equal(hammer.userData.modelSystem, 'v3');
  });

  it('controls V3 pistol visibility by active pistol state when supplied', () => {
    const pistol = buildV3PistolModel(192);

    animateCombatantWeaponMeshes({
      hammerModel: buildV3HammerModel(192),
      swordModel: buildV3SwordModel(192),
      pistolModel: pistol,
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.04,
      isLunging: false,
      dt: 1,
      settings: {},
    });

    assert.equal(pistol.visible, true);
    assert.notEqual(pistol.position.z, 0);
  });

  it('applies shared V3 third-person weapon mesh profiles', () => {
    const pistol = buildV3PistolModel(192);
    const expected = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });

    animateCombatantWeaponMeshes({
      hammerModel: null,
      swordModel: null,
      pistolModel: pistol,
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      dt: 1,
      settings: {},
    });

    assert.deepEqual(pistol.position.toArray(), expected.position);
    assert.deepEqual(pistol.rotation.toArray().slice(0, 3), expected.rotation);
  });

  it('adds deterministic V3 first-person idle sway without affecting third-person combatant weapons', () => {
    const pistol = buildV3PistolModel(192);
    pistol.userData.v3View = 'firstPerson';

    animateCombatantWeaponMeshes({
      hammerModel: null,
      swordModel: null,
      pistolModel: pistol,
      activeWeapon: 'pistol',
      weaponState: 'ready',
      weaponTimer: 0,
      isLunging: false,
      dt: 0.25,
      settings: {},
    });
    const firstPersonY = pistol.position.y;

    const thirdPerson = buildV3PistolModel(192);
    animateCombatantWeaponMeshes({
      hammerModel: null,
      swordModel: null,
      pistolModel: thirdPerson,
      activeWeapon: 'pistol',
      weaponState: 'ready',
      weaponTimer: 0,
      isLunging: false,
      dt: 0.25,
      settings: {},
      combatantModel: createV3Model(),
    });

    assert.notEqual(firstPersonY, thirdPerson.position.y);
    assert.equal(thirdPerson.userData.v3FirstPersonSwayPhase, undefined);
  });
});
