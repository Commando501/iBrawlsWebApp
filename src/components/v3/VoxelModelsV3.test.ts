import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel, type VoxelData } from '../VoxelModels';
import { createCustomArmorPiece, createCustomArmorSnapshot } from '../customArmor';
import { createCombatantMeshRig } from '../grifball/combatantModels';
import {
  buildV3HammerModel,
  buildV3PistolModel,
  buildV3SpartanModel,
  buildV3WeaponModel,
  getV3AegisObjSurfaceSourceSummary,
  getV3BuiltinPartGridScale,
  getV3BuiltinPartVoxelScale,
  getV3BuiltinPartVoxels,
  getV3BuiltinWeaponVoxels,
} from './VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, V3_WEAPON_IDS, type V3CharacterSlotId } from './v3ModelTypes';
import { getDefaultV3CharacterLoadout, getDefaultV3WeaponManifest, getV3CharacterPartManifest } from './v3AssetManifest';
import {
  V3_AEGIS_SCULPT_PROFILES,
  appendV3ArmorPlate,
  appendV3CornerArmorTabs,
  appendV3MirroredArmorPlates,
  appendV3PanelStripe,
  createV3SculptedShell,
} from './v3ArmorSculpt';
import { getV3CharacterPartBounds } from './v3PartBounds';
import { V3_AEGIS_PART_SPECS } from './v3AegisSuitParts';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import {
  V3_PRODUCTION_QUALITY_THRESHOLDS,
  analyzeV3VoxelQuality,
  classifyV3ProductionReadiness,
} from './v3ProductionQuality';
import { analyzeV3BuiltInShapeLanguage } from './v3ShapeLanguage';
import { analyzeV3ArmorSurface } from './v3VoxelArmorSurface';
import { clearV3GeometryCache } from './v3GeometryCache';
import { analyzeV3RigContinuity } from './v3ExactSourceRigBinding';
import { analyzeV3WeaponScaleFit } from './v3WeaponScaleProfile';
import {
  analyzeV3CanonicalRigContract,
} from './v3CanonicalRigContract';
import {
  analyzeV3AegisReferenceProportions,
  formatV3ReferenceProportionGapSummary,
  getV3RenderedObjGateClosureIssues,
} from './v3ReferenceProportions';
import { deriveV3ExactSourceSlotBudget } from './v3ExactSourceLod';
import { V3_SLOT_DETAIL_BONES } from './v3RigDetail';
import {
  V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS,
} from './v3Mesh2MotionArmorRig';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import { V3_ARMOR_FOUNDATION } from './v3ArmorFoundation';
import { updateV3RigFittedBaseBody } from './v3RigFittedBaseBody';

const requiredSegments = ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const V3_LIMB_CHAIN_BINDING_TEST_SLOT_SET = new Set<V3CharacterSlotId>(V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS);
const getExpectedV3BuiltinSourceSlot = (slot: V3CharacterSlotId) => (
  V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot]
);
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
const groupContainsHexColor = (group: THREE.Object3D, color: string): boolean => {
  const target = color.replace('#', '').toLowerCase();
  let found = false;
  group.traverse((object) => {
    if (found || !(object instanceof THREE.Mesh)) return;
    const attribute = object.geometry.getAttribute('color');
    if (attribute) {
      for (let i = 0; i < attribute.count; i++) {
        const vertexColor = new THREE.Color(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
        if (vertexColor.getHexString() === target) {
          found = true;
          return;
        }
      }
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const materialColor = (material as THREE.Material & { color?: THREE.Color }).color;
      if (materialColor?.getHexString() === target) {
        found = true;
        return;
      }
    }
  });
  return found;
};

const spanVariationByY = (voxels: VoxelData[]): { x: number; z: number } => {
  const rows = new Map<number, VoxelData[]>();
  for (const voxel of voxels) {
    rows.set(voxel.y, [...(rows.get(voxel.y) ?? []), voxel]);
  }

  const xSpans = new Set<number>();
  const zSpans = new Set<number>();
  for (const row of rows.values()) {
    const xs = row.map((voxel) => voxel.x);
    const zs = row.map((voxel) => voxel.z);
    xSpans.add(Math.max(...xs) - Math.min(...xs) + 1);
    zSpans.add(Math.max(...zs) - Math.min(...zs) + 1);
  }

  return { x: xSpans.size, z: zSpans.size };
};

const V3_SCULPT_TEST_COLORS = {
  primary: '#101010',
  secondary: '#202020',
  accent: '#303030',
  undersuit: '#353535',
  visor: '#404040',
  emissive: '#505050',
  decal: '#606060',
  fixed: '#707070',
};

const V3_SCULPT_TEST_PAINT_JOB = {
  v3RoleColors: V3_SCULPT_TEST_COLORS,
  v3RoleEmissive: {
    visor: true,
    emissive: true,
  },
};

const maxHexColorChannel = (color: string): number => Math.max(
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16)
);

const getVoxelMaxZ = (voxels: VoxelData[]): number => Math.max(...voxels.map((voxel) => voxel.z));
const getVoxelMinZ = (voxels: VoxelData[]): number => Math.min(...voxels.map((voxel) => voxel.z));

const getVoxelXSpan = (voxels: VoxelData[]): number => {
  const xs = voxels.map((voxel) => voxel.x);
  return Math.max(...xs) - Math.min(...xs) + 1;
};

const getVoxelBounds = (voxels: VoxelData[]) => {
  const xs = voxels.map((voxel) => voxel.x);
  const ys = voxels.map((voxel) => voxel.y);
  const zs = voxels.map((voxel) => voxel.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    sizeX: maxX - minX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: maxZ - minZ + 1,
  };
};

const getRowXSpan = (voxels: VoxelData[], y: number): number => getVoxelXSpan(voxels.filter((voxel) => voxel.y === y));

const getFrontFaceCoverage = (voxels: VoxelData[]): number => {
  const bounds = getVoxelBounds(voxels);
  const frontCells = voxels.filter((voxel) => voxel.z === bounds.maxZ).length;
  return frontCells / (bounds.sizeX * bounds.sizeY);
};

const hasNearFullHeightFrontColumn = (voxels: VoxelData[]): boolean => {
  const bounds = getVoxelBounds(voxels);
  const frontZ = bounds.maxZ;
  const columnRows = new Map<number, Set<number>>();

  for (const voxel of voxels) {
    if (voxel.z !== frontZ) continue;
    const rows = columnRows.get(voxel.x) ?? new Set<number>();
    rows.add(voxel.y);
    columnRows.set(voxel.x, rows);
  }

  const requiredRows = Math.max(4, bounds.sizeY - 3);
  return [...columnRows.values()].some((rows) => rows.size >= requiredRows);
};

const getWorldBox = (object: THREE.Object3D): THREE.Box3 => {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
};

const getWorldSize = (object: THREE.Object3D): THREE.Vector3 =>
  getWorldBox(object).getSize(new THREE.Vector3());

const getObjectWorldPosition = (object: THREE.Object3D): THREE.Vector3 => {
  object.updateWorldMatrix(true, true);
  return object.getWorldPosition(new THREE.Vector3());
};

const tupleCloseTo = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 0.000001
): boolean => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

const V3_RIG_FITTED_FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
const V3_RIG_FITTED_FINGER_SIDES = [
  { side: 'Left', suffix: 'l', handJoint: 'hand_l' },
  { side: 'Right', suffix: 'r', handJoint: 'hand_r' },
] as const;
const V3_RIG_FITTED_FINGER_CHAINS = V3_RIG_FITTED_FINGER_SIDES.flatMap(({ side, suffix, handJoint }) =>
  V3_RIG_FITTED_FINGERS.flatMap((finger) =>
    ([1, 2, 3] as const).map((index) => ({
      segmentId: `${finger}${side}0${index}`,
      fromJoint: index === 1 ? handJoint : `${finger}_0${index - 1}_${suffix}`,
      toJoint: `${finger}_0${index}_${suffix}`,
    }))
  )
);
const V3_RIG_FITTED_CORE_SEGMENTS = [
  'torso',
  'pelvis',
  'neck',
  'head',
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'handLeft',
  'handRight',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
  'footLeft',
  'footRight',
] as const;
const V3_RIG_FITTED_SEGMENTS = [
  ...V3_RIG_FITTED_CORE_SEGMENTS,
  ...V3_RIG_FITTED_FINGER_CHAINS.map(({ segmentId }) => segmentId),
] as const;

const getMesh2MotionJointWorldPosition = (model: THREE.Object3D, jointName: string): THREE.Vector3 => {
  const joints = model.userData.v3Mesh2MotionJoints as
    | Record<string, { object?: THREE.Object3D }>
    | undefined;
  const joint = joints?.[jointName]?.object;
  assert.ok(joint instanceof THREE.Object3D, `missing Mesh2Motion joint ${jointName}`);
  return getObjectWorldPosition(joint);
};

const getMesh2MotionJointObject = (model: THREE.Object3D, jointName: string): THREE.Object3D => {
  const joints = model.userData.v3Mesh2MotionJoints as
    | Record<string, { object?: THREE.Object3D }>
    | undefined;
  const joint = joints?.[jointName]?.object;
  assert.ok(joint instanceof THREE.Object3D, `missing Mesh2Motion joint ${jointName}`);
  return joint;
};

const assertFiniteWorldTransform = (object: THREE.Object3D, label: string): void => {
  const position = object.getWorldPosition(new THREE.Vector3());
  const quaternion = object.getWorldQuaternion(new THREE.Quaternion());
  const scale = object.getWorldScale(new THREE.Vector3());
  assert.equal(
    [
      position.x,
      position.y,
      position.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      scale.x,
      scale.y,
      scale.z,
    ].every(Number.isFinite),
    true,
    `${label} world transform should stay finite`
  );
};

const getExactObjSlotWorldSize = (slot: V3CharacterSlotId): THREE.Vector3 => {
  const sourceSlot = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot];
  const voxelScale = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;
  return new THREE.Vector3(
    sourceSlot.bounds.size[0] * voxelScale,
    sourceSlot.bounds.size[1] * voxelScale,
    sourceSlot.bounds.size[2] * voxelScale
  );
};

