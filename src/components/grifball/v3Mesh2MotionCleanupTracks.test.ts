import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sampleV3Mesh2MotionCleanupTrack,
  type V3Mesh2MotionCleanupTrack,
} from './v3Mesh2MotionCleanupTracks';

const roundTuple = (value: readonly number[]): number[] =>
  value.map((component) => Number(component.toFixed(6)));

describe('v3Mesh2MotionCleanupTracks', () => {
  it('returns null for unknown clean clip/source pairs', () => {
    assert.equal(sampleV3Mesh2MotionCleanupTrack('clean_missing', 'Sprint_Loop', 0.5), null);
    assert.equal(sampleV3Mesh2MotionCleanupTrack('clean_sprint', 'Wrong_Source', 0.5), null);
  });

  it('samples identity cleanup tracks as behaviorally no-op metadata', () => {
    const sample = sampleV3Mesh2MotionCleanupTrack('clean_sprint', 'Sprint_Loop', 0.5);

    assert.ok(sample);
    assert.equal(sample.trackId, 'clean_sprint:Sprint_Loop');
    assert.equal(sample.cleanClipId, 'clean_sprint');
    assert.equal(sample.sourceClipName, 'Sprint_Loop');
    assert.equal(sample.normalizedTime, 0.5);
    assert.deepEqual(sample.driverJoints, {});
    assert.deepEqual(sample.partBindings, {});
    assert.deepEqual(sample.weaponSockets, {});
    assert.equal(sample.driverJointAdjustmentCount, 0);
    assert.equal(sample.partBindingAdjustmentCount, 0);
    assert.equal(sample.weaponSocketAdjustmentCount, 0);
  });

  it('clamps normalized time and interpolates driver, part, and socket offsets', () => {
    const track: V3Mesh2MotionCleanupTrack = {
      id: 'test-cleanup',
      cleanClipId: 'clean_test',
      sourceClipName: 'Test_Source',
      keyframes: [
        {
          time: 0,
          driverJoints: {
            hand_r: { position: [0, 0, 0], rotation: [0, 0, 0] },
          },
          partBindings: {
            handRight: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
          weaponSockets: {
            rightHandGrip: { position: [0, 0, 0], rotation: [0, 0, 0] },
          },
        },
        {
          time: 1,
          driverJoints: {
            hand_r: { position: [0.2, -0.1, 0.04], rotation: [0.2, -0.1, 0.4] },
          },
          partBindings: {
            handRight: { position: [0.1, 0.2, 0.3], rotation: [0.4, 0.2, -0.2], scale: [1.4, 0.8, 1.2] },
          },
          weaponSockets: {
            rightHandGrip: { position: [0.04, 0.08, -0.02], rotation: [-0.2, 0.3, 0.1] },
          },
        },
      ],
    };

    const sample = sampleV3Mesh2MotionCleanupTrack('clean_test', 'Test_Source', 0.5, { tracks: [track] });
    const lowClamp = sampleV3Mesh2MotionCleanupTrack('clean_test', 'Test_Source', -1, { tracks: [track] });
    const highClamp = sampleV3Mesh2MotionCleanupTrack('clean_test', 'Test_Source', 2, { tracks: [track] });

    assert.ok(sample);
    assert.ok(lowClamp);
    assert.ok(highClamp);
    assert.equal(lowClamp.normalizedTime, 0);
    assert.equal(highClamp.normalizedTime, 1);
    assert.deepEqual(roundTuple(sample.driverJoints.hand_r?.position ?? []), [0.1, -0.05, 0.02]);
    assert.deepEqual(roundTuple(sample.driverJoints.hand_r?.rotation ?? []), [0.1, -0.05, 0.2]);
    assert.deepEqual(roundTuple(sample.partBindings.handRight?.position ?? []), [0.05, 0.1, 0.15]);
    assert.deepEqual(roundTuple(sample.partBindings.handRight?.rotation ?? []), [0.2, 0.1, -0.1]);
    assert.deepEqual(roundTuple(sample.partBindings.handRight?.scale ?? []), [1.2, 0.9, 1.1]);
    assert.deepEqual(roundTuple(sample.weaponSockets.rightHandGrip?.position ?? []), [0.02, 0.04, -0.01]);
    assert.deepEqual(roundTuple(sample.weaponSockets.rightHandGrip?.rotation ?? []), [-0.1, 0.15, 0.05]);
    assert.equal(sample.driverJointAdjustmentCount, 1);
    assert.equal(sample.partBindingAdjustmentCount, 1);
    assert.equal(sample.weaponSocketAdjustmentCount, 1);
  });
});
