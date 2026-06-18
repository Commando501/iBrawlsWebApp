import {
  V3_REFERENCE_PROPORTION_BANDS,
  type V3ReferenceProportionBandId,
} from '../components/v3/v3ReferenceProportions';
import {
  parseV3ObjMetadata,
  type V3Bounds,
  type V3ObjMetadata,
  type V3ObjObjectMetadata,
} from './v3ObjParser';

export type V3ReferenceScaffoldSourceKind = 'obj' | 'fbx' | 'glb' | 'gltf' | 'unsupported';
export type V3ReferenceScaffoldSlotFamily =
  | 'helmet'
  | 'torso'
  | 'arms'
  | 'hands'
  | 'legs'
  | 'feet'
  | 'equipment'
  | 'unknown';

export interface V3ReferenceScaffoldInput {
  objText?: string;
  metadata?: V3ObjMetadata;
  source?: {
    kind?: V3ReferenceScaffoldSourceKind;
    fileName?: string;
    label?: string;
  };
}

export interface V3ReferenceScaffoldSourceSummary {
  kind: V3ReferenceScaffoldSourceKind;
  canonicalKind: 'obj';
  fileName: string | null;
  label: string;
  calibrationAllowed: boolean;
  inspectionOnly: boolean;
  issues: string[];
  metadata: {
    objectCount: number;
    materialCount: number;
    materialLibraryCount: number;
    vertexCount: number;
    faceCount: number;
    triangleCountEstimate: number;
    bounds: V3Bounds | null;
    dimensions: {
      width: number;
      height: number;
      depth: number;
    };
  };
}

export interface V3ReferenceScaffoldGlobalRatios {
  widthToHeight: number;
  depthToHeight: number;
  widthToDepth: number;
  heightRatio: number;
  centerXToHeight: number;
  centerZToHeight: number;
}

export interface V3ReferenceScaffoldVerticalBand {
  id: V3ReferenceProportionBandId;
  yRange: {
    minRatio: number;
    maxRatio: number;
  };
  widthRatio: number;
  depthRatio: number;
  occupancyRatio: number;
  objectCount: number;
  families: V3ReferenceScaffoldSlotFamily[];
}

export interface V3ReferenceScaffoldSlotFamilyEnvelope {
  family: V3ReferenceScaffoldSlotFamily;
  objectCount: number;
  objectNames: string[];
  boundsRatio: {
    widthToHeight: number;
    depthToHeight: number;
    heightToReferenceHeight: number;
  };
  centerlineOffset: {
    xToHeight: number;
    zToHeight: number;
  };
  verticalRange: {
    minRatio: number;
    maxRatio: number;
  };
  occupiedBands: V3ReferenceProportionBandId[];
}

export interface V3ReferenceScaffoldCenterlineHints {
  xCenterOffsetRatio: number;
  zCenterOffsetRatio: number;
  leftRightBalance: number;
  frontBackBalance: number;
}

export interface V3ReferenceScaffoldOccupancySummary {
  occupiedBandCount: number;
  occupiedBandRatio: number;
  emptyBands: V3ReferenceProportionBandId[];
  objectCoverageRatio: number;
  familyObjectCounts: Record<V3ReferenceScaffoldSlotFamily, number>;
}

export interface V3ReferenceScaffold {
  schemaVersion: 'v3-reference-scaffold/v1';
  version: 1;
  source: V3ReferenceScaffoldSourceSummary;
  globalRatios: V3ReferenceScaffoldGlobalRatios;
  verticalBands: V3ReferenceScaffoldVerticalBand[];
  slotFamilyEnvelopes: V3ReferenceScaffoldSlotFamilyEnvelope[];
  centerlineHints: V3ReferenceScaffoldCenterlineHints;
  occupancySummary: V3ReferenceScaffoldOccupancySummary;
}

const SLOT_FAMILY_ORDER: V3ReferenceScaffoldSlotFamily[] = [
  'helmet',
  'torso',
  'arms',
  'hands',
  'legs',
  'feet',
  'equipment',
  'unknown',
];