describe('V3 armor sculpt helpers', () => {
  it('creates tapered shell rows from sculpt profile keyframes', () => {
    const voxels = createV3SculptedShell({
      dimensions: [7, 5, 7],
      profile: {
        xInsets: [[0, 2], [0.5, 0], [1, 2]],
        zInsets: [[0, 2], [0.5, 0], [1, 2]],
      },
      color: '#123456',
    });

    assert.deepEqual(spanVariationByY(voxels), { x: 3, z: 3 });
    assert.ok(voxels.some((voxel) => voxel.x === 0 && voxel.y === 2 && voxel.z === 0));
    assert.ok(!voxels.some((voxel) => voxel.x === 0 && voxel.y === 0 && voxel.z === 0));
  });

  it('adds panel stripes and corner tabs on top of sculpted armor shells', () => {
    const voxels = createV3SculptedShell({
      dimensions: [6, 4, 6],
      profile: V3_AEGIS_SCULPT_PROFILES.neck,
      color: '#111111',
    });

    appendV3PanelStripe(voxels, { axis: 'x', fixedZ: 5, color: '#222222' });
    appendV3PanelStripe(voxels, { axis: 'y', fixedZ: 5, color: '#33ccff', emissive: true });
    appendV3CornerArmorTabs(voxels, { dimensions: [6, 4, 6], color: '#444444' });

    assert.ok(voxels.some((voxel) => voxel.color === '#222222' && voxel.y === 1 && voxel.z === 5));
    assert.ok(voxels.some((voxel) => voxel.color === '#33ccff' && voxel.emissive === true));
    assert.ok(voxels.some((voxel) => voxel.color === '#444444' && voxel.x === 0 && voxel.y === 2 && voxel.z === 5));
    assert.ok(voxels.some((voxel) => voxel.color === '#444444' && voxel.x === 5 && voxel.y === 2 && voxel.z === 5));
  });

  it('layers solid and mirrored armor plates onto sculpted shells', () => {
    const voxels = createV3SculptedShell({
      dimensions: [7, 5, 5],
      profile: V3_AEGIS_SCULPT_PROFILES.neck,
      color: '#111111',
    });

    appendV3ArmorPlate(voxels, { origin: [2, 2, 4], dimensions: [3, 1, 1], color: '#222222' });
    appendV3MirroredArmorPlates(voxels, {
      origin: [1, 1, 4],
      dimensions: [2, 1, 1],
      mirrorMaxX: 6,
      color: '#33ccff',
      emissive: true,
    });

    assert.deepEqual(
      voxels.filter((voxel) => voxel.color === '#222222').map((voxel) => voxel.x).sort((a, b) => a - b),
      [2, 3, 4]
    );
    assert.deepEqual(
      voxels.filter((voxel) => voxel.color === '#33ccff').map((voxel) => voxel.x).sort((a, b) => a - b),
      [1, 2, 4, 5]
    );
    assert.ok(voxels.every((voxel) => voxel.color !== '#33ccff' || voxel.emissive === true));
  });

  it('defines a sculpt profile for every V3 character slot', () => {
    assert.deepEqual(Object.keys(V3_AEGIS_SCULPT_PROFILES).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
  });
});

describe('buildV3SpartanModel', () => {
  it('bakes the accepted OBJ base-envelope calibration into built-in Aegis specs with hard-gate correction', () => {
    const expected = {
      helmet: { dimensions: [13, 8, 9], position: [-0.3217, 1.56, -0.245] },
      neck: { dimensions: [6, 4, 6], position: [-0.1592, 1.39, -0.15] },
      chest: { dimensions: [14, 9, 7], position: [-0.3624, 1.16, -0.165] },
      shoulderLeft: { dimensions: [7, 8, 8], position: [-0.6416, 1.1575, -0.19] },
      shoulderRight: { dimensions: [7, 8, 8], position: [0.2716, 1.1575, -0.19] },
      upperArmLeft: { dimensions: [4, 9, 5], position: [-0.4499, 0.95, -0.12] },
      upperArmRight: { dimensions: [4, 9, 5], position: [0.2299, 0.95, -0.12] },
      forearmLeft: { dimensions: [3, 6, 5], position: [-0.36, 0.62, -0.12] },
      forearmRight: { dimensions: [3, 6, 5], position: [0.195, 0.62, -0.12] },
      handLeft: { dimensions: [2, 4, 5], position: [-0.32, 0.48, -0.1275] },
      handRight: { dimensions: [2, 4, 5], position: [0.16, 0.48, -0.1275] },
      pelvis: { dimensions: [11, 6, 10], position: [-0.2733, 0.83, -0.2325] },
      thighLeft: { dimensions: [4, 8, 6], position: [-0.2499, 0.435, -0.16] },
      thighRight: { dimensions: [4, 8, 6], position: [0.0299, 0.435, -0.16] },
      shinLeft: { dimensions: [4, 10, 7], position: [-0.2499, 0, -0.155] },
      shinRight: { dimensions: [4, 10, 7], position: [0.0299, 0, -0.155] },
      footLeft: { dimensions: [7, 3, 8], position: [-0.3074, -0.04, -0.09] },
      footRight: { dimensions: [7, 3, 8], position: [-0.0276, -0.04, -0.09] },
      back: { dimensions: [14, 9, 4], position: [-0.3525, 1.148, -0.34] },
    } as const;

    for (const [slot, spec] of Object.entries(expected)) {
      const actual = V3_AEGIS_PART_SPECS[slot as keyof typeof V3_AEGIS_PART_SPECS];
      assert.deepEqual(actual.dimensions, spec.dimensions, `${slot} dimensions should match calibrated OBJ envelope`);
      assert.deepEqual(actual.position, spec.position, `${slot} position should match calibrated OBJ envelope`);
    }
  });

  it('uses OBJ occupancy for every built-in V3 character part while retaining source-bind metadata', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const exactVoxelScale = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.equal(getV3BuiltinPartGridScale(slot), 1, `${slot} keeps gridScale compatibility metadata`);
      assert.equal(getV3BuiltinPartVoxelScale(slot), exactVoxelScale, `${slot} should use the shared exact-source voxel scale`);
      assert.equal(
        partGroups[slot].userData.v3BuiltInSourceKind,
        'exact-obj',
        `${slot} should report its active built-in source kind`
      );
      assert.equal(partGroups[slot].userData.v3ReferenceGlbSource, false, `${slot} should not expose regenerated GLB as visible source metadata`);
      assert.equal(partGroups[slot].userData.v3ObjSurfaceSource, true, `${slot} should expose OBJ source metadata as active`);
      assert.equal(partGroups[slot].userData.v3VoxelScale, exactVoxelScale, `${slot} runtime group should use shared exact-source voxel scale`);
    }
  });

  it('defaults built-in V3 rendering to runtime LOD while preserving explicit exact source inspection', () => {
    const runtimeModel = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      v3QualityTier: 'desktop',
    });
    const exactModel = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      v3QualityTier: 'desktop',
      v3SourceFidelity: 'exact',
    });
    const runtimeHelmet = runtimeModel.userData.v3PartGroups.helmet as THREE.Group;
    const exactHelmet = exactModel.userData.v3PartGroups.helmet as THREE.Group;
    const expectedRuntimeBudget = deriveV3ExactSourceSlotBudget('helmet', {
      qualityTier: 'desktop',
      sourceFidelity: 'runtimeLod',
    });
    const expectedExactBudget = deriveV3ExactSourceSlotBudget('helmet', {
      qualityTier: 'desktop',
      sourceFidelity: 'exact',
    });

    assert.equal(runtimeModel.userData.v3SourceFidelity, 'runtimeLod');
    assert.equal(runtimeHelmet.userData.v3SourceFidelity, 'runtimeLod');
    assert.equal(runtimeHelmet.userData.v3SelectedLod.budget.sourceVoxelCount, expectedRuntimeBudget.sourceVoxelCount);
    assert.equal(runtimeHelmet.userData.v3SelectedLod.budget.mergedBoxCount, expectedRuntimeBudget.mergedBoxCount);
    assert.ok(runtimeHelmet.userData.v3SelectedLod.budget.sourceVoxelCount < expectedExactBudget.sourceVoxelCount);

    assert.equal(exactModel.userData.v3SourceFidelity, 'exact');
    assert.equal(exactHelmet.userData.v3SourceFidelity, 'exact');
    assert.equal(exactHelmet.userData.v3SelectedLod.budget.sourceVoxelCount, expectedExactBudget.sourceVoxelCount);
  });

  it('keys built-in V3 geometry cache by resolved default palette', () => {
    clearV3GeometryCache();
    const friendlyModel = buildV3SpartanModel({ isEnemy: false });
    const enemyModel = buildV3SpartanModel({ isEnemy: true });

    assert.equal(groupContainsHexColor(friendlyModel, '#3b82f6'), true);
    assert.equal(groupContainsHexColor(enemyModel, '#ef4444'), true);
    assert.equal(groupContainsHexColor(enemyModel, '#3b82f6'), false);
  });

  it('renders V3 character armor through the armor surface renderer by default', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

    assert.equal(model.userData.v3ArmorRenderStyle, 'armorSurface');
    assert.equal(helmet.userData.v3ArmorRenderStyle, 'armorSurface');
    assert.equal(helmet.userData.v3PanelCornerStyle, 'clipped');
    assert.equal(helmet.userData.v3PanelDepthStyle, 'recessed');
    assert.ok(helmet.userData.v3ArmorSurface.panelCount > 0);
    assert.ok(helmet.userData.v3ArmorSurface.panelCount < helmet.userData.v3ArmorSurface.exposedFaceCount);
  });

  it('can preserve cube rendering for V3 voxel-edit previews', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192, v3ArmorRenderStyle: 'voxelEdit' });
    const chest = model.userData.v3PartGroups.chest as THREE.Group;

    assert.equal(model.userData.v3ArmorRenderStyle, 'voxelEdit');
    assert.equal(chest.userData.v3ArmorRenderStyle, 'voxelEdit');
    assert.equal(chest.userData.v3PanelCornerStyle, 'square');
    assert.equal(chest.userData.v3PanelDepthStyle, 'flush');
    assert.equal(chest.userData.v3ArmorSurface.renderStyle, 'voxelEdit');
  });

  it('keeps built-in V3 armor inside locked sleek shape-language gates', () => {
    const reports = analyzeV3BuiltInShapeLanguage();

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const issues = reports[slot].issues.filter((issue) => !(
        (slot === 'back' || slot === 'chest') &&
        issue.code === 'torso-depth-ratio-high'
      ));
      assert.deepEqual(issues, [], `${slot} shape-language issues`);
    }
  });

  it('builds reference-inspired V3 detail bones for procedural armor fit', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const armorSlotRoot = model.userData.v3ArmorSlotRoot as THREE.Group;

    for (const boneName of [
      'pelvis',
      'spine1',
      'spine2',
      'spine3',
      'chest',
      'neck',
      'head',
      'helmet',
      'backpack',
      'clavicleLeft',
      'upperArmLeft',
      'forearmLeft',
      'handLeft',
      'gripLeft',
      'clavicleRight',
      'upperArmRight',
      'forearmRight',
      'handRight',
      'gripRight',
      'thighLeft',
      'calfLeft',
      'footLeft',
      'toeLeft',
      'thighRight',
      'calfRight',
      'footRight',
      'toeRight',
    ]) {
      assert.ok(detailBones[boneName] instanceof THREE.Group, `missing detail bone ${boneName}`);
      assert.equal(detailBones[boneName].userData.v3DetailBoneName, boneName);
    }

    assert.equal(model.userData.v3Mesh2MotionSkeletonRoot.parent, model);
    assert.equal(armorSlotRoot.parent, model);
    for (const slot of ['helmet', 'chest', 'forearmLeft', 'handRight', 'shinLeft', 'footRight', 'back'] as const) {
      const detailBone = detailBones[V3_SLOT_DETAIL_BONES[slot]];
      const slotPivot = partGroups[slot];
      const geometry = slotPivot.userData.v3Mesh2MotionSlotGeometry as THREE.Group;

      assert.equal(slotPivot.parent, armorSlotRoot);
      assert.equal(slotPivot.userData.v3Mesh2MotionSlotPivot, true);
      assert.equal(slotPivot.userData.v3Mesh2MotionPlacementAuthority, 'mesh2motion-tpose');
      assert.equal(slotPivot.userData.v3LegacyDetailBone, V3_SLOT_DETAIL_BONES[slot]);
      assert.equal(geometry.parent, slotPivot);
      assert.equal(detailBone.userData.v3Mesh2MotionSlotPivot, slotPivot);
      assert.equal(detailBone.userData.v3Mesh2MotionSlotGeometry, geometry);
    }
  });

  it('rebases built-in V3 detail bones while binding exact-source geometry to Mesh2Motion pivots', () => {
    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      v3ArmorRenderStyle: 'voxelEdit',
      v3SourceFidelity: 'exact',
    });
    const report = analyzeV3CanonicalRigContract(model);
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const partGeometryGroups = model.userData.v3PartGeometryGroups as Record<string, THREE.Group>;
    const contract = model.userData.v3CanonicalRigContract;
    const voxelScale = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;

    assert.equal(report.ready, true, report.issues.join('; '));
    assert.equal(contract.sourceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const detailBone = detailBones[V3_SLOT_DETAIL_BONES[slot]];
      const pivot = contract.slotPivots[slot].position as [number, number, number];
      const boneWorld = detailBone.getWorldPosition(new THREE.Vector3()).toArray();
      assert.equal(tupleCloseTo(boneWorld, pivot, 0.00001), true, `${slot} detail bone should use canonical pivot`);

      const boxCenter = getWorldBox(partGroups[slot]).getCenter(new THREE.Vector3()).toArray();
      const geometryCenter = contract.slotGeometryOffsets[slot].geometryCenter as [number, number, number];
      if (V3_LIMB_CHAIN_BINDING_TEST_SLOT_SET.has(slot)) {
        const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
        const mesh2MotionPivot = foundationSlot.mesh2MotionPivotWorldPosition;
        const slotPivot = getObjectWorldPosition(partGroups[slot]).toArray();
        const sourceBindOffset = new THREE.Vector3(...foundationSlot.exactSourceBindOffset);
        const geometryBindPoint = partGeometryGroups[slot].localToWorld(sourceBindOffset).toArray();
        assert.equal(
          tupleCloseTo(slotPivot, mesh2MotionPivot, 0.00001),
          true,
          `${slot} visible slot pivot should stay on the generated Mesh2Motion pivot`
        );
        assert.equal(
          tupleCloseTo(geometryBindPoint, mesh2MotionPivot, 0.00001),
          true,
          `${slot} exact-source bind point should bind to the generated Mesh2Motion pivot`
        );
      } else {
        assert.equal(
          tupleCloseTo(boxCenter, geometryCenter, voxelScale * 2.5),
          true,
          `${slot} exact-source geometry shifted from canonical source center`
        );
      }
      assert.equal(partGroups[slot].userData.v3CanonicalSlotPivot, contract.slotPivots[slot]);
      assert.equal(partGroups[slot].userData.v3CanonicalSlotGeometryOffset, contract.slotGeometryOffsets[slot]);
    }
  });

  it('binds exact-source limb armor geometry to Mesh2Motion pivots with generated slot orientation', () => {
    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      v3ArmorRenderStyle: 'voxelEdit',
      v3SourceFidelity: 'exact',
    });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const partGeometryGroups = model.userData.v3PartGeometryGroups as Record<string, THREE.Group>;

    for (const slot of V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS) {
      const slotPivot = partGroups[slot];
      const geometry = partGeometryGroups[slot];
      const pivotCenter = getObjectWorldPosition(slotPivot);
      const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
      const expectedBindPoint = new THREE.Vector3(...foundationSlot.mesh2MotionPivotWorldPosition);
      const sourceBindOffset = new THREE.Vector3(...V3_ARMOR_FOUNDATION.slots[slot].exactSourceBindOffset);
      const geometryBindPoint = geometry.localToWorld(sourceBindOffset.clone());

      assert.ok(slotPivot instanceof THREE.Group, `missing ${slot} slot pivot`);
      assert.ok(geometry instanceof THREE.Group, `missing ${slot} geometry group`);
      assert.ok(
        geometryBindPoint.distanceTo(expectedBindPoint) <= 0.00001,
        `${slot} source bind point should sit on Mesh2Motion pivot ${expectedBindPoint.toArray()}, got ${geometryBindPoint.toArray()}`
      );
      assert.ok(
        geometryBindPoint.distanceTo(pivotCenter) <= 0.00001,
        `${slot} source bind point should sit on its slot pivot ${pivotCenter.toArray()}, got ${geometryBindPoint.toArray()}`
      );
      assert.ok(
        pivotCenter.distanceTo(expectedBindPoint) <= 0.00001,
        `${slot} visible slot pivot should stay on generated Mesh2Motion pivot ${expectedBindPoint.toArray()}, got ${pivotCenter.toArray()}`
      );
      assert.equal(
        tupleCloseTo(geometry.position.toArray(), foundationSlot.mesh2MotionGeometry.position),
        true,
        `${slot} local binding offset`
      );
      assert.equal(
        tupleCloseTo(geometry.scale.toArray(), [1, 1, 1]),
        true,
        `${slot} scale should keep exact OBJ visual voxels in authoring scale`
      );
      const geometryWorldQuaternion = geometry.getWorldQuaternion(new THREE.Quaternion()).normalize();
      const expectedWorldQuaternion = expectedMesh2MotionWorldGeometryQuaternion(slot);
      assert.ok(
        geometryWorldQuaternion.angleTo(expectedWorldQuaternion) <= 0.0001,
        `${slot} exact OBJ voxels should preserve the generated Mesh2Motion visual slot orientation`
      );
    }
  });

  it('preserves exact OBJ limb slot dimensions while binding them to Mesh2Motion pivots', () => {
    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      v3ArmorRenderStyle: 'voxelEdit',
      v3SourceFidelity: 'exact',
    });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const voxelScale = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;

    for (const slot of V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS) {
      const renderedSize = getWorldSize(partGroups[slot]);
      const sourceSize = getExactObjSlotWorldSize(slot);

      assert.equal(
        tupleCloseTo(renderedSize.toArray(), sourceSize.toArray(), voxelScale * 1.5),
        true,
        `${slot} should keep exact OBJ source dimensions after Mesh2Motion binding; ` +
          `got ${renderedSize.toArray()}, expected ${sourceSize.toArray()}`
      );
    }
  });

  it('builds a V3 model with required combatant segment groups and manifest metadata', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });

    assert.equal(model.userData.modelSystem, 'v3');
    assert.equal(model.userData.v3CharacterLoadout.id, getDefaultV3CharacterLoadout().id);
    assert.deepEqual(Object.keys(model.userData.v3PartGroups).sort(), [...V3_CHARACTER_SLOT_IDS].sort());

    for (const key of requiredSegments) {
      assert.ok(model.userData[key] instanceof THREE.Group, `missing ${key}`);
    }
  });

  it('produces a visible original blockout inside normalized gameplay scale', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());

    assert.ok(size.x > 0.5 && size.x < 2.2, `unexpected width ${size.x}`);
    assert.ok(size.y > 1.2 && size.y < 2.8, `unexpected height ${size.y}`);
    assert.ok(size.z > 0.25 && size.z < 1.8, `unexpected depth ${size.z}`);
  });

  it('builds readable exact-source slot silhouettes without old part-box remapping', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const chestSize = getWorldBox(partGroups.chest).getSize(new THREE.Vector3());
    const pelvisSize = getWorldBox(partGroups.pelvis).getSize(new THREE.Vector3());
    const forearmSize = getWorldBox(partGroups.forearmRight).getSize(new THREE.Vector3());
    const handSize = getWorldBox(partGroups.handRight).getSize(new THREE.Vector3());

    assert.ok(chestSize.x > 0.3, `chest should stay visible from exact source (${chestSize.x})`);
    assert.ok(pelvisSize.x > 0.25, `pelvis should stay visible from exact source (${pelvisSize.x})`);
    assert.ok(forearmSize.x > 0.1 && forearmSize.z > 0.12, `forearm should stay visible from exact OBJ source (${forearmSize.x}, ${forearmSize.z})`);
    assert.ok(handSize.x > 0.08 && handSize.z > 0.15, `hand should stay visible from calibrated exact source (${handSize.x}, ${handSize.z})`);
    assert.equal(
      partGroups.chest.userData.v3ObjSurfaceSource,
      true,
      'built-in exact-source chest should render from the restored OBJ body source without old part-box remapping'
    );
  });

  it('keeps default V3 undersuit visibly separated from the bind editor background', () => {
    const chest = getV3BuiltinPartVoxels('chest');
    const colors = new Set(chest.map((voxel) => voxel.color));

    assert.ok(
      colors.has('#2f3f52'),
      'default V3 chest should include the readable undersuit base color'
    );
    assert.ok(
      maxHexColorChannel('#2f3f52') - maxHexColorChannel('#061116') >= 0x30,
      'default V3 undersuit should not visually collapse into the bind editor background'
    );
  });

  it('builds a Mesh2Motion-fitted featureless base body under the exact armor suit', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    assert.equal(baseBody.root.visible, true, 'rig-fitted dummy base body should be visible under the armor');
    assert.equal(baseBody.root.userData.v3RigFittedBaseBody, true);
    assert.equal(
      Object.keys(baseBody.segments ?? {}).length,
      48,
      'rig-fitted dummy base body should include torso, limbs, palms, feet, head, and 30 finger capsules'
    );

    for (const segmentId of V3_RIG_FITTED_SEGMENTS) {
      const segment = baseBody.segments?.[segmentId];
      assert.ok(segment instanceof THREE.Mesh, `${segmentId} dummy body segment should exist`);
      assert.equal(segment.visible, true, `${segmentId} dummy body segment should be visible`);
      assert.equal(segment.userData.v3RigFittedBaseBodySegment, true);
      assertFiniteWorldTransform(segment, `${segmentId} dummy body segment`);
      const material = segment.material;
      assert.ok(material instanceof THREE.MeshStandardMaterial, `${segmentId} should use an inspectable dummy material`);
      assert.ok(
        maxHexColorChannel(`#${material.color.getHexString()}`) <= 0x5f,
        `${segmentId} dummy material should stay visually subordinate to armor instead of reading as gray helper geometry`
      );
    }

    const torsoBox = getWorldBox(baseBody.segments.torso);
    const neckBox = getWorldBox(baseBody.segments.neck);
    const pelvisBodyBox = getWorldBox(baseBody.segments.pelvis);
    const chestBox = getWorldBox(partGroups.chest);
    const backBox = getWorldBox(partGroups.back);
    const neckArmorBox = getWorldBox(partGroups.neck);
    const pelvisArmorBox = getWorldBox(partGroups.pelvis);
    const sideProfileCore = new THREE.Vector3(
      chestBox.getCenter(new THREE.Vector3()).x,
      chestBox.getCenter(new THREE.Vector3()).y,
      (chestBox.getCenter(new THREE.Vector3()).z + backBox.getCenter(new THREE.Vector3()).z) / 2
    );

    assert.equal(torsoBox.containsPoint(sideProfileCore), true, 'dummy torso should occupy the chest/back interior cavity');
    assert.equal(torsoBox.intersectsBox(chestBox), true, 'dummy torso should sit inside the chest armor shell');
    assert.equal(torsoBox.intersectsBox(backBox), true, 'dummy torso should sit inside the back armor shell');
    assert.equal(neckBox.intersectsBox(neckArmorBox), true, 'dummy neck should sit inside the neck armor shell');
    assert.equal(pelvisBodyBox.intersectsBox(pelvisArmorBox), true, 'dummy pelvis should sit inside the pelvis armor shell');

    for (const side of ['Left', 'Right'] as const) {
      const handBodyBox = getWorldBox(baseBody.segments[`hand${side}`]);
      const footBodyBox = getWorldBox(baseBody.segments[`foot${side}`]);

      assert.equal(handBodyBox.intersectsBox(getWorldBox(partGroups[`hand${side}`])), true);
      assert.equal(footBodyBox.intersectsBox(getWorldBox(partGroups[`foot${side}`])), true);
      assert.ok(
        baseBody.segments[`shoulder${side}`].scale.x <= 0.1 &&
          baseBody.segments[`shoulder${side}`].scale.z <= 0.11,
        `${side} dummy shoulder should stay under the shoulder armor cap instead of becoming a smooth shoulder pad`
      );
      assert.ok(
        baseBody.segments[`upperArm${side}`].scale.x <= 0.14 &&
          baseBody.segments[`upperArm${side}`].scale.z <= 0.15,
        `${side} dummy upper arm should be an inner body limb, not a second outer armor sleeve`
      );
      assert.ok(
        baseBody.segments[`forearm${side}`].scale.x <= 0.12 &&
          baseBody.segments[`forearm${side}`].scale.z <= 0.13,
        `${side} dummy forearm should stay visibly subordinate to the armor`
      );
    }
  });

  it('fits every Mesh2Motion finger chain with a matching mannequin capsule', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { segmentId, fromJoint, toJoint } of V3_RIG_FITTED_FINGER_CHAINS) {
      const segment = baseBody.segments?.[segmentId];
      assert.ok(segment instanceof THREE.Mesh, `${segmentId} finger mannequin capsule should exist`);
      assert.equal(segment.visible, true, `${segmentId} finger mannequin capsule should be visible`);

      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedLength = from.distanceTo(to);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(segment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(segment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = segment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.004,
        `${segmentId} midpoint should match ${fromJoint}->${toJoint} joint midpoint`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.999,
        `${segmentId} direction should follow ${fromJoint}->${toJoint} joint direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.003,
        `${segmentId} length should match ${fromJoint}->${toJoint} joint distance`
      );
    }
  });

  it('keeps palm hubs compact so the mannequin fingers read as separate chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'handLeft', handJoint: 'hand_l', suffix: 'l' },
      { side: 'Right', segmentId: 'handRight', handJoint: 'hand_r', suffix: 'r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, handJoint, suffix } of sideCases) {
      const handSegment = baseBody.segments?.[segmentId];
      assert.ok(handSegment instanceof THREE.Mesh, `${side} palm hub should exist`);
      const handCenter = getObjectWorldPosition(handSegment);
      const handJointPosition = getMesh2MotionJointWorldPosition(model, handJoint);
      const handSize = getWorldSize(handSegment);
      const handBox = getWorldBox(handSegment);

      assert.ok(
        handCenter.distanceTo(handJointPosition) <= 0.04,
        `${side} palm hub should stay anchored near ${handJoint}, not the full glove envelope`
      );
      assert.ok(
        handSize.x <= 0.085 && handSize.y <= 0.075 && handSize.z <= 0.085,
        `${side} palm hub should stay compact instead of swallowing the fingers (${handSize.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
      for (const fingerName of V3_RIG_FITTED_FINGERS) {
        const knuckle = getMesh2MotionJointWorldPosition(model, `${fingerName}_01_${suffix}`);
        assert.equal(
          handBox.containsPoint(knuckle),
          false,
          `${side} palm hub should not contain ${fingerName}_01_${suffix}; fingers need to read as separate chains`
        );
      }
    }
  });

  it('keeps palm hubs wrist-side and aimed at the Mesh2Motion finger fan', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'handLeft', handJoint: 'hand_l', suffix: 'l' },
      { side: 'Right', segmentId: 'handRight', handJoint: 'hand_r', suffix: 'r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, handJoint, suffix } of sideCases) {
      const handSegment = baseBody.segments?.[segmentId];
      assert.ok(handSegment instanceof THREE.Mesh, `${side} palm hub should exist`);

      const handPosition = getMesh2MotionJointWorldPosition(model, handJoint);
      const firstKnuckles = V3_RIG_FITTED_FINGERS.map((fingerName) =>
        getMesh2MotionJointWorldPosition(model, `${fingerName}_01_${suffix}`)
      );
      const knuckleCenter = firstKnuckles
        .reduce((sum, position) => sum.add(position), new THREE.Vector3())
        .multiplyScalar(1 / firstKnuckles.length);
      const expectedDirection = knuckleCenter.clone().sub(handPosition).normalize();
      const palmForward = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(handSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const palmCenterProjection = getObjectWorldPosition(handSegment)
        .sub(handPosition)
        .dot(expectedDirection);
      const palmForwardReach = palmCenterProjection + handSegment.getWorldScale(new THREE.Vector3()).x * 0.5;
      const nearestKnuckleDistance = Math.min(
        ...firstKnuckles.map((knuckle) => handPosition.distanceTo(knuckle))
      );

      assert.ok(
        palmForward.dot(expectedDirection) >= 0.995,
        `${side} palm hub should aim from ${handJoint} toward the first-knuckle cluster`
      );
      assert.ok(
        palmCenterProjection <= 0.001,
        `${side} palm hub should sit on the wrist side of ${handJoint}, not protrude into the finger bases`
      );
      assert.ok(
        palmForwardReach <= nearestKnuckleDistance * 0.35,
        `${side} palm hub should leave room for separate finger roots instead of overlapping them`
      );
    }
  });

  it('keeps the mannequin neck as a slim Mesh2Motion connector instead of a chest-front blob', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    const neckSegment = baseBody.segments?.neck;
    assert.ok(neckSegment instanceof THREE.Mesh, 'neck mannequin connector should exist');
    const neckBase = getMesh2MotionJointWorldPosition(model, 'neck_01');
    const headBase = getMesh2MotionJointWorldPosition(model, 'head');
    const expectedMidpoint = neckBase.clone().add(headBase).multiplyScalar(0.5);
    const expectedLength = neckBase.distanceTo(headBase);
    const actualMidpoint = getObjectWorldPosition(neckSegment);
    const actualWorldScale = neckSegment.getWorldScale(new THREE.Vector3());

    assert.ok(
      actualMidpoint.distanceTo(expectedMidpoint) <= 0.025,
      'neck mannequin connector should stay centered on the Mesh2Motion neck_01->head chain'
    );
    assert.ok(
      actualWorldScale.x <= 0.09 && actualWorldScale.z <= 0.085,
      `neck mannequin connector should stay slim instead of becoming a collar blob (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
    );
    assert.ok(
      Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.02,
      'neck mannequin connector length should follow the Mesh2Motion neck_01->head joint distance'
    );
  });

  it('keeps the mannequin head centered on the Mesh2Motion head chain instead of the helmet envelope', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    const headSegment = baseBody.segments?.head;
    assert.ok(headSegment instanceof THREE.Mesh, 'head mannequin segment should exist');
    const headBase = getMesh2MotionJointWorldPosition(model, 'head');
    const headLeaf = getMesh2MotionJointWorldPosition(model, 'head_leaf');
    const expectedMidpoint = headBase.clone().add(headLeaf).multiplyScalar(0.5);
    const actualMidpoint = getObjectWorldPosition(headSegment);
    const actualWorldScale = headSegment.getWorldScale(new THREE.Vector3());

    assert.ok(
      actualMidpoint.distanceTo(expectedMidpoint) <= 0.035,
      'head mannequin segment should stay centered on the Mesh2Motion head->head_leaf chain'
    );
    assert.ok(
      actualWorldScale.x <= 0.165 && actualWorldScale.y <= 0.18 && actualWorldScale.z <= 0.165,
      `head mannequin segment should be a compact blank head, not a helmet-sized blob (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
    );
    assert.ok(
      actualMidpoint.y + actualWorldScale.y * 0.5 <= headLeaf.y + 0.11,
      'head mannequin segment should not float far above the Mesh2Motion head leaf'
    );
  });

  it('keeps the mannequin head aimed along the live Mesh2Motion head chain after joint poses', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const headJoint = getMesh2MotionJointObject(model, 'head');
    headJoint.rotation.x = 0.42;
    headJoint.rotation.z = -0.18;
    model.updateWorldMatrix(true, true);
    updateV3RigFittedBaseBody(model);
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    const headSegment = baseBody.segments?.head;
    assert.ok(headSegment instanceof THREE.Mesh, 'head mannequin segment should exist');
    const headBase = getMesh2MotionJointWorldPosition(model, 'head');
    const headLeaf = getMesh2MotionJointWorldPosition(model, 'head_leaf');
    const expectedDirection = headLeaf.clone().sub(headBase).normalize();
    const actualDirection = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(headSegment.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();

    assert.ok(
      actualDirection.dot(expectedDirection) >= 0.999,
      'head mannequin segment should rotate with the live Mesh2Motion head->head_leaf direction'
    );
  });

  it('keeps the mannequin torso as a slim Mesh2Motion spine trunk instead of a chest-front blob', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    const torsoSegment = baseBody.segments?.torso;
    assert.ok(torsoSegment instanceof THREE.Mesh, 'torso mannequin segment should exist');
    const spineBase = getMesh2MotionJointWorldPosition(model, 'spine_01');
    const spineTop = getMesh2MotionJointWorldPosition(model, 'neck_01');
    const expectedMidpoint = spineBase.clone().add(spineTop).multiplyScalar(0.5);
    const expectedLength = spineBase.distanceTo(spineTop);
    const expectedDirection = spineTop.clone().sub(spineBase).normalize();
    const actualMidpoint = getObjectWorldPosition(torsoSegment);
    const actualDirection = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(torsoSegment.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const actualWorldScale = torsoSegment.getWorldScale(new THREE.Vector3());
    const torsoBox = getWorldBox(torsoSegment);
    const chestBox = getWorldBox(partGroups.chest);
    const backBox = getWorldBox(partGroups.back);

    assert.ok(
      actualMidpoint.distanceTo(expectedMidpoint) <= 0.025,
      'torso mannequin segment should stay centered on the Mesh2Motion spine_01->neck_01 chain'
    );
    assert.ok(
      actualDirection.dot(expectedDirection) >= 0.998,
      'torso mannequin segment should follow the Mesh2Motion spine direction'
    );
    assert.ok(
      Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.025,
      'torso mannequin segment length should follow the Mesh2Motion spine joint distance'
    );
    assert.ok(
      actualWorldScale.x <= 0.17 && actualWorldScale.z <= 0.135,
      `torso mannequin segment should be a slim inner trunk, not a round chest-front blob (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
    );
    assert.equal(torsoBox.intersectsBox(chestBox), true, 'torso trunk should still sit inside the chest armor shell');
    assert.equal(torsoBox.intersectsBox(backBox), true, 'torso trunk should still sit inside the back armor shell');
  });

  it('keeps the mannequin pelvis centered on Mesh2Motion hip joints instead of a foundation waist blob', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    const pelvisSegment = baseBody.segments?.pelvis;
    assert.ok(pelvisSegment instanceof THREE.Mesh, 'pelvis mannequin segment should exist');
    const hipJoints = ['pelvis', 'spine_01', 'thigh_l', 'thigh_r'].map((jointName) =>
      getMesh2MotionJointWorldPosition(model, jointName)
    );
    const expectedHipBox = new THREE.Box3().setFromPoints(hipJoints);
    const expectedMidpoint = expectedHipBox.getCenter(new THREE.Vector3());
    const actualMidpoint = getObjectWorldPosition(pelvisSegment);
    const actualWorldScale = pelvisSegment.getWorldScale(new THREE.Vector3());
    const pelvisBodyBox = getWorldBox(pelvisSegment);
    const pelvisArmorBox = getWorldBox(partGroups.pelvis);

    assert.ok(
      actualMidpoint.distanceTo(expectedMidpoint) <= 0.025,
      'pelvis mannequin segment should stay centered on the Mesh2Motion pelvis/spine/thigh joint cluster'
    );
    assert.ok(
      actualWorldScale.x <= 0.32 && actualWorldScale.y <= 0.17 && actualWorldScale.z <= 0.21,
      `pelvis mannequin segment should be a compact hip basin, not a broad waist blob (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
    );
    for (const [index, jointName] of ['pelvis', 'spine_01', 'thigh_l', 'thigh_r'].entries()) {
      assert.equal(
        pelvisBodyBox.containsPoint(hipJoints[index]),
        true,
        `pelvis mannequin segment should contain the Mesh2Motion ${jointName} hip connector`
      );
    }
    assert.equal(pelvisBodyBox.intersectsBox(pelvisArmorBox), true, 'pelvis body should still sit inside the pelvis armor shell');
  });

  it('keeps mannequin shoulders aligned to the Mesh2Motion clavicle-to-upperarm chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'shoulderLeft', fromJoint: 'clavicle_l', toJoint: 'upperarm_l' },
      { side: 'Right', segmentId: 'shoulderRight', fromJoint: 'clavicle_r', toJoint: 'upperarm_r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, fromJoint, toJoint } of sideCases) {
      const shoulderSegment = baseBody.segments?.[segmentId];
      assert.ok(shoulderSegment instanceof THREE.Mesh, `${side} shoulder mannequin segment should exist`);
      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedLength = from.distanceTo(to);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(shoulderSegment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(shoulderSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = shoulderSegment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.012,
        `${side} shoulder mannequin segment should stay centered on ${fromJoint}->${toJoint}`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.998,
        `${side} shoulder mannequin segment should follow the Mesh2Motion clavicle direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.012,
        `${side} shoulder mannequin segment length should follow the Mesh2Motion clavicle joint distance`
      );
      assert.ok(
        actualWorldScale.x <= 0.105 && actualWorldScale.z <= 0.11,
        `${side} shoulder mannequin segment should be a slim clavicle connector, not a shoulder armor blob (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
    }
  });

  it('keeps mannequin thighs aligned to the Mesh2Motion thigh-to-calf chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'thighLeft', fromJoint: 'thigh_l', toJoint: 'calf_l' },
      { side: 'Right', segmentId: 'thighRight', fromJoint: 'thigh_r', toJoint: 'calf_r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, fromJoint, toJoint } of sideCases) {
      const thighSegment = baseBody.segments?.[segmentId];
      assert.ok(thighSegment instanceof THREE.Mesh, `${side} thigh mannequin segment should exist`);
      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedLength = from.distanceTo(to);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(thighSegment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(thighSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = thighSegment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.014,
        `${side} thigh mannequin segment should stay centered on ${fromJoint}->${toJoint}`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.998,
        `${side} thigh mannequin segment should follow the Mesh2Motion upper-leg direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.014,
        `${side} thigh mannequin segment length should follow the Mesh2Motion upper-leg joint distance`
      );
      assert.ok(
        actualWorldScale.x <= 0.19 && actualWorldScale.z <= 0.18,
        `${side} thigh mannequin segment should be a body thigh, not a bulky armor envelope (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
    }
  });

  it('keeps mannequin upper arms aligned to the Mesh2Motion upperarm-to-lowerarm chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'upperArmLeft', fromJoint: 'upperarm_l', toJoint: 'lowerarm_l' },
      { side: 'Right', segmentId: 'upperArmRight', fromJoint: 'upperarm_r', toJoint: 'lowerarm_r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, fromJoint, toJoint } of sideCases) {
      const upperArmSegment = baseBody.segments?.[segmentId];
      assert.ok(upperArmSegment instanceof THREE.Mesh, `${side} upper-arm mannequin segment should exist`);
      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedLength = from.distanceTo(to);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(upperArmSegment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(upperArmSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = upperArmSegment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.012,
        `${side} upper-arm mannequin segment should stay centered on ${fromJoint}->${toJoint}`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.998,
        `${side} upper-arm mannequin segment should follow the Mesh2Motion upper-arm direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.012,
        `${side} upper-arm mannequin segment length should follow the Mesh2Motion upper-arm joint distance`
      );
      assert.ok(
        actualWorldScale.x <= 0.125 && actualWorldScale.z <= 0.13,
        `${side} upper-arm mannequin segment should be a body limb, not an upper-arm armor envelope (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
    }
  });

  it('keeps mannequin forearms aligned to the Mesh2Motion lowerarm-to-hand chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'forearmLeft', fromJoint: 'lowerarm_l', toJoint: 'hand_l' },
      { side: 'Right', segmentId: 'forearmRight', fromJoint: 'lowerarm_r', toJoint: 'hand_r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, fromJoint, toJoint } of sideCases) {
      const forearmSegment = baseBody.segments?.[segmentId];
      assert.ok(forearmSegment instanceof THREE.Mesh, `${side} forearm mannequin segment should exist`);
      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedLength = from.distanceTo(to);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(forearmSegment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(forearmSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = forearmSegment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.012,
        `${side} forearm mannequin segment should stay centered on ${fromJoint}->${toJoint}`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.998,
        `${side} forearm mannequin segment should follow the Mesh2Motion forearm direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.012,
        `${side} forearm mannequin segment length should follow the Mesh2Motion forearm joint distance`
      );
      assert.ok(
        actualWorldScale.x <= 0.105 && actualWorldScale.z <= 0.105,
        `${side} forearm mannequin segment should be a body limb, not a forearm armor envelope (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
    }
  });

  it('keeps mannequin shins aligned to the Mesh2Motion calf-to-foot chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'shinLeft', fromJoint: 'calf_l', toJoint: 'foot_l' },
      { side: 'Right', segmentId: 'shinRight', fromJoint: 'calf_r', toJoint: 'foot_r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, fromJoint, toJoint } of sideCases) {
      const shinSegment = baseBody.segments?.[segmentId];
      assert.ok(shinSegment instanceof THREE.Mesh, `${side} shin mannequin segment should exist`);
      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedLength = from.distanceTo(to);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(shinSegment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(shinSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = shinSegment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.012,
        `${side} shin mannequin segment should stay centered on ${fromJoint}->${toJoint}`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.998,
        `${side} shin mannequin segment should follow the Mesh2Motion lower-leg direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.012,
        `${side} shin mannequin segment length should follow the Mesh2Motion lower-leg joint distance`
      );
      assert.ok(
        actualWorldScale.x <= 0.15 && actualWorldScale.z <= 0.145,
        `${side} shin mannequin segment should be a slim lower leg, not a shin armor envelope (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
    }
  });

  it('keeps mannequin feet aligned to the Mesh2Motion foot-to-ball-leaf chains', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;
    const sideCases = [
      { side: 'Left', segmentId: 'footLeft', fromJoint: 'foot_l', toJoint: 'ball_leaf_l' },
      { side: 'Right', segmentId: 'footRight', fromJoint: 'foot_r', toJoint: 'ball_leaf_r' },
    ] as const;

    assert.ok(baseBody?.root instanceof THREE.Group, 'V3 model should expose a rig-fitted dummy base body');
    for (const { side, segmentId, fromJoint, toJoint } of sideCases) {
      const footSegment = baseBody.segments?.[segmentId];
      assert.ok(footSegment instanceof THREE.Mesh, `${side} foot mannequin segment should exist`);
      const from = getMesh2MotionJointWorldPosition(model, fromJoint);
      const to = getMesh2MotionJointWorldPosition(model, toJoint);
      const expectedMidpoint = from.clone().add(to).multiplyScalar(0.5);
      const expectedLength = from.distanceTo(to);
      const expectedDirection = to.clone().sub(from).normalize();
      const actualMidpoint = getObjectWorldPosition(footSegment);
      const actualDirection = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(footSegment.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const actualWorldScale = footSegment.getWorldScale(new THREE.Vector3());

      assert.ok(
        actualMidpoint.distanceTo(expectedMidpoint) <= 0.014,
        `${side} foot mannequin segment should stay centered on ${fromJoint}->${toJoint}`
      );
      assert.ok(
        actualDirection.dot(expectedDirection) >= 0.998,
        `${side} foot mannequin segment should follow the Mesh2Motion foot direction`
      );
      assert.ok(
        Math.abs(actualWorldScale.y * 2 - expectedLength) <= 0.014,
        `${side} foot mannequin segment length should follow the Mesh2Motion foot joint distance`
      );
      assert.ok(
        actualWorldScale.x <= 0.095 && actualWorldScale.z <= 0.08,
        `${side} foot mannequin segment should be a flat mannequin foot, not a round boot blob (${actualWorldScale.toArray().map((value) => value.toFixed(4)).join(', ')})`
      );
    }
  });

  it('keeps the rig-fitted mannequin alive when armor geometry is hidden for review', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const geometryGroups = model.userData.v3PartGeometryGroups as Record<V3CharacterSlotId, THREE.Group>;
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      geometryGroups[slot].visible = false;
    }

    updateV3RigFittedBaseBody(model, true);
    model.updateWorldMatrix(true, true);
    const baseBody = model.userData.v3RigFittedBaseBody as
      | { root?: THREE.Group; segments?: Record<string, THREE.Mesh> }
      | undefined;

    assert.ok(baseBody?.root instanceof THREE.Group, 'hidden-armor review should keep the mannequin root');
    assert.equal(baseBody.root.visible, true, 'hidden-armor review should not hide the mannequin root');
    for (const segmentId of ['torso', 'head', 'handLeft', 'handRight', 'thumbLeft01', 'indexRight03'] as const) {
      const segment = baseBody.segments?.[segmentId];
      assert.ok(segment instanceof THREE.Mesh, `${segmentId} should exist while armor geometry is hidden`);
      assert.equal(segment.visible, true, `${segmentId} should stay visible while armor geometry is hidden`);
      assertFiniteWorldTransform(segment, `${segmentId} hidden-armor review segment`);
    }
  });

  it('keeps legacy upper-body patch geometry bounded while the rig-fitted base body is visible', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const bridgeSet = model.userData.v3UpperBodyJointBridges as
      | { root?: THREE.Group; bridges?: Record<string, THREE.Mesh> }
      | undefined;
    const fillSet = model.userData.v3UpperBodyUndersuitFill as
      | { root?: THREE.Group; geometry?: THREE.Group }
      | undefined;

    assert.ok(bridgeSet?.root instanceof THREE.Group, 'V3 model should expose upper-body undersuit bridges');
    assert.equal(
      bridgeSet.root.visible,
      false,
      'legacy upper-body patch bridges should stay hidden now that the rig-fitted base body fills the mannequin volume'
    );
    assert.ok(fillSet?.root instanceof THREE.Group, 'V3 model should expose generated upper-body undersuit fill');
    assert.equal(
      fillSet.root.visible,
      false,
      'legacy upper-body OBJ fill should stay hidden now that the rig-fitted base body supplies the physical structure'
    );
    assert.ok(fillSet.geometry instanceof THREE.Group, 'generated upper-body undersuit fill should expose render geometry');
    assert.equal(
      tupleCloseTo(fillSet.root.scale.toArray(), [1, 1, 1]),
      true,
      'generated upper-body fill should use exact OBJ authoring scale instead of old Mesh2Motion GLB scale'
    );
    assert.equal(
      fillSet.geometry.userData.v3UpperBodyUndersuitFillSourceKind,
      'exact-obj',
      'generated upper-body fill should come from the accepted exact OBJ source'
    );
    assert.ok(
      Number(fillSet.geometry.userData.v3UpperBodyUndersuitFillSideProfileCoverage) >= 0.8,
      `generated upper-body fill should cover the accepted OBJ side silhouette, got ${
        fillSet.geometry.userData.v3UpperBodyUndersuitFillSideProfileCoverage
      }`
    );
    assert.ok(
      Number(fillSet.geometry.userData.v3UpperBodyUndersuitFillVoxelCount) > 4500,
      'generated upper-body fill should be a solid internal silhouette fill, not only copied surface undersuit voxels'
    );
    assert.ok(bridgeSet.bridges?.torsoCore instanceof THREE.Mesh, 'torso core bridge should exist');
    assert.equal(
      bridgeSet.bridges.torsoCore.geometry.type,
      'SphereGeometry',
      'torso core bridge should use a rounded undersuit volume instead of a rectangular slab'
    );
    assert.ok(bridgeSet.bridges?.upperYoke instanceof THREE.Mesh, 'upper yoke bridge should exist');
    assert.ok(bridgeSet.bridges?.backCollar instanceof THREE.Mesh, 'back collar bridge should exist');
    assert.ok(bridgeSet.bridges?.scapulaLeft instanceof THREE.Mesh, 'left scapula bridge should exist');
    assert.ok(bridgeSet.bridges?.scapulaRight instanceof THREE.Mesh, 'right scapula bridge should exist');
    assert.ok(bridgeSet.bridges?.clavicleLeft instanceof THREE.Mesh, 'left clavicle bridge should exist');
    assert.ok(bridgeSet.bridges?.clavicleRight instanceof THREE.Mesh, 'right clavicle bridge should exist');
    assert.ok(bridgeSet.bridges?.armpitLeft instanceof THREE.Mesh, 'left armpit socket bridge should exist');
    assert.ok(bridgeSet.bridges?.armpitRight instanceof THREE.Mesh, 'right armpit socket bridge should exist');
    for (const bridgeId of [
      'scapulaLeft',
      'scapulaRight',
      'clavicleLeft',
      'clavicleRight',
      'shoulderSleeveLeft',
      'shoulderSleeveRight',
      'armpitLeft',
      'armpitRight',
    ]) {
      assert.equal(
        bridgeSet.bridges[bridgeId].geometry.type,
        'BoxGeometry',
        `${bridgeId} should use blocky voxel-compatible bridge geometry instead of smooth tube fill`
      );
    }
    assert.equal(
      bridgeSet.bridges.armpitLeft.geometry.type,
      'BoxGeometry',
      'armpit socket bridges should read as blocky voxel undersuit seams, not smooth tube fill'
    );
    const bridgeMaterial = bridgeSet.bridges.torsoCore.material;
    assert.ok(bridgeMaterial instanceof THREE.MeshStandardMaterial, 'upper-body bridge material should be inspectable');
    assert.ok(
      bridgeMaterial.color.getHex() !== new THREE.Color('#061116').getHex(),
      'upper-body bridge material should not collapse into the bind editor background'
    );
    const bridgeSrgbChannels = bridgeMaterial.color
      .getHexString()
      .match(/../g)
      ?.map((channel) => Number.parseInt(channel, 16)) ?? [];
    const bindEditorBackground = new THREE.Color('#061116');
    const bridgeColorDistance = new THREE.Vector3(bridgeMaterial.color.r, bridgeMaterial.color.g, bridgeMaterial.color.b)
      .distanceTo(new THREE.Vector3(bindEditorBackground.r, bindEditorBackground.g, bindEditorBackground.b));
    assert.ok(
      Math.max(...bridgeSrgbChannels) <= 0x60,
      'upper-body bridge material should read as dark undersuit, not bright gray armor connectors'
    );
    assert.ok(
      bridgeColorDistance >= 0.12,
      'upper-body bridge material should remain distinct from the bind editor background'
    );

    const chestBox = getWorldBox(partGroups.chest);
    const backBox = getWorldBox(partGroups.back);
    const neckBox = getWorldBox(partGroups.neck);
    const upperTorsoTargetBox = chestBox.clone().union(backBox).union(neckBox);
    const upperTorsoTargetSize = upperTorsoTargetBox.getSize(new THREE.Vector3());
    const fillBox = getWorldBox(fillSet.root);
    const fillSize = fillBox.getSize(new THREE.Vector3());
    const torsoBridgeBox = getWorldBox(bridgeSet.bridges.torsoCore);
    const torsoBridgeSize = torsoBridgeBox.getSize(new THREE.Vector3());
    const upperYokeBox = getWorldBox(bridgeSet.bridges.upperYoke);
    const backCollarBox = getWorldBox(bridgeSet.bridges.backCollar);
    const scapulaLeftBox = getWorldBox(bridgeSet.bridges.scapulaLeft);
    const scapulaRightBox = getWorldBox(bridgeSet.bridges.scapulaRight);
    const armpitLeftBox = getWorldBox(bridgeSet.bridges.armpitLeft);
    const armpitRightBox = getWorldBox(bridgeSet.bridges.armpitRight);
    const shoulderLeftBox = getWorldBox(partGroups.shoulderLeft);
    const shoulderRightBox = getWorldBox(partGroups.shoulderRight);
    const upperArmLeftBox = getWorldBox(partGroups.upperArmLeft);
    const upperArmRightBox = getWorldBox(partGroups.upperArmRight);
    const sideProfileCore = new THREE.Vector3(
      chestBox.getCenter(new THREE.Vector3()).x,
      chestBox.getCenter(new THREE.Vector3()).y,
      (chestBox.getCenter(new THREE.Vector3()).z + backBox.getCenter(new THREE.Vector3()).z) / 2
    );
    const highBackProfileCore = new THREE.Vector3(
      chestBox.getCenter(new THREE.Vector3()).x,
      (neckBox.min.y + backBox.max.y) / 2,
      (neckBox.getCenter(new THREE.Vector3()).z + backBox.getCenter(new THREE.Vector3()).z) / 2
    );

    assert.equal(
      torsoBridgeBox.containsPoint(sideProfileCore),
      true,
      'torso core bridge should occupy the side-profile chest/back cavity'
    );
    assert.equal(fillBox.intersectsBox(chestBox), true, 'generated upper-body fill should overlap the chest shell');
    assert.equal(fillBox.intersectsBox(backBox), true, 'generated upper-body fill should overlap the back shell');
    assert.equal(fillBox.intersectsBox(neckBox), true, 'generated upper-body fill should overlap the neck shell');
    assert.ok(
      fillSize.y >= upperTorsoTargetSize.y * 0.95,
      `generated upper-body fill should span the exact OBJ torso height, got ${fillSize.y} vs target ${upperTorsoTargetSize.y}`
    );
    assert.ok(fillSize.z > 0.34, `generated upper-body fill should span the side-profile torso depth, got ${fillSize.z}`);
    assert.ok(fillSize.x > 0.28, `generated upper-body fill should span the inner torso width, got ${fillSize.x}`);
    assert.ok(
      fillBox.max.z <= chestBox.max.z - 0.035,
      `generated upper-body fill should stay behind the OBJ chest surface instead of duplicating it, got max z ${fillBox.max.z} vs chest ${chestBox.max.z}`
    );
    assert.ok(
      fillBox.min.z >= backBox.min.z + 0.035,
      `generated upper-body fill should stay in front of the OBJ back surface instead of duplicating it, got min z ${fillBox.min.z} vs back ${backBox.min.z}`
    );
    assert.ok(
      Math.abs(fillBox.max.y - Math.max(backBox.max.y, neckBox.max.y)) <= 0.01,
      `generated upper-body fill should align to the Mesh2Motion torso top, got ${fillBox.max.y}`
    );
    assert.ok(torsoBridgeSize.y > 0.36, `torso bridge should cover upper-body height, got ${torsoBridgeSize.y}`);
    assert.ok(torsoBridgeSize.z > 0.40, `torso bridge should cover side-profile depth, got ${torsoBridgeSize.z}`);
    assert.ok(
      torsoBridgeBox.max.y <= neckBox.max.y + 0.001,
      `torso bridge should stay below the head silhouette: ${torsoBridgeBox.max.y} > ${neckBox.max.y}`
    );
    assert.ok(
      torsoBridgeSize.x < chestBox.getSize(new THREE.Vector3()).x * 0.62,
      `torso bridge should stay inside the armor shell instead of becoming a front-view panel, got ${torsoBridgeSize.x}`
    );
    assert.equal(upperYokeBox.intersectsBox(chestBox), true, 'upper yoke bridge should overlap the chest shell');
    assert.ok(
      upperYokeBox.max.y < neckBox.min.y,
      `upper yoke bridge should not enter the neck/head silhouette: ${upperYokeBox.max.y} >= ${neckBox.min.y}`
    );
    assert.equal(
      backCollarBox.containsPoint(highBackProfileCore),
      true,
      'back collar bridge should occupy the high side-profile void between neck and back'
    );
    assert.ok(
      backCollarBox.max.y <= backBox.max.y + 0.001,
      `back collar bridge should stay inside the back plate height, got ${backCollarBox.max.y} > ${backBox.max.y}`
    );
    assert.ok(
      backCollarBox.getSize(new THREE.Vector3()).x < chestBox.getSize(new THREE.Vector3()).x * 0.5,
      'back collar bridge should be a compact neck/back connector, not a full shoulder-width slab'
    );
    assert.equal(scapulaLeftBox.intersectsBox(shoulderLeftBox), true, 'left scapula bridge should touch left shoulder shell');
    assert.equal(scapulaRightBox.intersectsBox(shoulderRightBox), true, 'right scapula bridge should touch right shoulder shell');
    assert.equal(scapulaLeftBox.intersectsBox(backBox), true, 'left scapula bridge should touch the upper back shell');
    assert.equal(scapulaRightBox.intersectsBox(backBox), true, 'right scapula bridge should touch the upper back shell');
    assert.equal(armpitLeftBox.intersectsBox(chestBox), true, 'left armpit socket should touch the chest shell');
    assert.equal(armpitRightBox.intersectsBox(chestBox), true, 'right armpit socket should touch the chest shell');
    assert.equal(armpitLeftBox.intersectsBox(shoulderLeftBox), true, 'left armpit socket should touch the shoulder shell');
    assert.equal(armpitRightBox.intersectsBox(shoulderRightBox), true, 'right armpit socket should touch the shoulder shell');
    assert.equal(armpitLeftBox.intersectsBox(upperArmLeftBox), true, 'left armpit socket should touch the upper-arm shell');
    assert.equal(armpitRightBox.intersectsBox(upperArmRightBox), true, 'right armpit socket should touch the upper-arm shell');
    assert.ok(
      armpitLeftBox.max.y >= shoulderLeftBox.getCenter(new THREE.Vector3()).y - 0.012 &&
        armpitRightBox.max.y >= shoulderRightBox.getCenter(new THREE.Vector3()).y - 0.012,
      'armpit socket seals should rise under the shoulder caps so side views do not see through the shoulder cavity'
    );
    assert.ok(
      armpitLeftBox.getSize(new THREE.Vector3()).x < chestBox.getSize(new THREE.Vector3()).x * 0.7 &&
        armpitRightBox.getSize(new THREE.Vector3()).x < chestBox.getSize(new THREE.Vector3()).x * 0.7,
      'armpit sockets should stay compact instead of becoming full-width torso panels'
    );
    assert.ok(
      armpitLeftBox.getSize(new THREE.Vector3()).z >= chestBox.getSize(new THREE.Vector3()).z * 0.72 &&
        armpitRightBox.getSize(new THREE.Vector3()).z >= chestBox.getSize(new THREE.Vector3()).z * 0.72,
      'armpit socket seals should cover enough side-profile depth to block background-colored shoulder holes'
    );
    assert.ok(
      armpitLeftBox.getSize(new THREE.Vector3()).z <= chestBox.getSize(new THREE.Vector3()).z * 0.86 &&
        armpitRightBox.getSize(new THREE.Vector3()).z <= chestBox.getSize(new THREE.Vector3()).z * 0.86,
      'armpit socket seals should stay bounded instead of becoming full-depth shoulder slabs'
    );
    assert.ok(
      bridgeSet.bridges.shoulderSleeveLeft.scale.x <= 0.052 &&
        bridgeSet.bridges.shoulderSleeveRight.scale.x <= 0.052 &&
        bridgeSet.bridges.shoulderSleeveLeft.scale.z <= 0.066 &&
        bridgeSet.bridges.shoulderSleeveRight.scale.z <= 0.066,
      'shoulder sleeve bridges should stay visually narrow instead of forming smooth shoulder masses'
    );
    assert.ok(
      Math.min(scapulaLeftBox.min.y, scapulaRightBox.min.y) > chestBox.getCenter(new THREE.Vector3()).y,
      'scapula bridges should cover the high shoulder/back void instead of only the lower torso'
    );
    assert.ok(
      scapulaLeftBox.getSize(new THREE.Vector3()).x <= 0.11 && scapulaRightBox.getSize(new THREE.Vector3()).x <= 0.11,
      'scapula bridges should be narrow undersuit struts instead of broad shoulder slabs'
    );
    assert.equal(bridgeSet.bridges.clavicleLeft.visible, false);
    assert.equal(bridgeSet.bridges.clavicleRight.visible, false);
  });

  it('uses the checked-in sanitized exact OBJ surface voxel source for built-in Aegis armor', () => {
    const serialized = JSON.stringify(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE);
    const summary = getV3AegisObjSurfaceSourceSummary();

    assert.equal(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.schemaVersion, 'v3-obj-surface-voxels/v1');
    assert.equal(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.options.targetHeightVoxels, 192);
    assert.equal(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.options.surfaceThicknessVoxels, 1);
    assert.equal(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.metrics.slotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(summary.totalVoxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.metrics.totalVoxelCount);
    assert.match(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(serialized.includes('G:\\'), false);
    assert.equal(serialized.includes('"triangles"'), false);
    assert.equal(serialized.includes('"objText"'), false);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.ok(V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot].voxelCount > 0, `${slot} exact source should not be empty`);
      assert.equal(getV3BuiltinPartGridScale(slot), 1);
    }
  });

  it('decodes exact OBJ source roles into painted V3 built-in voxels', () => {
    const helmet = getV3BuiltinPartVoxels('helmet', 192, V3_SCULPT_TEST_PAINT_JOB);
    const chest = getV3BuiltinPartVoxels('chest', 192, V3_SCULPT_TEST_PAINT_JOB);
    const back = getV3BuiltinPartVoxels('back', 192, V3_SCULPT_TEST_PAINT_JOB);

    assert.ok(helmet.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.emissive && voxel.emissive === true), 'helmet should preserve OBJ emissive detail');
    assert.ok(helmet.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.decal), 'helmet should preserve OBJ decal detail');
    assert.ok(chest.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.undersuit), 'chest should preserve rubber undersuit role');
    assert.ok(chest.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.primary), 'chest should preserve armor shell role');
    assert.ok(back.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.decal), 'backpack should preserve equipment decal role');
  });

  it('keeps generated paired lower-body slots independently decoded without synthetic mirroring', () => {
    const shinLeft = getV3BuiltinPartVoxels('shinLeft', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shinRight = getV3BuiltinPartVoxels('shinRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const leftBounds = getVoxelBounds(shinLeft);
    const rightBounds = getVoxelBounds(shinRight);

    assert.ok(shinLeft.length > 0);
    assert.ok(shinRight.length > 0);
    assert.ok(Math.abs(leftBounds.sizeY - rightBounds.sizeY) <= 2, `shin heights diverged (${leftBounds.sizeY} vs ${rightBounds.sizeY})`);
    assert.ok(Math.abs(leftBounds.sizeZ - rightBounds.sizeZ) <= 2, `shin depths diverged (${leftBounds.sizeZ} vs ${rightBounds.sizeZ})`);
    assert.notDeepEqual(
      V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.shinLeft.runs,
      V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.shinRight.runs,
      'exact source should preserve OBJ side data instead of fabricating mirrored runs'
    );
  });

  it('closes the focused rendered OBJ gate for built-in Aegis proportions', () => {
    const report = analyzeV3AegisReferenceProportions();
    const focusedIssues = getV3RenderedObjGateClosureIssues(report);

    assert.deepEqual(focusedIssues, [], formatV3ReferenceProportionGapSummary(report));
    assert.ok(report.summary.maxBandWidthDelta <= 0.57);
  });

  it('preserves lower helmet jaw and cheek width while keeping the Phase 35 crown taper', () => {
    const helmet = getV3BuiltinPartVoxels('helmet', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(helmet);
    const frontZ = bounds.maxZ;
    const crownRows = helmet.filter((voxel) => voxel.y >= bounds.maxY - 1);
    const lowerBandMinY = bounds.minY + Math.floor(bounds.sizeY * 0.12);
    const lowerBandMaxY = bounds.minY + Math.ceil(bounds.sizeY * 0.36);
    const lowerCheekAndJaw = helmet.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.visor &&
      voxel.y >= lowerBandMinY &&
      voxel.y <= lowerBandMaxY &&
      voxel.z >= frontZ - Math.max(4, Math.ceil(bounds.sizeZ * 0.14))
    );
    const sideEarArmor = helmet.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.visor &&
      (voxel.x <= bounds.minX + Math.ceil(bounds.sizeX * 0.14) || voxel.x >= bounds.maxX - Math.ceil(bounds.sizeX * 0.14)) &&
      voxel.y >= lowerBandMinY &&
      voxel.y <= lowerBandMaxY + 2 &&
      voxel.z <= frontZ - 2
    );

    assert.equal(getV3BuiltinPartGridScale('helmet'), 1);
    assert.ok(getVoxelXSpan(crownRows) <= Math.ceil(bounds.sizeX * 0.6), `helmet crown taper regressed to span ${getVoxelXSpan(crownRows)}`);
    assert.ok(getVoxelXSpan(lowerCheekAndJaw) >= Math.floor(bounds.sizeX * 0.25), `lower helmet cheek/jaw span should stay wide, got ${getVoxelXSpan(lowerCheekAndJaw)}`);
    assert.ok(sideEarArmor.length >= 100, `side-ear lower helmet armor is under-modeled (${sideEarArmor.length})`);
    assert.ok(helmet.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.emissive && voxel.emissive === true), 'helmet should preserve OBJ emissive voxels');
  });

  it('decodes the OBJ pelvis as a deep segmented source instead of procedural slab patches', () => {
    const pelvis = getV3BuiltinPartVoxels('pelvis', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(pelvis);
    const roles = new Set(pelvis.map((voxel) => voxel.color));
    const rearCoverage = pelvis.filter((voxel) => voxel.z === bounds.minZ).length / (bounds.sizeX * bounds.sizeY);

    assert.ok(bounds.sizeZ >= 41, `pelvis should preserve OBJ-derived depth, got depth ${bounds.sizeZ}`);
    assert.ok(bounds.sizeX >= 48, `pelvis should preserve OBJ-derived width, got width ${bounds.sizeX}`);
    assert.ok(roles.has(V3_SCULPT_TEST_COLORS.primary), 'pelvis should preserve armor shell role');
    assert.ok(roles.has(V3_SCULPT_TEST_COLORS.undersuit), 'pelvis should preserve undersuit role');
    assert.ok(rearCoverage <= 0.55, `pelvis rear should remain segmented, got coverage ${rearCoverage.toFixed(3)}`);
  });

  it('keeps exact OBJ shins deep and side-comparable after exact-source decoding', () => {
    const shinLeft = getV3BuiltinPartVoxels('shinLeft', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shinRight = getV3BuiltinPartVoxels('shinRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const leftBounds = getVoxelBounds(shinLeft);
    const rightBounds = getVoxelBounds(shinRight);

    assert.ok(rightBounds.sizeZ >= 30, `shin should preserve exact OBJ depth, got depth ${rightBounds.sizeZ}`);
    assert.ok(leftBounds.sizeZ >= 30, `left shin should preserve exact OBJ depth, got depth ${leftBounds.sizeZ}`);
    assert.ok(Math.abs(leftBounds.sizeX - rightBounds.sizeX) <= 3, `shin widths diverged (${leftBounds.sizeX} vs ${rightBounds.sizeX})`);
    assert.ok(Math.abs(leftBounds.sizeY - rightBounds.sizeY) <= 3, `shin heights diverged (${leftBounds.sizeY} vs ${rightBounds.sizeY})`);
    assert.ok(shinRight.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.decal), 'right shin should preserve OBJ knee/decal role');
    assert.ok(shinLeft.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.decal), 'left shin should preserve OBJ knee/decal role');
    assert.equal(hasNearFullHeightFrontColumn(shinRight), false, 'shin front should not grow full-height scaffolding columns');
  });

  it('keeps exact-source helmet and OBJ chest within normalized runtime fit bounds', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const helmetSize = getWorldBox(partGroups.helmet).getSize(new THREE.Vector3());
    const chestSize = getWorldBox(partGroups.chest).getSize(new THREE.Vector3());

    assert.ok(helmetSize.x > 0.24 && helmetSize.x < 0.34, `unexpected helmet width ${helmetSize.x}`);
    assert.ok(helmetSize.y > 0.22 && helmetSize.y < 0.31, `unexpected helmet height ${helmetSize.y}`);
    assert.ok(helmetSize.z > 0.3 && helmetSize.z < 0.4, `unexpected helmet depth ${helmetSize.z}`);
    assert.ok(chestSize.x > 0.4 && chestSize.x < 0.5, `unexpected chest width ${chestSize.x}`);
    assert.ok(chestSize.y > 0.24 && chestSize.y < 0.31, `unexpected chest height ${chestSize.y}`);
    assert.ok(chestSize.z > 0.2 && chestSize.z < 0.27, `unexpected chest depth ${chestSize.z}`);
  });

  it('generates resolved exact-source armor payloads with row-level silhouette variation', () => {
    const sculptedSlots = new Set([
      'helmet',
      'chest',
      'pelvis',
      'forearmLeft',
      'forearmRight',
      'shinLeft',
      'shinRight',
      'footLeft',
      'footRight',
      'back',
    ]);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const voxels = getV3BuiltinPartVoxels(slot, 192);
      const report = analyzeV3VoxelQuality(voxels);

      const sourceSlot = getExpectedV3BuiltinSourceSlot(slot);
      assert.ok(sourceSlot, `${slot} should have a resolved built-in source slot`);
      assert.equal(voxels.length, sourceSlot.voxelCount, `${slot} should decode every resolved source voxel`);
      assert.ok(voxels.length > 0, `${slot} should decode exact source voxels`);
      assert.ok(Number.isFinite(report.occupiedDimensions.x), `${slot} should have finite x dimensions`);
      assert.ok(Number.isFinite(report.occupiedDimensions.y), `${slot} should have finite y dimensions`);
      assert.ok(Number.isFinite(report.occupiedDimensions.z), `${slot} should have finite z dimensions`);

      if (sculptedSlots.has(slot)) {
        const variation = spanVariationByY(voxels);
        assert.ok(variation.x >= 2, `${slot} should vary horizontal silhouette across rows`);
        assert.ok(variation.z >= 2, `${slot} should vary depth silhouette across rows`);
      }
    }
  });

  it('keeps every high-density built-in armor part surface panel count under its manifest budget', () => {
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const voxels = getV3BuiltinPartVoxels(slot, 192);
      const manifest = getV3CharacterPartManifest(`ibv3-aegis-${slot}`);
      assert.ok(manifest, `missing manifest for ${slot}`);
      const surface = analyzeV3ArmorSurface(voxels);

      assert.ok(voxels.length <= manifest.budget.sourceVoxelCount, `${slot} source voxels exceed manifest budget`);
      assert.ok(surface.panelCount < surface.exposedFaceCount, `${slot} surface renderer should merge exposed faces`);
      assert.ok(surface.panelCount <= manifest.budget.mergedBoxCount, `${slot} panel count exceeds manifest merged budget`);
    }
  });

  it('remakes the V3 helmet as a high-density two-band visor, vents, jaw, cheek, and temple form', () => {
    const voxels = getV3BuiltinPartVoxels('helmet', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(voxels);
    const frontZ = getVoxelMaxZ(voxels);
    const visor = voxels.filter((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.visor && voxel.emissive === true);
    const lowerBandMinY = bounds.minY + Math.floor(bounds.sizeY * 0.12);
    const lowerBandMaxY = bounds.minY + Math.ceil(bounds.sizeY * 0.36);
    const centerX = Math.floor((bounds.minX + bounds.maxX) / 2);
    const crownVents = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.primary &&
      voxel.y >= bounds.minY + Math.floor(bounds.sizeY * 0.42) &&
      voxel.z < frontZ
    );
    const jawGuards = voxels.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.visor &&
      voxel.y >= lowerBandMinY &&
      voxel.y <= lowerBandMaxY &&
      voxel.z >= frontZ - Math.max(4, Math.ceil(bounds.sizeZ * 0.14))
    );
    const templeAccents = voxels.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.decal || voxel.color === V3_SCULPT_TEST_COLORS.emissive) &&
      voxel.y >= bounds.minY + Math.floor(bounds.sizeY * 0.28) &&
      voxel.y <= bounds.minY + Math.ceil(bounds.sizeY * 0.62)
    );
    const cheekPlates = voxels.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.visor &&
      voxel.y >= lowerBandMinY &&
      voxel.y <= lowerBandMaxY &&
      voxel.z >= frontZ - Math.max(4, Math.ceil(bounds.sizeZ * 0.14))
    );
    const foreheadLight = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.emissive &&
      voxel.emissive === true
    );

    assert.equal(getV3BuiltinPartGridScale('helmet'), 1);
    assert.ok(visor.length >= 1, 'OBJ helmet source should preserve the visor role bucket');
    assert.ok(foreheadLight.length >= 1, 'helmet needs preserved OBJ emissive detail');
    assert.ok(templeAccents.length >= 20, `expected temple/decal accents, found ${templeAccents.length}`);
    assert.ok(crownVents.length >= 1000, `expected OBJ-derived crown shell voxels, found ${crownVents.length}`);
    assert.ok(jawGuards.length >= 80, `expected lower jaw/cheek voxels, found ${jawGuards.length}`);
    assert.ok(cheekPlates.filter((voxel) => voxel.x < centerX - 1).length >= 30, 'left cheek plate is under-modeled');
    assert.ok(cheekPlates.filter((voxel) => voxel.x > centerX + 1).length >= 30, 'right cheek plate is under-modeled');
  });

  it('remakes the V3 chest as high-density pectorals, center core, abdomen, waist, and side locks', () => {
    const voxels = getV3BuiltinPartVoxels('chest', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(voxels);
    const centerX = Math.floor((bounds.minX + bounds.maxX) / 2);
    const frontZ = getVoxelMaxZ(voxels);
    const midBandY = bounds.minY + Math.floor(bounds.sizeY * 0.45);
    const upperBandY = bounds.minY + Math.floor(bounds.sizeY * 0.62);
    const pectoralPlates = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.primary &&
      voxel.y >= midBandY &&
      voxel.y <= bounds.maxY &&
      voxel.z >= frontZ - 5
    );
    const centerCore = voxels.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.decal || voxel.color === V3_SCULPT_TEST_COLORS.emissive) &&
      voxel.x >= centerX - 3 &&
      voxel.x <= centerX + 4 &&
      voxel.y >= bounds.minY + Math.floor(bounds.sizeY * 0.2) &&
      voxel.y <= bounds.maxY
    );
    const undersuitPanels = voxels.filter((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.undersuit);
    const sideLocks = voxels.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      (voxel.x <= bounds.minX + 3 || voxel.x >= bounds.maxX - 3) &&
      voxel.y >= bounds.minY + Math.floor(bounds.sizeY * 0.2) &&
      voxel.y <= bounds.minY + Math.ceil(bounds.sizeY * 0.88)
    );

    assert.equal(getV3BuiltinPartGridScale('chest'), 1);
    assert.ok(pectoralPlates.filter((voxel) => voxel.x < centerX - 2).length >= 150, 'left pectoral plate is under-modeled');
    assert.ok(pectoralPlates.filter((voxel) => voxel.x > centerX + 2).length >= 150, 'right pectoral plate is under-modeled');
    assert.ok(centerCore.length >= 4, `expected center decal/emissive core, found ${centerCore.length}`);
    assert.ok(undersuitPanels.length >= 1000, `expected OBJ undersuit coverage, found ${undersuitPanels.length}`);
    assert.ok(sideLocks.length >= 200, `expected side locking coverage, found ${sideLocks.length}`);
  });

  it('decodes every remaining V3 armor family from the resolved built-in source', () => {
    const familySlots: readonly (typeof V3_CHARACTER_SLOT_IDS)[number][] = [
      'neck',
      'shoulderLeft',
      'shoulderRight',
      'upperArmLeft',
      'upperArmRight',
      'forearmLeft',
      'forearmRight',
      'handLeft',
      'handRight',
      'thighLeft',
      'thighRight',
      'footLeft',
      'footRight',
      'back',
    ];

    for (const slot of familySlots) {
      const voxels = getV3BuiltinPartVoxels(slot, 192, V3_SCULPT_TEST_PAINT_JOB);
      const bounds = getVoxelBounds(voxels);
      const sourceSlot = getExpectedV3BuiltinSourceSlot(slot);
      const colors = new Set(voxels.map((voxel) => voxel.color));

      assert.ok(sourceSlot, `${slot} should have a resolved built-in source slot`);
      assert.equal(voxels.length, sourceSlot.voxelCount, `${slot} should decode resolved source voxel count`);
      assert.ok(bounds.sizeX > 0 && bounds.sizeY > 0 && bounds.sizeZ > 0, `${slot} should have occupied bounds`);
      assert.ok(colors.size >= 1, `${slot} should preserve at least one source role`);
      assert.ok(sourceSlot.runCount > 0, `${slot} should preserve compact run data`);
    }

    assert.ok(getV3BuiltinPartVoxels('back', 192, V3_SCULPT_TEST_PAINT_JOB).some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.decal), 'back should preserve equipment decal detail');
    assert.ok(getV3BuiltinPartVoxels('handRight', 192, V3_SCULPT_TEST_PAINT_JOB).some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.fixed), 'hands should preserve OBJ glove fixed material role');
  });

  it('segments remaining V3 built-in armor faces away from broad filled rectangles', () => {
    const limits: Partial<Record<(typeof V3_CHARACTER_SLOT_IDS)[number], number>> = {
      neck: 0.52,
      shoulderLeft: 0.44,
      shoulderRight: 0.44,
      footLeft: 0.5,
      footRight: 0.5,
      back: 0.55,
    };

    for (const [slot, limit] of Object.entries(limits)) {
      const coverage = getFrontFaceCoverage(getV3BuiltinPartVoxels(slot as (typeof V3_CHARACTER_SLOT_IDS)[number], 192));
      assert.ok(
        coverage <= limit,
        `${slot} front face should be segmented below ${limit}, got ${coverage.toFixed(3)}`
      );
    }
  });

  it('builds V3 custom armor pieces in place of matching built-in V3 parts', () => {
    const customHelmet = createCustomArmorSnapshot(createCustomArmorPiece(
      'helmet',
      'Test V3 Helmet',
      Array.from({ length: 130 }, (_, index) => ({
        x: index % 8,
        y: Math.floor(index / 8) % 8,
        z: Math.floor(index / 64),
        role: index % 11 === 0 ? 'visor' : 'primary',
        emissive: index % 11 === 0,
      })),
      'ibv3-aegis-helmet',
      undefined,
      'v3'
    ));

    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      loadout: { modelSystem: 'v3', customArmor: { helmet: customHelmet } },
    });
    const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

    assert.equal(helmet.userData.customArmorId, customHelmet.id);
    assert.equal(helmet.userData.v3Slot, 'helmet');
  });

  it('applies V3 role paint overrides to built-in character parts', () => {
    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      loadout: {
        modelSystem: 'v3',
        paintJob: {
          v3RoleColors: {
            primary: '#123456',
            decal: '#ff00ff',
          },
        },
      },
    });

    assert.equal(groupContainsHexColor(model, '#123456'), true);
    assert.equal(groupContainsHexColor(model, '#ff00ff'), true);
  });

  it('ignores V2 custom armor snapshots when building a V3 model', () => {
    const v2Helmet = createCustomArmorSnapshot(createCustomArmorPiece(
      'helmet',
      'V2 Helmet',
      Array.from({ length: 130 }, (_, index) => ({
        x: index % 4,
        y: 35 + Math.floor(index / 4) % 8,
        z: Math.floor(index / 32),
        role: 'primary' as const,
      }))
    ));

    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      loadout: { modelSystem: 'v3', customArmor: { helmet: v2Helmet } },
    });
    const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

    assert.equal(helmet.userData.customArmorId, undefined);
    assert.equal(helmet.userData.v3PartId, 'ibv3-aegis-helmet');
  });

  it('generates exact built-in character part voxel payloads without empty or non-finite slots', () => {
    const requiredEmissiveSlots = new Set(['helmet', 'chest']);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const voxels = getV3BuiltinPartVoxels(slot, 192);
      const report = analyzeV3VoxelQuality(voxels);

      assert.ok(voxels.length > 0, `${slot} should decode exact OBJ source voxels`);
      assert.ok(report.occupiedDimensions.x > 0, `${slot} should have occupied x span`);
      assert.ok(report.occupiedDimensions.y > 0, `${slot} should have occupied y span`);
      assert.ok(report.occupiedDimensions.z > 0, `${slot} should have occupied z span`);

      if (requiredEmissiveSlots.has(slot)) {
        assert.equal(report.emissiveVoxelCount > 0, true, `${slot} should include readable emissive detail`);
      }
    }
  });

  it('applies exact-source rig binding metadata to built-in V3 Spartans without reshaping the source', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const report = analyzeV3RigContinuity(model);

    assert.equal(model.userData.v3ExactSourceRigBinding?.sourceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);
    assert.equal(report.ready, true);
    assert.equal(report.boundSlotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(report.issues.length, 0);
  });
});

