import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../components/v3/VoxelModelsV3';
import {
  buildV3VisualQaReport,
  buildV3VisualQaSnapshots,
  V3_VISUAL_QA_VIEW_IDS,
  V3_VISUAL_QA_VIEWPORTS,
  type V3VisualQaIssueCode,
} from './v3VisualQa';

const collectIssueCodes = (subject: THREE.Object3D): V3VisualQaIssueCode[] =>
  buildV3VisualQaReport(subject).issues.map((issue) => issue.code);

function createBoxSubject({
  name,
  size,
  color,
  emissive = false,
}: {
  name: string;
  size: THREE.Vector3Tuple;
  color: string;
  emissive?: boolean;
}): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  root.userData.modelSystem = 'v3';
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color,
      emissive: emissive ? new THREE.Color(color) : new THREE.Color('#000000'),
      emissiveIntensity: emissive ? 1.6 : 0,
    })
  );
  mesh.name = `${name}:mesh`;
  root.add(mesh);
  return root;
}

describe('V3 visual QA view fixtures', () => {
  it('uses deterministic fixed-angle views and runtime-compatible viewports', () => {
    assert.deepEqual(V3_VISUAL_QA_VIEW_IDS, ['front', 'side', 'rear', 'threeQuarter']);
    assert.deepEqual(V3_VISUAL_QA_VIEWPORTS, {
      desktop: { width: 1280, height: 800 },
      mobile: { width: 390, height: 844 },
    });
  });
});

describe('buildV3VisualQaSnapshots', () => {
  it('returns a deterministic metric row for every view and viewport', () => {
    const snapshots = buildV3VisualQaSnapshots(buildV3SpartanModel());
    const keys = snapshots.map((snapshot) => `${snapshot.viewId}:${snapshot.viewportId}`);

    assert.deepEqual(keys, [
      'front:desktop',
      'front:mobile',
      'side:desktop',
      'side:mobile',
      'rear:desktop',
      'rear:mobile',
      'threeQuarter:desktop',
      'threeQuarter:mobile',
    ]);

    for (const snapshot of snapshots) {
      assert.equal(snapshot.panelCount > 0, true);
      assert.equal(snapshot.materialGroupCount > 0, true);
      assert.equal(snapshot.projectedWidth > 0, true);
      assert.equal(snapshot.projectedHeight > 0, true);
      assert.equal(snapshot.occupiedAreaRatio > 0, true);
      assert.equal(snapshot.importantPartVisibility.head, true);
      assert.equal(snapshot.importantPartVisibility.upperTorso, true);
      assert.equal(snapshot.importantPartVisibility.leftLeg, true);
      assert.equal(snapshot.importantPartVisibility.rightLeg, true);
    }

    assert.deepEqual(
      buildV3VisualQaSnapshots(buildV3SpartanModel()),
      snapshots
    );
  });

  it('normalizes occupied area by viewport aspect instead of duplicating desktop and mobile rows', () => {
    const snapshots = buildV3VisualQaSnapshots(buildV3SpartanModel());
    const frontDesktop = snapshots.find((snapshot) => snapshot.viewId === 'front' && snapshot.viewportId === 'desktop');
    const frontMobile = snapshots.find((snapshot) => snapshot.viewId === 'front' && snapshot.viewportId === 'mobile');

    assert.ok(frontDesktop);
    assert.ok(frontMobile);
    assert.notEqual(frontDesktop.occupiedAreaRatio, frontMobile.occupiedAreaRatio);
    assert.equal(frontDesktop.projectedWidth, frontMobile.projectedWidth);
    assert.equal(frontDesktop.projectedHeight, frontMobile.projectedHeight);
  });
});

describe('buildV3VisualQaReport', () => {
  it('accepts the built-in V3 Spartan model under default thresholds', () => {
    const report = buildV3VisualQaReport(buildV3SpartanModel());

    assert.equal(report.ready, true);
    assert.deepEqual(report.issues, []);
    assert.equal(report.summary.snapshotCount, 8);
    assert.equal(report.summary.minOccupiedAreaRatio > 0, true);
    assert.equal(report.summary.maxOccupiedAreaRatio < 1, true);
    assert.equal(report.summary.panelCount > 0, true);
    assert.equal(report.summary.materialGroupCount > 0, true);
  });

  it('flags missing visual mass deterministically', () => {
    const codes = collectIssueCodes(new THREE.Group());

    assert.equal(codes.includes('missing_visual_mass'), true);
    assert.equal(codes.includes('occupied_area_low'), true);
    assert.equal(codes.includes('important_part_missing'), true);
  });

  it('flags missing required V3 part mappings even when visual mass is present', () => {
    const subject = createBoxSubject({
      name: 'unmapped-v3-subject',
      size: [0.9, 1.8, 0.12],
      color: '#38bdf8',
    });

    const report = buildV3VisualQaReport(subject, {
      thresholds: {
        maxDarkMaterialCoverage: 1,
        minMaterialGroupCount: 1,
        minPanelCount: 0,
      },
    });

    assert.equal(report.summary.importantPartCount, 6);
    assert.equal(report.summary.visibleImportantPartCount, 0);
    assert.equal(report.issues.filter((issue) => issue.code === 'important_part_missing').length, 6);
  });

  it('flags synthetic dark slab readability failures', () => {
    const slab = createBoxSubject({
      name: 'dark-slab',
      size: [0.9, 1.8, 0.12],
      color: '#020617',
    });
    const codes = collectIssueCodes(slab);

    assert.equal(codes.includes('dark_coverage_high'), true);
    assert.equal(codes.includes('material_groups_low'), true);
  });

  it('flags synthetic block scale failures', () => {
    const block = createBoxSubject({
      name: 'block',
      size: [8, 8, 8],
      color: '#38bdf8',
    });
    const codes = buildV3VisualQaReport(block, {
      thresholds: {
        maxOccupiedAreaRatio: 0.72,
        minMaterialGroupCount: 1,
        minPanelCount: 0,
      },
    }).issues.map((issue) => issue.code);

    assert.equal(codes.includes('occupied_area_high'), true);
  });
});
