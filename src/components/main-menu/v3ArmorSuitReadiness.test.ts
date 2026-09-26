import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_ARMOR_MAX_CATALOG_BYTES,
  CUSTOM_ARMOR_MAX_CATALOG_PIECES,
  V3_CUSTOM_ARMOR_SLOTS,
  type CustomArmorCatalog,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
} from '../customArmor';
import type { V3ArmorEditorMotionQaReport } from './v3ArmorEditorMotionQa';
import type { V3ArmorCoverageReport } from './v3ArmorEditorCoverage';
import type { V3ArmorEditorVisualQaReport } from './v3ArmorEditorVisualQa';
import type {
  V3SuitDraftValidationResult,
  V3SuitSlotValidation,
} from './v3ArmorEditorSuitWorkflow';
import type {
  V3SuitProfile,
  V3SuitProfileValidationResult,
} from './v3ArmorSuitProfiles';
import { buildV3SuitReadinessReport } from './v3ArmorSuitReadiness';

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
  voxels: [{ x: 0, y: 0, z: 0, role: 'primary' }],
  updatedAt: 1_000,
  ...overrides,
});

const suitDrafts = (): Record<V3CustomArmorSlot, CustomArmorPieceSnapshot> => (
  Object.fromEntries(
    V3_CUSTOM_ARMOR_SLOTS.map((slot) => [slot, draftFor(slot)])
  ) as Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>
);

const slotValidation = (
  slot: V3CustomArmorSlot,
  overrides: Partial<V3SuitSlotValidation> = {}
): V3SuitSlotValidation => ({
  slot,
  valid: true,
  errors: [],
  warnings: [],
  advisoryScore: 100,
  ...overrides,
});

const suitValidation = (
  overrides: Partial<V3SuitDraftValidationResult> = {}
): V3SuitDraftValidationResult => ({
  valid: true,
  slots: Object.fromEntries(
    V3_CUSTOM_ARMOR_SLOTS.map((slot) => [slot, slotValidation(slot)])
  ) as Record<V3CustomArmorSlot, V3SuitSlotValidation>,
  blockers: [],
  errors: [],
  advisoryScore: 100,
  ...overrides,
});

const readyVisualQa = (): V3ArmorEditorVisualQaReport => ({
  ready: true,
  score: 100,
  issues: [],
  summary: {
    snapshotCount: 1,
    minOccupiedAreaRatio: 0.2,
    maxOccupiedAreaRatio: 0.2,
    minProjectedWidth: 0.4,
    minProjectedHeight: 0.5,
    maxDarkMaterialCoverage: 0.2,
    maxEmissiveMaterialCoverage: 0,
    panelCount: 12,
    materialGroupCount: 2,
    visibleImportantPartCount: 0,
    importantPartCount: 0,
  },
});

const warningVisualQa = (): V3ArmorEditorVisualQaReport => ({
  ready: false,
  score: 72,
  issues: [{ code: 'dark_coverage_high', message: 'Dark coverage is too high.' }],
  summary: {
    snapshotCount: 1,
    minOccupiedAreaRatio: 0.2,
    maxOccupiedAreaRatio: 0.2,
    minProjectedWidth: 0.4,
    minProjectedHeight: 0.5,
    maxDarkMaterialCoverage: 0.9,
    maxEmissiveMaterialCoverage: 0,
    panelCount: 12,
    materialGroupCount: 2,
    visibleImportantPartCount: 0,
    importantPartCount: 0,
  },
});

const readyMotionQa = (): V3ArmorEditorMotionQaReport => ({
  ready: true,
  score: 100,
  cases: [],
  issues: [],
  summary: {
    supported: true,
    mode: 'full-suit',
    caseCount: 3,
    readyCaseCount: 3,
    issueCount: 0,
  },
  slotIssueCounts: {},
  sourceSignature: 'ready',
});

const warningMotionQa = (): V3ArmorEditorMotionQaReport => ({
  ready: false,
  score: 70,
  cases: [],
  issues: [{
    code: 'part-overlap-high',
    message: 'Helmet clips during sprint.',
    slots: ['helmet'],
  }],
  summary: {
    supported: true,
    mode: 'full-suit',
    caseCount: 3,
    readyCaseCount: 2,
    issueCount: 1,
  },
  slotIssueCounts: { helmet: 1 },
  sourceSignature: 'warning',
});

