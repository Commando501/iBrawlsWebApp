import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { V3_POSE_CLEARANCE_CASES } from './v3PoseClearance';
import {
  analyzeV3AnimationAtlasCaseDefects,
  analyzeV3AnimationAtlasDefects,
  buildV3AnimationAtlasDefectWarnings,
  formatV3AnimationAtlasDefectSummary,
  type V3AnimationAtlasDefectMetrics,
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
    assert.equal(typeof front.metrics.weaponBasisForwardAlignment, 'number');
    assert.equal(typeof front.metrics.weaponBasisUpAlignment, 'number');
    assert.equal(typeof front.metrics.weaponPrimaryGripDrift, 'number');
    assert.equal(typeof front.metrics.weaponOffhandGripDrift, 'number');
    assert.equal(typeof front.metrics.weaponDesiredPrimaryGripDrift, 'number');
    assert.equal(typeof front.metrics.weaponDesiredOffhandGripDrift, 'number');
    assert.equal(typeof front.metrics.weaponIkMaxGripDrift, 'number');
    assert.equal(typeof front.metrics.weaponIkShoulderSeamDistance, 'number');
    assert.equal(typeof front.metrics.weaponIkReachClampCount, 'number');
    assert.equal(typeof front.metrics.weaponSwingArcDistance, 'number');
    assert.equal(typeof front.metrics.weaponRetargetMinElbowPlaneAlignment, 'number');
    assert.equal(typeof front.metrics.weaponRetargetMinPalmForwardAlignment, 'number');
    assert.equal(typeof front.metrics.weaponRetargetMinForearmTwistAlignment, 'number');
    assert.equal(typeof front.metrics.weaponRetargetMaxJointDrift, 'number');
    assert.equal(typeof front.metrics.weaponRetargetIkCleanupRequired, 'boolean');
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
    assert.equal(typeof front.metrics.maxUpperBodySeamGap, 'number');
    assert.equal(typeof front.metrics.maxUpperBodyProjectedSeamGap, 'number');
    assert.equal(typeof front.metrics.upperBodySeamWarningCount, 'number');
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

  it('warns on invalid weapon socket basis even when grip drift is zero', () => {
    const metrics: V3AnimationAtlasDefectMetrics = {
      visibleWeapon: 'hammer',
      limbSeparation: 0,
      slotBoneDrift: 0,
      weaponBodyHeightRatio: 0.32,
      weaponGripDrift: 0,
      weaponBasisForwardAlignment: 0.1,
      weaponBasisUpAlignment: 0.2,
      weaponPrimaryGripDrift: 0,
      weaponOffhandGripDrift: 0.05,
      weaponDesiredPrimaryGripDrift: 0,
      weaponDesiredOffhandGripDrift: 0.05,
      weaponIkMaxGripDrift: 0,
      weaponIkShoulderSeamDistance: 0,
      weaponIkReachClampCount: 0,
      weaponSwingArcDistance: 0.4,
      weaponRetargetMinElbowPlaneAlignment: 1,
      weaponRetargetMinPalmForwardAlignment: 1,
      weaponRetargetMinForearmTwistAlignment: 1,
      weaponRetargetMaxJointDrift: 0,
      weaponRetargetIkCleanupRequired: false,
      weaponTwoHandReadiness: 0.95,
      weaponOneHandReadiness: null,
      footFloorPenetration: 0,
      upperLowerCoupling: 0,
      nonFiniteTransformCount: 0,
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      slotContinuityWarningCount: 0,
      slotContinuityIssues: [],
      maxLowerBodySeamGap: 0,
      maxLowerBodyProjectedSeamGap: 0,
      lowerBodyTearWarningCount: 0,
      maxUpperBodySeamGap: 0,
      maxUpperBodyProjectedSeamGap: 0,
      upperBodySeamWarningCount: 0,
      rawMaxLowerBodySeamGap: 0,
      rawMaxLowerBodyProjectedSeamGap: 0,
      visibleMaxLowerBodySeamGap: 0,
      visibleMaxLowerBodyProjectedSeamGap: 0,
      visibleLowerBodyTearWarningCount: 0,
      bridgeCoveredLinkCount: 0,
      lowerBodySeamIssues: [],
    };

    assert.deepEqual(
      buildV3AnimationAtlasDefectWarnings('hammerStrike', metrics).filter((warning) => warning.includes('weapon')),
      ['weapon socket basis forward low', 'weapon socket basis up low']
    );
  });

  it('warns when constrained weapon motion has low drift but bad IK or too little sweep', () => {
    const metrics: V3AnimationAtlasDefectMetrics = {
      visibleWeapon: 'hammer',
      limbSeparation: 0,
      slotBoneDrift: 0,
      weaponBodyHeightRatio: 0.32,
      weaponGripDrift: 0,
      weaponBasisForwardAlignment: 1,
      weaponBasisUpAlignment: 1,
      weaponPrimaryGripDrift: 0,
      weaponOffhandGripDrift: 0.03,
      weaponDesiredPrimaryGripDrift: 0.12,
      weaponDesiredOffhandGripDrift: 0.24,
      weaponIkMaxGripDrift: 0.24,
      weaponIkShoulderSeamDistance: 0,
      weaponIkReachClampCount: 1,
      weaponSwingArcDistance: 0.04,
      weaponRetargetMinElbowPlaneAlignment: 1,
      weaponRetargetMinPalmForwardAlignment: 1,
      weaponRetargetMinForearmTwistAlignment: 1,
      weaponRetargetMaxJointDrift: 0,
      weaponRetargetIkCleanupRequired: false,
      weaponTwoHandReadiness: 0.95,
      weaponOneHandReadiness: null,
      footFloorPenetration: 0,
      upperLowerCoupling: 0,
      nonFiniteTransformCount: 0,
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      slotContinuityWarningCount: 0,
      slotContinuityIssues: [],
      maxLowerBodySeamGap: 0,
      maxLowerBodyProjectedSeamGap: 0,
      lowerBodyTearWarningCount: 0,
      maxUpperBodySeamGap: 0,
      maxUpperBodyProjectedSeamGap: 0,
      upperBodySeamWarningCount: 0,
      rawMaxLowerBodySeamGap: 0,
      rawMaxLowerBodyProjectedSeamGap: 0,
      visibleMaxLowerBodySeamGap: 0,
      visibleMaxLowerBodyProjectedSeamGap: 0,
      visibleLowerBodyTearWarningCount: 0,
      bridgeCoveredLinkCount: 0,
      lowerBodySeamIssues: [],
    };

    assert.deepEqual(
      buildV3AnimationAtlasDefectWarnings('hammerStrike', metrics).filter((warning) => warning.includes('weapon')),
      [
        'weapon desired primary grip drift high',
        'weapon desired offhand grip drift high',
        'weapon IK reach clamped',
        'weapon swing arc too small',
      ]
    );
  });

  it('warns on shoulder seam separation even when grip drift is low', () => {
    const metrics: V3AnimationAtlasDefectMetrics = {
      visibleWeapon: 'hammer',
      limbSeparation: 0,
      slotBoneDrift: 0,
      weaponBodyHeightRatio: 0.32,
      weaponGripDrift: 0,
      weaponBasisForwardAlignment: 1,
      weaponBasisUpAlignment: 1,
      weaponPrimaryGripDrift: 0,
      weaponOffhandGripDrift: 0.03,
      weaponDesiredPrimaryGripDrift: 0,
      weaponDesiredOffhandGripDrift: 0,
      weaponIkMaxGripDrift: 0,
      weaponIkShoulderSeamDistance: 0.09,
      weaponIkReachClampCount: 0,
      weaponSwingArcDistance: 0.4,
      weaponRetargetMinElbowPlaneAlignment: 1,
      weaponRetargetMinPalmForwardAlignment: 1,
      weaponRetargetMinForearmTwistAlignment: 1,
      weaponRetargetMaxJointDrift: 0,
      weaponRetargetIkCleanupRequired: false,
      weaponTwoHandReadiness: 0.95,
      weaponOneHandReadiness: null,
      footFloorPenetration: 0,
      upperLowerCoupling: 0,
      nonFiniteTransformCount: 0,
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      slotContinuityWarningCount: 0,
      slotContinuityIssues: [],
      maxLowerBodySeamGap: 0,
      maxLowerBodyProjectedSeamGap: 0,
      lowerBodyTearWarningCount: 0,
      maxUpperBodySeamGap: 0,
      maxUpperBodyProjectedSeamGap: 0,
      upperBodySeamWarningCount: 0,
      rawMaxLowerBodySeamGap: 0,
      rawMaxLowerBodyProjectedSeamGap: 0,
      visibleMaxLowerBodySeamGap: 0,
      visibleMaxLowerBodyProjectedSeamGap: 0,
      visibleLowerBodyTearWarningCount: 0,
      bridgeCoveredLinkCount: 0,
      lowerBodySeamIssues: [],
    };

    assert.deepEqual(
      buildV3AnimationAtlasDefectWarnings('hammerStrike', metrics).filter((warning) => warning.includes('weapon')),
      ['weapon shoulder seam high']
    );
  });

  it('warns on retarget anatomy mismatch even when weapon grip drift is low', () => {
    const metrics: V3AnimationAtlasDefectMetrics = {
      visibleWeapon: 'sword',
      limbSeparation: 0,
      slotBoneDrift: 0,
      weaponBodyHeightRatio: 0.4,
      weaponGripDrift: 0,
      weaponBasisForwardAlignment: 1,
      weaponBasisUpAlignment: 1,
      weaponPrimaryGripDrift: 0,
      weaponOffhandGripDrift: null,
      weaponDesiredPrimaryGripDrift: 0,
      weaponDesiredOffhandGripDrift: null,
      weaponIkMaxGripDrift: 0,
      weaponIkShoulderSeamDistance: 0,
      weaponIkReachClampCount: 0,
      weaponSwingArcDistance: 0.4,
      weaponRetargetMinElbowPlaneAlignment: 0.003,
      weaponRetargetMinPalmForwardAlignment: 0.18,
      weaponRetargetMinForearmTwistAlignment: 0.16,
      weaponRetargetMaxJointDrift: 0.12,
      weaponRetargetIkCleanupRequired: true,
      weaponTwoHandReadiness: null,
      weaponOneHandReadiness: 0.92,
      footFloorPenetration: 0,
      upperLowerCoupling: 0,
      nonFiniteTransformCount: 0,
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      slotContinuityWarningCount: 0,
      slotContinuityIssues: [],
      maxLowerBodySeamGap: 0,
      maxLowerBodyProjectedSeamGap: 0,
      lowerBodyTearWarningCount: 0,
      maxUpperBodySeamGap: 0,
      maxUpperBodyProjectedSeamGap: 0,
      upperBodySeamWarningCount: 0,
      rawMaxLowerBodySeamGap: 0,
      rawMaxLowerBodyProjectedSeamGap: 0,
      visibleMaxLowerBodySeamGap: 0,
      visibleMaxLowerBodyProjectedSeamGap: 0,
      visibleLowerBodyTearWarningCount: 0,
      bridgeCoveredLinkCount: 0,
      lowerBodySeamIssues: [],
    };

    assert.deepEqual(
      buildV3AnimationAtlasDefectWarnings('swordSlash', metrics).filter((warning) => warning.includes('retarget')),
      [
        'weapon retarget elbow plane mismatch',
        'weapon retarget palm forward mismatch',
        'weapon retarget forearm twist mismatch',
        'weapon retarget joint drift high',
        'weapon retarget excessive IK cleanup',
      ]
    );
  });

  it('warns on visible upper-body seam gaps even when weapon grip drift is low', () => {
    const metrics: V3AnimationAtlasDefectMetrics = {
      visibleWeapon: 'hammer',
      limbSeparation: 0,
      slotBoneDrift: 0,
      weaponBodyHeightRatio: 0.32,
      weaponGripDrift: 0,
      weaponBasisForwardAlignment: 1,
      weaponBasisUpAlignment: 1,
      weaponPrimaryGripDrift: 0,
      weaponOffhandGripDrift: 0.03,
      weaponDesiredPrimaryGripDrift: 0,
      weaponDesiredOffhandGripDrift: 0,
      weaponIkMaxGripDrift: 0,
      weaponIkShoulderSeamDistance: 0,
      weaponIkReachClampCount: 0,
      weaponSwingArcDistance: 0.4,
      weaponRetargetMinElbowPlaneAlignment: 1,
      weaponRetargetMinPalmForwardAlignment: 1,
      weaponRetargetMinForearmTwistAlignment: 1,
      weaponRetargetMaxJointDrift: 0,
      weaponRetargetIkCleanupRequired: false,
      weaponTwoHandReadiness: 0.95,
      weaponOneHandReadiness: null,
      footFloorPenetration: 0,
      upperLowerCoupling: 0,
      nonFiniteTransformCount: 0,
      maxSlotContinuityGap: 0,
      maxProjectedSlotGap: 0,
      maxJointAnchorError: 0,
      slotContinuityWarningCount: 0,
      slotContinuityIssues: [],
      maxLowerBodySeamGap: 0,
      maxLowerBodyProjectedSeamGap: 0,
      lowerBodyTearWarningCount: 0,
      maxUpperBodySeamGap: 0.09,
      maxUpperBodyProjectedSeamGap: 0.09,
      upperBodySeamWarningCount: 1,
      rawMaxLowerBodySeamGap: 0,
      rawMaxLowerBodyProjectedSeamGap: 0,
      visibleMaxLowerBodySeamGap: 0,
      visibleMaxLowerBodyProjectedSeamGap: 0,
      visibleLowerBodyTearWarningCount: 0,
      bridgeCoveredLinkCount: 0,
      lowerBodySeamIssues: [],
    };

    assert.deepEqual(buildV3AnimationAtlasDefectWarnings('hammerStrike', metrics), ['upper-body seam gap']);
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

  it('keeps weapon review cases below grip-drift and slot-continuity thresholds', () => {
    const cases = ['hammerWindup', 'hammerStrike', 'swordLunge', 'swordSlash', 'pistolFire'] as const;

    for (const caseId of cases) {
      const report = analyzeV3AnimationAtlasCaseDefects(caseId, { mode: 'normalizedReview' });
      const front = report.views.find((view) => view.viewId === 'front');

      assert.ok(front);
      assert.equal(report.ready, true, `${caseId} warnings: ${front.warnings.join(', ')}`);
      assert.ok((front.metrics.weaponGripDrift ?? 0) <= 0.12, `${caseId} weapon drift ${front.metrics.weaponGripDrift}`);
      assert.ok(front.metrics.maxSlotContinuityGap <= 0.025, `${caseId} slot continuity ${front.metrics.maxSlotContinuityGap}`);
      assert.ok(front.metrics.maxUpperBodySeamGap <= 0.06, `${caseId} upper-body seam ${front.metrics.maxUpperBodySeamGap}`);
    }
  });

  it('keeps Phase 45 lower-body cases below coarse slot-drift and foot-floor thresholds', () => {
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
        assert.ok(front.metrics.slotBoneDrift <= 0.9, `${caseId} slot drift ${front.metrics.slotBoneDrift}`);
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
    assert.match(summary, /upper-body seams/i);
    assert.match(summary, /retarget palm/i);
  });
});
