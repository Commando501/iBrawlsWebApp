export const V3_REFERENCE_SUPPORTED_EXTENSIONS = ['.fbx', '.glb', '.gltf', '.obj'] as const;

export type V3ReferenceFileKind = 'fbx' | 'glb' | 'gltf' | 'obj' | 'unsupported';

export interface V3ReferenceBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface V3ReferenceMetadataInput {
  fileName: string;
  byteLength: number;
  objectCount?: number;
  meshCount?: number;
  triangleCount?: number;
  bounds?: V3ReferenceBounds;
}

export interface V3ReferenceMetadata {
  fileName: string;
  kind: Exclude<V3ReferenceFileKind, 'unsupported'>;
  extension: typeof V3_REFERENCE_SUPPORTED_EXTENSIONS[number];
  byteLength: number;
  objectCount?: number;
  meshCount?: number;
  triangleCount?: number;
  bounds?: V3ReferenceBounds;
}

export interface V3ReferenceSilhouetteView {
  widthRatio: number;
  heightRatio: number;
  areaRatio: number;
}

export interface V3ReferenceSilhouette {
  front: V3ReferenceSilhouetteView;
  side: V3ReferenceSilhouetteView;
}

export interface V3ReferenceSilhouetteComparison {
  deltas: {
    front: V3ReferenceSilhouetteView;
    side: V3ReferenceSilhouetteView;
  };
  mismatchNotes: string[];
}

export type V3ReferenceExportSafeValue =
  | null
  | string
  | number
  | boolean
  | V3ReferenceExportSafeValue[]
  | { [key: string]: V3ReferenceExportSafeValue };

const SUPPORTED_EXTENSIONS_BY_KIND = new Map(
  V3_REFERENCE_SUPPORTED_EXTENSIONS.map((extension) => [
    extension.slice(1),
    extension,
  ] as const)
);

const SILHOUETTE_MISMATCH_TOLERANCE = 0.08;

const PAYLOAD_KEYS = new Set([
  'arraybuffer',
  'blob',
  'buffer',
  'contents',
  'file',
  'filecontents',
  'object3d',
  'parsedobject',
  'payload',
  'rawsource',
  'rawtext',
  'root',
  'scene',
  'sourcetext',
]);

const SILHOUETTE_VIEWS = ['front', 'side'] as const;
const SILHOUETTE_METRICS = ['widthRatio', 'heightRatio', 'areaRatio'] as const;

type V3ReferenceSilhouetteViewId = typeof SILHOUETTE_VIEWS[number];
type V3ReferenceSilhouetteMetric = typeof SILHOUETTE_METRICS[number];

export function getV3ReferenceFileKind(fileName: string): V3ReferenceFileKind {
  const normalizedFileName = fileName.trim().toLowerCase();
  const extensionStart = normalizedFileName.lastIndexOf('.');
  if (extensionStart < 0) return 'unsupported';

  const extension = normalizedFileName.slice(extensionStart);
  if (!V3_REFERENCE_SUPPORTED_EXTENSIONS.includes(
    extension as typeof V3_REFERENCE_SUPPORTED_EXTENSIONS[number]
  )) {
    return 'unsupported';
  }

  return extension.slice(1) as Exclude<V3ReferenceFileKind, 'unsupported'>;
}

export function buildV3ReferenceMetadata(input: V3ReferenceMetadataInput): V3ReferenceMetadata {
  const kind = getV3ReferenceFileKind(input.fileName);
  if (kind === 'unsupported') {
    throw new Error(`Unsupported V3 reference file extension: ${input.fileName}`);
  }

  const extension = SUPPORTED_EXTENSIONS_BY_KIND.get(kind);
  if (!extension) {
    throw new Error(`Unsupported V3 reference file extension: ${input.fileName}`);
  }

  return {
    fileName: input.fileName,
    kind,
    extension,
    byteLength: input.byteLength,
    ...(input.objectCount === undefined ? {} : { objectCount: input.objectCount }),
    ...(input.meshCount === undefined ? {} : { meshCount: input.meshCount }),
    ...(input.triangleCount === undefined ? {} : { triangleCount: input.triangleCount }),
    ...(input.bounds === undefined ? {} : {
      bounds: {
        min: [...input.bounds.min],
        max: [...input.bounds.max],
      },
    }),
  };
}

