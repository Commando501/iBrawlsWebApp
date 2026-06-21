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
  animateV3WeaponMeshes,
  getFirstPersonV3WeaponPose,
  getV3BodyMaskForLayer,
} from './combatantAnimationV3';
import { createCombatantMeshRig } from './combatantModels';
import {
  sampleV3FirstPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3WeaponCarryPose,
} from './v3AnimationFidelity';
import {
  analyzeV3WeaponCarryAlignment,
  getV3WeaponSocketBasisVisualRoot,
} from './v3WeaponSocketBasis';
import { getV3LowerBodySeamAnchorPair } from './v3LowerBodyContinuity';
import { createInitialGrifballThreeRefs } from './threeRefs';

const createV3Model = () => {
  const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
  buildCombatantRigForModel(model);
  return model;
};

const lowerBodyGroupNames = ['lowerTorso', 'leftLeg', 'rightLeg'] as const;
const lowerDetailBoneNames = [
  'thighLeft',
  'calfLeft',
  'footLeft',
  'toeLeft',
  'thighRight',
  'calfRight',
  'footRight',
  'toeRight',
] as const;

const finiteTransformValues = (group: THREE.Group) => [
  group.position.x,
  group.position.y,
  group.position.z,
  group.rotation.x,
  group.rotation.y,
  group.rotation.z,
];

const assertFiniteTransform = (group: THREE.Group, label: string) => {
  assert.equal(finiteTransformValues(group).every(Number.isFinite), true, `${label} transform must stay finite`);
};

const assertRotationRange = (group: THREE.Group, label: string, maxRadians = 1.35) => {
  for (const value of [group.rotation.x, group.rotation.y, group.rotation.z]) {
    assert.equal(Math.abs(value) <= maxRadians, true, `${label} rotation ${value} exceeded readable range`);
  }
};

const assertWorldYAbove = (group: THREE.Group, label: string, minimumY: number) => {
  const worldPosition = new THREE.Vector3();
  group.getWorldPosition(worldPosition);
  assert.equal(Number.isFinite(worldPosition.y), true, `${label} world y must stay finite`);
  assert.equal(worldPosition.y >= minimumY, true, `${label} world y ${worldPosition.y} dropped below floor-safe range`);
};

