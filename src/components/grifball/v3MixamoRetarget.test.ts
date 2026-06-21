import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeV3RetargetJointAlignment,
  deriveV3MixamoRetargetCalibration,
  sampleV3RetargetedUpperBodyPose,
} from './v3MixamoRetarget';

const finiteTuple = (values: readonly number[]): boolean => values.every(Number.isFinite);

const unitLength = (quaternion: readonly number[]): number => Math.hypot(
  quaternion[0],
  quaternion[1],
  quaternion[2],
  quaternion[3]
);

describe('V3 Mixamo skeleton retarget calibration', () => {
  it('derives deterministic T-pose rest calibration for upper-body joints', () => {
    const first = deriveV3MixamoRetargetCalibration();
    const second = deriveV3MixamoRetargetCalibration();

    assert.deepEqual(second, first);
    assert.equal(first.sourceRestClip, 'T-Pose.fbx');
    assert.ok(first.joints.chest);
    assert.ok(first.joints.upperArmRight);
    assert.ok(first.joints.forearmLeft);
    assert.equal(finiteTuple(first.joints.upperArmRight.sourceRestQuaternion), true);
    assert.equal(finiteTuple(first.joints.upperArmRight.targetRestQuaternion), true);
    assert.equal(finiteTuple(first.joints.upperArmRight.sourceRestPosition), true);
    assert.equal(finiteTuple(first.joints.upperArmRight.targetRestPosition), true);
  });

  it('samples finite V3 detail-bone quaternions from Mixamo weapon references', () => {
    const pose = sampleV3RetargetedUpperBodyPose('hammer_heavy_swing', 0.5);

    assert.equal(pose.trackSource, 'v3MixamoQuaternionRetarget');
    assert.ok(pose.detailBoneQuaternions);
    assert.ok(pose.detailBoneQuaternions.upperArmRight);
    assert.ok(pose.detailBoneQuaternions.forearmLeft);
    for (const quaternion of Object.values(pose.detailBoneQuaternions)) {
      assert.ok(quaternion);
      assert.equal(finiteTuple(quaternion), true);
      assert.ok(Math.abs(unitLength(quaternion) - 1) < 0.0001);
    }
  });

  it('reports elbow-plane and palm-axis alignment instead of only hand endpoint drift', () => {
    const report = analyzeV3RetargetJointAlignment('sword_outward_slash', 0.58);

    assert.equal(report.ready, true, report.issues.join(', '));
    assert.ok(report.right.elbowPlaneAlignment > 0.1, `right elbow plane ${report.right.elbowPlaneAlignment}`);
    assert.ok(report.right.palmForwardAlignment > 0.3, `right palm forward ${report.right.palmForwardAlignment}`);
    assert.ok(report.right.forearmTwistAlignment > 0.3, `right forearm twist ${report.right.forearmTwistAlignment}`);
    assert.equal(report.ikCleanupRequired, false);
  });
});
