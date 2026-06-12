import * as THREE from 'three';
import {
  createVoxelGroup,
  type CharacterLoadout,
  type SpartanColors,
  type VoxelData,
} from '../VoxelModels';
import {
  customArmorPieceToVoxels,
  getCustomArmorPieceModelSystem,
  validateCustomArmorPiece,
  type CustomArmorColors,
  type CustomArmorPieceSnapshot,
} from '../customArmor';
import {
  BUILT_IN_V3_CHARACTER_PARTS,
  getDefaultV3CharacterLoadout,
  getDefaultV3WeaponManifest,
  type V3CharacterPartManifest,
} from './v3AssetManifest';
import { selectV3LodLevel } from './v3Lod';
import type { V3CharacterSlotId, V3WeaponId } from './v3ModelTypes';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
} from './v3PaintPalette';
import {
  normalizeV3QualityTier,
  type V3RenderOptions,
} from './v3QualityTiers';
import {
  V3_DETAIL_BONE_NAMES,
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';

export interface V3SpartanBuildOptions extends V3RenderOptions {
  isEnemy?: boolean;
  customHue?: number;
  loadout?: CharacterLoadout;
}

export interface V3WeaponBuildOptions extends V3RenderOptions {
  customHue?: number;
  loadout?: CharacterLoadout;
}

type V3PartSpec = {
  segment: 'lowerTorso' | 'upperTorso' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
  dimensions: [number, number, number];
  position: [number, number, number];
};

const V3_VOXEL_SCALE = 0.055;
const V3_WEAPON_SCALE = 0.06;

const V3_PART_SPECS: Record<V3CharacterSlotId, V3PartSpec> = {
  helmet: { segment: 'head', dimensions: [9, 8, 8], position: [-0.22, 1.56, -0.19] },
  neck: { segment: 'upperTorso', dimensions: [5, 3, 5], position: [-0.12, 1.42, -0.12] },
  chest: { segment: 'upperTorso', dimensions: [14, 13, 9], position: [-0.36, 1.03, -0.22] },
  shoulderLeft: { segment: 'leftArm', dimensions: [7, 5, 8], position: [-0.64, 1.31, -0.18] },
  shoulderRight: { segment: 'rightArm', dimensions: [7, 5, 8], position: [0.27, 1.31, -0.18] },
  upperArmLeft: { segment: 'leftArm', dimensions: [5, 9, 5], position: [-0.58, 0.95, -0.12] },
  upperArmRight: { segment: 'rightArm', dimensions: [5, 9, 5], position: [0.31, 0.95, -0.12] },
  forearmLeft: { segment: 'leftArm', dimensions: [5, 9, 5], position: [-0.58, 0.54, -0.12] },
  forearmRight: { segment: 'rightArm', dimensions: [5, 9, 5], position: [0.31, 0.54, -0.12] },
  handLeft: { segment: 'leftArm', dimensions: [5, 4, 5], position: [-0.58, 0.3, -0.12] },
  handRight: { segment: 'rightArm', dimensions: [5, 4, 5], position: [0.31, 0.3, -0.12] },
  pelvis: { segment: 'lowerTorso', dimensions: [12, 6, 8], position: [-0.31, 0.78, -0.19] },
  thighLeft: { segment: 'leftLeg', dimensions: [6, 10, 6], position: [-0.32, 0.38, -0.14] },
  thighRight: { segment: 'rightLeg', dimensions: [6, 10, 6], position: [0.04, 0.38, -0.14] },
  shinLeft: { segment: 'leftLeg', dimensions: [6, 10, 6], position: [-0.32, 0.0, -0.14] },
  shinRight: { segment: 'rightLeg', dimensions: [6, 10, 6], position: [0.04, 0.0, -0.14] },
  footLeft: { segment: 'leftLeg', dimensions: [7, 3, 9], position: [-0.34, -0.04, -0.1] },
  footRight: { segment: 'rightLeg', dimensions: [7, 3, 9], position: [0.02, -0.04, -0.1] },
  back: { segment: 'upperTorso', dimensions: [8, 12, 4], position: [-0.2, 1.04, -0.44] },
};

const createColors = (isEnemy = false, customHue?: number): SpartanColors => ({
  primary: customHue !== undefined ? `hsl(${customHue}, 86%, 50%)` : isEnemy ? '#ef4444' : '#3b82f6',
  secondary: customHue !== undefined ? `hsl(${customHue}, 58%, 34%)` : isEnemy ? '#7f1d1d' : '#1e3a8a',
  visor: customHue !== undefined ? `hsl(${customHue}, 95%, 74%)` : '#facc15',
  accent: customHue !== undefined ? `hsl(${(customHue + 48) % 360}, 82%, 58%)` : '#22d3ee',
  dark: '#111827',
  highlight: customHue !== undefined ? `hsl(${customHue}, 72%, 68%)` : '#93c5fd',
});

const roleColor = (
  role: string,
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): string => resolveV3RoleColor(role, colors, paintJob);

const roleEmissive = (
  role: string,
  paintJob: CharacterLoadout['paintJob'] | undefined,
  fallback: boolean
): boolean => resolveV3RoleEmissive(role, paintJob, fallback);

const createCustomArmorColors = (
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): CustomArmorColors => ({
  primary: roleColor('primary', colors, paintJob),
  secondary: roleColor('secondary', colors, paintJob),
  accent: roleColor('accent', colors, paintJob),
  visor: roleColor('visor', colors, paintJob),
  dark: roleColor('undersuit', colors, paintJob),
  highlight: roleColor('emissive', colors, paintJob),
});

const addBox = (
  voxels: VoxelData[],
  dimensions: [number, number, number],
  color: string,
  emissive = false
) => {
  const [width, height, depth] = dimensions;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < depth; z++) {
        const isShell = x === 0 || y === 0 || z === 0 || x === width - 1 || y === height - 1 || z === depth - 1;
        if (isShell) {
          voxels.push({ x, y, z, color, emissive });
        }
      }
    }
  }
};

