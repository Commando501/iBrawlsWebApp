import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_CUSTOM_ARMOR_SLOTS,
  dedupeCustomArmorVoxels,
  getCustomArmorBounds,
  getCustomArmorGridScale,
  sanitizePieceName,
  validateCustomArmorPiece,
  type CustomArmorMaterialRole,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
} from '../customArmor';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import {
  createV3ArmorTemplateDraft,
  getV3ArmorTemplateLabel,
} from './v3ArmorEditorTemplates';

const GRID_SCALE = 2;
const SILHOUETTE_BINS = 5;

const FAMILY_SAMPLE_SLOTS: Array<{
  family: string;
  slot: V3CustomArmorSlot;
}> = [
  { family: 'helmet', slot: 'helmet' },
  { family: 'neck/collar', slot: 'neck' },
  { family: 'chest', slot: 'chest' },
  { family: 'shoulder', slot: 'shoulderLeft' },
  { family: 'upperArm', slot: 'upperArmLeft' },
  { family: 'forearm', slot: 'forearmLeft' },
  { family: 'hand', slot: 'handLeft' },
  { family: 'pelvis', slot: 'pelvis' },
  { family: 'thigh', slot: 'thighLeft' },
  { family: 'shin', slot: 'shinLeft' },
  { family: 'foot', slot: 'footLeft' },
  { family: 'back', slot: 'back' },
];

const PAIRED_SLOTS: Array<[V3CustomArmorSlot, V3CustomArmorSlot]> = [
  ['shoulderLeft', 'shoulderRight'],
  ['upperArmLeft', 'upperArmRight'],
  ['forearmLeft', 'forearmRight'],
  ['handLeft', 'handRight'],
  ['thighLeft', 'thighRight'],
  ['shinLeft', 'shinRight'],
  ['footLeft', 'footRight'],
];

const SMALL_SLOT_ROLE_FLOOR = new Set<V3CustomArmorSlot>([
  'neck',
  'handLeft',
  'handRight',
  'footLeft',
  'footRight',
]);

const DARK_READ_ROLES = new Set<CustomArmorMaterialRole>(['dark', 'undersuit']);
const EMISSIVE_READ_ROLES = new Set<CustomArmorMaterialRole>(['emissive', 'visor']);

function assertWithinSlotBounds(slot: V3CustomArmorSlot, draft: CustomArmorPieceSnapshot): void {
  const dimensions = getV3CharacterPartBounds(slot).maxDimensions;
  for (const voxel of draft.voxels) {
    assert.ok(voxel.x >= 0 && voxel.x < dimensions.x * GRID_SCALE, `${slot} x out of bounds: ${voxel.x}`);
    assert.ok(voxel.y >= 0 && voxel.y < dimensions.y * GRID_SCALE, `${slot} y out of bounds: ${voxel.y}`);
    assert.ok(voxel.z >= 0 && voxel.z < dimensions.z * GRID_SCALE, `${slot} z out of bounds: ${voxel.z}`);
  }
}

function occupiedBoundsVolume(voxels: CustomArmorPieceSnapshot['voxels']): number {
  assert.ok(voxels.length > 0, 'expected voxels before measuring volume');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const voxel of voxels) {
    minX = Math.min(minX, voxel.x);
    maxX = Math.max(maxX, voxel.x);
    minY = Math.min(minY, voxel.y);
    maxY = Math.max(maxY, voxel.y);
    minZ = Math.min(minZ, voxel.z);
    maxZ = Math.max(maxZ, voxel.z);
  }

  return (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
}

function normalizedAxisBucket(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.round(((value - min) / (max - min)) * (SILHOUETTE_BINS - 1));
}

function normalizedSilhouetteSignature(draft: CustomArmorPieceSnapshot): string {
  const bounds = getCustomArmorBounds(draft.voxels);
  assert.ok(bounds, `${draft.slot} should have occupied bounds`);
  const occupiedCells = new Set(draft.voxels.map((voxel) => [
    normalizedAxisBucket(voxel.x, bounds.minX, bounds.maxX),
    normalizedAxisBucket(voxel.y, bounds.minY, bounds.maxY),
    normalizedAxisBucket(voxel.z, bounds.minZ, bounds.maxZ),
  ].join(':')));

  return [...occupiedCells].sort().join('|');
}

