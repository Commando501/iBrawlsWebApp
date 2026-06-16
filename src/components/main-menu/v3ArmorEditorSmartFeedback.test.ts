import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../customArmor';
import { buildV3SmartAuthoringFeedback } from './v3ArmorEditorSmartFeedback';

const piece = (
  voxels: CustomArmorPieceSnapshot['voxels'],
  overrides: Partial<CustomArmorPieceSnapshot> = {}
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: 'feedback-draft',
  name: 'Feedback Draft',
  slot: 'chest',
  modelSystem: 'v3',
  gridScale: 2,
  sourcePreset: 'phase-22',
  thumbnail: 'data:image/png;base64,phase22',
  voxels,
  updatedAt: 10,
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

const remapRoles = (
  voxels: CustomArmorVoxel[],
  roles: readonly CustomArmorMaterialRole[]
): CustomArmorVoxel[] => voxels.map((voxel, index) => ({
  ...voxel,
  role: roles[index % roles.length] ?? 'primary',
  emissive: false,
}));

test('feedback helper rewards lower dark coverage and stronger role diversity', () => {
  const baseShape = box(6, 20, 8, 24, 5, 14, 'dark');
  const current = piece(remapRoles(baseShape, ['dark', 'dark', 'dark', 'primary']), {
    id: 'current',
    updatedAt: 20,
  });
  const preview = piece(remapRoles(baseShape, ['primary', 'secondary', 'accent', 'highlight']), {
    id: 'preview',
    updatedAt: 21,
  });

  const feedback = buildV3SmartAuthoringFeedback(current, preview);

  assert.ok(feedback.currentScore >= 0 && feedback.currentScore <= 100);
  assert.ok(feedback.previewScore >= 0 && feedback.previewScore <= 100);
  assert.ok(feedback.previewScore > feedback.currentScore);
  assert.ok(feedback.delta > 0);
  assert.ok(feedback.labels.includes('lower dark coverage'));
  assert.ok(feedback.labels.includes('stronger role diversity'));
});

test('feedback helper estimates improvement without mutating draft metadata', () => {
  const current = piece(remapRoles(box(7, 17, 8, 19, 5, 11, 'dark'), ['dark']), {
    id: 'current-id',
    name: 'Current',
    sourcePreset: 'locked-current',
    thumbnail: 'data:image/png;base64,current',
    updatedAt: 30,
  });
  const preview = piece(remapRoles(box(6, 19, 7, 22, 4, 12, 'primary'), [
    'primary',
    'secondary',
    'accent',
    'highlight',
  ]), {
    id: 'preview-id',
    name: 'Preview',
    sourcePreset: 'locked-preview',
    thumbnail: 'data:image/png;base64,preview',
    updatedAt: 31,
  });
  const currentBefore = structuredClone(current);
  const previewBefore = structuredClone(preview);

  const feedback = buildV3SmartAuthoringFeedback(current, preview);

  assert.ok(feedback.previewScore > feedback.currentScore);
  assert.equal(feedback.delta, feedback.previewScore - feedback.currentScore);
  assert.deepEqual(current, currentBefore);
  assert.deepEqual(preview, previewBefore);
  assert.equal(current.updatedAt, 30);
  assert.equal(preview.updatedAt, 31);
});
