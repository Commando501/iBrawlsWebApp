import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VoxelData } from '../VoxelModels';
import { getV3CachedMaterial } from './v3GeometryCache';
import { type V3QualityTier } from './v3ModelTypes';
import {
  normalizeV3ArmorRenderStyle,
  normalizeV3QualityTier,
  type V3ArmorRenderStyle,
} from './v3QualityTiers';

type AxisDirection = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

interface SurfaceFace {
  direction: AxisDirection;
  color: string;
  emissive: boolean;
  plane: number;
  u: number;
  v: number;
}

interface SurfacePanel {
  direction: AxisDirection;
  color: string;
  emissive: boolean;
  plane: number;
  minU: number;
  minV: number;
  sizeU: number;
  sizeV: number;
}

export interface V3ArmorSurfaceOptions {
  voxelScale?: number;
  renderStyle?: V3ArmorRenderStyle;
  qualityTier?: V3QualityTier;
  pivot?: THREE.Vector3Tuple;
}

export interface V3ArmorSurfaceReport {
  inputVoxelCount: number;
  uniqueVoxelCount: number;
  exposedFaceCount: number;
  panelCount: number;
  materialGroupCount: number;
  emissivePanelCount: number;
  renderStyle: V3ArmorRenderStyle;
}

const DEFAULT_VOXEL_SCALE = 0.055;
const DIRECTIONS: Array<{
  id: AxisDirection;
  neighbor: readonly [number, number, number];
}> = [
  { id: 'px', neighbor: [1, 0, 0] },
  { id: 'nx', neighbor: [-1, 0, 0] },
  { id: 'py', neighbor: [0, 1, 0] },
  { id: 'ny', neighbor: [0, -1, 0] },
  { id: 'pz', neighbor: [0, 0, 1] },
  { id: 'nz', neighbor: [0, 0, -1] },
];

const coordKey = (voxel: { x: number; y: number; z: number }): string => `${voxel.x},${voxel.y},${voxel.z}`;
const materialKey = (color: string, emissive: boolean): string => `${color}|${emissive ? '1' : '0'}`;

const normalizeScale = (scale: unknown): number =>
  typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_VOXEL_SCALE;

const normalizePivot = (pivot: THREE.Vector3Tuple | undefined): THREE.Vector3Tuple => (
  Array.isArray(pivot) && pivot.length === 3
    ? [
        Number.isFinite(pivot[0]) ? pivot[0] : 0,
        Number.isFinite(pivot[1]) ? pivot[1] : 0,
        Number.isFinite(pivot[2]) ? pivot[2] : 0,
      ]
    : [0, 0, 0]
);

function createPanelBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments: number
): THREE.BufferGeometry {
  if (radius <= 0 || width <= radius * 2 || height <= radius * 2 || depth <= radius * 2) {
    return new THREE.BoxGeometry(width, height, depth);
  }

  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width * 0.35, height * 0.35, depth * 0.35);

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - r * 2, depth * 0.2),
    steps: 1,
    bevelEnabled: true,
    bevelSegments: segments,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: Math.max(3, segments + 2),
  });
  geometry.center();
  return geometry;
}

function faceForDirection(voxel: VoxelData, direction: AxisDirection): SurfaceFace {
  const emissive = voxel.emissive === true;
  if (direction === 'px' || direction === 'nx') {
    return {
      direction,
      color: voxel.color,
      emissive,
      plane: voxel.x + (direction === 'px' ? 0.5 : -0.5),
      u: voxel.z,
      v: voxel.y,
    };
  }
  if (direction === 'py' || direction === 'ny') {
    return {
      direction,
      color: voxel.color,
      emissive,
      plane: voxel.y + (direction === 'py' ? 0.5 : -0.5),
      u: voxel.x,
      v: voxel.z,
    };
  }
  return {
    direction,
    color: voxel.color,
    emissive,
    plane: voxel.z + (direction === 'pz' ? 0.5 : -0.5),
    u: voxel.x,
    v: voxel.y,
  };
}

function collectSurfaceFaces(voxels: VoxelData[]): {
  faces: SurfaceFace[];
  uniqueVoxelCount: number;
} {
  const voxelMap = new Map<string, VoxelData>();
  for (const voxel of voxels) {
    voxelMap.set(coordKey(voxel), voxel);
  }

  const faces: SurfaceFace[] = [];
  for (const voxel of voxelMap.values()) {
    for (const direction of DIRECTIONS) {
      const [dx, dy, dz] = direction.neighbor;
      if (!voxelMap.has(`${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`)) {
        faces.push(faceForDirection(voxel, direction.id));
      }
    }
  }

  return { faces, uniqueVoxelCount: voxelMap.size };
}

