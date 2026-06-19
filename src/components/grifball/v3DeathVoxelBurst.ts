import * as THREE from 'three';
import type { V3CharacterSlotId, V3QualityTier } from '../v3/v3ModelTypes';
import { normalizeV3QualityTier } from '../v3/v3QualityTiers';

export type V3DeathVoxelBurstQualityTier = V3QualityTier;

export interface V3DeathVoxelBurstOptions {
  qualityTier?: V3DeathVoxelBurstQualityTier;
  duration?: number;
  seed?: number;
  speed?: number;
}

export interface V3DeathVoxelBurstFragmentPlan {
  id: string;
  sourceSlot?: V3CharacterSlotId | string;
  sourceName?: string;
  role?: string;
  colorHex: number;
  start: [number, number, number];
  size: [number, number, number];
  velocity: [number, number, number];
  angularVelocity: [number, number, number];
}

export interface V3DeathVoxelBurstPlan {
  ready: boolean;
  reason?: string;
  qualityTier: V3DeathVoxelBurstQualityTier;
  maxFragments: number;
  duration: number;
  fragments: V3DeathVoxelBurstFragmentPlan[];
}

export interface V3DeathVoxelBurstInstance {
  readonly mesh: THREE.InstancedMesh;
  readonly plan: V3DeathVoxelBurstPlan;
  elapsed: number;
  disposed: boolean;
}

const FRAGMENT_CAPS: Record<V3DeathVoxelBurstQualityTier, number> = {
  mobileLow: 48,
  mobile: 96,
  desktop: 160,
  ultra: 240,
};

interface FragmentSource {
  key: string;
  sourceSlot?: V3CharacterSlotId | string;
  sourceName?: string;
  role?: string;
  colorHex: number;
  box: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number): number {
  let value = seed >>> 0;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isObject3D(value: unknown): value is THREE.Object3D {
  return value instanceof THREE.Object3D;
}

function getV3PartGroups(model: THREE.Object3D): Record<string, THREE.Object3D> | null {
  if (model.userData.modelSystem !== 'v3') return null;
  const partGroups = model.userData.v3PartGroups;
  if (!partGroups || typeof partGroups !== 'object') return null;

  const entries = Object.entries(partGroups)
    .filter(([, group]) => isObject3D(group)) as Array<[string, THREE.Object3D]>;
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function isVisibleThroughModel(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function geometryWorldBox(mesh: THREE.Mesh): THREE.Box3 | null {
  const geometry = mesh.geometry;
  if (!geometry.getAttribute('position')) return null;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  if (!geometry.boundingBox) return null;

  const box = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  return box.isEmpty() ? null : box;
}

function materialColorHex(material: THREE.Material | THREE.Material[]): number | null {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    const color = (entry as THREE.Material & { color?: THREE.Color }).color;
    if (color instanceof THREE.Color) {
      return color.getHex();
    }
  }
  return null;
}

function geometryColorHex(mesh: THREE.Mesh): number | null {
  const colorAttribute = mesh.geometry.getAttribute('color');
  if (!colorAttribute || colorAttribute.count <= 0) return null;
  return new THREE.Color(
    colorAttribute.getX(0),
    colorAttribute.getY(0),
    colorAttribute.getZ(0)
  ).getHex();
}

function inferRole(mesh: THREE.Mesh, group: THREE.Object3D): string | undefined {
  const explicitRole = mesh.userData.v3PaintRole ?? group.userData.v3PaintRole;
  if (typeof explicitRole === 'string' && explicitRole.length > 0) return explicitRole;

  const materialKey = mesh.userData.v3MaterialKey;
  if (typeof materialKey === 'string' && materialKey.length > 0) return 'material';

  const slot = group.userData.v3Slot;
  return typeof slot === 'string' && slot.length > 0 ? slot : undefined;
}

function collectFragmentSources(model: THREE.Object3D, partGroups: Record<string, THREE.Object3D>): FragmentSource[] {
  model.updateWorldMatrix(true, true);
  const sources: FragmentSource[] = [];

  for (const [slot, group] of Object.entries(partGroups).sort(([left], [right]) => left.localeCompare(right))) {
    if (!isVisibleThroughModel(group, model)) continue;

    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !isVisibleThroughModel(object, model)) return;

      object.updateWorldMatrix(true, false);
      const box = geometryWorldBox(object);
      if (!box) return;

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const colorHex = materialColorHex(object.material) ?? geometryColorHex(object) ?? 0xffffff;
      const sourceSlot = typeof group.userData.v3Slot === 'string' ? group.userData.v3Slot : slot;
      const sourceName = group.name || object.name || sourceSlot;
      sources.push({
        key: `${slot}:${object.uuid}:${sources.length}`,
        sourceSlot,
        sourceName,
        role: inferRole(object, group),
        colorHex,
        box,
        center,
        size,
      });
    });
  }

  sources.sort((left, right) => {
    const slotCompare = String(left.sourceSlot ?? '').localeCompare(String(right.sourceSlot ?? ''));
    if (slotCompare !== 0) return slotCompare;
    const xCompare = left.center.x - right.center.x;
    if (Math.abs(xCompare) > 1e-6) return xCompare;
    const yCompare = left.center.y - right.center.y;
    if (Math.abs(yCompare) > 1e-6) return yCompare;
    return left.center.z - right.center.z;
  });
  return sources;
}

