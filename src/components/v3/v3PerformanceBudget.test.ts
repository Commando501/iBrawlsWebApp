import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCombatantMeshRig } from '../grifball/combatantModels';
import { buildV3SpartanModel } from './VoxelModelsV3';
import {
  collectV3RenderBudget,
  summarizeV3SceneRenderBudget,
} from './v3PerformanceBudget';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';

test('collectV3RenderBudget counts selected V3 LOD budgets on a combatant', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' }, {
    v3QualityTier: 'mobile',
    v3Distance: 24,
  });

  const budget = collectV3RenderBudget(meshes.group);
  assert.equal(budget.modelCount, 1);
  assert.equal(budget.partCount > 0, true);
  assert.equal(budget.sourceVoxelCount > 0, true);
  assert.equal(budget.drawCallEstimate > 0, true);
  assert.equal(budget.qualityTiers.mobile > 0, true);
});

test('collectV3RenderBudget ignores Mesh2Motion slot pivot proxy metadata', () => {
  const model = buildV3SpartanModel({ v3QualityTier: 'mobile' });
  const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
  const geometryGroups = model.userData.v3PartGeometryGroups as Record<string, THREE.Group>;

  assert.equal(partGroups.helmet.userData.v3SelectedLod?.qualityTier, 'mobile');
  assert.equal(partGroups.helmet.userData.v3RenderBudgetProxyOnly, true);
  assert.equal(geometryGroups.helmet.userData.v3SelectedLod?.qualityTier, 'mobile');
  assert.notEqual(geometryGroups.helmet.userData.v3RenderBudgetProxyOnly, true);

  const budget = collectV3RenderBudget(model);
  assert.equal(budget.partCount, V3_CHARACTER_SLOT_IDS.length);
});

test('summarizeV3SceneRenderBudget counts eight V3 combatants', () => {
  const scene = new THREE.Scene();
  for (let i = 0; i < 8; i += 1) {
    const meshes = createCombatantMeshRig(scene, (i * 45) % 360, false, { modelSystem: 'v3' }, {
      v3QualityTier: i < 4 ? 'mobile' : 'desktop',
      v3Distance: i * 4,
    });
    meshes.group.position.x = i - 3.5;
  }

  const budget = summarizeV3SceneRenderBudget(scene);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount >= 8 * 19, true);
  assert.equal(budget.qualityTiers.mobile > 0, true);
  assert.equal(budget.qualityTiers.desktop > 0, true);
});
