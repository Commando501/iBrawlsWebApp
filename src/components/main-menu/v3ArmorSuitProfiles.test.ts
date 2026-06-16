import assert from 'node:assert/strict';
import test from 'node:test';
import type { CharacterLoadout } from '../VoxelModels';
import {
  type CustomArmorCatalog,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  V3_CUSTOM_ARMOR_SLOTS,
} from '../customArmor';
import { createV3ArmorTemplateDraft } from './v3ArmorEditorTemplates';
import {
  V3_SUIT_PROFILE_CATALOG_STORAGE_KEY,
  V3_SUIT_PROFILE_MAX_PROFILES,
  applyV3SuitProfileToLoadout,
  createEmptyV3SuitProfileCatalog,
  createV3SuitProfileFromLoadout,
  deleteV3SuitProfile,
  exportV3SuitProfileBundle,
  importV3SuitProfileBundle,
  loadV3SuitProfileCatalog,
  normalizeV3SuitProfileCatalog,
  persistV3SuitProfileCatalog,
  upsertV3SuitProfile,
  validateV3SuitProfile,
  type V3SuitProfile,
  type V3SuitProfileCatalog,
} from './v3ArmorSuitProfiles';

const catalog = (pieces: CustomArmorPiece[] = []): CustomArmorCatalog => ({
  version: 1,
  pieces,
});

const pieceFor = (
  slot: (typeof V3_CUSTOM_ARMOR_SLOTS)[number],
  id = `piece_${slot}`,
  now = 1_000
): CustomArmorPiece => ({
  ...createV3ArmorTemplateDraft(slot, { hue: 210, now, name: `${slot} piece` }),
  id,
  createdAt: now,
  updatedAt: now,
  history: [],
});

const snapshotFor = (piece: CustomArmorPiece): CustomArmorPieceSnapshot => ({
  version: 1,
  id: piece.id,
  name: piece.name,
  slot: piece.slot,
  modelSystem: 'v3',
  gridScale: piece.gridScale,
  sourcePreset: piece.sourcePreset,
  voxels: piece.voxels.map((voxel) => ({ ...voxel })),
  thumbnail: piece.thumbnail,
  updatedAt: piece.updatedAt,
});