function fragmentStart(source: FragmentSource, seed: number): THREE.Vector3 {
  const rx = seededUnit(seed);
  const ry = seededUnit(seed ^ 0x9e3779b9);
  const rz = seededUnit(seed ^ 0x85ebca6b);
  return new THREE.Vector3(
    source.box.min.x + source.size.x * rx,
    source.box.min.y + source.size.y * ry,
    source.box.min.z + source.size.z * rz
  );
}

function tupleFromVector(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function fragmentSize(source: FragmentSource, seed: number): [number, number, number] {
  const shortest = Math.max(0.025, Math.min(source.size.x, source.size.y, source.size.z));
  const base = Math.max(0.035, Math.min(0.12, shortest * 0.65));
  const stretch = 0.75 + seededUnit(seed ^ 0xc2b2ae35) * 0.55;
  return [
    base * stretch,
    base * (0.85 + seededUnit(seed ^ 0x27d4eb2f) * 0.45),
    base * (0.8 + seededUnit(seed ^ 0x165667b1) * 0.5),
  ];
}

function fragmentVelocity(
  start: THREE.Vector3,
  modelCenter: THREE.Vector3,
  seed: number,
  speed: number
): [number, number, number] {
  const direction = start.clone().sub(modelCenter);
  if (direction.lengthSq() < 1e-6) {
    direction.set(
      seededUnit(seed) - 0.5,
      seededUnit(seed ^ 0x9e3779b9) + 0.35,
      seededUnit(seed ^ 0x85ebca6b) - 0.5
    );
  }
  direction.normalize();
  direction.x += (seededUnit(seed ^ 0x632be59b) - 0.5) * 0.35;
  direction.y += seededUnit(seed ^ 0x85157af5) * 0.42 + 0.18;
  direction.z += (seededUnit(seed ^ 0x58f38ded) - 0.5) * 0.35;
  direction.normalize().multiplyScalar(speed * (0.72 + seededUnit(seed ^ 0x94d049bb) * 0.55));
  return tupleFromVector(direction);
}

function fragmentAngularVelocity(seed: number): [number, number, number] {
  return [
    (seededUnit(seed ^ 0x2c1b3c6d) - 0.5) * 7,
    (seededUnit(seed ^ 0x297a2d39) - 0.5) * 7,
    (seededUnit(seed ^ 0x3c6ef372) - 0.5) * 7,
  ];
}

export function buildV3DeathVoxelBurstPlan(
  model: THREE.Object3D,
  options: V3DeathVoxelBurstOptions = {}
): V3DeathVoxelBurstPlan {
  const qualityTier = normalizeV3QualityTier(options.qualityTier);
  const maxFragments = FRAGMENT_CAPS[qualityTier];
  const duration = finitePositive(options.duration, 0.72);
  const partGroups = getV3PartGroups(model);
  const emptyBase = {
    ready: false,
    qualityTier,
    maxFragments,
    duration,
    fragments: [],
  } satisfies Omit<V3DeathVoxelBurstPlan, 'reason'>;

  if (!partGroups) {
    return { ...emptyBase, reason: 'not-v3' };
  }

  const sources = collectFragmentSources(model, partGroups);
  if (sources.length === 0) {
    return { ...emptyBase, reason: 'empty-v3-parts' };
  }

  const modelBox = new THREE.Box3();
  for (const source of sources) {
    modelBox.union(source.box);
  }
  const modelCenter = modelBox.getCenter(new THREE.Vector3());
  const baseSeed = Number.isFinite(options.seed) ? Math.trunc(options.seed ?? 0) : 0;
  const speed = finitePositive(options.speed, 3.2);
  const targetCount = Math.min(maxFragments, Math.max(1, sources.length === 1 ? 1 : maxFragments));
  const fragments: V3DeathVoxelBurstFragmentPlan[] = [];

  for (let index = 0; index < targetCount; index++) {
    const source = sources[index % sources.length];
    const seed = stableHash(`${baseSeed}:${source.key}:${index}:${source.colorHex}`);
    const start = fragmentStart(source, seed);
    fragments.push({
      id: `${source.sourceSlot ?? 'part'}:${index}`,
      sourceSlot: source.sourceSlot,
      sourceName: source.sourceName,
      role: source.role,
      colorHex: source.colorHex,
      start: tupleFromVector(start),
      size: fragmentSize(source, seed),
      velocity: fragmentVelocity(start, modelCenter, seed, speed),
      angularVelocity: fragmentAngularVelocity(seed),
    });
  }

  return {
    ready: true,
    qualityTier,
    maxFragments,
    duration,
    fragments,
  };
}

export function createV3DeathVoxelBurst(
  scene: THREE.Scene,
  model: THREE.Object3D,
  options: V3DeathVoxelBurstOptions = {}
): V3DeathVoxelBurstInstance | null {
  const plan = buildV3DeathVoxelBurstPlan(model, options);
  if (!plan.ready || plan.fragments.length === 0) return null;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    vertexColors: true,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, plan.fragments.length);
  mesh.name = 'v3DeathVoxelBurst';
  mesh.frustumCulled = false;

  const instance: V3DeathVoxelBurstInstance = {
    mesh,
    plan,
    elapsed: 0,
    disposed: false,
  };

  for (let index = 0; index < plan.fragments.length; index++) {
    const fragment = plan.fragments[index];
    mesh.setColorAt(index, new THREE.Color(fragment.colorHex));
  }
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  updateV3DeathVoxelBurst(instance, 0);
  scene.add(mesh);
  return instance;
}