const addTranslatedBox = (
  voxels: VoxelData[],
  dimensions: [number, number, number],
  origin: [number, number, number],
  color: string,
  emissive = false
) => {
  const local: VoxelData[] = [];
  addBox(local, dimensions, color, emissive);
  for (const voxel of local) {
    voxels.push({
      x: voxel.x + origin[0],
      y: voxel.y + origin[1],
      z: voxel.z + origin[2],
      color: voxel.color,
      emissive: voxel.emissive,
    });
  }
};

const addPanelStripe = (
  voxels: VoxelData[],
  axis: 'x' | 'y',
  fixedZ: number,
  color: string,
  emissive = false
) => {
  const maxX = Math.max(...voxels.map((voxel) => voxel.x));
  const maxY = Math.max(...voxels.map((voxel) => voxel.y));
  const centerX = Math.floor(maxX / 2);
  const centerY = Math.floor(maxY / 2);

  if (axis === 'x') {
    for (let x = 1; x < maxX; x++) {
      voxels.push({ x, y: centerY, z: fixedZ, color, emissive });
    }
    return;
  }

  for (let y = 1; y < maxY; y++) {
    voxels.push({ x: centerX, y, z: fixedZ, color, emissive });
  }
};

const addCornerArmorTabs = (
  voxels: VoxelData[],
  dimensions: [number, number, number],
  color: string
) => {
  const [width, height, depth] = dimensions;
  const tabY = Math.max(1, height - 2);
  const tabZ = Math.max(0, depth - 1);
  voxels.push({ x: 0, y: tabY, z: tabZ, color });
  voxels.push({ x: Math.max(0, width - 1), y: tabY, z: tabZ, color });
};

