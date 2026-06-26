import * as THREE from 'three';
import type {
  CharacterLoadout,
  SpartanColors,
  VoxelData,
} from '../VoxelModels';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import type {
  V3ArmorRenderStyle,
} from './v3QualityTiers';
import { resolveV3RoleColor } from './v3PaintPalette';
import {
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  createV3VoxelArmorGroup,
} from './v3VoxelArmorSurface';
import type { V3CharacterSlotId, V3QualityTier } from './v3ModelTypes';

export interface V3UpperBodyUndersuitFillSet {
  root: THREE.Group;
  geometry: THREE.Group;
}

const FILL_SOURCE_SLOTS = ['chest', 'back', 'neck'] as const satisfies readonly V3CharacterSlotId[];
const EMPTY_BOX = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
const FILL_UNDERSUIT_COLOR = '#456276';

interface FillVoxelResult {
  voxels: VoxelData[];
  metrics: {
    sourceVoxelCount: number;
    voxelCount: number;
    sideProfileCoverage: number;
    sideProfileCells: number;
    targetSideProfileCells: number;
  };
}

interface SourceRowBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const getPartGroups = (model: THREE.Object3D): Partial<Record<V3CharacterSlotId, THREE.Object3D>> => {
  const candidate = model.userData?.v3PartGroups;
  return candidate && typeof candidate === 'object'
    ? candidate as Partial<Record<V3CharacterSlotId, THREE.Object3D>>
    : {};
};

const getObjectBox = (object: THREE.Object3D | undefined): THREE.Box3 => {
  if (!object) return EMPTY_BOX.clone();
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || box.isEmpty()) {
    const position = object.getWorldPosition(new THREE.Vector3());
    return new THREE.Box3(position.clone(), position.clone());
  }
  return box;
};

const unionBoxes = (boxes: readonly THREE.Box3[]): THREE.Box3 => {
  const union = new THREE.Box3();
  for (const box of boxes) {
    if (!box.isEmpty()) union.union(box);
  }
  return union;
};

const getOrCreateSourceRow = (
  rowsByY: Map<number, SourceRowBounds>,
  y: number,
  x: number,
  z: number
): SourceRowBounds => {
  const existing = rowsByY.get(y);
  if (existing) {
    existing.minX = Math.min(existing.minX, x);
    existing.maxX = Math.max(existing.maxX, x);
    existing.minZ = Math.min(existing.minZ, z);
    existing.maxZ = Math.max(existing.maxZ, z);
    return existing;
  }
  const created = { minX: x, maxX: x, minZ: z, maxZ: z };
  rowsByY.set(y, created);
  return created;
};

const createFillVoxels = (): FillVoxelResult => {
  const voxels = new Map<string, VoxelData>();
  const sourceVoxels = new Set<string>();
  const rowsByY = new Map<number, SourceRowBounds>();
  const filledSideProfile = new Set<string>();
  const undersuitColor = FILL_UNDERSUIT_COLOR;

  for (const slot of FILL_SOURCE_SLOTS) {
    const sourceSlot = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots[slot];
    if (!sourceSlot) continue;
    for (const run of sourceSlot.runs) {
      for (let x = run[3]; x <= run[4]; x += 1) {
        sourceVoxels.add(`${x}:${run[1]}:${run[2]}`);
        getOrCreateSourceRow(rowsByY, run[1], x, run[2]);
      }
    }
  }

  let targetSideProfileCells = 0;
  for (const [y, row] of rowsByY.entries()) {
    const width = row.maxX - row.minX + 1;
    const depth = row.maxZ - row.minZ + 1;
    const xInset = Math.min(5, Math.max(2, Math.round(width * 0.12)));
    const zInset = Math.min(5, Math.max(2, Math.round(depth * 0.12)));
    const xStart = Math.min(row.maxX, row.minX + xInset);
    const xEnd = Math.max(row.minX, row.maxX - xInset);
    const zStart = row.minZ + zInset;
    const zEnd = row.maxZ - zInset;
    if (xStart > xEnd || zStart > zEnd) continue;

    for (let z = zStart; z <= zEnd; z += 1) {
      targetSideProfileCells += 1;
      let rowHasFill = false;
      for (let x = xStart; x <= xEnd; x += 1) {
        const key = `${x}:${y}:${z}`;
        if (sourceVoxels.has(key)) continue;
        voxels.set(key, {
          x,
          y,
          z,
          color: undersuitColor,
        });
        rowHasFill = true;
      }
      if (rowHasFill) filledSideProfile.add(`${y}:${z}`);
    }
  }

  const sortedVoxels = [...voxels.values()].sort((left, right) => (
    left.y - right.y ||
    left.z - right.z ||
    left.x - right.x ||
    left.color.localeCompare(right.color)
  ));

  return {
    voxels: sortedVoxels,
    metrics: {
      sourceVoxelCount: sourceVoxels.size,
      voxelCount: sortedVoxels.length,
      sideProfileCoverage: targetSideProfileCells > 0
        ? Number((filledSideProfile.size / targetSideProfileCells).toFixed(4))
        : 0,
      sideProfileCells: filledSideProfile.size,
      targetSideProfileCells,
    },
  };
};

