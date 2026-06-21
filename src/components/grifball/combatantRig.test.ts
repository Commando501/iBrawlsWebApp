import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel, HelmetPreset, TorsoPreset, ArmPreset, LegPreset } from '../VoxelModels';
import { buildVoxelSpartanModelV2, getVoxelSegmentDataV2, verifyV2PartConstraints, getV2PartDimensions } from '../VoxelModelsV2';
import { animateCombatantWeaponMeshes, animateSpartanCombatantModel } from './combatantAnimation';
import { createCombatantMeshRig } from './combatantModels';
import { DEFAULT_HAMMER_SLAM_WINDUP_TIME } from '../../game/hammerSlamTiming';
import {
  COMBATANT_ATTACHMENT_POINT_NAMES,
  COMBATANT_BONE_NAMES,
  attachToAttachmentPoint,
  attachToCombatantAttachment,
  buildCombatantRigForModel,
  createFirstPersonWeaponRig,
  getV3WeaponMotionAnchor,
} from './combatantRig';
import { analyzeV3WeaponCarryAlignment } from './v3WeaponSocketBasis';

test('buildCombatantRigForModel maps voxel body parts into named bones', () => {
  const model = buildVoxelSpartanModel(false, 192);
  const rig = buildCombatantRigForModel(model);
  const segments = model.userData.segmentGroups as Record<string, THREE.Group>;

  assert.equal(rig.root, model);
  assert.equal(rig.bones.upperTorso, model.userData.upperTorso);
  assert.equal(rig.bones.lowerTorso, model.userData.lowerTorso);
  assert.equal(rig.bones.head, model.userData.head);
  assert.equal(rig.segmentGroups, segments);
  assert.equal(model.userData.articulationMode, 'group-pivot');
  assert.notEqual(rig.bones.leftArm, segments.leftArm);
  assert.equal(segments.leftArm.parent, rig.bones.leftArm);
  assert.equal(rig.bones.leftArm.userData.segmentGroup, segments.leftArm);
  assert.equal(model.userData.combatantRig, rig);
  assert.equal(model.userData.bones, rig.bones);
  assert.equal(model.userData.attachments, rig.attachments);
});

test('combatant bone controllers pose the visible voxel segments', () => {
  const model = buildVoxelSpartanModel(false, 192);
  const rig = buildCombatantRigForModel(model);
  const leftArmSegment = rig.segmentGroups.leftArm;

  model.updateWorldMatrix(true, true);
  const before = leftArmSegment.localToWorld(new THREE.Vector3(0, -0.4, 0));
  rig.bones.leftArm.rotation.z = 0.5;
  model.updateWorldMatrix(true, true);
  const after = leftArmSegment.localToWorld(new THREE.Vector3(0, -0.4, 0));

  assert.notEqual(before.x, after.x);
  assert.notEqual(before.y, after.y);
});

test('combatant rig exposes the expected editable bones and sockets', () => {
  const model = buildVoxelSpartanModel(false, 192);
  const rig = buildCombatantRigForModel(model);
  const camera = new THREE.Group();
  const firstPersonRig = createFirstPersonWeaponRig(camera);

  assert.deepEqual(Object.keys(rig.bones).sort(), [...COMBATANT_BONE_NAMES].sort());
  assert.deepEqual(Object.keys(rig.attachments).sort(), [
    'chestCenter',
    'headCenter',
    'leftHandGrip',
    'rightHandGrip',
    'thirdPersonOffhandGrip',
    'thirdPersonWeaponGrip',
  ]);
  assert.deepEqual(Object.keys(firstPersonRig.attachments).sort(), [
    'firstPersonOffhandGrip',
    'firstPersonWeaponGrip',
  ]);
  assert.ok(COMBATANT_ATTACHMENT_POINT_NAMES.includes('thirdPersonWeaponGrip'));
  assert.ok(COMBATANT_ATTACHMENT_POINT_NAMES.includes('rightHandGrip'));
  assert.ok(COMBATANT_ATTACHMENT_POINT_NAMES.includes('firstPersonWeaponGrip'));
  assert.equal(rig.attachments.rightHandGrip?.group.parent, rig.bones.rightArm);
  assert.equal(rig.attachments.leftHandGrip?.group.parent, rig.bones.leftArm);
});

