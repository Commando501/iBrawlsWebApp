export type V3Vec3 = [number, number, number];

export interface V3Bounds {
  min: V3Vec3;
  max: V3Vec3;
}

export interface V3ObjObjectMetadata {
  name: string;
  groupNames: string[];
  materialNames: string[];
  faceCount: number;
  triangleCountEstimate: number;
  referencedVertexIndexes: number[];
  bounds: V3Bounds | null;
}

export interface V3ObjTriangleMetadata {
  objectName: string;
  groupNames: string[];
  materialName: string | null;
  a: V3Vec3;
  b: V3Vec3;
  c: V3Vec3;
}

export interface V3MtlMaterialSummary {
  name: string;
  diffuse: V3Vec3 | null;
  emissive: V3Vec3 | null;
  hasTextureReference: boolean;
}

export interface V3ObjMetadata {
  materialLibraries: string[];
  materials: string[];
  materialSummaries: V3MtlMaterialSummary[];
  vertexCount: number;
  faceCount: number;
  triangleCountEstimate: number;
  bounds: V3Bounds | null;
  objects: V3ObjObjectMetadata[];
  triangles: V3ObjTriangleMetadata[];
}

const REFERENCE_MIN_OBJECTS = 12;
const REFERENCE_MATERIAL = 'spartan_armor';
const REFERENCE_MIN_VERTICES = 18_000;
const REFERENCE_MIN_FACES = 20_000;

const createEmptyMetadata = (): V3ObjMetadata => ({
  materialLibraries: [],
  materials: [],
  materialSummaries: [],
  vertexCount: 0,
  faceCount: 0,
  triangleCountEstimate: 0,
  bounds: null,
  objects: [],
  triangles: [],
});

const createObjectMetadata = (name: string): V3ObjObjectMetadata => ({
  name,
  groupNames: [],
  materialNames: [],
  faceCount: 0,
  triangleCountEstimate: 0,
  referencedVertexIndexes: [],
  bounds: null,
});

const addUnique = <T>(values: T[], value: T): void => {
  if (!values.includes(value)) values.push(value);
};

const updateBounds = (bounds: V3Bounds | null, point: V3Vec3): V3Bounds => {
  if (!bounds) {
    return { min: [...point], max: [...point] };
  }

  return {
    min: [
      Math.min(bounds.min[0], point[0]),
      Math.min(bounds.min[1], point[1]),
      Math.min(bounds.min[2], point[2]),
    ],
    max: [
      Math.max(bounds.max[0], point[0]),
      Math.max(bounds.max[1], point[1]),
      Math.max(bounds.max[2], point[2]),
    ],
  };
};

const readLineCommand = (line: string): { command: string; value: string } => {
  const trimmed = line.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return { command: trimmed, value: '' };

  return {
    command: trimmed.slice(0, firstSpace),
    value: trimmed.slice(firstSpace).trim(),
  };
};

const parseVertex = (value: string): V3Vec3 | null => {
  const [x, y, z] = value.split(/\s+/).map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
};

const parseColor = (value: string): V3Vec3 | null => {
  const [r, g, b] = value.split(/\s+/).map(Number);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b];
};

const parseV3MtlMaterialSummaries = (source: string | undefined): V3MtlMaterialSummary[] => {
  if (!source) return [];

  const summaries: V3MtlMaterialSummary[] = [];
  let current: V3MtlMaterialSummary | null = null;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const { command, value } = readLineCommand(trimmed);
    if (command === 'newmtl' && value) {
      current = { name: value, diffuse: null, emissive: null, hasTextureReference: false };
      summaries.push(current);
      continue;
    }

    if (!current) continue;
    if (command === 'Kd') current.diffuse = parseColor(value);
    if (command === 'Ke') current.emissive = parseColor(value);
    if (command.toLowerCase().startsWith('map_')) current.hasTextureReference = true;
  }

  return summaries;
};

