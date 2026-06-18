import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  V3_PERFORMANCE_SMOKE_BUDGETS,
  assertV3PerformanceSmokeBudget,
  buildV3PerformanceSmokeRuntimeReport,
  buildV3PerformanceSmokeReport,
  buildV3PerformanceSmokeScene,
  createV3PerformanceSmokeCombatants,
} from './v3PerformanceSmoke';
import { V3_QUALITY_TIERS, type V3QualityTier } from '../components/v3/v3ModelTypes';

type V3SmokeScene = ReturnType<typeof buildV3PerformanceSmokeScene>;
type V3SmokeReport = ReturnType<typeof buildV3PerformanceSmokeReport>;

const smokeScenes = new Map<V3QualityTier, V3SmokeScene>();
const smokeReports = new Map<V3QualityTier, V3SmokeReport>();

const getSmokeScene = (qualityTier: V3QualityTier): V3SmokeScene => {
  const cached = smokeScenes.get(qualityTier);
  if (cached) return cached;
  const smoke = buildV3PerformanceSmokeScene({ qualityTier });
  smokeScenes.set(qualityTier, smoke);
  return smoke;
};

const getSmokeReport = (qualityTier: V3QualityTier): V3SmokeReport => {
  const cached = smokeReports.get(qualityTier);
  if (cached) return cached;
  const smoke = getSmokeScene(qualityTier);
  const report = buildV3PerformanceSmokeReport(smoke);
  smokeReports.set(qualityTier, report);
  return report;
};

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
  const { scene, camera, combatants, budget } = getSmokeScene('mobileLow');

  assert.ok(scene.children.length > 0);
  assert.ok(camera.position.length() > 0);
  assert.equal(combatants.length, 8);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount > 0, true);
});

test('buildV3PerformanceSmokeReport gates every quality tier against production smoke budgets', () => {
  for (const tier of V3_QUALITY_TIERS) {
    const smoke = getSmokeScene(tier);
    const report = getSmokeReport(tier);

    assert.equal(report.qualityTier, tier);
    assert.equal(report.combatantCount, 8);
    assert.equal(report.ready, true, `${tier}: ${report.issues.join(', ')}`);
    assert.equal(report.visualQaReady, true, `${tier}: ${report.visualQa.issues.map((issue) => issue.code).join(', ')}`);
    assert.equal(report.visualQa.ready, true);
    assert.equal(report.visualQa.summary.snapshotCount, 64);
    assert.equal(report.poseClearanceReady, true, `${tier}: ${report.poseClearance.issues.map((issue) => issue.code).join(', ')}`);
    assert.equal(report.poseClearance.ready, true);
    assert.equal(report.poseClearance.summary.caseCount, 12);
    assert.deepEqual(report.weaponCoverage, ['hammer', 'pistol', 'sword']);
    assert.ok(smoke.budget.drawCallEstimate <= V3_PERFORMANCE_SMOKE_BUDGETS[tier].maxDrawCallEstimate);
    assert.doesNotThrow(() => assertV3PerformanceSmokeBudget(smoke));
  }
});

test('buildV3PerformanceSmokeReport gates fixed-angle V3 visual QA readiness', () => {
  const smoke = buildV3PerformanceSmokeScene({ qualityTier: 'desktop' });
  smoke.combatants[3].meshes.group.clear();

  const report = buildV3PerformanceSmokeReport(smoke);

  assert.equal(report.visualQaReady, false);
  assert.equal(report.ready, false);
  assert.ok(report.visualQa.issues.some((issue) => issue.code === 'missing_visual_mass'));
  assert.ok(report.issues.some((issue) => issue.includes('visual QA')));
});

test('buildV3PerformanceSmokeRuntimeReport requires measured frame timing evidence', () => {
  const smoke = getSmokeScene('desktop');
  const staticReport = getSmokeReport('desktop');

  const pending = buildV3PerformanceSmokeRuntimeReport(smoke, undefined, staticReport);
  assert.equal(pending.ready, false);
  assert.ok(pending.issues.some((issue) => issue.includes('runtime sample pending')));
  assert.equal(pending.poseClearanceReady, true);
  assert.equal(pending.poseClearance, staticReport.poseClearance);

  const fast = buildV3PerformanceSmokeRuntimeReport(smoke, { sampledFrames: 120, elapsedMs: 2_000 }, staticReport);
  assert.equal(fast.ready, true, fast.issues.join(', '));
  assert.equal(fast.runtimeReady, true);
  assert.equal(fast.averageFps >= fast.targetFps, true);
  assert.equal(fast.poseClearanceReady, true);
  assert.equal(fast.poseClearance, staticReport.poseClearance);

  const slow = buildV3PerformanceSmokeRuntimeReport(smoke, { sampledFrames: 30, elapsedMs: 2_500 }, staticReport);
  assert.equal(slow.ready, false);
  assert.equal(slow.runtimeReady, false);
  assert.ok(slow.issues.some((issue) => issue.includes('average FPS')));
  assert.equal(slow.poseClearanceReady, true);
  assert.equal(slow.poseClearance, staticReport.poseClearance);
});
