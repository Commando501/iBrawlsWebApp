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

  assert.equal(rig.root, model);
  assert.equal(rig.bones.upperTorso, model.userData.upperTorso);
  assert.equal(rig.bones.lowerTorso, model.userData.lowerTorso);
  assert.equal(rig.bones.head, model.userData.head);
  assert.equal(model.userData.combatantRig, rig);
  assert.equal(model.userData.bones, rig.bones);
  assert.equal(model.userData.attachments, rig.attachments);
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
    'thirdPersonOffhandGrip',
    'thirdPersonWeaponGrip',
  ]);
  assert.deepEqual(Object.keys(firstPersonRig.attachments).sort(), [
    'firstPersonOffhandGrip',
    'firstPersonWeaponGrip',
  ]);
  assert.ok(COMBATANT_ATTACHMENT_POINT_NAMES.includes('thirdPersonWeaponGrip'));
  assert.ok(COMBATANT_ATTACHMENT_POINT_NAMES.includes('firstPersonWeaponGrip'));
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
