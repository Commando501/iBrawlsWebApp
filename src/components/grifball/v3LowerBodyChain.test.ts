import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import {
  applyV3LowerBodyChainBinding,
  deriveV3LowerBodyChainContract,
  sampleV3LowerBodyWalkPose,
} from './v3LowerBodyChain';

const assertFiniteTuple = (tuple: readonly number[], label: string): void => {
  assert.equal(tuple.length, 3, `${label} should be a vec3 tuple`);
  assert.equal(tuple.every(Number.isFinite), true, `${label} should stay finite`);
};

describe('v3LowerBodyChain', () => {
  it('derives finite pelvis-to-toe anchors from the accepted exact-source model', () => {
    const model = buildV3SpartanModel({
      v3SourceFidelity: 'exact',
      v3ArmorRenderStyle: 'voxelEdit',
      v3QualityTier: 'desktop',
    });
    const contract = deriveV3LowerBodyChainContract(model);

    assert.equal(contract.kind, 'v3-lower-body-chain-contract');
    assert.equal(contract.version, 1);
    assert.equal(contract.sourceHash, model.userData.v3CanonicalRigContract.sourceHash);
    assertFiniteTuple(contract.pelvis.anchor, 'pelvis anchor');

    for (const side of ['left', 'right'] as const) {
      const chain = contract.sides[side];
      assert.equal(chain.side, side);
      assertFiniteTuple(chain.hip, `${side} hip`);
      assertFiniteTuple(chain.knee, `${side} knee`);
      assertFiniteTuple(chain.ankle, `${side} ankle`);
      assertFiniteTuple(chain.toe, `${side} toe`);
      assert.equal(chain.hip[1] > chain.knee[1], true, `${side} hip should be above knee`);
      assert.equal(chain.knee[1] > chain.ankle[1], true, `${side} knee should be above ankle`);
    }
  });

  it('binds the model as single-chain lower-body authority without moving the rest silhouette', () => {
    const model = buildV3SpartanModel({
      v3SourceFidelity: 'exact',
      v3ArmorRenderStyle: 'voxelEdit',
      v3QualityTier: 'desktop',
    });
    model.updateMatrixWorld(true);
    const before = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray();
    const contract = applyV3LowerBodyChainBinding(model);
    model.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray();

    assert.equal(model.userData.v3LowerBodyChainMode, 'single-chain');
    assert.equal(model.userData.v3LowerBodyChainContract, contract);
    assert.deepEqual(after.map((value) => Number(value.toFixed(6))), before.map((value) => Number(value.toFixed(6))));

    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    for (const boneName of ['pelvis', 'thighLeft', 'calfLeft', 'footLeft', 'toeLeft', 'thighRight', 'calfRight', 'footRight', 'toeRight']) {
      assert.equal(detailBones[boneName].userData.v3LowerBodyChainAuthority, 'single-chain', boneName);
    }
  });

  it('samples deterministic walk chain rotations with neutral broad-leg ownership', () => {
    const first = sampleV3LowerBodyWalkPose({
      phase: Math.PI / 3,
      speed: 3,
      isSprinting: false,
    });
    const second = sampleV3LowerBodyWalkPose({
      phase: Math.PI / 3,
      speed: 3,
      isSprinting: false,
    });

    assert.deepEqual(first, second);
    assert.deepEqual(first.broadLegRotation, [0, 0, 0]);
    assert.equal(first.sides.left.thighRotation.length, 3);
    assert.equal(first.sides.right.thighRotation.length, 3);
    assert.notDeepEqual(first.sides.left.thighRotation, first.sides.right.thighRotation);
    assert.ok(Math.abs(first.pelvisOffset[1]) <= 0.04);
    assert.ok(Math.abs(first.sides.left.kneeBend) <= 0.28);
    assert.ok(Math.abs(first.sides.right.kneeBend) <= 0.28);
  });
});
