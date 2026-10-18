import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeHangarResources, disposeHangarObjectResources } from './hangarResourceDisposal';
import {
  HANGAR_ARCHITECTURE_PARTS, buildHangarSceneryForRefs, createHangarArchitectureInstances,
  createHangarArchitectureSourceCache, createHangarCeiling, createHangarFallback,
  getHangarArchitecturePlacements, syncHangarSceneryRadius,
} from './hangarArchitecture';

const sizes = [[10.68, 12, 0.55], [1.5, 12, 1.5], [50, 1.5, 0.5], [4, 0.5, 1.2]];
const sourceKit = () => {
  const source = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture }); material.name = 'hangar_alloy';
  for (const [index, name] of HANGAR_ARCHITECTURE_PARTS.entries()) {
    const part = new THREE.Group(); part.name = name;
    const [x, y, z] = sizes[index];
    part.add(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();
const positionOf = (matrix: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(matrix);

test('Hangar source cache coalesces quality requests and retries synchronous and asynchronous errors', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createHangarArchitectureSourceCache(() => { calls++; if (fail) throw new Error('offline'); return Promise.resolve(source); });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
});

test('Hangar shell preserves original perimeter centers and leaves the playfield and vertical sightlines clear', () => {
  const original = getHangarArchitecturePlacements(20);
  assert.deepEqual(Object.values(original).map(placements => placements.length), [12, 12, 6, 6]);
  for (const radius of [20, 22.5, 27.5, 30]) {
    const scale = radius / 20;
    const placements = getHangarArchitecturePlacements(radius);
    for (const [index, matrix] of placements['wall-bay'].entries()) {
      const center = positionOf(matrix);
      assert.ok(Math.abs(Math.hypot(center.x, center.z) - 20.6 * scale) < 1e-7);
      assert.equal(center.y, 6);
      const expected = new THREE.Object3D(); expected.position.copy(center); expected.lookAt(0, 6, 0);
      const rotation = new THREE.Quaternion(), size = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), rotation, size);
      assert.ok(rotation.angleTo(expected.quaternion) < 1e-7, `wall ${index} faces center`);
      assert.ok(size.distanceTo(new THREE.Vector3(scale, 1, scale)) < 1e-7);
    }
    for (const matrix of placements['support-column']) {
      const center = positionOf(matrix); const size = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size);
      assert.ok(Math.abs(Math.hypot(center.x, center.z) - 20.3 * scale) < 1e-7);
      assert.equal(center.y, 6); assert.ok(size.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-7, 'columns retain their dimensions');
    }
    for (const part of ['ceiling-truss', 'high-bay-light'] as const) {
      const index = HANGAR_ARCHITECTURE_PARTS.indexOf(part); const dimensions = new THREE.Vector3().fromArray(sizes[index]);
      for (const matrix of placements[part]) {
        const box = new THREE.Box3(dimensions.clone().multiplyScalar(-0.5), dimensions.clone().multiplyScalar(0.5)).applyMatrix4(matrix);
        assert.ok(box.min.y >= 10.25 - 1e-7, `${part} must not intrude below legacy trusses`);
      }
    }
  }
});

test('Fallback and ceiling are complete, cheap and entirely away from the floor', () => {
  const fallback = createHangarFallback(20, cloneMaterial);
  assert.equal(fallback.children.length, 8);
  for (const mesh of fallback.children as THREE.InstancedMesh[]) {
    assert.ok(mesh instanceof THREE.InstancedMesh);
    assert.ok(HANGAR_ARCHITECTURE_PARTS.includes(mesh.userData.hangarPart));
  }
  const ceiling = createHangarCeiling(20, cloneMaterial);
  assert.equal(ceiling.children.length, 3);
  assert.ok(new THREE.Box3().setFromObject(ceiling).min.y >= 12 - 1e-6);
  ceiling.traverse(object => { if (object instanceof THREE.Mesh) assert.equal(object.castShadow, false, 'roof cannot black out the fixture key'); });
  disposeHangarObjectResources([fallback, ceiling]);
});

