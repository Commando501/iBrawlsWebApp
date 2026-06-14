import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { VoxelData } from '../VoxelModels';
import {
  analyzeV3ArmorSurface,
  createV3VoxelArmorGroup,
} from './v3VoxelArmorSurface';

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

  it('keeps stable world bounds when rendering high-density armor at half scale', () => {
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

    const lowGroup = createV3VoxelArmorGroup(lowDensity, { voxelScale: 0.05 });
    const highGroup = createV3VoxelArmorGroup(highDensity, { voxelScale: 0.025 });
    const lowSize = new THREE.Box3().setFromObject(lowGroup).getSize(new THREE.Vector3());
    const highSize = new THREE.Box3().setFromObject(highGroup).getSize(new THREE.Vector3());

    assert.ok(Math.abs(lowSize.x - highSize.x) < 0.01, `expected similar width, got ${lowSize.x} vs ${highSize.x}`);
  });
});
