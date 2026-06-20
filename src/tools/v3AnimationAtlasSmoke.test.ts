import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const slotCenter = (model: THREE.Group, slot: string): THREE.Vector3 => {
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Object3D> | undefined;
    const part = partGroups?.[slot];
    assert.ok(part, `expected V3 part group for ${slot}`);
    return new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3());
  };

  test('case list is ordered and covers every Phase 41 pose-clearance case', () => {
    assert.deepEqual(
      buildV3AnimationAtlasCases().map((entry) => entry.id),
      V3_POSE_CLEARANCE_CASES.map((entry) => entry.id)
    );
  });

  test('base locomotion atlas cases are labeled as retargeted Mixamo clips', () => {
    const cases = new Map(buildV3AnimationAtlasCases().map((entry) => [entry.id, entry]));

    assert.equal(cases.get('idle')?.clipSource, 'retargetedMixamo');
    assert.equal(cases.get('idle')?.clipId, 'idle');
    assert.equal(cases.get('idle')?.motionSourceLabel, 'retargeted Mixamo');
    assert.equal(cases.get('idle')?.motionRetention?.ready, true);
    assert.equal(cases.get('walk')?.clipSource, 'retargetedMixamo');
    assert.equal(cases.get('walk')?.clipId, 'walk');
    assert.equal(cases.get('walk')?.motionRetention?.ready, true);
    assert.ok((cases.get('walk')?.motionRetention?.joints.calfLeft?.appliedMaxRotation ?? 0) >= 0.18);
    assert.equal(cases.get('sprint')?.clipSource, 'retargetedMixamo');
    assert.equal(cases.get('sprint')?.clipId, 'run');
    assert.equal(cases.get('sprint')?.motionRetention?.ready, true);
    assert.ok((cases.get('sprint')?.motionRetention?.joints.calfLeft?.appliedMaxRotation ?? 0) >= 0.28);
    assert.match(cases.get('sprint')?.sourceHash ?? '', /^sha256:[0-9a-f]{64}$/);
    assert.equal(cases.get('hammerStrike')?.clipSource, undefined);
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
    assert.equal(normalized.clipSource, 'retargetedMixamo');
    assert.equal(normalized.clipId, 'walk');
    assert.equal(normalized.motionRetention?.ready, true);
    assert.match(normalized.sourceHash ?? '', /^sha256:[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(V3_POSE_CLEARANCE_CASES), before);
  });

  test('locomotion atlas samples use Mixamo forward instead of playing review motion sideways or backward', () => {
    const walk = sampleV3AnimationAtlasCase('walk', createV3AnimationAtlasFrameState(18, 90, 60), 'normalizedReview');
    const sprint = sampleV3AnimationAtlasCase('sprint', createV3AnimationAtlasFrameState(18, 90, 60), 'normalizedReview');

    assert.ok(walk.velocity[2] > 0, `walk should review forward on +Z, got ${walk.velocity.join(',')}`);
    assert.ok(Math.abs(walk.velocity[0]) < 0.1, `walk should keep only lateral X sway, got ${walk.velocity.join(',')}`);
    assert.ok(sprint.velocity[2] > walk.velocity[2], `sprint should move faster on +Z, got walk=${walk.velocity.join(',')} sprint=${sprint.velocity.join(',')}`);
    assert.ok(Math.abs(sprint.velocity[0]) < 0.15, `sprint should keep only lateral X sway, got ${sprint.velocity.join(',')}`);
  });

  test('retargeted locomotion poses put the Mixamo forward foot ahead of the pelvis', () => {
    const assertForwardStride = (caseId: 'walk' | 'sprint', frame: number): void => {
      const atlas = buildV3AnimationAtlasScene({ caseId });
      updateV3AnimationAtlasScene(atlas, { caseId, frame });
      atlas.scene.updateMatrixWorld(true);

      const model = atlas.views.find((view) => view.id === 'front')?.rig.group;
      assert.ok(model);
      const pelvis = slotCenter(model, 'pelvis');
      const leftFoot = slotCenter(model, 'footLeft');
      const rightFoot = slotCenter(model, 'footRight');

      assert.ok(leftFoot.z > pelvis.z, `${caseId} left foot should be ahead at Mixamo frame ${frame}, got left=${leftFoot.z} pelvis=${pelvis.z}`);
      assert.ok(rightFoot.z < pelvis.z, `${caseId} right foot should trail at Mixamo frame ${frame}, got right=${rightFoot.z} pelvis=${pelvis.z}`);
    };

    assertForwardStride('walk', 18);
    assertForwardStride('sprint', 12);
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
    const sword = sampleV3AnimationAtlasCase('swordLunge', createV3AnimationAtlasFrameState(10, 60, 60), 'normalizedReview');
    const pistol = sampleV3AnimationAtlasCase('pistolFire', createV3AnimationAtlasFrameState(10, 60, 60), 'normalizedReview');

    assert.equal(sword.visibleWeapon, 'sword');
    assert.match(sword.motionSourceLabel ?? '', /V3 procedural weapon track/);
    assert.equal(pistol.visibleWeapon, 'pistol');
    assert.match(pistol.motionSourceLabel ?? '', /V3 procedural weapon track/);
    assert.equal(
      sampleV3AnimationAtlasCase('idle', createV3AnimationAtlasFrameState(10, 60, 60), 'normalizedReview').visibleWeapon,
      null
    );
  });

  test('locomotion atlas can preview movement with each V3 carry weapon without changing Mixamo motion', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const sample = sampleV3AnimationAtlasCase(
        'walk',
        createV3AnimationAtlasFrameState(18, 90, 60),
        'normalizedReview',
        { carryWeapon: weapon }
      );

      assert.equal(sample.visibleWeapon, weapon);
      assert.equal(sample.activeWeapon, weapon);
      assert.equal(sample.weaponState, 'ready');
      assert.equal(sample.clipId, 'walk');
      assert.match(sample.motionSourceLabel ?? '', /retargeted Mixamo/);
      assert.match(sample.motionSourceLabel ?? '', /V3 carry layer/);
    }
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
    assert.equal(atlas.v3Options.v3SourceFidelity, 'exact');
  });

  test('browser atlas page preserves exact-source review fidelity by default', () => {
    const pageSource = readFileSync('src/tools/v3AnimationAtlasSmokePage.ts', 'utf8');

    assert.equal(pageSource.includes("v3SourceFidelity: 'runtimeLod'"), false);
    assert.equal(pageSource.includes('motionSourceLabel'), true);
    assert.equal(pageSource.includes('carry-weapon'), true);
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

  test('slot continuity overlay roots are controlled by scene update options', () => {
    const atlas = buildV3AnimationAtlasScene({ caseId: 'hammerStrike' });

    updateV3AnimationAtlasScene(atlas, { showSlotContinuity: true });
    assert.ok(atlas.views.every((view) => view.slotContinuityOverlay.name.includes(view.id)));
    assert.ok(atlas.views.every((view) => view.slotContinuityOverlay.visible === true));

    updateV3AnimationAtlasScene(atlas, { showSlotContinuity: false });
    assert.ok(atlas.views.every((view) => view.slotContinuityOverlay.visible === false));
  });

  test('slot continuity overlay includes lower-body seam reports for walk review', () => {
    const atlas = buildV3AnimationAtlasScene({ caseId: 'walk' });

    updateV3AnimationAtlasScene(atlas, { showSlotContinuity: true, frame: 30 });

    assert.ok(atlas.views.every((view) => view.slotContinuityOverlay.visible === true));
    assert.ok(atlas.views.every((view) => {
      const summary = view.slotContinuityOverlay.userData.v3LowerBodyContinuityReport?.summary;
      return (
        summary?.linkCount === 7 &&
        typeof summary.maxLowerBodySeamGap === 'number' &&
        typeof summary.maxLowerBodyProjectedSeamGap === 'number' &&
        typeof summary.lowerBodyTearWarningCount === 'number' &&
        typeof summary.maxVisibleLowerBodySeamGap === 'number' &&
        typeof summary.visibleLowerBodyTearWarningCount === 'number'
      );
    }));
  });

  test('walk review frames pose a readable stride instead of a tiny first-frame shuffle', () => {
    const atlas = buildV3AnimationAtlasScene({ caseId: 'walk' });

    updateV3AnimationAtlasScene(atlas, { frame: 22, mode: 'normalizedReview' });

    const model = atlas.views[0].rig.group;
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const maxThighSwing = Math.max(
      Math.abs(detailBones.thighLeft.rotation.x),
      Math.abs(detailBones.thighRight.rotation.x)
    );

    assert.equal(model.userData.v3RetargetedClip?.clipId, 'walk');
    assert.equal(model.userData.v3RetargetedClip?.clipSource, 'retargetedMixamo');
    assert.ok(maxThighSwing >= 0.085, `walk atlas frame should show real thigh swing, got ${maxThighSwing}`);
    assert.ok(
      Math.max(Math.abs(detailBones.calfLeft.rotation.x), Math.abs(detailBones.calfRight.rotation.x)) >= 0.12,
      'walk atlas frame should show imported knee/calf motion, not just broad thigh swing'
    );
    assert.ok(
      Math.max(Math.abs(detailBones.footLeft.rotation.x), Math.abs(detailBones.footRight.rotation.x)) >= 0.05,
      'walk atlas frame should show imported foot motion'
    );
    assert.ok(
      Math.abs((model.userData.lowerTorso as THREE.Group).position.y) <= 0.015,
      'walk atlas frame should not jump hips upward into the torso'
    );
  });
});
