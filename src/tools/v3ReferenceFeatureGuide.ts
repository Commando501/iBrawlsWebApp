import {
  parseV3ObjMetadata,
  type V3Bounds,
  type V3ObjMetadata,
  type V3ObjObjectMetadata,
  type V3ObjTriangleMetadata,
} from './v3ObjParser';
import {
  classifyV3ReferencePart,
  type V3CandidatePaintRole,
  type V3CandidateSlot,
} from './v3VoxelPartClassifier';

export type V3ReferenceFeatureSourceKind = 'obj' | 'fbx' | 'glb' | 'gltf' | 'unsupported';
export type V3ReferenceFeatureSlot =
  | 'helmet'
  | 'chest'
  | 'pelvis'
  | 'back'
  | 'shoulder'
  | 'upperArm'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'shin'
  | 'foot';

export type V3ReferenceFeaturePanelZoneKind =
  | 'abdomen'
  | 'bicep'
  | 'boot'
  | 'core'
  | 'crown'
  | 'glove'
  | 'jaw'
  | 'knee'
  | 'pauldron'
  | 'pectoral'
  | 'rail'
  | 'spine'
  | 'toe'
  | 'visor'
  | 'wrist';

export type V3ReferenceFeatureMaterialRoleHint = Exclude<V3CandidatePaintRole, 'fixed'>;
export type V3ReferenceFeatureGapKind = 'center-split' | 'front-channel' | 'rear-channel';
export type V3ReferenceFeatureLineHintKind = 'ridge' | 'vent' | 'channel';

export interface V3ReferenceFeatureGuideInput {
  objText?: string;
  metadata?: V3ObjMetadata;
  source?: {
    kind?: V3ReferenceFeatureSourceKind;
    fileName?: string;
    label?: string;
  };
}

export interface V3ReferenceFeatureSourceSummary {
  kind: V3ReferenceFeatureSourceKind;
  canonicalKind: 'obj';
  fileName: string | null;
  label: string;
  metadata: {
    objectCount: number;
    materialCount: number;
    vertexCount: number;
    faceCount: number;
    triangleCountEstimate: number;
  };
}

export interface V3ReferenceFeaturePanelZone {
  kind: V3ReferenceFeaturePanelZoneKind;
  objectCount: number;
  verticalBand: 'lower' | 'middle' | 'upper';
  side: 'left' | 'right' | 'center' | 'paired' | 'mixed';
  materialRoleHints: V3ReferenceFeatureMaterialRoleHint[];
}

export interface V3ReferenceFeatureCenterlineGap {
  kind: V3ReferenceFeatureGapKind;
  objectCount: number;
  frontBack: 'front' | 'rear' | 'center';
  widthRatio: number;
}

export interface V3ReferenceFeatureLineHint {
  kind: V3ReferenceFeatureLineHintKind;
  keyword: 'channel' | 'ridge' | 'rail' | 'spine' | 'vent' | 'crown';
  objectCount: number;
  side: 'left' | 'right' | 'center' | 'paired' | 'mixed';
}

export interface V3ReferenceFeatureSymmetrySignature {
  leftCount: number;
  rightCount: number;
  centerCount: number;
  pairedObjectCount: number;
  balance: number;
  hasLeftRightPair: boolean;
}

export interface V3ReferenceFeatureSlotGuide {
  slot: V3ReferenceFeatureSlot;
  objectCount: number;
  objectNames: string[];
  materialRoleHints: V3ReferenceFeatureMaterialRoleHint[];
  boundsRatio: {
    widthToReferenceHeight: number;
    depthToReferenceHeight: number;
    heightToReferenceHeight: number;
  };
  verticalRange: {
    minRatio: number;
    maxRatio: number;
  };
  panelZones: V3ReferenceFeaturePanelZone[];
  centerlineGaps: V3ReferenceFeatureCenterlineGap[];
  ridgeHints: V3ReferenceFeatureLineHint[];
  ventHints: V3ReferenceFeatureLineHint[];
  channelHints: V3ReferenceFeatureLineHint[];
  symmetrySignature: V3ReferenceFeatureSymmetrySignature;
}

