import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { CustomMapData } from '../../types';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createNeonArchitectureMaterial } from './neonMaterials';
import { disposeNeonObjectResources, registerNeonResourceCleanup } from './neonResourceDisposal';

export const NEON_ARCHITECTURE_ASSETS = {
  high: 'assets/neon/architecture/kit-v1.glb', low: 'assets/neon/architecture/kit-low-v1.glb',
} as const;
export const NEON_ARCHITECTURE_PARTS = ['beacon-column', 'goal-buffer', 'city-tower', 'neon-palm'] as const;
export type NeonArchitecturePart = typeof NEON_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
type Accent = 'blue' | 'red' | 'amber' | 'none';
export interface NeonPlacement { matrix: THREE.Matrix4; objectId?: string; accent: Accent }
export interface NeonArchitectureHandle { ready: Promise<void>; cancel: () => void }

const PART_BY_ID: Readonly<Record<string, 'beacon-column' | 'goal-buffer'>> = {
  neon_pillar_nw: 'beacon-column', neon_pillar_sw: 'beacon-column',
  neon_pillar_ne: 'beacon-column', neon_pillar_se: 'beacon-column',
  neon_pillar_cn: 'beacon-column', neon_pillar_cs: 'beacon-column',
  grid_barrier_w: 'goal-buffer', grid_barrier_e: 'goal-buffer',
};
export const NEON_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<NeonArchitecturePart, THREE.Vector3> = {
  'beacon-column': new THREE.Vector3(1.5, 8, 1.5), 'goal-buffer': new THREE.Vector3(1.2, 2, 4),
  'city-tower': new THREE.Vector3(12, 38, 12), 'neon-palm': new THREE.Vector3(8, 12, 8),
};

