import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { VoxelData } from '../VoxelModels';
import { clearV3GeometryCache, getV3GeometryCacheStats } from './v3GeometryCache';
import {
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  analyzeV3ArmorSurface,
  createV3VoxelArmorGroup,
} from './v3VoxelArmorSurface';

const createPlateVoxels = (width: number, height: number, color = '#38bdf8'): VoxelData[] => {
  const voxels: VoxelData[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      voxels.push({ x, y, z: 0, color });
    }
  }
  return voxels;
};

const getMeshes = (group: THREE.Group): THREE.Mesh[] =>
  group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);

const getTotalVertexCount = (group: THREE.Group): number =>
  getMeshes(group).reduce((total, mesh) => total + (mesh.geometry.getAttribute('position')?.count ?? 0), 0);

const groupHasUsableNormals = (group: THREE.Group): boolean =>
  getMeshes(group).every((mesh) => {
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    if (!position || !normal || normal.count !== position.count) return false;
    for (let i = 0; i < normal.count; i++) {
      const x = normal.getX(i);
      const y = normal.getY(i);
      const z = normal.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
      if (Math.hypot(x, y, z) > 0.5) return true;
    }
    return false;
  });

describe('V3 voxel armor surface renderer', () => {
  it('removes internal faces and merges exposed coplanar panels', () => {
    const voxels: VoxelData[] = [
      { x: 0, y: 0, z: 0, color: '#38bdf8' },
      { x: 1, y: 0, z: 0, color: '#38bdf8' },
    ];

    const report = analyzeV3ArmorSurface(voxels);

    assert.equal(report.inputVoxelCount, 2);
    assert.equal(report.exposedFaceCount, 10);
    assert.equal(report.panelCount, 6);
    assert.equal(report.materialGroupCount, 1);
  });

  it('preserves material and emissive groups during analysis and rendering', () => {
    const voxels: VoxelData[] = [
      { x: 0, y: 0, z: 0, color: '#38bdf8' },
      { x: 1, y: 0, z: 0, color: '#67e8f9', emissive: true },
    ];

    const report = analyzeV3ArmorSurface(voxels);
    const group = createV3VoxelArmorGroup(voxels, {
      renderStyle: 'armorSurface',
      voxelScale: 0.05,
    });

    assert.equal(report.materialGroupCount, 2);
    assert.ok(report.emissivePanelCount > 0);
    assert.equal(group.userData.v3ArmorRenderStyle, 'armorSurface');
    assert.equal(group.userData.v3ArmorSurface.inputVoxelCount, 2);
    assert.equal(group.userData.v3ArmorSurface.materialGroupCount, 2);
    assert.ok(group.children.every((child) => child instanceof THREE.Mesh));
  });

  it('defaults armor surface panels to clipped recessed surface metadata', () => {
    const voxels = createPlateVoxels(2, 2);

    const group = createV3VoxelArmorGroup(voxels, {
      ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
      renderStyle: 'armorSurface',
    });
    const report = group.userData.v3ArmorSurface;

    assert.equal(group.userData.v3PanelCornerStyle, 'clipped');
    assert.equal(group.userData.v3PanelDepthStyle, 'recessed');
    assert.equal(report.panelCornerStyle, 'clipped');
    assert.equal(report.panelDepthStyle, 'recessed');
    assert.equal(report.beveledPanelCount, report.panelCount);
    assert.equal(report.recessedPanelCount, report.panelCount);
  });

  it('allows armor surface panels to keep flush depth', () => {
    const voxels = createPlateVoxels(2, 2);

    const group = createV3VoxelArmorGroup(voxels, {
      renderStyle: 'armorSurface',
      panelDepthStyle: 'flush',
    });
    const report = group.userData.v3ArmorSurface;

    assert.equal(group.userData.v3PanelCornerStyle, 'clipped');
    assert.equal(group.userData.v3PanelDepthStyle, 'flush');
    assert.equal(report.panelCornerStyle, 'clipped');
    assert.equal(report.panelDepthStyle, 'flush');
    assert.equal(report.beveledPanelCount, report.panelCount);
    assert.equal(report.recessedPanelCount, 0);
  });

  it('allows armor surface panels to keep square corners', () => {
    const voxels = createPlateVoxels(2, 2);

    const group = createV3VoxelArmorGroup(voxels, {
      renderStyle: 'armorSurface',
      panelCornerStyle: 'square',
    });

    assert.equal(group.userData.v3PanelCornerStyle, 'square');
    assert.equal(group.userData.v3ArmorSurface.panelCornerStyle, 'square');
  });

  it('keeps voxel edit rendering square and flush even when armor surfaces default to clipped recessed panels', () => {
    const voxels: VoxelData[] = [
      { x: 0, y: 0, z: 0, color: '#38bdf8' },
      { x: 1, y: 0, z: 0, color: '#38bdf8' },
    ];

    const group = createV3VoxelArmorGroup(voxels, {
      renderStyle: 'voxelEdit',
      panelCornerStyle: 'clipped',
      panelDepthStyle: 'recessed',
    });
    const report = group.userData.v3ArmorSurface;

    assert.equal(group.userData.v3ArmorRenderStyle, 'voxelEdit');
    assert.equal(group.userData.v3PanelCornerStyle, 'square');
    assert.equal(group.userData.v3PanelDepthStyle, 'flush');
    assert.equal(report.panelCornerStyle, 'square');
    assert.equal(report.panelDepthStyle, 'flush');
    assert.equal(report.beveledPanelCount, 0);
    assert.equal(report.recessedPanelCount, 0);
  });

  it('bevels clipped recessed panels with valid normals and richer geometry than flush square panels', () => {
    const voxels = createPlateVoxels(4, 4);

    const flushSquareGroup = createV3VoxelArmorGroup(voxels, {
      renderStyle: 'armorSurface',
      panelCornerStyle: 'square',
      panelDepthStyle: 'flush',
      qualityTier: 'desktop',
      voxelScale: 0.05,
    });
    const recessedClippedGroup = createV3VoxelArmorGroup(voxels, {
      renderStyle: 'armorSurface',
      panelCornerStyle: 'clipped',
      panelDepthStyle: 'recessed',
      qualityTier: 'desktop',
      voxelScale: 0.05,
    });
    const flushSquareVertices = getTotalVertexCount(flushSquareGroup);
    const recessedClippedVertices = getTotalVertexCount(recessedClippedGroup);
    const report = recessedClippedGroup.userData.v3ArmorSurface;

    assert.ok(groupHasUsableNormals(recessedClippedGroup));
    assert.ok(
      recessedClippedVertices > flushSquareVertices,
      `expected clipped recessed geometry to be richer than flush square, got ${recessedClippedVertices} vs ${flushSquareVertices}`
    );
    assert.equal(report.beveledPanelCount, report.panelCount);
    assert.equal(report.recessedPanelCount, report.panelCount);
  });

  it('keeps stable world bounds when rendering high-density clipped armor at half scale', () => {
    const lowDensity: VoxelData[] = [
      { x: 0, y: 0, z: 0, color: '#38bdf8' },
      { x: 1, y: 0, z: 0, color: '#38bdf8' },
    ];
    const highDensity: VoxelData[] = [
      { x: 0, y: 0, z: 0, color: '#38bdf8' },
      { x: 1, y: 0, z: 0, color: '#38bdf8' },
      { x: 2, y: 0, z: 0, color: '#38bdf8' },
      { x: 3, y: 0, z: 0, color: '#38bdf8' },
    ];

    const lowGroup = createV3VoxelArmorGroup(lowDensity, {
      renderStyle: 'armorSurface',
      panelCornerStyle: 'clipped',
      voxelScale: 0.05,
    });
    const highGroup = createV3VoxelArmorGroup(highDensity, {
      renderStyle: 'armorSurface',
      panelCornerStyle: 'clipped',
      voxelScale: 0.025,
    });
    const lowSize = new THREE.Box3().setFromObject(lowGroup).getSize(new THREE.Vector3());
    const highSize = new THREE.Box3().setFromObject(highGroup).getSize(new THREE.Vector3());

    assert.equal(lowGroup.userData.v3PanelCornerStyle, 'clipped');
    assert.equal(highGroup.userData.v3PanelCornerStyle, 'clipped');
    assert.ok(Math.abs(lowSize.x - highSize.x) < 0.01, `expected similar width, got ${lowSize.x} vs ${highSize.x}`);
  });

  it('reuses keyed built-in geometry while creating fresh mesh instances', () => {
    clearV3GeometryCache();
    const voxels = createPlateVoxels(3, 2);
    const options = {
      builtInGeometryCacheKey: 'builtin:plate:3x2',
      renderStyle: 'armorSurface' as const,
      voxelScale: 0.05,
    };

    const firstGroup = createV3VoxelArmorGroup(voxels, options);
    const firstMeshes = getMeshes(firstGroup);
    const statsAfterFirst = getV3GeometryCacheStats();
    const secondGroup = createV3VoxelArmorGroup(voxels, options);
    const secondMeshes = getMeshes(secondGroup);
    const statsAfterSecond = getV3GeometryCacheStats();

    assert.ok(firstMeshes.length > 0);
    assert.equal(firstMeshes.length, secondMeshes.length);
    assert.equal(statsAfterFirst.geometryEntries, firstMeshes.length);
    assert.equal(statsAfterFirst.misses, 1);
    assert.equal(statsAfterSecond.geometryEntries, firstMeshes.length);
    assert.equal(statsAfterSecond.hits, 1);
    assert.notEqual(firstMeshes[0], secondMeshes[0]);
    assert.equal(firstMeshes[0].geometry, secondMeshes[0].geometry);
    assert.equal(firstMeshes[0].material, secondMeshes[0].material);
    assert.ok(statsAfterSecond.approximateBytes > 0);
  });

  it('does not hit the built-in geometry cache for different or omitted cache keys', () => {
    clearV3GeometryCache();
    const voxels = createPlateVoxels(2, 2);

    const keyedA = createV3VoxelArmorGroup(voxels, {
      builtInGeometryCacheKey: 'builtin:plate:a',
      renderStyle: 'armorSurface',
    });
    const keyedB = createV3VoxelArmorGroup(voxels, {
      builtInGeometryCacheKey: 'builtin:plate:b',
      renderStyle: 'armorSurface',
    });
    const unkeyedA = createV3VoxelArmorGroup(voxels, { renderStyle: 'armorSurface' });
    const unkeyedB = createV3VoxelArmorGroup(voxels, { renderStyle: 'armorSurface' });
    const keyedAMesh = getMeshes(keyedA)[0];
    const keyedBMesh = getMeshes(keyedB)[0];
    const unkeyedAMesh = getMeshes(unkeyedA)[0];
    const unkeyedBMesh = getMeshes(unkeyedB)[0];
    const stats = getV3GeometryCacheStats();

    assert.notEqual(keyedAMesh.geometry, keyedBMesh.geometry);
    assert.notEqual(unkeyedAMesh.geometry, unkeyedBMesh.geometry);
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 2);
    assert.equal(stats.geometryEntries, getMeshes(keyedA).length + getMeshes(keyedB).length);
  });

  it('clears disposed keyed geometry and can rebuild the same built-in cache key', () => {
    clearV3GeometryCache();
    const voxels = createPlateVoxels(2, 1);
    const firstGroup = createV3VoxelArmorGroup(voxels, {
      builtInGeometryCacheKey: 'builtin:plate:clearable',
      renderStyle: 'armorSurface',
    });
    const firstGeometry = getMeshes(firstGroup)[0].geometry;
    let disposed = false;
    firstGeometry.addEventListener('dispose', () => {
      disposed = true;
    });

    clearV3GeometryCache();

    const rebuiltGroup = createV3VoxelArmorGroup(voxels, {
      builtInGeometryCacheKey: 'builtin:plate:clearable',
      renderStyle: 'armorSurface',
    });
    const rebuiltGeometry = getMeshes(rebuiltGroup)[0].geometry;

    assert.equal(disposed, true);
    assert.notEqual(rebuiltGeometry, firstGeometry);
    assert.equal(getV3GeometryCacheStats().misses, 1);
    assert.ok(getTotalVertexCount(rebuiltGroup) > 0);
  });
});
