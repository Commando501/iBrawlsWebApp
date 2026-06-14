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
export type V3PanelCornerStyle = 'square' | 'clipped';
export type V3PanelDepthStyle = 'flush' | 'recessed';

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
  panelCornerStyle?: V3PanelCornerStyle;
  panelDepthStyle?: V3PanelDepthStyle;
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
  panelCornerStyle: V3PanelCornerStyle;
  panelDepthStyle: V3PanelDepthStyle;
  beveledPanelCount: number;
  recessedPanelCount: number;
}

export const V3_ARMOR_SURFACE_DEFAULT_OPTIONS = {
  panelCornerStyle: 'clipped',
  panelDepthStyle: 'recessed',
} as const satisfies Pick<V3ArmorSurfaceOptions, 'panelCornerStyle' | 'panelDepthStyle'>;

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

const normalizePanelCornerStyle = (
  style: unknown,
  renderStyle: V3ArmorRenderStyle
): V3PanelCornerStyle => {
  if (renderStyle === 'voxelEdit') return 'square';
  return style === 'square' ? 'square' : 'clipped';
};

const normalizePanelDepthStyle = (
  style: unknown,
  renderStyle: V3ArmorRenderStyle
): V3PanelDepthStyle => {
  if (renderStyle === 'voxelEdit') return 'flush';
  return style === 'flush' ? 'flush' : 'recessed';
};

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

function createClippedPanelGeometry(
  width: number,
  height: number,
  depth: number,
  clip: number,
  bevelSegments: number
): THREE.BufferGeometry {
  const inset = Math.min(clip, width * 0.22, height * 0.22);
  if (inset <= 0 || width <= inset * 2 || height <= inset * 2) {
    return new THREE.BoxGeometry(width, height, depth);
  }

  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + inset, y);
  shape.lineTo(x + width - inset, y);
  shape.lineTo(x + width, y + inset);
  shape.lineTo(x + width, y + height - inset);
  shape.lineTo(x + width - inset, y + height);
  shape.lineTo(x + inset, y + height);
  shape.lineTo(x, y + height - inset);
  shape.lineTo(x, y + inset);
  shape.closePath();

  const normalizedBevelSegments = Math.max(0, Math.floor(bevelSegments));
  const bevelSize = normalizedBevelSegments > 0
    ? Math.min(inset * 0.35, depth * 0.45, width * 0.08, height * 0.08)
    : 0;
  const bevelThickness = bevelSize;
  const innerDepth = bevelSize > 0
    ? Math.max(depth - bevelThickness * 2, depth * 0.2)
    : depth;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: innerDepth,
    steps: 1,
    bevelEnabled: bevelSize > 0,
    bevelSegments: normalizedBevelSegments,
    bevelSize,
    bevelThickness,
    curveSegments: 1,
  });
  geometry.center();
  geometry.computeVertexNormals();
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

function buildSurface(
  voxels: VoxelData[],
  renderStyle: V3ArmorRenderStyle,
  panelCornerStyle: V3PanelCornerStyle,
  panelDepthStyle: V3PanelDepthStyle
): {
  panels: SurfacePanel[];
  report: V3ArmorSurfaceReport;
} {
  const { faces, uniqueVoxelCount } = collectSurfaceFaces(voxels);
  const panels = mergeCoplanarFaces(faces);
  const materialGroups = new Set(faces.map((face) => materialKey(face.color, face.emissive)));
  const emissivePanelCount = panels.filter((panel) => panel.emissive).length;
  const renderedSurfacePanelCount = renderStyle === 'armorSurface' ? panels.length : 0;

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
      panelCornerStyle,
      panelDepthStyle,
      beveledPanelCount: panelCornerStyle === 'clipped' ? renderedSurfacePanelCount : 0,
      recessedPanelCount: panelDepthStyle === 'recessed' ? renderedSurfacePanelCount : 0,
    },
  };
}

export function analyzeV3ArmorSurface(
  voxels: VoxelData[],
  options: Pick<V3ArmorSurfaceOptions, 'renderStyle' | 'panelCornerStyle' | 'panelDepthStyle'> = {}
): V3ArmorSurfaceReport {
  const renderStyle = normalizeV3ArmorRenderStyle(options.renderStyle);
  const panelCornerStyle = normalizePanelCornerStyle(options.panelCornerStyle, renderStyle);
  const panelDepthStyle = normalizePanelDepthStyle(options.panelDepthStyle, renderStyle);
  return buildSurface(voxels, renderStyle, panelCornerStyle, panelDepthStyle).report;
}

function getPanelQuality(tier: V3QualityTier): { thicknessFactor: number; radiusFactor: number; segments: number } {
  if (tier === 'mobileLow') return { thicknessFactor: 0.12, radiusFactor: 0.12, segments: 1 };
  if (tier === 'mobile') return { thicknessFactor: 0.14, radiusFactor: 0.15, segments: 1 };
  if (tier === 'ultra') return { thicknessFactor: 0.18, radiusFactor: 0.24, segments: 3 };
  return { thicknessFactor: 0.16, radiusFactor: 0.2, segments: 2 };
}

function getPanelRenderDimension(
  span: number,
  voxelScale: number,
  panelDepthStyle: V3PanelDepthStyle
): number {
  const base = Math.max(voxelScale * span, voxelScale * 0.15);
  if (panelDepthStyle !== 'recessed' || span <= 1) return base;

  const shrink = Math.min(voxelScale * 0.12, base * 0.08);
  const minSafe = Math.max(voxelScale * 0.35, base * 0.55);
  const recessed = base - shrink;
  return recessed >= minSafe ? recessed : base;
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
    panelCornerStyle: V3PanelCornerStyle;
    panelDepthStyle: V3PanelDepthStyle;
    pivot: THREE.Vector3Tuple;
  }
): Map<string, THREE.BufferGeometry[]> {
  const quality = getPanelQuality(options.qualityTier);
  const thickness = options.voxelScale * quality.thicknessFactor;
  const radius = options.voxelScale * quality.radiusFactor;
  const byMaterial = new Map<string, THREE.BufferGeometry[]>();

  for (const panel of panels) {
    const width = getPanelRenderDimension(panel.sizeU, options.voxelScale, options.panelDepthStyle);
    const height = getPanelRenderDimension(panel.sizeV, options.voxelScale, options.panelDepthStyle);
    const geometry = options.panelCornerStyle === 'clipped'
      ? createClippedPanelGeometry(width, height, thickness, radius, quality.segments)
      : createPanelBoxGeometry(width, height, thickness, radius, quality.segments);
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
  const panelCornerStyle = normalizePanelCornerStyle(options.panelCornerStyle, renderStyle);
  const panelDepthStyle = normalizePanelDepthStyle(options.panelDepthStyle, renderStyle);
  const { panels, report } = buildSurface(voxels, renderStyle, panelCornerStyle, panelDepthStyle);

  const geometriesByMaterial = renderStyle === 'voxelEdit'
    ? createVoxelEditGeometries(voxels, { voxelScale, pivot })
    : createSurfacePanelGeometries(panels, { voxelScale, panelCornerStyle, panelDepthStyle, pivot, qualityTier });

  addMergedMeshes(group, geometriesByMaterial);

  group.userData.v3ArmorRenderStyle = renderStyle;
  group.userData.v3PanelCornerStyle = panelCornerStyle;
  group.userData.v3PanelDepthStyle = panelDepthStyle;
  group.userData.v3ArmorSurface = report;
  group.userData.v3QualityTier = qualityTier;
  group.userData.v3VoxelScale = voxelScale;
  return group;
}