const profileFor = (
  overrides: Partial<V3SuitProfile> = {}
): V3SuitProfile => ({
  version: 1,
  id: 'profile_alpha',
  name: 'Alpha Suit',
  modelSystem: 'v3',
  slotPieceIds: {
    helmet: 'piece_helmet',
    chest: 'piece_chest',
  },
  thumbnail: 'SUIT:2',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

test('createV3SuitProfileFromLoadout stores V3 catalog piece ids only', () => {
  const helmet = pieceFor('helmet', 'piece_helmet');
  const chest = pieceFor('chest', 'piece_chest');
  const loadout: CharacterLoadout = {
    modelSystem: 'v3',
    customArmor: {
      helmet: snapshotFor(helmet),
      chest: snapshotFor(chest),
      torso: {
        version: 1,
        id: 'legacy_torso',
        name: 'Legacy Torso',
        slot: 'torso',
        modelSystem: 'v2',
        modelType: 'medium',
        voxels: [{ x: 0, y: 0, z: 0, role: 'primary' }],
        updatedAt: 10,
      },
    },
  };

  const result = createV3SuitProfileFromLoadout(loadout, catalog([helmet, chest]), {
    id: 'profile_custom',
    name: 'Custom V3 Profile',
    now: 2_000,
  });

  assert.deepEqual(result.errors, []);
  assert.ok(result.profile);
  assert.equal(result.profile.id, 'profile_custom');
  assert.equal(result.profile.name, 'Custom V3 Profile');
  assert.equal(result.profile.modelSystem, 'v3');
  assert.deepEqual(result.profile.slotPieceIds, {
    helmet: 'piece_helmet',
    chest: 'piece_chest',
  });
  assert.equal('pieces' in result.profile, false);
  assert.equal(result.profile.createdAt, 2_000);
  assert.equal(result.profile.updatedAt, 2_000);
});

test('applyV3SuitProfileToLoadout applies available slots and reports missing references without mutating inputs', () => {
  const helmet = pieceFor('helmet', 'piece_helmet');
  const sourceLoadout: CharacterLoadout = {
    modelSystem: 'v2',
    modelType: 'large',
    customArmor: {
      torso: {
        version: 1,
        id: 'legacy_torso',
        name: 'Legacy Torso',
        slot: 'torso',
        modelSystem: 'v2',
        modelType: 'large',
        voxels: [{ x: 0, y: 0, z: 0, role: 'primary' }],
        updatedAt: 3,
      },
    },
  };
  const before = structuredClone(sourceLoadout);

  const result = applyV3SuitProfileToLoadout(sourceLoadout, profileFor(), catalog([helmet]));

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.appliedSlotIds, ['helmet']);
  assert.deepEqual(result.missingSlotIds, ['chest']);
  assert.equal('modelSystem' in (result.loadoutPatch ?? {}), false);
  assert.equal('modelType' in (result.loadoutPatch ?? {}), false);
  assert.equal(result.loadoutPatch?.customArmor?.helmet?.id, 'piece_helmet');
  assert.equal(result.loadoutPatch?.customArmor?.torso?.id, 'legacy_torso');
  assert.deepEqual(sourceLoadout, before);
});

test('validateV3SuitProfile reports ready, partial, and missing profile states', () => {
  const helmet = pieceFor('helmet', 'piece_helmet');
  const chest = pieceFor('chest', 'piece_chest');

  assert.equal(validateV3SuitProfile(profileFor(), catalog([helmet, chest])).status, 'ready');
  assert.equal(validateV3SuitProfile(profileFor(), catalog([helmet])).status, 'partial');
  assert.equal(validateV3SuitProfile(profileFor(), catalog()).status, 'missing');
});

test('upsertV3SuitProfile enforces profile limits and catalog byte limits all-or-nothing', () => {
  const existing = Array.from({ length: V3_SUIT_PROFILE_MAX_PROFILES }, (_, index): V3SuitProfile => profileFor({
    id: `profile_${index}`,
    name: `Profile ${index}`,
    slotPieceIds: { helmet: `piece_${index}` },
  }));
  const fullCatalog: V3SuitProfileCatalog = { version: 1, profiles: existing };
  const overflow = upsertV3SuitProfile(fullCatalog, profileFor({ id: 'new_profile' }), { now: 3_000 });

  assert.ok(overflow.errors.some((error) => error.includes('max')));
  assert.deepEqual(overflow.catalog, fullCatalog);

  const byteOverflow = upsertV3SuitProfile(createEmptyV3SuitProfileCatalog(), profileFor({
    id: 'giant_profile',
    name: 'Giant',
    thumbnail: 'x'.repeat(200_000),
  }), { now: 3_000 });

  assert.ok(byteOverflow.errors.some((error) => error.includes('bytes')));
  assert.deepEqual(byteOverflow.catalog, createEmptyV3SuitProfileCatalog());
});

test('export and import V3 suit profile bundles include referenced pieces and stay all-or-nothing', () => {
  const helmet = pieceFor('helmet', 'piece_helmet');
  const chest = pieceFor('chest', 'piece_chest');
  const sourceCatalog = catalog([helmet, chest]);
  const profile = profileFor();

  const exported = exportV3SuitProfileBundle(profile, sourceCatalog);

  assert.deepEqual(exported.errors, []);
  assert.ok(exported.bundle);
  assert.deepEqual(exported.bundle.pieces.map((piece) => piece.id).sort(), ['piece_chest', 'piece_helmet']);

  const imported = importV3SuitProfileBundle(exported.bundle, catalog(), createEmptyV3SuitProfileCatalog(), { now: 4_000 });

  assert.deepEqual(imported.errors, []);
  assert.ok(imported.profile);
  assert.equal(imported.customArmorCatalog.pieces.length, 2);
  assert.equal(imported.profileCatalog.profiles.length, 1);
  assert.equal(imported.profileCatalog.profiles[0].id, 'profile_alpha');

  const invalid = importV3SuitProfileBundle({
    version: 1,
    profile: profileFor({ slotPieceIds: { helmet: 'missing_import_piece' } }),
    pieces: [],
  }, catalog([helmet]), createEmptyV3SuitProfileCatalog(), { now: 5_000 });

  assert.ok(invalid.errors.length > 0);
  assert.deepEqual(invalid.customArmorCatalog, catalog([helmet]));
  assert.deepEqual(invalid.profileCatalog, createEmptyV3SuitProfileCatalog());
});

test('export rejects partial profile bundles with missing referenced pieces', () => {
  const helmet = pieceFor('helmet', 'piece_helmet');
  const exported = exportV3SuitProfileBundle(profileFor(), catalog([helmet]));

  assert.equal(exported.bundle, undefined);
  assert.ok(exported.errors.some((error) => error.includes('missing referenced')));
  assert.ok(exported.warnings.some((warning) => warning.includes('chest')));
});

test('import remaps colliding piece ids instead of overwriting local catalog pieces', () => {
  const localHelmet = pieceFor('helmet', 'piece_helmet');
  localHelmet.name = 'Local Helmet';
  const incomingHelmet = pieceFor('helmet', 'piece_helmet');
  incomingHelmet.name = 'Incoming Helmet';
  const incomingChest = pieceFor('chest', 'piece_chest');
  const bundle = exportV3SuitProfileBundle(profileFor(), catalog([incomingHelmet, incomingChest])).bundle;

  assert.ok(bundle);
  const imported = importV3SuitProfileBundle(bundle, catalog([localHelmet]), createEmptyV3SuitProfileCatalog(), {
    now: 8_000,
  });

  assert.deepEqual(imported.errors, []);
  assert.ok(imported.warnings.some((warning) => warning.includes('renamed')));
  assert.equal(imported.customArmorCatalog.pieces.find((piece) => piece.id === 'piece_helmet')?.name, 'Local Helmet');
  assert.equal(imported.customArmorCatalog.pieces.some((piece) => piece.id !== 'piece_helmet' && piece.name === 'Incoming Helmet'), true);
  assert.ok(imported.profile);
  assert.notEqual(imported.profile.slotPieceIds.helmet, 'piece_helmet');
  assert.equal(imported.profile.slotPieceIds.chest, 'piece_chest');
});

test('load and persist V3 suit profile catalog use the V3-only storage key', () => {
  const calls: Array<[string, string]> = [];
  const storage = {
    value: '',
    getItem(key: string) {
      assert.equal(key, V3_SUIT_PROFILE_CATALOG_STORAGE_KEY);
      return this.value || null;
    },
    setItem(key: string, value: string) {
      calls.push([key, value]);
      this.value = value;
    },
  };
  const profileCatalog = normalizeV3SuitProfileCatalog({
    version: 1,
    profiles: [profileFor({ name: '  Stored   Profile  ' })],
  });

  persistV3SuitProfileCatalog(profileCatalog, storage);
  const loaded = loadV3SuitProfileCatalog(storage);

  assert.equal(calls[0][0], V3_SUIT_PROFILE_CATALOG_STORAGE_KEY);
  assert.equal(loaded.profiles[0].name, 'Stored Profile');
  assert.equal(loaded.profiles[0].modelSystem, 'v3');
});

test('deleteV3SuitProfile removes only the selected profile id', () => {
  const profileCatalog: V3SuitProfileCatalog = {
    version: 1,
    profiles: [
      profileFor({ id: 'keep_profile' }),
      profileFor({ id: 'delete_profile' }),
    ],
  };

  assert.deepEqual(
    deleteV3SuitProfile(profileCatalog, 'delete_profile').profiles.map((profile) => profile.id),
    ['keep_profile']
  );
});
