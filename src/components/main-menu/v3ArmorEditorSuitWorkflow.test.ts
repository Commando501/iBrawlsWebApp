import assert from 'node:assert/strict';
import test from 'node:test';
import type { CharacterLoadout } from '../VoxelModels';
import {
  CUSTOM_ARMOR_MAX_CATALOG_BYTES,
  CUSTOM_ARMOR_MAX_CATALOG_PIECES,
  getCustomArmorGridScale,
  type CustomArmorCatalog,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
  V3_CUSTOM_ARMOR_SLOTS,
} from '../customArmor';
import { createV3ArmorTemplateDraft } from './v3ArmorEditorTemplates';
import {
  buildV3SuitSavePlan,
  createV3SuitDraftMap,
  mergeV3SuitPreviewLoadout,
  validateV3SuitDrafts,
} from './v3ArmorEditorSuitWorkflow';

const catalog = (pieces: CustomArmorPiece[] = []): CustomArmorCatalog => ({
  version: 1,
  pieces,
});

const draftFor = (
  slot: V3CustomArmorSlot,
  now = 1_000,
  name = `${slot} draft`
): CustomArmorPieceSnapshot => createV3ArmorTemplateDraft(slot, { hue: 210, now, name });

const catalogPieceFor = (
  index: number,
  overrides: Partial<CustomArmorPiece> = {}
): CustomArmorPiece => {
  const slot = V3_CUSTOM_ARMOR_SLOTS[index % V3_CUSTOM_ARMOR_SLOTS.length];
  return {
    ...draftFor(slot, 20_000 + index, `${slot} existing ${index}`),
    id: `existing_piece_${index}`,
    createdAt: 20_000 + index,
    ...overrides,
  };
};

const suitDrafts = (now = 1_000): Record<V3CustomArmorSlot, CustomArmorPieceSnapshot> => (
  Object.fromEntries(
    V3_CUSTOM_ARMOR_SLOTS.map((slot, index) => [slot, draftFor(slot, now + index)])
  ) as Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>
);

const legacyTorso: CustomArmorPieceSnapshot = {
  version: 1,
  id: 'legacy_torso',
  name: 'Legacy Torso',
  slot: 'torso',
  modelSystem: 'v2',
  modelType: 'medium',
  voxels: [{ x: 0, y: 20, z: 0, role: 'primary' }],
  updatedAt: 99,
};

test('createV3SuitDraftMap includes every V3 slot in Mesh2Motion-native space when templates are used', () => {
  const drafts = createV3SuitDraftMap({}, catalog(), 32, 123_456);

  assert.deepEqual(Object.keys(drafts).sort(), [...V3_CUSTOM_ARMOR_SLOTS].sort());
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    assert.equal(drafts[slot].slot, slot);
    assert.equal(drafts[slot].modelSystem, 'v3');
    assert.equal(getCustomArmorGridScale(drafts[slot]), 1);
    assert.equal(drafts[slot].updatedAt, 123_456);
  }
});

test('createV3SuitDraftMap preserves existing equipped valid V3 custom pieces', () => {
  const equippedHelmet = draftFor('helmet', 2_000, 'Equipped Helmet');
  const loadout: CharacterLoadout = {
    modelSystem: 'v3',
    customArmor: {
      helmet: equippedHelmet,
    },
  };

  const drafts = createV3SuitDraftMap(loadout, catalog(), 80, 3_000);

  assert.deepEqual(drafts.helmet, equippedHelmet);
  assert.notEqual(drafts.helmet, equippedHelmet);
  assert.equal(drafts.chest.updatedAt, 3_000);
});

test('mergeV3SuitPreviewLoadout uses unsaved active draft override without mutating inputs', () => {
  const baseLoadout: CharacterLoadout = {
    modelSystem: 'v2',
    modelType: 'large',
    customArmor: {
      torso: legacyTorso,
    },
  };
  const drafts = suitDrafts(4_000);
  const activeDraft: CustomArmorPieceSnapshot = {
    ...drafts.helmet,
    id: 'unsaved_active_helmet',
    name: 'Unsaved Active Helmet',
    voxels: drafts.helmet.voxels.map((voxel) => ({ ...voxel })),
  };
  const baseBefore = structuredClone(baseLoadout);
  const draftsBefore = structuredClone(drafts);

  const preview = mergeV3SuitPreviewLoadout(baseLoadout, drafts, 'helmet', activeDraft);

  assert.equal(preview.modelSystem, 'v3');
  assert.equal(preview.modelType, undefined);
  assert.deepEqual(preview.customArmor?.helmet, activeDraft);
  assert.deepEqual(preview.customArmor?.chest, drafts.chest);
  assert.deepEqual(baseLoadout, baseBefore);
  assert.deepEqual(drafts, draftsBefore);
});

test('buildV3SuitSavePlan saves and equips all valid staged slots into existing catalog and loadout map', () => {
  const drafts = suitDrafts(5_000);
  const loadout: CharacterLoadout = {
    modelSystem: 'v2',
    customArmor: {
      torso: legacyTorso,
    },
  };

  const plan = buildV3SuitSavePlan(catalog(), loadout, drafts, 6_000);

  assert.deepEqual(plan.errors, []);
  assert.equal(plan.nextCatalog.pieces.length, V3_CUSTOM_ARMOR_SLOTS.length);
  assert.deepEqual(Object.keys(plan.savedSnapshots).sort(), [...V3_CUSTOM_ARMOR_SLOTS].sort());
  assert.equal(plan.loadoutPatch?.modelSystem, 'v3');
  assert.equal(plan.loadoutPatch?.modelType, undefined);
  assert.deepEqual(plan.loadoutPatch?.customArmor?.torso, legacyTorso);

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const saved = plan.savedSnapshots[slot];
    assert.ok(saved, `${slot} should be saved`);
    assert.equal(saved.slot, slot);
    assert.equal(saved.modelSystem, 'v3');
    assert.equal(saved.modelType, undefined);
    assert.equal(saved.updatedAt, 6_000);
    assert.deepEqual(plan.loadoutPatch?.customArmor?.[slot], saved);
    assert.ok(plan.nextCatalog.pieces.some((piece) => piece.id === saved.id));
  }
});

