import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  V3_OBJ_SURFACE_DEFAULT_TARGET_HEIGHT_VOXELS,
  V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA,
  buildV3ObjSurfaceVoxelizationArtifact,
  expandV3ObjSurfaceVoxelRuns,
  summarizeV3ObjSurfaceVoxelArtifact,
} from './v3ObjSurfaceVoxelizer';

const tiltedTriangleObj = `
mtllib local.mtl
o Male_Body
usemtl spartan_armor
v -0.35 0.0 0.00
v 0.35 1.0 0.22
v -0.18 0.18 0.62
f 1 2 3
`;

describe('buildV3ObjSurfaceVoxelizationArtifact', () => {
  it('voxelizes a tilted triangle as a continuous surface instead of sparse samples', () => {
    const artifact = buildV3ObjSurfaceVoxelizationArtifact({
      objText: tiltedTriangleObj,
      fileName: 'G:\\private\\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
    }, {
      targetHeightVoxels: 32,
      surfaceThicknessVoxels: 1,
    });
    const voxels = expandV3ObjSurfaceVoxelRuns(artifact);
    const yLevels = new Set(voxels.map((voxel) => voxel.y));
    const xLevels = new Set(voxels.map((voxel) => voxel.x));
    const zLevels = new Set(voxels.map((voxel) => voxel.z));

    assert.equal(artifact.schemaVersion, V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA);
    assert.equal(artifact.options.targetHeightVoxels, 32);
    assert.ok(voxels.length > 48, `expected dense surface voxels, saw ${voxels.length}`);
    assert.ok(yLevels.size > 10, `expected continuous Y coverage, saw ${yLevels.size}`);
    assert.ok(xLevels.size > 8, `expected continuous X coverage, saw ${xLevels.size}`);
    assert.ok(zLevels.size > 8, `expected continuous Z coverage, saw ${zLevels.size}`);
    assert.equal(artifact.coordinateSystem.dimensions[1], 32);
  });

  it('excludes weapons, props, and unknown objects unless explicitly requested', () => {
    const artifact = buildV3ObjSurfaceVoxelizationArtifact({
      objText: `
o Gravity_Hammer_Handle
usemtl spartan_armor
v 0 0 0
v 0 1 0
v 1 0 0
f 1 2 3
o Decorative_Prop
usemtl spartan_armor
v 3 0 0
v 3 1 0
v 4 0 0
f 4 5 6
o Male_Body
usemtl spartan_armor
v 0 0 1
v 0 1 1
v 1 0 1
f 7 8 9
`,
      fileName: 'reference.obj',
    }, {
      targetHeightVoxels: 24,
    });

    assert.equal(artifact.metrics.bodyObjectCount, 1);
    assert.equal(artifact.metrics.excludedObjectCount, 2);
    assert.deepEqual(artifact.excludedObjects, ['Decorative_Prop', 'Gravity_Hammer_Handle']);
    assert.ok(artifact.metrics.totalVoxelCount > 0);
  });

  it('uses the required role priority when triangles overlap the same surface cells', () => {
    const artifact = buildV3ObjSurfaceVoxelizationArtifact({
      objText: `
o Helmet:_Mark_V
usemtl spartan_helmet_default
v 0 0 0
v 0 1 0
v 1 0 0
f 1 2 3
usemtl spartan_visor_default
f 1 2 3
`,
      mtlText: `
newmtl spartan_visor_default
Ke 0.2 0.8 1.0
`,
      fileName: 'helmet.obj',
    }, {
      targetHeightVoxels: 20,
      surfaceThicknessVoxels: 0,
    });
    const helmet = expandV3ObjSurfaceVoxelRuns(artifact.slots.helmet);

    assert.ok(helmet.length > 0);
    assert.equal(helmet.every((voxel) => voxel.role === 'visor'), true);
    assert.equal(helmet.every((voxel) => voxel.emissive === true), true);
  });

  it('keeps artifact output sanitized and summary-only', () => {
    const artifact = buildV3ObjSurfaceVoxelizationArtifact({
      objText: tiltedTriangleObj,
      fileName: 'G:\\git\\iBrawlsWebApp\\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
    });
    const serialized = JSON.stringify(artifact);
    const summary = summarizeV3ObjSurfaceVoxelArtifact(artifact);

    assert.equal(summary.schemaVersion, V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA);
    assert.equal(summary.targetHeightVoxels, V3_OBJ_SURFACE_DEFAULT_TARGET_HEIGHT_VOXELS);
    assert.match(summary.sourceHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(serialized.includes('G:\\'), false);
    assert.equal(serialized.includes('"triangles"'), false);
    assert.equal(serialized.includes('"objText"'), false);
    assert.equal(serialized.includes('v -0.35'), false);
  });
});
