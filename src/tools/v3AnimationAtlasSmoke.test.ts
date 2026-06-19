import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import * as THREE from 'three';
import { V3_POSE_CLEARANCE_CASES } from '../components/grifball/v3PoseClearance';
import {
  buildV3AnimationAtlasCases,
  buildV3AnimationAtlasScene,
  createV3AnimationAtlasFrameState,
  sampleV3AnimationAtlasCase,
  stepV3AnimationAtlasFrame,
  updateV3AnimationAtlasScene,
} from './v3AnimationAtlasSmoke';

describe('v3AnimationAtlasSmoke', () => {
  test('case list is ordered and covers every Phase 41 pose-clearance case', () => {
    assert.deepEqual(
      buildV3AnimationAtlasCases().map((entry) => entry.id),
      V3_POSE_CLEARANCE_CASES.map((entry) => entry.id)
    );
  });

  test('normalized review sampling is deterministic across frame states', () => {
    const frameState = createV3AnimationAtlasFrameState(24, 60, 60);
    const first = sampleV3AnimationAtlasCase('hammerStrike', frameState, 'normalizedReview');
    const second = sampleV3AnimationAtlasCase('hammerStrike', frameState, 'normalizedReview');

    assert.deepEqual(first, second);
    assert.equal(first.activeWeapon, 'hammer');
    assert.equal(first.visibleWeapon, 'hammer');
    assert.equal(first.normalizedTime, 0.4);
    assert.equal(first.weaponState, 'swing_down');
  });

  test('runtime simulation sampling uses gameplay-like timers without mutating case definitions', () => {
    const before = JSON.stringify(V3_POSE_CLEARANCE_CASES);
    const frameState = createV3AnimationAtlasFrameState(30, 90, 60);
    const normalized = sampleV3AnimationAtlasCase('walk', frameState, 'normalizedReview');
    const runtime = sampleV3AnimationAtlasCase('walk', frameState, 'runtimeSimulation');

    assert.notDeepEqual(runtime.velocity, normalized.velocity);
    assert.equal(runtime.dt, 1 / 60);
    assert.equal(JSON.stringify(V3_POSE_CLEARANCE_CASES), before);
  });

  test('death sampling is marked for deterministic death-burst playback', () => {
    const sample = sampleV3AnimationAtlasCase(
      'death',
      createV3AnimationAtlasFrameState(12, 72, 60),
      'normalizedReview'
    );

    assert.equal(sample.hp, 0);
    assert.equal(sample.deathBurstActive, true);
    assert.equal(sample.visibleWeapon, null);
  });

  test('weapon cases expose only the selected relevant weapon', () => {
    assert.equal(
      sampleV3AnimationAtlasCase('swordLunge', createV3AnimationAtlasFrameState(10, 60, 60), 'normalizedReview').visibleWeapon,
      'sword'
    );
    assert.equal(
      sampleV3AnimationAtlasCase('pistolFire', createV3AnimationAtlasFrameState(10, 60, 60), 'normalizedReview').visibleWeapon,
      'pistol'
    );
    assert.equal(
      sampleV3AnimationAtlasCase('idle', createV3AnimationAtlasFrameState(10, 60, 60), 'normalizedReview').visibleWeapon,
      null
    );
  });

  test('four-view scene creates synchronized V3 rigs with distinct facing rotations', () => {
    const atlas = buildV3AnimationAtlasScene({ caseId: 'idle' });

    assert.equal(atlas.views.length, 4);
    assert.deepEqual(atlas.views.map((view) => view.id), ['front', 'left', 'rear', 'right']);
    assert.deepEqual(
      atlas.views.map((view) => Number(view.rig.group.rotation.y.toFixed(6))),
      [0, Number((Math.PI / 2).toFixed(6)), Number(Math.PI.toFixed(6)), Number((-Math.PI / 2).toFixed(6))]
    );
    assert.equal(atlas.clock.caseId, 'idle');
    assert.equal(atlas.clock.frame, 0);
  });

  test('frame stepping clamps or loops deterministically', () => {
    assert.equal(stepV3AnimationAtlasFrame({ frame: 0, delta: -1, durationFrames: 20, loop: false }), 0);
    assert.equal(stepV3AnimationAtlasFrame({ frame: 20, delta: 1, durationFrames: 20, loop: false }), 20);
    assert.equal(stepV3AnimationAtlasFrame({ frame: 20, delta: 1, durationFrames: 20, loop: true }), 0);
    assert.equal(stepV3AnimationAtlasFrame({ frame: 0, delta: -1, durationFrames: 20, loop: true }), 20);
  });

  test('death scene replay creates deterministic burst fragments and can reset', () => {
    const atlas = buildV3AnimationAtlasScene({ caseId: 'death', seed: 4242 });
    updateV3AnimationAtlasScene(atlas, { frame: 18, mode: 'normalizedReview' });
    const firstCounts = atlas.views.map((view) => view.deathBurst?.plan.fragments.length ?? 0);

    updateV3AnimationAtlasScene(atlas, { frame: 0, mode: 'normalizedReview', resetDeathBurst: true });
    updateV3AnimationAtlasScene(atlas, { frame: 18, mode: 'normalizedReview' });
    const secondCounts = atlas.views.map((view) => view.deathBurst?.plan.fragments.length ?? 0);

    assert.ok(firstCounts.every((count) => count > 0));
    assert.deepEqual(secondCounts, firstCounts);
    assert.ok(atlas.scene instanceof THREE.Scene);
  });
});
