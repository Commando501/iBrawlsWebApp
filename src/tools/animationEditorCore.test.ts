import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAnimationEditorExportPayload,
  generatePoseFrames,
  interpolatePose,
  mergeLinkedArmKeyframesPreservingPositions,
  normalizeKeyframes,
  resolveSetKeyframePose,
  type AnimationKeyframe,
  type RigTargetPose,
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

  it('interpolates rig target poses with the same frame generator as weapons', () => {
    const socketStart: RigTargetPose = pose(0, 0, 0);
    const socketEnd: RigTargetPose = pose(0, 1, 0, 0, Math.PI, 0);
    const frames = generatePoseFrames([
      { frame: 0, pose: socketStart },
      { frame: 4, pose: socketEnd },
    ], 5, 'linear');

    assert.equal(frames[2].pose.position[1], 0.5);
    assert.ok(frames[2].pose.rotation[1] > 1.56);
    assert.ok(frames[2].pose.rotation[1] < 1.58);
  });

  it('preserves translated linked arm positions when reseeding weapon-driven arm rotations', () => {
    const reseeded = mergeLinkedArmKeyframesPreservingPositions(
      [
        { frame: 0, label: 'A', pose: pose(0, 0, 0, 0.25, 0, 0) },
        { frame: 4, label: 'B', pose: pose(0, 0, 0, 0.75, 0, 0) },
      ],
      [
        { frame: 0, label: 'A', pose: pose(1, 2, 3, -0.1, 0, 0) },
        { frame: 4, label: 'B', pose: pose(4, 5, 6, -0.2, 0, 0) },
      ],
      undefined,
      5
    );

    assert.deepEqual(reseeded[0].pose.position, [1, 2, 3]);
    assert.deepEqual(reseeded[1].pose.position, [4, 5, 6]);
    assert.deepEqual(reseeded[0].pose.rotation, [0.25, 0, 0]);
    assert.deepEqual(reseeded[1].pose.rotation, [0.75, 0, 0]);
  });

  it('uses existing generated linked arm positions when a weapon keyframe lands between arm keys', () => {
    const existingKeyframes = [
      { frame: 0, pose: pose(0, 0, 0, 0, 0, 0) },
      { frame: 4, pose: pose(4, 8, 12, 0, 0, 0) },
    ];
    const existingFrames = generatePoseFrames(existingKeyframes, 5, 'linear');

    const reseeded = mergeLinkedArmKeyframesPreservingPositions(
      [{ frame: 2, label: 'Mid', pose: pose(0, 0, 0, 0.5, 0, 0) }],
      existingKeyframes,
      existingFrames,
      5
    );

    assert.deepEqual(reseeded[0].pose.position, [2, 4, 6]);
    assert.deepEqual(reseeded[0].pose.rotation, [0.5, 0, 0]);
  });

  it('uses the active draft pose when setting a keyframe on the edited frame', () => {
    const resolved = resolveSetKeyframePose({
      currentFrame: 15,
      capturedPose: pose(0, 0, 0, -1.55, 0, 0),
      draftFrame: 15,
      draftPose: pose(0.84, 0.02, 0.03, -1.55, 0, 0),
    });

    assert.deepEqual(resolved.position, [0.84, 0.02, 0.03]);
    assert.deepEqual(resolved.rotation, [-1.55, 0, 0]);
  });

  it('falls back to the captured pose when the draft belongs to another frame', () => {
    const resolved = resolveSetKeyframePose({
      currentFrame: 15,
      capturedPose: pose(0, 0, 0, -1.55, 0, 0),
      draftFrame: 14,
      draftPose: pose(0.84, 0.02, 0.03, -1.55, 0, 0),
    });

    assert.deepEqual(resolved.position, [0, 0, 0]);
    assert.deepEqual(resolved.rotation, [-1.55, 0, 0]);
  });

  it('builds a versioned rig export while keeping the legacy weapon frames', () => {
    const weaponFrames = generatePoseFrames([
      { frame: 0, pose: pose(0), label: 'A' },
      { frame: 2, pose: pose(2), label: 'B' },
    ], 3, 'linear');
    const socketFrames = generatePoseFrames([
      { frame: 0, pose: pose(0, 0, 0), label: 'A' },
      { frame: 2, pose: pose(0, 2, 0), label: 'B' },
    ], 3, 'linear');

    const payload = buildAnimationEditorExportPayload({
      weapon: 'hammer',
      view: 'thirdPerson',
      track: 'hammer_windup',
      frameCount: 3,
      interpolation: 'linear',
      keyframes: [
        { frame: 0, pose: pose(0), label: 'A' },
        { frame: 2, pose: pose(2), label: 'B' },
      ],
      frames: weaponFrames,
      rig: {
        bones: {
          upperTorso: {
            keyframes: [{ frame: 0, pose: pose(0, 0, 0), label: 'A' }],
            frames: generatePoseFrames([{ frame: 0, pose: pose(0, 0, 0), label: 'A' }], 3, 'linear'),
          },
        },
        sockets: {
          thirdPersonWeaponGrip: {
            keyframes: [
              { frame: 0, pose: pose(0, 0, 0), label: 'A' },
              { frame: 2, pose: pose(0, 2, 0), label: 'B' },
            ],
            frames: socketFrames,
          },
        },
        socketLocks: [
          {
            target: { kind: 'weapon', name: 'hammer', view: 'thirdPerson' },
            socket: { kind: 'socket', name: 'rightHandGrip', view: 'thirdPerson' },
          },
        ],
      },
    });

    assert.equal(payload.rigVersion, 1);
    assert.equal(payload.frames.length, 3);
    assert.equal(payload.rig.bones.upperTorso.frames.length, 3);
    assert.equal(payload.rig.sockets.thirdPersonWeaponGrip.keyframes.length, 2);
    assert.equal(payload.rig.sockets.thirdPersonWeaponGrip.frames[1].pose.position[1], 1);
    assert.deepEqual(payload.rig.socketLocks, [
      {
        target: { kind: 'weapon', name: 'hammer', view: 'thirdPerson' },
        socket: { kind: 'socket', name: 'rightHandGrip', view: 'thirdPerson' },
      },
    ]);
  });
});
