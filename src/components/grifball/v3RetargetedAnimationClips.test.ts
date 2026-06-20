import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import * as THREE from 'three';
import {
  V3_RETARGETED_MIXAMO_CLIP_IDS,
  analyzeV3RetargetedClipQuality,
  analyzeV3RetargetedMotionRetention,
  applyV3RetargetedClipPose,
  getV3RetargetedClip,
  sampleV3RetargetedClip,
} from './v3RetargetedAnimationClips';
import { buildV3AnimationAtlasScene } from '../../tools/v3AnimationAtlasSmoke';

describe('v3RetargetedAnimationClips', () => {
  const maxJointAxisRotation = (
    id: 'idle' | 'walk' | 'run',
    joint: string,
    axis: 0 | 1 | 2
  ): number => Math.max(
    ...[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((normalizedTime) => {
      const sample = sampleV3RetargetedClip(id, { normalizedTime });
      return Math.abs(sample.joints[joint as keyof typeof sample.joints]?.rotation[axis] ?? 0);
    })
  );

  test('generated Mixamo clips are available for idle, walk, and run', () => {
    assert.deepEqual(V3_RETARGETED_MIXAMO_CLIP_IDS, ['idle', 'walk', 'run']);

    for (const id of V3_RETARGETED_MIXAMO_CLIP_IDS) {
      const clip = getV3RetargetedClip(id);
      assert.equal(clip.id, id);
      assert.equal(clip.source, 'mixamo');
      assert.match(clip.sourceHash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(clip.durationSeconds > 0);
      assert.ok(clip.joints.pelvis.keyframes.length > 0);
    }
  });

  test('samples finite transforms at frame start, midpoint, and loop end', () => {
    for (const id of V3_RETARGETED_MIXAMO_CLIP_IDS) {
      for (const normalizedTime of [0, 0.5, 1]) {
        const sample = sampleV3RetargetedClip(id, { normalizedTime });
        assert.equal(sample.clipId, id);
        assert.equal(sample.clipSource, 'retargetedMixamo');
        assert.equal(sample.ready, true);
        for (const joint of Object.values(sample.joints)) {
          assert.ok(joint.rotation.every(Number.isFinite), `${id} rotation should be finite`);
          if (joint.offset) {
            assert.ok(joint.offset.every(Number.isFinite), `${id} offset should be finite`);
          }
        }
      }
    }
  });

  test('applies walk and run clips without horizontal root motion authority', () => {
    const atlas = buildV3AnimationAtlasScene({ caseId: 'walk' });
    const model = atlas.views[0].rig.group;

    const walkSample = sampleV3RetargetedClip('walk', { normalizedTime: 0.35 });
    applyV3RetargetedClipPose(model, walkSample, { alpha: 1 });

    const lowerTorso = model.userData.lowerTorso as THREE.Group;
    assert.ok(Math.abs(lowerTorso.position.x) <= 0.000001);
    assert.ok(Math.abs(lowerTorso.position.z) <= 0.000001);
    assert.ok(Math.abs(lowerTorso.position.y) <= 0.09);
    assert.equal(model.userData.v3RetargetedClip?.clipId, 'walk');
    assert.equal(model.userData.v3RetargetedClip?.clipSource, 'retargetedMixamo');

    const runSample = sampleV3RetargetedClip('run', { elapsedSeconds: 0.21 });
    applyV3RetargetedClipPose(model, runSample, { alpha: 1 });
    assert.equal(model.userData.v3RetargetedClip?.clipId, 'run');
    assert.ok(Math.abs(lowerTorso.position.x) <= 0.000001);
    assert.ok(Math.abs(lowerTorso.position.z) <= 0.000001);
  });

  test('walk retains visible Mixamo lower-leg motion after retargeting', () => {
    assert.ok(maxJointAxisRotation('walk', 'thighLeft', 0) >= 0.24);
    assert.ok(maxJointAxisRotation('walk', 'thighRight', 0) >= 0.24);
    assert.ok(maxJointAxisRotation('walk', 'calfLeft', 0) >= 0.18);
    assert.ok(maxJointAxisRotation('walk', 'calfRight', 0) >= 0.18);
    assert.ok(maxJointAxisRotation('walk', 'footLeft', 0) >= 0.08);
    assert.ok(maxJointAxisRotation('walk', 'footRight', 0) >= 0.08);
  });

  test('run retains visible Mixamo lower-leg motion after retargeting', () => {
    assert.ok(maxJointAxisRotation('run', 'thighLeft', 0) >= 0.32);
    assert.ok(maxJointAxisRotation('run', 'thighRight', 0) >= 0.32);
    assert.ok(maxJointAxisRotation('run', 'calfLeft', 0) >= 0.28);
    assert.ok(maxJointAxisRotation('run', 'calfRight', 0) >= 0.28);
    assert.ok(maxJointAxisRotation('run', 'footLeft', 0) >= 0.12);
    assert.ok(maxJointAxisRotation('run', 'footRight', 0) >= 0.12);
  });

  test('idle remains subtle while imported walk and run drive locomotion', () => {
    assert.ok(maxJointAxisRotation('idle', 'calfLeft', 0) <= 0.03);
    assert.ok(maxJointAxisRotation('idle', 'calfRight', 0) <= 0.03);
    assert.ok(maxJointAxisRotation('idle', 'footLeft', 0) <= 0.03);
    assert.ok(maxJointAxisRotation('idle', 'footRight', 0) <= 0.03);
  });

  test('motion retention analyzer reports visible imported locomotion instead of flattened clips', () => {
    const walk = analyzeV3RetargetedMotionRetention('walk');
    const run = analyzeV3RetargetedMotionRetention('run');
    const idle = analyzeV3RetargetedMotionRetention('idle');

    assert.equal(walk.ready, true, walk.issues.join(', '));
    assert.ok((walk.joints.thighLeft?.appliedMaxRotation ?? 0) >= 0.24);
    assert.ok((walk.joints.calfLeft?.appliedMaxRotation ?? 0) >= 0.18);
    assert.ok((walk.joints.footLeft?.appliedMaxRotation ?? 0) >= 0.08);
    assert.ok((walk.joints.calfLeft?.rawMaxRotation ?? 0) >= (walk.joints.calfLeft?.appliedMaxRotation ?? 0));

    assert.equal(run.ready, true, run.issues.join(', '));
    assert.ok((run.joints.thighLeft?.appliedMaxRotation ?? 0) >= 0.32);
    assert.ok((run.joints.calfLeft?.appliedMaxRotation ?? 0) >= 0.28);
    assert.ok((run.joints.footLeft?.appliedMaxRotation ?? 0) >= 0.12);

    assert.equal(idle.ready, true, idle.issues.join(', '));
    assert.ok((idle.joints.calfLeft?.appliedMaxRotation ?? 0) <= 0.03);
    assert.ok((idle.joints.footLeft?.appliedMaxRotation ?? 0) <= 0.03);
  });

  test('quality analyzer marks all generated clips ready', () => {
    for (const id of V3_RETARGETED_MIXAMO_CLIP_IDS) {
      const quality = analyzeV3RetargetedClipQuality(id);
      assert.equal(quality.ready, true, quality.issues.join(', '));
      assert.equal(quality.clipId, id);
      assert.equal(quality.source, 'mixamo');
      assert.equal(quality.horizontalRootMotionStripped, true);
      assert.equal(quality.motionRetention.ready, true);
      assert.ok(quality.frameCount > 0);
    }
  });
});