const EMPTY_FAMILY_COUNTS: Record<V3ReferenceScaffoldSlotFamily, number> = {
  helmet: 0,
  torso: 0,
  arms: 0,
  hands: 0,
  legs: 0,
  feet: 0,
  equipment: 0,
  unknown: 0,
};

export function buildV3ReferenceScaffold(input: V3ReferenceScaffoldInput): V3ReferenceScaffold {
  const metadata = input.metadata ?? parseV3ObjMetadata(input.objText ?? '');
  const sourceKind = input.source?.kind ?? (input.objText !== undefined ? 'obj' : 'unsupported');
  const calibrationAllowed = sourceKind === 'obj';
  const bounds = cloneBounds(metadata.bounds);
  const dimensions = getDimensions(bounds);
  const height = safePositive(dimensions.height);
  const sourceIssues = calibrationAllowed
    ? []
    : [`Only canonical OBJ sources can calibrate V3 reference scaffolds; ${sourceKind} is inspection-only.`];

  const verticalBands = buildVerticalBands(metadata.objects, bounds, height);
  const slotFamilyEnvelopes = buildSlotFamilyEnvelopes(metadata.objects, bounds, height);

  return {
    schemaVersion: 'v3-reference-scaffold/v1',
    version: 1,
    source: {
      kind: sourceKind,
      canonicalKind: 'obj',
      fileName: sanitizeFileName(input.source?.fileName),
      label: sanitizeLabel(input.source?.label ?? input.source?.fileName ?? 'local OBJ reference'),
      calibrationAllowed,
      inspectionOnly: !calibrationAllowed,
      issues: sourceIssues,
      metadata: {
        objectCount: metadata.objects.length,
        materialCount: metadata.materials.length,
        materialLibraryCount: metadata.materialLibraries.length,
        vertexCount: metadata.vertexCount,
        faceCount: metadata.faceCount,
        triangleCountEstimate: metadata.triangleCountEstimate,
        bounds,
        dimensions,
      },
    },
    globalRatios: {
      widthToHeight: ratio(dimensions.width, height, 6),
      depthToHeight: ratio(dimensions.depth, height, 6),
      widthToDepth: ratio(dimensions.width, safePositive(dimensions.depth), 6),
      heightRatio: dimensions.height > 0 ? 1 : 0,
      centerXToHeight: ratio(centerOf(bounds, 0), height, 6),
      centerZToHeight: ratio(centerOf(bounds, 2), height, 6),
    },
    verticalBands,
    slotFamilyEnvelopes,
    centerlineHints: buildCenterlineHints(bounds, height),
    occupancySummary: buildOccupancySummary(verticalBands, slotFamilyEnvelopes, metadata.objects.length),
  };
}

function buildVerticalBands(
  objects: V3ObjObjectMetadata[],
  referenceBounds: V3Bounds | null,
  referenceHeight: number
): V3ReferenceScaffoldVerticalBand[] {
  const minY = referenceBounds?.min[1] ?? 0;
  const bandHeight = referenceHeight / V3_REFERENCE_PROPORTION_BANDS.length;

  return V3_REFERENCE_PROPORTION_BANDS.map((id, index) => {
    const bandMin = minY + index * bandHeight;
    const bandMax = minY + (index + 1) * bandHeight;
    const overlappingObjects = objects.filter((object) => overlapsY(object.bounds, bandMin, bandMax));
    const bandBounds = unionObjectBounds(overlappingObjects);
    const families = uniqueFamilies(overlappingObjects.map(resolveSlotFamily));

    return {
      id,
      yRange: {
        minRatio: roundRatio(index / V3_REFERENCE_PROPORTION_BANDS.length, 6),
        maxRatio: roundRatio((index + 1) / V3_REFERENCE_PROPORTION_BANDS.length, 6),
      },
      widthRatio: ratio(getDimensions(bandBounds).width, referenceHeight, 4),
      depthRatio: ratio(getDimensions(bandBounds).depth, referenceHeight, 4),
      occupancyRatio: roundRatio(calculateBandOccupancy(overlappingObjects, bandMin, bandMax), 4),
      objectCount: overlappingObjects.length,
      families,
    };
  });
}