function mergeCoplanarFaces(faces: SurfaceFace[]): SurfacePanel[] {
  const grouped = new Map<string, SurfaceFace[]>();
  for (const face of faces) {
    const key = `${face.direction}|${face.plane}|${materialKey(face.color, face.emissive)}`;
    const list = grouped.get(key);
    if (list) list.push(face);
    else grouped.set(key, [face]);
  }

  const panels: SurfacePanel[] = [];
  for (const list of grouped.values()) {
    const cells = new Map<string, SurfaceFace>();
    const uValues = new Set<number>();
    const vValues = new Set<number>();
    for (const face of list) {
      cells.set(`${face.u},${face.v}`, face);
      uValues.add(face.u);
      vValues.add(face.v);
    }

    const sortedU = [...uValues].sort((a, b) => a - b);
    const sortedV = [...vValues].sort((a, b) => a - b);
    const visited = new Set<string>();

    for (const v of sortedV) {
      for (const u of sortedU) {
        const startKey = `${u},${v}`;
        const start = cells.get(startKey);
        if (!start || visited.has(startKey)) continue;

        let width = 1;
        while (cells.has(`${u + width},${v}`) && !visited.has(`${u + width},${v}`)) {
          width++;
        }

        let height = 1;
        let canGrow = true;
        while (canGrow) {
          for (let du = 0; du < width; du++) {
            const key = `${u + du},${v + height}`;
            if (!cells.has(key) || visited.has(key)) {
              canGrow = false;
              break;
            }
          }
          if (canGrow) height++;
        }

        for (let dv = 0; dv < height; dv++) {
          for (let du = 0; du < width; du++) {
            visited.add(`${u + du},${v + dv}`);
          }
        }

        panels.push({
          direction: start.direction,
          color: start.color,
          emissive: start.emissive,
          plane: start.plane,
          minU: u,
          minV: v,
          sizeU: width,
          sizeV: height,
        });
      }
    }
  }

  return panels;
}

function buildSurface(voxels: VoxelData[], renderStyle: V3ArmorRenderStyle): {
  panels: SurfacePanel[];
  report: V3ArmorSurfaceReport;
} {
  const { faces, uniqueVoxelCount } = collectSurfaceFaces(voxels);
  const panels = mergeCoplanarFaces(faces);
  const materialGroups = new Set(faces.map((face) => materialKey(face.color, face.emissive)));
  const emissivePanelCount = panels.filter((panel) => panel.emissive).length;

  return {
    panels,
    report: {
      inputVoxelCount: voxels.length,
      uniqueVoxelCount,
      exposedFaceCount: faces.length,
      panelCount: panels.length,
      materialGroupCount: materialGroups.size,
      emissivePanelCount,
      renderStyle,
    },
  };
}

export function analyzeV3ArmorSurface(
  voxels: VoxelData[],
  options: Pick<V3ArmorSurfaceOptions, 'renderStyle'> = {}
): V3ArmorSurfaceReport {
  return buildSurface(voxels, normalizeV3ArmorRenderStyle(options.renderStyle)).report;
}

function getPanelQuality(tier: V3QualityTier): { thicknessFactor: number; radiusFactor: number; segments: number } {
  if (tier === 'mobileLow') return { thicknessFactor: 0.12, radiusFactor: 0.12, segments: 1 };
  if (tier === 'mobile') return { thicknessFactor: 0.14, radiusFactor: 0.15, segments: 1 };
  if (tier === 'ultra') return { thicknessFactor: 0.18, radiusFactor: 0.24, segments: 3 };
  return { thicknessFactor: 0.16, radiusFactor: 0.2, segments: 2 };
}

function translatePanelGeometry(
  geometry: THREE.BufferGeometry,
  panel: SurfacePanel,
  scale: number,
  thickness: number,
  pivot: THREE.Vector3Tuple
): void {
  const centerU = (panel.minU + (panel.sizeU - 1) / 2);
  const centerV = (panel.minV + (panel.sizeV - 1) / 2);
  const normalOffset = panel.direction.startsWith('p') ? thickness * 0.5 : -thickness * 0.5;

  if (panel.direction === 'px' || panel.direction === 'nx') {
    geometry.rotateY(Math.PI / 2);
    geometry.translate(
      (panel.plane - pivot[0]) * scale + normalOffset,
      (centerV - pivot[1]) * scale,
      (centerU - pivot[2]) * scale
    );
  } else if (panel.direction === 'py' || panel.direction === 'ny') {
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(
      (centerU - pivot[0]) * scale,
      (panel.plane - pivot[1]) * scale + normalOffset,
      (centerV - pivot[2]) * scale
    );
  } else {
    geometry.translate(
      (centerU - pivot[0]) * scale,
      (centerV - pivot[1]) * scale,
      (panel.plane - pivot[2]) * scale + normalOffset
    );
  }
}

