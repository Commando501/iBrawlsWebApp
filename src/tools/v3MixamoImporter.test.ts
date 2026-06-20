import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import {
  buildV3MixamoClipArtifact,
  buildV3MixamoClipSetArtifact,
} from './v3MixamoImporter';

const referenceRoot = join(process.cwd(), 'reference', 'mixamo-v3');

const sourceFiles = {
  idle: join(referenceRoot, 'Idle.fbx'),
  walk: join(referenceRoot, 'Walking.fbx'),
  run: join(referenceRoot, 'Running.fbx'),
  tPose: join(referenceRoot, 'T-Pose.fbx'),
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
});
