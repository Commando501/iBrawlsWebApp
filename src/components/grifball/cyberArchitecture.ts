import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CustomMapData } from '../../types';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createCyberArchitectureMaterial } from './cyberMaterials';
import { disposeCyberObjectResources, registerCyberResourceCleanup } from './cyberResourceDisposal';

export const CYBER_ARCHITECTURE_ASSETS = {
  high: 'assets/cyber/architecture/kit-v1.glb', low: 'assets/cyber/architecture/kit-low-v1.glb',
} as const;
export const CYBER_ARCHITECTURE_PARTS = ['tech-column', 'tactical-cover', 'recharge-crate', 'reactor-core', 'relay-fin'] as const;
export type CyberArchitecturePart = typeof CYBER_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface CyberPlacement { matrix: THREE.Matrix4; objectId?: string }
export interface CyberArchitectureHandle { ready: Promise<void>; cancel: () => void }

const PART_BY_ID: Readonly<Record<string, Exclude<CyberArchitecturePart, 'relay-fin'>>> = {
  obj_pillar_nw: 'tech-column', obj_pillar_ne: 'tech-column', obj_pillar_sw: 'tech-column', obj_pillar_se: 'tech-column',
  obj_barrier_north: 'tactical-cover', obj_barrier_south: 'tactical-cover',
  obj_crate_w: 'recharge-crate', obj_crate_e: 'recharge-crate', obj_central_core: 'reactor-core',
};
export const CYBER_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<CyberArchitecturePart, THREE.Vector3> = {
  'tech-column': new THREE.Vector3(1.8, 6, 1.8), 'tactical-cover': new THREE.Vector3(4, 2.5, 0.8),
  'recharge-crate': new THREE.Vector3(1.6, 1.6, 1.6), 'reactor-core': new THREE.Vector3(3.5, 3.5, 3.5),
  'relay-fin': new THREE.Vector3(4, 14, 3),
};
const mapByScenery = new WeakMap<THREE.Object3D, CustomMapData>();

/** Two immutable quality sources are shared across matches; failed downloads may retry. */
export function createCyberArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const cache = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail): Promise<THREE.Group> => {
    const previous = cache.get(detail);
    if (previous) return previous;
    const pending = Promise.resolve().then(() => load(detail)).catch(error => {
      if (cache.get(detail) === pending) cache.delete(detail);
      throw error;
    });
    cache.set(detail, pending);
    return pending;
  };
}