const warningCoverageQa = (): V3ArmorCoverageReport => ({
  ready: false,
  score: 65,
  sourceSignature: 'coverage-warning',
  sourceDraftsBySlot: {},
  summary: {
    scope: 'full-suit',
    issueCount: 1,
    highSeverityIssueCount: 1,
    totalMissingVoxelCount: 42,
    scannedSlotCount: 3,
  },
  issues: [{
    id: 'coverage:chest:torsoCavity',
    slot: 'chest',
    region: 'torsoCavity',
    severity: 'high',
    classification: 'armor fill/coverage gap',
    message: 'Chest foundation fill is missing behind the front armor shell.',
    missingVoxelCount: 42,
    suggestedVoxels: [],
    reproductionHint: 'Review Mesh2Motion bind/rest pose and sprint frame 82.',
  }],
});

const profileFor = (): V3SuitProfile => ({
  version: 1,
  id: 'profile_1',
  name: 'Profile 1',
  modelSystem: 'v3',
  slotPieceIds: Object.fromEntries(
    V3_CUSTOM_ARMOR_SLOTS.map((slot) => [slot, `${slot}_draft`])
  ) as Partial<Record<V3CustomArmorSlot, string>>,
  createdAt: 1_000,
  updatedAt: 1_000,
});

const profileValidation = (
  overrides: Partial<V3SuitProfileValidationResult> = {}
): V3SuitProfileValidationResult => ({
  valid: true,
  status: 'ready',
  appliedSlotIds: [...V3_CUSTOM_ARMOR_SLOTS],
  missingSlotIds: [],
  errors: [],
  warnings: [],
  ...overrides,
});

const catalog = (): CustomArmorCatalog => ({ version: 1, pieces: [] });

test('complete staged suit with ready validation and QA is ready for suit, profile, and export', () => {
  const report = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    catalog: catalog(),
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    visualQaBySlot: Object.fromEntries(
      V3_CUSTOM_ARMOR_SLOTS.map((slot) => [slot, readyVisualQa()])
    ),
    motionQa: readyMotionQa(),
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.score, 100);
  assert.equal(report.readyToSaveSuit, true);
  assert.equal(report.readyToSaveProfile, true);
  assert.equal(report.readyToExportProfile, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.slotReports.length, V3_CUSTOM_ARMOR_SLOTS.length);
  assert.ok(report.slotReports.every((slotReport) => slotReport.state === 'ready'));
});

test('normal validation blocker blocks save readiness and points firstActionSlot at the blocked slot', () => {
  const validation = suitValidation({
    valid: false,
    blockers: ['Helmet: Helmet is empty.'],
    errors: ['Helmet: Helmet is empty.'],
    advisoryScore: 88,
    slots: {
      ...suitValidation().slots,
      helmet: slotValidation('helmet', {
        valid: false,
        errors: ['Helmet is empty.'],
        advisoryScore: 0,
      }),
    },
  });

  const report = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: validation,
    motionQa: readyMotionQa(),
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.readyToSaveSuit, false);
  assert.equal(report.readyToSaveProfile, false);
  assert.equal(report.readyToExportProfile, false);
  assert.equal(report.firstActionSlot, 'helmet');
  assert.ok(report.blockers.some((issue) => issue.code === 'normal_validation_failed'));
  assert.equal(report.slotReports.find((slotReport) => slotReport.slot === 'helmet')?.state, 'blocked');
});

test('visual and motion QA warnings remain advisory when normal validation passes', () => {
  const report = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    visualQaBySlot: { chest: warningVisualQa() },
    motionQa: warningMotionQa(),
  });

  assert.equal(report.status, 'warnings');
  assert.equal(report.readyToSaveSuit, true);
  assert.equal(report.readyToSaveProfile, true);
  assert.equal(report.readyToExportProfile, true);
  assert.equal(report.firstActionSlot, 'helmet');
  assert.ok(report.warnings.some((issue) => issue.code === 'visual_qa_warning' && issue.slot === 'chest'));
  assert.ok(report.warnings.some((issue) => issue.code === 'motion_qa_warning' && issue.slot === 'helmet'));
});

test('coverage QA warnings remain advisory and point first action at the coverage slot', () => {
  const report = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    coverageQa: warningCoverageQa(),
    motionQa: readyMotionQa(),
  });

  assert.equal(report.status, 'warnings');
  assert.equal(report.readyToSaveSuit, true);
  assert.equal(report.readyToSaveProfile, true);
  assert.equal(report.readyToExportProfile, true);
  assert.equal(report.firstActionSlot, 'chest');
  assert.ok(report.warnings.some((issue) => (
    issue.code === 'coverage_qa_warning' &&
    issue.slot === 'chest' &&
    issue.message.includes('Chest foundation fill')
  )));
  assert.equal(report.warnings.some((issue) => issue.code === 'visual_qa_warning'), false);
  assert.equal(report.warnings.some((issue) => issue.code === 'motion_qa_warning'), false);
});

