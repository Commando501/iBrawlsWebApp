import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateV3ArmorFromFoundation } from '../components/v3/v3ArmorFoundation';
import {
  buildV3Mesh2MotionTPoseBindArmorSections,
  createV3Mesh2MotionTPoseBindArmorEdit,
  mirrorV3Mesh2MotionTPoseBindTransform,
  resolveV3Mesh2MotionTPoseBindMirrorSlot,
} from './v3Mesh2MotionTPoseBindArmor';

const voxelKey = (voxel: { x: number; y: number; z: number }): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

describe('v3Mesh2MotionTPoseBindArmor', () => {
  it('builds stable auto sections with full voxel coverage and no duplicate ownership', () => {
    const piece = generateV3ArmorFromFoundation({ slot: 'chest', now: 123 });
    const first = buildV3Mesh2MotionTPoseBindArmorSections(piece);
    const second = buildV3Mesh2MotionTPoseBindArmorSections(piece);
    const expectedKeys = new Set(piece.voxels.map(voxelKey));
    const coveredKeys = new Set<string>();

    assert.ok(first.length > 1);
    assert.deepEqual(first.map((section) => section.id), second.map((section) => section.id));
    assert.deepEqual(first.map((section) => section.label), second.map((section) => section.label));

    for (const section of first) {
      assert.equal(section.slot, 'chest');
      assert.ok(section.bounds.voxelCount > 0);
      assert.ok(section.bounds.roles.length > 0);
      assert.deepEqual(section.bounds.size.map((value) => Number.isFinite(value)), [true, true, true]);
      for (const key of section.voxelKeys) {
        assert.equal(expectedKeys.has(key), true, `${key} should belong to the regenerated piece`);
        assert.equal(coveredKeys.has(key), false, `${key} should not be owned by more than one section`);
        coveredKeys.add(key);
      }
    }

    assert.equal(coveredKeys.size, expectedKeys.size);
  });

  it('keeps section IDs symmetric for paired slots', () => {
    const left = buildV3Mesh2MotionTPoseBindArmorSections(
      generateV3ArmorFromFoundation({ slot: 'forearmLeft', now: 123 })
    );
    const right = buildV3Mesh2MotionTPoseBindArmorSections(
      generateV3ArmorFromFoundation({ slot: 'forearmRight', now: 123 })
    );

    assert.ok(left.length > 1);
    assert.deepEqual(left.map((section) => section.id), right.map((section) => section.id));
  });

  it('creates identity section transforms for regenerated bind-editor armor edits', () => {
    const piece = generateV3ArmorFromFoundation({ slot: 'helmet', now: 123 });
    const edit = createV3Mesh2MotionTPoseBindArmorEdit(piece);

    assert.equal(edit.slot, 'helmet');
    assert.deepEqual(edit.piece, piece);
    assert.ok(edit.sections.length > 1);
    assert.deepEqual(Object.keys(edit.sectionTransforms).sort(), edit.sections.map((section) => section.id).sort());
    for (const section of edit.sections) {
      assert.deepEqual(edit.sectionTransforms[section.id], {
        sectionId: section.id,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
    }
  });

  it('resolves paired armor slots and mirrors transforms across the character centerline', () => {
    assert.equal(resolveV3Mesh2MotionTPoseBindMirrorSlot('upperArmLeft'), 'upperArmRight');
    assert.equal(resolveV3Mesh2MotionTPoseBindMirrorSlot('upperArmRight'), 'upperArmLeft');
    assert.equal(resolveV3Mesh2MotionTPoseBindMirrorSlot('helmet'), null);

    assert.deepEqual(mirrorV3Mesh2MotionTPoseBindTransform({
      sectionId: 'front',
      position: [0.2, -0.1, 0.3],
      rotation: [0.4, -0.5, 0.6],
      scale: [1.1, 0.9, 1.2],
    }), {
      sectionId: 'front',
      position: [-0.2, -0.1, 0.3],
      rotation: [0.4, 0.5, -0.6],
      scale: [1.1, 0.9, 1.2],
    });
  });
});