export interface V3ReferenceFeatureGuide {
  schemaVersion: 'v3-reference-feature-guide/v1';
  version: 1;
  source: V3ReferenceFeatureSourceSummary;
  slotOrder: V3ReferenceFeatureSlot[];
  slotGuides: V3ReferenceFeatureSlotGuide[];
  summary: {
    slotCount: number;
    objectCount: number;
    materialRoleHints: V3ReferenceFeatureMaterialRoleHint[];
    symmetrySignature: V3ReferenceFeatureSymmetrySignature;
  };
}

interface ClassifiedObject {
  object: V3ObjObjectMetadata;
  slot: V3ReferenceFeatureSlot;
  materialRoleHints: V3ReferenceFeatureMaterialRoleHint[];
  haystack: string;
  side: 'left' | 'right' | 'center';
}

interface GeometryDerivedObjectBucket {
  slot: V3ReferenceFeatureSlot;
  side: 'left' | 'right' | 'center';
  bounds: V3Bounds | null;
  triangleCountEstimate: number;
  materialRoleHints: V3ReferenceFeatureMaterialRoleHint[];
}

const SLOT_ORDER: V3ReferenceFeatureSlot[] = [
  'helmet',
  'chest',
  'pelvis',
  'back',
  'shoulder',
  'upperArm',
  'forearm',
  'hand',
  'thigh',
  'shin',
  'foot',
];

const PANEL_ZONE_ORDER: V3ReferenceFeaturePanelZoneKind[] = [
  'visor',
  'jaw',
  'crown',
  'pectoral',
  'core',
  'abdomen',
  'rail',
  'spine',
  'boot',
  'toe',
  'wrist',
  'glove',
  'pauldron',
  'bicep',
  'knee',
];

const MATERIAL_ROLE_ORDER: V3ReferenceFeatureMaterialRoleHint[] = [
  'primary',
  'secondary',
  'accent',
  'undersuit',
  'visor',
  'emissive',
  'decal',
];

const LINE_KEYWORD_ORDER: V3ReferenceFeatureLineHint['keyword'][] = [
  'channel',
  'ridge',
  'rail',
  'spine',
  'vent',
  'crown',
];

const GEOMETRY_SIDE_ORDER: Array<'left' | 'right' | 'center'> = ['left', 'right', 'center'];
const COARSE_OBJECT_HEIGHT_RATIO = 0.45;

export function buildV3ReferenceFeatureGuide(
  input: V3ReferenceFeatureGuideInput
): V3ReferenceFeatureGuide {
  const metadata = input.metadata ?? parseV3ObjMetadata(input.objText ?? '');
  const referenceBounds = cloneBounds(metadata.bounds);
  const referenceHeight = safePositive(getDimensions(referenceBounds).height);
  const classifiedObjects = metadata.objects
    .map((object) => classifyObject(object))
    .filter((entry): entry is ClassifiedObject => entry !== null);
  const geometryDerivedObjects = buildGeometryDerivedObjects(metadata.triangles, referenceBounds);
  const guideObjects = mergeClassifiedAndGeometryObjects(
    classifiedObjects,
    geometryDerivedObjects,
    referenceHeight
  );
  const triangleRoleHintsBySlot = buildTriangleRoleHintsBySlot(metadata.triangles);
  const slotGuides = SLOT_ORDER.flatMap((slot) => {
    const objects = guideObjects.filter((entry) => entry.slot === slot);
    if (objects.length === 0) return [];
    return [buildSlotGuide(slot, objects, triangleRoleHintsBySlot.get(slot) ?? [], referenceBounds, referenceHeight)];
  });

  return {
    schemaVersion: 'v3-reference-feature-guide/v1',
    version: 1,
    source: {
      kind: input.source?.kind ?? (input.objText !== undefined ? 'obj' : 'unsupported'),
      canonicalKind: 'obj',
      fileName: sanitizeFileName(input.source?.fileName),
      label: sanitizeLabel(input.source?.label ?? input.source?.fileName ?? 'local OBJ reference'),
      metadata: {
        objectCount: metadata.objects.length,
        materialCount: metadata.materials.length,
        vertexCount: metadata.vertexCount,
        faceCount: metadata.faceCount,
        triangleCountEstimate: metadata.triangleCountEstimate,
      },
    },
    slotOrder: slotGuides.map((guide) => guide.slot),
    slotGuides,
    summary: {
      slotCount: slotGuides.length,
      objectCount: guideObjects.length,
      materialRoleHints: uniqueMaterialRoles(slotGuides.flatMap((guide) => guide.materialRoleHints)),
      symmetrySignature: buildSymmetrySignature(guideObjects),
    },
  };
}