function projectionCoverage(draft: CustomArmorPieceSnapshot): number {
  const bounds = getCustomArmorBounds(draft.voxels);
  assert.ok(bounds, `${draft.slot} should have occupied bounds`);
  const sizeX = bounds.maxX - bounds.minX + 1;
  const sizeY = bounds.maxY - bounds.minY + 1;
  const sizeZ = bounds.maxZ - bounds.minZ + 1;
  const xy = new Set<string>();
  const xz = new Set<string>();
  const yz = new Set<string>();

  for (const voxel of draft.voxels) {
    xy.add(`${voxel.x}:${voxel.y}`);
    xz.add(`${voxel.x}:${voxel.z}`);
    yz.add(`${voxel.y}:${voxel.z}`);
  }

  return (
    (xy.size / Math.max(1, sizeX * sizeY)) +
    (xz.size / Math.max(1, sizeX * sizeZ)) +
    (yz.size / Math.max(1, sizeY * sizeZ))
  ) / 3;
}

function roleRatio(
  draft: CustomArmorPieceSnapshot,
  roles: ReadonlySet<CustomArmorMaterialRole>,
  includeEmissiveFlag = false
): number {
  return draft.voxels.filter((voxel) => (
    roles.has(voxel.role) || (includeEmissiveFlag && voxel.emissive === true)
  )).length / Math.max(1, draft.voxels.length);
}

function minimumRoleDiversity(slot: V3CustomArmorSlot): number {
  if (slot === 'helmet') return 5;
  return SMALL_SLOT_ROLE_FLOOR.has(slot) ? 2 : 3;
}

test('every V3 slot creates a valid gridScale 2 starter template within slot bounds', () => {
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const label = getV3ArmorTemplateLabel(slot);
    const draft = createV3ArmorTemplateDraft(slot, { hue: 210, now: 1_000 });
    const validation = validateCustomArmorPiece(draft);

    assert.equal(draft.version, 1, slot);
    assert.equal(draft.id, `v3_template_${slot}_${(1_000).toString(36)}`, slot);
    assert.equal(draft.name, sanitizePieceName(`${label} Smart Start`, label), slot);
    assert.equal(draft.slot, slot, slot);
    assert.equal(draft.modelSystem, 'v3', slot);
    assert.equal(draft.gridScale, GRID_SCALE, slot);
    assert.equal(getCustomArmorGridScale(draft), GRID_SCALE, slot);
    assert.equal(draft.updatedAt, 1_000, slot);
    assert.ok(draft.voxels.length > 0, slot);
    assertWithinSlotBounds(slot, draft);
    assert.equal(validation.valid, true, `${slot}: ${validation.errors.join('; ')}`);
    assert.equal(validation.stats.modelSystem, 'v3', slot);
    assert.equal(validation.stats.v3Slot, slot, slot);
  }
});

test('templates are deterministic for fixed now, name, and hue', () => {
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const first = createV3ArmorTemplateDraft(slot, {
      hue: 125,
      now: 20_000,
      name: 'Stable Start',
    });
    const second = createV3ArmorTemplateDraft(slot, {
      hue: 125,
      now: 20_000,
      name: 'Stable Start',
    });

    assert.deepEqual(first, second, slot);
    assert.equal(first.id, `v3_template_${slot}_${(20_000).toString(36)}`, slot);
  }
});

test('template ids include the creation timestamp to avoid same-slot catalog collisions', () => {
  const first = createV3ArmorTemplateDraft('helmet', { hue: 210, now: 10_000 });
  const second = createV3ArmorTemplateDraft('helmet', { hue: 210, now: 10_001 });

  assert.equal(first.id, `v3_template_helmet_${(10_000).toString(36)}`);
  assert.equal(second.id, `v3_template_helmet_${(10_001).toString(36)}`);
  assert.notEqual(first.id, second.id);
});

test('templates provide role diversity, helmet visor voxels, and negative space', () => {
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const draft = createV3ArmorTemplateDraft(slot, { hue: 90, now: 3_000 });
    const roles = new Set(draft.voxels.map((voxel) => voxel.role));

    assert.ok(
      roles.size >= minimumRoleDiversity(slot),
      `${slot} roles: ${[...roles].join(', ')}`
    );
    if (slot === 'helmet') {
      assert.equal(roles.has('visor'), true);
      assert.equal(
        draft.voxels.some((voxel) => voxel.role === 'visor' && voxel.emissive === true),
        true
      );
    } else {
      assert.equal(roles.has('visor'), false, `${slot} should not require helmet visor roles`);
    }
    assert.notEqual(draft.voxels.length, occupiedBoundsVolume(draft.voxels), `${slot} is a full slab`);
  }
});