const createPartVoxels = (
  part: V3CharacterPartManifest,
  dimensions: [number, number, number],
  colors: SpartanColors,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] => {
  const voxels: VoxelData[] = [];
  addBox(voxels, dimensions, roleColor(part.paintRoles[0] ?? 'primary', colors, paintJob));

  const [width, height, depth] = dimensions;
  const frontZ = Math.max(0, depth - 1);
  addPanelStripe(voxels, 'x', frontZ, roleColor('secondary', colors, paintJob));
  addPanelStripe(
    voxels,
    'y',
    frontZ,
    roleColor('accent', colors, paintJob),
    roleEmissive('accent', paintJob, part.paintRoles.includes('emissive'))
  );
  addCornerArmorTabs(voxels, dimensions, roleColor('fixed', colors, paintJob));

  if (part.paintRoles.includes('secondary')) {
    for (let x = 1; x < width - 1; x++) {
      voxels.push({ x, y: Math.max(1, height - 2), z: frontZ, color: roleColor('secondary', colors, paintJob) });
    }
  }
  if (part.paintRoles.includes('accent')) {
    for (let y = 1; y < height - 1; y++) {
      voxels.push({ x: Math.max(0, width - 1), y, z: frontZ, color: roleColor('accent', colors, paintJob) });
    }
  }
  if (part.paintRoles.includes('visor')) {
    for (let x = 2; x < width - 2; x++) {
      voxels.push({
        x,
        y: Math.max(2, Math.floor(height * 0.48)),
        z: frontZ,
        color: roleColor('visor', colors, paintJob),
        emissive: roleEmissive('visor', paintJob, true),
      });
    }
  }
  if (part.paintRoles.includes('decal')) {
    const decalColor = roleColor('decal', colors, paintJob);
    for (let y = 1; y < height - 1; y += 2) {
      voxels.push({ x: Math.floor(width / 2), y, z: frontZ, color: decalColor });
    }
  }
  if (part.paintRoles.includes('emissive')) {
    voxels.push({
      x: Math.floor(width / 2),
      y: Math.max(1, Math.floor(height / 2)),
      z: frontZ,
      color: roleColor('emissive', colors, paintJob),
      emissive: roleEmissive('emissive', paintJob, true),
    });
  }

  return voxels;
};

export function getV3BuiltinPartVoxels(
  slot: V3CharacterSlotId,
  customHue?: number,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] {
  const part = BUILT_IN_V3_CHARACTER_PARTS.find((candidate) => candidate.slot === slot);
  if (!part) {
    throw new Error(`Missing built-in V3 part for ${slot}`);
  }
  return createPartVoxels(part, V3_PART_SPECS[slot].dimensions, createColors(false, customHue), paintJob);
}

function getValidV3CustomPiece(
  loadout: CharacterLoadout | undefined,
  slot: V3CharacterSlotId
): CustomArmorPieceSnapshot | undefined {
  const piece = loadout?.customArmor?.[slot];
  if (!piece || piece.slot !== slot || getCustomArmorPieceModelSystem(piece) !== 'v3') return undefined;
  const validation = validateCustomArmorPiece(piece);
  return validation.valid ? piece : undefined;
}

const createSegmentGroups = (): Record<V3PartSpec['segment'], THREE.Group> => ({
  lowerTorso: new THREE.Group(),
  upperTorso: new THREE.Group(),
  head: new THREE.Group(),
  leftArm: new THREE.Group(),
  rightArm: new THREE.Group(),
  leftLeg: new THREE.Group(),
  rightLeg: new THREE.Group(),
});

type V3DetailBoneMap = Record<V3DetailBoneName, THREE.Group>;

const subtractVec3Tuple = (
  value: THREE.Vector3Tuple,
  offset: THREE.Vector3Tuple
): THREE.Vector3Tuple => [
  value[0] - offset[0],
  value[1] - offset[1],
  value[2] - offset[2],
];

const createV3DetailBones = (
  segmentGroups: Record<V3PartSpec['segment'], THREE.Group>
): V3DetailBoneMap => {
  const bones = {} as V3DetailBoneMap;

  for (const boneName of V3_DETAIL_BONE_NAMES) {
    const spec = V3_DETAIL_BONE_SPECS[boneName];
    const bone = new THREE.Group();
    bone.name = `v3bone:${boneName}`;
    bone.userData.v3DetailBoneName = boneName;
    bone.userData.v3ReferenceBoneName = spec.referenceBone;
    bone.userData.v3ReferencePosition = [...spec.position];

    const parent = spec.parent ? bones[spec.parent] : segmentGroups[spec.segment];
    const parentPosition = spec.parent
      ? V3_DETAIL_BONE_SPECS[spec.parent].position
      : [0, 0, 0] as THREE.Vector3Tuple;

    bone.position.fromArray(subtractVec3Tuple(spec.position, parentPosition));
    parent.add(bone);
    bones[boneName] = bone;
  }

  return bones;
};

const getV3PartLocalPosition = (
  slot: V3CharacterSlotId,
  spec: V3PartSpec
): THREE.Vector3Tuple => {
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  return subtractVec3Tuple(spec.position, V3_DETAIL_BONE_SPECS[boneName].position);
};