function buildSlotGuide(
  slot: V3ReferenceFeatureSlot,
  objects: ClassifiedObject[],
  triangleRoleHints: V3ReferenceFeatureMaterialRoleHint[],
  referenceBounds: V3Bounds | null,
  referenceHeight: number
): V3ReferenceFeatureSlotGuide {
  const slotBounds = unionObjectBounds(objects.map((entry) => entry.object));
  const dimensions = getDimensions(slotBounds);
  const referenceMinY = referenceBounds?.min[1] ?? 0;
  const materialRoleHints = uniqueMaterialRoles([
    ...objects.flatMap((entry) => entry.materialRoleHints),
    ...triangleRoleHints,
  ]);

  return {
    slot,
    objectCount: objects.length,
    objectNames: objects.map((entry) => sanitizeLabel(entry.object.name)),
    materialRoleHints,
    boundsRatio: {
      widthToReferenceHeight: ratio(dimensions.width, referenceHeight, 6),
      depthToReferenceHeight: ratio(dimensions.depth, referenceHeight, 6),
      heightToReferenceHeight: ratio(dimensions.height, referenceHeight, 6),
    },
    verticalRange: {
      minRatio: slotBounds ? ratio(slotBounds.min[1] - referenceMinY, referenceHeight, 6) : 0,
      maxRatio: slotBounds ? ratio(slotBounds.max[1] - referenceMinY, referenceHeight, 6) : 0,
    },
    panelZones: buildPanelZones(objects, slotBounds),
    centerlineGaps: buildCenterlineGaps(objects, referenceHeight),
    ridgeHints: buildLineHints(objects, 'ridge'),
    ventHints: buildLineHints(objects, 'vent'),
    channelHints: buildLineHints(objects, 'channel'),
    symmetrySignature: buildSymmetrySignature(objects),
  };
}

function classifyObject(object: V3ObjObjectMetadata): ClassifiedObject | null {
  const classification = classifyV3ReferencePart({
    objectName: object.name,
    groupNames: object.groupNames,
    materialNames: object.materialNames,
  });
  const slot = toFeatureSlot(classification.slot);
  if (!slot) return null;

  return {
    object,
    slot,
    materialRoleHints: uniqueMaterialRoles(classification.paintRoles.filter(isMaterialRoleHint)),
    haystack: normalize([object.name, ...object.groupNames, ...object.materialNames].join(' ')),
    side: resolveSide(object),
  };
}

function buildTriangleRoleHintsBySlot(
  triangles: V3ObjTriangleMetadata[]
): Map<V3ReferenceFeatureSlot, V3ReferenceFeatureMaterialRoleHint[]> {
  const hintsBySlot = new Map<V3ReferenceFeatureSlot, V3ReferenceFeatureMaterialRoleHint[]>();
  for (const triangle of triangles) {
    const classification = classifyV3ReferencePart({
      objectName: triangle.objectName,
      groupNames: triangle.groupNames,
      materialNames: triangle.materialName ? [triangle.materialName] : [],
    });
    const slot = toFeatureSlot(classification.slot);
    if (!slot) continue;
    hintsBySlot.set(slot, uniqueMaterialRoles([
      ...(hintsBySlot.get(slot) ?? []),
      ...classification.paintRoles.filter(isMaterialRoleHint),
    ]));
  }
  return hintsBySlot;
}