test('third-person weapon grip is rigged to the right hand controller', () => {
  const model = buildVoxelSpartanModel(false, 192);
  const rig = buildCombatantRigForModel(model);
  const weapon = new THREE.Group();
  weapon.position.set(0.06, 0.42, -0.32);
  weapon.rotation.set(Math.PI / 2, 0, 0);

  attachToCombatantAttachment(model, 'thirdPersonWeaponGrip', weapon);

  const grip = rig.attachments.thirdPersonWeaponGrip;
  assert.ok(grip);
  assert.equal(grip.group.parent, rig.bones.rightArm);
  assert.equal(grip.bone, 'rightArm');
  assert.equal(weapon.parent, grip.group);
  assert.deepEqual(weapon.position.toArray(), [0.06, 0.42, -0.32]);
  assert.deepEqual(weapon.rotation.toArray().slice(0, 3), [Math.PI / 2, 0, 0]);

  model.updateWorldMatrix(true, true);
  const before = weapon.getWorldPosition(new THREE.Vector3());
  rig.bones.rightArm.rotation.x = 0.6;
  model.updateWorldMatrix(true, true);
  const after = weapon.getWorldPosition(new THREE.Vector3());

  assert.notEqual(before.y, after.y);
  assert.notEqual(before.z, after.z);
});

test('V3 combatant weapons attach to the chest motion anchor without changing legacy sockets', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });
  const grip = meshes.rig.attachments.thirdPersonWeaponGrip;
  const anchor = getV3WeaponMotionAnchor(meshes.group);
  const alignment = analyzeV3WeaponCarryAlignment(meshes.group, meshes.hammer, 'hammer');

  assert.ok(grip);
  assert.ok(anchor);
  assert.equal(anchor.parent, meshes.group.userData.v3DetailBones.chest);
  assert.equal(meshes.hammer.parent, anchor);
  assert.equal(meshes.sword.parent, anchor);
  assert.equal(meshes.pistol?.parent, anchor);
  assert.notEqual(meshes.hammer.parent, grip.group);
  assert.equal(meshes.hammer.userData.weaponType, 'hammer');
  assert.equal(meshes.hammer.userData.v3WeaponSocketBasis.socketName, 'thirdPersonPrimaryGrip');
  assert.ok(alignment.basisForwardAlignment > 0.95);
  assert.ok(alignment.basisUpAlignment > 0.98);
});

test('first-person weapon rig creates reusable grip lock points', () => {
  const camera = new THREE.Group();
  const rig = createFirstPersonWeaponRig(camera);
  const weapon = new THREE.Group();

  attachToAttachmentPoint(rig.attachments.firstPersonWeaponGrip, weapon);

  assert.equal(rig.container.parent, camera);
  assert.equal(rig.attachments.firstPersonWeaponGrip.group.parent, rig.container);
  assert.equal(rig.attachments.firstPersonOffhandGrip.group.parent, rig.container);
  assert.equal(weapon.parent, rig.attachments.firstPersonWeaponGrip.group);
});

test('third-person hammer animation poses hand-rigged arms with the weapon', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false);
  const weaponGrip = meshes.rig.attachments.thirdPersonWeaponGrip;

  assert.ok(weaponGrip);
  assert.equal(meshes.hammer.parent, weaponGrip.group);

  animateCombatantWeaponMeshes({
    hammerModel: meshes.hammer,
    swordModel: meshes.sword,
    activeWeapon: 'hammer',
    weaponState: 'swing_up',
    weaponTimer: DEFAULT_HAMMER_SLAM_WINDUP_TIME,
    isLunging: false,
    dt: 0,
    settings: {},
    combatantModel: meshes.group,
  });

  assert.equal(meshes.hammer.visible, true);
  assert.equal(meshes.sword.visible, false);
  assert.ok(meshes.rig.bones.rightArm.rotation.x < -1.0);
  assert.ok(meshes.rig.bones.leftArm.rotation.x < -0.7);
});

test('V1 ball punch animation swings the carrier arms without showing weapon meshes', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v1' });

  animateCombatantWeaponMeshes({
    hammerModel: meshes.hammer,
    swordModel: meshes.sword,
    activeWeapon: 'ball',
    weaponState: 'swing_down',
    weaponTimer: 0.06,
    isLunging: false,
    dt: 0,
    settings: { hammerMeleeSpeed: 0.24 },
    combatantModel: meshes.group,
  });

  assert.equal(meshes.hammer.visible, false);
  assert.equal(meshes.sword.visible, false);
  assert.ok(meshes.rig.bones.rightArm.rotation.x > 0.55);
  assert.ok(meshes.rig.bones.rightArm.rotation.y < -0.4);
});

