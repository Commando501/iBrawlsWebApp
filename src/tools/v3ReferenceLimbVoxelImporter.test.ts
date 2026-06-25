import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join, resolve } from 'node:path';
import {
  V3_REFERENCE_LIMB_VOXEL_SCHEMA,
  buildV3ReferenceLimbVoxelArtifact,
  buildV3ReferenceLimbVoxelGeneratedSource,
  parseV3ReferenceLimbVoxelImporterCliArgs,
} from './v3ReferenceLimbVoxelImporter';

const sourceFilePath = join(process.cwd(), 'reference', 'v3-source-bind', 'v3-reference-tpose-source.glb');

const ARM_CHAIN_SLOTS = [
  'shoulderLeft',
  'upperArmLeft',
  'forearmLeft',
  'handLeft',
  'shoulderRight',
  'upperArmRight',
  'forearmRight',
  'handRight',
] as const;

describe('v3ReferenceLimbVoxelImporter', () => {
  it('regenerates deterministic sanitized limb voxels from the rigged Blender T-pose GLB', () => {
    const first = buildV3ReferenceLimbVoxelArtifact({ filePath: sourceFilePath });
    const second = buildV3ReferenceLimbVoxelArtifact({ filePath: sourceFilePath });

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, V3_REFERENCE_LIMB_VOXEL_SCHEMA);
    assert.equal(first.version, 1);
    assert.equal(first.source.kind, 'blender-reference-glb');
    assert.equal(first.source.fileName, 'v3-reference-tpose-source.glb');
    assert.match(first.source.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(first.slots).sort(), [...ARM_CHAIN_SLOTS].sort());
    assert.equal(first.metrics.slotCount, ARM_CHAIN_SLOTS.length);
    assert.equal(first.metrics.totalVoxelCount > 3000, true);
    assert.equal(first.diagnostics.missingArmMeshNodes.length, 0);
    assert.equal(first.diagnostics.unassignedTriangleCount < 20, true);

    for (const slot of ARM_CHAIN_SLOTS) {
      const sourceSlot = first.slots[slot];
      assert.equal(sourceSlot.slot, slot);
      assert.equal(sourceSlot.voxelCount > 100, true, `${slot} should contain regenerated limb voxels`);
      assert.equal(sourceSlot.runCount > 25, true, `${slot} should contain compact source runs`);
      assert.equal(sourceSlot.bounds.size.every((value) => value > 0), true, `${slot} bounds should be finite`);
      assert.equal(sourceSlot.roleHintIndexes.length > 0, true, `${slot} should preserve material role hints`);
    }
  });

  it('keeps regenerated arm slots in the GLB T-pose arm-chain order', () => {
    const artifact = buildV3ReferenceLimbVoxelArtifact({ filePath: sourceFilePath });
    const left = [
      artifact.slots.shoulderLeft,
      artifact.slots.upperArmLeft,
      artifact.slots.forearmLeft,
      artifact.slots.handLeft,
    ];
    const right = [
      artifact.slots.shoulderRight,
      artifact.slots.upperArmRight,
      artifact.slots.forearmRight,
      artifact.slots.handRight,
    ];

    assert.equal(left[0].worldCenter[0] < left[1].worldCenter[0], true);
    assert.equal(left[1].worldCenter[0] < left[2].worldCenter[0], true);
    assert.equal(left[2].worldCenter[0] < left[3].worldCenter[0], true);
    assert.equal(right[0].worldCenter[0] > right[1].worldCenter[0], true);
    assert.equal(right[1].worldCenter[0] > right[2].worldCenter[0], true);
    assert.equal(right[2].worldCenter[0] > right[3].worldCenter[0], true);

    for (const pair of [
      ['shoulderLeft', 'shoulderRight'],
      ['upperArmLeft', 'upperArmRight'],
      ['forearmLeft', 'forearmRight'],
      ['handLeft', 'handRight'],
    ] as const) {
      const leftSlot = artifact.slots[pair[0]];
      const rightSlot = artifact.slots[pair[1]];
      assert.equal(Math.abs(leftSlot.worldCenter[0] + rightSlot.worldCenter[0]) < 0.04, true, pair.join('/'));
      assert.equal(Math.abs(leftSlot.worldCenter[1] - rightSlot.worldCenter[1]) < 0.02, true, pair.join('/'));
      assert.equal(Math.abs(leftSlot.worldCenter[2] - rightSlot.worldCenter[2]) < 0.04, true, pair.join('/'));
    }

    const leftVerticalSpread = Math.max(...left.map((slot) => slot.worldCenter[1])) -
      Math.min(...left.map((slot) => slot.worldCenter[1]));
    const rightVerticalSpread = Math.max(...right.map((slot) => slot.worldCenter[1])) -
      Math.min(...right.map((slot) => slot.worldCenter[1]));
    assert.equal(leftVerticalSpread < 0.18, true);
    assert.equal(rightVerticalSpread < 0.18, true);
  });

  it('does not persist raw GLB payloads, private paths, meshes, skins, or scene graph nodes', () => {
    const artifact = buildV3ReferenceLimbVoxelArtifact({ filePath: sourceFilePath });
    const source = buildV3ReferenceLimbVoxelGeneratedSource(artifact);

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
    const args = parseV3ReferenceLimbVoxelImporterCliArgs([
      '--input',
      sourceFilePath,
      '--out',
      'tmp/v3ReferenceLimbVoxels.generated.ts',
    ]);

    assert.equal(args.filePath, sourceFilePath);
    assert.equal(args.outputPath, resolve('tmp/v3ReferenceLimbVoxels.generated.ts'));
  });
});