function buildGeometryDerivedObjects(
  triangles: V3ObjTriangleMetadata[],
  referenceBounds: V3Bounds | null
): ClassifiedObject[] {
  if (!referenceBounds || triangles.length === 0) return [];

  const buckets = new Map<string, GeometryDerivedObjectBucket>();
  for (const triangle of triangles) {
    const bounds = triangleBounds(triangle);
    const slot = classifyTriangleGeometrySlot(bounds, referenceBounds);
    if (!slot) continue;

    const side = isPairedGeometrySlot(slot) ? resolveGeometrySide(bounds, referenceBounds) : 'center';
    const key = `${slot}:${side}`;
    const bucket = buckets.get(key) ?? {
      slot,
      side,
      bounds: null,
      triangleCountEstimate: 0,
      materialRoleHints: [],
    };
    bucket.bounds = unionBounds(bucket.bounds, bounds);
    bucket.triangleCountEstimate += 1;
    bucket.materialRoleHints = uniqueMaterialRoles([
      ...bucket.materialRoleHints,
      ...classifyTriangleMaterialRoles(triangle),
    ]);
    buckets.set(key, bucket);
  }

  return SLOT_ORDER.flatMap((slot) => GEOMETRY_SIDE_ORDER.flatMap((side) => {
    const bucket = buckets.get(`${slot}:${side}`);
    return bucket ? [buildGeometryDerivedObject(bucket)] : [];
  }));
}

function mergeClassifiedAndGeometryObjects(
  classifiedObjects: ClassifiedObject[],
  geometryDerivedObjects: ClassifiedObject[],
  referenceHeight: number
): ClassifiedObject[] {
  if (geometryDerivedObjects.length === 0) return classifiedObjects;

  const derivedSlots = new Set(geometryDerivedObjects.map((entry) => entry.slot));
  const coarseSlots = new Set(
    classifiedObjects
      .filter((entry) => derivedSlots.has(entry.slot) && isCoarseClassifiedObject(entry, referenceHeight))
      .map((entry) => entry.slot)
  );
  const retainedClassifiedObjects = classifiedObjects.filter((entry) => !coarseSlots.has(entry.slot));
  const retainedSlots = new Set(retainedClassifiedObjects.map((entry) => entry.slot));
  const retainedDerivedObjects = geometryDerivedObjects.filter(
    (entry) =>
      coarseSlots.has(entry.slot) ||
      !retainedSlots.has(entry.slot) ||
      derivedObjectAddsPanelCoverage(entry, retainedClassifiedObjects.filter((classified) => classified.slot === entry.slot))
  );
  return [...retainedClassifiedObjects, ...retainedDerivedObjects];
}

function derivedObjectAddsPanelCoverage(
  derivedObject: ClassifiedObject,
  retainedObjects: ClassifiedObject[]
): boolean {
  if (retainedObjects.length === 0) return true;
  const retainedKinds = getPanelKindsForObjects(retainedObjects);
  return [...getPanelKindsForObjects([derivedObject])].some((kind) => !retainedKinds.has(kind));
}

function getPanelKindsForObjects(objects: ClassifiedObject[]): Set<V3ReferenceFeaturePanelZoneKind> {
  return new Set(PANEL_ZONE_ORDER.filter((kind) =>
    objects.some((entry) => panelZoneMatches(entry.haystack, kind))
  ));
}

function isCoarseClassifiedObject(entry: ClassifiedObject, referenceHeight: number): boolean {
  const dimensions = getDimensions(entry.object.bounds);
  return ratio(dimensions.height, referenceHeight, 6) >= COARSE_OBJECT_HEIGHT_RATIO;
}

function buildGeometryDerivedObject(bucket: GeometryDerivedObjectBucket): ClassifiedObject {
  const name = buildGeometryDerivedObjectName(bucket.slot, bucket.side);
  const haystack = normalize(`${name} ${derivedGeometryKeywords(bucket.slot)}`);
  return {
    object: {
      name,
      groupNames: ['derived-geometry'],
      materialNames: [],
      faceCount: bucket.triangleCountEstimate,
      triangleCountEstimate: bucket.triangleCountEstimate,
      referencedVertexIndexes: [],
      bounds: cloneBounds(bucket.bounds),
    },
    slot: bucket.slot,
    materialRoleHints: bucket.materialRoleHints,
    haystack,
    side: bucket.side,
  };
}

function buildGeometryDerivedObjectName(
  slot: V3ReferenceFeatureSlot,
  side: 'left' | 'right' | 'center'
): string {
  const sidePrefix = side === 'center' ? '' : `${side}-`;
  return `derived-${sidePrefix}${slot}-${derivedGeometryNameSuffix(slot)}`;
}

