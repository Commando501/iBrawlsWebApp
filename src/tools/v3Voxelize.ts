import type { V3Bounds, V3Vec3 } from './v3ObjParser';

export interface V3PreviewVoxel {
  x: number;
  y: number;
  z: number;
  material: string;
}

export interface V3VoxelPreview {
  resolution: number;
  bounds: V3Bounds;
  voxels: V3PreviewVoxel[];
}

export interface V3PreviewTriangle {
  a: V3Vec3;
  b: V3Vec3;
  c: V3Vec3;
  material: string;
}

export interface V3BoundsPreviewInput {
  bounds: V3Bounds;
  resolution: number;
  material: string;
}

export interface V3TriangleBoundsPreviewInput {
  bounds: V3Bounds;
  resolution: number;
  triangles: V3PreviewTriangle[];
}

const normalizeResolution = (resolution: number): number => {
  if (!Number.isFinite(resolution)) return 1;
  return Math.max(1, Math.floor(resolution));
};

const cloneBounds = (bounds: V3Bounds): V3Bounds => ({
  min: [...bounds.min],
  max: [...bounds.max],
});

const sortVoxels = (voxels: V3PreviewVoxel[]): V3PreviewVoxel[] =>
  [...voxels].sort((a, b) =>
    a.x - b.x ||
    a.y - b.y ||
    a.z - b.z ||
    a.material.localeCompare(b.material)
  );

const voxelKey = (voxel: V3PreviewVoxel): string =>
  `${voxel.x},${voxel.y},${voxel.z},${voxel.material}`;

const clampGridIndex = (value: number, resolution: number): number =>
  Math.min(resolution - 1, Math.max(0, value));

const pointToGridIndex = (
  point: V3Vec3,
  axis: 0 | 1 | 2,
  bounds: V3Bounds,
  resolution: number
): number => {
  const span = bounds.max[axis] - bounds.min[axis];
  if (!Number.isFinite(span) || span <= 0) return 0;

  const pct = (point[axis] - bounds.min[axis]) / span;
  return clampGridIndex(Math.floor(pct * resolution), resolution);
};

const triangleBounds = (triangle: V3PreviewTriangle): V3Bounds => ({
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
});

export function voxelizeBoundsPreview(input: V3BoundsPreviewInput): V3VoxelPreview {
  const resolution = normalizeResolution(input.resolution);
  const voxels: V3PreviewVoxel[] = [];

  for (let x = 0; x < resolution; x += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let z = 0; z < resolution; z += 1) {
        if (
          x === 0 ||
          y === 0 ||
          z === 0 ||
          x === resolution - 1 ||
          y === resolution - 1 ||
          z === resolution - 1
        ) {
          voxels.push({ x, y, z, material: input.material });
        }
      }
    }
  }

  return {
    resolution,
    bounds: cloneBounds(input.bounds),
    voxels,
  };
}

export function voxelizeTriangleBoundsPreview(
  input: V3TriangleBoundsPreviewInput
): V3VoxelPreview {
  const resolution = normalizeResolution(input.resolution);
  const voxelsByKey = new Map<string, V3PreviewVoxel>();

  for (const triangle of input.triangles) {
    const bounds = triangleBounds(triangle);
    const minX = pointToGridIndex(bounds.min, 0, input.bounds, resolution);
    const minY = pointToGridIndex(bounds.min, 1, input.bounds, resolution);
    const minZ = pointToGridIndex(bounds.min, 2, input.bounds, resolution);
    const maxX = pointToGridIndex(bounds.max, 0, input.bounds, resolution);
    const maxY = pointToGridIndex(bounds.max, 1, input.bounds, resolution);
    const maxZ = pointToGridIndex(bounds.max, 2, input.bounds, resolution);

    for (let x = Math.min(minX, maxX); x <= Math.max(minX, maxX); x += 1) {
      for (let y = Math.min(minY, maxY); y <= Math.max(minY, maxY); y += 1) {
        for (let z = Math.min(minZ, maxZ); z <= Math.max(minZ, maxZ); z += 1) {
          const voxel = { x, y, z, material: triangle.material };
          voxelsByKey.set(voxelKey(voxel), voxel);
        }
      }
    }
  }

  return {
    resolution,
    bounds: cloneBounds(input.bounds),
    voxels: sortVoxels([...voxelsByKey.values()]),
  };
}
