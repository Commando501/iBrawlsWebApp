import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  V3_PERFORMANCE_SMOKE_BUDGETS,
  assertV3PerformanceSmokeBudget,
  buildV3PerformanceSmokeReport,
  buildV3PerformanceSmokeScene,
  createV3PerformanceSmokeCombatants,
} from './v3PerformanceSmoke';
import { V3_QUALITY_TIERS } from '../components/v3/v3ModelTypes';

test('createV3PerformanceSmokeCombatants builds eight V3 combatants with mixed weapons and role paint', () => {
  const scene = new THREE.Scene();
  const combatants = createV3PerformanceSmokeCombatants(scene, 'mobile');

  assert.equal(combatants.length, 8);
  assert.deepEqual(new Set(combatants.map((entry) => entry.meshes.group.userData.modelSystem)), new Set(['v3']));
  assert.deepEqual(new Set(combatants.map((entry) => entry.activeWeapon)), new Set(['hammer', 'sword', 'pistol']));
  for (const entry of combatants) {
    assert.equal(entry.loadout.modelSystem, 'v3');
    assert.ok(entry.loadout.paintJob?.v3RoleColors?.primary);
    assert.ok(entry.loadout.paintJob?.v3RoleColors?.accent);
  }
});

test('buildV3PerformanceSmokeScene creates a nonblank scene with V3 budget metadata', () => {
  const { scene, camera, combatants, budget } = buildV3PerformanceSmokeScene({ qualityTier: 'mobileLow' });

  assert.ok(scene.children.length > 0);
  assert.ok(camera.position.length() > 0);
  assert.equal(combatants.length, 8);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount > 0, true);
});

test('buildV3PerformanceSmokeReport gates every quality tier against production smoke budgets', () => {
  for (const tier of V3_QUALITY_TIERS) {
    const smoke = buildV3PerformanceSmokeScene({ qualityTier: tier });
    const report = buildV3PerformanceSmokeReport(smoke);

    assert.equal(report.qualityTier, tier);
    assert.equal(report.combatantCount, 8);
    assert.equal(report.ready, true, `${tier}: ${report.issues.join(', ')}`);
    assert.deepEqual(report.weaponCoverage, ['hammer', 'pistol', 'sword']);
    assert.ok(smoke.budget.drawCallEstimate <= V3_PERFORMANCE_SMOKE_BUDGETS[tier].maxDrawCallEstimate);
    assert.doesNotThrow(() => assertV3PerformanceSmokeBudget(smoke));
  }
});
