import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { CustomMapData } from '../../types';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createCanyonArchitectureMaterial } from './canyonMaterials';
import { disposeCanyonObjectResources } from './canyonResourceDisposal';

export const CANYON_ARCHITECTURE_ASSETS = {
  high: 'assets/canyon/architecture/kit-v1.glb',
  low: 'assets/canyon/architecture/kit-low-v1.glb',
} as const;
export const CANYON_ARCHITECTURE_PARTS = ['anchor-spire', 'buffer-cover', 'beacon-tower', 'canyon-cliff'] as const;
export type CanyonArchitecturePart = typeof CANYON_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
type Accent = 'blue' | 'red' | 'warm' | 'none';
interface CanyonPlacement { matrix: THREE.Matrix4; objectId?: string; accent: Accent }
export interface CanyonArchitectureHandle { ready: Promise<void>; cancel: () => void }

const PART_BY_ID: Readonly<Record<string, Exclude<CanyonArchitecturePart, 'canyon-cliff'>>> = {
  spire_nw: 'anchor-spire', spire_sw: 'anchor-spire', spire_ne: 'anchor-spire', spire_se: 'anchor-spire',
  spire_cn: 'anchor-spire', spire_cs: 'anchor-spire', barrier_w: 'buffer-cover', barrier_e: 'buffer-cover',
  bg_beacon_tower: 'beacon-tower', bg_pillar_l: 'anchor-spire', bg_pillar_r: 'anchor-spire',
};
export const CANYON_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<CanyonArchitecturePart, THREE.Vector3> = {
  'anchor-spire': new THREE.Vector3(2, 8, 2), 'buffer-cover': new THREE.Vector3(1.2, 2, 4),
  'beacon-tower': new THREE.Vector3(3, 40, 3), 'canyon-cliff': new THREE.Vector3(20, 30, 12),
};

/** Two immutable source scenes are shared; rejected requests can be retried. */
export function createCanyonArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const cache = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail) => {
    const previous = cache.get(detail);
    if (previous) return previous;
    const pending = load(detail).catch(error => {
      if (cache.get(detail) === pending) cache.delete(detail);
      throw error;
    });
    cache.set(detail, pending);
    return pending;
  };
}
const loadSource = createCanyonArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${CANYON_ARCHITECTURE_ASSETS[detail]}`);
  for (const name of CANYON_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(name)) throw new Error(`Canyon architecture is missing ${name}`);
  }
  return scene;
});

/** Existing props keep their exact authored centers, rotations, and collider extents. */
export function getCanyonArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail) {
  const placements: Record<CanyonArchitecturePart, CanyonPlacement[]> = {
    'anchor-spire': [], 'buffer-cover': [], 'beacon-tower': [], 'canyon-cliff': [],
  };
  for (const object of map.objects) {
    const part = PART_BY_ID[object.id];
    if (!part) continue;
    const position = new THREE.Vector3(object.position.x, object.position.y, object.position.z);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z));
    const scale = new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z).divide(PART_SIZE[part]);
    const accent: Accent = object.id.startsWith('bg_pillar') ? 'none'
      : object.id.endsWith('_nw') || object.id.endsWith('_sw') || object.id === 'barrier_w' ? 'blue'
      : object.id.endsWith('_ne') || object.id.endsWith('_se') || object.id === 'barrier_e' ? 'red' : 'warm';
    placements[part].push({ matrix: new THREE.Matrix4().compose(position, rotation, scale), objectId: object.id, accent });
  }

  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  // Midground mesas sit below the suspended deck. Their complete rotated bounds
  // stay outside the playable footprint, leaving the original skyline and lanes open.
  const cliffs = [
    [-half.x - 37, -18, -half.z - 32, 0.4, 2.2, 1.5, 1.4],
    [half.x + 39, -22, -half.z - 38, -0.35, 2.8, 1.8, 1.6],
    [-half.x * 0.35, -21, -half.z - 67, 0.08, 3.5, 1.8, 1.6],
    [-half.x - 43, -25, half.z + 36, 0.5, 2.7, 1.6, 1.9],
    [half.x + 44, -20, half.z + 35, -0.6, 2.4, 1.7, 1.7],
    [half.x * 0.65, -31, half.z + 70, -0.1, 3.1, 1.8, 1.5],
    [-half.x - 68, -26, -half.z - 62, 0.8, 2.9, 2.2, 1.8],
    [half.x + 66, -29, -half.z - 72, -0.7, 3.1, 2.1, 1.8],
  ];
  for (const [x, y, z, yaw, sx, sy, sz] of cliffs.slice(0, detail === 'high' ? 8 : 5)) {
    placements['canyon-cliff'].push({
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz)),
      accent: 'none',
    });
  }
  return placements;
}

/** All GPU handles are owned by the mounted scene; cached source meshes stay immutable. */
export function createCanyonArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory,
): THREE.Group {
  const roots = CANYON_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root) throw new Error(`Canyon architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'canyon_blender_architecture'; group.userData.detail = detail;
  const placements = getCanyonArchitecturePlacements(map, detail);
  const materials = new Map<THREE.Material, Map<Accent, THREE.Material>>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const allocatedMaterials = new Set<THREE.Material>();
  const ownMaterial = (sourceMaterial: THREE.Material, accent: Accent) => {
    let variants = materials.get(sourceMaterial);
    if (!variants) { variants = new Map(); materials.set(sourceMaterial, variants); }
    const existing = variants.get(accent);
    if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied ?? sourceMaterial.clone();
    if (!supplied) {
      for (const [slot, value] of Object.entries(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        let texture = textures.get(value);
        if (!texture) { texture = value.clone(); textures.set(value, texture); }
        (material as unknown as Record<string, unknown>)[slot] = texture;
      }
    }
    if (accent !== 'none' && material instanceof THREE.MeshStandardMaterial) {
      const tint = accent === 'blue' ? '#42b9df' : accent === 'red' ? '#e25d58' : '#d5a55d';
      material.color.set(tint); material.emissive.set(tint); material.emissiveIntensity = 0.6;
    } else if (sourceMaterial.name === 'canyon_cyan' && material instanceof THREE.MeshStandardMaterial) {
      material.color.set('#738594'); material.emissive.set('#000000'); material.emissiveIntensity = 0;
    }
    variants.set(accent, material); allocatedMaterials.add(material);
    return material;
  };
  try {
    source.updateMatrixWorld(true);
    for (const [partIndex, part] of CANYON_ARCHITECTURE_PARTS.entries()) {
      const root = roots[partIndex];
      const inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh) || placements[part].length === 0) return;
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        applyStadiumWorldUVs(geometry, part === 'canyon-cliff' ? 8 : 3);
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const teamAccent = sourceMaterials.some(material => material.name === 'canyon_cyan');
        const batches = teamAccent ? (['blue', 'red', 'warm', 'none'] as const) : (['none'] as const);
        for (const accent of batches) {
          const batch = placements[part].filter(placement => !teamAccent || placement.accent === accent);
          if (batch.length === 0) continue;
          const assigned = sourceMaterials.map(material => ownMaterial(material, material.name === 'canyon_cyan' ? accent : 'none'));
          const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], batch.length);
          mesh.name = `canyon_kit_${part}_${child.name}_${accent}`;
          mesh.userData.architecturePart = part;
          mesh.userData.objectIds = batch.flatMap(placement => placement.objectId ? [placement.objectId] : []);
          mesh.castShadow = part === 'anchor-spire' || part === 'buffer-cover';
          mesh.receiveShadow = true;
          batch.forEach((placement, index) => mesh.setMatrixAt(index, placement.matrix));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
        }
      });
    }
    return group;
  } catch (error) {
    // Also own factory materials allocated immediately before a failed batch.
    const holder = new THREE.Mesh(undefined, [...allocatedMaterials]); group.add(holder);
    disposeCanyonObjectResources([group]);
    throw error;
  }
}