describe('V3 weapon builders', () => {
  it('builds every V3 weapon with manifest id, weapon type, lod, and socket metadata', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const manifest = getDefaultV3WeaponManifest(weapon);

      assert.equal(model.userData.modelSystem, 'v3');
      assert.equal(model.userData.weaponType, weapon);
      assert.equal(model.userData.v3ManifestId, manifest.id);
      assert.equal(model.userData.v3Sockets.length, manifest.sockets.length);
      assert.ok(model.children.length > 0, `${weapon} should render geometry`);
    }
  });

  it('applies normalized V3 third-person weapon scale metadata to built weapons', () => {
    const canonicalBodyBounds = new THREE.Box3(
      new THREE.Vector3(-0.45, 0, -0.21),
      new THREE.Vector3(0.45, 1.8, 0.21)
    );
    const renderedBodyBounds = getWorldBox(buildV3SpartanModel({ isEnemy: false, customHue: 192 }));

    for (const weapon of V3_WEAPON_IDS) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const bodyBounds = weapon === 'hammer' || weapon === 'sword'
        ? renderedBodyBounds
        : canonicalBodyBounds;
      const report = analyzeV3WeaponScaleFit(model, bodyBounds, { weapon });

      assert.equal(model.userData.v3WeaponScaleProfile?.weapon, weapon);
      assert.equal(model.userData.v3WeaponScaleProfile?.modelSystem, 'v3');
      assert.equal(report.issues.some((issue) => issue.code === 'height-ratio-high'), false, `${weapon} height ratio`);
      assert.equal(report.issues.some((issue) => issue.code === 'hand-span-ratio-high'), false, `${weapon} hand span ratio`);
    }
  });

  it('scales recreated V3 hammer and katar against the actual rendered V3 body height', () => {
    const bodyHeight = getWorldSize(buildV3SpartanModel({ isEnemy: false, customHue: 192 })).y;
    const cases = [
      { weapon: 'hammer', targetRatio: 0.75 },
      { weapon: 'sword', targetRatio: 0.5 },
    ] as const;

    for (const { weapon, targetRatio } of cases) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const ratio = getWorldSize(model).y / bodyHeight;

      assert.ok(
        Math.abs(ratio - targetRatio) <= 0.015,
        `${weapon} rendered body ratio ${ratio.toFixed(6)} should be ${targetRatio}`
      );
    }
  });

  it('keeps recreated V3 hammer and katar grip zones within V3 hand-fit envelopes', () => {
    const hammer = getV3BuiltinWeaponVoxels('hammer', 192);
    const sword = getV3BuiltinWeaponVoxels('sword', 192);
    const hammerWorldVoxel = getWorldSize(buildV3WeaponModel('hammer', { customHue: 192 })).y / getVoxelBounds(hammer).sizeY;
    const swordWorldVoxel = getWorldSize(buildV3WeaponModel('sword', { customHue: 192 })).y / getVoxelBounds(sword).sizeY;
    const rowSpan = (voxels: VoxelData[], y: number, axis: 'x' | 'z'): number => {
      const values = voxels.filter((voxel) => voxel.y === y).map((voxel) => voxel[axis]);
      return values.length > 0 ? Math.max(...values) - Math.min(...values) + 1 : 0;
    };
    const hammerGripDiameter = Math.max(
      ...Array.from({ length: 14 }, (_, index) => index + 4)
        .map((y) => Math.max(rowSpan(hammer, y, 'x'), rowSpan(hammer, y, 'z')) * hammerWorldVoxel)
    );
    const swordGripDiameter = Math.max(
      ...Array.from({ length: 8 }, (_, index) => index + 1)
        .map((y) => Math.max(rowSpan(sword, y, 'x'), rowSpan(sword, y, 'z')) * swordWorldVoxel)
    );

    assert.ok(hammerGripDiameter >= 0.08, `hammer grip diameter ${hammerGripDiameter.toFixed(6)} too small`);
    assert.ok(hammerGripDiameter <= 0.14, `hammer grip diameter ${hammerGripDiameter.toFixed(6)} too large`);
    assert.ok(swordGripDiameter >= 0.07, `sword grip diameter ${swordGripDiameter.toFixed(6)} too small`);
    assert.ok(swordGripDiameter <= 0.13, `sword grip diameter ${swordGripDiameter.toFixed(6)} too large`);
  });

  it('recreates the V1 default katar as a centered tapered blade instead of twin prongs', () => {
    const sword = getV3BuiltinWeaponVoxels('sword', 192);
    const bounds = getVoxelBounds(sword);
    const bladeTipRows = Array.from({ length: 5 }, (_, index) => bounds.maxY - 4 + index);

    for (const y of bladeTipRows) {
      const row = sword.filter((voxel) => voxel.y === y);
      const xs = row.map((voxel) => voxel.x);
      const hasCenterBlade = xs.includes(0);
      const xSpan = Math.max(...xs) - Math.min(...xs) + 1;

      assert.equal(hasCenterBlade, true, `sword blade row ${y} should stay centered`);
      assert.ok(xSpan <= 3, `sword blade row ${y} should taper instead of splitting into prongs`);
    }
  });

  it('exports pistol-specific convenience builder', () => {
    assert.equal(buildV3PistolModel(192).userData.weaponType, 'pistol');
  });

  it('V3 weapon manifests include first-person socket metadata on built weapons', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const socketNames = model.userData.v3Sockets.map((socket: { name: string }) => socket.name);

      assert.ok(socketNames.includes('firstPersonPrimaryGrip'), `${weapon} missing first-person primary grip`);
      assert.ok(socketNames.includes('firstPersonOffhandGrip'), `${weapon} missing first-person offhand grip`);
    }
  });

  it('generates production-candidate built-in weapon voxel payloads', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const voxels = getV3BuiltinWeaponVoxels(weapon, 192);
      const report = analyzeV3VoxelQuality(voxels);

      assert.equal(
        classifyV3ProductionReadiness(report, V3_PRODUCTION_QUALITY_THRESHOLDS.weapon),
        'productionCandidate',
        `${weapon} should be richer than a blockout`
      );
      assert.equal(report.emissiveVoxelCount > 0, true, `${weapon} should expose readable emissive weapon state`);
    }
  });

  it('applies V3 role paint overrides to weapon builders', () => {
    const hammer = buildV3HammerModel(192, {
      loadout: {
        modelSystem: 'v3',
        paintJob: {
          v3RoleColors: {
            primary: '#345678',
            fixed: '#112233',
          },
        },
      },
    });

    assert.equal(groupContainsHexColor(hammer, '#345678'), true);
    assert.equal(groupContainsHexColor(hammer, '#112233'), true);
  });
});