function buildSlotFamilyEnvelopes(
  objects: V3ObjObjectMetadata[],
  referenceBounds: V3Bounds | null,
  referenceHeight: number
): V3ReferenceScaffoldSlotFamilyEnvelope[] {
  const referenceMinY = referenceBounds?.min[1] ?? 0;
  const families = new Map<V3ReferenceScaffoldSlotFamily, V3ObjObjectMetadata[]>();
  for (const object of objects) {
    const family = resolveSlotFamily(object);
    families.set(family, [...(families.get(family) ?? []), object]);
  }

  return SLOT_FAMILY_ORDER.flatMap((family) => {
    const familyObjects = families.get(family) ?? [];
    if (familyObjects.length === 0) return [];

    const bounds = unionObjectBounds(familyObjects);
    const dimensions = getDimensions(bounds);
    const minRatio = bounds
      ? ratio(bounds.min[1] - referenceMinY, referenceHeight, 6)
      : 0;
    const maxRatio = bounds
      ? ratio(bounds.max[1] - referenceMinY, referenceHeight, 6)
      : 0;

    return [{
      family,
      objectCount: familyObjects.length,
      objectNames: familyObjects.map((object) => sanitizeLabel(object.name)),
      boundsRatio: {
        widthToHeight: ratio(dimensions.width, referenceHeight, 6),
        depthToHeight: ratio(dimensions.depth, referenceHeight, 6),
        heightToReferenceHeight: ratio(dimensions.height, referenceHeight, 6),
      },
      centerlineOffset: {
        xToHeight: ratio(centerOf(bounds, 0), referenceHeight, 6),
        zToHeight: ratio(centerOf(bounds, 2), referenceHeight, 6),
      },
      verticalRange: {
        minRatio,
        maxRatio,
      },
      occupiedBands: V3_REFERENCE_PROPORTION_BANDS.filter((_, index) => {
        if (!bounds) return false;
        const bandMin = referenceMinY + (index / V3_REFERENCE_PROPORTION_BANDS.length) * referenceHeight;
        const bandMax = referenceMinY + ((index + 1) / V3_REFERENCE_PROPORTION_BANDS.length) * referenceHeight;
        return overlapsY(bounds, bandMin, bandMax);
      }),
    }];
  });
}

function buildCenterlineHints(
  bounds: V3Bounds | null,
  referenceHeight: number
): V3ReferenceScaffoldCenterlineHints {
  if (!bounds) {
    return {
      xCenterOffsetRatio: 0,
      zCenterOffsetRatio: 0,
      leftRightBalance: 0,
      frontBackBalance: 0,
    };
  }

  const leftWidth = Math.abs(Math.min(bounds.min[0], 0));
  const rightWidth = Math.max(bounds.max[0], 0);
  const backDepth = Math.abs(Math.min(bounds.min[2], 0));
  const frontDepth = Math.max(bounds.max[2], 0);

  return {
    xCenterOffsetRatio: ratio(centerOf(bounds, 0), referenceHeight, 6),
    zCenterOffsetRatio: ratio(centerOf(bounds, 2), referenceHeight, 6),
    leftRightBalance: ratio(rightWidth - leftWidth, safePositive(rightWidth + leftWidth), 6),
    frontBackBalance: ratio(frontDepth - backDepth, safePositive(frontDepth + backDepth), 6),
  };
}

function buildOccupancySummary(
  verticalBands: V3ReferenceScaffoldVerticalBand[],
  slotFamilyEnvelopes: V3ReferenceScaffoldSlotFamilyEnvelope[],
  objectCount: number
): V3ReferenceScaffoldOccupancySummary {
  const occupiedBands = verticalBands.filter((band) => band.objectCount > 0);
  const familyObjectCounts = { ...EMPTY_FAMILY_COUNTS };

  for (const envelope of slotFamilyEnvelopes) {
    familyObjectCounts[envelope.family] = envelope.objectCount;
  }

  return {
    occupiedBandCount: occupiedBands.length,
    occupiedBandRatio: ratio(occupiedBands.length, V3_REFERENCE_PROPORTION_BANDS.length, 6),
    emptyBands: verticalBands
      .filter((band) => band.objectCount === 0)
      .map((band) => band.id),
    objectCoverageRatio: ratio(slotFamilyEnvelopes.reduce((total, envelope) => total + envelope.objectCount, 0), safePositive(objectCount), 6),
    familyObjectCounts,
  };
}