const parseFaceVertexIndex = (token: string, vertexCount: number): number | null => {
  const rawIndex = Number.parseInt(token.split('/')[0], 10);
  if (!Number.isInteger(rawIndex) || rawIndex === 0) return null;

  const resolvedIndex = rawIndex > 0 ? rawIndex : vertexCount + rawIndex + 1;
  if (resolvedIndex < 1 || resolvedIndex > vertexCount) return null;
  return resolvedIndex;
};

export function parseV3ObjMetadata(source: string, mtlSource?: string): V3ObjMetadata {
  const metadata = createEmptyMetadata();
  metadata.materialSummaries = parseV3MtlMaterialSummaries(mtlSource);
  const vertices: V3Vec3[] = [];
  let currentObject: V3ObjObjectMetadata | null = null;
  let currentMaterial: string | null = null;

  const ensureObject = (): V3ObjObjectMetadata => {
    if (!currentObject) {
      currentObject = createObjectMetadata('default');
      metadata.objects.push(currentObject);
    }
    return currentObject;
  };

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const { command, value } = readLineCommand(trimmed);

    if (command === 'mtllib' && value) {
      addUnique(metadata.materialLibraries, value);
      continue;
    }

    if (command === 'o') {
      currentObject = createObjectMetadata(value || `object_${metadata.objects.length + 1}`);
      metadata.objects.push(currentObject);
      continue;
    }

    if (command === 'g') {
      const object = ensureObject();
      for (const groupName of value.split(/\s+/).filter(Boolean)) {
        addUnique(object.groupNames, groupName);
      }
      continue;
    }

    if (command === 'usemtl' && value) {
      currentMaterial = value;
      addUnique(metadata.materials, value);
      continue;
    }

    if (command === 'v') {
      const vertex = parseVertex(value);
      if (!vertex) continue;

      vertices.push(vertex);
      metadata.vertexCount = vertices.length;
      metadata.bounds = updateBounds(metadata.bounds, vertex);
      continue;
    }

    if (command === 'f') {
      const faceTokens = value.split(/\s+/).filter(Boolean);
      if (faceTokens.length < 3) continue;

      const object = ensureObject();
      const triangleCount = Math.max(1, faceTokens.length - 2);
      object.faceCount += 1;
      object.triangleCountEstimate += triangleCount;
      metadata.faceCount += 1;
      metadata.triangleCountEstimate += triangleCount;

      if (currentMaterial) addUnique(object.materialNames, currentMaterial);

      const resolvedVertexIndexes = faceTokens
        .map((token) => parseFaceVertexIndex(token, vertices.length))
        .filter((vertexIndex): vertexIndex is number => vertexIndex !== null);

      for (const vertexIndex of resolvedVertexIndexes) {
        addUnique(object.referencedVertexIndexes, vertexIndex);
        object.bounds = updateBounds(object.bounds, vertices[vertexIndex - 1]);
      }

      for (let index = 1; index < resolvedVertexIndexes.length - 1; index += 1) {
        metadata.triangles.push({
          objectName: object.name,
          groupNames: [...object.groupNames],
          materialName: currentMaterial,
          a: [...vertices[resolvedVertexIndexes[0] - 1]],
          b: [...vertices[resolvedVertexIndexes[index] - 1]],
          c: [...vertices[resolvedVertexIndexes[index + 1] - 1]],
        });
      }
    }
  }

  return metadata;
}

export function assertV3ReferenceAssetShape(metadata: V3ObjMetadata): void {
  const failures: string[] = [];

  if (metadata.objects.length < REFERENCE_MIN_OBJECTS) {
    failures.push(`expected at least ${REFERENCE_MIN_OBJECTS} objects`);
  }
  if (!metadata.materials.includes(REFERENCE_MATERIAL)) {
    failures.push(`expected material ${REFERENCE_MATERIAL}`);
  }
  if (metadata.vertexCount <= REFERENCE_MIN_VERTICES) {
    failures.push(`expected more than ${REFERENCE_MIN_VERTICES} vertices`);
  }
  if (metadata.faceCount <= REFERENCE_MIN_FACES) {
    failures.push(`expected more than ${REFERENCE_MIN_FACES} faces`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}
