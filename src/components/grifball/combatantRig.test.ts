import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel } from '../VoxelModels';
import {
  COMBATANT_ATTACHMENT_POINT_NAMES,
  COMBATANT_BONE_NAMES,
  attachToAttachmentPoint,
  attachToCombatantAttachment,
  buildCombatantRigForModel,
  createFirstPersonWeaponRig,
} from './combatantRig';

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

test('third-person weapon grip is an identity lock point under the upper torso', () => {
  const model = buildVoxelSpartanModel(false, 192);
  const rig = buildCombatantRigForModel(model);
  const weapon = new THREE.Group();
  weapon.position.set(0.5, 0.36, -0.4);
  weapon.rotation.set(Math.PI / 2, 0, 0);

  attachToCombatantAttachment(model, 'thirdPersonWeaponGrip', weapon);

  const grip = rig.attachments.thirdPersonWeaponGrip;
  assert.ok(grip);
  assert.equal(grip.group.parent, model.userData.upperTorso);
  assert.equal(weapon.parent, grip.group);
  assert.deepEqual(weapon.position.toArray(), [0.5, 0.36, -0.4]);
  assert.deepEqual(weapon.rotation.toArray().slice(0, 3), [Math.PI / 2, 0, 0]);
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
