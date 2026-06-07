import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generatePoseFrames,
  interpolatePose,
  normalizeKeyframes,
  type AnimationKeyframe,
} from './animationEditorCore';
import { type WeaponPose } from '../components/grifball/attackAnimationPresets';

const pose = (x: number, y = 0, z = 0, rx = 0, ry = 0, rz = 0): WeaponPose => ({
  position: [x, y, z],
  rotation: [rx, ry, rz],
});

describe('animation editor interpolation', () => {
  it('fills missing frames between three keyed poses', () => {
    const frames = generatePoseFrames([
      { frame: 0, pose: pose(0) },
      { frame: 5, pose: pose(10) },
      { frame: 10, pose: pose(20) },
    ], 11, 'linear');

    assert.equal(frames.length, 11);
    assert.equal(frames[0].source, 'keyframe');
    assert.equal(frames[2].source, 'generated');
    assert.equal(frames[5].source, 'keyframe');
    assert.equal(frames[2].pose.position[0], 4);
    assert.equal(frames[7].pose.position[0], 14);
  });

  it('deduplicates and clamps keyframes by frame', () => {
    const normalized = normalizeKeyframes([
      { frame: -2, pose: pose(1) },
      { frame: 2, pose: pose(2) },
      { frame: 2, pose: pose(3), label: 'last wins' },
      { frame: 99, pose: pose(4) },
    ], 6);

    assert.deepEqual(normalized.map((keyframe: AnimationKeyframe) => keyframe.frame), [0, 2, 5]);
    assert.equal(normalized[1].pose.position[0], 3);
    assert.equal(normalized[2].pose.position[0], 4);
  });

  it('interpolates rotations through the shortest angular path', () => {
    const halfway = interpolatePose(
      pose(0, 0, 0, 0, 0, 3),
      pose(0, 0, 0, 0, 0, -3),
      0.5,
      'linear'
    );

    assert.ok(halfway.rotation[2] > Math.PI - 0.01);
    assert.ok(halfway.rotation[2] < Math.PI + 0.01);
  });
});
