import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_ARMOR_FOUNDATION,
  V3_ARMOR_FOUNDATION_SCHEMA,
  analyzeV3ArmorFoundation,
  createV3ReferenceLockedPartVoxels,
  generateV3ArmorFromTheme,
  generateV3ArmorSuitFromTheme,
  validateV3ArmorFoundationPiece,
} from './v3ArmorFoundation';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';

type OptionalGeneratedRigSlotMetadata = {
  mirrorOf?: string | null;
};

const TEST_COLORS = {
  primary: '#101010',
  secondary: '#202020',
  accent: '#303030',
  dark: '#404040',
  highlight: '#505050',
  visor: '#606060',
};

const coordSignature = (voxels: readonly { x: number; y: number; z: number }[]): string =>
  voxels.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`).sort().join('|');

describe('V3 armor foundation', () => {
  it('derives an export-safe V3-only foundation from the exact OBJ source and Mesh2Motion rig', () => {
    const serialized = JSON.stringify(V3_ARMOR_FOUNDATION);

    assert.equal(V3_ARMOR_FOUNDATION.schemaVersion, V3_ARMOR_FOUNDATION_SCHEMA);
    assert.equal(V3_ARMOR_FOUNDATION.version, 1);
    assert.equal(V3_ARMOR_FOUNDATION.source.exactObjSurfaceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);
    assert.equal(V3_ARMOR_FOUNDATION.source.mesh2MotionRigSha256, V3_MESH2MOTION_ARMOR_RIG.source.sha256);
    assert.deepEqual(Object.keys(V3_ARMOR_FOUNDATION.slots).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
    assert.equal(serialized.includes('C:'), false);
    assert.equal(serialized.includes('G:'), false);
    assert.equal(serialized.includes('/Users/'), false);
    assert.equal(serialized.includes('"triangles"'), false);
    assert.equal(serialized.includes('"meshes"'), false);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      const sourceSlot = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot];
      const rigSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
      const optionalRigSlot = rigSlot as typeof rigSlot & OptionalGeneratedRigSlotMetadata;

      assert.equal(foundationSlot.slot, slot);
      assert.deepEqual(foundationSlot.localGridDimensions, sourceSlot.bounds.size);
      assert.deepEqual(foundationSlot.roleHintIndexes, sourceSlot.roleHintIndexes);
      assert.equal(foundationSlot.referenceVoxelCount, sourceSlot.voxelCount);
      assert.equal(foundationSlot.referenceRunCount, sourceSlot.runCount);
      assert.equal(foundationSlot.sourceJointName, rigSlot.sourceJointName);
      assert.equal(foundationSlot.endJointName, rigSlot.endJointName);
      assert.equal(foundationSlot.mirrorOf, optionalRigSlot.mirrorOf ?? null);
      assert.match(foundationSlot.sourceHashes.exactObjSurfaceSlot, /^exact-obj-slot:fnv1a32:[0-9a-f]{8}$/);
      assert.match(foundationSlot.sourceHashes.mesh2MotionSlot, /^mesh2motion-slot:fnv1a32:[0-9a-f]{8}$/);
      assert.ok(foundationSlot.referenceMaskRuns.length > 0, `${slot} should include local mask runs`);
      assert.ok(foundationSlot.jointClearance > 0, `${slot} should expose Mesh2Motion joint clearance`);
    }
  });

  it('analyzes the checked-in foundation contract as ready', () => {
    const report = analyzeV3ArmorFoundation();

    assert.equal(report.ready, true, report.issues.join('; '));
    assert.equal(report.slotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(report.referenceVoxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.metrics.totalVoxelCount);
    assert.deepEqual(report.issues, []);
  });

  it('creates reference-locked render voxels without changing the exact OBJ silhouette', () => {
    const helmet = createV3ReferenceLockedPartVoxels('helmet', TEST_COLORS, undefined, {
      qualityTier: 'desktop',
      sourceFidelity: 'exact',
    });
    const runtimeHelmet = createV3ReferenceLockedPartVoxels('helmet', TEST_COLORS, undefined, {
      qualityTier: 'desktop',
      sourceFidelity: 'runtimeLod',
    });

    assert.equal(helmet.length, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.helmet.voxelCount);
    assert.ok(runtimeHelmet.length < helmet.length);
    assert.ok(helmet.some((voxel) => voxel.color === TEST_COLORS.visor && voxel.emissive === true));
    assert.equal(new Set(helmet.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size, helmet.length);
  });

  it('generates deterministic reference-locked V3 armor from theme text', () => {
    const first = generateV3ArmorFromTheme({
      slot: 'helmet',
      description: 'forerunner cobalt visor with glowing trim',
      seed: 'alpha',
      intensity: 0.8,
      now: 123,
    });
    const second = generateV3ArmorFromTheme({
      slot: 'helmet',
      description: 'forerunner cobalt visor with glowing trim',
      seed: 'alpha',
      intensity: 0.8,
      now: 123,
    });
    const variant = generateV3ArmorFromTheme({
      slot: 'helmet',
      description: 'forerunner cobalt visor with glowing trim',
      seed: 'beta',
      intensity: 0.8,
      now: 123,
    });

    assert.deepEqual(second, first);
    assert.equal(first.modelSystem, 'v3');
    assert.equal(first.slot, 'helmet');
    assert.match(first.sourcePreset ?? '', /^v3-foundation:helmet:/);
    assert.equal(first.voxels.length, V3_ARMOR_FOUNDATION.slots.helmet.referenceVoxelCount);
    assert.equal(coordSignature(first.voxels), coordSignature(variant.voxels));
    assert.notDeepEqual(first.voxels.map((voxel) => voxel.role), variant.voxels.map((voxel) => voxel.role));
    assert.equal(validateV3ArmorFoundationPiece(first).valid, true);
  });

  it('generates a full internal V3 suit and keeps every slot on the foundation mask', () => {
    const suit = generateV3ArmorSuitFromTheme({
      description: 'onyx stealth armor with subtle red emissive vents',
      seed: 'suit-alpha',
      intensity: 0.6,
      now: 456,
    });

    assert.deepEqual(Object.keys(suit).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const piece = suit[slot];
      const validation = validateV3ArmorFoundationPiece(piece);
      assert.equal(piece.slot, slot);
      assert.equal(piece.modelSystem, 'v3');
      assert.equal(piece.voxels.length, V3_ARMOR_FOUNDATION.slots[slot].referenceVoxelCount);
      assert.equal(validation.valid, true, `${slot}: ${validation.errors.join('; ')}`);
    }
  });

  it('rejects generated V3 armor pieces that drift away from the foundation mask', () => {
    const piece = generateV3ArmorFromTheme({
      slot: 'chest',
      description: 'unknown internal fixture',
      seed: 'validator',
      now: 789,
    });

    const missing = {
      ...piece,
      voxels: piece.voxels.slice(1),
    };
    const extra = {
      ...piece,
      voxels: [
        ...piece.voxels,
        { x: 999, y: 999, z: 999, role: 'primary' as const },
      ],
    };

    assert.equal(validateV3ArmorFoundationPiece(piece).valid, true);
    assert.equal(validateV3ArmorFoundationPiece(missing).valid, false);
    assert.ok(validateV3ArmorFoundationPiece(missing).errors.some((error) => error.includes('missing')));
    assert.equal(validateV3ArmorFoundationPiece(extra).valid, false);
    assert.ok(validateV3ArmorFoundationPiece(extra).errors.some((error) => error.includes('outside')));
  });
});
