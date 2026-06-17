import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  V3_OBJ_REFERENCE_PROPORTION_TARGETS,
  V3_REFERENCE_PROPORTION_BANDS,
  analyzeV3AegisReferenceProportions,
  buildV3ReferenceProportionTargetsFromDashboardExport,
  formatV3ReferenceProportionGapSummary,
  sampleV3ReferenceProportionBands,
  type V3ReferenceProportionTargets,
} from './v3ReferenceProportions';

const makeBox = (width: number, height: number, depth: number): THREE.Group => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.y = height / 2;
  group.add(mesh);
  group.updateWorldMatrix(true, true);
  return group;
};

const makeSyntheticTargets = (): V3ReferenceProportionTargets => ({
  ...V3_OBJ_REFERENCE_PROPORTION_TARGETS,
  sourceLabel: 'synthetic obj fixture',
  bands: Object.fromEntries(
    V3_REFERENCE_PROPORTION_BANDS.map((band) => [
      band,
      { widthRatio: 0.2, depthRatio: 0.12 },
    ])
  ) as V3ReferenceProportionTargets['bands'],
});

describe('V3 OBJ reference proportion targets', () => {
  it('defines deterministic export-safe OBJ targets for every vertical band', () => {
    assert.equal(V3_OBJ_REFERENCE_PROPORTION_TARGETS.sourceKind, 'obj');
    assert.equal(V3_OBJ_REFERENCE_PROPORTION_TARGETS.global.front.widthRatio, 0.600598);
    assert.equal(V3_OBJ_REFERENCE_PROPORTION_TARGETS.global.side.widthRatio, 0.32883);
    assert.deepEqual(
      Object.keys(V3_OBJ_REFERENCE_PROPORTION_TARGETS.bands).sort(),
      [...V3_REFERENCE_PROPORTION_BANDS].sort()
    );
    assert.equal(
      JSON.stringify(V3_OBJ_REFERENCE_PROPORTION_TARGETS).includes('C:\\'),
      false
    );
    assert.equal(
      JSON.stringify(V3_OBJ_REFERENCE_PROPORTION_TARGETS).includes('/Users/'),
      false
    );
  });

  it('samples stable width and depth ratios from Three objects without raw geometry output', () => {
    const bands = sampleV3ReferenceProportionBands(makeBox(0.9, 1.8, 0.36));

    assert.deepEqual(Object.keys(bands).sort(), [...V3_REFERENCE_PROPORTION_BANDS].sort());
    assert.equal(bands.chest.widthRatio, 0.5);
    assert.equal(bands.chest.depthRatio, 0.2);
    assert.equal(JSON.stringify(bands).includes('position'), false);
  });

  it('flags synthetic block/wide-limb fixtures against reference targets', () => {
    const report = analyzeV3AegisReferenceProportions({
      model: makeBox(1.6, 1.8, 0.8),
      targets: makeSyntheticTargets(),
    });

    assert.equal(report.ready, false);
    assert.ok(report.issues.some((issue) => issue.code === 'global-front-width-high'));
    assert.ok(report.issues.some((issue) => issue.code === 'global-side-depth-high'));
    assert.ok(report.issues.some((issue) => issue.code === 'band-width-high'));
    assert.ok(report.summary.maxBandWidthDelta > 0.6);
  });

  it('flags synthetic collapsed fixtures against reference targets', () => {
    const report = analyzeV3AegisReferenceProportions({
      model: makeBox(0.02, 1.8, 0.02),
      targets: makeSyntheticTargets(),
    });

    assert.equal(report.ready, false);
    assert.ok(report.issues.some((issue) => issue.code === 'global-front-width-low'));
    assert.ok(report.issues.some((issue) => issue.code === 'global-side-depth-low'));
    assert.ok(report.issues.some((issue) => issue.code === 'band-width-low'));
    assert.ok(report.issues.some((issue) => issue.code === 'band-depth-low'));
  });

  it('parses dashboard-exported OBJ proportion bands into reusable targets', () => {
    const targets = buildV3ReferenceProportionTargetsFromDashboardExport({
      kind: 'v3-readiness-dashboard',
      version: 1,
      ready: false,
      status: 'not-player-ready',
      label: 'Not Player Ready',
      checklist: {
        baseProportions: false,
        builtInArmorFidelity: false,
        poseAtlas: false,
        attackMovementAnimation: false,
        referenceComparison: false,
        performanceSmoke: false,
      },
      evidence: {
        suitFidelity: { ready: true, issueCount: 0, issues: [] },
        visualQa: { ready: true, issueCount: 0, issues: [] },
        poseClearance: { ready: true, issueCount: 0, issues: [] },
        performanceSmoke: { ready: true, issueCount: 0, issues: [] },
        referenceComparison: {
          acknowledged: true,
          issueCount: 0,
          issues: [],
          metadata: {
            fileName: 'Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
            kind: 'obj',
          },
          proportionBands: {
            reference: V3_OBJ_REFERENCE_PROPORTION_TARGETS.bands,
            global: V3_OBJ_REFERENCE_PROPORTION_TARGETS.global,
          },
        },
      },
      blockers: [],
      warnings: [],
      summary: 'fixture',
    });

    assert.equal(targets.sourceKind, 'obj');
    assert.equal(targets.global.front.widthRatio, 0.600598);
    assert.equal(targets.bands.shin.widthRatio, V3_OBJ_REFERENCE_PROPORTION_TARGETS.bands.shin.widthRatio);
  });

  it('passes the built-in Aegis model through Phase 32 proportion gates', () => {
    const report = analyzeV3AegisReferenceProportions();

    assert.equal(report.ready, true, formatV3ReferenceProportionGapSummary(report));
    assert.equal(report.targets.sourceKind, 'obj');
    assert.ok(report.summary.maxBandWidthDelta <= 0.2);
    assert.ok(report.summary.maxBandDepthDelta <= 0.08);
  });
});
