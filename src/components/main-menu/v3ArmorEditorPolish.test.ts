import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
} from '../customArmor';
import {
  getCustomArmorBounds,
  validateCustomArmorPiece,
} from '../customArmor';
import type { V3ArmorEditorVisualQaReport } from './v3ArmorEditorVisualQa';
import {
  applyV3ArmorEditorPolishAction,
  buildV3ArmorEditorPolishActions,
  type V3ArmorEditorPolishActionId,
} from './v3ArmorEditorPolish';

const piece = (
  voxels: CustomArmorPieceSnapshot['voxels'],
  overrides: Partial<CustomArmorPieceSnapshot> = {}
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: 'draft',
  name: 'Draft',
  slot: 'helmet',
  modelSystem: 'v3',
  gridScale: 2,
  sourcePreset: 'phase-20',
  thumbnail: 'data:image/png;base64,phase20',
  voxels,
  updatedAt: 1,
  ...overrides,
});

const visualQa = (codes: V3ArmorEditorVisualQaReport['issues'][number]['code'][]): V3ArmorEditorVisualQaReport => ({
  ready: codes.length === 0,
  score: Math.max(0, 100 - (codes.length * 20)),
  issues: codes.map((code) => ({ code, message: code })),
  summary: {
    snapshotCount: 8,
    minOccupiedAreaRatio: 0.02,
    maxOccupiedAreaRatio: 0.6,
    minProjectedWidth: 0.2,
    minProjectedHeight: 0.2,
    maxDarkMaterialCoverage: codes.includes('dark_coverage_high') ? 0.95 : 0.1,
    maxEmissiveMaterialCoverage: 0,
    panelCount: codes.includes('panel_count_low') ? 4 : 16,
    materialGroupCount: codes.includes('material_groups_low') ? 1 : 3,
    visibleImportantPartCount: 0,
    importantPartCount: 0,
  },
});

const box = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  role: CustomArmorMaterialRole
): CustomArmorPieceSnapshot['voxels'] => {
  const voxels: CustomArmorPieceSnapshot['voxels'] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        voxels.push({ x, y, z, role });
      }
    }
  }
  return voxels;
};

const countRoles = (
  draft: CustomArmorPieceSnapshot,
  roles: readonly CustomArmorMaterialRole[]
): number => draft.voxels.filter((voxel) => roles.includes(voxel.role)).length;

const roleDiversity = (draft: CustomArmorPieceSnapshot): number => (
  new Set(draft.voxels.map((voxel) => voxel.role)).size
);

const findAction = (
  draft: CustomArmorPieceSnapshot,
  id: V3ArmorEditorPolishActionId,
  context: Parameters<typeof buildV3ArmorEditorPolishActions>[1] = {}
) => {
  const action = buildV3ArmorEditorPolishActions(draft, context).find((candidate) => candidate.id === id);
  assert.ok(action, `expected ${id} action`);
  return action;
};

test('dark slab enables reduceDarkCoverage and remaps dark roles without changing metadata or voxel count', () => {
  const draft = piece([
    ...box(3, 16, 4, 12, 4, 7, 'dark'),
    ...box(7, 12, 6, 8, 8, 9, 'undersuit'),
  ]);
  const beforeDark = countRoles(draft, ['dark', 'undersuit']);
  const action = findAction(draft, 'reduceDarkCoverage', {
    visualQa: visualQa(['dark_coverage_high']),
  });

  assert.equal(action.enabled, true);
  assert.equal(action.issueCodes.includes('dark_coverage_high'), true);

  const polished = applyV3ArmorEditorPolishAction(draft, 'reduceDarkCoverage', {
    visualQa: visualQa(['dark_coverage_high']),
    now: 20,
  });

  assert.equal(polished.version, draft.version);
  assert.equal(polished.id, draft.id);
  assert.equal(polished.name, draft.name);
  assert.equal(polished.slot, draft.slot);
  assert.equal(polished.modelSystem, draft.modelSystem);
  assert.equal(polished.modelType, draft.modelType);
  assert.equal(polished.gridScale, draft.gridScale);
  assert.equal(polished.sourcePreset, draft.sourcePreset);
  assert.equal(polished.thumbnail, draft.thumbnail);
  assert.equal(polished.updatedAt, 20);
  assert.equal(polished.voxels.length, draft.voxels.length);
  assert.ok(countRoles(polished, ['dark', 'undersuit']) < beforeDark);
});

test('single-role piece enables paneling/readability and improvePaneling increases diversity within V3 bounds', () => {
  const draft = piece(box(5, 14, 4, 11, 4, 8, 'primary'));
  const action = findAction(draft, 'improvePaneling', {
    visualQa: visualQa(['panel_count_low', 'material_groups_low']),
    missingRecommendedRoles: ['secondary', 'accent', 'highlight'],
  });
  const boostAction = findAction(draft, 'boostReadability', {
    visualQa: visualQa(['panel_count_low', 'material_groups_low']),
    missingRecommendedRoles: ['secondary', 'accent', 'highlight'],
  });

  assert.equal(action.enabled, true);
  assert.equal(boostAction.enabled, true);

  const polished = applyV3ArmorEditorPolishAction(draft, 'improvePaneling', {
    visualQa: visualQa(['panel_count_low', 'material_groups_low']),
    missingRecommendedRoles: ['secondary', 'accent', 'highlight'],
    now: 21,
  });

  assert.ok(roleDiversity(polished) > roleDiversity(draft));
  assert.equal(polished.updatedAt, 21);
  assert.equal(validateCustomArmorPiece(polished).valid, true);
  assert.ok(getCustomArmorBounds(polished.voxels));
});

