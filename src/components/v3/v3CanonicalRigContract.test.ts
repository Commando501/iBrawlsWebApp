import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3ModelTypes';
import {
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';
import {
  analyzeV3CanonicalRigContract,
  applyV3CanonicalRigContract,
  deriveV3CanonicalRigContract,
  type V3CanonicalJointName,
} from './v3CanonicalRigContract';

const roundTuple = (value: readonly number[]): [number, number, number] => [
  Number(value[0].toFixed(6)),
  Number(value[1].toFixed(6)),
  Number(value[2].toFixed(6)),
];

const boundsWorldPoint = (
  slot: V3CharacterSlotId,
  x: number,
  y: number,
  z: number
): [number, number, number] => {
  const source = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;
  const bounds = source.slots[slot].bounds;
  const pivot = source.coordinateSystem.pivot;
  const scale = source.coordinateSystem.voxelScale;

  return roundTuple([
    (bounds.min[0] + (bounds.max[0] - bounds.min[0]) * x - pivot[0]) * scale,
    (bounds.min[1] + (bounds.max[1] - bounds.min[1]) * y) * scale,
    (bounds.min[2] + (bounds.max[2] - bounds.min[2]) * z - pivot[2]) * scale,
  ]);
};

const midpoint = (
  left: readonly number[],
  right: readonly number[]
): [number, number, number] => roundTuple([
  (left[0] + right[0]) / 2,
  (left[1] + right[1]) / 2,
  (left[2] + right[2]) / 2,
]);

const expectedArmSeam = (
  side: 'Left' | 'Right',
  innerSlot: V3CharacterSlotId,
  outerSlot: V3CharacterSlotId
): [number, number, number] => midpoint(
  boundsWorldPoint(innerSlot, 0.5, 0, 0.5),
  boundsWorldPoint(outerSlot, 0.5, 1, 0.5)
);

const expectedLegSeam = (
  upperSlot: V3CharacterSlotId,
  lowerSlot: V3CharacterSlotId
): [number, number, number] => midpoint(
  boundsWorldPoint(upperSlot, 0.5, 0, 0.5),
  boundsWorldPoint(lowerSlot, 0.5, 1, 0.5)
);

const subtractTuple = (
  left: readonly number[],
  right: readonly number[]
): [number, number, number] => roundTuple([
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
]);

const createModelWithAllSlotGroups = (): {
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
      detailBones[boneName] = bone;
      model.add(bone);
    }
  }

  for (const [index, slot] of V3_CHARACTER_SLOT_IDS.entries()) {
    const part = new THREE.Group();
    part.name = `v3:${slot}`;
    part.userData.v3Slot = slot;
    part.position.set(index / 10, index / 20, -index / 30);
    part.rotation.set(index / 100, index / 200, index / 300);
    detailBones[V3_SLOT_DETAIL_BONES[slot]].add(part);
    partGroups[slot] = part;
  }

  model.userData.v3PartGroups = partGroups;
  model.userData.v3DetailBones = detailBones;
  return { model, partGroups, detailBones };
};

