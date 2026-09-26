import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
  V3CustomArmorSlot,
} from '../customArmor';
import {
  getCustomArmorGridScale,
  isVoxelInSlotBounds,
  validateCustomArmorPiece,
} from '../customArmor';
import {
  applyV3ArmorCoveragePatch,
  buildV3ArmorCoveragePatch,
  buildV3ArmorCoverageReport,
  buildV3ArmorCoveragePreview,
  type V3ArmorCoverageIssueClassification,
} from './v3ArmorEditorCoverage';

const piece = (
  slot: V3CustomArmorSlot,
  voxels: CustomArmorVoxel[],
  overrides: Partial<CustomArmorPieceSnapshot> = {}
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: `${slot}-coverage-draft`,
  name: `${slot} Coverage Draft`,
  slot,
  modelSystem: 'v3',
  gridScale: 2,
  sourcePreset: 'phase-coverage',
  thumbnail: 'data:image/png;base64,coverage',
  voxels,
  updatedAt: 1_000,
  ...overrides,
});

const box = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  role: CustomArmorMaterialRole
): CustomArmorVoxel[] => {
  const voxels: CustomArmorVoxel[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        voxels.push({ x, y, z, role });
      }
    }
  }
  return voxels;
};

const suitDrafts = (
  overrides: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>> = {}
) => ({
  chest: piece('chest', box(8, 14, 8, 15, 6, 10, 'primary')),
  pelvis: piece('pelvis', box(8, 14, 2, 8, 6, 10, 'primary')),
  back: piece('back', box(8, 14, 8, 16, 10, 12, 'primary')),
  ...overrides,
} as Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>);

const coordKey = (voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

const assertAllInBounds = (draft: CustomArmorPieceSnapshot): void => {
  const gridScale = getCustomArmorGridScale(draft);
  for (const voxel of draft.voxels) {
    assert.equal(
      isVoxelInSlotBounds(draft.slot, voxel, 'medium', 'v3', gridScale),
      true,
      `expected ${coordKey(voxel)} to stay inside ${draft.slot} bounds`
    );
  }
};

test('report detects the open chest foundation void found during sprint review', () => {
  const report = buildV3ArmorCoverageReport({
    activeSlot: 'chest',
    draft: piece('chest', [
      ...box(4, 21, 12, 18, 4, 5, 'primary'),
      ...box(4, 21, 12, 18, 13, 14, 'primary'),
    ]),
  });

  assert.equal(report.ready, false);
  assert.equal(report.summary.highSeverityIssueCount, 1);
  assert.equal(report.summary.totalMissingVoxelCount > 0, true);
  assert.equal(report.issues[0]?.classification, 'armor fill/coverage gap' satisfies V3ArmorCoverageIssueClassification);
  assert.equal(report.issues[0]?.slot, 'chest');
  assert.equal(report.issues[0]?.region, 'torsoCavity');
  assert.ok(report.issues[0]?.reproductionHint.includes('bind/rest pose'));
  assert.ok(report.issues[0]?.reproductionHint.includes('sprint frame 82'));
});

test('patch previews deterministic undersuit fill voxels without mutating the source draft', () => {
  const draft = piece('chest', [
    ...box(4, 21, 12, 18, 4, 5, 'primary'),
    ...box(4, 21, 12, 18, 13, 14, 'primary'),
  ]);
  const before = structuredClone(draft);
  const report = buildV3ArmorCoverageReport({ activeSlot: 'chest', draft });
  const patch = buildV3ArmorCoveragePatch(report);
  const preview = buildV3ArmorCoveragePreview(draft, patch);

  assert.deepEqual(draft, before);
  assert.equal(patch.issueIds.length, 1);
  assert.equal(patch.validationResult.valid, true);
  assert.equal(patch.addedVoxelsBySlot.chest?.length, report.issues[0]?.missingVoxelCount);
  assert.equal(preview.changed, true);
  assert.equal(preview.added.length, patch.addedVoxelsBySlot.chest?.length);
  assert.equal(preview.removed.length, 0);
  assert.equal(preview.remapped.length, 0);
  assert.equal(preview.previewDraft.updatedAt, draft.updatedAt);
  assert.ok(preview.added.every((voxel) => voxel.role === 'undersuit'));
  assert.deepEqual(
    preview.added.map(coordKey),
    [...preview.added].map(coordKey).sort()
  );
});

test('apply patch adds bounded editable voxels and clears the detected chest issue', () => {
  const draft = piece('chest', [
    ...box(4, 21, 12, 18, 4, 5, 'primary'),
    ...box(4, 21, 12, 18, 13, 14, 'primary'),
  ]);
  const report = buildV3ArmorCoverageReport({ activeSlot: 'chest', draft });
  const patch = buildV3ArmorCoveragePatch(report);

  const patched = applyV3ArmorCoveragePatch({ chest: draft }, patch, { now: 2_000 }).chest!;
  const repairedReport = buildV3ArmorCoverageReport({ activeSlot: 'chest', draft: patched });

  assert.equal(patched.updatedAt, 2_000);
  assert.equal(patched.voxels.length, draft.voxels.length + (patch.addedVoxelsBySlot.chest?.length ?? 0));
  assert.equal(validateCustomArmorPiece(patched).valid, true);
  assertAllInBounds(patched);
  assert.equal(repairedReport.ready, true);
  assert.equal(repairedReport.issues.length, 0);
});

test('full-suit report finds slot continuity gaps between chest pelvis and back', () => {
  const drafts = suitDrafts({
    chest: piece('chest', box(8, 14, 10, 16, 6, 10, 'primary')),
    pelvis: piece('pelvis', box(8, 14, 2, 5, 6, 10, 'primary')),
    back: piece('back', box(8, 14, 10, 16, 12, 13, 'primary')),
  });

  const report = buildV3ArmorCoverageReport({
    activeSlot: 'chest',
    draft: drafts.chest!,
    suitDrafts: drafts,
    scope: 'full-suit',
  });

  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.region === 'slotSeam' && issue.slot === 'pelvis'));
  assert.ok(report.issues.some((issue) => issue.region === 'backGap' && issue.slot === 'back'));
  assert.ok(report.summary.issueCount >= 2);
});

test('patch builder skips duplicate and over-budget additions loudly', () => {
  const draft = piece('chest', [
    ...box(0, 8, 0, 35, 0, 25, 'primary'),
    ...box(23, 31, 0, 35, 0, 25, 'primary'),
  ], {
    voxels: [
      ...box(0, 8, 0, 35, 0, 25, 'primary'),
      ...box(23, 31, 0, 35, 0, 25, 'primary'),
    ],
  });
  const report = buildV3ArmorCoverageReport({ activeSlot: 'chest', draft });
  const patch = buildV3ArmorCoveragePatch(report);

  assert.equal(patch.validationResult.valid, false);
  assert.ok(patch.warnings.some((warning) => warning.includes('voxel budget')));
  assert.deepEqual(patch.addedVoxelsBySlot.chest, []);
});