/** Immutable source kits are shared between matches; failed downloads can retry. */
export function createNeonArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
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
const loadSource = createNeonArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${NEON_ARCHITECTURE_ASSETS[detail]}`);
  for (const part of NEON_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(part)) throw new Error(`Neon architecture is missing ${part}`);
  }
  return scene;
});

/** Read the active map, including its existing Grifball conversion, without changing it. */
export function getNeonArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail): Record<NeonArchitecturePart, NeonPlacement[]> {
  const placements: Record<NeonArchitecturePart, NeonPlacement[]> = {
    'beacon-column': [], 'goal-buffer': [], 'city-tower': [], 'neon-palm': [],
  };
  for (const object of map.objects) {
    const part = PART_BY_ID[object.id];
    if (!part) continue;
    const accent: Accent = object.id.endsWith('_nw') || object.id.endsWith('_sw') || object.id === 'grid_barrier_w' ? 'blue'
      : object.id.endsWith('_ne') || object.id.endsWith('_se') || object.id === 'grid_barrier_e' ? 'red' : 'amber';
    placements[part].push({ objectId: object.id, accent, matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(object.position.x, object.position.y, object.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z)),
      new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z).divide(PART_SIZE[part]),
    ) });
  }
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  // Distinct height groups give the skyline a readable silhouette. Conservative
  // rotated bounds keep every building outside the whole authored floor.
  const citySites = [
    [-.95, -1, true], [-.3, -1, true], [.42, -1, true], [1.12, -1, true],
    [-1.12, 1, true], [-.4, 1, true], [.32, 1, true], [.98, 1, true],
    [-.65, -1, false], [.68, -1, false], [-.66, 1, false], [.62, 1, false],
  ] as const;
  const selectedCity = detail === 'high' ? citySites.map((_, i) => i) : [0, 2, 5, 7, 8, 11];
  for (const index of selectedCity) {
    const [along, side, alongX] = citySites[index];
    const width = .78 + .18 * (index % 4), height = .72 + .17 * ((index * 3) % 5);
    const reach = Math.hypot(6, 6) * width;
    const offset = (alongX ? half.z : half.x) + reach + 13 + (index % 3) * 5;
    const x = alongX ? along * (half.x + 10) : side * offset;
    const z = alongX ? side * offset : along * (half.z + 10);
    placements['city-tower'].push({ accent: 'none', matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(x, 19 * height - 12, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (index % 3 - 1) * .16),
      new THREE.Vector3(width, height, width),
    ) });
  }
  const palmSites = [-.83, -.27, .27, .83];
  for (const side of [-1, 1]) {
    for (const index of detail === 'high' ? [0, 1, 2, 3] : [0, 3]) {
      const scale = index % 2 ? .88 : 1;
      const reach = Math.hypot(4, 4) * scale;
      placements['neon-palm'].push({ accent: 'none', matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(palmSites[index] * half.x, 6 * scale - 1.1, side * (half.z + reach + 4.2)),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.7 + side * .36),
        new THREE.Vector3(scale, scale, scale),
      ) });
    }
  }
  return placements;
}

/** Only light-strip material batches split by team; armor keeps its neutral coating. */
export function createNeonArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory,
): THREE.Group {
  const roots = NEON_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root || !root.getObjectsByProperty('isMesh', true).length) throw new Error(`Neon architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'neon_blender_architecture'; group.userData.detail = detail;
  const placements = getNeonArchitecturePlacements(map, detail);
  const materials = new Map<THREE.Material, Map<Accent, THREE.Material>>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const allocatedMaterials = new Set<THREE.Material>();
  const ownMaterial = (sourceMaterial: THREE.Material, accent: Accent) => {
    let variants = materials.get(sourceMaterial);
    if (!variants) { variants = new Map(); materials.set(sourceMaterial, variants); }
    const existing = variants.get(accent);
    if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied && supplied !== sourceMaterial ? supplied : sourceMaterial.clone();
    allocatedMaterials.add(material);
    const sourceTextures = new Set(Object.values(sourceMaterial).filter(value => value instanceof THREE.Texture));
    for (const [slot, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture) || !sourceTextures.has(value)) continue;
      let texture = textures.get(value);
      if (!texture) { texture = value.clone(); textures.set(value, texture); }
      (material as unknown as Record<string, unknown>)[slot] = texture;
    }
    if (accent !== 'none' && sourceMaterial.name === 'neon_accent' && material instanceof THREE.MeshStandardMaterial) {
      const color = accent === 'blue' ? '#43b9e3' : accent === 'red' ? '#e56576' : '#e1b57c';
      material.color.set(color); material.emissive.set(color); material.emissiveIntensity = .55;
    }
    material.userData.preserveEmissiveIntensity = true;
    variants.set(accent, material);
    return material;
  };
  try {
    source.updateMatrixWorld(true);
    for (const [index, part] of NEON_ARCHITECTURE_PARTS.entries()) {
      if (!placements[part].length) continue;
      const root = roots[index], inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        if (!geometry.getAttribute('uv')) applyStadiumWorldUVs(geometry, 3);
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const hasAccent = sourceMaterials.some(material => material.name === 'neon_accent');
        const accents: readonly Accent[] = hasAccent ? ['blue', 'red', 'amber', 'none'] : ['none'];
        for (const accent of accents) {
          const batch = placements[part].filter(placement => !hasAccent || placement.accent === accent);
          if (!batch.length) continue;
          const assigned = sourceMaterials.map(material => ownMaterial(material, material.name === 'neon_accent' ? accent : 'none'));
          const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], batch.length);
          mesh.name = `neon_kit_${part}_${child.name}_${accent}`;
          mesh.userData.architecturePart = part; mesh.userData.accent = accent;
          mesh.userData.objectIds = batch.flatMap(placement => placement.objectId ? [placement.objectId] : []);
          mesh.castShadow = part === 'beacon-column' || part === 'goal-buffer'; mesh.receiveShadow = true;
          batch.forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix));
          mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
        }
      });
    }
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...allocatedMaterials]));
    disposeNeonObjectResources([group, ...holders]);
    throw error;
  }
}