describe('V3 canonical rig contract', () => {
  it('derives deterministic canonical joints from exact-source slot seams without mutating the source', () => {
    const before = JSON.stringify(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE);
    const contract = deriveV3CanonicalRigContract();
    const repeated = deriveV3CanonicalRigContract();

    assert.deepEqual(contract, repeated);
    assert.equal(JSON.stringify(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE), before);
    assert.equal(contract.kind, 'v3-canonical-rig-contract');
    assert.equal(contract.version, 1);
    assert.equal(contract.sourceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);
    assert.deepEqual(Object.keys(contract.slotPivots), [...V3_CHARACTER_SLOT_IDS].sort());

    const requiredJoints: V3CanonicalJointName[] = [
      'root',
      'pelvis',
      'spine',
      'chest',
      'neck',
      'head',
      'shoulderLeft',
      'elbowLeft',
      'wristLeft',
      'gripLeft',
      'shoulderRight',
      'elbowRight',
      'wristRight',
      'gripRight',
      'hipLeft',
      'kneeLeft',
      'ankleLeft',
      'toeLeft',
      'hipRight',
      'kneeRight',
      'ankleRight',
      'toeRight',
      'backMount',
    ];
    assert.deepEqual(Object.keys(contract.joints), [...requiredJoints].sort());

    assert.deepEqual(
      contract.joints.elbowLeft.position,
      expectedArmSeam('Left', 'upperArmLeft', 'forearmLeft')
    );
    assert.deepEqual(
      contract.joints.wristRight.position,
      expectedArmSeam('Right', 'forearmRight', 'handRight')
    );
    assert.deepEqual(
      contract.joints.kneeLeft.position,
      expectedLegSeam('thighLeft', 'shinLeft')
    );
    assert.deepEqual(
      contract.joints.ankleRight.position,
      expectedLegSeam('shinRight', 'footRight')
    );
    assert.deepEqual(
      contract.joints.neck.position,
      midpoint(boundsWorldPoint('chest', 0.5, 1, 0.5), boundsWorldPoint('neck', 0.5, 0, 0.5))
    );
    assert.deepEqual(contract.slotPivots.upperArmLeft.position, contract.joints.shoulderLeft.position);
    assert.deepEqual(contract.slotPivots.upperArmRight.position, contract.joints.shoulderRight.position);
    assert.deepEqual(contract.slotPivots.forearmLeft.position, contract.joints.elbowLeft.position);
    assert.deepEqual(contract.slotPivots.forearmRight.position, contract.joints.elbowRight.position);
    assert.deepEqual(contract.slotPivots.handLeft.position, contract.joints.wristLeft.position);
    assert.deepEqual(contract.slotPivots.handRight.position, contract.joints.wristRight.position);
    assert.deepEqual(contract.slotPivots.thighLeft.position, contract.joints.hipLeft.position);
    assert.deepEqual(contract.slotPivots.thighRight.position, contract.joints.hipRight.position);
    assert.deepEqual(contract.slotPivots.shinLeft.position, contract.joints.kneeLeft.position);
    assert.deepEqual(contract.slotPivots.shinRight.position, contract.joints.kneeRight.position);
    assert.deepEqual(contract.slotPivots.footLeft.position, contract.joints.ankleLeft.position);
    assert.deepEqual(contract.slotPivots.footRight.position, contract.joints.ankleRight.position);
    assert.deepEqual(contract.slotPivots.helmet.position, contract.joints.head.position);
    assert.deepEqual(contract.joints.gripRight.position, boundsWorldPoint('handRight', 0.5, 0.5, 0.5));
    assert.deepEqual(contract.joints.gripLeft.position, boundsWorldPoint('handLeft', 0.5, 0.5, 0.5));

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.equal(contract.slotPivots[slot].slot, slot);
      assert.equal(contract.slotPivots[slot].detailBone, V3_SLOT_DETAIL_BONES[slot]);
      assert.equal(contract.slotGeometryOffsets[slot].slot, slot);
      assert.deepEqual(contract.slotGeometryOffsets[slot].geometryCenter, boundsWorldPoint(slot, 0.5, 0.5, 0.5));
      assert.deepEqual(
        contract.slotGeometryOffsets[slot].offsetFromPivot,
        subtractTuple(contract.slotGeometryOffsets[slot].geometryCenter, contract.slotPivots[slot].position)
      );
    }
  });

  it('applies canonical metadata to the model and slot groups without changing transforms', () => {
    const { model, partGroups } = createModelWithAllSlotGroups();
    const originalTransforms = Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
      slot,
      {
        position: partGroups[slot].position.toArray(),
        rotation: partGroups[slot].rotation.toArray(),
        scale: partGroups[slot].scale.toArray(),
        parent: partGroups[slot].parent,
      },
    ]));

    const contract = applyV3CanonicalRigContract(model);

    assert.equal(model.userData.v3CanonicalRigContract, contract);
    assert.equal(model.userData.v3SlotPivots, contract.slotPivots);
    assert.equal(model.userData.v3SlotGeometryOffsets, contract.slotGeometryOffsets);
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.deepEqual(partGroups[slot].position.toArray(), originalTransforms[slot].position);
      assert.deepEqual(partGroups[slot].rotation.toArray(), originalTransforms[slot].rotation);
      assert.deepEqual(partGroups[slot].scale.toArray(), originalTransforms[slot].scale);
      assert.equal(partGroups[slot].parent, originalTransforms[slot].parent);
      assert.equal(partGroups[slot].userData.v3CanonicalRigContract, contract);
      assert.equal(partGroups[slot].userData.v3CanonicalSlotPivot, contract.slotPivots[slot]);
      assert.equal(partGroups[slot].userData.v3CanonicalSlotGeometryOffset, contract.slotGeometryOffsets[slot]);
    }
  });

  it('analyzes canonical metadata readiness and reports missing slot contracts', () => {
    const { model } = createModelWithAllSlotGroups();
    applyV3CanonicalRigContract(model);

    const ready = analyzeV3CanonicalRigContract(model);
    assert.equal(ready.ready, true);
    assert.deepEqual(ready.issues, []);
    assert.equal(ready.boundSlotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(ready.slots.handRight.ready, true);

    const empty = analyzeV3CanonicalRigContract(new THREE.Group());
    assert.equal(empty.ready, false);
    assert.ok(empty.issues.includes('model is missing v3CanonicalRigContract metadata'));
    assert.ok(empty.issues.includes('model is missing v3SlotPivots metadata'));
    assert.ok(empty.issues.includes('model is missing v3SlotGeometryOffsets metadata'));
    assert.ok(empty.issues.includes('model is missing v3PartGroups metadata'));
  });
});
