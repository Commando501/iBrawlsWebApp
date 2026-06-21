import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  buildV3HammerModel,
  buildV3PistolModel,
  buildV3SpartanModel,
  buildV3SwordModel,
} from '../v3/VoxelModelsV3';
import { buildCombatantRigForModel } from './combatantRig';
import {
  getV3AttachmentOffset,
  mapV3SocketNameToCombatantAttachment,
} from './combatantRigV3';
import {
  applyV3WeaponSocketBasis,
  deriveV3WeaponSocketBasis,
} from './v3WeaponSocketBasis';

const dot = (a: THREE.Vector3, b: THREE.Vector3): number => a.clone().normalize().dot(b.clone().normalize());
const localAxis = (object: THREE.Object3D, axis: THREE.Vector3): THREE.Vector3 =>
  axis.clone().applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize();

describe('combatantRigV3', () => {
  it('maps manifest socket names onto existing combatant attachments', () => {
    assert.equal(mapV3SocketNameToCombatantAttachment('thirdPersonPrimaryGrip'), 'thirdPersonWeaponGrip');
    assert.equal(mapV3SocketNameToCombatantAttachment('thirdPersonOffhandGrip'), 'thirdPersonOffhandGrip');
    assert.equal(mapV3SocketNameToCombatantAttachment('firstPersonPrimaryGrip'), 'firstPersonWeaponGrip');
    assert.equal(mapV3SocketNameToCombatantAttachment('firstPersonOffhandGrip'), 'firstPersonOffhandGrip');
  });

  it('builds broad compatibility rig attachments from V3 hand groups', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const rig = buildCombatantRigForModel(model);

    assert.equal(rig.attachments.thirdPersonWeaponGrip?.group.parent, model.userData.handRight);
    assert.equal(rig.attachments.thirdPersonOffhandGrip?.group.parent, model.userData.handLeft);
    assert.ok(getV3AttachmentOffset(model, 'thirdPersonWeaponGrip'));
  });

  it('preserves V3 detail bones on the shared combatant rig', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const rig = buildCombatantRigForModel(model);

    assert.equal(rig.detailBones?.spine1, model.userData.v3DetailBones.spine1);
    assert.equal(rig.detailBones?.forearmRight, model.userData.v3DetailBones.forearmRight);
    assert.equal(rig.detailBones?.calfLeft, model.userData.v3DetailBones.calfLeft);
    assert.equal(rig.detailBones?.gripRight, model.userData.v3DetailBones.gripRight);
    assert.equal(model.userData.detailBones, rig.detailBones);
  });

  it('derives third-person weapon socket bases from manifest grips and canonical axes', () => {
    const cases = [
      { weapon: 'hammer' as const, model: buildV3HammerModel(192), semanticForward: new THREE.Vector3(0, 1, 0) },
      { weapon: 'sword' as const, model: buildV3SwordModel(192), semanticForward: new THREE.Vector3(0, 1, 0) },
      { weapon: 'pistol' as const, model: buildV3PistolModel(192), semanticForward: new THREE.Vector3(1, 0, 0) },
    ];

    for (const testCase of cases) {
      const basis = deriveV3WeaponSocketBasis(testCase.model, testCase.weapon, 'thirdPersonPrimaryGrip');

      assert.equal(basis.weapon, testCase.weapon);
      assert.equal(basis.socketName, 'thirdPersonPrimaryGrip');
      assert.ok(basis.primaryGripLocalPosition.length() < 1e-6, `${testCase.weapon} primary grip at origin`);
      assert.ok(dot(basis.basisForward, new THREE.Vector3(0, 0, -1)) > 0.98, `${testCase.weapon} forward`);
      assert.ok(dot(basis.basisUp, new THREE.Vector3(0, 1, 0)) > 0.98, `${testCase.weapon} up`);
    }
  });

  it('applies socket basis on an inner visual root while preserving the animated weapon root', () => {
    const sword = buildV3SwordModel(192);
    const originalChildren = [...sword.children];

    const first = applyV3WeaponSocketBasis(sword, 'sword', 'thirdPersonPrimaryGrip');
    const second = applyV3WeaponSocketBasis(sword, 'sword', 'thirdPersonPrimaryGrip');

    assert.equal(first.visualRoot, second.visualRoot);
    assert.equal(sword.position.length(), 0);
    assert.equal(sword.rotation.x, 0);
    assert.equal(first.visualRoot.parent, sword);
    assert.equal(originalChildren.every((child) => child.parent === first.visualRoot), true);
    assert.equal(sword.userData.v3WeaponSocketBasis.socketName, 'thirdPersonPrimaryGrip');
    assert.ok(dot(localAxis(first.visualRoot, new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 0, -1)) > 0.9);

    const firstPerson = applyV3WeaponSocketBasis(sword, 'sword', 'firstPersonPrimaryGrip');
    assert.equal(firstPerson.visualRoot, first.visualRoot);
    assert.equal(sword.userData.v3WeaponSocketBasis.socketName, 'firstPersonPrimaryGrip');
  });
});