export function createV3UpperBodyUndersuitFill(
  colors: SpartanColors,
  paintJob: CharacterLoadout['paintJob'] | undefined,
  options: {
    qualityTier: V3QualityTier;
    renderStyle: V3ArmorRenderStyle;
  }
): V3UpperBodyUndersuitFillSet {
  const root = new THREE.Group();
  root.name = 'v3UpperBodyUndersuitFill';
  root.userData.v3UpperBodyUndersuitFill = true;
  root.userData.v3UpperBodyUndersuitFillSourceKind = 'exact-obj';
  root.visible = true;

  const fill = createFillVoxels();
  const geometry = createV3VoxelArmorGroup(fill.voxels, {
    ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
    voxelScale: V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale,
    renderStyle: options.renderStyle,
    qualityTier: options.qualityTier,
    cacheKey: [
      'v3-upper-body-undersuit-fill',
      V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash,
      options.renderStyle,
      options.qualityTier,
      resolveV3RoleColor('undersuit', colors, paintJob),
      FILL_UNDERSUIT_COLOR,
    ].join('|'),
  });
  geometry.name = 'v3UpperBodyUndersuitFill:geometry';
  geometry.userData.v3UpperBodyUndersuitFillGeometry = true;
  geometry.userData.v3UpperBodyUndersuitFillSourceKind = 'exact-obj';
  geometry.userData.v3UpperBodyUndersuitFillVoxelCount = fill.metrics.voxelCount;
  geometry.userData.v3UpperBodyUndersuitFillSourceVoxelCount = fill.metrics.sourceVoxelCount;
  geometry.userData.v3UpperBodyUndersuitFillSideProfileCoverage = fill.metrics.sideProfileCoverage;
  geometry.userData.v3UpperBodyUndersuitFillSideProfileCells = fill.metrics.sideProfileCells;
  geometry.userData.v3UpperBodyUndersuitFillTargetSideProfileCells = fill.metrics.targetSideProfileCells;
  root.add(geometry);

  return { root, geometry };
}

export function updateV3UpperBodyUndersuitFill(model: THREE.Object3D, visible = true): void {
  const fillSet = model.userData.v3UpperBodyUndersuitFill as V3UpperBodyUndersuitFillSet | undefined;
  if (!fillSet) return;
  fillSet.root.visible = visible;
  fillSet.geometry.visible = visible;
  if (!visible) return;

  const partGroups = getPartGroups(model);
  const chestBox = getObjectBox(partGroups.chest);
  const backBox = getObjectBox(partGroups.back);
  const neckBox = getObjectBox(partGroups.neck);
  const targetBox = unionBoxes([chestBox, backBox, neckBox]);
  if (targetBox.isEmpty()) {
    fillSet.root.visible = false;
    fillSet.geometry.visible = false;
    return;
  }

  fillSet.root.quaternion.identity();
  fillSet.root.scale.setScalar(1);
  fillSet.root.position.set(0, 0, 0);
  fillSet.root.updateWorldMatrix(true, true);

  const sourceBox = new THREE.Box3().setFromObject(fillSet.root);
  if (sourceBox.isEmpty()) return;
  const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  const targetCenter = targetBox.getCenter(new THREE.Vector3());
  const desiredCenter = new THREE.Vector3(
    targetCenter.x,
    targetBox.max.y - (sourceSize.y * 0.5),
    targetCenter.z
  );
  fillSet.root.position.copy(desiredCenter.sub(sourceCenter));
  fillSet.root.updateWorldMatrix(true, true);
}

export function setV3UpperBodyUndersuitFillVisible(model: THREE.Object3D, visible: boolean): void {
  const fillSet = model.userData.v3UpperBodyUndersuitFill as V3UpperBodyUndersuitFillSet | undefined;
  if (!fillSet) return;
  fillSet.root.visible = visible;
  fillSet.geometry.visible = visible;
}
