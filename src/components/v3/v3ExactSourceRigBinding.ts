import type * as THREE from 'three';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3Vec3Tuple,
} from './v3ModelTypes';
import {
  V3_DETAIL_BONE_SPECS,
  V3_SLOT_DETAIL_BONES,
  type V3DetailBoneName,
} from './v3RigDetail';
import type { V3ExactSource } from './v3ExactSourceLod';
import type { V3CanonicalRigContract } from './v3CanonicalRigContract';

type V3ExactSourceSlotBounds = V3ExactSource['slots'][V3CharacterSlotId]['bounds'];

export interface V3ExactSourceSlotRigBinding {
  slot: V3CharacterSlotId;
  detailBone: V3DetailBoneName;
  referenceBone: string;
  bounds: {
    min: V3Vec3Tuple;
    max: V3Vec3Tuple;
    size: V3Vec3Tuple;
  };
  sourceCenterVoxel: V3Vec3Tuple;
  sourceCenterWorld: V3Vec3Tuple;
  detailBonePosition: V3Vec3Tuple;
  offsetFromDetailBone: V3Vec3Tuple;
  attachmentOffset: V3Vec3Tuple;
}

export interface V3ExactSourceRigBinding {
  kind: 'v3-exact-source-rig-binding';
  version: 1;
  sourceHash: string;
  voxelScale: number;
  sourcePivot: V3Vec3Tuple;
  slots: Record<V3CharacterSlotId, V3ExactSourceSlotRigBinding>;
}

export interface V3RigContinuitySlotReport {
  slot: V3CharacterSlotId;
  detailBone: V3DetailBoneName;
  ready: boolean;
  issues: string[];
  attachmentOffsetMagnitude: number;
}

export interface V3RigContinuityReport {
  kind: 'v3-rig-continuity';
  version: 1;
  ready: boolean;
  sourceHash: string | null;
  boundSlotCount: number;
  maxAttachmentOffsetMagnitude: number;
  issues: string[];
  slots: Record<V3CharacterSlotId, V3RigContinuitySlotReport>;
}

type V3PartGroupMap = Partial<Record<V3CharacterSlotId, THREE.Object3D>>;
type V3DetailBoneMap = Partial<Record<V3DetailBoneName, THREE.Object3D>>;

const roundFinite = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(6));
};

const cloneVec3 = (value: readonly number[]): V3Vec3Tuple => [
  roundFinite(value[0] ?? 0),
  roundFinite(value[1] ?? 0),
  roundFinite(value[2] ?? 0),
];

const subtractVec3 = (left: V3Vec3Tuple, right: V3Vec3Tuple): V3Vec3Tuple => [
  roundFinite(left[0] - right[0]),
  roundFinite(left[1] - right[1]),
  roundFinite(left[2] - right[2]),
];

const vec3Magnitude = (value: V3Vec3Tuple): number =>
  roundFinite(Math.hypot(value[0], value[1], value[2]));

const sortedSlots = (): V3CharacterSlotId[] =>
  [...V3_CHARACTER_SLOT_IDS].sort((left, right) => left.localeCompare(right));

const cloneBounds = (bounds: V3ExactSourceSlotBounds): V3ExactSourceSlotRigBinding['bounds'] => ({
  min: cloneVec3(bounds.min),
  max: cloneVec3(bounds.max),
  size: cloneVec3(bounds.size),
});

const deriveSlotCenterVoxel = (bounds: V3ExactSourceSlotBounds): V3Vec3Tuple => [
  roundFinite((bounds.min[0] + bounds.max[0]) / 2),
  roundFinite((bounds.min[1] + bounds.max[1]) / 2),
  roundFinite((bounds.min[2] + bounds.max[2]) / 2),
];

const deriveSlotCenterWorld = (
  centerVoxel: V3Vec3Tuple,
  source: V3ExactSource
): V3Vec3Tuple => {
  const pivot = source.coordinateSystem.pivot;
  const voxelScale = source.coordinateSystem.voxelScale;

  return [
    roundFinite((centerVoxel[0] - pivot[0]) * voxelScale),
    roundFinite(centerVoxel[1] * voxelScale),
    roundFinite((centerVoxel[2] - pivot[2]) * voxelScale),
  ];
};

function findPartGroup(model: THREE.Object3D, slot: V3CharacterSlotId): THREE.Object3D | undefined {
  const partGroups = model.userData.v3PartGroups as V3PartGroupMap | undefined;
  if (partGroups?.[slot]) return partGroups[slot];

  let found: THREE.Object3D | undefined;
  model.traverse((object) => {
    if (!found && object.userData.v3Slot === slot) {
      found = object;
    }
  });
  return found;
}