describe('buildVoxelSpartanModel V3 dispatch', () => {
  it('preserves V1 and V2 dispatch while routing V3 separately', () => {
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v1' }).userData.modelSystem, undefined);
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v2' }).userData.modelSystem, 'v2');
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }).userData.modelSystem, 'v3');
  });

  it('passes V3 quality options into V3 builders', () => {
    const model = buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }, {
      v3QualityTier: 'mobileLow',
      v3Distance: 32,
    });

    assert.equal(model.userData.v3QualityTier, 'mobileLow');
    assert.equal(model.userData.v3Distance, 32);
  });

  it('createCombatantMeshRig uses V3 weapon builders for V3 loadouts', () => {
    const scene = new THREE.Scene();
    const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });

    assert.equal(meshes.group.userData.modelSystem, 'v3');
    assert.equal(meshes.hammer.userData.modelSystem, 'v3');
    assert.equal(meshes.sword.userData.modelSystem, 'v3');
    assert.equal(meshes.pistol?.userData.modelSystem, 'v3');
    assert.equal(meshes.hammer.userData.weaponType, 'hammer');
    assert.equal(meshes.sword.userData.weaponType, 'sword');
    assert.equal(meshes.pistol?.userData.weaponType, 'pistol');
  });

  it('createCombatantMeshRig passes V3 role paint into third-person weapons', () => {
    const scene = new THREE.Scene();
    const meshes = createCombatantMeshRig(scene, 192, false, {
      modelSystem: 'v3',
      paintJob: {
        v3RoleColors: {
          primary: '#456789',
        },
      },
    });

    assert.equal(groupContainsHexColor(meshes.hammer, '#456789'), true);
    assert.equal(groupContainsHexColor(meshes.sword, '#456789'), true);
    assert.equal(groupContainsHexColor(meshes.pistol as THREE.Group, '#456789'), true);
  });
});
