import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { V3_POSE_CLEARANCE_CASES } from './v3PoseClearance';
import {
  analyzeV3AnimationAtlasCaseDefects,
  analyzeV3AnimationAtlasDefects,
  formatV3AnimationAtlasDefectSummary,
} from './v3AnimationAtlasDefects';

describe('v3AnimationAtlasDefects', () => {
  it('reports deterministic defects for every atlas case and four review views', () => {
    const report = analyzeV3AnimationAtlasDefects({ mode: 'normalizedReview' });
    const caseIds = V3_POSE_CLEARANCE_CASES.map((entry) => entry.id);

    assert.deepEqual(report.cases.map((entry) => entry.caseId), caseIds);
    assert.equal(report.summary.caseCount, caseIds.length);
    assert.equal(report.summary.viewCount, 4);
    assert.equal(report.cases.every((entry) => entry.views.length === 4), true);
    assert.deepEqual(report.cases[0].views.map((view) => view.viewId), ['front', 'left', 'rear', 'right']);
    assert.deepEqual(report, analyzeV3AnimationAtlasDefects({ mode: 'normalizedReview' }));
  });

  it('reports weapon scale, grip drift, floor, coupling, and transform metrics for weapon cases', () => {
    const report = analyzeV3AnimationAtlasCaseDefects('hammerStrike', { mode: 'normalizedReview' });
    const front = report.views.find((view) => view.viewId === 'front');

    assert.ok(front);
    assert.equal(front.metrics.visibleWeapon, 'hammer');
    assert.equal(typeof front.metrics.weaponBodyHeightRatio, 'number');
    assert.equal(typeof front.metrics.weaponGripDrift, 'number');
    assert.equal(typeof front.metrics.footFloorPenetration, 'number');
    assert.equal(typeof front.metrics.upperLowerCoupling, 'number');
    assert.equal(front.metrics.nonFiniteTransformCount, 0);
    assert.equal(typeof front.metrics.maxSlotContinuityGap, 'number');
    assert.equal(typeof front.metrics.maxProjectedSlotGap, 'number');
    assert.equal(typeof front.metrics.maxJointAnchorError, 'number');
    assert.equal(typeof front.metrics.slotContinuityWarningCount, 'number');
    assert.equal(typeof front.metrics.maxLowerBodySeamGap, 'number');
    assert.equal(typeof front.metrics.maxLowerBodyProjectedSeamGap, 'number');
    assert.equal(typeof front.metrics.lowerBodyTearWarningCount, 'number');
    assert.ok(Array.isArray(front.metrics.slotContinuityIssues));
    assert.ok(Array.isArray(front.metrics.lowerBodySeamIssues));
    assert.ok(front.metrics.slotContinuityIssues.every((issue) => (
      typeof issue.frameFraction === 'number' &&
      typeof issue.linkId === 'string' &&
      typeof issue.label === 'string' &&
      issue.viewId === front.viewId
    )));
    assert.deepEqual(report.sampledFrameFractions, [0, 0.25, 0.5, 0.75, 1]);
  });

  it('includes retargeted Mixamo clip metadata for imported base motion cases', () => {
    const walk = analyzeV3AnimationAtlasCaseDefects('walk', { mode: 'normalizedReview' });
    const sprint = analyzeV3AnimationAtlasCaseDefects('sprint', { mode: 'normalizedReview' });
    const hammer = analyzeV3AnimationAtlasCaseDefects('hammerStrike', { mode: 'normalizedReview' });

    assert.equal(walk.clipSource, 'retargetedMixamo');
    assert.equal(walk.clipId, 'walk');
    assert.equal(walk.clipReady, true);
    assert.equal(walk.motionRetention?.ready, true);
    assert.ok((walk.motionRetention?.joints.calfLeft?.appliedMaxRotation ?? 0) >= 0.18);
    assert.match(walk.sourceHash ?? '', /^sha256:[0-9a-f]{64}$/);
    assert.equal(sprint.clipSource, 'retargetedMixamo');
    assert.equal(sprint.clipId, 'run');
    assert.equal(sprint.clipReady, true);
    assert.equal(sprint.motionRetention?.ready, true);
    assert.ok((sprint.motionRetention?.joints.calfLeft?.appliedMaxRotation ?? 0) >= 0.28);
    assert.equal(hammer.clipSource, undefined);
    assert.equal(hammer.clipReady, undefined);
    assert.equal(hammer.motionRetention, undefined);
  });

  it('keeps walk visibly free of lower-body seam tears in every atlas view', () => {
    const report = analyzeV3AnimationAtlasCaseDefects('walk', { mode: 'normalizedReview' });

    assert.equal(report.ready, true, report.views.map((view) => `${view.viewId}: ${view.warnings.join(', ')}`).join(' | '));
    for (const view of report.views) {
      assert.equal(typeof view.metrics.rawMaxLowerBodySeamGap, 'number');
      assert.equal(typeof view.metrics.visibleMaxLowerBodySeamGap, 'number');
      assert.equal(typeof view.metrics.bridgeCoveredLinkCount, 'number');
      assert.equal(view.metrics.visibleLowerBodyTearWarningCount, 0, `${view.viewId} visible lower-body seam issues`);
      assert.ok(view.metrics.visibleMaxLowerBodySeamGap <= 0.14, `${view.viewId} visible seam gap ${view.metrics.visibleMaxLowerBodySeamGap}`);
      assert.ok(
        view.metrics.visibleMaxLowerBodyProjectedSeamGap <= 0.14,
        `${view.viewId} visible projected seam gap ${view.metrics.visibleMaxLowerBodyProjectedSeamGap}`
      );
    }
  });

  it('keeps Phase 45 weapon cases below grip-drift and slot-drift thresholds', () => {
    const cases = ['hammerWindup', 'hammerStrike', 'swordLunge', 'swordSlash', 'pistolFire'] as const;

    for (const caseId of cases) {
      const report = analyzeV3AnimationAtlasCaseDefects(caseId, { mode: 'normalizedReview' });
      const front = report.views.find((view) => view.viewId === 'front');

      assert.ok(front);
      assert.equal(report.ready, true, `${caseId} warnings: ${front.warnings.join(', ')}`);
      assert.ok((front.metrics.weaponGripDrift ?? 0) <= 0.12, `${caseId} weapon drift ${front.metrics.weaponGripDrift}`);
      if (caseId === 'hammerWindup' || caseId === 'hammerStrike') {
        assert.ok(front.metrics.slotBoneDrift <= 0.16, `${caseId} slot drift ${front.metrics.slotBoneDrift}`);
      }
    }
  });

  it('keeps Phase 45 lower-body cases below slot-drift and foot-floor thresholds', () => {
    const cases = ['walk', 'slide', 'hitReact', 'swordLunge'] as const;

    for (const caseId of cases) {
      const report = analyzeV3AnimationAtlasCaseDefects(caseId, { mode: 'normalizedReview' });
      const front = report.views.find((view) => view.viewId === 'front');

      assert.ok(front);
      const nonSeamWarnings = front.warnings.filter((warning) => warning !== 'lower-body seam tear');
      assert.deepEqual(nonSeamWarnings, [], `${caseId} warnings: ${front.warnings.join(', ')}`);
      if (caseId === 'walk') {
        assert.equal(report.ready, true, `${caseId} warnings: ${front.warnings.join(', ')}`);
      }
      if (caseId !== 'swordLunge') {
        assert.ok(front.metrics.slotBoneDrift <= 0.16, `${caseId} slot drift ${front.metrics.slotBoneDrift}`);
      }
      assert.ok(front.metrics.footFloorPenetration <= 0.025, `${caseId} foot penetration ${front.metrics.footFloorPenetration}`);
    }
  });

  it('does not classify expected locomotion lower-body motion as upper/lower coupling', () => {
    const report = analyzeV3AnimationAtlasCaseDefects('sprint', { mode: 'normalizedReview' });

    assert.ok(report.views[0].metrics.upperLowerCoupling > 0);
    assert.equal(report.views.some((view) => view.warnings.includes('upper/lower coupling high')), false);
  });

  it('formats a concise human-readable summary', () => {
    const report = analyzeV3AnimationAtlasDefects({ caseIds: ['idle', 'pistolFire'] });
    const summary = formatV3AnimationAtlasDefectSummary(report);

    assert.match(summary, /V3 animation atlas defects/i);
    assert.match(summary, /cases 2/i);
    assert.match(summary, /weapon/i);
    assert.match(summary, /slot continuity/i);
    assert.match(summary, /lower-body seams/i);
  });
});