test('starter templates expose distinct normalized silhouettes for major V3 slot families', () => {
  const signaturesByFamily = new Map<string, string[]>();

  for (const { family, slot } of FAMILY_SAMPLE_SLOTS) {
    const draft = createV3ArmorTemplateDraft(slot, { hue: 180, now: 6_000 });
    const signature = normalizedSilhouetteSignature(draft);
    signaturesByFamily.set(signature, [...(signaturesByFamily.get(signature) ?? []), family]);
  }

  const collisions = [...signaturesByFamily.values()]
    .filter((families) => families.length > 1)
    .map((families) => families.join(' / '));

  assert.deepEqual(collisions, []);
});

test('left and right paired templates keep matching normalized silhouette signatures', () => {
  for (const [left, right] of PAIRED_SLOTS) {
    const leftDraft = createV3ArmorTemplateDraft(left, { hue: 30, now: 7_000 });
    const rightDraft = createV3ArmorTemplateDraft(right, { hue: 30, now: 7_000 });

    assert.equal(
      normalizedSilhouetteSignature(leftDraft),
      normalizedSilhouetteSignature(rightDraft),
      `${left} and ${right} should share a slot-family silhouette`
    );
  }
});

test('starter templates satisfy cheap readability floors without exact voxel snapshots', () => {
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const draft = createV3ArmorTemplateDraft(slot, { hue: 260, now: 8_000 });
    const fillRatio = draft.voxels.length / occupiedBoundsVolume(draft.voxels);
    const roles = new Set(draft.voxels.map((voxel) => voxel.role));

    assert.ok(fillRatio >= 0.08, `${slot} fill ratio too sparse: ${fillRatio}`);
    assert.ok(fillRatio <= 0.82, `${slot} fill ratio too slab-like: ${fillRatio}`);
    assert.ok(1 - fillRatio >= 0.18, `${slot} lacks negative space: ${1 - fillRatio}`);
    assert.ok(projectionCoverage(draft) >= 0.16, `${slot} projection coverage too weak`);
    assert.ok(roleRatio(draft, DARK_READ_ROLES) <= 0.34, `${slot} dark coverage too high`);
    assert.ok(
      roleRatio(draft, EMISSIVE_READ_ROLES, true) <= (slot === 'helmet' ? 0.22 : 0.12),
      `${slot} emissive coverage too high`
    );
    assert.ok(
      roles.size >= minimumRoleDiversity(slot),
      `${slot} role diversity too low: ${[...roles].join(', ')}`
    );
  }
});

test('custom template name and timestamp are honored', () => {
  const draft = createV3ArmorTemplateDraft('chest', {
    hue: 40,
    now: 4_242,
    name: 'Operator Core',
  });

  assert.equal(draft.name, 'Operator Core');
  assert.equal(draft.updatedAt, 4_242);
  assert.equal(draft.id, `v3_template_chest_${(4_242).toString(36)}`);
});

test('template names are trimmed, capped, and fall back for blank names', () => {
  const blankName = createV3ArmorTemplateDraft('helmet', {
    hue: 210,
    now: 9_000,
    name: '   ',
  });
  const longName = createV3ArmorTemplateDraft('helmet', {
    hue: 210,
    now: 9_001,
    name: `  ${'A'.repeat(40)}  `,
  });

  assert.equal(blankName.name, 'Aegis Vanguard Helmet');
  assert.equal(longName.name, 'A'.repeat(32));
});

test('non-finite template timestamps fall back to a finite timestamp and never leak NaN into ids', () => {
  const originalNow = Date.now;
  Date.now = () => 123_456;
  try {
    const draft = createV3ArmorTemplateDraft('helmet', {
      hue: 210,
      now: Number.NaN,
      name: 'Stable Helmet',
    });

    assert.equal(draft.updatedAt, 123_456);
    assert.equal(Number.isFinite(draft.updatedAt), true);
    assert.equal(draft.id, `v3_template_helmet_${(123_456).toString(36)}`);
    assert.equal(draft.id.includes('NaN'), false);
  } finally {
    Date.now = originalNow;
  }
});

test('template voxels are nonzero, deduped, and under the validation budget', () => {
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const draft = createV3ArmorTemplateDraft(slot, { hue: 300, now: 5_000 });
    const deduped = dedupeCustomArmorVoxels(draft.voxels);
    const validation = validateCustomArmorPiece(draft);

    assert.ok(draft.voxels.length > 0, slot);
    assert.deepEqual(draft.voxels, deduped, `${slot} voxels should be pre-deduped`);
    assert.equal(validation.valid, true, `${slot}: ${validation.errors.join('; ')}`);
    assert.equal(validation.stats.voxelCount, draft.voxels.length, slot);
  }
});