test('missing and stale motion QA are warnings only', () => {
  const missingReport = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    motionQa: null,
  });
  const staleReport = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    motionQa: readyMotionQa(),
    motionQaStale: true,
  });

  assert.equal(missingReport.status, 'warnings');
  assert.equal(missingReport.readyToSaveSuit, true);
  assert.equal(missingReport.readyToExportProfile, true);
  assert.ok(missingReport.warnings.some((issue) => issue.code === 'motion_qa_missing'));
  assert.equal(staleReport.status, 'warnings');
  assert.equal(staleReport.readyToSaveSuit, true);
  assert.equal(staleReport.readyToExportProfile, true);
  assert.ok(staleReport.warnings.some((issue) => issue.code === 'motion_qa_stale'));
});

test('partial and missing profile references block export readiness but keep available slot application ready', () => {
  const report = buildV3SuitReadinessReport({
    source: 'profile',
    profile: profileFor(),
    profileValidation: profileValidation({
      status: 'partial',
      missingSlotIds: ['chest'],
      warnings: ['chest references missing or invalid piece chest_draft.'],
    }),
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.readyToSaveSuit, true);
  assert.equal(report.readyToSaveProfile, true);
  assert.equal(report.readyToExportProfile, false);
  assert.equal(report.firstActionSlot, 'chest');
  assert.ok(report.blockers.some((issue) => issue.code === 'profile_partial' && issue.slot === 'chest'));

  const missingReport = buildV3SuitReadinessReport({
    source: 'profile',
    profile: profileFor(),
    profileValidation: profileValidation({
      valid: false,
      status: 'missing',
      appliedSlotIds: [],
      missingSlotIds: ['helmet'],
      errors: ['Suit profile has no available V3 custom armor pieces.'],
    }),
  });

  assert.equal(missingReport.readyToExportProfile, false);
  assert.ok(missingReport.blockers.some((issue) => issue.code === 'profile_missing_reference'));
});

test('export errors block profile export readiness', () => {
  const report = buildV3SuitReadinessReport({
    source: 'profile',
    profile: profileFor(),
    profileValidation: profileValidation(),
    exportErrors: ['Suit profile export bundle is missing referenced V3 custom armor pieces.'],
    exportWarnings: ['ignored warning'],
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.readyToSaveSuit, true);
  assert.equal(report.readyToSaveProfile, true);
  assert.equal(report.readyToExportProfile, false);
  assert.ok(report.blockers.some((issue) => issue.code === 'export_blocked'));
  assert.ok(report.warnings.some((issue) => issue.code === 'visual_qa_warning'));
});

test('catalog limits block suit save and profile save readiness', () => {
  const report = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    catalogPieceCountAfterSave: CUSTOM_ARMOR_MAX_CATALOG_PIECES + 1,
    catalogByteLengthAfterSave: CUSTOM_ARMOR_MAX_CATALOG_BYTES + 1,
    motionQa: readyMotionQa(),
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.readyToSaveSuit, false);
  assert.equal(report.readyToSaveProfile, false);
  assert.equal(report.readyToExportProfile, false);
  assert.ok(report.blockers.some((issue) => issue.code === 'catalog_piece_limit'));
  assert.ok(report.blockers.some((issue) => issue.code === 'catalog_byte_limit'));
});

test('save plan errors are hard blockers even when the rejected plan returns the original catalog', () => {
  const report = buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: suitDrafts(),
    suitValidation: suitValidation(),
    motionQa: readyMotionQa(),
    saveErrors: [`Custom armor catalog would contain ${CUSTOM_ARMOR_MAX_CATALOG_PIECES + 1} pieces; max is ${CUSTOM_ARMOR_MAX_CATALOG_PIECES}.`],
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.readyToSaveSuit, false);
  assert.equal(report.readyToSaveProfile, false);
  assert.ok(report.blockers.some((issue) => issue.code === 'catalog_piece_limit'));
});

test('buildV3SuitReadinessReport does not mutate input drafts or profile', () => {
  const drafts = suitDrafts();
  const profile = profileFor();
  const draftsBefore = structuredClone(drafts);
  const profileBefore = structuredClone(profile);

  buildV3SuitReadinessReport({
    source: 'stagedSuit',
    suitDrafts: drafts,
    suitValidation: suitValidation(),
    profile,
    profileValidation: profileValidation(),
    visualQaBySlot: { helmet: warningVisualQa() },
    motionQa: warningMotionQa(),
    dirty: true,
  });

  assert.deepEqual(drafts, draftsBefore);
  assert.deepEqual(profile, profileBefore);
});
