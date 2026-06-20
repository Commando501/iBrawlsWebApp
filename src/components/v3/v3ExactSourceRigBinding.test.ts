import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3ModelTypes';
import {
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';
import {
  analyzeV3RigContinuity,
  applyV3ExactSourceRigBinding,
  deriveV3ExactSourceRigBinding,
} from './v3ExactSourceRigBinding';

const finiteTuple = (value: readonly number[]): boolean =>
  value.length === 3 && value.every((entry) => Number.isFinite(entry));

const roundedTuple = (value: readonly number[]): [number, number, number] => [
  Number(value[0].toFixed(6)),
  Number(value[1].toFixed(6)),
  Number(value[2].toFixed(6)),
];

const expectedSlotCenterWorld = (slot: V3CharacterSlotId): [number, number, number] => {
  const source = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;
  const bounds = source.slots[slot].bounds;
  const pivot = source.coordinateSystem.pivot;
  const scale = source.coordinateSystem.voxelScale;

  return roundedTuple([
    (((bounds.min[0] + bounds.max[0]) / 2) - pivot[0]) * scale,
    ((bounds.min[1] + bounds.max[1]) / 2) * scale,
    (((bounds.min[2] + bounds.max[2]) / 2) - pivot[2]) * scale,
  ]);
};

const expectedOffsetFromBone = (slot: V3CharacterSlotId): [number, number, number] => {
  const center = expectedSlotCenterWorld(slot);
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  const bonePosition = V3_DETAIL_BONE_SPECS[boneName].position;

  return roundedTuple([
    center[0] - bonePosition[0],
    center[1] - bonePosition[1],
    center[2] - bonePosition[2],
  ]);
};

const createModelWithPartGroups = (): {
  model: THREE.Group;
  partGroups: Record<V3CharacterSlotId, THREE.Group>;
  detailBones: Record<V3DetailBoneName, THREE.Group>;
} => {
  const model = new THREE.Group();
  const partGroups = {} as Record<V3CharacterSlotId, THREE.Group>;
  const detailBones = {} as Record<V3DetailBoneName, THREE.Group>;

  for (const boneName of Object.values(V3_SLOT_DETAIL_BONES)) {
    if (!detailBones[boneName]) {
      const bone = new THREE.Group();
      bone.name = `v3bone:${boneName}`;
      bone.userData.v3DetailBoneName = boneName;
      detailBones[boneName] = bone;
      model.add(bone);
    }
  }

  for (const [index, slot] of V3_CHARACTER_SLOT_IDS.entries()) {
    const part = new THREE.Group();
    part.name = `v3:${slot}`;
    part.userData.v3Slot = slot;
    part.position.set(index / 100, index / 200, -index / 300);
    detailBones[V3_SLOT_DETAIL_BONES[slot]].add(part);
    partGroups[slot] = part;
  }

  model.userData.v3PartGroups = partGroups;
  model.userData.v3DetailBones = detailBones;
  return { model, partGroups, detailBones };
};

describe('V3 exact-source rig binding', () => {
  it('derives deterministic detail-bone bindings from accepted slot bounds without mutating the source', () => {
    const before = JSON.stringify(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE);
    const binding = deriveV3ExactSourceRigBinding();
    const repeated = deriveV3ExactSourceRigBinding();

    assert.deepEqual(binding, repeated);
    assert.equal(JSON.stringify(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE), before);
    assert.equal(binding.kind, 'v3-exact-source-rig-binding');
    assert.equal(binding.version, 1);
    assert.equal(binding.sourceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);
    assert.deepEqual(Object.keys(binding.slots), [...V3_CHARACTER_SLOT_IDS].sort());

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const slotBinding = binding.slots[slot];
      assert.equal(slotBinding.slot, slot);
      assert.equal(slotBinding.detailBone, V3_SLOT_DETAIL_BONES[slot]);
      assert.deepEqual(slotBinding.bounds, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot].bounds);
      assert.equal(finiteTuple(slotBinding.sourceCenterWorld), true);
      assert.equal(finiteTuple(slotBinding.offsetFromDetailBone), true);
      assert.equal(finiteTuple(slotBinding.attachmentOffset), true);
    }

    assert.deepEqual(binding.slots.helmet.sourceCenterWorld, expectedSlotCenterWorld('helmet'));
    assert.deepEqual(binding.slots.helmet.offsetFromDetailBone, expectedOffsetFromBone('helmet'));
  });

  it('applies binding metadata to a V3 model without changing body geometry or part transforms', () => {
    const { model, partGroups } = createModelWithPartGroups();
    const beforeTransforms = Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
      slot,
      {
        position: partGroups[slot].position.toArray(),
        rotation: partGroups[slot].rotation.toArray(),
        scale: partGroups[slot].scale.toArray(),
        childCount: partGroups[slot].children.length,
      },
    ]));

    const binding = applyV3ExactSourceRigBinding(model);

    assert.equal(model.userData.v3ExactSourceRigBinding, binding);
    assert.deepEqual(
      model.userData.v3AttachmentOffsets.thirdPersonWeaponGrip,
      binding.slots.handRight.attachmentOffset
    );
    assert.deepEqual(
      model.userData.v3AttachmentOffsets.thirdPersonOffhandGrip,
      binding.slots.handLeft.attachmentOffset
    );
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.deepEqual(partGroups[slot].position.toArray(), beforeTransforms[slot].position);
      assert.deepEqual(partGroups[slot].rotation.toArray(), beforeTransforms[slot].rotation);
      assert.deepEqual(partGroups[slot].scale.toArray(), beforeTransforms[slot].scale);
      assert.equal(partGroups[slot].children.length, beforeTransforms[slot].childCount);
      assert.equal(partGroups[slot].userData.v3ExactSourceRigBinding, binding.slots[slot]);
      assert.equal(partGroups[slot].userData.v3ExactSourceOffsetFromDetailBone, binding.slots[slot].offsetFromDetailBone);
    }
  });

  it('analyzes model continuity from exact-source bindings and reports missing rig seams', () => {
    const { model } = createModelWithPartGroups();
    applyV3ExactSourceRigBinding(model);

    const ready = analyzeV3RigContinuity(model);
    assert.equal(ready.ready, true);
    assert.deepEqual(ready.issues, []);
    assert.equal(ready.boundSlotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(Number.isFinite(ready.maxAttachmentOffsetMagnitude), true);
    assert.equal(ready.slots.helmet.ready, true);

    const empty = analyzeV3RigContinuity(new THREE.Group());
    assert.equal(empty.ready, false);
    assert.ok(empty.issues.includes('model is missing v3ExactSourceRigBinding metadata'));
    assert.ok(empty.issues.includes('model is missing v3DetailBones metadata'));
    assert.ok(empty.issues.includes('model is missing v3PartGroups metadata'));
  });
});
