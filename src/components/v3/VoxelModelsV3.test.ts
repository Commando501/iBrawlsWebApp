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
  getV3BuiltinPartGridScale,
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
import { V3_AEGIS_REFERENCE_VOXEL_SOURCE } from './v3AegisReferenceVoxels.generated';
import {
  V3_PRODUCTION_QUALITY_THRESHOLDS,
  analyzeV3VoxelQuality,
  classifyV3ProductionReadiness,
} from './v3ProductionQuality';
import { analyzeV3BuiltInShapeLanguage } from './v3ShapeLanguage';
import { analyzeV3ArmorSurface } from './v3VoxelArmorSurface';
import {
  analyzeV3AegisReferenceProportions,
  formatV3ReferenceProportionGapSummary,
  getV3RenderedObjGateClosureIssues,
} from './v3ReferenceProportions';

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
      helmet: { dimensions: [10, 8, 8], position: [-0.2392, 1.56, -0.19] },
      neck: { dimensions: [6, 4, 6], position: [-0.1592, 1.39, -0.15] },
      chest: { dimensions: [16, 15, 9], position: [-0.4174, 0.97, -0.22] },
      shoulderLeft: { dimensions: [7, 5, 8], position: [-0.6216, 1.24, -0.19] },
      shoulderRight: { dimensions: [7, 5, 8], position: [0.2516, 1.24, -0.19] },
      upperArmLeft: { dimensions: [4, 9, 5], position: [-0.4499, 0.95, -0.12] },
      upperArmRight: { dimensions: [4, 9, 5], position: [0.2299, 0.95, -0.12] },
      forearmLeft: { dimensions: [4, 9, 5], position: [-0.4449, 0.54, -0.12] },
      forearmRight: { dimensions: [4, 9, 5], position: [0.2249, 0.54, -0.12] },
      handLeft: { dimensions: [3, 4, 4], position: [-0.4149, 0.3, -0.1] },
      handRight: { dimensions: [3, 4, 4], position: [0.2549, 0.3, -0.1] },
      pelvis: { dimensions: [13, 6, 9], position: [-0.3283, 0.83, -0.205] },
      thighLeft: { dimensions: [4, 10, 4], position: [-0.2499, 0.38, -0.105] },
      thighRight: { dimensions: [4, 10, 4], position: [0.0299, 0.38, -0.105] },
      shinLeft: { dimensions: [4, 10, 7], position: [-0.2499, 0, -0.155] },
      shinRight: { dimensions: [4, 10, 7], position: [0.0299, 0, -0.155] },
      footLeft: { dimensions: [6, 3, 8], position: [-0.2799, -0.04, -0.09] },
      footRight: { dimensions: [6, 3, 8], position: [-0.0001, -0.04, -0.09] },
      back: { dimensions: [8, 12, 4], position: [-0.1875, 1.04, -0.34] },
    } as const;

    for (const [slot, spec] of Object.entries(expected)) {
      const actual = V3_AEGIS_PART_SPECS[slot as keyof typeof V3_AEGIS_PART_SPECS];
      assert.deepEqual(actual.dimensions, spec.dimensions, `${slot} dimensions should match calibrated OBJ envelope`);
      assert.deepEqual(actual.position, spec.position, `${slot} position should match calibrated OBJ envelope`);
    }
  });

  it('uses OBJ-derived gridScale 3 for every built-in V3 character part', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.equal(getV3BuiltinPartGridScale(slot), 3, `${slot} should use OBJ-derived gridScale 3`);
      assert.equal(partGroups[slot].userData.v3GridScale, 3, `${slot} runtime group should use OBJ-derived gridScale 3`);
    }
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
      assert.deepEqual(reports[slot].issues, [], `${slot} shape-language issues`);
    }
  });

  it('builds reference-inspired V3 detail bones for procedural armor fit', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;

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

    assert.equal(model.userData.v3PartGroups.helmet.parent, detailBones.helmet);
    assert.equal(model.userData.v3PartGroups.chest.parent, detailBones.chest);
    assert.equal(model.userData.v3PartGroups.forearmLeft.parent, detailBones.forearmLeft);
    assert.equal(model.userData.v3PartGroups.handRight.parent, detailBones.handRight);
    assert.equal(model.userData.v3PartGroups.shinLeft.parent, detailBones.calfLeft);
    assert.equal(model.userData.v3PartGroups.footRight.parent, detailBones.footRight);
    assert.equal(model.userData.v3PartGroups.back.parent, detailBones.backpack);
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

  it('builds a readable Aegis vertical-slice silhouette instead of rectangular armor blocks', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const chestSize = getWorldBox(partGroups.chest).getSize(new THREE.Vector3());
    const pelvisSize = getWorldBox(partGroups.pelvis).getSize(new THREE.Vector3());
    const forearmSize = getWorldBox(partGroups.forearmRight).getSize(new THREE.Vector3());
    const handSize = getWorldBox(partGroups.handRight).getSize(new THREE.Vector3());

    assert.ok(chestSize.x > pelvisSize.x * 1.2, `chest should read wider than pelvis (${chestSize.x} vs ${pelvisSize.x})`);
    assert.ok(forearmSize.x > handSize.x * 1.15, `forearm bracer should read bulkier than hand (${forearmSize.x} vs ${handSize.x})`);
  });

  it('uses the checked-in sanitized OBJ-derived voxel source for built-in Aegis armor', () => {
    const serialized = JSON.stringify(V3_AEGIS_REFERENCE_VOXEL_SOURCE);

    assert.equal(V3_AEGIS_REFERENCE_VOXEL_SOURCE.schemaVersion, 'v3-aegis-reference-voxels/v1');
    assert.equal(V3_AEGIS_REFERENCE_VOXEL_SOURCE.gridScale, 3);
    assert.equal(V3_AEGIS_REFERENCE_VOXEL_SOURCE.metrics.slotCount, V3_CHARACTER_SLOT_IDS.length);
    assert.match(V3_AEGIS_REFERENCE_VOXEL_SOURCE.source.hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(serialized.includes('G:\\'), false);
    assert.equal(serialized.includes('"triangles"'), false);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      assert.ok(V3_AEGIS_REFERENCE_VOXEL_SOURCE.slots[slot].voxelCount > 0, `${slot} generated source should not be empty`);
      assert.equal(getV3BuiltinPartGridScale(slot), V3_AEGIS_REFERENCE_VOXEL_SOURCE.slots[slot].gridScale);
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

  it('keeps generated paired lower-body slots mirrored after decoding', () => {
    const shinLeft = getV3BuiltinPartVoxels('shinLeft', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shinRight = getV3BuiltinPartVoxels('shinRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const leftBounds = getVoxelBounds(shinLeft);
    const rightBounds = getVoxelBounds(shinRight);
    const rightWidth = V3_AEGIS_REFERENCE_VOXEL_SOURCE.slots.shinRight.dimensions[0];
    const leftSignature = new Set(shinLeft.map((voxel) => [
      voxel.x - leftBounds.minX,
      voxel.y,
      voxel.z,
      voxel.color,
      voxel.emissive === true ? 1 : 0,
    ].join(':')));
    const mirroredRightSignature = shinRight.map((voxel) => [
      rightWidth - 1 - voxel.x,
      voxel.y,
      voxel.z,
      voxel.color,
      voxel.emissive === true ? 1 : 0,
    ].join(':'));

    assert.ok(mirroredRightSignature.length > 0);
    assert.equal(mirroredRightSignature.every((entry) => leftSignature.has(entry)), true);
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
    const lowerCheekAndJaw = helmet.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.visor &&
      voxel.y >= bounds.minY + 3 &&
      voxel.y <= bounds.minY + 8 &&
      voxel.z >= frontZ - 4
    );
    const sideEarArmor = helmet.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.visor &&
      (voxel.x <= bounds.minX + 3 || voxel.x >= bounds.maxX - 3) &&
      voxel.y >= bounds.minY + 4 &&
      voxel.y <= bounds.minY + 10 &&
      voxel.z <= frontZ - 2
    );

    assert.equal(getV3BuiltinPartGridScale('helmet'), 3);
    assert.ok(getVoxelXSpan(crownRows) <= 22, `helmet crown taper regressed to span ${getVoxelXSpan(crownRows)}`);
    assert.ok(getVoxelXSpan(lowerCheekAndJaw) >= 14, `lower helmet cheek/jaw span should stay wide, got ${getVoxelXSpan(lowerCheekAndJaw)}`);
    assert.ok(sideEarArmor.length >= 100, `side-ear lower helmet armor is under-modeled (${sideEarArmor.length})`);
    assert.ok(helmet.some((voxel) => voxel.color === V3_SCULPT_TEST_COLORS.visor && voxel.emissive === true), 'helmet should preserve OBJ visor voxels');
  });

  it('adds segmented pelvis side and rear hip, belt, cod, and waist depth without a slab rear', () => {
    const pelvis = getV3BuiltinPartVoxels('pelvis', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(pelvis);
    const rearZ = bounds.minZ;
    const sideRearHipModules = pelvis.filter((voxel) =>
      voxel.z <= rearZ + 6 &&
      voxel.y >= bounds.minY + 3 &&
      voxel.y <= bounds.minY + 8 &&
      (voxel.x <= bounds.minX + 5 || voxel.x >= bounds.maxX - 5)
    );
    const rearBeltModules = pelvis.filter((voxel) =>
      voxel.z <= rearZ + 6 &&
      voxel.y >= bounds.maxY - 4
    );
    const codDepthModule = pelvis.filter((voxel) =>
      voxel.z <= rearZ + 6 &&
      voxel.x >= Math.floor(bounds.sizeX * 0.42) &&
      voxel.x <= Math.ceil(bounds.sizeX * 0.58)
    );
    const waistDepthModules = pelvis.filter((voxel) =>
      voxel.z <= rearZ + 6 &&
      voxel.y >= bounds.maxY - 6 &&
      (voxel.x <= bounds.minX + 6 || voxel.x >= bounds.maxX - 6)
    );
    const rearCoverage = pelvis.filter((voxel) => voxel.z === rearZ).length / (bounds.sizeX * bounds.sizeY);

    assert.ok(bounds.sizeZ >= 24, `pelvis should preserve OBJ-derived depth modules, got depth ${bounds.sizeZ}`);
    assert.ok(sideRearHipModules.length >= 16, `segmented side/rear hip depth modules are under-modeled (${sideRearHipModules.length})`);
    assert.ok(rearBeltModules.length >= 12, `rear belt depth modules are under-modeled (${rearBeltModules.length})`);
    assert.ok(codDepthModule.length >= 4, `center cod depth module is under-modeled (${codDepthModule.length})`);
    assert.ok(waistDepthModules.length >= 8, `rear waist depth modules are under-modeled (${waistDepthModules.length})`);
    assert.ok(rearCoverage <= 0.34, `pelvis rear should stay segmented, got coverage ${rearCoverage.toFixed(3)}`);
  });

  it('keeps OBJ-derived shins deep, paneled, and mirrored after generated-source decoding', () => {
    const shinLeft = getV3BuiltinPartVoxels('shinLeft', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shinRight = getV3BuiltinPartVoxels('shinRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const leftBounds = getVoxelBounds(shinLeft);
    const rightBounds = getVoxelBounds(shinRight);
    const frontZ = rightBounds.maxZ;
    const rearZ = rightBounds.minZ;
    const upperBandY = Math.floor(rightBounds.sizeY * 0.68);
    const ankleSpan = Math.max(
      getRowXSpan(shinRight, rightBounds.minY),
      getRowXSpan(shinRight, rightBounds.minY + 1),
      getRowXSpan(shinRight, rightBounds.minY + 2)
    );
    const kneeCaps = shinRight.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.z >= frontZ - 2 &&
      voxel.y >= upperBandY
    );
    const sideWrap = shinRight.filter((voxel) =>
      voxel.z <= rearZ + 5 &&
      voxel.y >= upperBandY &&
      (voxel.x <= rightBounds.minX + 3 || voxel.x >= rightBounds.maxX - 3)
    );
    const rearWrap = shinRight.filter((voxel) =>
      voxel.z <= rearZ + 5 &&
      voxel.y >= upperBandY
    );
    const mirrorSample = (voxel: VoxelData): string => [
      rightBounds.maxX - voxel.x,
      voxel.y,
      voxel.z,
      voxel.color,
    ].join(':');
    const leftSamples = new Set(shinLeft.map((voxel) => [
      voxel.x - leftBounds.minX,
      voxel.y,
      voxel.z,
      voxel.color,
    ].join(':')));
    const mirroredRightUpperWrap = shinRight.filter((voxel) =>
      voxel.y >= upperBandY &&
      (voxel.color === V3_SCULPT_TEST_COLORS.fixed || voxel.color === V3_SCULPT_TEST_COLORS.secondary) &&
      voxel.z <= frontZ - 1
    );

    assert.ok(rightBounds.sizeZ >= 18, `shin should preserve OBJ-derived rear wrap depth, got depth ${rightBounds.sizeZ}`);
    assert.ok(kneeCaps.length >= 40, `upper-shin knee cap is under-modeled (${kneeCaps.length})`);
    assert.ok(sideWrap.length >= 8, `upper-shin side wrap depth is under-modeled (${sideWrap.length})`);
    assert.ok(rearWrap.length >= 40, `upper-shin rear wrap ridge is under-modeled (${rearWrap.length})`);
    assert.ok(ankleSpan <= rightBounds.sizeX, `ankle row should stay inside local source width (${ankleSpan} vs ${rightBounds.sizeX})`);
    assert.equal(hasNearFullHeightFrontColumn(shinRight), false, 'shin front should not grow full-height scaffolding columns');
    assert.ok(
      mirroredRightUpperWrap.every((voxel) => leftSamples.has(mirrorSample(voxel))),
      'left/right shin upper wrap details should stay mirrored'
    );
  });

  it('keeps OBJ-derived gridScale 3 helmet and chest within normalized runtime fit bounds', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const helmetSize = getWorldBox(partGroups.helmet).getSize(new THREE.Vector3());
    const chestSize = getWorldBox(partGroups.chest).getSize(new THREE.Vector3());

    assert.ok(helmetSize.x > 0.36 && helmetSize.x < 0.62, `unexpected helmet width ${helmetSize.x}`);
    assert.ok(helmetSize.y > 0.32 && helmetSize.y < 0.62, `unexpected helmet height ${helmetSize.y}`);
    assert.ok(helmetSize.z > 0.28 && helmetSize.z < 0.62, `unexpected helmet depth ${helmetSize.z}`);
    assert.ok(chestSize.x > 0.7 && chestSize.x < 1.02, `unexpected chest width ${chestSize.x}`);
    assert.ok(chestSize.y > 0.62 && chestSize.y < 1.04, `unexpected chest height ${chestSize.y}`);
    assert.ok(chestSize.z > 0.3 && chestSize.z < 0.72, `unexpected chest depth ${chestSize.z}`);
  });

  it('generates sculpted V3 armor payloads with row-level silhouette variation while staying inside fit bounds', () => {
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
      const bounds = getV3CharacterPartBounds(slot);
      const gridScale = getV3BuiltinPartGridScale(slot);

      assert.ok(report.occupiedDimensions.x <= bounds.maxDimensions.x * gridScale, `${slot} exceeds x fit bound`);
      assert.ok(report.occupiedDimensions.y <= bounds.maxDimensions.y * gridScale, `${slot} exceeds y fit bound`);
      assert.ok(report.occupiedDimensions.z <= bounds.maxDimensions.z * gridScale, `${slot} exceeds z fit bound`);

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
    const crownVents = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.primary &&
      voxel.y >= 10 &&
      voxel.z < frontZ
    );
    const jawGuards = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.y <= 8 &&
      voxel.z >= frontZ - 4
    );
    const templeAccents = voxels.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.decal || voxel.color === V3_SCULPT_TEST_COLORS.emissive) &&
      voxel.y >= 7 &&
      voxel.y <= 14
    );
    const cheekPlates = voxels.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.primary || voxel.color === V3_SCULPT_TEST_COLORS.undersuit) &&
      voxel.y >= 4 &&
      voxel.y <= 10 &&
      voxel.z >= frontZ - 4
    );
    const foreheadLight = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.emissive &&
      voxel.emissive === true
    );

    assert.equal(getV3BuiltinPartGridScale('helmet'), 3);
    assert.ok(visor.length >= 250, `expected dense visor voxels, found ${visor.length}`);
    assert.ok(new Set(visor.map((voxel) => voxel.y)).size >= 2, 'visor should cover at least two rows');
    assert.ok(getVoxelXSpan(visor) >= 12, `visor should span the high-density face, got ${getVoxelXSpan(visor)}`);
    assert.ok(crownVents.length >= 1000, `expected OBJ-derived crown shell voxels, found ${crownVents.length}`);
    assert.ok(jawGuards.length >= 4, `expected lower jaw/cheek voxels, found ${jawGuards.length}`);
    assert.ok(cheekPlates.filter((voxel) => voxel.x >= 5 && voxel.x <= 12).length >= 12, 'left cheek plate is under-modeled');
    assert.ok(cheekPlates.filter((voxel) => voxel.x >= 17 && voxel.x <= 24).length >= 12, 'right cheek plate is under-modeled');
    assert.ok(templeAccents.length >= 20, `expected temple/decal accents, found ${templeAccents.length}`);
    assert.ok(foreheadLight.length >= 1, 'helmet needs a center emissive forehead light');
  });

  it('remakes the V3 chest as high-density pectorals, center core, abdomen, waist, and side locks', () => {
    const voxels = getV3BuiltinPartVoxels('chest', 192, V3_SCULPT_TEST_PAINT_JOB);
    const bounds = getVoxelBounds(voxels);
    const centerX = Math.floor((bounds.minX + bounds.maxX) / 2);
    const frontZ = getVoxelMaxZ(voxels);
    const pectoralPlates = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.primary &&
      voxel.y >= 16 &&
      voxel.y <= 38 &&
      voxel.z >= frontZ - 5
    );
    const centerCore = voxels.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.decal || voxel.color === V3_SCULPT_TEST_COLORS.emissive) &&
      voxel.x >= centerX - 3 &&
      voxel.x <= centerX + 4 &&
      voxel.y >= 10 &&
      voxel.y <= 38
    );
    const waistPlates = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.y >= 4 &&
      voxel.y <= 14 &&
      voxel.z >= frontZ - 6
    );
    const abdomenPlates = voxels.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.fixed &&
      voxel.y >= 27
    );
    const sideLocks = voxels.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      (voxel.x <= bounds.minX + 3 || voxel.x >= bounds.maxX - 3) &&
      voxel.y >= 10 &&
      voxel.y <= 32
    );

    assert.equal(getV3BuiltinPartGridScale('chest'), 3);
    assert.ok(pectoralPlates.filter((voxel) => voxel.x < centerX - 2).length >= 300, 'left pectoral plate is under-modeled');
    assert.ok(pectoralPlates.filter((voxel) => voxel.x > centerX + 2).length >= 300, 'right pectoral plate is under-modeled');
    assert.ok(centerCore.length >= 4, `expected center decal/emissive core, found ${centerCore.length}`);
    assert.ok(waistPlates.filter((voxel) => voxel.x < centerX - 2).length >= 30, 'left waist/undersuit separation is under-modeled');
    assert.ok(waistPlates.filter((voxel) => voxel.x > centerX + 2).length >= 30, 'right waist/undersuit separation is under-modeled');
    assert.ok(abdomenPlates.length >= 300, `expected fixed upper module plates, found ${abdomenPlates.length}`);
    assert.ok(sideLocks.length >= 200, `expected side locking coverage, found ${sideLocks.length}`);
  });

  it('remakes the remaining V3 armor families with high-density articulated panel details', () => {
    const shoulder = getV3BuiltinPartVoxels('shoulderLeft', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shoulderFrontZ = getVoxelMaxZ(shoulder);
    const shoulderAccentRim = shoulder.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.accent &&
      voxel.x <= 1 &&
      voxel.y >= 2 &&
      voxel.z >= shoulderFrontZ - 5
    );
    const shoulderCap = shoulder.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.y >= 6 &&
      voxel.z >= shoulderFrontZ - 15
    );

    const upperArm = getV3BuiltinPartVoxels('upperArmRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const upperArmFrontZ = getVoxelMaxZ(upperArm);
    const bicepBands = upperArm.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.secondary &&
      voxel.z >= upperArmFrontZ - 3 &&
      voxel.y >= 11
    );
    const upperInnerUndersuit = upperArm.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.x <= 1 &&
      voxel.y >= 3 &&
      voxel.y <= 13
    );

    const forearm = getV3BuiltinPartVoxels('forearmRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const forearmFrontZ = getVoxelMaxZ(forearm);
    const wristBands = forearm.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.accent &&
      voxel.z >= forearmFrontZ - 3 &&
      voxel.y <= 8
    );
    const forearmRidge = forearm.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.secondary &&
      voxel.z >= forearmFrontZ - 4 &&
      voxel.y >= 8
    );

    const hand = getV3BuiltinPartVoxels('handRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const handFrontZ = getVoxelMaxZ(hand);
    const knuckles = hand.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.accent || voxel.color === V3_SCULPT_TEST_COLORS.fixed) &&
      voxel.z >= handFrontZ - 3 &&
      voxel.y >= 4
    );

    const pelvis = getV3BuiltinPartVoxels('pelvis', 192, V3_SCULPT_TEST_PAINT_JOB);
    const pelvisFrontZ = getVoxelMaxZ(pelvis);
    const belt = pelvis.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.primary &&
      voxel.z >= pelvisFrontZ - 6 &&
      voxel.y >= 8
    );
    const buckle = pelvis.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.decal
    );
    const hipPlates = pelvis.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.z >= pelvisFrontZ - 6 &&
      (voxel.x <= 6 || voxel.x >= 32)
    );

    const thigh = getV3BuiltinPartVoxels('thighRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const thighFrontZ = getVoxelMaxZ(thigh);
    const thighFrontPlate = thigh.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.z >= thighFrontZ - 3 &&
      voxel.y >= 8
    );
    const thighInnerGap = thigh.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.x <= 1 &&
      voxel.y >= 4
    );

    const shin = getV3BuiltinPartVoxels('shinRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const shinFrontZ = getVoxelMaxZ(shin);
    const shinRidge = shin.filter((voxel) =>
      (
        voxel.color === V3_SCULPT_TEST_COLORS.accent ||
        voxel.color === V3_SCULPT_TEST_COLORS.secondary ||
        voxel.color === V3_SCULPT_TEST_COLORS.fixed
      ) &&
      voxel.z >= shinFrontZ - 3 &&
      voxel.y >= 6
    );
    const shinSideGap = shin.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.x <= 1 &&
      voxel.y >= 3
    );

    const foot = getV3BuiltinPartVoxels('footRight', 192, V3_SCULPT_TEST_PAINT_JOB);
    const footFrontZ = getVoxelMaxZ(foot);
    const toeCap = foot.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.z >= footFrontZ - 3
    );
    const soleAccent = foot.filter((voxel) =>
      (voxel.color === V3_SCULPT_TEST_COLORS.accent || voxel.color === V3_SCULPT_TEST_COLORS.decal) &&
      voxel.y <= 2
    );

    const neck = getV3BuiltinPartVoxels('neck', 192, V3_SCULPT_TEST_PAINT_JOB);
    const neckFrontZ = getVoxelMaxZ(neck);
    const collarBand = neck.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.secondary &&
      voxel.z >= neckFrontZ - 4 &&
      voxel.y >= 4
    );

    const back = getV3BuiltinPartVoxels('back', 192, V3_SCULPT_TEST_PAINT_JOB);
    const backRearZ = getVoxelMinZ(back);
    const backRails = back.filter((voxel) =>
      voxel.color !== V3_SCULPT_TEST_COLORS.undersuit &&
      voxel.z <= backRearZ + 4 &&
      voxel.y >= 5
    );
    const backEmissive = back.filter((voxel) =>
      voxel.color === V3_SCULPT_TEST_COLORS.emissive &&
      voxel.emissive === true
    );

    assert.ok(shoulderAccentRim.length >= 4, `expected shoulder outer accent rim, found ${shoulderAccentRim.length}`);
    assert.ok(shoulderCap.length >= 20, `expected shoulder cap plates, found ${shoulderCap.length}`);
    assert.ok(bicepBands.length >= 12, `expected upper arm bicep band, found ${bicepBands.length}`);
    assert.ok(upperInnerUndersuit.length >= 8, `expected upper arm undersuit channel, found ${upperInnerUndersuit.length}`);
    assert.ok(wristBands.length >= 3, `expected forearm wrist band, found ${wristBands.length}`);
    assert.ok(forearmRidge.length >= 250, `expected forearm raised ridge, found ${forearmRidge.length}`);
    assert.ok(knuckles.length >= 40, `expected articulated glove knuckles, found ${knuckles.length}`);
    assert.ok(belt.length >= 250, `expected pelvis belt segments, found ${belt.length}`);
    assert.ok(buckle.length >= 300, `expected pelvis center/decal module, found ${buckle.length}`);
    assert.ok(hipPlates.length >= 100, `expected pelvis hip plates, found ${hipPlates.length}`);
    assert.ok(thighFrontPlate.length >= 250, `expected thigh front plate, found ${thighFrontPlate.length}`);
    assert.ok(thighInnerGap.length >= 8, `expected thigh undersuit gap, found ${thighInnerGap.length}`);
    assert.ok(shinRidge.length >= 250, `expected shin vertical ridge, found ${shinRidge.length}`);
    assert.ok(shinSideGap.length >= 8, `expected shin undersuit side gap, found ${shinSideGap.length}`);
    assert.ok(toeCap.length >= 20, `expected boot toe cap, found ${toeCap.length}`);
    assert.ok(soleAccent.length >= 40, `expected boot sole accent band, found ${soleAccent.length}`);
    assert.ok(collarBand.length >= 100, `expected neck collar band, found ${collarBand.length}`);
    assert.ok(backRails.length >= 1000, `expected backpack spine rails, found ${backRails.length}`);
    assert.ok(backEmissive.length >= 80, `expected backpack emissive cells, found ${backEmissive.length}`);
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

  it('generates production-candidate built-in character part voxel payloads', () => {
    const requiredEmissiveSlots = new Set(['helmet', 'back']);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const voxels = getV3BuiltinPartVoxels(slot, 192);
      const report = analyzeV3VoxelQuality(voxels);

      assert.equal(
        classifyV3ProductionReadiness(report, V3_PRODUCTION_QUALITY_THRESHOLDS.characterPart),
        'productionCandidate',
        `${slot} should be richer than a blockout`
      );

      if (requiredEmissiveSlots.has(slot)) {
        assert.equal(report.emissiveVoxelCount > 0, true, `${slot} should include readable emissive detail`);
      }
    }
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
