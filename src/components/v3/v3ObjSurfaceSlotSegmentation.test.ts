import assert from 'node:assert/strict';
import test from 'node:test';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';
import {
  analyzeV3AegisObjSurfaceSlotSegmentation,
  classifyV3ObjSurfaceReferenceFitGapReview,
  classifyV3ObjSurfaceReferenceTargetReview,
  formatV3ObjSurfaceSlotSegmentationSummary,
} from './v3ObjSurfaceSlotSegmentation';

test('exact OBJ surface segmentation covers every V3 slot with non-blocking review diagnostics', () => {
  const report = analyzeV3AegisObjSurfaceSlotSegmentation();

  assert.equal(report.ready, true);
  assert.equal(report.coverage.expectedSlotCount, V3_CHARACTER_SLOT_IDS.length);
  assert.equal(report.coverage.coveredSlotCount, V3_CHARACTER_SLOT_IDS.length);
  assert.deepEqual(report.coverage.emptySlots, []);
  assert.equal(report.excludedObjects.count, 4);
  assert.deepEqual(report.excludedObjects.names, [
    'Attachment:_UA_Brim_[Mark_V_[B]]',
    'Attachment:_UA_[Mark_V_[B]]',
    'Chest:_Combat_Knife_Hilt',
    'Chest:_Combat_Knife_Sheath',
  ]);
  assert.deepEqual(report.roleDiversity.palette, [
    'decal',
    'emissive',
    'fixed',
    'primary',
    'secondary',
    'undersuit',
    'visor',
  ]);
  assert.deepEqual(
    report.roleDiversity.lowDiversitySlots.map((entry) => entry.slot).sort(),
    ['forearmLeft', 'forearmRight', 'handLeft', 'handRight']
  );
  assert.ok(report.diagnostics.length > 0);
  assert.equal(report.diagnostics.every((diagnostic) =>
    diagnostic.category === 'segmentation-review' &&
    diagnostic.blocksBodyRebuild === false
  ), true);

  const summary = formatV3ObjSurfaceSlotSegmentationSummary(report);
  assert.match(summary, /Segmentation Review/);
  assert.doesNotMatch(summary, /blocked/i);
});

test('exact OBJ surface flags known suspicious family bounds as segmentation review', () => {
  const report = analyzeV3AegisObjSurfaceSlotSegmentation();
  const hasBoundReview = (
    family: string,
    axis: string,
    direction: string
  ): boolean => report.suspiciousFamilyBounds.some((entry) =>
    entry.family === family &&
    entry.axis === axis &&
    entry.direction === direction &&
    entry.category === 'segmentation-review' &&
    entry.blocksBodyRebuild === false
  );

  assert.equal(hasBoundReview('forearm', 'width', 'too-large'), true);
  assert.equal(hasBoundReview('forearm', 'vertical', 'too-high'), true);
  assert.equal(hasBoundReview('hand', 'width', 'too-large'), true);
  assert.equal(hasBoundReview('hand', 'vertical', 'too-high'), true);
  assert.equal(hasBoundReview('helmet', 'width', 'too-small'), true);
  assert.equal(hasBoundReview('chest', 'width', 'too-small'), true);
  assert.equal(hasBoundReview('shoulder', 'height', 'too-small'), true);
});

test('exact OBJ paired slots stay symmetric enough for source diagnostics', () => {
  const report = analyzeV3AegisObjSurfaceSlotSegmentation();
  const forearm = report.pairedSlotSymmetry.find((entry) => entry.family === 'forearm');

  assert.equal(report.pairedSlotSymmetry.every((entry) => entry.balanced), true);
  assert.equal(report.diagnostics.some((entry) => entry.code === 'paired-slot-imbalance'), false);
  assert.ok(forearm);
  assert.ok(forearm.voxelBalance > 0.99, `forearm voxel balance was ${forearm.voxelBalance}`);
});

test('reference fit gap classifiers mark old slot-family gaps as segmentation review diagnostics', () => {
  const fitGapReviews = [
    { slot: 'forearm', axis: 'width', direction: 'too-large' },
    { slot: 'forearm', axis: 'vertical', direction: 'too-high' },
    { slot: 'hand', axis: 'width', direction: 'too-large' },
    { slot: 'hand', axis: 'vertical', direction: 'too-high' },
    { slot: 'helmet', axis: 'width', direction: 'too-small' },
    { slot: 'shoulder', axis: 'height', direction: 'too-small' },
    { slot: 'chest', axis: 'width', direction: 'too-small' },
  ] as const;

  for (const review of fitGapReviews) {
    const classification = classifyV3ObjSurfaceReferenceFitGapReview(review);
    assert.equal(classification?.category, 'segmentation-review');
    assert.equal(classification?.blocksBodyRebuild, false);
  }

  assert.equal(classifyV3ObjSurfaceReferenceFitGapReview({
    slot: 'chest',
    axis: 'width',
    direction: 'too-large',
  }), null);
  assert.equal(
    classifyV3ObjSurfaceReferenceTargetReview({ slot: 'upperArm', axis: 'height' })?.category,
    'segmentation-review'
  );
  assert.equal(
    classifyV3ObjSurfaceReferenceTargetReview({ slot: 'shin', axis: 'depth' })?.category,
    'segmentation-review'
  );
});
