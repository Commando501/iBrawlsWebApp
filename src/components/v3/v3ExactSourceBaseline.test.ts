import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import {
  V3_EXACT_SOURCE_BASELINE_ACCEPTANCE,
  buildV3ExactSourceBaseline,
  buildV3ExactSourceDashboardEvidence,
} from './v3ExactSourceBaseline';

const readyReferenceProportions = {
  ready: true,
  issues: [],
  summary: {
    sourceLabel: 'Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
    globalFrontWidthDelta: 0.012,
    globalSideDepthDelta: 0.009,
    maxBandWidthDelta: 0.081,
    maxBandDepthDelta: 0.024,
    worstWidthBand: 'helmetLower',
    worstDepthBand: 'pelvis',
  },
};

const readyVisualQa = {
  ready: true,
  issues: [],
  summary: {
    snapshotCount: 8,
    minOccupiedAreaRatio: 0.075,
    maxOccupiedAreaRatio: 0.22,
    panelCount: 44,
    materialGroupCount: 9,
  },
};

const acceptedSilhouetteDeltas = {
  deltas: {
    front: { widthRatio: 0.02, heightRatio: 0, areaRatio: -0.03 },
    side: { widthRatio: -0.04, heightRatio: 0, areaRatio: -0.05 },
  },
  mismatchNotes: [],
};

describe('V3 exact source baseline', () => {
  it('accepts the checked-in OBJ surface voxel source with ready reference and visual evidence', () => {
    const report = buildV3ExactSourceBaseline({
      referenceProportions: readyReferenceProportions,
      visualQa: readyVisualQa,
      silhouetteComparison: acceptedSilhouetteDeltas,
    });

    assert.equal(report.ready, true);
    assert.equal(report.status, 'accepted');
    assert.deepEqual(report.issues, []);
    assert.equal(report.summary.schemaVersion, 'v3-obj-surface-voxels/v1');
    assert.equal(
      report.summary.sourceHash,
      'sha256:d47bdeb71004a1d1f6f0129ca67ae96c0e74a9cf9e0b8ba449c9594555b1cef7'
    );
    assert.equal(report.summary.targetHeightVoxels, 192);
    assert.equal(report.summary.surfaceThicknessVoxels, 1);
    assert.equal(report.summary.referenceProportions.ready, true);
    assert.equal(report.summary.visualQa.ready, true);
    assert.equal(report.summary.silhouetteDelta?.ready, true);
    assert.equal(report.summary.playerReadiness, 'not-player-ready');
    assert.equal(JSON.stringify(report).includes('"runs"'), false);
    assert.equal(JSON.stringify(report).includes('"slots"'), false);
  });

  it('keeps the accepted hash, source schema, target height, and surface thickness as explicit constants', () => {
    assert.deepEqual(V3_EXACT_SOURCE_BASELINE_ACCEPTANCE, {
      acceptedHash: 'sha256:d47bdeb71004a1d1f6f0129ca67ae96c0e74a9cf9e0b8ba449c9594555b1cef7',
      schemaVersion: 'v3-obj-surface-voxels/v1',
      targetHeightVoxels: 192,
      surfaceThicknessVoxels: 1,
      expectedSlotCount: 19,
      sourceKind: 'obj',
    });
  });

  it('reports source contract drift without mutating or regenerating the generated source', () => {
    const driftedSource = {
      ...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE,
      schemaVersion: 'v3-obj-surface-voxels/v2',
      source: {
        ...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source,
        hash: 'sha256:bad',
      },
      options: {
        ...V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.options,
        targetHeightVoxels: 128,
        surfaceThicknessVoxels: 2,
      },
    };

    const report = buildV3ExactSourceBaseline({
      source: driftedSource,
      referenceProportions: readyReferenceProportions,
      visualQa: readyVisualQa,
    });

    assert.equal(report.ready, false);
    assert.equal(report.status, 'blocked');
    assert.deepEqual(
      report.issues.map((issue) => issue.code),
      [
        'schema-mismatch',
        'hash-mismatch',
        'target-height-mismatch',
        'surface-thickness-mismatch',
      ]
    );
    assert.equal(
      V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash,
      V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash
    );
  });

  it('blocks the full baseline when reference proportions, visual QA, or supplied silhouette deltas fail', () => {
    const report = buildV3ExactSourceBaseline({
      referenceProportions: {
        ready: false,
        issues: ['helmetLower width is below the rendered OBJ target'],
      },
      visualQa: {
        ready: null,
        issues: [],
      },
      silhouetteComparison: {
        deltas: {
          front: { widthRatio: 0.11, heightRatio: 0, areaRatio: 0.03 },
          side: { widthRatio: 0.01, heightRatio: 0, areaRatio: 0.02 },
        },
        mismatchNotes: ['front width is 11.0% wider than reference'],
      },
    });

    assert.equal(report.ready, false);
    assert.deepEqual(
      report.issues.map((issue) => issue.code),
      ['reference-proportions-blocked', 'visual-qa-missing', 'silhouette-delta-high']
    );
    assert.match(report.issues[0].message, /helmetLower width/);
    assert.match(report.issues[2].message, /front width/);
  });

  it('builds source-only dashboard evidence without leaking voxel runs or player-ready copy', () => {
    const evidence = buildV3ExactSourceDashboardEvidence();
    const serialized = JSON.stringify(evidence);

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.issues, []);
    assert.equal(evidence.summary?.schemaVersion, 'v3-obj-surface-voxels/v1');
    assert.equal(evidence.summary?.targetHeightVoxels, 192);
    assert.equal(evidence.summary?.surfaceThicknessVoxels, 1);
    assert.equal(evidence.summary?.sourceHash, V3_EXACT_SOURCE_BASELINE_ACCEPTANCE.acceptedHash);
    assert.equal(evidence.summary?.playerReadiness, 'not-player-ready');
    assert.equal(evidence.summary?.referenceProportionsEvidence, 'tracked-separately');
    assert.equal(evidence.summary?.visualQaEvidence, 'tracked-separately');
    assert.equal(serialized.includes('"runs"'), false);
    assert.equal(serialized.includes('"slots"'), false);
    assert.equal(serialized.includes('Player Ready'), false);
  });
});