export function updateV3DeathVoxelBurst(instance: V3DeathVoxelBurstInstance, dt: number): boolean {
  if (instance.disposed) return false;

  const duration = finitePositive(instance.plan.duration, 0.72);
  const delta = typeof dt === 'number' && Number.isFinite(dt) ? Math.max(0, dt) : 0;
  instance.elapsed = Math.min(duration, instance.elapsed + delta);
  const progress = Math.min(1, instance.elapsed / duration);
  const travel = progress + progress * progress * 0.35;

  for (let index = 0; index < instance.plan.fragments.length; index++) {
    const fragment = instance.plan.fragments[index];
    scratchPosition.set(
      fragment.start[0] + fragment.velocity[0] * travel,
      fragment.start[1] + fragment.velocity[1] * travel,
      fragment.start[2] + fragment.velocity[2] * travel
    );
    scratchEuler.set(
      fragment.angularVelocity[0] * instance.elapsed,
      fragment.angularVelocity[1] * instance.elapsed,
      fragment.angularVelocity[2] * instance.elapsed
    );
    scratchQuaternion.setFromEuler(scratchEuler);
    scratchScale.set(fragment.size[0], fragment.size[1], fragment.size[2]);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    instance.mesh.setMatrixAt(index, scratchMatrix);
  }

  instance.mesh.instanceMatrix.needsUpdate = true;
  const materials = Array.isArray(instance.mesh.material) ? instance.mesh.material : [instance.mesh.material];
  for (const material of materials) {
    if (material.transparent && 'opacity' in material && typeof material.opacity === 'number') {
      material.opacity = Math.max(0, 1 - progress);
      material.needsUpdate = true;
    }
  }

  return progress < 1;
}

export function disposeV3DeathVoxelBurst(instance: V3DeathVoxelBurstInstance): void {
  if (instance.disposed) return;
  instance.disposed = true;

  instance.mesh.removeFromParent();
  instance.mesh.geometry.dispose();
  const materials = Array.isArray(instance.mesh.material) ? instance.mesh.material : [instance.mesh.material];
  for (const material of materials) {
    material.dispose();
  }
}
