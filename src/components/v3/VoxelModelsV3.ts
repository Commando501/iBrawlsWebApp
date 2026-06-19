import * as THREE from 'three';
import {
  createVoxelGroup,
  type CharacterLoadout,
  type SpartanColors,
  type VoxelData,
} from '../VoxelModels';
import {
  customArmorPieceToVoxels,
  getCustomArmorGridScale,
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
import {
  createV3AegisPartVoxels,
  getV3AegisPartSpec,
  getV3BuiltinPartGridScale,
  getV3BuiltinPartVoxelScale,
  scaleV3Dimensions,
  type V3AegisPartSpec,
  type V3BuiltinPartGridScale,
} from './v3AegisSuitParts';
import { selectV3LodLevel } from './v3Lod';
import type { V3CharacterSlotId, V3WeaponId } from './v3ModelTypes';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
} from './v3PaintPalette';
import {
  normalizeV3ArmorRenderStyle,
  normalizeV3QualityTier,
  type V3RenderOptions,
} from './v3QualityTiers';
import {
  V3_DETAIL_BONE_NAMES,
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';
import {
  V3_ARMOR_SURFACE_BASE_VOXEL_SCALE,
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  createV3VoxelArmorGroup,
} from './v3VoxelArmorSurface';

export interface V3SpartanBuildOptions extends V3RenderOptions {
  isEnemy?: boolean;
  customHue?: number;
  loadout?: CharacterLoadout;
}

export interface V3WeaponBuildOptions extends V3RenderOptions {
  customHue?: number;
  loadout?: CharacterLoadout;
}

const V3_WEAPON_SCALE = 0.06;

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

export function getV3BuiltinPartVoxels(
  slot: V3CharacterSlotId,
  customHue?: number,
  paintJob?: CharacterLoadout['paintJob'],
  options: { gridScale?: V3BuiltinPartGridScale; qualityTier?: V3RenderOptions['v3QualityTier'] } = {}
): VoxelData[] {
  const part = BUILT_IN_V3_CHARACTER_PARTS.find((candidate) => candidate.slot === slot);
  if (!part) {
    throw new Error(`Missing built-in V3 part for ${slot}`);
  }
  const gridScale = options.gridScale ?? getV3BuiltinPartGridScale(slot);
  return createV3AegisPartVoxels(
    part,
    scaleV3Dimensions(getV3AegisPartSpec(slot).dimensions, gridScale),
    createColors(false, customHue),
    paintJob,
    { qualityTier: normalizeV3QualityTier(options.qualityTier) }
  );
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

export {
  getV3AegisObjSurfaceSourceSummary,
  getV3BuiltinPartGridScale,
  getV3BuiltinPartVoxelScale,
} from './v3AegisSuitParts';

const createSegmentGroups = (): Record<V3AegisPartSpec['segment'], THREE.Group> => ({
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
  segmentGroups: Record<V3AegisPartSpec['segment'], THREE.Group>
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
  spec: V3AegisPartSpec
): THREE.Vector3Tuple => {
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  return subtractVec3Tuple(spec.position, V3_DETAIL_BONE_SPECS[boneName].position);
};

export function buildV3SpartanModel(options: V3SpartanBuildOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'v3SpartanRoot';
  root.userData.modelSystem = 'v3';

  const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
  const v3ArmorRenderStyle = normalizeV3ArmorRenderStyle(options.v3ArmorRenderStyle);
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
    const spec = getV3AegisPartSpec(part.slot);
    const customPiece = getValidV3CustomPiece(options.loadout, part.slot);
    const gridScale = customPiece ? getCustomArmorGridScale(customPiece) : getV3BuiltinPartGridScale(part.slot);
    const voxelScale = customPiece
      ? V3_ARMOR_SURFACE_BASE_VOXEL_SCALE / gridScale
      : getV3BuiltinPartVoxelScale(part.slot);
    const voxels = customPiece
      ? customArmorPieceToVoxels(customPiece, customArmorColors)
      : createV3AegisPartVoxels(
        part,
        scaleV3Dimensions(spec.dimensions, gridScale),
        colors,
        paintJob,
        { qualityTier: v3QualityTier }
      );
    const group = createV3VoxelArmorGroup(voxels, {
      ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
      voxelScale,
      renderStyle: v3ArmorRenderStyle,
      qualityTier: v3QualityTier,
    });
    const selectedLod = selectV3LodLevel({
      lods: part.lods,
      qualityTier: v3QualityTier,
      distance: v3Distance,
    });
    group.name = `v3:${part.slot}`;
    group.position.set(...(customPiece ? getV3PartLocalPosition(part.slot, spec) : [0, 0, 0] as THREE.Vector3Tuple));
    group.userData.v3PartId = part.id;
    group.userData.v3Slot = part.slot;
    group.userData.v3BoundsId = part.boundsId;
    group.userData.v3QualityTier = v3QualityTier;
    group.userData.v3Distance = v3Distance;
    group.userData.v3SelectedLod = selectedLod;
    group.userData.v3GridScale = gridScale;
    group.userData.v3ObjSurfaceSource = !customPiece;
    group.userData.v3ExactSourceLodQualityTier = customPiece ? undefined : v3QualityTier;
    group.userData.v3VoxelScale = voxelScale;
    if (customPiece) {
      group.userData.customArmorId = customPiece.id;
      group.userData.customArmorName = customPiece.name;
      group.userData.customArmorGridScale = gridScale;
    }
    detailBones[V3_SLOT_DETAIL_BONES[part.slot]].add(group);
    partGroups[part.slot] = group;
  }

  root.userData.v3CharacterLoadout = loadout;
  root.userData.v3QualityTier = v3QualityTier;
  root.userData.v3Distance = v3Distance;
  root.userData.v3ArmorRenderStyle = v3ArmorRenderStyle;
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
