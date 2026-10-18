import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';

export const STADIUM_ARCHITECTURE_ASSETS = {
  high: 'assets/stadium/architecture/kit-v1.glb',
  low: 'assets/stadium/architecture/kit-low-v1.glb',
} as const;

export const STADIUM_ARCHITECTURE_PARTS = ['barrier-panel', 'support-pylon', 'light-fixture', 'vent-module'] as const;
export type StadiumArchitecturePart = typeof STADIUM_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type ArenaHalf = { x: number; z: number };
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface StadiumArchitectureHandle {
  ready: Promise<void>;
  cancel: () => void;
}

/** At most two source scenes live in this cache. They never enter a rendered scene. */
export function createStadiumArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const sources = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail): Promise<THREE.Group> => {
    const existing = sources.get(detail);
    if (existing) return existing;
    const pending = load(detail).catch(error => {
      if (sources.get(detail) === pending) sources.delete(detail);
      throw error;
    });
    sources.set(detail, pending);
    return pending;
  };
}

const loadSource = createStadiumArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const gltf = await new GLTFLoader().loadAsync(`${base}${STADIUM_ARCHITECTURE_ASSETS[detail]}`);
  for (const part of STADIUM_ARCHITECTURE_PARTS) {
    if (!gltf.scene.getObjectByName(part)) throw new Error(`Stadium architecture is missing ${part}`);
  }
  return gltf.scene;
});

export async function preloadStadiumArchitecture(
  quality: Pick<EnvironmentQualityProfile, 'architectureDetail'> = getEnvironmentQualityProfile(),
): Promise<void> {
  await loadSource(quality.architectureDetail);
}

/** Decoration stays outside the collision perimeter, including both goal mouths. */
export function getStadiumArchitecturePlacements(half: ArenaHalf, detail: ArchitectureDetail) {
  const placements: Record<StadiumArchitecturePart, THREE.Matrix4[]> = {
    'barrier-panel': [], 'support-pylon': [], 'light-fixture': [], 'vent-module': [],
  };
  const place = (part: StadiumArchitecturePart, x: number, y: number, z: number, yaw: number, scaleX = 1) => {
    placements[part].push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(scaleX, 1, 1),
    ));
  };
  const sideCount = Math.max(1, Math.ceil(half.x * 2 / 8));
  const sideWidth = half.x * 2 / sideCount;
  for (const side of [-1, 1]) {
    for (let i = 0; i < sideCount; i++) {
      place('barrier-panel', -half.x + sideWidth * (i + 0.5), 0, side * (half.z + 1.4), side < 0 ? 0 : Math.PI, sideWidth / 8);
    }
    // The open center behind each goal reads as a player tunnel, never a solid wall.
    const endLength = Math.max(0, half.z - 6);
    const endCount = Math.ceil(endLength / 8);
    const endWidth = endCount ? endLength / endCount : 0;
    for (const end of [-1, 1]) {
      for (let i = 0; i < endCount; i++) {
        place('barrier-panel', side * (half.x + 1.4), 0, end * (6 + endWidth * (i + 0.5)), -side * Math.PI / 2, endWidth / 8);
      }
    }
    const spans = detail === 'high' ? 5 : 3;
    for (let i = 0; i < spans; i++) {
      const x = (i / (spans - 1) * 2 - 1) * (half.x + 8);
      const z = side * (half.z + 15);
      const yaw = side < 0 ? 0 : Math.PI;
      place('support-pylon', x, 0, z, yaw);
      place('light-fixture', x, 14.2, z - side * 2, yaw);
      place('vent-module', x, 8.5, z - side * 1.4, yaw);
    }
    for (const z of [-half.z * 0.58, half.z * 0.58]) {
      place('support-pylon', side * (half.x + 13), 0, z, -side * Math.PI / 2);
      place('light-fixture', side * (half.x + 11.5), 14.2, z, -side * Math.PI / 2);
    }
  }
  return placements;
}

/** Every geometry, material and texture handle is scene-owned; decoded image sources may be shared. */
export function createStadiumArchitectureInstances(
  source: THREE.Group,
  half: ArenaHalf,
  detail: ArchitectureDetail,
  materialFactory?: MaterialFactory,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stadium_blender_architecture';
  group.userData.detail = detail;
  // Validate before allocating scene resources, so malformed kits fail atomically.
  const roots = STADIUM_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root) throw new Error(`Stadium architecture is missing ${part}`);
    return root;
  });
  const placements = getStadiumArchitecturePlacements(half, detail);
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const ownMaterial = (sourceMaterial: THREE.Material): THREE.Material => {
    const existing = materials.get(sourceMaterial);
    if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied ?? sourceMaterial.clone();
    if (!supplied) {
      for (const [key, value] of Object.entries(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        let texture = textures.get(value);
        if (!texture) {
          texture = value.clone();
          textures.set(value, texture);
        }
        (material as unknown as Record<string, unknown>)[key] = texture;
      }
    }
    materials.set(sourceMaterial, material);
    return material;
  };
  source.updateMatrixWorld(true);
  for (const [partIndex, part] of STADIUM_ARCHITECTURE_PARTS.entries()) {
    const root = roots[partIndex];
    const rootInverse = root.matrixWorld.clone().invert();
    root.traverse(child => {
      if (!(child instanceof THREE.Mesh) || placements[part].length === 0) return;
      const geometry = child.geometry.clone();
      geometry.applyMatrix4(rootInverse.clone().multiply(child.matrixWorld));
      // Match the 3m material tile on the concourse and runtime details. The kit
      // is authored in metres; packed Blender UVs otherwise make its grain 3x finer.
      applyStadiumWorldUVs(geometry, 3);
      const assigned = Array.isArray(child.material) ? child.material.map(ownMaterial) : ownMaterial(child.material);
      const instances = new THREE.InstancedMesh(geometry, assigned, placements[part].length);
      instances.name = `stadium_kit_${part}_${child.name}`;
      instances.castShadow = part === 'support-pylon';
      instances.receiveShadow = true;
      instances.userData.architecturePart = part;
      placements[part].forEach((matrix, index) => instances.setMatrixAt(index, matrix));
      instances.instanceMatrix.needsUpdate = true;
      instances.computeBoundingBox();
      instances.computeBoundingSphere();
      group.add(instances);
    });
  }
  return group;
}

export function attachStadiumArchitecture(
  parent: THREE.Group,
  half: ArenaHalf,
  quality: Pick<EnvironmentQualityProfile, 'architectureDetail'>,
  options: {
    load?: (detail: ArchitectureDetail) => Promise<THREE.Group>;
    materialFactory?: MaterialFactory;
    onError?: (error: unknown) => void;
  } = {},
): StadiumArchitectureHandle {
  let canceled = false;
  parent.userData.architectureStatus = 'loading';
  const ready = (options.load ?? loadSource)(quality.architectureDetail).then(source => {
    if (canceled || !parent.parent) return;
    parent.add(createStadiumArchitectureInstances(source, half, quality.architectureDetail, options.materialFactory));
    parent.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || !parent.parent) return;
    parent.userData.architectureStatus = 'fallback';
    (options.onError ?? (error => console.warn('Stadium architecture unavailable; keeping the arena scenery.', error)))(error);
  });
  return {
    ready,
    cancel: () => { canceled = true; },
  };
}