/** Structural depth is concentrated under the deck; no geometry overlays the play surface. */
export function createCanyonPerimeter(map: CustomMapData, materialFactory: MaterialFactory): THREE.Group {
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const group = new THREE.Group(); group.name = 'canyon_subdeck';
  const parts: Record<string, THREE.BufferGeometry[]> = { canyon_graphite: [], canyon_ceramic: [], canyon_trim: [] };
  const box = (name: keyof typeof parts, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.translate(x, y, z); parts[name].push(geometry);
  };
  for (const side of [-1, 1]) {
    box('canyon_graphite', 0, -1.15, side * (half.z - 0.65), half.x * 2 - 1.3, 2.2, 1.3);
    box('canyon_graphite', side * (half.x - 0.65), -1.15, 0, 1.3, 2.2, half.z * 2);
    for (const alongX of [true, false]) {
      const length = alongX ? half.x * 2 : half.z * 2;
      const edge = (alongX ? half.z : half.x) + 0.16;
      const pieces = Math.max(1, Math.ceil(length / 6));
      const width = length / pieces;
      for (let i = 0; i < pieces; i++) {
        const along = -length / 2 + width * (i + 0.5);
        box('canyon_ceramic', alongX ? along : side * edge, -0.45, alongX ? side * edge : along,
          alongX ? width - 0.05 : 0.3, 0.7, alongX ? 0.3 : width - 0.05);
      }
      box('canyon_trim', alongX ? 0 : side * (edge + 0.015), -0.065, alongX ? side * (edge + 0.015) : 0,
        alongX ? length : 0.32, 0.06, alongX ? 0.32 : length);
    }
  }
  for (const [name, geometries] of Object.entries(parts)) {
    const geometry = mergeGeometries(geometries); geometries.forEach(part => part.dispose());
    if (!geometry) continue;
    applyStadiumWorldUVs(geometry, 3);
    const source = new THREE.MeshStandardMaterial({ color: '#63727c', metalness: 0.5, roughness: 0.65 }); source.name = name;
    const material = materialFactory(source) ?? source.clone(); source.dispose();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `canyon_perimeter_${name}`;
    mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}

export function buildCanyonSceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createCanyonArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): CanyonArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'forerunner_canyon' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'canyon_scenery'; group.userData.architectureStatus = 'loading';
  group.add(createCanyonPerimeter(activeCustomMap, materialFactory)); scene.add(group);
  (refs.customMapObjects ??= []).push(group);
  let canceled = false;
  const ready = load(quality.architectureDetail).then(source => {
    if (canceled || group.parent !== scene) return;
    const architecture = createCanyonArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory);
    group.add(architecture);
    const legacyById = new Map<string, THREE.Object3D>();
    scene.traverse(object => {
      if (typeof object.userData.canyonLegacyId === 'string') legacyById.set(object.userData.canyonLegacyId, object);
    });
    for (const object of activeCustomMap.objects) {
      if (PART_BY_ID[object.id]) {
        // The original object name remains available to existing runtime and
        // replay consumers; the ownership marker is confined to visual cleanup.
        const legacy = legacyById.get(object.id)
          ?? scene.getObjectByName(`canyon_legacy_${object.id}`)
          ?? scene.getObjectByName(object.id);
        if (legacy) legacy.visible = false;
      }
    }
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Canyon architecture unavailable; keeping the original arena props.', reason)))(error);
  });
  return { ready, cancel: () => { canceled = true; } };
}