test('buildV3SuitSavePlan rejects an invalid slot all-or-nothing with no catalog changes or saved snapshots', () => {
  const drafts = suitDrafts(7_000);
  const invalidHelmet: CustomArmorPieceSnapshot = {
    ...drafts.helmet,
    voxels: [],
  };
  const staged = {
    ...drafts,
    helmet: invalidHelmet,
  };
  const existingPiece: CustomArmorPiece = {
    ...draftFor('chest', 6_500, 'Existing Chest'),
    createdAt: 6_500,
  };
  const existingCatalog = catalog([existingPiece]);

  const plan = buildV3SuitSavePlan(existingCatalog, {}, staged, 8_000);

  assert.ok(plan.errors.length > 0);
  assert.deepEqual(plan.nextCatalog, existingCatalog);
  assert.deepEqual(plan.savedSnapshots, {});
  assert.equal(plan.loadoutPatch, undefined);
});

test('buildV3SuitSavePlan rejects duplicate draft ids across different V3 slots all-or-nothing', () => {
  const drafts = suitDrafts(7_500);
  const sharedId = 'shared_full_suit_piece_id';
  const staged = {
    ...drafts,
    helmet: {
      ...drafts.helmet,
      id: sharedId,
    },
    chest: {
      ...drafts.chest,
      id: sharedId,
    },
  };
  const existingPiece: CustomArmorPiece = {
    ...draftFor('chest', 7_250, 'Existing Chest'),
    id: 'existing_chest_before_duplicate',
    createdAt: 7_250,
  };
  const existingCatalog = catalog([existingPiece]);

  const plan = buildV3SuitSavePlan(existingCatalog, {}, staged, 8_500);

  assert.ok(plan.errors.some((error) => (
    error.includes(sharedId) && error.includes('Helmet') && error.includes('Chest')
  )));
  assert.deepEqual(plan.nextCatalog, existingCatalog);
  assert.deepEqual(plan.savedSnapshots, {});
  assert.equal(plan.loadoutPatch, undefined);
});

test('buildV3SuitSavePlan rejects catalog piece count overflow all-or-nothing', () => {
  const existingCount = CUSTOM_ARMOR_MAX_CATALOG_PIECES - V3_CUSTOM_ARMOR_SLOTS.length + 1;
  const existingCatalog = catalog(
    Array.from({ length: existingCount }, (_, index) => catalogPieceFor(index))
  );

  const plan = buildV3SuitSavePlan(existingCatalog, {}, suitDrafts(8_500), 9_000);

  assert.ok(plan.errors.length > 0);
  assert.deepEqual(plan.nextCatalog, existingCatalog);
  assert.deepEqual(plan.savedSnapshots, {});
  assert.equal(plan.loadoutPatch, undefined);
});

test('buildV3SuitSavePlan rejects catalog byte overflow all-or-nothing', () => {
  const existingCatalog = catalog([
    catalogPieceFor(0, {
      thumbnail: 'x'.repeat(CUSTOM_ARMOR_MAX_CATALOG_BYTES),
    }),
  ]);

  const plan = buildV3SuitSavePlan(existingCatalog, {}, suitDrafts(9_500), 10_000);

  assert.ok(plan.errors.length > 0);
  assert.deepEqual(plan.nextCatalog, existingCatalog);
  assert.deepEqual(plan.savedSnapshots, {});
  assert.equal(plan.loadoutPatch, undefined);
});

test('readability and advisory warnings are not save blockers when exposed', () => {
  const drafts = suitDrafts(9_000);
  const advisoryHelmet: CustomArmorPieceSnapshot = {
    ...drafts.helmet,
    voxels: drafts.helmet.voxels.map((voxel, index) => (
      index === 0 ? { ...voxel, emissive: true } : { ...voxel }
    )),
  };
  const staged = {
    ...drafts,
    helmet: advisoryHelmet,
  };

  const validation = validateV3SuitDrafts(staged);
  const plan = buildV3SuitSavePlan(catalog(), {}, staged, 10_000);

  assert.equal(validation.valid, true);
  assert.equal(validation.blockers.length, 0);
  assert.equal(typeof validation.advisoryScore, 'number');
  assert.ok(validation.slots.helmet.warnings.length > 0);
  assert.deepEqual(plan.errors, []);
  assert.equal(Object.keys(plan.savedSnapshots).length, V3_CUSTOM_ARMOR_SLOTS.length);
});

test('buildV3SuitSavePlan does not add a persisted kit object or schema to loadoutPatch', () => {
  const plan = buildV3SuitSavePlan(catalog(), {}, suitDrafts(11_000), 12_000);
  const patch = plan.loadoutPatch as Record<string, unknown>;

  assert.deepEqual(Object.keys(patch).sort(), ['customArmor', 'modelSystem', 'modelType']);
  assert.equal('kit' in patch, false);
  assert.equal('suit' in patch, false);
  assert.equal('suitDrafts' in patch, false);
});