test('V2 ball carriers do not receive the V1-only ball punch arm swing', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, {
    modelSystem: 'v2',
    modelType: 'medium',
  });

  animateCombatantWeaponMeshes({
    hammerModel: meshes.hammer,
    swordModel: meshes.sword,
    activeWeapon: 'ball',
    weaponState: 'swing_down',
    weaponTimer: 0.06,
    isLunging: false,
    dt: 0,
    settings: { hammerMeleeSpeed: 0.24 },
    combatantModel: meshes.group,
  });

  assert.equal(meshes.rig.bones.rightArm.rotation.x, 0);
  assert.equal(meshes.rig.bones.leftArm.rotation.x, 0);
});

test('V2 Model Hitbox Constraints Verification - validates all V1 armor presets', () => {
  const helmets: HelmetPreset[] = ['mark-vi', 'odst', 'recon', 'eva', 'gungnir', 'eod', 'hayabusa', 'cqb'];
  const torsos: TorsoPreset[] = ['mark-vi', 'scout', 'recon', 'eod', 'hayabusa'];
  const arms: ArmPreset[] = ['mark-vi', 'odst', 'recon', 'eod', 'hayabusa'];
  const legs: LegPreset[] = ['mark-vi', 'jump-jet', 'odst', 'eod', 'hayabusa'];

  const runValidation = (loadout: any) => {
    const model = buildVoxelSpartanModel(false, 200, {
      ...loadout,
      modelSystem: 'v2',
    });
    const u = model.userData;

    assert.ok(verifyV2PartConstraints(u.pelvisVoxels, 'pelvis'));
    assert.ok(verifyV2PartConstraints(u.stomachVoxels, 'stomach'));
    assert.ok(verifyV2PartConstraints(u.chestVoxels, 'chest'));
    assert.ok(verifyV2PartConstraints(u.neckVoxels, 'neck'));
    assert.ok(verifyV2PartConstraints(u.headVoxels, 'head'));

    assert.ok(verifyV2PartConstraints(u.shoulder_l_Voxels, 'shoulder_l'));
    assert.ok(verifyV2PartConstraints(u.arm_upper_l_Voxels, 'arm_upper_l'));
    assert.ok(verifyV2PartConstraints(u.arm_lower_l_Voxels, 'arm_lower_l'));
    assert.ok(verifyV2PartConstraints(u.hand_l_Voxels, 'hand_l'));

    assert.ok(verifyV2PartConstraints(u.shoulder_r_Voxels, 'shoulder_r'));
    assert.ok(verifyV2PartConstraints(u.arm_upper_r_Voxels, 'arm_upper_r'));
    assert.ok(verifyV2PartConstraints(u.arm_lower_r_Voxels, 'arm_lower_r'));
    assert.ok(verifyV2PartConstraints(u.hand_r_Voxels, 'hand_r'));

    assert.ok(verifyV2PartConstraints(u.leg_upper_l_Voxels, 'leg_upper_l'));
    assert.ok(verifyV2PartConstraints(u.leg_lower_l_Voxels, 'leg_lower_l'));
    assert.ok(verifyV2PartConstraints(u.foot_l_Voxels, 'foot_l'));
    assert.ok(verifyV2PartConstraints(u.toes_l_Voxels, 'toes_l'));

    assert.ok(verifyV2PartConstraints(u.leg_upper_r_Voxels, 'leg_upper_r'));
    assert.ok(verifyV2PartConstraints(u.leg_lower_r_Voxels, 'leg_lower_r'));
    assert.ok(verifyV2PartConstraints(u.foot_r_Voxels, 'foot_r'));
    assert.ok(verifyV2PartConstraints(u.toes_r_Voxels, 'toes_r'));
  };

  // Test all helmets
  for (const helmet of helmets) {
    runValidation({ helmet, torso: 'mark-vi', arm: 'mark-vi', leg: 'mark-vi' });
  }

  // Test all torsos
  for (const torso of torsos) {
    runValidation({ helmet: 'mark-vi', torso, arm: 'mark-vi', leg: 'mark-vi' });
  }

  // Test all arms
  for (const arm of arms) {
    runValidation({ helmet: 'mark-vi', torso: 'mark-vi', arm, leg: 'mark-vi' });
  }

  // Test all legs
  for (const leg of legs) {
    runValidation({ helmet: 'mark-vi', torso: 'mark-vi', arm: 'mark-vi', leg });
  }
});

