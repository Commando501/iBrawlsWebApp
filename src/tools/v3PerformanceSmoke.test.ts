import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  buildV3PerformanceSmokeScene,
  createV3PerformanceSmokeCombatants,
} from './v3PerformanceSmoke';

test('createV3PerformanceSmokeCombatants builds eight V3 combatants with mixed weapons', () => {
  const scene = new THREE.Scene();
  const combatants = createV3PerformanceSmokeCombatants(scene, 'mobile');

  assert.equal(combatants.length, 8);
  assert.deepEqual(new Set(combatants.map((entry) => entry.meshes.group.userData.modelSystem)), new Set(['v3']));
  assert.deepEqual(new Set(combatants.map((entry) => entry.activeWeapon)), new Set(['hammer', 'sword', 'pistol']));
});

test('buildV3PerformanceSmokeScene creates a nonblank scene with V3 budget metadata', () => {
  const { scene, camera, combatants, budget } = buildV3PerformanceSmokeScene({ qualityTier: 'mobileLow' });

  assert.ok(scene.children.length > 0);
  assert.ok(camera.position.length() > 0);
  assert.equal(combatants.length, 8);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount > 0, true);
});
