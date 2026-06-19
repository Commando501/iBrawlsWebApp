import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel } from '../VoxelModels';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import {
  buildV3DeathVoxelBurstPlan,
  createV3DeathVoxelBurst,
  disposeV3DeathVoxelBurst,
  updateV3DeathVoxelBurst,
} from './v3DeathVoxelBurst';

const roundPlan = (model: THREE.Object3D, tier: 'mobileLow' | 'mobile' | 'desktop' | 'ultra' = 'desktop') =>
  buildV3DeathVoxelBurstPlan(model, { qualityTier: tier }).fragments.map((fragment) => ({
    id: fragment.id,
    sourceSlot: fragment.sourceSlot,
    role: fragment.role,
    colorHex: fragment.colorHex,
    start: fragment.start.map((value) => Number(value.toFixed(4))),
    size: fragment.size.map((value) => Number(value.toFixed(4))),
    velocity: fragment.velocity.map((value) => Number(value.toFixed(4))),
  }));

describe('v3DeathVoxelBurst', () => {
  it('plans deterministic fragments from visible V3 part groups with source metadata', () => {
    const model = buildV3SpartanModel({ customHue: 192 });
    model.position.set(1, 2, -3);
    model.updateWorldMatrix(true, true);

    const first = roundPlan(model);
    const second = roundPlan(model);

    assert.deepEqual(first, second);
    assert.ok(first.length > 0);
    assert.ok(first.length <= 160);
    assert.ok(first.every((fragment) => typeof fragment.colorHex === 'number'));
    assert.ok(first.some((fragment) => fragment.sourceSlot === 'helmet'));
    assert.ok(first.some((fragment) => typeof fragment.role === 'string' && fragment.role.length > 0));
  });

  it('applies quality-tier fragment caps', () => {
    const model = buildV3SpartanModel({ customHue: 24, v3QualityTier: 'ultra' });

    assert.ok(buildV3DeathVoxelBurstPlan(model, { qualityTier: 'mobileLow' }).fragments.length <= 48);
    assert.ok(buildV3DeathVoxelBurstPlan(model, { qualityTier: 'mobile' }).fragments.length <= 96);
    assert.ok(buildV3DeathVoxelBurstPlan(model, { qualityTier: 'desktop' }).fragments.length <= 160);
    assert.ok(buildV3DeathVoxelBurstPlan(model, { qualityTier: 'ultra' }).fragments.length <= 240);
  });

  it('does not mutate model or part visibility while planning', () => {
    const model = buildV3SpartanModel({ customHue: 88 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Object3D>;
    partGroups.helmet.visible = false;
    const before = new Map(Object.entries(partGroups).map(([slot, group]) => [slot, group.visible]));

    const plan = buildV3DeathVoxelBurstPlan(model, { qualityTier: 'desktop' });
    const after = new Map(Object.entries(partGroups).map(([slot, group]) => [slot, group.visible]));

    assert.deepEqual(after, before);
    assert.ok(!plan.fragments.some((fragment) => fragment.sourceSlot === 'helmet'));
  });

  it('updates and disposes an instanced burst lifecycle safely', () => {
    const scene = new THREE.Scene();
    const model = buildV3SpartanModel({ customHue: 300 });

    const instance = createV3DeathVoxelBurst(scene, model, {
      qualityTier: 'mobileLow',
      duration: 0.3,
    });

    assert.ok(instance);
    assert.equal(scene.children.includes(instance.mesh), true);
    assert.ok(instance.mesh instanceof THREE.InstancedMesh);
    assert.equal(instance.mesh.count <= 48, true);

    const material = instance.mesh.material as THREE.MeshBasicMaterial;
    assert.equal(material.transparent, true);
    const startOpacity = material.opacity;

    assert.equal(updateV3DeathVoxelBurst(instance, 0.15), true);
    assert.ok(material.opacity < startOpacity);

    assert.equal(updateV3DeathVoxelBurst(instance, 0.3), false);
    disposeV3DeathVoxelBurst(instance);
    assert.equal(scene.children.includes(instance.mesh), false);
    disposeV3DeathVoxelBurst(instance);
    assert.equal(scene.children.includes(instance.mesh), false);
  });

  it('returns empty plans and no burst for non-V3 models', () => {
    const nonV3 = buildVoxelSpartanModel();
    const scene = new THREE.Scene();

    const plan = buildV3DeathVoxelBurstPlan(nonV3, { qualityTier: 'desktop' });

    assert.equal(plan.ready, false);
    assert.deepEqual(plan.fragments, []);
    assert.equal(createV3DeathVoxelBurst(scene, nonV3, { qualityTier: 'desktop' }), null);
    assert.equal(scene.children.length, 0);
  });
});