function derivedGeometryNameSuffix(slot: V3ReferenceFeatureSlot): string {
  switch (slot) {
    case 'helmet': return 'crown-visor-jaw';
    case 'chest': return 'pectoral-core-abdomen';
    case 'pelvis': return 'core';
    case 'back': return 'spine-rail-channel';
    case 'shoulder': return 'pauldron-ridge';
    case 'upperArm': return 'bicep';
    case 'forearm': return 'wrist-channel';
    case 'hand': return 'glove';
    case 'thigh': return 'armor';
    case 'shin': return 'knee-vent';
    case 'foot': return 'boot-toe';
  }
}

function derivedGeometryKeywords(slot: V3ReferenceFeatureSlot): string {
  switch (slot) {
    case 'helmet': return 'helmet crown visor jaw';
    case 'chest': return 'chest pectoral core';
    case 'pelvis': return 'pelvis core';
    case 'back': return 'back spine rail channel';
    case 'shoulder': return 'shoulder pauldron ridge';
    case 'upperArm': return 'upper arm bicep';
    case 'forearm': return 'forearm wrist channel';
    case 'hand': return 'hand glove';
    case 'thigh': return 'thigh armor';
    case 'shin': return 'shin knee vent';
    case 'foot': return 'foot boot toe';
  }
}

function classifyTriangleGeometrySlot(
  bounds: V3Bounds,
  referenceBounds: V3Bounds
): V3ReferenceFeatureSlot | null {
  const referenceHeight = safePositive(referenceBounds.max[1] - referenceBounds.min[1]);
  const centerYRatio = (centerOf(bounds, 1) - referenceBounds.min[1]) / referenceHeight;
  if (centerYRatio < -0.05 || centerYRatio > 1.05) return null;

  const referenceCenterX = centerOf(referenceBounds, 0);
  const referenceCenterZ = centerOf(referenceBounds, 2);
  const referenceHalfWidth = safePositive(Math.max(
    Math.abs(referenceBounds.min[0] - referenceCenterX),
    Math.abs(referenceBounds.max[0] - referenceCenterX)
  ));
  const referenceHalfDepth = safePositive(Math.max(
    Math.abs(referenceBounds.min[2] - referenceCenterZ),
    Math.abs(referenceBounds.max[2] - referenceCenterZ)
  ));
  const xOutboardRatio = Math.abs(centerOf(bounds, 0) - referenceCenterX) / referenceHalfWidth;
  const zFrontBackRatio = (centerOf(bounds, 2) - referenceCenterZ) / referenceHalfDepth;

  if (centerYRatio >= 0.78) return 'helmet';
  if (centerYRatio >= 0.58) {
    if (xOutboardRatio >= 0.62) return 'shoulder';
    if (zFrontBackRatio <= -0.35) return 'back';
    return 'chest';
  }
  if (centerYRatio >= 0.44) {
    if (xOutboardRatio >= 0.45) return 'upperArm';
    return 'pelvis';
  }
  if (centerYRatio >= 0.34) {
    if (xOutboardRatio >= 0.35) return 'forearm';
    return 'thigh';
  }
  if (centerYRatio >= 0.26) {
    if (xOutboardRatio >= 0.35) return 'hand';
    return 'thigh';
  }
  if (centerYRatio >= 0.1) return 'shin';
  return 'foot';
}

function classifyTriangleMaterialRoles(triangle: V3ObjTriangleMetadata): V3ReferenceFeatureMaterialRoleHint[] {
  const classification = classifyV3ReferencePart({
    objectName: '',
    groupNames: [],
    materialNames: triangle.materialName ? [triangle.materialName] : [],
  });
  return uniqueMaterialRoles(classification.paintRoles.filter(isMaterialRoleHint));
}

function isPairedGeometrySlot(slot: V3ReferenceFeatureSlot): boolean {
  return slot === 'shoulder'
    || slot === 'upperArm'
    || slot === 'forearm'
    || slot === 'hand'
    || slot === 'thigh'
    || slot === 'shin'
    || slot === 'foot';
}

function resolveGeometrySide(
  bounds: V3Bounds,
  referenceBounds: V3Bounds
): 'left' | 'right' | 'center' {
  const referenceCenterX = centerOf(referenceBounds, 0);
  const referenceWidth = safePositive(referenceBounds.max[0] - referenceBounds.min[0]);
  const offset = centerOf(bounds, 0) - referenceCenterX;
  if (offset < -referenceWidth * 0.04) return 'left';
  if (offset > referenceWidth * 0.04) return 'right';
  return 'center';
}