export function compareV3ReferenceSilhouettes(
  v3: V3ReferenceSilhouette,
  reference: V3ReferenceSilhouette
): V3ReferenceSilhouetteComparison {
  const deltas = {
    front: buildSilhouetteViewDeltas(v3.front, reference.front),
    side: buildSilhouetteViewDeltas(v3.side, reference.side),
  };
  const mismatchNotes: string[] = [];

  for (const view of SILHOUETTE_VIEWS) {
    for (const metric of SILHOUETTE_METRICS) {
      const delta = deltas[view][metric];
      if (Math.abs(delta) <= SILHOUETTE_MISMATCH_TOLERANCE) continue;

      mismatchNotes.push(formatSilhouetteMismatchNote(view, metric, delta));
    }
  }

  return {
    deltas,
    mismatchNotes,
  };
}

export function assertNoV3ReferencePayloadPersisted(
  reportLike: unknown
): V3ReferenceExportSafeValue {
  return sanitizeV3ReferenceExportValue(reportLike) ?? {};
}

function buildSilhouetteViewDeltas(
  v3: V3ReferenceSilhouetteView,
  reference: V3ReferenceSilhouetteView
): V3ReferenceSilhouetteView {
  return {
    widthRatio: normalizeSilhouetteDelta(v3.widthRatio, reference.widthRatio),
    heightRatio: normalizeSilhouetteDelta(v3.heightRatio, reference.heightRatio),
    areaRatio: normalizeSilhouetteDelta(v3.areaRatio, reference.areaRatio),
  };
}

function normalizeSilhouetteDelta(v3Value: number, referenceValue: number): number {
  if (referenceValue === 0) {
    return roundDelta(v3Value === 0 ? 0 : v3Value);
  }

  return roundDelta((v3Value - referenceValue) / referenceValue);
}

function roundDelta(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatSilhouetteMismatchNote(
  view: V3ReferenceSilhouetteViewId,
  metric: V3ReferenceSilhouetteMetric,
  delta: number
): string {
  const percent = (Math.abs(delta) * 100).toFixed(1);
  const metricLabel = metric.replace('Ratio', '');
  const direction = getMismatchDirection(metric, delta);
  return `${view} ${metricLabel} is ${percent}% ${direction} than reference`;
}

function getMismatchDirection(metric: V3ReferenceSilhouetteMetric, delta: number): string {
  if (metric === 'widthRatio') return delta > 0 ? 'wider' : 'narrower';
  if (metric === 'heightRatio') return delta > 0 ? 'taller' : 'shorter';
  return delta > 0 ? 'larger' : 'smaller';
}

function sanitizeV3ReferenceExportValue(value: unknown): V3ReferenceExportSafeValue | undefined {
  if (value === null) return null;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value as string | number | boolean;
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const sanitizedItems: V3ReferenceExportSafeValue[] = [];
    for (const item of value) {
      const sanitizedItem = sanitizeV3ReferenceExportValue(item);
      if (sanitizedItem !== undefined) {
        sanitizedItems.push(sanitizedItem);
      }
    }
    return sanitizedItems;
  }

  if (valueType !== 'object') {
    return undefined;
  }

  const sanitizedObject: { [key: string]: V3ReferenceExportSafeValue } = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (PAYLOAD_KEYS.has(key.toLowerCase())) continue;

    const sanitizedNestedValue = sanitizeV3ReferenceExportValue(nestedValue);
    if (sanitizedNestedValue !== undefined) {
      sanitizedObject[key] = sanitizedNestedValue;
    }
  }

  return sanitizedObject;
}