const loadSource = createCyberArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${CYBER_ARCHITECTURE_ASSETS[detail]}`);
  for (const name of CYBER_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(name)) throw new Error(`Cyber architecture is missing ${name}`);
  }
  return scene;
});

/** Visuals follow actual mode-converted map data; no collision or movement data is changed. */
export function getCyberArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail, perimeterRadius = map.arenaRadius): Record<CyberArchitecturePart, CyberPlacement[]> {
  const placements: Record<CyberArchitecturePart, CyberPlacement[]> = {
    'tech-column': [], 'tactical-cover': [], 'recharge-crate': [], 'reactor-core': [], 'relay-fin': [],
  };
  for (const object of map.objects) {
    const part = PART_BY_ID[object.id];
    if (!part) continue;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(object.position.x, object.position.y, object.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z)),
      new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z).divide(PART_SIZE[part]),
    );
    placements[part].push({ matrix, objectId: object.id });
  }
  const half = map.mapShape === 'rectangular' ? getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents)
    : { x: perimeterRadius, z: perimeterRadius };
  const count = detail === 'high' ? 8 : 6;
  // Every complete rotated fin stays outside the enclosing rectangle, which
  // also encloses the circular sandbox. No horizon geometry touches combat.
  const radius = Math.hypot(half.x, half.z) + 13;
  for (let index = 0; index < count; index++) {
    const angle = Math.PI * 2 * index / count + Math.PI / count;
    placements['relay-fin'].push({ matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(angle) * radius, 4, Math.sin(angle) * radius),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle - Math.PI / 2),
      new THREE.Vector3(1, index % 2 ? 1.1 : 1, 1),
    ) });
  }
  return placements;
}

/** Existing player-count floor scaling moves decoration only, never authored cover or collision objects. */
export function syncCyberSceneryRadius(scene: THREE.Scene, arenaRadius: number): void {
  const group = scene.getObjectByName('cyber_scenery');
  const map = group && mapByScenery.get(group);
  if (!group || !map || map.mapShape === 'rectangular' || !Number.isFinite(arenaRadius) || arenaRadius <= 0) return;
  if (group.userData.arenaRadius === arenaRadius) return;
  group.userData.arenaRadius = arenaRadius;
  const perimeter = group.getObjectByName('cyber_subdeck');
  if (perimeter) perimeter.scale.set(arenaRadius / map.arenaRadius, 1, arenaRadius / map.arenaRadius);
  const detail: ArchitectureDetail = group.userData.detail === 'low' ? 'low' : 'high';
  const placements = getCyberArchitecturePlacements(map, detail, arenaRadius)['relay-fin'];
  group.traverse(child => {
    if (!(child instanceof THREE.InstancedMesh) || child.userData.architecturePart !== 'relay-fin') return;
    placements.forEach((placement, index) => child.setMatrixAt(index, placement.matrix));
    child.instanceMatrix.needsUpdate = true; child.computeBoundingBox(); child.computeBoundingSphere();
  });
}

/** One instanced draw per authored material batch; every GPU handle is scene-owned. */
export function createCyberArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory, perimeterRadius = map.arenaRadius,
): THREE.Group {
  const roots = CYBER_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root || !root.getObjectsByProperty('isMesh', true).length) throw new Error(`Cyber architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'cyber_blender_architecture'; group.userData.detail = detail;
  const placements = getCyberArchitecturePlacements(map, detail, perimeterRadius);
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ownMaterial = (sourceMaterial: THREE.Material) => {
    const existing = materials.get(sourceMaterial);
    if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied && supplied !== sourceMaterial ? supplied : sourceMaterial.clone();
    const sourceTextures = new Set(Object.values(sourceMaterial).filter(value => value instanceof THREE.Texture));
    for (const [slot, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture) || !sourceTextures.has(value)) continue;
      let texture = textures.get(value);
      if (!texture) { texture = value.clone(); textures.set(value, texture); }
      (material as unknown as Record<string, unknown>)[slot] = texture;
    }
    material.userData.preserveEmissiveIntensity = true;
    materials.set(sourceMaterial, material);
    return material;
  };
  try {
    source.updateMatrixWorld(true);
    for (const [index, part] of CYBER_ARCHITECTURE_PARTS.entries()) {
      if (!placements[part].length) continue;
      const root = roots[index];
      const inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        applyStadiumWorldUVs(geometry, 3);
        const assigned = (Array.isArray(child.material) ? child.material : [child.material]).map(ownMaterial);
        const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], placements[part].length);
        mesh.name = `cyber_kit_${part}_${child.name}`;
        mesh.userData.architecturePart = part;
        mesh.userData.objectIds = placements[part].flatMap(placement => placement.objectId ? [placement.objectId] : []);
        mesh.castShadow = part !== 'relay-fin'; mesh.receiveShadow = true;
        placements[part].forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        group.add(mesh);
      });
    }
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...materials.values()]));
    disposeCyberObjectResources([group, ...holders]);
    throw error;
  }
}