export function buildV3SpartanModel(options: V3SpartanBuildOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'v3SpartanRoot';
  root.userData.modelSystem = 'v3';

  const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
  const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
  const loadout = getDefaultV3CharacterLoadout();
  const colors = createColors(options.isEnemy, options.customHue);
  const paintJob = options.loadout?.paintJob;
  const customArmorColors = createCustomArmorColors(colors, paintJob);
  const segmentGroups = createSegmentGroups();
  const detailBones = createV3DetailBones(segmentGroups);
  const partGroups: Partial<Record<V3CharacterSlotId, THREE.Group>> = {};

  for (const [segmentName, segment] of Object.entries(segmentGroups)) {
    segment.name = `v3:${segmentName}`;
    root.add(segment);
  }

  for (const part of BUILT_IN_V3_CHARACTER_PARTS) {
    const spec = V3_PART_SPECS[part.slot];
    const customPiece = getValidV3CustomPiece(options.loadout, part.slot);
    const voxels = customPiece
      ? customArmorPieceToVoxels(customPiece, customArmorColors)
      : createPartVoxels(part, spec.dimensions, colors, paintJob);
    const group = createVoxelGroup(voxels, V3_VOXEL_SCALE);
    const selectedLod = selectV3LodLevel({
      lods: part.lods,
      qualityTier: v3QualityTier,
      distance: v3Distance,
    });
    group.name = `v3:${part.slot}`;
    group.position.set(...getV3PartLocalPosition(part.slot, spec));
    group.userData.v3PartId = part.id;
    group.userData.v3Slot = part.slot;
    group.userData.v3BoundsId = part.boundsId;
    group.userData.v3QualityTier = v3QualityTier;
    group.userData.v3Distance = v3Distance;
    group.userData.v3SelectedLod = selectedLod;
    if (customPiece) {
      group.userData.customArmorId = customPiece.id;
      group.userData.customArmorName = customPiece.name;
    }
    detailBones[V3_SLOT_DETAIL_BONES[part.slot]].add(group);
    partGroups[part.slot] = group;
  }

  root.userData.v3CharacterLoadout = loadout;
  root.userData.v3QualityTier = v3QualityTier;
  root.userData.v3Distance = v3Distance;
  root.userData.v3PartGroups = partGroups;
  root.userData.v3DetailBones = detailBones;
  root.userData.segmentGroups = segmentGroups;
  root.userData.lowerTorso = segmentGroups.lowerTorso;
  root.userData.upperTorso = detailBones.chest;
  root.userData.head = detailBones.head;
  root.userData.leftArm = detailBones.upperArmLeft;
  root.userData.rightArm = detailBones.upperArmRight;
  root.userData.leftLeg = detailBones.thighLeft;
  root.userData.rightLeg = detailBones.thighRight;
  root.userData.pelvis = detailBones.pelvis;
  root.userData.spine1 = detailBones.spine1;
  root.userData.spine2 = detailBones.spine2;
  root.userData.spine3 = detailBones.spine3;
  root.userData.chest = detailBones.chest;
  root.userData.neck = detailBones.neck;
  root.userData.backpack = detailBones.backpack;
  root.userData.handLeft = detailBones.handLeft;
  root.userData.handRight = detailBones.handRight;
  root.userData.hand_l = detailBones.handLeft;
  root.userData.hand_r = detailBones.handRight;
  root.userData.v3AttachmentOffsets = {
    thirdPersonWeaponGrip: [0.08, -0.08, 0.02],
    thirdPersonOffhandGrip: [-0.08, -0.08, 0.02],
    rightHandGrip: [0.08, -0.08, 0.02],
    leftHandGrip: [-0.08, -0.08, 0.02],
  };

  return root;
}

