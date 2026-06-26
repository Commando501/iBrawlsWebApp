import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
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
import { V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS } from './v3Mesh2MotionArmorRig';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3ModelTypes';
import { V3_REFERENCE_LIMB_VOXELS } from './v3ReferenceLimbVoxels.generated';
import { V3_REFERENCE_SOURCE_BIND } from './v3ReferenceSourceBind.generated';

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

const geometryWorldQuaternion = (slot: {
  mesh2MotionPivotWorldQuaternion: readonly number[];
  mesh2MotionGeometry: { rotation: readonly number[] };
}): THREE.Quaternion => {
  const pivot = new THREE.Quaternion(
    slot.mesh2MotionPivotWorldQuaternion[0] ?? 0,
    slot.mesh2MotionPivotWorldQuaternion[1] ?? 0,
    slot.mesh2MotionPivotWorldQuaternion[2] ?? 0,
    slot.mesh2MotionPivotWorldQuaternion[3] ?? 1
  ).normalize();
  const geometry = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    slot.mesh2MotionGeometry.rotation[0] ?? 0,
    slot.mesh2MotionGeometry.rotation[1] ?? 0,
    slot.mesh2MotionGeometry.rotation[2] ?? 0,
    'XYZ'
  ));
  return pivot.multiply(geometry).normalize();
};

const basisQuaternion = (basis: { quaternion: readonly number[] }): THREE.Quaternion =>
  new THREE.Quaternion(
    basis.quaternion[0] ?? 0,
    basis.quaternion[1] ?? 0,
    basis.quaternion[2] ?? 0,
    basis.quaternion[3] ?? 1
  ).normalize();

const expectedMesh2MotionWorldGeometryQuaternion = (slot: V3CharacterSlotId): THREE.Quaternion => {
  const rigSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
  const pivot = new THREE.Quaternion(
    rigSlot.pivotWorldQuaternion[0] ?? 0,
    rigSlot.pivotWorldQuaternion[1] ?? 0,
    rigSlot.pivotWorldQuaternion[2] ?? 0,
    rigSlot.pivotWorldQuaternion[3] ?? 1
  ).normalize();
  const geometry = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    rigSlot.geometry.rotation[0] ?? 0,
    rigSlot.geometry.rotation[1] ?? 0,
    rigSlot.geometry.rotation[2] ?? 0,
    'XYZ'
  ));
  return pivot.multiply(geometry).normalize();
};

const expectedFoundationVoxelCount = (): number => V3_CHARACTER_SLOT_IDS.reduce((total, slot) => {
  return total + V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot].voxelCount;
}, 0);

const expectedFoundationSourceSlot = (slot: V3CharacterSlotId) => (
  V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot]
);

