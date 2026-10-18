import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { disposeStadiumResources } from './stadiumResourceDisposal';
import { createStadiumSurfaceDetails } from './stadiumSurfaceDetails';

function materials() {
  return {
    alloy: new THREE.MeshStandardMaterial(),
    graphite: new THREE.MeshStandardMaterial(),
    ceramic: new THREE.MeshStandardMaterial(),
  };
}

test('all surface geometry stays beyond the court and preserves both 12m goal openings after resizing', () => {
  for (const half of [{ x: 52, z: 23 }, { x: 61.5, z: 33.08 }, { x: 30, z: 20 }]) {
    for (const tier of ['high', 'balanced', 'low'] as const) {
      const group = createStadiumSurfaceDetails(half, getEnvironmentQualityProfile(tier), materials());
      for (const child of group.children) {
        assert.ok(child instanceof THREE.InstancedMesh);
        child.geometry.computeBoundingBox();
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < child.count; index++) {
          child.getMatrixAt(index, matrix);
          const bounds = child.geometry.boundingBox!.clone().applyMatrix4(matrix);
          const beyondX = bounds.min.x >= half.x || bounds.max.x <= -half.x;
          const beyondZ = bounds.min.z >= half.z || bounds.max.z <= -half.z;
          assert.ok(beyondX || beyondZ, `${child.name} must not intrude into playable space`);
          if (beyondX && !beyondZ) {
            assert.ok(bounds.min.z >= 6 - 1e-5 || bounds.max.z <= -6 + 1e-5, 'keep the complete goal approach clear');
          }
          assert.ok(bounds.min.y >= 0, 'no submerged geometry');
          assert.ok(bounds.max.y <= 3.21, 'detail must follow the existing barrier silhouette');
        }
        assert.equal(child.castShadow, false, 'surface refinements do not add shadow draws');
      }
    }
  }
});

test('surface refinement is limited to five instanced draws with a genuinely lighter fallback', () => {
  const half = { x: 61.5, z: 33.08 };
  const report: Record<string, number> = {};
  for (const tier of ['high', 'low'] as const) {
    const group = createStadiumSurfaceDetails(half, getEnvironmentQualityProfile(tier), materials());
    assert.equal(group.children.length, tier === 'low' ? 3 : 5);
    let triangles = 0;
    for (const child of group.children as THREE.InstancedMesh[]) {
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
    }
    assert.ok(triangles < 15_000, 'details fit within a small fixed geometry budget');
    report[tier] = triangles;
  }
  assert.ok(report.low < report.high * 0.4, 'fallback drops service cassettes, louvers and gaskets');
});

test('surface detail owns no resources outside the existing stadium disposal root', () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group(); root.name = 'stadium_scenery'; scene.add(root);
  const materialSet = materials();
  const group = createStadiumSurfaceDetails({ x: 61.5, z: 33.08 }, getEnvironmentQualityProfile('high'), materialSet);
  root.add(group);
  const geometries = new Set<THREE.BufferGeometry>();
  const assigned = new Set<THREE.Material>();
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    assigned.add(child.material);
  });
  const disposals = new Map<THREE.BufferGeometry | THREE.Material, number>();
  for (const resource of [...geometries, ...assigned]) {
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource)! + 1));
  }
  disposeStadiumResources(scene);
  assert.equal(scene.children.length, 0);
  assert.ok([...disposals.values()].every(count => count === 1), 'shared batch geometry and material handles dispose exactly once');
});