function triangleBounds(triangle: V3ObjTriangleMetadata): V3Bounds {
  return {
    min: [
      Math.min(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.min(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.min(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
    max: [
      Math.max(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.max(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.max(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
  };
}

function buildPanelZones(
  objects: ClassifiedObject[],
  slotBounds: V3Bounds | null
): V3ReferenceFeaturePanelZone[] {
  return PANEL_ZONE_ORDER.flatMap((kind) => {
    const matchingObjects = objects.filter((entry) => panelZoneMatches(entry.haystack, kind));
    if (matchingObjects.length === 0) return [];

    return [{
      kind,
      objectCount: matchingObjects.length,
      verticalBand: resolveVerticalBand(unionObjectBounds(matchingObjects.map((entry) => entry.object)), slotBounds),
      side: summarizeSide(matchingObjects),
      materialRoleHints: uniqueMaterialRoles(matchingObjects.flatMap((entry) => entry.materialRoleHints)),
    }];
  });
}

function buildCenterlineGaps(
  objects: ClassifiedObject[],
  referenceHeight: number
): V3ReferenceFeatureCenterlineGap[] {
  const matchingObjects = objects.filter((entry) => /(\bcore\b|\bchannel\b|\bcenter\b|\bspine\b)/.test(entry.haystack));
  if (matchingObjects.length === 0) return [];

  const frontObjects = matchingObjects.filter((entry) => !/(\bback\b|\brear\b|\bspine\b)/.test(entry.haystack));
  const rearObjects = matchingObjects.filter((entry) => /(\bback\b|\brear\b|\bspine\b)/.test(entry.haystack));
  const gaps: V3ReferenceFeatureCenterlineGap[] = [];
  if (frontObjects.length > 0) gaps.push(buildCenterlineGap('front-channel', frontObjects, referenceHeight));
  if (rearObjects.length > 0) gaps.push(buildCenterlineGap('rear-channel', rearObjects, referenceHeight));
  if (frontObjects.length === 0 && rearObjects.length === 0) {
    gaps.push(buildCenterlineGap('center-split', matchingObjects, referenceHeight));
  }
  return gaps;
}

function buildCenterlineGap(
  kind: V3ReferenceFeatureGapKind,
  objects: ClassifiedObject[],
  referenceHeight: number
): V3ReferenceFeatureCenterlineGap {
  const bounds = unionObjectBounds(objects.map((entry) => entry.object));
  const centerZ = centerOf(bounds, 2);
  return {
    kind,
    objectCount: objects.length,
    frontBack: centerZ > 0.05 ? 'front' : centerZ < -0.05 ? 'rear' : 'center',
    widthRatio: ratio(getDimensions(bounds).width, referenceHeight, 6),
  };
}

function buildLineHints(
  objects: ClassifiedObject[],
  kind: V3ReferenceFeatureLineHintKind
): V3ReferenceFeatureLineHint[] {
  const keywords = LINE_KEYWORD_ORDER.filter((keyword) => {
    if (kind === 'ridge') return keyword === 'ridge' || keyword === 'rail' || keyword === 'spine' || keyword === 'crown';
    if (kind === 'vent') return keyword === 'vent';
    return keyword === 'channel';
  });

  return keywords.flatMap((keyword) => {
    const matchingObjects = objects.filter((entry) => lineKeywordMatches(entry.haystack, keyword));
    if (matchingObjects.length === 0) return [];
    return [{
      kind,
      keyword,
      objectCount: matchingObjects.length,
      side: summarizeSide(matchingObjects),
    }];
  });
}

function buildSymmetrySignature(objects: ClassifiedObject[]): V3ReferenceFeatureSymmetrySignature {
  const leftCount = objects.filter((entry) => entry.side === 'left').length;
  const rightCount = objects.filter((entry) => entry.side === 'right').length;
  const centerCount = objects.length - leftCount - rightCount;
  const pairedObjectCount = Math.min(leftCount, rightCount) * 2;
  return {
    leftCount,
    rightCount,
    centerCount,
    pairedObjectCount,
    balance: ratio(Math.min(leftCount, rightCount), safePositive(Math.max(leftCount, rightCount)), 6),
    hasLeftRightPair: leftCount > 0 && rightCount > 0,
  };
}

function toFeatureSlot(slot: V3CandidateSlot): V3ReferenceFeatureSlot | null {
  if (SLOT_ORDER.includes(slot as V3ReferenceFeatureSlot)) return slot as V3ReferenceFeatureSlot;
  return null;
}

function panelZoneMatches(source: string, kind: V3ReferenceFeaturePanelZoneKind): boolean {
  switch (kind) {
    case 'abdomen': return /\babdomen\b/.test(source);
    case 'bicep': return /\bbicep\b|\bupper arm\b/.test(source);
    case 'boot': return /\bboot\b/.test(source);
    case 'core': return /\bcore\b|\bcenter\b/.test(source);
    case 'crown': return /\bcrown\b/.test(source);
    case 'glove': return /\bglove\b|\bhand\b/.test(source);
    case 'jaw': return /\bjaw\b/.test(source);
    case 'knee': return /\bknee\b/.test(source);
    case 'pauldron': return /\bpauldron\b|\bshoulder\b/.test(source);
    case 'pectoral': return /\bpectoral\b|\bpec\b/.test(source);
    case 'rail': return /\brail\b/.test(source);
    case 'spine': return /\bspine\b/.test(source);
    case 'toe': return /\btoe\b/.test(source);
    case 'visor': return /\bvisor\b/.test(source);
    case 'wrist': return /\bwrist\b|\bforearm\b|\bgauntlet\b/.test(source);
  }
}

function lineKeywordMatches(source: string, keyword: V3ReferenceFeatureLineHint['keyword']): boolean {
  switch (keyword) {
    case 'channel': return /\bchannel\b/.test(source);
    case 'ridge': return /\bridge\b/.test(source);
    case 'rail': return /\brail\b/.test(source);
    case 'spine': return /\bspine\b/.test(source);
    case 'vent': return /\bvent\b|\bgrille\b/.test(source);
    case 'crown': return /\bcrown\b/.test(source);
  }
}

function resolveSide(entry: V3ObjObjectMetadata): 'left' | 'right' | 'center' {
  const source = normalize([entry.name, ...entry.groupNames].join(' '));
  if (/\b(left|l)\b/.test(source)) return 'left';
  if (/\b(right|r)\b/.test(source)) return 'right';
  const centerX = centerOf(entry.bounds, 0);
  if (centerX < -0.0001) return 'left';
  if (centerX > 0.0001) return 'right';
  return 'center';
}

function summarizeSide(objects: ClassifiedObject[]): 'left' | 'right' | 'center' | 'paired' | 'mixed' {
  const sides = new Set(objects.map((entry) => entry.side));
  if (sides.has('left') && sides.has('right') && !sides.has('center')) return 'paired';
  if (sides.size === 1) return objects[0]?.side ?? 'center';
  return 'mixed';
}

function resolveVerticalBand(bounds: V3Bounds | null, slotBounds: V3Bounds | null): 'lower' | 'middle' | 'upper' {
  if (!bounds || !slotBounds) return 'middle';
  const slotHeight = safePositive(slotBounds.max[1] - slotBounds.min[1]);
  const centerRatio = (centerOf(bounds, 1) - slotBounds.min[1]) / slotHeight;
  if (centerRatio < 1 / 3) return 'lower';
  if (centerRatio > 2 / 3) return 'upper';
  return 'middle';
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

function uniqueMaterialRoles(
  roles: V3ReferenceFeatureMaterialRoleHint[]
): V3ReferenceFeatureMaterialRoleHint[] {
  const values = new Set(roles);
  return MATERIAL_ROLE_ORDER.filter((role) => values.has(role));
}

function isMaterialRoleHint(role: V3CandidatePaintRole): role is V3ReferenceFeatureMaterialRoleHint {
  return role !== 'fixed';
}

function sanitizeFileName(fileName: string | undefined): string | null {
  if (!fileName) return null;
  return sanitizeLabel(fileName.split(/[\\/]/).filter(Boolean).at(-1) ?? fileName);
}

function sanitizeLabel(label: string): string {
  const baseName = label.split(/[\\/]/).filter(Boolean).at(-1) ?? label;
  return baseName.replace(/[^\w .()[\]-]/g, '_').trim() || 'local OBJ reference';
}

function normalize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:.[\](){}-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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