describe('V3 armor foundation', () => {
  it('derives an export-safe V3-only foundation from the exact OBJ source and Mesh2Motion rig', () => {
    const serialized = JSON.stringify(V3_ARMOR_FOUNDATION);

    assert.equal(V3_ARMOR_FOUNDATION.schemaVersion, V3_ARMOR_FOUNDATION_SCHEMA);
    assert.equal(V3_ARMOR_FOUNDATION.version, 1);
    assert.equal(V3_ARMOR_FOUNDATION.source.exactObjSurfaceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);
    assert.equal(V3_ARMOR_FOUNDATION.source.mesh2MotionRigSha256, V3_MESH2MOTION_ARMOR_RIG.source.sha256);
    assert.equal(V3_ARMOR_FOUNDATION.source.referenceSourceBindSha256, V3_REFERENCE_SOURCE_BIND.source.sha256);
    assert.equal(V3_ARMOR_FOUNDATION.source.referenceLimbVoxelSha256, V3_REFERENCE_LIMB_VOXELS.source.sha256);
    assert.deepEqual(Object.keys(V3_ARMOR_FOUNDATION.slots).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
    assert.equal(serialized.includes('C:'), false);
    assert.equal(serialized.includes('G:'), false);
    assert.equal(serialized.includes('/Users/'), false);
    assert.equal(serialized.includes('"triangles"'), false);
    assert.equal(serialized.includes('"meshes"'), false);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      const sourceSlot = expectedFoundationSourceSlot(slot);
      const rigSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
      const optionalRigSlot = rigSlot as typeof rigSlot & OptionalGeneratedRigSlotMetadata;
      assert.ok(sourceSlot, `${slot} should have a resolved source slot`);

      assert.equal(foundationSlot.slot, slot);
      assert.deepEqual(foundationSlot.localGridDimensions, sourceSlot.bounds.size);
      assert.deepEqual(foundationSlot.roleHintIndexes, sourceSlot.roleHintIndexes);
      assert.equal(foundationSlot.referenceVoxelCount, sourceSlot.voxelCount);
      assert.equal(foundationSlot.referenceRunCount, sourceSlot.runCount);
      assert.equal(foundationSlot.sourceJointName, rigSlot.sourceJointName);
      assert.equal(foundationSlot.endJointName, rigSlot.endJointName);
      assert.equal(foundationSlot.mirrorOf, optionalRigSlot.mirrorOf ?? null);
      assert.equal(foundationSlot.exactSourceGeometryCenter.length, 3);
      assert.equal(foundationSlot.exactSourceBindPoint.length, 3);
      assert.equal(foundationSlot.exactSourceBindOffset.length, 3);
      assert.equal(foundationSlot.exactSourceRestBasis.xAxis.length, 3);
      assert.equal(foundationSlot.exactSourceRestBasis.yAxis.length, 3);
      assert.equal(foundationSlot.exactSourceRestBasis.zAxis.length, 3);
      assert.equal(foundationSlot.exactSourceRestBasis.quaternion.length, 4);
      assert.equal(Number.isFinite(foundationSlot.sourcePoseCorrectionAngleDegrees), true);
      assert.match(foundationSlot.sourceHashes.mesh2MotionSlot, /^mesh2motion-slot:fnv1a32:[0-9a-f]{8}$/);
      const hasReferenceSourceBind = Boolean(
        V3_REFERENCE_SOURCE_BIND.slots[slot as keyof typeof V3_REFERENCE_SOURCE_BIND.slots]
      );
      if (hasReferenceSourceBind) {
        assert.ok(foundationSlot.referenceSourceBindBasis, `${slot} should record Blender bind reference basis`);
        assert.match(
          foundationSlot.sourceHashes.referenceSourceBindSlot ?? '',
          /^reference-source-bind-slot:fnv1a32:[0-9a-f]{8}$/
        );
      } else {
        assert.equal(foundationSlot.referenceSourceBindBasis, null);
        assert.equal(foundationSlot.sourcePoseCorrectionAngleDegrees, 0);
      }
      assert.match(
        foundationSlot.sourceHashes.exactObjSurfaceSlot ?? '',
        /^exact-obj-slot:fnv1a32:[0-9a-f]{8}$/,
        `${slot} should record the OBJ visual source slot hash`
      );
      assert.equal(foundationSlot.sourceHashes.referenceLimbVoxelSlot, null);
      assert.ok(foundationSlot.referenceMaskRuns.length > 0, `${slot} should include local mask runs`);
      assert.ok(foundationSlot.jointClearance > 0, `${slot} should expose Mesh2Motion joint clearance`);
    }
  });

  it('analyzes the checked-in foundation contract as ready', () => {
    const report = analyzeV3ArmorFoundation();

    assert.equal(report.ready, true, report.issues.join('; '));
    assert.equal(report.slotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(report.referenceVoxelCount, expectedFoundationVoxelCount());
    assert.deepEqual(report.issues, []);
  });

  it('uses the exact OBJ source artifact for every visible built-in slot', () => {
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const sourceSlot = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot];
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];

      assert.ok(sourceSlot, `${slot} should have exact OBJ source voxels`);
      assert.match(
        foundationSlot.sourceHashes.exactObjSurfaceSlot ?? '',
        /^exact-obj-slot:fnv1a32:[0-9a-f]{8}$/,
        `${slot} should bind visible geometry from the OBJ source artifact`
      );
      assert.equal(foundationSlot.sourceHashes.referenceLimbVoxelSlot, null);
      assert.equal(foundationSlot.referenceVoxelCount, sourceSlot.voxelCount);
    }
  });

  it('keeps visible occupancy locked to the OBJ reference instead of the underfilled rigged GLB body', () => {
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      const objSlot = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot];

      assert.equal(foundationSlot.referenceVoxelCount, objSlot.voxelCount, `${slot} should use OBJ reference occupancy`);
      assert.equal(foundationSlot.referenceRunCount, objSlot.runCount, `${slot} should use OBJ reference runs`);
      assert.match(
        foundationSlot.sourceHashes.exactObjSurfaceSlot ?? '',
        /^exact-obj-slot:fnv1a32:[0-9a-f]{8}$/,
        `${slot} should bind from the OBJ reference source`
      );
      assert.equal(
        foundationSlot.sourceHashes.referenceLimbVoxelSlot,
        null,
        `${slot} should not bind from the underfilled GLB body source`
      );
      assert.deepEqual(
        foundationSlot.mesh2MotionGeometry.scale,
        [1, 1, 1],
        `${slot} OBJ reference geometry should stay at OBJ authoring scale`
      );
    }
  });

  it('keeps exact OBJ visual geometry at OBJ authoring scale', () => {
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.deepEqual(
        V3_ARMOR_FOUNDATION.slots[slot].mesh2MotionGeometry.scale,
        [1, 1, 1],
        `${slot} OBJ visual geometry should stay at OBJ authoring scale`
      );
    }
  });

  it('uses generated Mesh2Motion limb slot orientation for exact OBJ visual geometry', () => {
    for (const slot of V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS) {
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      const worldGeometryRotation = geometryWorldQuaternion(foundationSlot);
      const expectedWorldRotation = expectedMesh2MotionWorldGeometryQuaternion(slot);

      assert.ok(
        worldGeometryRotation.angleTo(expectedWorldRotation) <= 0.0001,
        `${slot} OBJ voxel geometry should preserve the generated Mesh2Motion visual slot orientation`
      );
    }
  });

  it('records Blender reference bind frames while consuming exact OBJ T-pose visual voxels', () => {
    assert.equal(V3_REFERENCE_SOURCE_BIND.diagnostics.missingRequiredBones.length, 0);
    assert.equal(V3_REFERENCE_SOURCE_BIND.diagnostics.armChainMaxVerticalDelta < 0.04, true);
    assert.equal(V3_REFERENCE_LIMB_VOXELS.diagnostics.missingArmMeshNodes.length, 0);

    for (const slot of V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS) {
      const referenceSlot = V3_REFERENCE_SOURCE_BIND.slots[slot];
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      assert.ok(referenceSlot, `${slot} should have a Blender source bind slot`);
      assert.ok(foundationSlot.referenceSourceBindBasis, `${slot} should retain the Blender source bind basis`);
      assert.deepEqual(
        foundationSlot.referenceSourceBindBasis.yAxis,
        referenceSlot.sourceBasis.yAxis
      );
      assert.ok(
        basisQuaternion(foundationSlot.referenceSourceBindBasis).angleTo(basisQuaternion(referenceSlot.sourceBasis)) <= 0.0001,
        `${slot} should retain the full Blender source bind basis, including roll`
      );
      assert.ok(
        foundationSlot.sourcePoseCorrectionAngleDegrees >= 0,
        `${slot} source pose correction should remain finite for OBJ visual source`
      );
      assert.equal(foundationSlot.referenceVoxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot].voxelCount);
    }
  });

  it('maps exact-source limb-chain bind points onto Mesh2Motion pivots', () => {
    for (const slot of V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS) {
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      const sourceBindOffset = new THREE.Vector3(...foundationSlot.exactSourceBindOffset);
      const geometryRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        foundationSlot.mesh2MotionGeometry.rotation[0],
        foundationSlot.mesh2MotionGeometry.rotation[1],
        foundationSlot.mesh2MotionGeometry.rotation[2],
        'XYZ'
      ));
      const mappedBindOffset = sourceBindOffset.applyQuaternion(geometryRotation)
        .add(new THREE.Vector3(...foundationSlot.mesh2MotionGeometry.position));

      assert.ok(
        mappedBindOffset.length() <= 0.00001,
        `${slot} source bind point should land on the Mesh2Motion pivot`
      );
    }
  });

  it('creates exact OBJ render voxels for the helmet foundation slot', () => {
    const helmet = createV3ReferenceLockedPartVoxels('helmet', TEST_COLORS, undefined, {
      qualityTier: 'desktop',
      sourceFidelity: 'exact',
    });
    const runtimeHelmet = createV3ReferenceLockedPartVoxels('helmet', TEST_COLORS, undefined, {
      qualityTier: 'desktop',
      sourceFidelity: 'runtimeLod',
    });

    assert.equal(helmet.length, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.helmet.voxelCount);
    assert.notEqual(helmet.length, V3_REFERENCE_LIMB_VOXELS.slots.helmet.voxelCount);
    assert.ok(runtimeHelmet.length < helmet.length);
    assert.ok(helmet.some((voxel) => voxel.emissive === true));
    assert.equal(new Set(helmet.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size, helmet.length);
  });

  it('creates exact OBJ T-pose visual limb voxels for native limb-chain slots', () => {
    const forearm = createV3ReferenceLockedPartVoxels('forearmLeft', TEST_COLORS, undefined, {
      qualityTier: 'desktop',
      sourceFidelity: 'exact',
    });
    const shin = createV3ReferenceLockedPartVoxels('shinLeft', TEST_COLORS, undefined, {
      qualityTier: 'desktop',
      sourceFidelity: 'exact',
    });

    assert.equal(forearm.length, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.forearmLeft.voxelCount);
    assert.notEqual(forearm.length, V3_REFERENCE_LIMB_VOXELS.slots.forearmLeft.voxelCount);
    assert.equal(new Set(forearm.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size, forearm.length);
    assert.equal(forearm.some((voxel) => voxel.color === TEST_COLORS.secondary), true);
    assert.equal(shin.length, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.shinLeft.voxelCount);
    assert.notEqual(shin.length, V3_REFERENCE_LIMB_VOXELS.slots.shinLeft.voxelCount);
    assert.equal(new Set(shin.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size, shin.length);
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
