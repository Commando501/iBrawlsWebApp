import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomArmorColors, CustomArmorMaterialRole, CustomArmorPieceSnapshot } from '../customArmor';
import { buildV3ArmorEditorVisualQa } from './v3ArmorEditorVisualQa';

const colors: CustomArmorColors = {
  primary: '#38bdf8',
  secondary: '#2563eb',
  accent: '#a855f7',
  visor: '#67e8f9',
  dark: '#020617',
  highlight: '#5eead4',
};

const piece = (
  voxels: CustomArmorPieceSnapshot['voxels'],
  gridScale: 1 | 2 = 2
): CustomArmorPieceSnapshot => ({
  version: 1,
  id: 'draft',
  name: 'Draft',
  slot: 'helmet',
  modelSystem: 'v3',
  gridScale,
  voxels,
  updatedAt: 1,
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
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        voxels.push({ x, y, z, role, emissive: role === 'visor' || role === 'emissive' });
      }
    }
  }
  return voxels;
};

test('buildV3ArmorEditorVisualQa accepts dense helmet-style drafts without full-body part failures', () => {
  const helmet = piece([
    ...box(5, 14, 4, 12, 3, 8, 'primary'),
    ...box(4, 15, 8, 10, 2, 2, 'visor'),
    ...box(7, 12, 2, 4, 7, 10, 'secondary'),
    ...box(8, 11, 13, 13, 4, 7, 'accent'),
  ]);

  const report = buildV3ArmorEditorVisualQa({
    draft: helmet,
    colors,
    slot: 'helmet',
    gridScale: 2,
  });

  assert.equal(report.ready, true, report.issues.map((issue) => issue.code).join(', '));
  assert.equal(report.score, 100);
  assert.equal(report.summary.snapshotCount, 8);
  assert.equal(report.issues.some((issue) => issue.code === 'important_part_missing'), false);
});

test('buildV3ArmorEditorVisualQa flags empty or sparse drafts as unreadable', () => {
  const report = buildV3ArmorEditorVisualQa({
    draft: piece([{ x: 9, y: 8, z: 8, role: 'primary' }]),
    colors,
    slot: 'helmet',
    gridScale: 2,
  });

  const issueCodes = report.issues.map((issue) => issue.code);
  assert.equal(report.ready, false);
  assert.equal(report.score < 100, true);
  assert.equal(issueCodes.includes('occupied_area_low') || issueCodes.includes('panel_count_low'), true);
  assert.equal(issueCodes.includes('important_part_missing'), false);
});

test('buildV3ArmorEditorVisualQa flags dark slab coverage readability issues', () => {
  const report = buildV3ArmorEditorVisualQa({
    draft: piece(box(3, 16, 3, 13, 4, 5, 'dark')),
    colors,
    slot: 'helmet',
    gridScale: 2,
  });

  assert.equal(report.ready, false);
  assert.equal(report.issues.some((issue) => issue.code === 'dark_coverage_high'), true);
});

test('buildV3ArmorEditorVisualQa keeps gridScale 2 drafts within stable projected dimensions', () => {
  const lowDensity = buildV3ArmorEditorVisualQa({
    draft: piece(box(4, 5, 3, 4, 4, 5, 'primary'), 1),
    colors,
    slot: 'helmet',
    gridScale: 1,
  });
  const highDensity = buildV3ArmorEditorVisualQa({
    draft: piece(box(8, 11, 6, 9, 8, 11, 'primary'), 2),
    colors,
    slot: 'helmet',
    gridScale: 2,
  });

  assert.equal(lowDensity.summary.snapshotCount, 8);
  assert.equal(highDensity.summary.snapshotCount, 8);
  assert.ok(
    Math.abs(lowDensity.summary.minProjectedWidth - highDensity.summary.minProjectedWidth) < 0.02,
    `expected similar projected widths, got ${lowDensity.summary.minProjectedWidth} vs ${highDensity.summary.minProjectedWidth}`
  );
});
