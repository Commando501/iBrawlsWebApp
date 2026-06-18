import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseV3ObjMetadata } from './v3ObjParser';
import {
  buildV3ObjVoxelizationArtifact,
  expandV3ObjVoxelRuns,
  summarizeV3ObjVoxelArtifact,
} from './v3ObjVoxelizer';
import { V3_CHARACTER_SLOT_IDS } from '../components/v3/v3ModelTypes';

const syntheticObj = (): string => [
  'o Helmet:_Mark_V_[B]',
  'usemtl spartan_helmet_default',
  'v -0.12 1.74 -0.1',
  'v 0.12 1.74 -0.1',
  'v 0.12 2.02 0.18',
  'v -0.12 2.02 0.18',
  'f 1 2 3',
  'f 1 3 4',
  'usemtl spartan_visor_default',
  'v -0.09 1.86 0.19',
  'v 0.09 1.86 0.19',
  'v 0.09 1.9 0.2',
  'v -0.09 1.9 0.2',
  'f 5 6 7',
  'f 5 7 8',
  'o Male_Equipment_Pack',
  'usemtl unsc_equipment_metal',
  'v -0.09 1.25 -0.24',
  'v 0.09 1.25 -0.24',
  'v 0.09 1.56 -0.16',
  'v -0.09 1.56 -0.16',
  'f 9 10 11',
  'f 9 11 12',
  'o Male_Arm_L',
  'usemtl spartan_fp_armor',
  'v 0.18 0.98 -0.14',
  'v 0.55 0.98 -0.14',
  'v 0.55 1.7 0.32',
  'v 0.18 1.7 0.32',
  'f 13 14 15',
  'f 13 15 16',
  'usemtl spartan_fp_glove',
  'v 0.2 0.9 0.1',
  'v 0.48 0.9 0.1',
  'v 0.48 1.02 0.28',
  'v 0.2 1.02 0.28',
  'f 17 18 19',
  'f 17 19 20',
  'o Male_Arm_R',
  'usemtl spartan_fp_armor',
  'v -0.55 0.98 -0.14',
  'v -0.18 0.98 -0.14',
  'v -0.18 1.7 0.32',
  'v -0.55 1.7 0.32',
  'f 21 22 23',
  'f 21 23 24',
  'usemtl spartan_fp_glove',
  'v -0.48 0.9 0.1',
  'v -0.2 0.9 0.1',
  'v -0.2 1.02 0.28',
  'v -0.48 1.02 0.28',
  'f 25 26 27',
  'f 25 27 28',
  'o Knee_Guards:_Default_L',
  'usemtl spartan_kat_robotarm',
  'v 0.13 0.48 0.02',
  'v 0.28 0.48 0.02',
  'v 0.28 0.64 0.14',
  'v 0.13 0.64 0.14',
  'f 29 30 31',
  'f 29 31 32',
  'o Knee_Guards:_Default_R',
  'usemtl spartan_kat_robotarm',
  'v -0.28 0.48 0.02',
  'v -0.13 0.48 0.02',
  'v -0.13 0.64 0.14',
  'v -0.28 0.64 0.14',
  'f 33 34 35',
  'f 33 35 36',
  'o Male_Body',
  'usemtl spartan_armor',
  'v -0.34 0.02 -0.2',
  'v 0.34 0.02 -0.2',
  'v 0.34 1.72 0.22',
  'v -0.34 1.72 0.22',
  'f 37 38 39',
  'f 37 39 40',
  'usemtl spartan_rubber_suit',
  'v -0.12 0.08 -0.04',
  'v 0.12 0.08 -0.04',
  'v 0.12 1.55 0.05',
  'v -0.12 1.55 0.05',
  'f 41 42 43',
  'f 41 43 44',
].join('\n');

describe('buildV3ObjVoxelizationArtifact', () => {
  it('voxelizes a synthetic OBJ into every V3 character slot with compact deterministic runs', () => {
    const objText = syntheticObj();
    const artifact = buildV3ObjVoxelizationArtifact({
      objText,
      fileName: 'synthetic-reference.obj',
      gridScale: 4,
    });
    const repeated = buildV3ObjVoxelizationArtifact({
      metadata: parseV3ObjMetadata(objText),
      fileName: 'synthetic-reference.obj',
      gridScale: 4,
    });

    assert.equal(artifact.schemaVersion, 'v3-obj-voxelization/v1');
    assert.equal(artifact.source.kind, 'obj');
    assert.match(artifact.source.hash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(artifact.slots).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
    assert.deepEqual(artifact, repeated);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.ok(artifact.slots[slot].voxelCount > 0, `${slot} should receive reference voxels`);
      assert.ok(artifact.slots[slot].runs.length > 0, `${slot} should encode compact voxel runs`);
      assert.equal(expandV3ObjVoxelRuns(artifact.slots[slot]).length, artifact.slots[slot].voxelCount);
    }
  });

  it('preserves visor/emissive and undersuit role hints without leaking raw OBJ payloads', () => {
    const artifact = buildV3ObjVoxelizationArtifact({
      objText: syntheticObj(),
      fileName: 'C:/private/Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
      gridScale: 4,
    });
    const serialized = JSON.stringify(artifact);
    const helmetVoxels = expandV3ObjVoxelRuns(artifact.slots.helmet);
    const chestVoxels = expandV3ObjVoxelRuns(artifact.slots.chest);
    const summary = summarizeV3ObjVoxelArtifact(artifact);

    assert.ok(helmetVoxels.some((voxel) => voxel.role === 'visor' && voxel.emissive === true));
    assert.ok(chestVoxels.some((voxel) => voxel.role === 'undersuit'));
    assert.equal(summary.slotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(summary.gridScale, 4);
    assert.equal(serialized.includes('C:/private'), false);
    assert.equal(serialized.includes('v -0.12'), false);
    assert.equal(serialized.includes('"triangles"'), false);
    assert.equal(serialized.includes('"referencedVertexIndexes"'), false);
  });

  it('keeps paired slot voxel signatures mirrored for symmetric reference input', () => {
    const artifact = buildV3ObjVoxelizationArtifact({
      objText: syntheticObj(),
      fileName: 'synthetic-reference.obj',
      gridScale: 4,
    });
    const left = expandV3ObjVoxelRuns(artifact.slots.shinLeft);
    const right = expandV3ObjVoxelRuns(artifact.slots.shinRight);
    const leftSignature = new Set(left.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}:${voxel.role}`));
    const mirroredRight = right.map((voxel) => (
      `${artifact.slots.shinRight.bounds.size[0] - 1 - voxel.x}:${voxel.y}:${voxel.z}:${voxel.role}`
    ));

    assert.ok(mirroredRight.length > 0);
    assert.equal(mirroredRight.every((entry) => leftSignature.has(entry)), true);
  });
});
