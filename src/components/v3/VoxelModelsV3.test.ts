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
import { V3_CHARACTER_SLOT_IDS, V3_WEAPON_IDS } from './v3ModelTypes';
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
import { analyzeV3CanonicalRigContract } from './v3CanonicalRigContract';
import {
  analyzeV3AegisReferenceProportions,
  formatV3ReferenceProportionGapSummary,
  getV3RenderedObjGateClosureIssues,
} from './v3ReferenceProportions';
import { deriveV3ExactSourceSlotBudget } from './v3ExactSourceLod';
import { V3_SLOT_DETAIL_BONES } from './v3RigDetail';

const requiredSegments = ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

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

const tupleCloseTo = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 0.000001
): boolean => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

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

  it('uses the exact OBJ surface voxel scale for every built-in V3 character part', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const exactVoxelScale = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.equal(getV3BuiltinPartGridScale(slot), 1, `${slot} keeps gridScale compatibility metadata`);
      assert.equal(getV3BuiltinPartVoxelScale(slot), exactVoxelScale, `${slot} should use exact OBJ voxel scale`);
      assert.equal(partGroups[slot].userData.v3ObjSurfaceSource, true, `${slot} should render from exact OBJ surface source`);
      assert.equal(partGroups[slot].userData.v3VoxelScale, exactVoxelScale, `${slot} runtime group should use exact OBJ voxel scale`);
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
        slot === 'back' &&
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

  it('rebases built-in V3 detail bones onto canonical anatomical slot pivots without shifting exact-source geometry', () => {
    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      v3ArmorRenderStyle: 'voxelEdit',
      v3SourceFidelity: 'exact',
    });
    const report = analyzeV3CanonicalRigContract(model);
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
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
      assert.equal(
        tupleCloseTo(boxCenter, geometryCenter, voxelScale * 2.5),
        true,
        `${slot} exact-source geometry shifted from canonical source center`
      );
      assert.equal(partGroups[slot].userData.v3CanonicalSlotPivot, contract.slotPivots[slot]);
      assert.equal(partGroups[slot].userData.v3CanonicalSlotGeometryOffset, contract.slotGeometryOffsets[slot]);
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
    assert.ok(forearmSize.x > 0.1 && forearmSize.z > 0.18, `forearm should stay visible from exact source (${forearmSize.x}, ${forearmSize.z})`);
    assert.ok(handSize.x > 0.08 && handSize.z > 0.18, `hand should stay visible from exact source (${handSize.x}, ${handSize.z})`);
    assert.equal(
      partGroups.chest.userData.v3ObjSurfaceSource,
      true,
      'built-in exact-source chest should not receive old part-box remapping'
    );
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

  it('decodes OBJ-derived source roles into painted V3 built-in voxels', () => {
    const helmet = getV3BuiltinPartVoxels('helmet', 192, V3_SCULPT_TEST_PAINT_JOB);
    const chest = getV3BuiltinPartVoxels('chest', 192, V3_SCULPT_TEST_PAINT_JOB);
    const back = getV3BuiltinPartVoxels('back', 192, V3_SCULPT_TEST_PAINT_JOB);

    assert.ok(helmet.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.visor && voxel.emissive === true), 'helmet should preserve OBJ visor emissive role');
    assert.ok(chest.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.undersuit), 'chest should preserve rubber undersuit role');
    assert.ok(chest.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.primary), 'chest should preserve armor shell role');
    assert.ok(back.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.fixed), 'backpack should preserve equipment/fixed role');
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
    assert.ok(getVoxelXSpan(lowerCheekAndJaw) >= Math.floor(bounds.sizeX * 0.45), `lower helmet cheek/jaw span should stay wide, got ${getVoxelXSpan(lowerCheekAndJaw)}`);
    assert.ok(sideEarArmor.length >= 100, `side-ear lower helmet armor is under-modeled (${sideEarArmor.length})`);
    assert.ok(helmet.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.visor && voxel.emissive === true), 'helmet should preserve OBJ visor voxels');
  });

  it('decodes the OBJ pelvis as a deep segmented source instead of procedural slab patches', () => {
    const pelvis = getV3BuiltinPartVoxels('pelvis', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(pelvis);
    const roles = new Set(pelvis.map((voxel) => voxel.color));
    const rearCoverage = pelvis.filter((voxel) => voxel.z === bounds.minZ).length / (bounds.sizeX * bounds.sizeY);

    assert.ok(bounds.sizeZ >= 34, `pelvis should preserve OBJ-derived depth, got depth ${bounds.sizeZ}`);
    assert.ok(bounds.sizeX >= 48, `pelvis should preserve OBJ-derived width, got width ${bounds.sizeX}`);
    assert.ok(roles.has(V3_SCULPT_TEST_COLORS.primary), 'pelvis should preserve armor shell role');
    assert.ok(roles.has(V3_SCULPT_TEST_COLORS.undersuit), 'pelvis should preserve undersuit role');
    assert.ok(rearCoverage <= 0.55, `pelvis rear should remain segmented, got coverage ${rearCoverage.toFixed(3)}`);
  });

  it('keeps OBJ-derived shins deep and side-comparable after exact-source decoding', () => {
    const shinLeft = getV3BuiltinPartVoxels('shinLeft', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shinRight = getV3BuiltinPartVoxels('shinRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const leftBounds = getVoxelBounds(shinLeft);
    const rightBounds = getVoxelBounds(shinRight);

    assert.ok(rightBounds.sizeZ >= 28, `shin should preserve OBJ-derived depth, got depth ${rightBounds.sizeZ}`);
    assert.ok(leftBounds.sizeZ >= 28, `left shin should preserve OBJ-derived depth, got depth ${leftBounds.sizeZ}`);
    assert.ok(Math.abs(leftBounds.sizeX - rightBounds.sizeX) <= 3, `shin widths diverged (${leftBounds.sizeX} vs ${rightBounds.sizeX})`);
    assert.ok(Math.abs(leftBounds.sizeY - rightBounds.sizeY) <= 3, `shin heights diverged (${leftBounds.sizeY} vs ${rightBounds.sizeY})`);
    assert.ok(shinRight.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.fixed), 'right shin should preserve fixed knee/robot-arm role');
    assert.ok(shinLeft.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.fixed), 'left shin should preserve fixed knee/robot-arm role');
    assert.equal(hasNearFullHeightFrontColumn(shinRight), false, 'shin front should not grow full-height scaffolding columns');
  });

  it('keeps exact OBJ-source helmet and chest within normalized runtime fit bounds', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const helmetSize = getWorldBox(partGroups.helmet).getSize(new THREE.Vector3());
    const chestSize = getWorldBox(partGroups.chest).getSize(new THREE.Vector3());

    assert.ok(helmetSize.x > 0.3 && helmetSize.x < 0.45, `unexpected helmet width ${helmetSize.x}`);
    assert.ok(helmetSize.y > 0.24 && helmetSize.y < 0.36, `unexpected helmet height ${helmetSize.y}`);
    assert.ok(helmetSize.z > 0.38 && helmetSize.z < 0.5, `unexpected helmet depth ${helmetSize.z}`);
    assert.ok(chestSize.x > 0.4 && chestSize.x < 0.55, `unexpected chest width ${chestSize.x}`);
    assert.ok(chestSize.y > 0.24 && chestSize.y < 0.36, `unexpected chest height ${chestSize.y}`);
    assert.ok(chestSize.z > 0.2 && chestSize.z < 0.32, `unexpected chest depth ${chestSize.z}`);
  });

  it('generates exact OBJ-source armor payloads with row-level silhouette variation', () => {
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

      assert.equal(voxels.length, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot].voxelCount, `${slot} should decode every exact source voxel`);
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
    assert.ok(visor.length >= 250, `expected dense visor voxels, found ${visor.length}`);
    assert.ok(new Set(visor.map((voxel) => voxel.y)).size >= 2, 'visor should cover at least two rows');
    assert.ok(getVoxelXSpan(visor) >= 12, `visor should span the high-density face, got ${getVoxelXSpan(visor)}`);
    assert.ok(crownVents.length >= 1000, `expected OBJ-derived crown shell voxels, found ${crownVents.length}`);
    assert.ok(jawGuards.length >= 80, `expected lower jaw/cheek voxels, found ${jawGuards.length}`);
    assert.ok(cheekPlates.filter((voxel) => voxel.x < centerX - 1).length >= 30, 'left cheek plate is under-modeled');
    assert.ok(cheekPlates.filter((voxel) => voxel.x > centerX + 1).length >= 30, 'right cheek plate is under-modeled');
    assert.ok(templeAccents.length >= 20, `expected temple/decal accents, found ${templeAccents.length}`);
    assert.ok(foreheadLight.length >= 1, 'helmet needs a center emissive forehead light');
  });

  it('remakes the V3 chest as high-density pectorals, center core, abdomen, waist, and side locks', () => {
    const voxels = getV3BuiltinPartVoxels('chest', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(voxels);
    const centerX = Math.floor((bounds.minX + bounds.maxX) / 2);
    const frontZ = getVoxelMaxZ(voxels);
    const lowerBandMaxY = bounds.minY + Math.ceil(bounds.sizeY * 0.36);
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
    const waistPlates = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.y >= bounds.minY + 1 &&
      voxel.y <= lowerBandMaxY &&
      voxel.z >= frontZ - 6
    );
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
    assert.ok(waistPlates.length >= 50, `expected OBJ undersuit waist separation, found ${waistPlates.length}`);
    assert.ok(sideLocks.length >= 200, `expected side locking coverage, found ${sideLocks.length}`);
  });

  it('decodes every remaining V3 armor family from the exact OBJ source', () => {
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
      const sourceSlot = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot];
      const colors = new Set(voxels.map((voxel) => voxel.color));

      assert.equal(voxels.length, sourceSlot.voxelCount, `${slot} should decode exact source voxel count`);
      assert.ok(bounds.sizeX > 0 && bounds.sizeY > 0 && bounds.sizeZ > 0, `${slot} should have occupied bounds`);
      assert.ok(colors.size >= 1, `${slot} should preserve at least one OBJ role`);
      assert.ok(sourceSlot.runCount > 0, `${slot} should preserve compact run data`);
    }

    assert.ok(getV3BuiltinPartVoxels('back', 192, V3_SCULPT_TEST_PAINT_JOB).some((voxel) => voxel.emissive), 'back should preserve emissive equipment detail');
    assert.ok(getV3BuiltinPartVoxels('handRight', 192, V3_SCULPT_TEST_PAINT_JOB).some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.fixed), 'hands should preserve glove/fixed material role');
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
            visor: '#ff00ff',
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
    const requiredEmissiveSlots = new Set(['helmet', 'back']);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const voxels = getV3BuiltinPartVoxels(slot, 192);
      const report = analyzeV3VoxelQuality(voxels);

      assert.ok(voxels.length > 0, `${slot} should decode exact OBJ surface voxels`);
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