export function getV3BuiltinWeaponVoxels(
  weapon: V3WeaponId,
  customHue?: number,
  paintJob?: CharacterLoadout['paintJob']
): VoxelData[] {
  const colors = createColors(false, customHue);
  const voxels: VoxelData[] = [];
  if (weapon === 'hammer') {
    addTranslatedBox(voxels, [3, 22, 3], [0, 0, 0], roleColor('undersuit', colors, paintJob));
    addTranslatedBox(voxels, [7, 3, 5], [-2, -2, -1], roleColor('secondary', colors, paintJob));
    addTranslatedBox(voxels, [5, 2, 5], [-1, 5, -1], roleColor('accent', colors, paintJob));
    addTranslatedBox(voxels, [5, 2, 5], [-1, 11, -1], roleColor('accent', colors, paintJob));
    addTranslatedBox(voxels, [11, 5, 7], [-4, 18, -2], roleColor('primary', colors, paintJob));
    addTranslatedBox(voxels, [3, 7, 5], [-5, 17, -1], roleColor('fixed', colors, paintJob));
    addTranslatedBox(voxels, [3, 7, 5], [5, 17, -1], roleColor('fixed', colors, paintJob));
    for (let x = -3; x <= 5; x += 2) {
      voxels.push({ x, y: 22, z: 5, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
      voxels.push({ x, y: 18, z: 5, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
    }
    return voxels;
  }
  if (weapon === 'sword') {
    addBox(voxels, [3, 7, 3], roleColor('undersuit', colors, paintJob));
    addTranslatedBox(voxels, [8, 2, 3], [-3, 5, 0], roleColor('primary', colors, paintJob));
    for (let y = 7; y < 35; y++) {
      voxels.push({ x: 1, y, z: 1, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
      if (y % 2 === 0) {
        voxels.push({ x: 0, y, z: 1, color: roleColor('accent', colors, paintJob), emissive: roleEmissive('accent', paintJob, true) });
        voxels.push({ x: 2, y, z: 1, color: roleColor('accent', colors, paintJob), emissive: roleEmissive('accent', paintJob, true) });
      } else {
        voxels.push({ x: -1, y, z: 1, color: roleColor('secondary', colors, paintJob) });
        voxels.push({ x: 3, y, z: 1, color: roleColor('secondary', colors, paintJob) });
      }
    }
    voxels.push({ x: 1, y: 35, z: 1, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
    return voxels;
  }

  addTranslatedBox(voxels, [4, 5, 3], [1, 0, 1], roleColor('undersuit', colors, paintJob));
  addTranslatedBox(voxels, [8, 3, 3], [1, 4, 1], roleColor('primary', colors, paintJob));
  addTranslatedBox(voxels, [3, 5, 3], [0, 1, 1], roleColor('secondary', colors, paintJob));
  addTranslatedBox(voxels, [2, 2, 5], [7, 4, 0], roleColor('fixed', colors, paintJob));
  addTranslatedBox(voxels, [2, 1, 3], [3, 7, 1], roleColor('accent', colors, paintJob));
  voxels.push({ x: 8, y: 5, z: 2, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
  voxels.push({ x: 5, y: 6, z: 3, color: roleColor('emissive', colors, paintJob), emissive: roleEmissive('emissive', paintJob, true) });
  return voxels;
}

export function buildV3WeaponModel(weapon: V3WeaponId, options: V3WeaponBuildOptions = {}): THREE.Group {
  const manifest = getDefaultV3WeaponManifest(weapon);
  const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
  const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
  const group = createVoxelGroup(getV3BuiltinWeaponVoxels(weapon, options.customHue, options.loadout?.paintJob), V3_WEAPON_SCALE);
  const selectedLod = selectV3LodLevel({
    lods: manifest.lods,
    qualityTier: v3QualityTier,
    distance: v3Distance,
  });

  group.name = `v3:${weapon}`;
  group.userData.modelSystem = 'v3';
  group.userData.weaponType = weapon;
  group.userData.v3ManifestId = manifest.id;
  group.userData.v3Sockets = manifest.sockets;
  group.userData.v3QualityTier = v3QualityTier;
  group.userData.v3Distance = v3Distance;
  group.userData.v3SelectedLod = selectedLod;

  return group;
}

export function buildV3HammerModel(customHue?: number, v3Options: V3WeaponBuildOptions = {}): THREE.Group {
  return buildV3WeaponModel('hammer', { customHue, ...v3Options });
}

export function buildV3SwordModel(customHue?: number, v3Options: V3WeaponBuildOptions = {}): THREE.Group {
  return buildV3WeaponModel('sword', { customHue, ...v3Options });
}

export function buildV3PistolModel(customHue?: number, v3Options: V3WeaponBuildOptions = {}): THREE.Group {
  return buildV3WeaponModel('pistol', { customHue, ...v3Options });
}