test('Mounted instances own GPU handles and cannot dispose cached kit or another match', () => {
  const source = sourceKit();
  const first = createHangarArchitectureInstances(source, 20, 'high');
  const second = createHangarArchitectureInstances(source, 20, 'high');
  const cachedMesh = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const firstMesh = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const secondMesh = second.children[0] as typeof firstMesh;
  assert.notEqual(firstMesh.geometry, cachedMesh.geometry); assert.notEqual(firstMesh.geometry, secondMesh.geometry);
  assert.notEqual(firstMesh.material, secondMesh.material); assert.notEqual(firstMesh.material.map, cachedMesh.material.map);
  assert.notEqual(firstMesh.material.map, secondMesh.material.map); assert.equal(firstMesh.material.map, firstMesh.material.roughnessMap);
  assert.equal(firstMesh.material.userData.preserveEmissiveIntensity, true);
  let sharedDisposed = 0;
  for (const resource of [cachedMesh.geometry, cachedMesh.material, cachedMesh.material.map!, secondMesh.geometry, secondMesh.material, secondMesh.material.map!]) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => sharedDisposed++);
  }
  disposeHangarObjectResources([first]); assert.equal(sharedDisposed, 0);
});

test('The existing radius control updates fallback and the eventual kit without affecting actors', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const actor = new THREE.Mesh(); actor.position.set(7, 0, -8); refs.scene.add(actor);
  let resolve!: (source: THREE.Group) => void;
  const pending = new Promise<THREE.Group>(yes => { resolve = yes; });
  const handle = buildHangarSceneryForRefs({ refs, quality: getEnvironmentQualityProfile('high'), load: () => pending, materialFactory: cloneMaterial })!;
  const check = (radius: number, name: string) => {
    const actual = refs.scene!.getObjectByName(name)!;
    const placements = getHangarArchitecturePlacements(radius);
    actual.traverse(child => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      const part = child.userData.hangarPart as typeof HANGAR_ARCHITECTURE_PARTS[number];
      for (const [index, expected] of placements[part].entries()) {
        const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix);
        assert.ok(matrix.elements.every((value, i) => Math.abs(value - expected.elements[i]) < 2e-6));
      }
    });
    assert.equal(refs.scene!.getObjectByName('hangar_ceiling')!.scale.x, radius / 20);
  };
  syncHangarSceneryRadius(refs.scene, 27.5); check(27.5, 'hangar_fallback_architecture');
  resolve(sourceKit()); await handle.ready;
  assert.equal(refs.scene.getObjectByName('hangar_fallback_architecture'), undefined);
  assert.equal(refs.scene.getObjectByName('hangar_scenery')!.userData.architectureStatus, 'ready');
  check(27.5, 'hangar_blender_architecture');
  syncHangarSceneryRadius(refs.scene, 20); check(20, 'hangar_blender_architecture');
  assert.deepEqual(actor.position.toArray(), [7, 0, -8]); assert.deepEqual(actor.scale.toArray(), [1, 1, 1]);
  disposeHangarResources(refs.scene);
});

test('Failed, canceled and detached kit loads retain a complete shell and never attach late assets', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let failures = 0;
    const handle = buildHangarSceneryForRefs({ refs, quality: getEnvironmentQualityProfile('low'), load: () => pending,
      materialFactory: cloneMaterial, onError: () => failures++ })!;
    const shell = refs.scene.getObjectByName('hangar_scenery')!;
    assert.ok(shell.getObjectByName('hangar_fallback_architecture')); assert.ok(shell.getObjectByName('hangar_ceiling'));
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') shell.removeFromParent();
    if (outcome === 'failed') reject(new Error('offline'));
    else resolve(outcome === 'invalid' ? new THREE.Group() : sourceKit());
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(shell.getObjectByName('hangar_blender_architecture'), undefined);
    assert.ok(shell.getObjectByName('hangar_fallback_architecture'));
    assert.equal(failures, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'detached') assert.equal(shell.userData.architectureStatus, 'fallback');
    disposeHangarObjectResources([shell]);
  }
});

test('Shipping Blender kits retain the authored envelopes and fit architecture budgets in both quality tiers', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/hangar/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of HANGAR_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < 0.01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, `${part} centered`);
    }
    const instances = createHangarArchitectureInstances(source, 20, detail);
    let triangles = 0, draws = 0;
    for (const child of instances.children) {
      assert.ok(child instanceof THREE.InstancedMesh);
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
      draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
    }
    assert.ok(draws + 3 <= 25, `${detail}: kit and roof require ${draws + 3} draws`);
    assert.ok(triangles < 180_000, `${detail}: ${triangles} triangle budget`);
    reports.push({ detail, triangles, draws }); disposeHangarObjectResources([instances]);
  }
  assert.ok(reports[1].triangles < reports[0].triangles * 0.5, 'Low must materially reduce geometry');
});
