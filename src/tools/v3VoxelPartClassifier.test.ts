import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyV3ReferencePart } from './v3VoxelPartClassifier';

describe('classifyV3ReferencePart', () => {
  it('maps common armor names to V3 slot candidates', () => {
    assert.equal(classifyV3ReferencePart({ objectName: 'Helmet_Mark', materialNames: [] }).slot, 'helmet');
    assert.equal(classifyV3ReferencePart({ objectName: 'Left_Shoulder_Pad', materialNames: [] }).slot, 'shoulder');
    assert.equal(classifyV3ReferencePart({ objectName: 'Boot_R', materialNames: [] }).slot, 'foot');
    assert.equal(classifyV3ReferencePart({ objectName: 'Backpack', materialNames: [] }).slot, 'back');
  });

  it('uses group names when object names are generic', () => {
    const classified = classifyV3ReferencePart({
      objectName: 'Object_012',
      groupNames: ['Forearm_R'],
      materialNames: [],
    });

    assert.equal(classified.slot, 'forearm');
  });

  it('maps weapon names to weapon slot candidates', () => {
    assert.equal(classifyV3ReferencePart({ objectName: 'Gravity_Hammer_Handle', materialNames: [] }).slot, 'hammer');
    assert.equal(classifyV3ReferencePart({ objectName: 'Energy_Sword_Blade', materialNames: [] }).slot, 'sword');
    assert.equal(classifyV3ReferencePart({ objectName: 'Pistol_Frame', materialNames: [] }).slot, 'pistol');
  });

  it('maps material names to paint roles for developer review', () => {
    const classified = classifyV3ReferencePart({
      objectName: 'Chest',
      materialNames: ['undersuit_black', 'visor_gold', 'armor_primary'],
    });

    assert.deepEqual(classified.paintRoles, ['undersuit', 'visor', 'primary']);
  });

  it('deduplicates paint roles while preserving review order', () => {
    const classified = classifyV3ReferencePart({
      objectName: 'Shoulder',
      materialNames: ['trim_blue', 'accent_red', 'decal_star', 'trim_white'],
    });

    assert.deepEqual(classified.paintRoles, ['accent', 'decal']);
  });

  it('returns unknown slot and fixed paint role for unrecognized names', () => {
    const classified = classifyV3ReferencePart({
      objectName: 'DecorativeThing',
      materialNames: ['plain_metal'],
    });

    assert.equal(classified.slot, 'unknown');
    assert.deepEqual(classified.paintRoles, ['fixed']);
  });
});