/** Three opaque batches add structural depth below the unchanged floor. */
export function createNeonPerimeter(map: CustomMapData, materialFactory?: MaterialFactory, detail: ArchitectureDetail = 'high'): THREE.Group {
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const group = new THREE.Group(); group.name = 'neon_subdeck';
  const parts: Record<string, THREE.BufferGeometry[]> = { neon_graphite: [], neon_ceramic: [], neon_alloy: [] };
  const box = (role: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.translate(x, y, z); parts[role].push(geometry);
  };
  for (const side of [-1, 1]) {
    box('neon_graphite', 0, -1.3, side * (half.z - .55), half.x * 2, 2.3, 1.1);
    box('neon_graphite', side * (half.x - .55), -1.3, 0, 1.1, 2.3, half.z * 2 - 2.2);
    for (const alongX of [true, false]) {
      const length = (alongX ? half.x : half.z) * 2, edge = (alongX ? half.z : half.x) + .13;
      const count = Math.max(1, Math.ceil(length / 5.5)), width = length / count;
      for (let index = 0; index < count; index++) {
        const along = -length / 2 + width * (index + .5);
        box('neon_ceramic', alongX ? along : side * edge, -.51, alongX ? side * edge : along,
          alongX ? width - .08 : .26, .72, alongX ? .26 : width - .08);
        box('neon_alloy', alongX ? along - width / 2 : side * (edge + .01), -1.12, alongX ? side * (edge + .01) : along - width / 2,
          alongX ? .12 : .3, 1.86, alongX ? .3 : .12);
      }
    }
  }
  // Palm bases sit outside the court on solid cantilevers tied into its underside.
  // Each tier builds supports only for its visible palms; none reach the play surface.
  for (const palm of getNeonArchitecturePlacements(map, detail)['neon-palm']) {
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    palm.matrix.decompose(position, rotation, scale);
    const side = Math.sign(position.z), inset = side * (half.z - .8);
    const end = position.z + side * .65 * scale.z;
    const length = Math.abs(end - inset), centerZ = (end + inset) / 2;
    const plinthWidth = 1.65 * scale.x;
    box('neon_graphite', position.x, -1.845, centerZ, 1.12 * scale.x, .85, length);
    box('neon_ceramic', position.x, -1.26, position.z, plinthWidth, .32, plinthWidth);
    box('neon_alloy', position.x, -1.39, centerZ, .94 * scale.x, .06, length - .12);
  }
  try {
    for (const [role, pieces] of Object.entries(parts)) {
      const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose()); parts[role] = [];
      if (!geometry) continue;
      applyStadiumWorldUVs(geometry, 3);
      const source = new THREE.MeshStandardMaterial({ color: role === 'neon_ceramic' ? '#77838c' : '#3b4651', metalness: .5, roughness: .7 });
      source.name = role;
      let material: THREE.Material;
      try { material = materialFactory?.(source) ?? source.clone(); }
      catch (error) { geometry.dispose(); source.dispose(); throw error; }
      if (material !== source) source.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `neon_perimeter_${role}`;
      mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  } catch (error) {
    Object.values(parts).flat().forEach(geometry => geometry.dispose()); disposeNeonObjectResources([group]); throw error;
  }
}

export function buildNeonSceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createNeonArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): NeonArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'synthwave_grid_arena' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'neon_scenery'; group.userData.architectureStatus = 'loading';
  group.userData.halfExtents = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
  group.userData.detail = quality.architectureDetail;
  group.add(createNeonPerimeter(activeCustomMap, materialFactory, quality.architectureDetail)); scene.add(group);
  (refs.customMapObjects ??= []).push(group);
  const previousVisibility = new Map<THREE.Object3D, boolean>();
  let canceled = false, settled = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = () => { settled = true; resolve(); }; });
  const stop = () => {
    canceled = true;
    for (const [object, visible] of previousVisibility) object.visible = visible;
    previousVisibility.clear(); group.userData.architectureStatus = 'fallback';
    if (!settled) finish();
  };
  registerNeonResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    group.add(createNeonArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory));
    scene.traverse(object => {
      const id = object.userData.neonLegacyId;
      if (typeof id === 'string' && PART_BY_ID[id] && activeCustomMap.objects.some(item => item.id === id)) {
        previousVisibility.set(object, object.visible); object.visible = false;
      }
    });
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Neon architecture unavailable; keeping the original arena props.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    stop(); const architecture = group.getObjectByName('neon_blender_architecture');
    if (architecture) disposeNeonObjectResources([architecture]);
  } };
}