export function deriveV3ExactSourceRigBinding(
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3ExactSourceRigBinding {
  const slots = {} as Record<V3CharacterSlotId, V3ExactSourceSlotRigBinding>;

  for (const slot of sortedSlots()) {
    const sourceSlot = source.slots[slot];
    const detailBone = V3_SLOT_DETAIL_BONES[slot];
    const detailBoneSpec = V3_DETAIL_BONE_SPECS[detailBone];
    const sourceCenterVoxel = deriveSlotCenterVoxel(sourceSlot.bounds);
    const sourceCenterWorld = deriveSlotCenterWorld(sourceCenterVoxel, source);
    const detailBonePosition = cloneVec3(detailBoneSpec.position);
    const offsetFromDetailBone = subtractVec3(sourceCenterWorld, detailBonePosition);

    slots[slot] = {
      slot,
      detailBone,
      referenceBone: detailBoneSpec.referenceBone,
      bounds: cloneBounds(sourceSlot.bounds),
      sourceCenterVoxel,
      sourceCenterWorld,
      detailBonePosition,
      offsetFromDetailBone,
      attachmentOffset: offsetFromDetailBone,
    };
  }

  return {
    kind: 'v3-exact-source-rig-binding',
    version: 1,
    sourceHash: source.source.hash,
    voxelScale: roundFinite(source.coordinateSystem.voxelScale),
    sourcePivot: cloneVec3(source.coordinateSystem.pivot),
    slots,
  };
}

export function applyV3ExactSourceRigBinding(model: THREE.Object3D): V3ExactSourceRigBinding {
  const binding = deriveV3ExactSourceRigBinding();
  const canonicalContract = model.userData.v3CanonicalRigContract as V3CanonicalRigContract | undefined;
  const attachmentOffset = (slot: V3CharacterSlotId): V3Vec3Tuple =>
    canonicalContract?.slotGeometryOffsets[slot]?.offsetFromPivot ?? binding.slots[slot].attachmentOffset;
  model.userData.v3ExactSourceRigBinding = binding;
  model.userData.v3AttachmentOffsets = {
    ...(model.userData.v3AttachmentOffsets ?? {}),
    thirdPersonWeaponGrip: attachmentOffset('handRight'),
    thirdPersonOffhandGrip: attachmentOffset('handLeft'),
    rightHandGrip: attachmentOffset('handRight'),
    leftHandGrip: attachmentOffset('handLeft'),
  };

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const partGroup = findPartGroup(model, slot);
    if (!partGroup) continue;
    const slotBinding = binding.slots[slot];
    partGroup.userData.v3ExactSourceRigBinding = slotBinding;
    partGroup.userData.v3ExactSourceDetailBone = slotBinding.detailBone;
    partGroup.userData.v3ExactSourceOffsetFromDetailBone = slotBinding.offsetFromDetailBone;
    partGroup.userData.v3ExactSourceAttachmentOffset = attachmentOffset(slot);
  }

  return binding;
}

export function analyzeV3RigContinuity(model: THREE.Object3D): V3RigContinuityReport {
  const binding = model.userData.v3ExactSourceRigBinding as V3ExactSourceRigBinding | undefined;
  const partGroups = model.userData.v3PartGroups as V3PartGroupMap | undefined;
  const detailBones = model.userData.v3DetailBones as V3DetailBoneMap | undefined;
  const issues: string[] = [];
  const slots = {} as Record<V3CharacterSlotId, V3RigContinuitySlotReport>;
  let boundSlotCount = 0;
  let maxAttachmentOffsetMagnitude = 0;

  if (!binding) issues.push('model is missing v3ExactSourceRigBinding metadata');
  if (!detailBones) issues.push('model is missing v3DetailBones metadata');
  if (!partGroups) issues.push('model is missing v3PartGroups metadata');

  for (const slot of sortedSlots()) {
    const detailBone = V3_SLOT_DETAIL_BONES[slot];
    const slotIssues: string[] = [];
    const slotBinding = binding?.slots[slot];
    const partGroup = findPartGroup(model, slot);
    const detailBoneGroup = detailBones?.[detailBone];

    if (!slotBinding) slotIssues.push(`${slot} is missing exact-source binding metadata`);
    if (!partGroup) slotIssues.push(`${slot} is missing part group`);
    if (!detailBoneGroup) slotIssues.push(`${slot} detail bone ${detailBone} is missing`);
    if (slotBinding && slotBinding.detailBone !== detailBone) {
      slotIssues.push(`${slot} is bound to ${slotBinding.detailBone}; expected ${detailBone}`);
    }
    if (partGroup && slotBinding && partGroup.userData.v3ExactSourceRigBinding !== slotBinding) {
      slotIssues.push(`${slot} part group is not linked to the model binding`);
    }

    const attachmentOffsetMagnitude = slotBinding
      ? vec3Magnitude(slotBinding.attachmentOffset)
      : 0;
    maxAttachmentOffsetMagnitude = Math.max(maxAttachmentOffsetMagnitude, attachmentOffsetMagnitude);
    if (slotBinding && partGroup && detailBoneGroup && slotIssues.length === 0) {
      boundSlotCount += 1;
    }

    slots[slot] = {
      slot,
      detailBone,
      ready: slotIssues.length === 0,
      issues: slotIssues,
      attachmentOffsetMagnitude,
    };
    issues.push(...slotIssues);
  }

  return {
    kind: 'v3-rig-continuity',
    version: 1,
    ready: issues.length === 0,
    sourceHash: binding?.sourceHash ?? null,
    boundSlotCount,
    maxAttachmentOffsetMagnitude: roundFinite(maxAttachmentOffsetMagnitude),
    issues,
    slots,
  };
}