const getWorldBoxCenter = (object: THREE.Object3D): THREE.Vector3 =>
  new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

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

    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    assert.notEqual(detailBones.chest.rotation.x, 0);
    assert.notEqual(detailBones.upperArmRight.rotation.x, 0);
    assert.notEqual(detailBones.upperArmLeft.rotation.x, 0);
    assert.equal(model.userData.v3RetargetedClip?.clipId, 'walk');
    assert.notEqual(detailBones.thighLeft.rotation.x, 0);
    assert.notEqual(detailBones.thighRight.rotation.x, 0);
  });

  it('keeps lower-body locomotion active during sword lunge upper-body animation', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'sword',
      weaponState: 'swing_up',
      weaponTimer: 0.12,
      dt: 1,
      isLunging: true,
      settings: {},
    });

    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    assert.notEqual(detailBones.chest.rotation.x, 0);
    assert.notEqual(detailBones.upperArmRight.rotation.x, 0);
    assert.notEqual(model.userData.leftLeg.rotation.x, 0);
    assert.notEqual(model.userData.rightLeg.rotation.x, 0);
  });

  it('drives V3 detail bones for higher fidelity upper and lower body layers', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;

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

    assert.notEqual(detailBones.chest.rotation.y, 0);
    assert.notEqual(detailBones.forearmRight.rotation.x, 0);
    assert.notEqual(detailBones.handLeft.rotation.x, 0);
    assert.notEqual(detailBones.thighLeft.rotation.x, 0);
    assert.notEqual(detailBones.thighRight.rotation.x, 0);
    assert.equal(model.userData.v3RetargetedClip?.clipId, 'walk');
    assert.notEqual(detailBones.footLeft.rotation.x, 0);
  });

  it('supports exact absolute Mixamo weapon pose sampling for atlas review', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const settings = {
      hammerAttackAnimation: 'highFidelity',
      hammerSlamWindupTime: 0.45,
      hammerSlamAttackTime: 0.3,
      hammerReloadTime: 0.6,
      hammerMeleeSpeed: 0.24,
      swordSlashSpeed: 0.22,
    } as const;
    const weaponTimer = 0.235;
    const expected = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer,
      isLunging: false,
      settings,
    });
    const expectedChest = expected.detailBoneQuaternions?.chest;
    assert.ok(expectedChest, 'hammer windup should provide a retargeted chest quaternion');

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer,
      dt: 1 / 60,
      settings,
      animationClockMs: 522,
      isLocalV3Animation: true,
      v3PoseAlphaOverride: 1,
    });

    assert.ok(
      detailBones.chest.quaternion.angleTo(new THREE.Quaternion(...expectedChest)) < 0.003,
      'exact review pose should not be softened by frame dt smoothing'
    );
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

  it('layers V3 weapon carry over Mixamo locomotion without flattening lower-body motion', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const model = createV3Model();
      const refs = createInitialGrifballThreeRefs();
      const expectedCarry = sampleV3WeaponCarryPose(weapon);

      animateV3CombatantModel({
        refs,
        mesh: model,
        vel: new THREE.Vector3(3, 0, 0),
        yaw: 0,
        hp: 100,
        activeWeapon: weapon,
        weaponState: 'ready',
        weaponTimer: 0,
        dt: 1,
        settings: {},
      });

      const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
      assert.equal(model.userData.v3RetargetedClip?.clipId, 'walk');
      assert.notEqual(detailBones.thighLeft.rotation.x, 0, `${weapon} carry should preserve Mixamo thigh motion`);
      assert.notEqual(detailBones.calfLeft.rotation.x, 0, `${weapon} carry should preserve Mixamo calf motion`);
      assert.deepEqual(
        model.userData.v3WeaponCarry?.weapon,
        weapon,
        `${weapon} carry metadata should be stored on the model`
      );
      if (expectedCarry.upperBodyPose.detailBoneQuaternions?.chest) {
        assert.ok(
          detailBones.chest.quaternion.angleTo(new THREE.Quaternion(...expectedCarry.upperBodyPose.detailBoneQuaternions.chest)) < 0.003,
          `${weapon} chest detail bone should use carry pose`
        );
      } else {
        assert.ok(
          Math.abs(model.userData.upperTorso.rotation.x - expectedCarry.upperBodyPose.upperTorsoRotation[0]) < 0.001,
          `${weapon} upper torso should use carry pose`
        );
      }
    }
  });

  it('keeps V3 carry grips pinned to the right hand without tearing the left arm from the shoulder', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const scene = new THREE.Scene();
      const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });
      const parts = meshes.group.userData.v3PartGroups as Record<string, THREE.Group>;
      const restingLeftShoulderDistance = getWorldBoxCenter(parts.shoulderLeft)
        .distanceTo(getWorldBoxCenter(parts.upperArmLeft));

      animateV3CombatantModel({
        refs: createInitialGrifballThreeRefs(),
        mesh: meshes.group,
        vel: new THREE.Vector3(0, 0, 0),
        yaw: 0,
        hp: 100,
        activeWeapon: weapon,
        weaponState: 'ready',
        weaponTimer: 0,
        dt: 1,
        settings: {},
        animationClockMs: 0,
        isLocalV3Animation: true,
      });
      animateV3WeaponMeshes({
        hammerModel: meshes.hammer,
        swordModel: meshes.sword,
        pistolModel: meshes.pistol,
        activeWeapon: weapon,
        weaponState: 'ready',
        weaponTimer: 0,
        isLunging: false,
        dt: 1,
        settings: {},
        combatantModel: meshes.group,
      });
      meshes.group.updateWorldMatrix(true, true);

      const weaponModel = weapon === 'hammer'
        ? meshes.hammer
        : weapon === 'sword'
          ? meshes.sword
          : meshes.pistol;
      const alignment = analyzeV3WeaponCarryAlignment(meshes.group, weaponModel, weapon);
      const leftShoulderDistance = getWorldBoxCenter(parts.shoulderLeft)
        .distanceTo(getWorldBoxCenter(parts.upperArmLeft));

      assert.ok(
        alignment.primaryGripDrift < 0.025,
        `${weapon} carry primary grip drift ${alignment.primaryGripDrift} should stay pinned to the right hand`
      );
      if (weapon === 'hammer') {
        const gripReport = meshes.group.userData.v3WeaponGripConstraintReport;
        assert.equal(gripReport?.ready, true, 'hammer carry grip constraints should solve');
        assert.equal(gripReport?.reachClampCount, 0, 'hammer carry should not require IK reach clamping');
        assert.ok(
          (alignment.offhandGripDrift ?? Number.POSITIVE_INFINITY) < 0.055,
          `hammer carry offhand drift ${alignment.offhandGripDrift} should lock to the left hand`
        );
        assert.ok(
          leftShoulderDistance < 0.5,
          `hammer carry left shoulder distance ${leftShoulderDistance} should remain visually connected`
        );
      } else {
        assert.ok(
          leftShoulderDistance < restingLeftShoulderDistance + 0.12,
          `${weapon} carry left shoulder distance ${leftShoulderDistance} should not tear away from rest ${restingLeftShoulderDistance}`
        );
      }
    }
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

  it('resets V3 detail bones on death', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    model.userData.lowerTorso.position.y = -0.18;
    model.userData.upperTorso.rotation.set(1, 1, 1);
    model.userData.leftLeg.rotation.set(1, 1, 1);
    detailBones.spine2.rotation.set(0.2, -0.3, 0.1);
    detailBones.forearmRight.rotation.set(-0.4, 0.1, -0.2);
    detailBones.calfLeft.rotation.set(0.5, 0, 0);
    detailBones.toeRight.rotation.set(0.2, 0, 0);

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

    assert.equal(model.userData.lowerTorso.position.y, 0);
    for (const groupName of ['upperTorso', 'leftLeg'] as const) {
      assert.deepEqual(model.userData[groupName].rotation.toArray().slice(0, 3), [0, 0, 0]);
    }
    for (const [name, bone] of Object.entries(detailBones)) {
      assert.deepEqual(bone.rotation.toArray().slice(0, 3), [0, 0, 0], `${name} should reset on death`);
    }
  });

  it('keeps slide and sprint lower-body transforms finite and floor-safe', () => {
    const cases = [
      { label: 'slide', isSliding: true, isSprinting: false },
      { label: 'sprint', isSliding: false, isSprinting: true },
    ];

    for (const mode of cases) {
      const model = createV3Model();
      const refs = createInitialGrifballThreeRefs();
      const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;

      animateV3CombatantModel({
        refs,
        mesh: model,
        vel: new THREE.Vector3(4, 0, 0),
        yaw: 0,
        hp: 100,
        activeWeapon: 'hammer',
        weaponState: 'ready',
        weaponTimer: 0,
        dt: 1,
        isSliding: mode.isSliding,
        isSprinting: mode.isSprinting,
        settings: {},
      });
      model.updateMatrixWorld(true);

      for (const groupName of lowerBodyGroupNames) {
        const group = model.userData[groupName] as THREE.Group;
        assertFiniteTransform(group, `${mode.label} ${groupName}`);
        assertRotationRange(group, `${mode.label} ${groupName}`);
        assertWorldYAbove(group, `${mode.label} ${groupName}`, -0.2);
      }

      for (const boneName of lowerDetailBoneNames) {
        const bone = detailBones[boneName];
        assertFiniteTransform(bone, `${mode.label} ${boneName}`);
        assertRotationRange(bone, `${mode.label} ${boneName}`);
        assertWorldYAbove(bone, `${mode.label} ${boneName}`, -0.2);
      }
      assert.equal(model.userData.lowerTorso.position.y >= -0.2, true);
    }
  });

  it('only shows lower-body joint bridges during the V3 single-chain walk path', () => {
    const refs = createInitialGrifballThreeRefs();
    const isBridgeRootVisible = (model: THREE.Group): boolean => (
      model.userData.v3LowerBodyJointBridges?.root?.visible === true
    );

    const idleModel = createV3Model();
    animateV3CombatantModel({
      refs,
      mesh: idleModel,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      settings: {},
    });
    assert.equal(isBridgeRootVisible(idleModel), false, 'idle should keep lower-body bridges hidden');

    const walkModel = createV3Model();
    animateV3CombatantModel({
      refs,
      mesh: walkModel,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      settings: {},
    });
    assert.equal(isBridgeRootVisible(walkModel), true, 'walk should show lower-body bridges');

    const sprintModel = createV3Model();
    animateV3CombatantModel({
      refs,
      mesh: sprintModel,
      vel: new THREE.Vector3(4, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      isSprinting: true,
      settings: {},
    });
    assert.equal(isBridgeRootVisible(sprintModel), true, 'retargeted run should show lower-body bridges');
  });

  it('covers torso-pelvis and pelvis-thigh walk seams with readable undersuit bridges', () => {
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
      dt: 1,
      settings: {},
    });

    const bridgeSet = model.userData.v3LowerBodyJointBridges;
    assert.ok(bridgeSet?.bridges?.['lowerTorso-pelvis'], 'walk needs a lower torso to pelvis bridge');
    assert.equal(bridgeSet.bridges['lowerTorso-pelvis'].visible, true);
    assert.equal(bridgeSet.bridges['pelvis-thigh-left'].visible, true);
    assert.equal(bridgeSet.bridges['pelvis-thigh-right'].visible, true);
    assert.ok(
      bridgeSet.bridges['lowerTorso-pelvis'].scale.x >= 0.32,
      'torso/pelvis bridge should be wide enough to read as undersuit, not a thin connector'
    );
    assert.ok(
      bridgeSet.bridges['pelvis-thigh-left'].scale.x >= 0.14,
      'pelvis/thigh bridge should cover the hip seam instead of leaving a visible tear'
    );
    assert.ok(
      bridgeSet.bridges['pelvis-thigh-right'].scale.x >= 0.14,
      'pelvis/thigh bridge should cover the hip seam instead of leaving a visible tear'
    );
  });

  it('keeps walk bridge meshes centered on seam anchors when atlas views rotate the model', () => {
    const model = createV3Model();
    const refs = createInitialGrifballThreeRefs();
    model.rotation.y = Math.PI / 2;

    animateV3CombatantModel({
      refs,
      mesh: model,
      vel: new THREE.Vector3(3, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1,
      settings: {},
    });
    model.updateWorldMatrix(true, true);

    for (const linkId of ['lowerTorso-pelvis', 'pelvis-thigh-left', 'pelvis-thigh-right']) {
      const bridge = model.userData.v3LowerBodyJointBridges.bridges[linkId] as THREE.Mesh;
      const anchors = getV3LowerBodySeamAnchorPair(model, linkId);
      assert.ok(anchors, `${linkId} should expose seam anchors`);
      const midpoint = anchors.from.clone().add(anchors.to).multiplyScalar(0.5);
      const bridgeWorld = bridge.getWorldPosition(new THREE.Vector3());
      assert.ok(
        bridgeWorld.distanceTo(midpoint) < 0.02,
        `${linkId} bridge should stay on its seam midpoint in rotated atlas views`
      );
    }
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
    assert.equal(model.userData.v3RetargetedClip?.clipId, 'walk');
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    assert.notEqual(detailBones.thighLeft.rotation.x, 0);
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
    const firstRemotePhase = remoteModel.userData.v3RetargetedLocomotionSeconds;
    const firstRemoteBreath = remoteModel.userData.v3BreathingPhase;
    animateSpartanCombatantModel({
      ...baseInput,
      mesh: remoteModel,
      animationClockMs: 20,
      isLocalV3Animation: false,
    });
    assert.equal(remoteModel.userData.v3RetargetedLocomotionSeconds, firstRemotePhase);
    assert.equal(remoteModel.userData.v3BreathingPhase, firstRemoteBreath);

    animateSpartanCombatantModel({
      ...baseInput,
      mesh: localModel,
      animationClockMs: 0,
      isLocalV3Animation: true,
    });
    const firstLocalPhase = localModel.userData.v3RetargetedLocomotionSeconds;
    animateSpartanCombatantModel({
      ...baseInput,
      mesh: localModel,
      animationClockMs: 20,
      isLocalV3Animation: true,
    });
    assert.notEqual(localModel.userData.v3RetargetedLocomotionSeconds, firstLocalPhase);
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
    const phaseBeforeHit = model.userData.v3RetargetedLocomotionSeconds;

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

    assert.equal(model.userData.v3RetargetedLocomotionSeconds > phaseBeforeHit, true);
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
    assert.equal(pistol.userData.v3WeaponSocketBasis.socketName, 'thirdPersonPrimaryGrip');
    assert.ok(getV3WeaponSocketBasisVisualRoot(pistol));
  });

  it('preserves the inner V3 socket basis root while animating third-person weapon poses', () => {
    const hammer = buildV3HammerModel(192);

    animateCombatantWeaponMeshes({
      hammerModel: hammer,
      swordModel: buildV3SwordModel(192),
      pistolModel: buildV3PistolModel(192),
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.18,
      isLunging: false,
      dt: 1,
      settings: { hammerAttackAnimation: 'highFidelity' },
      combatantModel: createV3Model(),
    });
    const visualRoot = getV3WeaponSocketBasisVisualRoot(hammer);
    const animatedRotation = hammer.rotation.x;

    animateCombatantWeaponMeshes({
      hammerModel: hammer,
      swordModel: null,
      pistolModel: null,
      activeWeapon: 'hammer',
      weaponState: 'swing_down',
      weaponTimer: 0.08,
      isLunging: false,
      dt: 1,
      settings: { hammerAttackAnimation: 'highFidelity' },
      combatantModel: createV3Model(),
    });

    assert.equal(getV3WeaponSocketBasisVisualRoot(hammer), visualRoot);
    assert.notEqual(hammer.rotation.x, animatedRotation);
    assert.equal(hammer.userData.v3WeaponSocketBasis.socketName, 'thirdPersonPrimaryGrip');
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
    assert.equal(pistol.userData.v3WeaponSocketBasis.socketName, 'firstPersonPrimaryGrip');
    assert.equal(thirdPerson.userData.v3WeaponSocketBasis.socketName, 'thirdPersonPrimaryGrip');
  });
});
