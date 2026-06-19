import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildV3AegisGeneratedSource,
  generateV3AegisReferenceVoxelSourceFile,
} from './generateV3AegisFromObj';
import { buildV3ObjVoxelizationArtifact } from './v3ObjVoxelizer';
import { buildV3ObjSurfaceVoxelizationArtifact } from './v3ObjSurfaceVoxelizer';

const objText = [
  'o Helmet:_Mark_V_[B]',
  'usemtl spartan_visor_default',
  'v -0.1 1.8 0',
  'v 0.1 1.8 0',
  'v 0.1 2 0.2',
  'v -0.1 2 0.2',
  'f 1 2 3',
  'f 1 3 4',
  'o Male_Body',
  'usemtl spartan_armor',
  'v -0.35 0 -0.2',
  'v 0.35 0 -0.2',
  'v 0.35 1.75 0.25',
  'v -0.35 1.75 0.25',
  'f 5 6 7',
  'f 5 7 8',
  'usemtl spartan_rubber_suit',
  'v -0.1 0.05 -0.05',
  'v 0.1 0.05 -0.05',
  'v 0.1 1.55 0.05',
  'v -0.1 1.55 0.05',
  'f 9 10 11',
  'f 9 11 12',
  'o Male_Arm_L',
  'usemtl spartan_fp_armor',
  'v 0.2 0.9 -0.1',
  'v 0.55 0.9 -0.1',
  'v 0.55 1.7 0.3',
  'v 0.2 1.7 0.3',
  'f 13 14 15',
  'f 13 15 16',
  'o Male_Arm_R',
  'usemtl spartan_fp_armor',
  'v -0.55 0.9 -0.1',
  'v -0.2 0.9 -0.1',
  'v -0.2 1.7 0.3',
  'v -0.55 1.7 0.3',
  'f 17 18 19',
  'f 17 19 20',
].join('\n');

describe('generateV3AegisFromObj', () => {
  it('formats a checked-in generated TypeScript source without raw OBJ data or private paths', () => {
    const artifact = buildV3ObjVoxelizationArtifact({
      objText,
      fileName: 'C:/private/reference.obj',
      gridScale: 4,
    });
    const source = buildV3AegisGeneratedSource(artifact);

    assert.match(source, /V3_AEGIS_REFERENCE_VOXEL_SOURCE/);
    assert.match(source, /v3-aegis-reference-voxels\/v1/);
    assert.match(source, /reference\.obj/);
    assert.equal(source.includes('C:/private'), false);
    assert.equal(source.includes('v -0.1'), false);
    assert.equal(source.includes('"triangles"'), false);
    assert.equal(source.includes('as const'), true);
  });

  it('formats an exact OBJ surface source with global voxel metadata and no raw payloads', () => {
    const artifact = buildV3ObjSurfaceVoxelizationArtifact({
      objText,
      mtlText: [
        'newmtl spartan_visor_default',
        'Ke 0.2 0.9 1.0',
      ].join('\n'),
      fileName: 'C:/private/reference.obj',
    }, {
      targetHeightVoxels: 48,
      surfaceThicknessVoxels: 1,
    });
    const source = buildV3AegisGeneratedSource(artifact);

    assert.match(source, /V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE/);
    assert.match(source, /v3-obj-surface-voxels\/v1/);
    assert.match(source, /"targetHeightVoxels":48/);
    assert.match(source, /"voxelScale":/);
    assert.equal(source.includes('C:/private'), false);
    assert.equal(source.includes('v -0.1'), false);
    assert.equal(source.includes('"triangles"'), false);
    assert.equal(source.includes('spartan_visor_default\\n'), false);
  });

  it('generates an exact surface source file from a local OBJ path using only sanitized metadata', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'ibrawls-v3-aegis-'));
    try {
      const inputPath = join(tempRoot, 'private-reference.obj');
      const mtlPath = join(tempRoot, 'local.mtl');
      const outputPath = join(tempRoot, 'v3AegisObjSurfaceVoxels.generated.ts');
      writeFileSync(inputPath, `mtllib local.mtl\n${objText}`, 'utf8');
      writeFileSync(mtlPath, 'newmtl spartan_visor_default\nKe 0.2 0.9 1.0\n', 'utf8');

      const artifact = generateV3AegisReferenceVoxelSourceFile({
        inputPath,
        outputPath,
        mode: 'surface',
        targetHeightVoxels: 48,
      });
      const generated = readFileSync(outputPath, 'utf8');

      assert.equal(artifact.schemaVersion, 'v3-obj-surface-voxels/v1');
      assert.equal(artifact.options.targetHeightVoxels, 48);
      assert.ok(artifact.metrics.totalVoxelCount > 0);
      assert.match(generated, /private-reference\.obj/);
      assert.match(generated, /V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE/);
      assert.equal(generated.includes(tempRoot), false);
      assert.equal(generated.includes('v -0.1'), false);
      assert.equal(generated.includes('Ke 0.2'), false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
