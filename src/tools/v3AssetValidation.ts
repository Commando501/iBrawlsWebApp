import type { V3Bounds } from './v3ObjParser';
import type { V3PreviewVoxel } from './v3Voxelize';

export interface V3VoxelAssetValidationInput {
  voxels: V3PreviewVoxel[];
  maxVoxels: number;
  allowedBounds: V3Bounds;
  requiredMaterials?: string[];
}

export interface V3VoxelAssetValidationResult {
  errors: string[];
  voxelCount: number;
  materials: string[];
  connectedComponentCount: number;
}

const voxelPositionKey = (voxel: Pick<V3PreviewVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x},${voxel.y},${voxel.z}`;

const isInsideBounds = (voxel: V3PreviewVoxel, bounds: V3Bounds): boolean =>
  voxel.x >= bounds.min[0] &&
  voxel.x <= bounds.max[0] &&
  voxel.y >= bounds.min[1] &&
  voxel.y <= bounds.max[1] &&
  voxel.z >= bounds.min[2] &&
  voxel.z <= bounds.max[2];

const neighborKeys = (voxel: V3PreviewVoxel): string[] => [
  voxelPositionKey({ x: voxel.x + 1, y: voxel.y, z: voxel.z }),
  voxelPositionKey({ x: voxel.x - 1, y: voxel.y, z: voxel.z }),
  voxelPositionKey({ x: voxel.x, y: voxel.y + 1, z: voxel.z }),
  voxelPositionKey({ x: voxel.x, y: voxel.y - 1, z: voxel.z }),
  voxelPositionKey({ x: voxel.x, y: voxel.y, z: voxel.z + 1 }),
  voxelPositionKey({ x: voxel.x, y: voxel.y, z: voxel.z - 1 }),
];

const countConnectedComponents = (voxels: V3PreviewVoxel[]): number => {
  const voxelsByPosition = new Map<string, V3PreviewVoxel>();
  for (const voxel of voxels) {
    voxelsByPosition.set(voxelPositionKey(voxel), voxel);
  }

  let componentCount = 0;
  const visited = new Set<string>();

  for (const [startKey, startVoxel] of voxelsByPosition) {
    if (visited.has(startKey)) continue;

    componentCount += 1;
    const queue = [startVoxel];
    visited.add(startKey);

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const neighborKey of neighborKeys(current)) {
        if (visited.has(neighborKey)) continue;

        const neighbor = voxelsByPosition.get(neighborKey);
        if (!neighbor) continue;

        visited.add(neighborKey);
        queue.push(neighbor);
      }
    }
  }

  return componentCount;
};

export function validateV3VoxelAsset(
  input: V3VoxelAssetValidationInput
): V3VoxelAssetValidationResult {
  const errors: string[] = [];
  const voxelCount = input.voxels.length;
  const materials = [...new Set(input.voxels.map((voxel) => voxel.material))].sort();
  const connectedComponentCount = countConnectedComponents(input.voxels);

  if (voxelCount > input.maxVoxels) {
    errors.push(`voxel count ${voxelCount} exceeds budget ${input.maxVoxels}`);
  }

  for (const voxel of input.voxels) {
    if (!isInsideBounds(voxel, input.allowedBounds)) {
      errors.push(`voxel ${voxel.x},${voxel.y},${voxel.z} is outside allowed bounds`);
    }
  }

  for (const material of [...new Set(input.requiredMaterials ?? [])].sort()) {
    if (!materials.includes(material)) {
      errors.push(`missing required material ${material}`);
    }
  }

  if (connectedComponentCount > 1) {
    errors.push(`asset has ${connectedComponentCount} disconnected components`);
  }

  return {
    errors,
    voxelCount,
    materials,
    connectedComponentCount,
  };
}
