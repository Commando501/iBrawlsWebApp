import assert from 'node:assert/strict';
import test from 'node:test';
import type { CharacterLoadout } from '../VoxelModels';
import {
  validateCustomArmorPiece,
  type CustomArmorCatalog,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
} from '../customArmor';
import {
  V3_POSE_CLEARANCE_CASES,
  type V3PoseClearanceCaseId,
  type V3PoseClearanceIssue,
  type V3PoseClearanceIssueCode,
  type V3PoseClearanceOptions,
  type V3PoseClearanceReport,
} from '../grifball/v3PoseClearance';
import { buildV3ArmorEditorMotionQaReport } from './v3ArmorEditorMotionQa';

const voxel = (x = 0, y = 0, z = 0): CustomArmorPieceSnapshot['voxels'][number] => ({
  x,
  y,
  z,
  role: 'primary',
});

const draftFor = (
  slot: V3CustomArmorSlot,
  overrides: Partial<CustomArmorPieceSnapshot> = {}
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: `${slot}_draft`,
  name: `${slot} draft`,
  slot,
  modelSystem: 'v3',
  gridScale: 2,
  voxels: [voxel(1, 2, 3), voxel(2, 2, 3), voxel(2, 3, 3)],
  updatedAt: 1_000,
  ...overrides,
});

const catalogPieceFor = (
  slot: V3CustomArmorSlot,
  overrides: Partial<CustomArmorPiece> = {}
): CustomArmorPiece => ({
  ...draftFor(slot, {
    id: `${slot}_catalog`,
    name: `${slot} catalog`,
    updatedAt: 2_000,
  }),
  createdAt: 1_900,
  ...overrides,
});

const catalog = (pieces: CustomArmorPiece[] = []): CustomArmorCatalog => ({
  version: 1,
  pieces,
});

const poseIssue = (
  caseId: V3PoseClearanceCaseId,
  code: V3PoseClearanceIssueCode,
  partIds?: string[]
): V3PoseClearanceIssue => ({
  caseId,
  code,
  message: `${caseId}:${code}`,
  ...(partIds ? { partIds } : {}),
});

const poseReport = (
  caseId: V3PoseClearanceCaseId,
  issues: V3PoseClearanceIssue[] = []
): V3PoseClearanceReport => {
  const caseReport = {
    id: caseId,
    ready: issues.length === 0,
    metrics: {
      partCount: 19,
      detailBoneCount: 8,
      partOverlapRatio: issues.some((issue) => issue.code === 'part-overlap-high') ? 0.7 : 0,
      limbGap: 0.4,
      footFloorPenetration: 0,
      footLift: 0,
      upperLowerCoupling: 0,
      minProjectedWidth: 0.2,
      minProjectedHeight: 0.4,
    },
    overlays: [],
    visualQaSummary: null,
    issues,
  };

  return {
    ready: issues.length === 0,
    cases: [caseReport],
    summary: {
      caseCount: 1,
      readyCaseCount: issues.length === 0 ? 1 : 0,
      issueCount: issues.length,
      maxPartOverlapRatio: caseReport.metrics.partOverlapRatio,
      minLimbGap: caseReport.metrics.limbGap,
      maxWeaponGripDrift: 0,
      maxFootFloorPenetration: 0,
      maxFootLift: 0,
      maxUpperLowerCoupling: 0,
    },
    issues,
  };
};

const fakeAnalyzer = (
  issuesByCase: Partial<Record<V3PoseClearanceCaseId, V3PoseClearanceIssue[]>> = {}
) => {
  const calls: Array<{ caseId: V3PoseClearanceCaseId; loadout?: CharacterLoadout }> = [];
  const analyzer = (
    caseId: V3PoseClearanceCaseId,
    options: V3PoseClearanceOptions = {}
  ): V3PoseClearanceReport => {
    calls.push({
      caseId,
      loadout: options.loadout ? structuredClone(options.loadout) : undefined,
    });
    return poseReport(caseId, issuesByCase[caseId] ?? []);
  };

  return { analyzer, calls };
};

test('buildV3ArmorEditorMotionQaReport checks only the selected active pose case by default', () => {
  const activeDraft = draftFor('helmet', { id: 'unsaved_active_helmet', updatedAt: 3_000 });
  const catalogChest = catalogPieceFor('chest', {
    id: 'equipped_chest',
    name: 'Catalog Chest',
    updatedAt: 4_000,
  });
  const staleEquippedChest = draftFor('chest', {
    id: 'equipped_chest',
    name: 'Stale Equipped Chest',
    updatedAt: 2_500,
  });
  const baseLoadout: CharacterLoadout = {
    modelSystem: 'v2',
    customArmor: {
      chest: staleEquippedChest,
    },
  };
  const { analyzer, calls } = fakeAnalyzer();

  const report = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: activeDraft,
    selectedCaseId: 'sprint',
    loadout: baseLoadout,
    catalog: catalog([catalogChest]),
    analyzer,
  });

  assert.equal(report.ready, true);
  assert.equal(report.score, 100);
  assert.equal(report.summary.mode, 'active-slot');
  assert.deepEqual(calls.map((call) => call.caseId), ['sprint']);
  assert.equal(calls[0].loadout?.modelSystem, 'v3');
  assert.equal(calls[0].loadout?.modelType, undefined);
  assert.deepEqual(calls[0].loadout?.customArmor?.helmet, activeDraft);
  assert.equal(calls[0].loadout?.customArmor?.chest?.name, 'Catalog Chest');
});