/** A three-draw suspended-deck edge, entirely beneath the existing playable surface. */
export function createCyberPerimeter(map: CustomMapData, materialFactory?: MaterialFactory): THREE.Group {
  const group = new THREE.Group(); group.name = 'cyber_subdeck';
  const parts: Record<string, THREE.BufferGeometry[]> = { cyber_graphite: [], cyber_ceramic: [], cyber_trim: [] };
  const box = (role: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.rotateY(yaw); geometry.translate(x, y, z); parts[role].push(geometry);
  };
  if (map.mapShape === 'rectangular') {
    const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
    for (const side of [-1, 1]) for (const alongX of [true, false]) {
      const length = (alongX ? half.x : half.z) * 2;
      const edge = alongX ? half.z : half.x;
      const yaw = alongX ? 0 : Math.PI / 2;
      box('cyber_graphite', alongX ? 0 : side * (edge - 0.3), -1.1, alongX ? side * (edge - 0.3) : 0, length, 1.8, 0.8, yaw);
      const count = Math.ceil(length / 5);
      for (let index = 0; index < count; index++) {
        const along = -length / 2 + (index + 0.5) * length / count;
        box('cyber_ceramic', alongX ? along : side * (edge + 0.1), -0.65, alongX ? side * (edge + 0.1) : along,
          length / count - 0.07, 0.9, 0.22, yaw);
      }
      box('cyber_trim', alongX ? 0 : side * (edge + 0.13), -0.16, alongX ? side * (edge + 0.13) : 0, length, 0.1, 0.24, yaw);
    }
  } else {
    const count = 48, radius = map.arenaRadius;
    for (let index = 0; index < count; index++) {
      const angle = (index + 0.5) * Math.PI * 2 / count;
      const yaw = Math.PI / 2 - angle;
      const x = Math.cos(angle), z = Math.sin(angle), width = 2 * radius * Math.tan(Math.PI / count);
      box('cyber_graphite', x * (radius - 0.3), -1.1, z * (radius - 0.3), width + 0.03, 1.8, 0.8, yaw);
      box('cyber_ceramic', x * (radius + 0.1), -0.65, z * (radius + 0.1), width - 0.045, 0.9, 0.22, yaw);
      box('cyber_trim', x * (radius + 0.13), -0.16, z * (radius + 0.13), width + 0.02, 0.1, 0.24, yaw);
    }
  }
  try {
    for (const [role, pieces] of Object.entries(parts)) {
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose()); parts[role] = [];
      if (!geometry) continue;
      applyStadiumWorldUVs(geometry, 3);
      const source = new THREE.MeshStandardMaterial({ color: role === 'cyber_ceramic' ? '#aab6bb' : '#354451', metalness: 0.5, roughness: 0.7 });
      source.name = role;
      let material: THREE.Material;
      try { material = materialFactory?.(source) ?? source.clone(); }
      catch (error) { geometry.dispose(); source.dispose(); throw error; }
      if (material !== source) source.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `cyber_perimeter_${role}`;
      mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  } catch (error) {
    Object.values(parts).flat().forEach(geometry => geometry.dispose());
    disposeCyberObjectResources([group]);
    throw error;
  }
}

export function buildCyberSceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createCyberArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): CyberArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'cyber_hex_arena' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'cyber_scenery'; group.userData.architectureStatus = 'loading';
  group.userData.arenaRadius = activeCustomMap.arenaRadius; group.userData.detail = quality.architectureDetail;
  mapByScenery.set(group, activeCustomMap);
  group.add(createCyberPerimeter(activeCustomMap, materialFactory)); scene.add(group);
  (refs.customMapObjects ??= []).push(group);
  const previousVisibility = new Map<THREE.Object3D, boolean>();
  let canceled = false, settled = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = () => { settled = true; resolve(); }; });
  const restoreLegacy = () => {
    for (const [object, visible] of previousVisibility) object.visible = visible;
    previousVisibility.clear();
  };
  const stop = () => {
    canceled = true; restoreLegacy();
    group.userData.architectureStatus = 'fallback';
    if (!settled) finish();
  };
  registerCyberResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    const architecture = createCyberArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory, group.userData.arenaRadius);
    group.add(architecture);
    scene.traverse(object => {
      const id = object.userData.cyberLegacyId;
      if (typeof id === 'string' && PART_BY_ID[id] && activeCustomMap.objects.some(item => item.id === id)) {
        previousVisibility.set(object, object.visible); object.visible = false;
      }
    });
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Cyber architecture unavailable; keeping the original arena props.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    stop();
    const architecture = group.getObjectByName('cyber_blender_architecture');
    if (architecture) disposeCyberObjectResources([architecture]);
  } };
}