function createSurfacePanelGeometries(
  panels: SurfacePanel[],
  options: Required<Pick<V3ArmorSurfaceOptions, 'qualityTier'>> & {
    voxelScale: number;
    pivot: THREE.Vector3Tuple;
  }
): Map<string, THREE.BufferGeometry[]> {
  const quality = getPanelQuality(options.qualityTier);
  const thickness = options.voxelScale * quality.thicknessFactor;
  const radius = options.voxelScale * quality.radiusFactor;
  const byMaterial = new Map<string, THREE.BufferGeometry[]>();

  for (const panel of panels) {
    const width = Math.max(options.voxelScale * panel.sizeU, options.voxelScale * 0.15);
    const height = Math.max(options.voxelScale * panel.sizeV, options.voxelScale * 0.15);
    const geometry = createPanelBoxGeometry(width, height, thickness, radius, quality.segments);
    translatePanelGeometry(geometry, panel, options.voxelScale, thickness, options.pivot);
    const key = materialKey(panel.color, panel.emissive);
    const list = byMaterial.get(key);
    if (list) list.push(geometry);
    else byMaterial.set(key, [geometry]);
  }

  return byMaterial;
}

function createVoxelEditGeometries(
  voxels: VoxelData[],
  options: {
    voxelScale: number;
    pivot: THREE.Vector3Tuple;
  }
): Map<string, THREE.BufferGeometry[]> {
  const byMaterial = new Map<string, THREE.BufferGeometry[]>();
  const voxelMap = new Map<string, VoxelData>();
  for (const voxel of voxels) {
    voxelMap.set(coordKey(voxel), voxel);
  }

  for (const voxel of voxelMap.values()) {
    const geometry = new THREE.BoxGeometry(options.voxelScale, options.voxelScale, options.voxelScale);
    geometry.translate(
      (voxel.x - options.pivot[0]) * options.voxelScale,
      (voxel.y - options.pivot[1]) * options.voxelScale,
      (voxel.z - options.pivot[2]) * options.voxelScale
    );
    const key = materialKey(voxel.color, voxel.emissive === true);
    const list = byMaterial.get(key);
    if (list) list.push(geometry);
    else byMaterial.set(key, [geometry]);
  }

  return byMaterial;
}

function addMergedMeshes(group: THREE.Group, geometriesByMaterial: Map<string, THREE.BufferGeometry[]>): void {
  for (const [key, geometries] of geometriesByMaterial.entries()) {
    const [color, emissiveFlag] = key.split('|');
    const merged = geometries.length === 1 ? geometries[0] : BufferGeometryUtils.mergeGeometries(geometries, false);
    if (!merged) {
      geometries.forEach((geometry) => geometry.dispose());
      continue;
    }
    if (geometries.length > 1) {
      geometries.forEach((geometry) => geometry.dispose());
    }
    const mesh = new THREE.Mesh(merged, getV3CachedMaterial(color, emissiveFlag === '1'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.v3MaterialKey = key;
    mesh.userData.v3CachedMaterial = true;
    group.add(mesh);
  }
}

export function createV3VoxelArmorGroup(
  voxels: VoxelData[],
  options: V3ArmorSurfaceOptions = {}
): THREE.Group {
  const renderStyle = normalizeV3ArmorRenderStyle(options.renderStyle);
  const qualityTier = normalizeV3QualityTier(options.qualityTier);
  const voxelScale = normalizeScale(options.voxelScale);
  const pivot = normalizePivot(options.pivot);
  const group = new THREE.Group();
  const { panels, report } = buildSurface(voxels, renderStyle);

  const geometriesByMaterial = renderStyle === 'voxelEdit'
    ? createVoxelEditGeometries(voxels, { voxelScale, pivot })
    : createSurfacePanelGeometries(panels, { voxelScale, pivot, qualityTier });

  addMergedMeshes(group, geometriesByMaterial);

  group.userData.v3ArmorRenderStyle = renderStyle;
  group.userData.v3ArmorSurface = report;
  group.userData.v3QualityTier = qualityTier;
  group.userData.v3VoxelScale = voxelScale;
  return group;
}
