import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { buildCombatantRigForModel } from './combatantRig';
import {
  applyV3ArmIkTarget,
  getV3ArmIkGripWorldPosition,
} from './v3ArmIk';

const createModel = (): THREE.Group => {
  const model = buildV3SpartanModel({ customHue: 192 });
  buildCombatantRigForModel(model);
  model.updateWorldMatrix(true, true);
  return model;
};

const assertFiniteRotation = (group: THREE.Object3D, label: string) => {
  assert.equal(
    [group.rotation.x, group.rotation.y, group.rotation.z].every(Number.isFinite),
    true,
    `${label} rotation must stay finite`
  );
};

describe('V3 arm IK', () => {
  it('moves a reachable right grip target without tearing the chain', () => {
    const model = createModel();
    const start = getV3ArmIkGripWorldPosition(model, 'right');
    const target = start.clone().add(new THREE.Vector3(0.05, 0.04, -0.16));

    const result = applyV3ArmIkTarget(model, {
      side: 'right',
      targetWorldPosition: target,
      poleWorldDirection: new THREE.Vector3(-1, 0.2, -0.15),
      alpha: 1,
    });
    const actual = getV3ArmIkGripWorldPosition(model, 'right');

    assert.equal(result.ready, true);
    assert.equal(result.reachClamped, false);
    assert.ok(actual.distanceTo(target) < 0.045, `right grip drift ${actual.distanceTo(target)}`);
    assert.ok(result.upperArmWorldLength > 0.25);
    assert.ok(result.lowerArmWorldLength > 0.25);
  });

  it('clamps unreachable targets and keeps arm rotations finite', () => {
    const model = createModel();
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const start = getV3ArmIkGripWorldPosition(model, 'left');
    const target = start.clone().add(new THREE.Vector3(5, 0, -5));

    const result = applyV3ArmIkTarget(model, {
      side: 'left',
      targetWorldPosition: target,
      poleWorldDirection: new THREE.Vector3(1, 0.2, -0.15),
      alpha: 1,
    });

    assert.equal(result.ready, true);
    assert.equal(result.reachClamped, true);
    assert.ok(result.clampDistance > 0);
    for (const bone of ['upperArmLeft', 'forearmLeft', 'handLeft', 'gripLeft']) {
      assertFiniteRotation(detailBones[bone], bone);
    }
  });

  it('uses side-specific pole hints so elbows bend away from the torso centerline', () => {
    const model = createModel();
    const rightStart = getV3ArmIkGripWorldPosition(model, 'right');
    const leftStart = getV3ArmIkGripWorldPosition(model, 'left');

    const right = applyV3ArmIkTarget(model, {
      side: 'right',
      targetWorldPosition: rightStart.clone().add(new THREE.Vector3(0.08, 0, -0.12)),
      poleWorldDirection: new THREE.Vector3(-1, 0.1, -0.1),
      alpha: 1,
    });
    const left = applyV3ArmIkTarget(model, {
      side: 'left',
      targetWorldPosition: leftStart.clone().add(new THREE.Vector3(-0.08, 0, -0.12)),
      poleWorldDirection: new THREE.Vector3(1, 0.1, -0.1),
      alpha: 1,
    });

    assert.ok(right.elbowWorldPosition.x < right.shoulderWorldPosition.x - 0.05);
    assert.ok(left.elbowWorldPosition.x > left.shoulderWorldPosition.x + 0.05);
  });

  it('applies clavicle assist and reports shoulder seam distance for hammer offhand targets', () => {
    const model = createModel();
    const start = getV3ArmIkGripWorldPosition(model, 'left');
    const target = start.clone().add(new THREE.Vector3(-0.24, 0.1, -0.18));

    const result = applyV3ArmIkTarget(model, {
      side: 'left',
      targetWorldPosition: target,
      poleWorldDirection: new THREE.Vector3(1, 0.2, -0.2),
      alpha: 1,
    });

    assert.equal(result.ready, true);
    assert.ok(result.clavicleAssistRotation > 0.01, `clavicle assist ${result.clavicleAssistRotation}`);
    assert.ok(result.shoulderSeamDistance < 0.035, `shoulder seam ${result.shoulderSeamDistance}`);
    assert.ok(result.clavicleWorldPosition.distanceTo(result.shoulderWorldPosition) < 0.035);
  });
});
