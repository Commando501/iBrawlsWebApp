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
  getV3BuiltinPartGridScale,
  getV3BuiltinPartVoxelScale,
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
  normalizeV3SourceFidelity,
  type V3RenderOptions,
} from './v3QualityTiers';
import { applyV3ExactSourceRigBinding } from './v3ExactSourceRigBinding';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import { applyV3LowerBodyChainBinding } from './v3LowerBodyChain';
import { captureV3LowerBodyRestSeamBaselines } from './v3LowerBodyContinuity';
import { createV3LowerBodyJointBridges } from './v3LowerBodyJointBridges';
import {
  applyV3CanonicalRigContract,
  deriveV3CanonicalRigContract,
  type V3CanonicalRigContract,
} from './v3CanonicalRigContract';
import { buildV3Mesh2MotionArmorRig } from './v3Mesh2MotionArmorRig';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import {
  V3_MESH2MOTION_NATIVE_RENDER_VOXEL_SCALE,
  getV3Mesh2MotionNativeSlotDimensions,
  getV3Mesh2MotionNativeVoxelPivot,
} from './v3Mesh2MotionNativeGeometry';
import { applyV3WeaponScaleProfile } from './v3WeaponScaleProfile';
import {
  V3_DETAIL_BONE_NAMES,
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';
import {
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
let v3RenderedBodyWeaponScaleBoundsCache: THREE.Box3 | null = null;

const createV3RenderedBodyWeaponScaleBounds = (): THREE.Box3 => {
  if (!v3RenderedBodyWeaponScaleBoundsCache) {
    const body = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    body.updateMatrixWorld(true);
    v3RenderedBodyWeaponScaleBoundsCache = new THREE.Box3().setFromObject(body);
  }
  return v3RenderedBodyWeaponScaleBoundsCache.clone();
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

const captureV3AnimationRestPosition = (group: THREE.Group): void => {
  group.userData.v3AnimationRestPosition = [
    group.position.x,
    group.position.y,
    group.position.z,
  ];
};

export function getV3BuiltinPartVoxels(
  slot: V3CharacterSlotId,
  customHue?: number,
  paintJob?: CharacterLoadout['paintJob'],
  options: {
    gridScale?: V3BuiltinPartGridScale;
    qualityTier?: V3RenderOptions['v3QualityTier'];
    sourceFidelity?: V3RenderOptions['v3SourceFidelity'];
  } = {}
): VoxelData[] {
  const part = BUILT_IN_V3_CHARACTER_PARTS.find((candidate) => candidate.slot === slot);
  if (!part) {
    throw new Error(`Missing built-in V3 part for ${slot}`);
  }
  return createV3AegisPartVoxels(
    part,
    getV3Mesh2MotionNativeSlotDimensions(slot),
    createColors(false, customHue),
    paintJob,
    {
      qualityTier: normalizeV3QualityTier(options.qualityTier),
      sourceFidelity: normalizeV3SourceFidelity(options.sourceFidelity, 'exact'),
    }
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

const lerpVec3Tuple = (
  from: THREE.Vector3Tuple,
  to: THREE.Vector3Tuple,
  amount: number
): THREE.Vector3Tuple => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];

const vec3Tuple = (value: readonly number[]): THREE.Vector3Tuple => [
  value[0] ?? 0,
  value[1] ?? 0,
  value[2] ?? 0,
];

const createCanonicalDetailBonePositions = (
  contract: V3CanonicalRigContract
): Record<V3DetailBoneName, THREE.Vector3Tuple> => {
  const pelvis = vec3Tuple(contract.joints.pelvis.position);
  const chest = vec3Tuple(contract.joints.chest.position);
  return {
    pelvis,
    spine1: lerpVec3Tuple(pelvis, chest, 0.25),
    spine2: lerpVec3Tuple(pelvis, chest, 0.52),
    spine3: lerpVec3Tuple(pelvis, chest, 0.78),
    chest,
    neck: vec3Tuple(contract.joints.neck.position),
    head: vec3Tuple(contract.joints.head.position),
    helmet: vec3Tuple(contract.slotPivots.helmet.position),
    collar: vec3Tuple(contract.slotPivots.neck.position),
    backpack: vec3Tuple(contract.slotPivots.back.position),
    clavicleLeft: vec3Tuple(contract.joints.shoulderLeft.position),
    upperArmLeft: vec3Tuple(contract.joints.shoulderLeft.position),
    forearmLeft: vec3Tuple(contract.joints.elbowLeft.position),
    handLeft: vec3Tuple(contract.joints.wristLeft.position),
    gripLeft: vec3Tuple(contract.joints.gripLeft.position),
    clavicleRight: vec3Tuple(contract.joints.shoulderRight.position),
    upperArmRight: vec3Tuple(contract.joints.shoulderRight.position),
    forearmRight: vec3Tuple(contract.joints.elbowRight.position),
    handRight: vec3Tuple(contract.joints.wristRight.position),
    gripRight: vec3Tuple(contract.joints.gripRight.position),
    thighLeft: vec3Tuple(contract.joints.hipLeft.position),
    calfLeft: vec3Tuple(contract.joints.kneeLeft.position),
    footLeft: vec3Tuple(contract.joints.ankleLeft.position),
    toeLeft: vec3Tuple(contract.joints.toeLeft.position),
    thighRight: vec3Tuple(contract.joints.hipRight.position),
    calfRight: vec3Tuple(contract.joints.kneeRight.position),
    footRight: vec3Tuple(contract.joints.ankleRight.position),
    toeRight: vec3Tuple(contract.joints.toeRight.position),
  };
};

const createV3DetailBones = (
  segmentGroups: Record<V3AegisPartSpec['segment'], THREE.Group>,
  canonicalPositions?: Record<V3DetailBoneName, THREE.Vector3Tuple>
): V3DetailBoneMap => {
  const bones = {} as V3DetailBoneMap;

  for (const boneName of V3_DETAIL_BONE_NAMES) {
    const spec = V3_DETAIL_BONE_SPECS[boneName];
    const position = canonicalPositions?.[boneName] ?? spec.position;
    const bone = new THREE.Group();
    bone.name = `v3bone:${boneName}`;
    bone.userData.v3DetailBoneName = boneName;
    bone.userData.v3ReferenceBoneName = spec.referenceBone;
    bone.userData.v3ReferencePosition = [...spec.position];
    bone.userData.v3CanonicalPosition = [...position];

    const parent = spec.parent ? bones[spec.parent] : segmentGroups[spec.segment];
    const parentPosition = spec.parent
      ? canonicalPositions?.[spec.parent] ?? V3_DETAIL_BONE_SPECS[spec.parent].position
      : [0, 0, 0] as THREE.Vector3Tuple;

    bone.position.fromArray(subtractVec3Tuple(position, parentPosition));
    parent.add(bone);
    bones[boneName] = bone;
  }

  return bones;
};

const getV3PartLocalPosition = (
  slot: V3CharacterSlotId,
  spec: V3AegisPartSpec,
  detailBonePositions?: Record<V3DetailBoneName, THREE.Vector3Tuple>,
  isBuiltInExactSource = false
): THREE.Vector3Tuple => {
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  const bonePosition = detailBonePositions?.[boneName] ?? V3_DETAIL_BONE_SPECS[boneName].position;
  const sourcePosition = isBuiltInExactSource
    ? V3_DETAIL_BONE_SPECS[boneName].position
    : spec.position;
  return subtractVec3Tuple(sourcePosition, bonePosition);
};

const applyV3SlotGeometryPlacement = (
  geometryGroup: THREE.Group,
  placement: {
    position: readonly number[];
    rotation: readonly number[];
    scale: readonly number[];
  }
): void => {
  geometryGroup.position.set(
    Number.isFinite(placement.position[0]) ? placement.position[0] : 0,
    Number.isFinite(placement.position[1]) ? placement.position[1] : 0,
    Number.isFinite(placement.position[2]) ? placement.position[2] : 0
  );
  geometryGroup.rotation.set(
    Number.isFinite(placement.rotation[0]) ? placement.rotation[0] : 0,
    Number.isFinite(placement.rotation[1]) ? placement.rotation[1] : 0,
    Number.isFinite(placement.rotation[2]) ? placement.rotation[2] : 0,
    'XYZ'
  );
  geometryGroup.scale.set(
    Number.isFinite(placement.scale[0]) ? placement.scale[0] : 1,
    Number.isFinite(placement.scale[1]) ? placement.scale[1] : 1,
    Number.isFinite(placement.scale[2]) ? placement.scale[2] : 1
  );
};

const getV3ExactSourceVisualOffset = (
  slot: V3CharacterSlotId,
  slotPivot: THREE.Object3D
): THREE.Vector3Tuple => {
  const boneName = V3_SLOT_DETAIL_BONES[slot];
  const sourceOrigin = V3_DETAIL_BONE_SPECS[boneName].position;
  return subtractVec3Tuple(sourceOrigin, slotPivot.position.toArray());
};

const V3_CACHE_PAINT_ROLES = [
  'primary',
  'secondary',
  'accent',
  'visor',
  'undersuit',
  'emissive',
  'decal',
  'fixed',
] as const;

const createV3BuiltInGeometryCacheKey = (
  slot: V3CharacterSlotId,
  sourceFidelity: V3RenderOptions['v3SourceFidelity'],
  qualityTier: V3RenderOptions['v3QualityTier'],
  renderStyle: V3RenderOptions['v3ArmorRenderStyle'],
  colors: SpartanColors,
  paintJob: CharacterLoadout['paintJob'] | undefined
): string => [
  'v3-mesh2motion-exact-visual',
  V3_MESH2MOTION_ARMOR_RIG.source.sha256,
  V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash,
  slot,
  sourceFidelity ?? 'runtimeLod',
  qualityTier ?? 'desktop',
  renderStyle ?? 'armorSurface',
  JSON.stringify(Object.fromEntries(V3_CACHE_PAINT_ROLES.map((role) => [
    role,
    roleColor(role, colors, paintJob),
  ]))),
  JSON.stringify(Object.fromEntries(V3_CACHE_PAINT_ROLES.map((role) => [
    role,
    roleEmissive(role, paintJob, false),
  ]))),
].join('|');

export function buildV3SpartanModel(options: V3SpartanBuildOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'v3SpartanRoot';
  root.userData.modelSystem = 'v3';

  const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
  const v3ArmorRenderStyle = normalizeV3ArmorRenderStyle(options.v3ArmorRenderStyle);
  const v3SourceFidelity = normalizeV3SourceFidelity(options.v3SourceFidelity);
  const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
  const loadout = getDefaultV3CharacterLoadout();
  const colors = createColors(options.isEnemy, options.customHue);
  const paintJob = options.loadout?.paintJob;
  const customArmorColors = createCustomArmorColors(colors, paintJob);
  const segmentGroups = createSegmentGroups();
  const canonicalRigContract = deriveV3CanonicalRigContract();
  const canonicalDetailBonePositions = createCanonicalDetailBonePositions(canonicalRigContract);
  const detailBones = createV3DetailBones(segmentGroups, canonicalDetailBonePositions);
  const mesh2MotionArmorRig = buildV3Mesh2MotionArmorRig();
  const partGroups: Partial<Record<V3CharacterSlotId, THREE.Group>> = {};
  const partGeometryGroups: Partial<Record<V3CharacterSlotId, THREE.Group>> = {};
  const exactSourceVoxelPivot: THREE.Vector3Tuple = [0, 0, 0];

  root.add(mesh2MotionArmorRig.skeletonRoot);
  root.add(mesh2MotionArmorRig.armorSlotRoot);

  for (const [segmentName, segment] of Object.entries(segmentGroups)) {
    segment.name = `v3:${segmentName}`;
    root.add(segment);
  }

  for (const part of BUILT_IN_V3_CHARACTER_PARTS) {
    const customPiece = getValidV3CustomPiece(options.loadout, part.slot);
    const gridScale = customPiece ? getCustomArmorGridScale(customPiece) : getV3BuiltinPartGridScale(part.slot);
    const voxelScale = customPiece
      ? V3_MESH2MOTION_NATIVE_RENDER_VOXEL_SCALE
      : getV3BuiltinPartVoxelScale(part.slot);
    const voxels = customPiece
      ? customArmorPieceToVoxels(customPiece, customArmorColors)
      : createV3AegisPartVoxels(
        part,
        getV3Mesh2MotionNativeSlotDimensions(part.slot),
        colors,
        paintJob,
        { qualityTier: v3QualityTier, sourceFidelity: v3SourceFidelity }
      );
    const geometryGroup = createV3VoxelArmorGroup(voxels, {
      ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
      voxelScale,
      pivot: customPiece ? getV3Mesh2MotionNativeVoxelPivot(part.slot) : exactSourceVoxelPivot,
      renderStyle: v3ArmorRenderStyle,
      qualityTier: v3QualityTier,
      builtInGeometryCacheKey: customPiece ? undefined : createV3BuiltInGeometryCacheKey(
        part.slot,
        v3SourceFidelity,
        v3QualityTier,
        v3ArmorRenderStyle,
        colors,
        paintJob
      ),
    });
    const slotPivot = mesh2MotionArmorRig.slotPivots[part.slot];
    const slotPlacement = slotPivot.userData.v3Mesh2MotionSlotPlacement as
      | { geometry?: { position: readonly number[]; rotation: readonly number[]; scale: readonly number[] } }
      | undefined;
    applyV3SlotGeometryPlacement(geometryGroup, slotPlacement?.geometry ?? {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const exactSourceVisualOffset = customPiece
      ? undefined
      : getV3ExactSourceVisualOffset(part.slot, slotPivot);
    if (exactSourceVisualOffset) {
      geometryGroup.position.add(new THREE.Vector3().fromArray(exactSourceVisualOffset));
    }
    const selectedLod = selectV3LodLevel({
      lods: part.lods,
      qualityTier: v3QualityTier,
      distance: v3Distance,
    });
    const surfaceBudget = geometryGroup.userData.v3ArmorSurface as
      | { inputVoxelCount?: number; panelCount?: number; materialGroupCount?: number }
      | undefined;
    const selectedLodWithMeasuredBudget = customPiece
      ? selectedLod
      : {
        ...selectedLod,
        id: `${selectedLod.id}:mesh2motion-exact-visual:${v3SourceFidelity}`,
        sourceId: `${selectedLod.sourceId}:mesh2motion-exact-visual:${v3SourceFidelity}`,
        qualityTier: v3QualityTier,
        budget: {
          sourceVoxelCount: surfaceBudget?.inputVoxelCount ?? voxels.length,
          mergedBoxCount: surfaceBudget?.panelCount ?? selectedLod.budget.mergedBoxCount,
          materialGroupCount: surfaceBudget?.materialGroupCount ?? selectedLod.budget.materialGroupCount,
          drawCallEstimate: surfaceBudget?.materialGroupCount ?? selectedLod.budget.drawCallEstimate,
          lodCount: selectedLod.budget.lodCount,
          memoryEstimateKb: Math.max(1, Math.ceil((surfaceBudget?.inputVoxelCount ?? voxels.length) * 0.08)),
        },
      };
    geometryGroup.name = `v3:${part.slot}:geometry`;
    const partMetadata = {
      v3PartId: part.id,
      v3Slot: part.slot,
      v3BoundsId: part.boundsId,
      v3QualityTier,
      v3Distance,
      v3SelectedLod: selectedLodWithMeasuredBudget,
      v3GridScale: gridScale,
      v3ObjSurfaceSource: !customPiece,
      v3ExactSourceLodQualityTier: undefined,
      v3SourceFidelity: customPiece ? undefined : v3SourceFidelity,
      v3VoxelScale: voxelScale,
      v3Mesh2MotionNativeGeometry: Boolean(customPiece),
      v3Mesh2MotionVisualSource: customPiece ? 'custom-native-slot-local' : 'exact-obj-surface',
      v3ExactSourceVisualOffset: exactSourceVisualOffset,
      v3NativeSlotDimensions: getV3Mesh2MotionNativeSlotDimensions(part.slot),
      v3NativeVoxelPivot: getV3Mesh2MotionNativeVoxelPivot(part.slot),
      v3VisualVoxelPivot: customPiece ? getV3Mesh2MotionNativeVoxelPivot(part.slot) : exactSourceVoxelPivot,
    };
    Object.assign(slotPivot.userData, geometryGroup.userData, partMetadata, {
      v3Mesh2MotionSlotPivot: true,
      v3Mesh2MotionSlotGeometry: geometryGroup,
      v3Mesh2MotionPlacementAuthority: 'mesh2motion-tpose',
      v3RenderBudgetProxyOnly: true,
      v3LegacyDetailBone: V3_SLOT_DETAIL_BONES[part.slot],
    });
    Object.assign(geometryGroup.userData, partMetadata, {
      v3Mesh2MotionSlotGeometry: true,
      v3Mesh2MotionSlotPivot: slotPivot,
      v3Mesh2MotionPlacementAuthority: 'mesh2motion-tpose',
      v3LegacyDetailBone: V3_SLOT_DETAIL_BONES[part.slot],
    });
    if (customPiece) {
      slotPivot.userData.customArmorId = customPiece.id;
      slotPivot.userData.customArmorName = customPiece.name;
      slotPivot.userData.customArmorGridScale = gridScale;
      geometryGroup.userData.customArmorId = customPiece.id;
      geometryGroup.userData.customArmorName = customPiece.name;
      geometryGroup.userData.customArmorGridScale = gridScale;
    }
    slotPivot.add(geometryGroup);
    detailBones[V3_SLOT_DETAIL_BONES[part.slot]].userData.v3Mesh2MotionSlotPivot = slotPivot;
    detailBones[V3_SLOT_DETAIL_BONES[part.slot]].userData.v3Mesh2MotionSlotGeometry = geometryGroup;
    partGroups[part.slot] = slotPivot;
    partGeometryGroups[part.slot] = geometryGroup;
  }

  root.userData.v3CharacterLoadout = loadout;
  root.userData.v3QualityTier = v3QualityTier;
  root.userData.v3Distance = v3Distance;
  root.userData.v3ArmorRenderStyle = v3ArmorRenderStyle;
  root.userData.v3SourceFidelity = v3SourceFidelity;
  root.userData.v3Mesh2MotionPlacementMode = 'mesh2motion-native';
  root.userData.v3PartGroups = partGroups;
  root.userData.v3PartGeometryGroups = partGeometryGroups;
  root.userData.v3DetailBones = detailBones;
  root.userData.v3Mesh2MotionArmorRig = {
    skeletonRoot: mesh2MotionArmorRig.skeletonRoot,
    armorSlotRoot: mesh2MotionArmorRig.armorSlotRoot,
    joints: mesh2MotionArmorRig.joints,
    slotPivots: mesh2MotionArmorRig.slotPivots,
  };
  root.userData.v3Mesh2MotionSkeletonRoot = mesh2MotionArmorRig.skeletonRoot;
  root.userData.v3ArmorSlotRoot = mesh2MotionArmorRig.armorSlotRoot;
  root.userData.v3Mesh2MotionJoints = mesh2MotionArmorRig.joints;
  root.userData.v3Mesh2MotionSlotPivots = mesh2MotionArmorRig.slotPivots;
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
  captureV3AnimationRestPosition(root.userData.lowerTorso);
  captureV3AnimationRestPosition(root.userData.leftLeg);
  captureV3AnimationRestPosition(root.userData.rightLeg);
  root.userData.v3AttachmentOffsets = {
    thirdPersonWeaponGrip: [0.08, -0.08, 0.02],
    thirdPersonOffhandGrip: [-0.08, -0.08, 0.02],
    rightHandGrip: [0.08, -0.08, 0.02],
    leftHandGrip: [-0.08, -0.08, 0.02],
  };
  applyV3CanonicalRigContract(root, canonicalRigContract);
  applyV3ExactSourceRigBinding(root);
  applyV3LowerBodyChainBinding(root);
  root.updateMatrixWorld(true);
  root.userData.v3LowerBodyRestSeamBaselines = captureV3LowerBodyRestSeamBaselines(root);
  const lowerBodyJointBridges = createV3LowerBodyJointBridges();
  root.userData.v3LowerBodyJointBridges = lowerBodyJointBridges;
  root.add(lowerBodyJointBridges.root);

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
    // V1-themed gravity hammer: slim wrapped haft, compact pommel, and a
    // front energy strike face sized for V3 hands.
    const emissive = (x: number, y: number, z: number, role: 'emissive' | 'accent') =>
      voxels.push({
        x,
        y,
        z,
        color: roleColor(role, colors, paintJob),
        emissive: roleEmissive(role, paintJob, true),
      });

    addTranslatedBox(voxels, [3, 3, 3], [-1, 0, -1], roleColor('fixed', colors, paintJob));
    addTranslatedBox(voxels, [3, 23, 3], [-1, 2, -1], roleColor('undersuit', colors, paintJob));
    for (let y = 4; y <= 17; y += 3) {
      addTranslatedBox(voxels, [3, 1, 3], [-1, y, -1], roleColor('secondary', colors, paintJob));
    }

    addTranslatedBox(voxels, [5, 2, 5], [-2, 22, -2], roleColor('fixed', colors, paintJob));
    addTranslatedBox(voxels, [7, 1, 7], [-3, 24, -3], roleColor('secondary', colors, paintJob));

    for (let hx = -2; hx <= 2; hx++) {
      for (let hy = 25; hy <= 31; hy++) {
        for (let hz = -4; hz <= -1; hz++) {
          const edge = Math.abs(hx) === 2 || hy === 25 || hy === 31 || hz === -4;
          voxels.push({
            x: hx,
            y: hy,
            z: hz,
            color: edge ? roleColor('secondary', colors, paintJob) : roleColor('primary', colors, paintJob),
          });
        }
      }
    }

    for (let hy = 26; hy <= 30; hy++) {
      for (let hz = 1; hz <= 3; hz++) {
        const rearEdge = hz === 3 || hy === 26 || hy === 30;
        voxels.push({
          x: 0,
          y: hy,
          z: hz,
          color: rearEdge ? roleColor('fixed', colors, paintJob) : roleColor('secondary', colors, paintJob),
        });
      }
      voxels.push({ x: -1, y: hy, z: 1, color: roleColor('fixed', colors, paintJob) });
      voxels.push({ x: 1, y: hy, z: 1, color: roleColor('fixed', colors, paintJob) });
    }

    for (let hy = 27; hy <= 29; hy++) {
      for (let hx = -1; hx <= 1; hx++) {
        emissive(hx, hy, -5, 'emissive');
      }
    }
    for (let hy = 25; hy <= 31; hy++) {
      emissive(-3, hy, -1, 'accent');
      emissive(3, hy, -1, 'accent');
    }
    for (let y = 18; y <= 23; y += 2) {
      emissive(0, y, -2, 'emissive');
    }
    for (let x = -1; x <= 1; x++) {
      emissive(x, 1, 2, 'accent');
    }
    addTranslatedBox(voxels, [5, 2, 5], [-2, 33, -2], roleColor('fixed', colors, paintJob));
    return voxels;
  }
  if (weapon === 'sword') {
    // V1-themed energy katar: compact H-frame grip and centered tapered blade.
    const blade = (x: number, y: number, role: 'emissive' | 'accent') =>
      voxels.push({
        x,
        y,
        z: 1,
        color: roleColor(role, colors, paintJob),
        emissive: roleEmissive(role, paintJob, true),
      });

    addTranslatedBox(voxels, [3, 1, 3], [-1, 0, 0], roleColor('secondary', colors, paintJob));
    addTranslatedBox(voxels, [1, 9, 3], [-1, 1, 0], roleColor('primary', colors, paintJob));
    addTranslatedBox(voxels, [1, 9, 3], [1, 1, 0], roleColor('primary', colors, paintJob));
    addTranslatedBox(voxels, [3, 1, 3], [-1, 3, 0], roleColor('undersuit', colors, paintJob));
    addTranslatedBox(voxels, [3, 1, 3], [-1, 6, 0], roleColor('undersuit', colors, paintJob));
    addTranslatedBox(voxels, [7, 2, 3], [-3, 9, 0], roleColor('fixed', colors, paintJob));
    addTranslatedBox(voxels, [5, 1, 3], [-2, 11, 0], roleColor('accent', colors, paintJob));

    for (let y = 12; y <= 27; y++) {
      let half = 0;
      if (y <= 14) half = 3;
      else if (y <= 18) half = 2;
      else if (y <= 22) half = 1;

      for (let x = -half; x <= half; x++) {
        const edge = x === -half || x === half || y === 27;
        blade(x, y, edge ? 'accent' : 'emissive');
      }
    }
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
  group.userData.v3WeaponSemanticAxes = manifest.semanticAxes;
  group.userData.v3QualityTier = v3QualityTier;
  group.userData.v3Distance = v3Distance;
  group.userData.v3SelectedLod = selectedLod;
  applyV3WeaponScaleProfile(group, weapon, (
    weapon === 'hammer' || weapon === 'sword'
      ? { bodyBounds: createV3RenderedBodyWeaponScaleBounds() }
      : {}
  ));

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