test('buildV3ArmorEditorMotionQaReport checks every pose case for full-suit reports', () => {
  const activeDraft = draftFor('helmet', { id: 'unsaved_active_helmet' });
  const stagedHelmet = draftFor('helmet', { id: 'staged_helmet' });
  const stagedChest = draftFor('chest', { id: 'staged_chest' });
  const { analyzer, calls } = fakeAnalyzer();

  const report = buildV3ArmorEditorMotionQaReport({
    mode: 'full-suit',
    activeSlot: 'helmet',
    draft: activeDraft,
    suitDrafts: {
      helmet: stagedHelmet,
      chest: stagedChest,
    },
    analyzer,
  });

  assert.equal(report.ready, true);
  assert.equal(report.summary.mode, 'full-suit');
  assert.deepEqual(
    calls.map((call) => call.caseId),
    V3_POSE_CLEARANCE_CASES.map((poseCase) => poseCase.id)
  );
  assert.equal(calls[0].loadout?.modelSystem, 'v3');
  assert.deepEqual(calls[0].loadout?.customArmor?.helmet, activeDraft);
  assert.deepEqual(calls[0].loadout?.customArmor?.chest, stagedChest);
});

test('buildV3ArmorEditorMotionQaReport scores issues and maps them to affected slots', () => {
  const idleIssues = [
    poseIssue('idle', 'part-overlap-high', ['helmet', 'shoulderLeft']),
    poseIssue('idle', 'visual-qa-failed'),
  ];
  const { analyzer } = fakeAnalyzer({ idle: idleIssues });

  const report = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: draftFor('helmet'),
    selectedCaseId: 'idle',
    analyzer,
  });

  assert.equal(report.ready, false);
  assert.equal(report.score, 60);
  assert.deepEqual(report.slotIssueCounts, {
    helmet: 2,
    shoulderLeft: 1,
  });
  assert.deepEqual(report.issues.map((issue) => issue.slots), [
    ['helmet', 'shoulderLeft'],
    ['helmet'],
  ]);
  assert.equal(report.summary.issueCount, 2);
  assert.equal(report.summary.readyCaseCount, 0);
});

test('buildV3ArmorEditorMotionQaReport does not mutate editor inputs', () => {
  const activeDraft = draftFor('helmet', { id: 'active_to_keep' });
  const stagedChest = draftFor('chest', { id: 'staged_chest_to_keep' });
  const baseLoadout: CharacterLoadout = {
    modelSystem: 'v2',
    modelType: 'large',
    customArmor: {
      chest: draftFor('chest', { id: 'equipped_chest_to_keep' }),
    },
  };
  const sourceCatalog = catalog([catalogPieceFor('chest', { id: 'equipped_chest_to_keep' })]);
  const suitDrafts = { chest: stagedChest };
  const before = structuredClone({
    activeDraft,
    baseLoadout,
    sourceCatalog,
    suitDrafts,
  });
  const { analyzer } = fakeAnalyzer();

  buildV3ArmorEditorMotionQaReport({
    mode: 'full-suit',
    activeSlot: 'helmet',
    draft: activeDraft,
    loadout: baseLoadout,
    catalog: sourceCatalog,
    suitDrafts,
    analyzer,
  });

  assert.deepEqual({
    activeDraft,
    baseLoadout,
    sourceCatalog,
    suitDrafts,
  }, before);
});

test('buildV3ArmorEditorMotionQaReport no-ops for non-V3 drafts', () => {
  const legacyDraft: CustomArmorPieceSnapshot = {
    ...draftFor('helmet'),
    id: 'legacy_helmet',
    modelSystem: 'v2',
    modelType: 'medium',
    gridScale: undefined,
  };
  const analyzer = () => {
    throw new Error('non-V3 reports should not analyze poses');
  };

  const report = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: legacyDraft,
    analyzer,
  });

  assert.equal(report.ready, false);
  assert.equal(report.score, 0);
  assert.deepEqual(report.cases, []);
  assert.equal(report.summary.supported, false);
  assert.deepEqual(report.slotIssueCounts, {});
  assert.equal(report.issues[0].code, 'unsupported-non-v3');
});

test('buildV3ArmorEditorMotionQaReport keeps motion readiness advisory-only', () => {
  const invalidDraft = draftFor('helmet', {
    id: 'invalid_but_motion_checked',
    voxels: [],
  });
  assert.equal(validateCustomArmorPiece(invalidDraft).valid, false);
  const { analyzer, calls } = fakeAnalyzer();

  const report = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: invalidDraft,
    selectedCaseId: 'idle',
    analyzer,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].loadout?.customArmor?.helmet, invalidDraft);
  assert.equal(report.ready, true);
  assert.equal(report.score, 100);
  assert.deepEqual(report.issues, []);
});

test('buildV3ArmorEditorMotionQaReport exposes a deterministic source signature', () => {
  const firstDraft = draftFor('helmet', { updatedAt: 1_234 });
  const secondDraft = structuredClone(firstDraft);
  const changedDraft = draftFor('helmet', { updatedAt: 1_235 });
  const { analyzer } = fakeAnalyzer();

  const first = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: firstDraft,
    selectedCaseId: 'idle',
    analyzer,
  });
  const second = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: secondDraft,
    selectedCaseId: 'idle',
    analyzer,
  });
  const changed = buildV3ArmorEditorMotionQaReport({
    activeSlot: 'helmet',
    draft: changedDraft,
    selectedCaseId: 'idle',
    analyzer,
  });

  assert.equal(first.sourceSignature, second.sourceSignature);
  assert.notEqual(first.sourceSignature, changed.sourceSignature);
});
