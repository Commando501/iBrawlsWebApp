import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import {
  V3_MESH2MOTION_CLEAN_CLIP_BINDINGS,
  V3_MESH2MOTION_SOURCE_CLIP_NAMES,
  buildV3Mesh2MotionClipSetArtifact,
  buildV3Mesh2MotionGeneratedSource,
} from './v3Mesh2MotionImporter';

const sourceFilePath = join(process.cwd(), 'reference', 'mesh2motion-v3', 'exported-model.glb');

describe('v3Mesh2MotionImporter', () => {
  it('imports the grouped Mesh2Motion GLB into deterministic sanitized clip data', () => {
    const first = buildV3Mesh2MotionClipSetArtifact({ filePath: sourceFilePath, fps: 30 });
    const second = buildV3Mesh2MotionClipSetArtifact({ filePath: sourceFilePath, fps: 30 });

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, 'v3-mesh2motion-clip-set/v3');
    assert.equal(first.source.kind, 'mesh2motion-glb');
    assert.equal(first.source.fileName, 'exported-model.glb');
    assert.match(first.source.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(first.clips.map((clip) => clip.sourceClipName), V3_MESH2MOTION_SOURCE_CLIP_NAMES);
    assert.equal(first.restPose.sourceClipName, 'TPose');
    assert.equal(first.skeleton.sourceJointCount, 56);
    assert.equal(first.skeleton.joints.some((joint) => joint.name === 'spine_03' && joint.parent === 'spine_02'), true);
    assert.equal(first.skeleton.joints.some((joint) => joint.name === 'hand_r' && joint.parent === 'lowerarm_r'), true);
    assert.equal(first.skeleton.joints.every((joint) => joint.restLocalPosition.length === 3), true);
    assert.deepEqual(first.partBindings.upperArmLeft.centerJointNames, ['upperarm_l', 'lowerarm_l']);
    assert.deepEqual(first.partBindings.forearmRight.centerJointNames, ['lowerarm_r', 'hand_r']);
    assert.equal(first.partBindings.handRight.sourceJointName, 'hand_r');
    assert.equal(first.metrics.clipCount, 9);
    assert.equal(first.metrics.mappedJointCount >= 20, true);
    assert.equal(first.diagnostics.virtualAttachmentCount >= 5, true);

    const sprint = first.clips.find((clip) => clip.sourceClipName === 'Sprint_Loop');
    assert.ok(sprint);
    assert.equal(sprint.cleanClipIds.includes('clean_sprint'), true);
    assert.equal(sprint.joints.thighLeft?.quaternions.length, sprint.frameCount);
    assert.equal(sprint.joints.calfRight?.quaternions.length, sprint.frameCount);
    assert.equal(sprint.jointOffsets.upperArmRight?.offsets.length, sprint.frameCount);
    assert.equal(sprint.driverJoints.pelvis?.positions.length, sprint.frameCount);
    assert.equal(sprint.driverJoints.hand_r?.quaternions.length, sprint.frameCount);
    assert.equal(sprint.driverJoints.root?.positions[0].every(Number.isFinite), true);
    assert.equal(sprint.metrics.maxAbsJointOffset > 0, true);
  });

  it('builds a Mesh2Motion driver calibration with torso and virtual attachment mappings', () => {
    const artifact = buildV3Mesh2MotionClipSetArtifact({ filePath: sourceFilePath, fps: 30 });

    assert.equal(artifact.calibration.joints.spine3?.sourceNodeName, 'spine_03');
    assert.equal(artifact.calibration.joints.spine3?.role, 'direct');
    assert.equal(artifact.calibration.joints.chest?.sourceNodeName, 'spine_03');
    assert.equal(artifact.calibration.joints.chest?.role, 'virtualAttachment');
    assert.equal(artifact.calibration.joints.helmet?.sourceNodeName, 'head');
    assert.equal(artifact.calibration.joints.gripRight?.sourceNodeName, 'hand_r');
    assert.equal(artifact.diagnostics.unmappedSourceJoints.includes('index_01_l'), true);
    assert.equal(artifact.diagnostics.unmappedV3Joints.length, 0);
  });

  it('calibrates TPose to near-rest V3 clean rig output', () => {
    const artifact = buildV3Mesh2MotionClipSetArtifact({ filePath: sourceFilePath, fps: 30 });
    const tPose = artifact.clips.find((clip) => clip.sourceClipName === 'TPose');
    assert.ok(tPose);

    assert.ok(tPose.metrics.maxAbsJointOffset < 0.00001, `TPose offset drift ${tPose.metrics.maxAbsJointOffset}`);
    assert.ok(tPose.metrics.maxAbsRotation < 0.00001, `TPose rotation drift ${tPose.metrics.maxAbsRotation}`);
    for (const track of Object.values(tPose.joints)) {
      for (const quaternion of track.quaternions) {
        assert.ok(Math.abs(quaternion[0]) < 0.00001);
        assert.ok(Math.abs(quaternion[1]) < 0.00001);
        assert.ok(Math.abs(quaternion[2]) < 0.00001);
        assert.ok(Math.abs(quaternion[3] - 1) < 0.00001);
      }
    }
    for (const [jointName, track] of Object.entries(tPose.driverJoints)) {
      const restJoint = artifact.skeleton.joints.find((joint) => joint.name === jointName);
      assert.ok(restJoint, `${jointName} should be present in skeleton metadata`);
      assert.deepEqual(track.positions[0], restJoint.restLocalPosition);
      assert.deepEqual(track.quaternions[0], restJoint.restLocalQuaternion);
    }
  });

  it('declares first-pass clean-rig replacements for sprint, slide, and sword clips only', () => {
    assert.deepEqual(V3_MESH2MOTION_CLEAN_CLIP_BINDINGS, {
      clean_sprint: 'Sprint_Loop',
      clean_slide: 'Slide_Loop',
      clean_sword_carry: 'Sword_Idle',
      clean_sword_lunge: 'Sword_Dash_RM',
      clean_sword_slash: 'Sword_Regular_B',
    });
  });

  it('strips horizontal root motion and keeps bounded vertical root offsets', () => {
    const artifact = buildV3Mesh2MotionClipSetArtifact({ filePath: sourceFilePath, fps: 30 });
    const swordDash = artifact.clips.find((clip) => clip.sourceClipName === 'Sword_Dash_RM');
    const slideLoop = artifact.clips.find((clip) => clip.sourceClipName === 'Slide_Loop');
    assert.ok(swordDash);
    assert.ok(slideLoop);

    assert.equal(swordDash.rootMotion.horizontalStripped, true);
    assert.equal(swordDash.rootMotion.maxSourceHorizontalOffset > 3, true);
    assert.equal(swordDash.rootMotion.maxHorizontalOffset, 0);
    assert.equal(slideLoop.rootMotion.maxHorizontalOffset, 0);

    for (const clip of artifact.clips) {
      for (const offset of clip.rootOffsets) {
        assert.equal(offset[0], 0);
        assert.equal(offset[2], 0);
        assert.equal(Math.abs(offset[1]) <= 0.4, true);
      }
    }
  });

  it('does not persist raw GLB payloads, private paths, meshes, skins, or scene graphs', () => {
    const artifact = buildV3Mesh2MotionClipSetArtifact({ filePath: sourceFilePath, fps: 30 });
    const source = buildV3Mesh2MotionGeneratedSource(artifact);

    assert.equal(source.includes(process.cwd()), false);
    assert.equal(source.includes('C:'), false);
    assert.equal(source.includes('G:'), false);
    assert.equal(source.includes('ArrayBuffer'), false);
    assert.equal(source.includes('bufferView'), false);
    assert.equal(source.includes('accessors'), false);
    assert.equal(source.includes('skins'), false);
    assert.equal(source.includes('meshes'), false);
    assert.equal(source.includes('nodes'), false);
  });
});