test('single-role panel material still remaps improvePaneling to increase diversity', () => {
  const draft = piece(box(5, 14, 4, 11, 4, 8, 'secondary'));
  const action = findAction(draft, 'improvePaneling', {
    visualQa: visualQa(['panel_count_low', 'material_groups_low']),
    missingRecommendedRoles: ['accent', 'highlight'],
  });

  assert.equal(action.enabled, true);

  const polished = applyV3ArmorEditorPolishAction(draft, 'improvePaneling', {
    visualQa: visualQa(['panel_count_low', 'material_groups_low']),
    missingRecommendedRoles: ['accent', 'highlight'],
    now: 23,
  });

  assert.ok(roleDiversity(polished) > roleDiversity(draft));
  assert.ok(countRoles(polished, ['secondary']) < draft.voxels.length);
  assert.equal(polished.updatedAt, 23);
  assert.equal(validateCustomArmorPiece(polished).valid, true);
});

test('dark coverage issue remaps a minority dark strip below the normal target', () => {
  const draft = piece([
    ...box(5, 14, 4, 11, 4, 8, 'primary'),
    ...box(5, 14, 12, 12, 4, 8, 'dark'),
  ]);
  const beforeDark = countRoles(draft, ['dark', 'undersuit']);

  const polished = applyV3ArmorEditorPolishAction(draft, 'reduceDarkCoverage', {
    visualQa: visualQa(['dark_coverage_high']),
    now: 24,
  });

  assert.ok(beforeDark > 0);
  assert.ok(countRoles(polished, ['dark', 'undersuit']) < beforeDark);
  assert.equal(polished.voxels.length, draft.voxels.length);
  assert.equal(polished.updatedAt, 24);
  assert.equal(validateCustomArmorPiece(polished).valid, true);
});

test('broad block enables polishSilhouette and removes deterministic corner voxels while staying valid', () => {
  const draft = piece(box(3, 16, 4, 12, 3, 10, 'primary'));
  const first = applyV3ArmorEditorPolishAction(draft, 'polishSilhouette', { now: 22 });
  const second = applyV3ArmorEditorPolishAction(draft, 'polishSilhouette', { now: 22 });

  assert.equal(findAction(draft, 'polishSilhouette').enabled, true);
  assert.ok(first.voxels.length < draft.voxels.length);
  assert.deepEqual(first.voxels, second.voxels);
  assert.ok(first.voxels.length >= Math.floor(draft.voxels.length * 0.85));
  assert.equal(validateCustomArmorPiece(first).valid, true);
  assert.ok(getCustomArmorBounds(first.voxels));
});

test('boostReadability is deterministic and preserves core V3 metadata', () => {
  const draft = piece([
    ...box(3, 16, 4, 12, 3, 7, 'dark'),
    ...box(6, 13, 5, 10, 8, 9, 'primary'),
  ], {
    id: 'stable-id',
    name: 'Stable Draft',
    slot: 'helmet',
    modelSystem: 'v3',
    modelType: 'large',
    gridScale: 2,
    sourcePreset: 'source-a',
    thumbnail: 'data:image/png;base64,stable',
  });
  const context = {
    visualQa: visualQa(['dark_coverage_high', 'panel_count_low']),
    missingRecommendedRoles: ['secondary', 'accent', 'highlight'] as CustomArmorMaterialRole[],
    now: 30,
  };

  const first = applyV3ArmorEditorPolishAction(draft, 'boostReadability', context);
  const second = applyV3ArmorEditorPolishAction(draft, 'boostReadability', context);

  assert.deepEqual(first, second);
  assert.equal(first.version, draft.version);
  assert.equal(first.id, draft.id);
  assert.equal(first.name, draft.name);
  assert.equal(first.slot, draft.slot);
  assert.equal(first.modelSystem, draft.modelSystem);
  assert.equal(first.modelType, draft.modelType);
  assert.equal(first.gridScale, draft.gridScale);
  assert.equal(first.sourcePreset, draft.sourcePreset);
  assert.equal(first.thumbnail, draft.thumbnail);
  assert.equal(first.updatedAt, 30);
  assert.equal(validateCustomArmorPiece(first).valid, true);
});

test('non-V3 drafts expose disabled actions and applying returns metadata-preserving snapshot', () => {
  const draft = piece(box(0, 3, 0, 3, 0, 3, 'primary'), {
    modelSystem: 'v2',
    modelType: 'medium',
    gridScale: undefined,
    sourcePreset: 'legacy',
  });

  const actions = buildV3ArmorEditorPolishActions(draft, {
    visualQa: visualQa(['dark_coverage_high', 'panel_count_low']),
    missingRecommendedRoles: ['secondary'],
  });
  const polished = applyV3ArmorEditorPolishAction(draft, 'boostReadability', { now: 40 });

  assert.equal(actions.length, 4);
  assert.equal(actions.every((action) => action.enabled === false), true);
  assert.equal(polished.version, draft.version);
  assert.equal(polished.id, draft.id);
  assert.equal(polished.name, draft.name);
  assert.equal(polished.slot, draft.slot);
  assert.equal(polished.modelSystem, draft.modelSystem);
  assert.equal(polished.modelType, draft.modelType);
  assert.equal(polished.gridScale, draft.gridScale);
  assert.equal(polished.sourcePreset, draft.sourcePreset);
  assert.equal(polished.updatedAt, draft.updatedAt);
  assert.deepEqual(polished.voxels, draft.voxels);
});
