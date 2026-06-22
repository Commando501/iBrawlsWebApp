import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAnimationEditorExportPayload,
  buildAnimationEditorValidationReport,
  clampAnimationEditorLoopRange,
  commitAnimationEditorHistory,
  createAnimationEditorDuplicateVariant,
  createAnimationEditorHistory,
  createAnimationEditorVariantFromCurrentFrame,
  generatePoseFrames,
  interpolatePose,
  markAnimationEditorHistorySaved,
  mergeLinkedArmKeyframesPreservingPositions,
  mirrorAnimationEditorPose,
  mirrorAnimationEditorTarget,
  nextAnimationEditorLoopFrame,
  normalizeKeyframes,
  parseAnimationEditorImportText,
  redoAnimationEditorHistory,
  retimeAnimationEditorKeyframe,
  resolveSetKeyframePose,
  undoAnimationEditorHistory,
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

  it('can export V3 procedural profile metadata alongside editable rig frames', () => {
    const frames = generatePoseFrames([
      { frame: 0, pose: pose(0), label: 'Ready' },
      { frame: 2, pose: pose(2), label: 'Peak' },
    ], 3, 'linear');

    const payload = buildAnimationEditorExportPayload({
      weapon: 'pistol',
      view: 'firstPerson',
      track: 'pistol_fire',
      frameCount: 3,
      interpolation: 'linear',
      keyframes: [
        { frame: 0, pose: pose(0), label: 'Ready' },
        { frame: 2, pose: pose(2), label: 'Peak' },
      ],
      frames,
      proceduralProfile: {
        modelSystem: 'v3',
        profileVersion: 1,
        source: 'v3AnimationFidelity',
      },
    });

    assert.deepEqual(payload.proceduralProfile, {
      modelSystem: 'v3',
      profileVersion: 1,
      source: 'v3AnimationFidelity',
    });
  });

  it('tracks undo, redo, saved state, and no-op commits for animation editor snapshots', () => {
    const original = buildAnimationEditorExportPayload({
      weapon: 'hammer',
      view: 'thirdPerson',
      track: 'hammer_windup',
      frameCount: 3,
      interpolation: 'linear',
      keyframes: [{ frame: 0, pose: pose(0), label: 'A' }],
      frames: generatePoseFrames([{ frame: 0, pose: pose(0), label: 'A' }], 3, 'linear'),
    });
    const edited = buildAnimationEditorExportPayload({
      ...original,
      keyframes: [{ frame: 0, pose: pose(2), label: 'A' }],
      frames: generatePoseFrames([{ frame: 0, pose: pose(2), label: 'A' }], 3, 'linear'),
    });

    const history = createAnimationEditorHistory(original);
    const committed = commitAnimationEditorHistory(history, edited);
    assert.equal(committed.dirty, true);
    assert.equal(committed.past.length, 1);
    assert.equal(committed.future.length, 0);
    assert.equal(committed.present.keyframes[0].pose.position[0], 2);

    const undone = undoAnimationEditorHistory(committed);
    assert.equal(undone.present.keyframes[0].pose.position[0], 0);
    assert.equal(undone.future.length, 1);

    const redone = redoAnimationEditorHistory(undone);
    assert.equal(redone.present.keyframes[0].pose.position[0], 2);

    const saved = markAnimationEditorHistorySaved(redone);
    assert.equal(saved.dirty, false);
    const noOp = commitAnimationEditorHistory(saved, saved.present);
    assert.equal(noOp.dirty, false);
    assert.equal(noOp.past.length, saved.past.length);
  });

  it('clamps loop ranges and steps playback inside the selected review range', () => {
    assert.deepEqual(clampAnimationEditorLoopRange(12, { inFrame: 99, outFrame: -4 }), {
      inFrame: 0,
      outFrame: 11,
    });
    assert.deepEqual(clampAnimationEditorLoopRange(12, { inFrame: 8, outFrame: 3 }), {
      inFrame: 3,
      outFrame: 8,
    });
    assert.equal(nextAnimationEditorLoopFrame(5, 1, 12, { inFrame: 3, outFrame: 5 }), 3);
    assert.equal(nextAnimationEditorLoopFrame(2, 1, 12, { inFrame: 3, outFrame: 5 }), 3);
    assert.equal(nextAnimationEditorLoopFrame(4, -2, 12, { inFrame: 3, outFrame: 5 }), 5);
  });

  it('retimes keyframes with clamping and destination-frame replacement', () => {
    const retimed = retimeAnimationEditorKeyframe(
      [
        { frame: 0, pose: pose(0), label: 'A' },
        { frame: 4, pose: pose(4), label: 'B' },
        { frame: 8, pose: pose(8), label: 'C' },
      ],
      { fromFrame: 8, toFrame: 4, frameCount: 10 }
    );

    assert.deepEqual(retimed.map((keyframe) => keyframe.frame), [0, 4]);
    assert.equal(retimed[1].pose.position[0], 8);

    const clamped = retimeAnimationEditorKeyframe(retimed, { fromFrame: 4, toFrame: 99, frameCount: 10 });
    assert.deepEqual(clamped.map((keyframe) => keyframe.frame), [0, 9]);
  });

  it('parses raw JSON and JSON-plus-snippet imports without mutating the current document', () => {
    const payload = buildAnimationEditorExportPayload({
      weapon: 'pistol',
      view: 'firstPerson',
      track: 'pistol_fire',
      frameCount: 3,
      interpolation: 'linear',
      keyframes: [{ frame: 0, pose: pose(1), label: 'Ready' }],
      frames: generatePoseFrames([{ frame: 0, pose: pose(1), label: 'Ready' }], 3, 'linear'),
    });
    const current = structuredClone(payload);
    const imported = parseAnimationEditorImportText(`${JSON.stringify(payload, null, 2)}\n\nconst frames = [];`);

    assert.equal(imported.payload.tool, 'ibrawls-animation-editor');
    assert.equal(imported.payload.weapon, 'pistol');
    assert.deepEqual(current, payload);
    assert.throws(() => parseAnimationEditorImportText('{ not json'), /Unable to parse animation editor JSON/);
  });

  it('creates local duplicate and new-from-current variants without changing export compatibility', () => {
    const payload = buildAnimationEditorExportPayload({
      weapon: 'hammer',
      view: 'thirdPerson',
      track: 'hammer_slam',
      frameCount: 5,
      interpolation: 'linear',
      keyframes: [
        { frame: 0, pose: pose(0), label: 'A' },
        { frame: 4, pose: pose(4), label: 'B' },
      ],
      frames: generatePoseFrames([
        { frame: 0, pose: pose(0), label: 'A' },
        { frame: 4, pose: pose(4), label: 'B' },
      ], 5, 'linear'),
    });

    const duplicated = createAnimationEditorDuplicateVariant(payload, {
      storageId: 'variant-copy',
      now: '2026-06-22T12:00:00.000Z',
    });
    assert.equal(duplicated.storageId, 'variant-copy');
    assert.equal(duplicated.payload.tool, 'ibrawls-animation-editor');
    assert.match(duplicated.label, /Copy/);

    const fromCurrent = createAnimationEditorVariantFromCurrentFrame(payload, {
      storageId: 'variant-current',
      frame: 3,
      now: '2026-06-22T12:00:00.000Z',
    });
    assert.equal(fromCurrent.payload.frameCount, 1);
    assert.deepEqual(fromCurrent.payload.keyframes.map((keyframe) => keyframe.frame), [0]);
    assert.equal(fromCurrent.payload.keyframes[0].pose.position[0], 3);
  });

  it('builds actionable validation report items for malformed editor exports', () => {
    const payload = buildAnimationEditorExportPayload({
      weapon: 'hammer',
      view: 'thirdPerson',
      track: 'hammer_slam',
      frameCount: 4,
      interpolation: 'linear',
      keyframes: [{ frame: 0, pose: pose(0), label: 'A' }],
      frames: generatePoseFrames([{ frame: 0, pose: pose(0), label: 'A' }], 4, 'linear'),
      rig: {
        bones: {},
        sockets: {},
        socketLocks: [
          {
            target: { kind: 'bone', name: 'upperTorso', view: 'thirdPerson' },
            socket: { kind: 'weapon', name: 'hammer', view: 'thirdPerson' },
          },
        ],
      },
    }) as any;
    payload.keyframes = [
      { frame: 99, pose: { position: [Number.NaN, 0, 0], rotation: [0, 0, 0] }, label: 'Bad' },
    ];

    const report = buildAnimationEditorValidationReport(payload);

    assert.equal(report.ok, false);
    assert.ok(report.items.some((item) => item.code === 'keyframe-out-of-range' && item.frame === 99));
    assert.ok(report.items.some((item) => item.code === 'non-finite-pose'));
    assert.ok(report.items.some((item) => item.code === 'invalid-socket-lock'));
  });

  it('mirrors poses across the rig center line and swaps left/right target names', () => {
    assert.deepEqual(mirrorAnimationEditorPose(pose(1, 2, 3, 0.1, 0.2, 0.3)), {
      position: [-1, 2, 3],
      rotation: [0.1, -0.2, -0.3],
    });
    assert.deepEqual(
      mirrorAnimationEditorTarget({ kind: 'bone', name: 'leftArm', view: 'thirdPerson' }),
      { kind: 'bone', name: 'rightArm', view: 'thirdPerson' }
    );
    assert.deepEqual(
      mirrorAnimationEditorTarget({ kind: 'socket', name: 'rightHandGrip', view: 'thirdPerson' }),
      { kind: 'socket', name: 'leftHandGrip', view: 'thirdPerson' }
    );
  });
});
