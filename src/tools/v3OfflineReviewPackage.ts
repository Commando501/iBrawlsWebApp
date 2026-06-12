import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  BUILT_IN_V3_CHARACTER_PARTS,
  getDefaultV3WeaponManifest,
} from '../components/v3/v3AssetManifest';
import { getV3CharacterPartBounds, getV3WeaponBounds, type V3FitBounds } from '../components/v3/v3PartBounds';
import type { V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import { validateV3VoxelAsset, type V3VoxelAssetValidationResult } from './v3AssetValidation';
import type { V3Bounds, V3ObjMetadata, V3ObjObjectMetadata, V3ObjTriangleMetadata } from './v3ObjParser';
import {
  classifyV3ReferencePart,
  type V3CandidatePaintRole,
  type V3CandidateSlot,
} from './v3VoxelPartClassifier';
import {
  voxelizeTriangleBoundsPreview,
  type V3PreviewTriangle,
  type V3VoxelPreview,
} from './v3Voxelize';

export interface V3OfflineReviewPackageInput {
  sourcePath: string;
  metadata: V3ObjMetadata;
  previewResolution?: number;
}

export interface V3OfflineReviewPart {
  objectName: string;
  groupNames: string[];
  materialNames: string[];
  slotCandidate: V3CandidateSlot;
  paintRoles: V3CandidatePaintRole[];
  faceCount: number;
  triangleCountEstimate: number;
  sourceBounds: V3ObjObjectMetadata['bounds'];
  preview: V3VoxelPreview;
  validation: V3VoxelAssetValidationResult;
}

export interface V3OfflineReviewPackage {
  schemaVersion: 1;
  source: {
    baseName: string;
    metadataHashSha256: string;
    absolutePathIncluded: false;
    vertexCount: number;
    faceCount: number;
    triangleCountEstimate: number;
  };
  summary: {
    partCount: number;
    unknownPartCount: number;
    invalidPartCount: number;
  };
  parts: V3OfflineReviewPart[];
}

const CHARACTER_SLOT_FOR_CANDIDATE: Partial<Record<V3CandidateSlot, V3CharacterSlotId>> = {
  helmet: 'helmet',
  neck: 'neck',
  chest: 'chest',
  shoulder: 'shoulderLeft',
  upperArm: 'upperArmLeft',
  forearm: 'forearmLeft',
  hand: 'handLeft',
  pelvis: 'pelvis',
  thigh: 'thighLeft',
  shin: 'shinLeft',
  foot: 'footLeft',
  back: 'back',
};

const getCandidateCharacterManifest = (slot: V3CandidateSlot) => {
  const characterSlot = CHARACTER_SLOT_FOR_CANDIDATE[slot];
  return characterSlot
    ? BUILT_IN_V3_CHARACTER_PARTS.find((part) => part.slot === characterSlot)
    : undefined;
};

const getSlotBudget = (slot: V3CandidateSlot): number => {
  if (slot === 'hammer' || slot === 'sword' || slot === 'pistol') {
    return getDefaultV3WeaponManifest(slot).budget.sourceVoxelCount;
  }

  if (slot === 'unknown' || slot === 'weapon') return 96;
  return getCandidateCharacterManifest(slot)?.budget.sourceVoxelCount ?? 96;
};

const fitBoundsToVoxelBounds = (bounds: V3FitBounds): V3Bounds => ({
  min: [0, 0, 0],
  max: [
    bounds.maxDimensions.x - 1,
    bounds.maxDimensions.y - 1,
    bounds.maxDimensions.z - 1,
  ],
});

const fallbackReviewBounds = (): V3Bounds => ({ min: [0, 0, 0], max: [2, 2, 2] });

const getSlotBounds = (slot: V3CandidateSlot): V3Bounds => {
  if (slot === 'hammer' || slot === 'sword' || slot === 'pistol') {
    return fitBoundsToVoxelBounds(getV3WeaponBounds(slot));
  }

  if (slot === 'unknown' || slot === 'weapon') return fallbackReviewBounds();

  const characterSlot = CHARACTER_SLOT_FOR_CANDIDATE[slot];
  return characterSlot ? fitBoundsToVoxelBounds(getV3CharacterPartBounds(characterSlot)) : fallbackReviewBounds();
};

const getTrianglesForObject = (
  object: V3ObjObjectMetadata,
  triangles: V3ObjTriangleMetadata[]
): V3PreviewTriangle[] =>
  triangles
    .filter((triangle) => triangle.objectName === object.name)
    .map((triangle) => ({
      a: [...triangle.a],
      b: [...triangle.b],
      c: [...triangle.c],
      material: triangle.materialName ?? object.materialNames[0] ?? 'fixed',
    }));

const createMetadataHash = (metadata: V3ObjMetadata): string => {
  const sanitized = {
    materials: [...metadata.materials],
    materialSummaries: metadata.materialSummaries.map((material) => ({
      name: material.name,
      diffuse: material.diffuse ? [...material.diffuse] : null,
      emissive: material.emissive ? [...material.emissive] : null,
      hasTextureReference: material.hasTextureReference,
    })),
    vertexCount: metadata.vertexCount,
    faceCount: metadata.faceCount,
    triangleCountEstimate: metadata.triangleCountEstimate,
    bounds: metadata.bounds,
    objects: metadata.objects.map((object) => ({
      name: object.name,
      groupNames: [...object.groupNames],
      materialNames: [...object.materialNames],
      faceCount: object.faceCount,
      triangleCountEstimate: object.triangleCountEstimate,
      referencedVertexIndexes: [...object.referencedVertexIndexes],
      bounds: object.bounds,
    })),
    triangles: metadata.triangles.map((triangle) => ({
      objectName: triangle.objectName,
      groupNames: [...triangle.groupNames],
      materialName: triangle.materialName,
      a: [...triangle.a],
      b: [...triangle.b],
      c: [...triangle.c],
    })),
  };

  return createHash('sha256').update(JSON.stringify(sanitized)).digest('hex');
};

export function buildV3OfflineReviewPackage(
  input: V3OfflineReviewPackageInput
): V3OfflineReviewPackage {
  const resolution = input.previewResolution ?? 8;
  const parts = input.metadata.objects.map((object) => {
    const classification = classifyV3ReferencePart({
      objectName: object.name,
      groupNames: object.groupNames,
      materialNames: object.materialNames,
    });
    const bounds = getSlotBounds(classification.slot);
    const preview = voxelizeTriangleBoundsPreview({
      bounds: object.bounds ?? input.metadata.bounds ?? bounds,
      resolution,
      triangles: getTrianglesForObject(object, input.metadata.triangles),
    });
    const validation = validateV3VoxelAsset({
      voxels: preview.voxels,
      maxVoxels: getSlotBudget(classification.slot),
      allowedBounds: bounds,
      requiredMaterials: object.materialNames,
    });

    return {
      objectName: object.name,
      groupNames: [...object.groupNames],
      materialNames: [...object.materialNames],
      slotCandidate: classification.slot,
      paintRoles: classification.paintRoles,
      faceCount: object.faceCount,
      triangleCountEstimate: object.triangleCountEstimate,
      sourceBounds: object.bounds,
      preview,
      validation,
    };
  });

  return {
    schemaVersion: 1,
    source: {
      baseName: basename(input.sourcePath),
      metadataHashSha256: createMetadataHash(input.metadata),
      absolutePathIncluded: false,
      vertexCount: input.metadata.vertexCount,
      faceCount: input.metadata.faceCount,
      triangleCountEstimate: input.metadata.triangleCountEstimate,
    },
    summary: {
      partCount: parts.length,
      unknownPartCount: parts.filter((part) => part.slotCandidate === 'unknown').length,
      invalidPartCount: parts.filter((part) => part.validation.errors.length > 0).length,
    },
    parts,
  };
}