function resolveSlotFamily(object: V3ObjObjectMetadata): V3ReferenceScaffoldSlotFamily {
  const haystack = [
    object.name,
    ...object.groupNames,
  ].join(' ').toLowerCase();

  if (/(helmet|head|visor|crown)/.test(haystack)) return 'helmet';
  if (/(chest|torso|pelvis|waist|spine|abdomen)/.test(haystack)) return 'torso';
  if (/(hand|glove|finger)/.test(haystack)) return 'hands';
  if (/(shoulder|bicep|forearm|arm|elbow)/.test(haystack)) return 'arms';
  if (/(boot|foot|ankle|shin|thigh|knee|leg)/.test(haystack)) return 'legs';
  if (/(pack|back|belt|pouch|equipment|attachment)/.test(haystack)) return 'equipment';
  return 'unknown';
}

function calculateBandOccupancy(
  objects: V3ObjObjectMetadata[],
  bandMin: number,
  bandMax: number
): number {
  const bandHeight = safePositive(bandMax - bandMin);
  const occupiedHeight = objects.reduce((total, object) => {
    if (!object.bounds) return total;
    const overlap = Math.min(object.bounds.max[1], bandMax) - Math.max(object.bounds.min[1], bandMin);
    return total + Math.max(0, overlap);
  }, 0);
  return Math.min(1, occupiedHeight / bandHeight);
}

function unionObjectBounds(objects: V3ObjObjectMetadata[]): V3Bounds | null {
  return objects.reduce<V3Bounds | null>((bounds, object) => unionBounds(bounds, object.bounds), null);
}

function unionBounds(current: V3Bounds | null, next: V3Bounds | null): V3Bounds | null {
  if (!next) return cloneBounds(current);
  if (!current) return cloneBounds(next);

  return {
    min: [
      Math.min(current.min[0], next.min[0]),
      Math.min(current.min[1], next.min[1]),
      Math.min(current.min[2], next.min[2]),
    ],
    max: [
      Math.max(current.max[0], next.max[0]),
      Math.max(current.max[1], next.max[1]),
      Math.max(current.max[2], next.max[2]),
    ],
  };
}

function overlapsY(
  bounds: V3Bounds | null,
  bandMin: number,
  bandMax: number
): boolean {
  if (!bounds) return false;
  return bounds.max[1] >= bandMin && bounds.min[1] <= bandMax;
}

function uniqueFamilies(
  families: V3ReferenceScaffoldSlotFamily[]
): V3ReferenceScaffoldSlotFamily[] {
  const values = new Set(families);
  return SLOT_FAMILY_ORDER.filter((family) => values.has(family));
}

function getDimensions(bounds: V3Bounds | null): { width: number; height: number; depth: number } {
  if (!bounds) return { width: 0, height: 0, depth: 0 };
  return {
    width: roundRatio(bounds.max[0] - bounds.min[0], 6),
    height: roundRatio(bounds.max[1] - bounds.min[1], 6),
    depth: roundRatio(bounds.max[2] - bounds.min[2], 6),
  };
}

function centerOf(bounds: V3Bounds | null, axis: 0 | 1 | 2): number {
  if (!bounds) return 0;
  return (bounds.min[axis] + bounds.max[axis]) / 2;
}

function cloneBounds(bounds: V3Bounds | null): V3Bounds | null {
  if (!bounds) return null;
  return {
    min: [...bounds.min],
    max: [...bounds.max],
  };
}

function sanitizeFileName(fileName: string | undefined): string | null {
  if (!fileName) return null;
  return sanitizeLabel(fileName.split(/[\\/]/).filter(Boolean).at(-1) ?? fileName);
}

function sanitizeLabel(label: string): string {
  const baseName = label.split(/[\\/]/).filter(Boolean).at(-1) ?? label;
  return baseName.replace(/[^\w .()[\]-]/g, '_').trim() || 'local OBJ reference';
}

function ratio(value: number, total: number, precision: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return 0;
  return roundRatio(value / total, precision);
}

function roundRatio(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0;
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function safePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
