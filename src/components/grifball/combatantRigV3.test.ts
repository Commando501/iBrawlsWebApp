import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { buildCombatantRigForModel } from './combatantRig';
import {
  getV3AttachmentOffset,
  mapV3SocketNameToCombatantAttachment,
} from './combatantRigV3';

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
});
