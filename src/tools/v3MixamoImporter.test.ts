import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import {
  V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES,
  buildV3MixamoClipArtifact,
  buildV3MixamoClipSetArtifact,
  buildV3MixamoWeaponReferenceClipArtifact,
  buildV3MixamoWeaponReferenceSetArtifact,
} from './v3MixamoImporter';

const referenceRoot = join(process.cwd(), 'reference', 'mixamo-v3');

const sourceFiles = {
  idle: join(referenceRoot, 'Idle.fbx'),
  walk: join(referenceRoot, 'Walking.fbx'),
  run: join(referenceRoot, 'Running.fbx'),
  tPose: join(referenceRoot, 'T-Pose.fbx'),
} as const;

const weaponReferenceSourceFiles = {
  hammer_2hand_idle: join(referenceRoot, V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES.hammer_2hand_idle),
  hammer_heavy_swing: join(referenceRoot, V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES.hammer_heavy_swing),
  hammer_melee_advance: join(referenceRoot, V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES.hammer_melee_advance),
  sword_outward_slash: join(referenceRoot, V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES.sword_outward_slash),
  hammer_smash_reference: join(referenceRoot, V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES.hammer_smash_reference),
} as const;

describe('v3MixamoImporter', () => {
  it('imports the same local Mixamo FBX into a deterministic sanitized clip artifact', () => {
    const first = buildV3MixamoClipArtifact({
      clipId: 'walk',
      filePath: sourceFiles.walk,
      fps: 30,
    });
    const second = buildV3MixamoClipArtifact({
      clipId: 'walk',
      filePath: sourceFiles.walk,
      fps: 30,
    });

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, 'v3-mixamo-clip/v1');
    assert.equal(first.clipId, 'walk');
    assert.equal(first.fps, 30);
    assert.equal(first.source.fileName, 'Walking.fbx');
    assert.match(first.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.joints.pelvis.rotations.length, first.frameCount);
    assert.equal(first.joints.pelvis.offsets.length, first.frameCount);
    assert.equal(first.metrics.mappedJointCount >= 18, true);
    assert.equal(first.metrics.sourceTrackCount, 53);
  });

  it('does not persist raw FBX payloads, private paths, mesh geometry, or scene graphs', () => {
    const artifact = buildV3MixamoClipArtifact({
      clipId: 'idle',
      filePath: sourceFiles.idle,
      fps: 30,
    });
    const serialized = JSON.stringify(artifact);

    assert.equal(serialized.includes(referenceRoot), false);
    assert.equal(serialized.includes(process.cwd()), false);
    assert.equal(serialized.includes('G:'), false);
    assert.equal(serialized.includes('C:'), false);
    assert.equal(serialized.includes('ArrayBuffer'), false);
    assert.equal(serialized.includes('scene'), false);
    assert.equal(serialized.includes('children'), false);
    assert.equal(serialized.includes('geometry'), false);
    assert.equal(serialized.includes('vertices'), false);
    assert.equal(serialized.includes('raw'), false);
  });

  it('uses the local T-pose as a dedupe source without emitting a runtime T-pose clip', () => {
    const clipSet = buildV3MixamoClipSetArtifact({
      sourceFiles,
      fps: 30,
    });

    assert.deepEqual(clipSet.clips.map((clip) => clip.clipId), ['idle', 'walk', 'run']);
    assert.equal(clipSet.sources.tPose.fileName, 'T-Pose.fbx');
    assert.match(clipSet.sources.tPose.sha256, /^[a-f0-9]{64}$/);
    assert.equal(clipSet.metrics.tPoseDeduped, true);
    assert.equal(clipSet.metrics.sourceFileCount, 4);
    assert.equal(JSON.stringify(clipSet).includes('T-Pose.position'), false);
  });

  it('strips horizontal hips root motion and keeps vertical pelvis offset bounded', () => {
    const walk = buildV3MixamoClipArtifact({
      clipId: 'walk',
      filePath: sourceFiles.walk,
      fps: 30,
    });
    const run = buildV3MixamoClipArtifact({
      clipId: 'run',
      filePath: sourceFiles.run,
      fps: 30,
    });

    for (const artifact of [walk, run]) {
      assert.equal(artifact.metrics.rootMotion.horizontalStripped, true);
      assert.equal(artifact.metrics.rootMotion.maxSourceHorizontalOffset > 1, true);
      assert.equal(artifact.metrics.rootMotion.maxHorizontalOffset, 0);
      assert.equal(artifact.metrics.rootMotion.maxVerticalPelvisOffset <= 0.35, true);
      for (const offset of artifact.joints.pelvis.offsets) {
        assert.equal(offset[0], 0);
        assert.equal(offset[2], 0);
        assert.equal(Math.abs(offset[1]) <= 0.35, true);
      }
    }
  });

  it('imports weapon reference clips with sanitized chest-space upper-body samples', () => {
    const first = buildV3MixamoWeaponReferenceClipArtifact({
      clipId: 'hammer_2hand_idle',
      filePath: weaponReferenceSourceFiles.hammer_2hand_idle,
      fps: 30,
    });
    const second = buildV3MixamoWeaponReferenceClipArtifact({
      clipId: 'hammer_2hand_idle',
      filePath: weaponReferenceSourceFiles.hammer_2hand_idle,
      fps: 30,
    });

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, 'v3-mixamo-weapon-reference-clip/v1');
    assert.equal(first.clipId, 'hammer_2hand_idle');
    assert.equal(first.source.fileName, 'hammer_2hand_idle.fbx');
    assert.match(first.source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(first.frameCount > 1);
    assert.ok(first.duration > 0);
    assert.ok(first.metrics.mappedJointCount >= 9);
    assert.ok(first.metrics.handPathDistance.right > 0);
    assert.ok(first.metrics.handSeparation.max > first.metrics.handSeparation.min);
    assert.equal(first.metrics.nonFiniteTransformCount, 0);

    const firstFrame = first.keyframes[0];
    assert.ok(firstFrame.joints.chest);
    assert.ok(firstFrame.joints.handRight);
    assert.ok(firstFrame.joints.handLeft);
    assert.deepEqual(firstFrame.joints.chest.position, [0, 0, 0]);
    assert.equal(firstFrame.joints.handRight.quaternion.length, 4);
    assert.equal(firstFrame.joints.handRight.quaternion.every(Number.isFinite), true);
    assert.equal(firstFrame.joints.handRight.position.every(Number.isFinite), true);
    assert.equal(firstFrame.joints.handLeft.position.every(Number.isFinite), true);
  });

  it('builds a weapon reference set and marks Smash as analysis-only', () => {
    const referenceSet = buildV3MixamoWeaponReferenceSetArtifact({
      sourceFiles: weaponReferenceSourceFiles,
      fps: 30,
    });

    assert.equal(referenceSet.schemaVersion, 'v3-mixamo-weapon-reference-set/v1');
    assert.deepEqual(
      referenceSet.clips.map((clip) => clip.clipId),
      [
        'hammer_2hand_idle',
        'hammer_heavy_swing',
        'hammer_melee_advance',
        'sword_outward_slash',
        'hammer_smash_reference',
      ]
    );
    assert.equal(referenceSet.sources.hammer_smash_reference.fileName, 'Smash.fbx');
    assert.equal(
      referenceSet.clips.find((clip) => clip.clipId === 'hammer_smash_reference')?.runtimeRole,
      'analysisOnly'
    );
    assert.equal(referenceSet.metrics.clipCount, 5);
    assert.equal(referenceSet.metrics.analysisOnlyClipCount, 1);
    assert.equal(referenceSet.restPose.source.fileName, 'T-Pose.fbx');
    assert.match(referenceSet.restPose.source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(referenceSet.restPose.joints.chest);
    assert.ok(referenceSet.restPose.joints.upperArmRight);
    assert.equal(referenceSet.restPose.joints.upperArmRight.quaternion.length, 4);
    assert.equal(referenceSet.restPose.joints.upperArmRight.position.every(Number.isFinite), true);

    const serialized = JSON.stringify(referenceSet);
    assert.equal(serialized.includes(referenceRoot), false);
    assert.equal(serialized.includes(process.cwd()), false);
    assert.equal(serialized.includes('G:'), false);
    assert.equal(serialized.includes('C:'), false);
    assert.equal(serialized.includes('mixamorig'), false);
    assert.equal(serialized.includes('FBXHeaderExtension'), false);
    assert.equal(serialized.includes('Vertices:'), false);
  });
});
