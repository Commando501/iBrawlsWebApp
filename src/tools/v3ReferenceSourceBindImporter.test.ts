import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join, resolve } from 'node:path';
import {
  V3_REFERENCE_SOURCE_BIND_SCHEMA,
  buildV3ReferenceSourceBindArtifact,
  buildV3ReferenceSourceBindGeneratedSource,
  parseV3ReferenceSourceBindImporterCliArgs,
} from './v3ReferenceSourceBindImporter';

const sourceFilePath = join(process.cwd(), 'reference', 'v3-source-bind', 'v3-reference-tpose-source.glb');

describe('v3ReferenceSourceBindImporter', () => {
  it('imports the Blender reference GLB into deterministic sanitized source bind data', () => {
    const first = buildV3ReferenceSourceBindArtifact({ filePath: sourceFilePath });
    const second = buildV3ReferenceSourceBindArtifact({ filePath: sourceFilePath });

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, V3_REFERENCE_SOURCE_BIND_SCHEMA);
    assert.equal(first.source.kind, 'blender-reference-glb');
    assert.equal(first.source.fileName, 'v3-reference-tpose-source.glb');
    assert.match(first.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.skeleton.skinJointCount >= 80, true);
    assert.equal(first.skeleton.bones.b_l_upperarm.parent, 'b_l_clav');
    assert.equal(first.skeleton.bones.b_l_forearm.parent, 'b_l_upperarm');
    assert.equal(first.skeleton.bones.b_l_hand.parent, 'wristIK.L');
    assert.equal(first.skeleton.bones.b_l_thigh.parent, 'b_pelvis');
    assert.equal(first.skeleton.bones.b_l_calf.parent, 'b_l_thigh');
    assert.equal(first.skeleton.bones.b_l_foot.parent, 'heelIK.L');
    assert.equal(first.skeleton.bones.b_r_upperarm.parent, 'b_r_clav');
    assert.equal(first.skeleton.bones.b_r_thigh.parent, 'b_pelvis');
    assert.equal(first.diagnostics.missingRequiredBones.length, 0);
  });

  it('captures the original source arm chain as a horizontal T-pose bind frame', () => {
    const artifact = buildV3ReferenceSourceBindArtifact({ filePath: sourceFilePath });
    const leftUpperArm = artifact.slots.upperArmLeft;
    const leftForearm = artifact.slots.forearmLeft;
    const leftHand = artifact.slots.handLeft;
    const rightUpperArm = artifact.slots.upperArmRight;

    assert.equal(leftUpperArm.sourceBoneName, 'b_l_upperarm');
    assert.equal(leftUpperArm.endBoneName, 'b_l_forearm');
    assert.equal(leftUpperArm.mesh2MotionJointName, 'upperarm_l');
    assert.equal(leftUpperArm.sourceSegmentAxis[0] > 0.98, true);
    assert.equal(Math.abs(leftUpperArm.sourceSegmentAxis[1]) < 0.0001, true);
    assert.equal(leftForearm.sourceSegmentAxis[0] > 0.98, true);
    assert.equal(leftHand.sourceSegmentAxis[0] > 0.9, true);
    assert.equal(rightUpperArm.sourceSegmentAxis[0] < -0.98, true);
    assert.equal(leftUpperArm.sourceBasis.yAxis[0] > 0.98, true);
    assert.equal(leftUpperArm.sourceBasis.zAxis[2] < -0.85, true);
    assert.equal(artifact.diagnostics.armChainMaxVerticalDelta < 0.04, true);
  });

  it('captures lower-body bind frames with Blender roll and Mesh2Motion foot convention', () => {
    const artifact = buildV3ReferenceSourceBindArtifact({ filePath: sourceFilePath });
    const leftThigh = artifact.slots.thighLeft;
    const leftShin = artifact.slots.shinLeft;
    const leftFoot = artifact.slots.footLeft;
    const rightThigh = artifact.slots.thighRight;
    const rightFoot = artifact.slots.footRight;

    assert.equal(leftThigh.sourceBoneName, 'b_l_thigh');
    assert.equal(leftThigh.endBoneName, 'b_l_calf');
    assert.equal(leftThigh.mesh2MotionJointName, 'thigh_l');
    assert.equal(leftShin.sourceBoneName, 'b_l_calf');
    assert.equal(leftShin.mesh2MotionJointName, 'calf_l');
    assert.equal(leftThigh.sourceSegmentAxis[1] < -0.9, true);
    assert.equal(rightThigh.sourceSegmentAxis[1] < -0.9, true);
    assert.equal(leftThigh.sourceBasis.zAxis[0] < -0.9, true);
    assert.equal(rightThigh.sourceBasis.zAxis[0] > 0.9, true);
    assert.equal(leftFoot.sourceBoneName, 'b_l_foot');
    assert.equal(leftFoot.mesh2MotionJointName, 'foot_l');
    assert.equal(leftFoot.sourceBasis.yAxis[1] > 0.99, true);
    assert.equal(leftFoot.sourceBasis.zAxis[2] > 0.95, true);
    assert.equal(rightFoot.sourceBasis.yAxis[1] > 0.99, true);
    assert.equal(rightFoot.sourceBasis.zAxis[2] > 0.95, true);
  });

  it('does not persist raw GLB payloads, private paths, meshes, skins, or scene graph nodes', () => {
    const artifact = buildV3ReferenceSourceBindArtifact({ filePath: sourceFilePath });
    const source = buildV3ReferenceSourceBindGeneratedSource(artifact);

    assert.equal(source.includes(process.cwd()), false);
    assert.equal(source.includes('C:'), false);
    assert.equal(source.includes('G:'), false);
    assert.equal(source.includes('ArrayBuffer'), false);
    assert.equal(source.includes('bufferView'), false);
    assert.equal(source.includes('accessors'), false);
    assert.equal(source.includes('meshes'), false);
    assert.equal(source.includes('skins'), false);
    assert.equal(source.includes('nodes'), false);
  });

  it('parses direct importer CLI args', () => {
    const args = parseV3ReferenceSourceBindImporterCliArgs([
      '--input',
      sourceFilePath,
      '--out',
      'tmp/v3ReferenceSourceBind.generated.ts',
    ]);

    assert.equal(args.filePath, sourceFilePath);
    assert.equal(args.outputPath, resolve('tmp/v3ReferenceSourceBind.generated.ts'));
  });
});