test('large V2 model keeps the V2 skeleton while increasing armor footprint', () => {
  const medium = buildVoxelSpartanModelV2(false, 200, {
    modelSystem: 'v2',
    modelType: 'medium',
  } as any);
  const large = buildVoxelSpartanModelV2(false, 200, {
    modelSystem: 'v2',
    modelType: 'large',
  } as any);

  const expectedBones = [
    'pelvis',
    'stomach',
    'chest',
    'neck',
    'head',
    'shoulder_l',
    'arm_upper_l',
    'arm_lower_l',
    'hand_l',
    'shoulder_r',
    'arm_upper_r',
    'arm_lower_r',
    'hand_r',
    'leg_upper_l',
    'leg_lower_l',
    'foot_l',
    'toes_l',
    'leg_upper_r',
    'leg_lower_r',
    'foot_r',
    'toes_r',
  ];

  assert.equal(medium.userData.modelType, 'medium');
  assert.equal(large.userData.modelType, 'large');
  for (const bone of expectedBones) {
    assert.ok(medium.userData[bone], `medium missing ${bone}`);
    assert.ok(large.userData[bone], `large missing ${bone}`);
  }

  const mediumChest = getVoxelSegmentDataV2('torso', 'mark-vi', 200, false, 'medium' as any);
  const largeChest = getVoxelSegmentDataV2('torso', 'mark-vi', 200, false, 'large' as any);
  assert.ok(largeChest.length > mediumChest.length);

  medium.updateWorldMatrix(true, true);
  large.updateWorldMatrix(true, true);
  const mediumSize = new THREE.Box3().setFromObject(medium).getSize(new THREE.Vector3());
  const largeSize = new THREE.Box3().setFromObject(large).getSize(new THREE.Vector3());

  assert.ok(largeSize.x > mediumSize.x, `expected large width > ${mediumSize.x}, got ${largeSize.x}`);
  assert.ok(largeSize.y > mediumSize.y, `expected large height > ${mediumSize.y}, got ${largeSize.y}`);
  assert.ok(largeSize.z > mediumSize.z, `expected large depth > ${mediumSize.z}, got ${largeSize.z}`);
});

test('rigged V2 gameplay animation keeps rendered feet on the combatant root', () => {
  const refs = {
    scene: new THREE.Scene(),
    damageExplosionParticles: [],
  } as any;

  for (const modelType of ['medium', 'large'] as const) {
    const scene = new THREE.Scene();
    const meshes = createCombatantMeshRig(scene, 200, false, {
      modelSystem: 'v2',
      modelType,
    });

    for (let i = 0; i < 120; i++) {
      animateSpartanCombatantModel({
        refs,
        mesh: meshes.group,
        vel: new THREE.Vector3(0, 0, 0),
        yaw: 0,
        hp: 100,
        weaponState: 'ready',
        weaponTimer: 0,
        dt: 1 / 60,
      });
    }

    meshes.group.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(meshes.group);

    assert.ok(
      bounds.min.y < 0.08,
      `${modelType} V2 rig should not hover above root after animation, got bottom ${bounds.min.y.toFixed(3)}`
    );
    assert.ok(
      bounds.min.y > -0.12,
      `${modelType} V2 rig should not sink below root after animation, got bottom ${bounds.min.y.toFixed(3)}`
    );
  }
});

test('large V2 model builds every armor preset without exceeding part constraints', () => {
  const helmets: HelmetPreset[] = ['mark-vi', 'odst', 'recon', 'eva', 'gungnir', 'eod', 'hayabusa', 'cqb'];
  const torsos: TorsoPreset[] = ['mark-vi', 'scout', 'recon', 'eod', 'hayabusa'];
  const arms: ArmPreset[] = ['mark-vi', 'odst', 'recon', 'eod', 'hayabusa'];
  const legs: LegPreset[] = ['mark-vi', 'jump-jet', 'odst', 'eod', 'hayabusa'];

  for (const helmet of helmets) {
    assert.doesNotThrow(() => buildVoxelSpartanModel(false, 200, {
      modelSystem: 'v2',
      modelType: 'large',
      helmet,
      torso: 'mark-vi',
      arm: 'mark-vi',
      leg: 'mark-vi',
    }));
  }

  for (const torso of torsos) {
    assert.doesNotThrow(() => buildVoxelSpartanModel(false, 200, {
      modelSystem: 'v2',
      modelType: 'large',
      helmet: 'mark-vi',
      torso,
      arm: 'mark-vi',
      leg: 'mark-vi',
    }));
  }

  for (const arm of arms) {
    assert.doesNotThrow(() => buildVoxelSpartanModel(false, 200, {
      modelSystem: 'v2',
      modelType: 'large',
      helmet: 'mark-vi',
      torso: 'mark-vi',
      arm,
      leg: 'mark-vi',
    }));
  }

  for (const leg of legs) {
    assert.doesNotThrow(() => buildVoxelSpartanModel(false, 200, {
      modelSystem: 'v2',
      modelType: 'large',
      helmet: 'mark-vi',
      torso: 'mark-vi',
      arm: 'mark-vi',
      leg,
    }));
  }
});
