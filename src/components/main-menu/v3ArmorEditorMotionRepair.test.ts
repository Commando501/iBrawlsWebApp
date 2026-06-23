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
  getCustomArmorV3CoordinateSpace,
  isVoxelInSlotBounds,
  validateCustomArmorPiece,
} from '../customArmor';
import type { V3ArmorEditorMotionQaReport } from './v3ArmorEditorMotionQa';
import {
  applyV3ArmorMotionRepairAction,
  buildV3ArmorMotionRepairActions,
  buildV3ArmorMotionRepairPreview,
  type V3ArmorMotionRepairActionId,
  type V3ArmorMotionRepairContext,
} from './v3ArmorEditorMotionRepair';

const ACTION_IDS: V3ArmorMotionRepairActionId[] = [
  'poseSafePolish',
  'clearLimbOverlap',
  'reducePoseBulk',
  'raiseFootClearance',
  'fixWeaponGripDrift',
];

const piece = (
  slot: V3CustomArmorSlot,
  voxels: CustomArmorVoxel[],
  overrides: Partial<CustomArmorPieceSnapshot> = {}
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: `${slot}-motion-draft`,
  name: `${slot} Motion Draft`,
  slot,
  modelSystem: 'v3',
  gridScale: 2,
  sourcePreset: 'phase-28',
  thumbnail: 'data:image/png;base64,phase28',
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

const motionQa = (
  codes: V3ArmorEditorMotionQaReport['issues'][number]['code'][],
  slot: V3CustomArmorSlot,
  options: { caseId?: string; supported?: boolean } = {}
): V3ArmorEditorMotionQaReport => {
  const supported = options.supported ?? true;
  const caseId = options.caseId ?? 'idle';
  return {
    ready: codes.length === 0,
    score: Math.max(0, 100 - codes.length * 14),
    cases: [],
    issues: codes.map((code) => ({
      code,
      message: code,
      caseId: caseId as V3ArmorEditorMotionQaReport['issues'][number]['caseId'],
      slots: [slot],
    })),
    summary: {
      supported,
      mode: 'active-slot',
      caseCount: supported ? 1 : 0,
      readyCaseCount: codes.length === 0 && supported ? 1 : 0,
      issueCount: codes.length,
    },
    slotIssueCounts: codes.length > 0 ? { [slot]: codes.length } : {},
    sourceSignature: JSON.stringify({ slot, codes, caseId, supported }),
  };
};

const contextFor = (
  activeSlot: V3CustomArmorSlot,
  motionQaReport?: V3ArmorEditorMotionQaReport,
  overrides: Partial<V3ArmorMotionRepairContext> = {}
): V3ArmorMotionRepairContext => ({
  motionQa: motionQaReport,
  selectedCaseId: 'idle',
  activeSlot,
  gridScale: 2,
  ...overrides,
});

const findAction = (
  draft: CustomArmorPieceSnapshot,
  actionId: V3ArmorMotionRepairActionId,
  context: V3ArmorMotionRepairContext
) => {
  const action = buildV3ArmorMotionRepairActions(draft, context)
    .find((candidate) => candidate.id === actionId);
  assert.ok(action, `expected ${actionId} action`);
  return action;
};

const enabledIds = (
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): V3ArmorMotionRepairActionId[] => (
  buildV3ArmorMotionRepairActions(draft, context)
    .filter((action) => action.enabled)
    .map((action) => action.id)
);

const assertMetadata = (
  actual: CustomArmorPieceSnapshot,
  expected: CustomArmorPieceSnapshot,
  updatedAt: number
): void => {
  assert.equal(actual.version, expected.version);
  assert.equal(actual.id, expected.id);
  assert.equal(actual.name, expected.name);
  assert.equal(actual.slot, expected.slot);
  assert.equal(actual.modelSystem, expected.modelSystem);
  assert.equal(actual.modelType, expected.modelType);
  assert.equal(actual.gridScale, expected.gridScale);
  assert.equal(actual.sourcePreset, expected.sourcePreset);
  assert.equal(actual.thumbnail, expected.thumbnail);
  assert.equal(actual.updatedAt, updatedAt);
};

const assertAllVoxelsInBounds = (draft: CustomArmorPieceSnapshot): void => {
  const gridScale = getCustomArmorGridScale(draft);
  const coordinateSpace = getCustomArmorV3CoordinateSpace(draft) ?? 'legacy-grid';
  for (const voxel of draft.voxels) {
    assert.equal(
      isVoxelInSlotBounds(draft.slot, voxel, 'medium', 'v3', gridScale, coordinateSpace),
      true,
      `expected ${voxel.x}:${voxel.y}:${voxel.z} to stay inside ${draft.slot} bounds`
    );
  }
};

const roleDiversity = (draft: CustomArmorPieceSnapshot): number => (
  new Set(draft.voxels.map((voxel) => voxel.role)).size
);

const footDraft = (): CustomArmorPieceSnapshot => piece(
  'footLeft',
  box(2, 13, 0, 5, 4, 13, 'primary')
);

test('actions are disabled before Motion QA and for non-V3 drafts', () => {
  const draft = footDraft();
  const beforeQa = buildV3ArmorMotionRepairActions(draft, contextFor('footLeft'));

  assert.deepEqual(beforeQa.map((action) => action.id), ACTION_IDS);
  assert.equal(beforeQa.every((action) => action.enabled === false), true);

  const legacyDraft = piece('footLeft', box(0, 3, 0, 3, 0, 3, 'primary'), {
    modelSystem: 'v2',
    modelType: 'medium',
    gridScale: undefined,
    sourcePreset: 'legacy',
  });
  const legacyContext = contextFor(
    'footLeft',
    motionQa(['part-overlap-high', 'foot-floor-penetration'], 'footLeft')
  );

  const legacyActions = buildV3ArmorMotionRepairActions(legacyDraft, legacyContext);
  const repaired = applyV3ArmorMotionRepairAction(
    legacyDraft,
    'poseSafePolish',
    { ...legacyContext, now: 5_000 }
  );

  assert.equal(legacyActions.every((action) => action.enabled === false), true);
  assert.notEqual(repaired, legacyDraft);
  assert.notEqual(repaired.voxels[0], legacyDraft.voxels[0]);
  assert.deepEqual(repaired, legacyDraft);
});

test('actions are enabled only for matching issue codes and selected pose case', () => {
  const chest = piece('chest', box(4, 21, 4, 15, 4, 12, 'primary'));
  const overlap = contextFor('chest', motionQa(['part-overlap-high'], 'chest'));
  const gap = contextFor('chest', motionQa(['limb-gap-low'], 'chest'));
  const unrelated = contextFor('chest', motionQa(['weapon-drift-high'], 'chest'));
  const wrongCase = contextFor('chest', motionQa(['part-overlap-high'], 'chest', {
    caseId: 'sprint',
  }));

  assert.deepEqual(enabledIds(chest, overlap), [
    'poseSafePolish',
    'clearLimbOverlap',
    'reducePoseBulk',
  ]);
  assert.deepEqual(enabledIds(chest, gap), [
    'poseSafePolish',
    'clearLimbOverlap',
  ]);
  assert.deepEqual(enabledIds(chest, unrelated), []);
  assert.deepEqual(enabledIds(chest, wrongCase), []);
});

test('foot clearance repairs are limited to foot ankle and lower-leg slots', () => {
  const footSlots: V3CustomArmorSlot[] = ['footLeft', 'footRight', 'shinLeft', 'shinRight'];
  const blockedSlots: V3CustomArmorSlot[] = ['thighLeft', 'chest', 'handLeft', 'back'];

  for (const slot of footSlots) {
    const draft = piece(slot, box(1, 8, 0, 5, 1, 8, 'primary'));
    const action = findAction(
      draft,
      'raiseFootClearance',
      contextFor(slot, motionQa(['foot-floor-penetration', 'foot-lift-high'], slot))
    );
    assert.equal(action.enabled, true, `${slot} should allow foot clearance`);
  }

  for (const slot of blockedSlots) {
    const draft = piece(slot, box(1, 8, 0, 5, 1, 8, 'primary'));
    const action = findAction(
      draft,
      'raiseFootClearance',
      contextFor(slot, motionQa(['foot-floor-penetration', 'foot-lift-high'], slot))
    );
    assert.equal(action.enabled, false, `${slot} should block foot clearance`);
  }
});

test('weapon grip repairs are limited to grip-adjacent slots', () => {
  const gripSlots: V3CustomArmorSlot[] = [
    'handLeft',
    'handRight',
    'forearmLeft',
    'forearmRight',
    'back',
  ];
  const blockedSlots: V3CustomArmorSlot[] = ['footLeft', 'shinLeft', 'chest', 'helmet', 'shoulderLeft'];

  for (const slot of gripSlots) {
    const draft = piece(slot, box(1, 8, 1, 6, 1, 8, 'primary'));
    const action = findAction(
      draft,
      'fixWeaponGripDrift',
      contextFor(slot, motionQa(['weapon-drift-high'], slot))
    );
    assert.equal(action.enabled, true, `${slot} should allow grip repair`);
  }

  for (const slot of blockedSlots) {
    const draft = piece(slot, box(1, 8, 1, 6, 1, 8, 'primary'));
    const action = findAction(
      draft,
      'fixWeaponGripDrift',
      contextFor(slot, motionQa(['weapon-drift-high'], slot))
    );
    assert.equal(action.enabled, false, `${slot} should block grip repair`);
  }
});

test('preview reports added removed and remapped voxels without mutating the original draft', () => {
  const draft = footDraft();
  const before = structuredClone(draft);
  const context = contextFor(
    'footLeft',
    motionQa(['part-overlap-high', 'foot-floor-penetration'], 'footLeft'),
    {
      cursor: { x: 8, y: 2, z: 8 },
      size: { x: 6, y: 4, z: 6 },
    }
  );

  const preview = buildV3ArmorMotionRepairPreview(draft, 'poseSafePolish', context);

  assert.equal(preview.actionId, 'poseSafePolish');
  assert.equal(preview.changed, true);
  assert.ok(preview.added.length > 0);
  assert.ok(preview.removed.length > 0);
  assert.ok(preview.remapped.length > 0);
  assert.equal(preview.previewDraft.updatedAt, draft.updatedAt);
  assert.deepEqual(draft, before);
  assertAllVoxelsInBounds(preview.previewDraft);
});

test('apply output is deterministic with now and preserves metadata and gridScale', () => {
  const draft = footDraft();
  assert.equal(validateCustomArmorPiece(draft).valid, true);
  const context = contextFor(
    'footLeft',
    motionQa(['part-overlap-high', 'foot-floor-penetration'], 'footLeft'),
    { now: 6_000 }
  );

  const first = applyV3ArmorMotionRepairAction(draft, 'poseSafePolish', context);
  const second = applyV3ArmorMotionRepairAction(draft, 'poseSafePolish', context);

  assert.deepEqual(first, second);
  assertMetadata(first, draft, 6_000);
  assert.equal(first.gridScale, 2);
  assertAllVoxelsInBounds(first);
  assert.equal(validateCustomArmorPiece(first).valid, true);
});

test('poseSafePolish composes safe repairs in a deterministic order', () => {
  const draft = footDraft();
  const context = contextFor(
    'footLeft',
    motionQa(['part-overlap-high', 'limb-gap-low', 'foot-floor-penetration'], 'footLeft'),
    { now: 7_000 }
  );

  const bulkOnly = applyV3ArmorMotionRepairAction(draft, 'reducePoseBulk', context);
  const polished = applyV3ArmorMotionRepairAction(draft, 'poseSafePolish', context);

  assert.ok(bulkOnly.voxels.length < draft.voxels.length);
  assert.ok(polished.voxels.length <= bulkOnly.voxels.length);
  assert.equal(polished.voxels.some((voxel) => voxel.y === 0), false);
  assert.ok(roleDiversity(polished) > roleDiversity(draft));
  assert.equal(polished.updatedAt, 7_000);
  assertAllVoxelsInBounds(polished);
});
