import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { buildCircleBaseArenaForRefs } from './circleArenaRuntime';
import { disposeCircleResources, disposeCircleObjectResources } from './circleResourceDisposal';
import {
  CIRCLE_ARCHITECTURE_PARTS, buildCircleSceneryForRefs, createCircleArchitectureInstances,
  createCircleArchitectureSourceCache, createCircleSubdeck, createCircleFallback,
  getCircleArchitecturePlacements, syncCircleSceneryRadius,
} from './circleArchitecture';

const sizes = [[1.2, 9, 1.2], [7, .5, .9], [1.8, 1.2, 1.2], [4, 3, 2.4], [3.5, 24, 3.5]];
const sourceKit = () => {
  const source = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture }); material.name = 'circle_alloy';
  for (const [index, name] of CIRCLE_ARCHITECTURE_PARTS.entries()) {
    const part = new THREE.Group(); part.name = name;
    const [x, y, z] = sizes[index];
    part.add(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();
const positionOf = (matrix: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(matrix);

/** A separating radial plane proves triangles cannot cut across the collision circle. */
const assertClearPerimeter = (group: THREE.Group, radius: number) => {
  for (const mesh of group.children as THREE.InstancedMesh[]) {
    const positions = mesh.geometry.getAttribute('position');
    for (let index = 0; index < mesh.count; index++) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
      const normal = positionOf(matrix); normal.y = 0; normal.normalize();
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const position = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
        const separation = position.dot(normal);
        assert.ok(separation >= radius + .3 - 1e-5, `${mesh.userData.circlePart} enters the playable circle: ${separation} / ${radius}`);
      }
    }
  }
};

test('Circle source cache coalesces quality requests and retries synchronous and asynchronous errors', async () => {
  for (const synchronous of [true, false]) {
    let calls = 0, fail = true;
    const source = sourceKit();
    const load = createCircleArchitectureSourceCache(() => {
      calls++;
      if (fail) {
        if (synchronous) throw new Error('offline');
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(source);
    });
    const pending = load('high'); assert.equal(pending, load('high'));
    await assert.rejects(pending, /offline/); fail = false;
    assert.equal(await load('high'), source); assert.equal(await load('high'), source);
    assert.equal(await load('low'), source); assert.equal(calls, 3);
  }
});

test('Circle keeps the exact legacy floor and respects explicit lighting intensities', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  for (const tier of ['high', 'balanced', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const customObjects = refs.customMapObjects;
    const quality = getEnvironmentQualityProfile(tier);
    buildCircleBaseArenaForRefs({ refs, adminSettings: { ambientLightIntensity: 0, directLightIntensity: .27 }, quality });
    const floor = refs.scene.getObjectByName('circle_floor') as THREE.Mesh<THREE.CylinderGeometry>;
    assert.ok(floor);
    const { radiusTop, radiusBottom, height, radialSegments } = floor.geometry.parameters;
    assert.deepEqual([radiusTop, radiusBottom, height, radialSegments], [20, 20, .2, 64]);
    assert.deepEqual(floor.position.toArray(), [0, -.1, 0]); assert.deepEqual(floor.scale.toArray(), [1, 1, 1]);
    assert.equal(floor.receiveShadow, true);
    assert.equal(refs.ambientLight!.intensity, 0); assert.equal(refs.dirLight!.intensity, .27);
    assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
    assert.equal(refs.scene.userData.environmentQuality, quality);
    assert.equal(refs.customMapObjects, customObjects); assert.deepEqual(refs.customMapObjects, []);
    const positions = floor.geometry.getAttribute('position'), uvs = floor.geometry.getAttribute('uv');
    const normals = floor.geometry.getAttribute('normal');
    for (let index = 0; index < positions.count; index++) {
      if (normals.getY(index) > .9) {
        assert.ok(Math.abs(uvs.getX(index) - positions.getX(index) / 6) < 1e-6);
        assert.ok(Math.abs(uvs.getY(index) + positions.getZ(index) / 6) < 1e-6, 'top faces project negative Z into texture V');
      }
    }
    disposeCircleResources(refs.scene);
  }
});

test('Halo chords and full module envelopes stay outside every legacy roster radius', () => {
  for (const detail of ['high', 'low'] as const) {
    assert.deepEqual(Object.values(getCircleArchitecturePlacements(20, detail)).map(value => value.length), [8, 16, 8, 4, detail === 'high' ? 8 : 4]);
    for (const radius of [20, 22.5, 25, 27.5, 30]) {
      const placements = getCircleArchitecturePlacements(radius, detail);
      for (const matrix of placements['ring-beam']) {
        const center = positionOf(matrix);
        assert.equal(center.y, 9);
        assert.ok(Math.abs(Math.hypot(center.x, center.z) - (radius + 4) * Math.cos(Math.PI / 16)) < 1e-7);
        const scale = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        assert.ok(Math.abs(scale.x * 7 - 2 * (radius + 4) * Math.sin(Math.PI / 16)) < 1e-7);
        assert.ok(Math.abs(scale.y - 1) < 1e-7 && Math.abs(scale.z - 1) < 1e-7);
      }
      for (const part of ['perimeter-pylon', 'projector-node', 'service-pod', 'backdrop-spire'] as const) {
        for (const matrix of placements[part]) {
          const scale = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
          assert.ok(scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-7, `${part} preserves authored dimensions`);
        }
      }
      const instances = createCircleArchitectureInstances(sourceKit(), radius, detail);
      assertClearPerimeter(instances, radius); disposeCircleObjectResources([instances]);
    }
  }
});

test('Fallback retains a complete external perimeter while the subdeck and markings cannot change floor scaling', () => {
  for (const detail of ['high', 'low'] as const) {
    const fallback = createCircleFallback(30, detail, cloneMaterial);
    assert.ok(fallback.children.length <= 12);
    assertClearPerimeter(fallback, 30);
    const deck = createCircleSubdeck(30); deck.updateMatrixWorld(true);
    assert.equal(deck.children.length, 2);
    const backing = deck.getObjectByName('circle_subdeck_backing')!;
    assert.ok(new THREE.Box3().setFromObject(backing).max.y < -.2);
    const paint = deck.getObjectByName('circle_edge_markings') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    assert.equal(paint.material.emissiveIntensity, 1); assert.equal(paint.material.emissive.getHex(), 0);
    assert.equal(paint.material.transparent, false);
    deck.traverse(object => {
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.CylinderGeometry) {
        assert.notEqual(object.geometry.parameters.radialSegments, 64, 'only the gameplay floor may match the roster resize selector');
      }
    });
    disposeCircleObjectResources([fallback, deck]);
  }
});

test('Scene instances own GPU handles and cannot dispose immutable kits or another match', () => {
  const source = sourceKit();
  const first = createCircleArchitectureInstances(source, 20, 'high', cloneMaterial);
  const second = createCircleArchitectureInstances(source, 20, 'high');
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
  disposeCircleObjectResources([first]); assert.equal(sharedDisposed, 0);
});

test('Radius changes made before and during download reach the fallback and kit without moving actors', async t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  buildCircleBaseArenaForRefs({ refs, adminSettings: {} });
  const actor = new THREE.Mesh(); actor.position.set(7, 0, -8); refs.scene.add(actor);
  syncCircleSceneryRadius(refs.scene, 22.5);
  let resolve!: (source: THREE.Group) => void;
  const pending = new Promise<THREE.Group>(yes => { resolve = yes; });
  const handle = buildCircleSceneryForRefs({ refs, quality: getEnvironmentQualityProfile('high'), load: () => pending, materialFactory: cloneMaterial })!;
  const check = (radius: number, name: string) => {
    const actual = refs.scene!.getObjectByName(name)!;
    assert.ok(actual);
    const placements = getCircleArchitecturePlacements(radius, 'high');
    actual.traverse(child => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      const part = child.userData.circlePart as typeof CIRCLE_ARCHITECTURE_PARTS[number];
      for (const [index, expected] of placements[part].entries()) {
        const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix);
        assert.ok(matrix.elements.every((value, i) => Math.abs(value - expected.elements[i]) < 3e-6));
      }
    });
    assert.equal(refs.scene!.getObjectByName('circle_subdeck')!.scale.x, radius / 20);
  };
  check(22.5, 'circle_fallback_architecture');
  syncCircleSceneryRadius(refs.scene, 27.5); check(27.5, 'circle_fallback_architecture');
  resolve(sourceKit()); await handle.ready;
  assert.equal(refs.scene.getObjectByName('circle_fallback_architecture'), undefined);
  assert.equal(refs.scene.getObjectByName('circle_scenery')!.userData.architectureStatus, 'ready');
  check(27.5, 'circle_blender_architecture');
  syncCircleSceneryRadius(refs.scene, 20); check(20, 'circle_blender_architecture');
  assert.deepEqual(actor.position.toArray(), [7, 0, -8]); assert.deepEqual(actor.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(refs.scene.getObjectByName('circle_floor')!.scale.toArray(), [1, 1, 1], 'only the existing roster function resizes the gameplay floor');
  disposeCircleResources(refs.scene);
});

test('Failed, canceled and detached requests retain the fallback and never attach late assets', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let failures = 0;
    const handle = buildCircleSceneryForRefs({ refs, quality: getEnvironmentQualityProfile('low'), load: () => pending,
      materialFactory: cloneMaterial, onError: () => failures++ })!;
    const shell = refs.scene.getObjectByName('circle_scenery')!;
    assert.ok(shell.getObjectByName('circle_fallback_architecture')); assert.ok(shell.getObjectByName('circle_subdeck'));
    syncCircleSceneryRadius(refs.scene, 30);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') shell.removeFromParent();
    if (outcome === 'failed') reject(new Error('offline'));
    else resolve(outcome === 'invalid' ? new THREE.Group() : sourceKit());
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(shell.getObjectByName('circle_blender_architecture'), undefined);
    assertClearPerimeter(shell.getObjectByName('circle_fallback_architecture') as THREE.Group, 30);
    assert.equal(failures, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'detached') assert.equal(shell.userData.architectureStatus, 'fallback');
    disposeCircleObjectResources([shell]);
  }
  const foreign = new THREE.Scene(); const hangar = new THREE.Group(); hangar.name = 'hangar_scenery'; foreign.add(hangar);
  syncCircleSceneryRadius(foreign, 30); assert.deepEqual(foreign.userData, {}); assert.deepEqual(hangar.scale.toArray(), [1, 1, 1]);
});

test('Scene disposal settles a pending architecture gate and rejects late cached assets without destroying them', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  let resolve!: (source: THREE.Group) => void;
  const pending = new Promise<THREE.Group>(yes => { resolve = yes; });
  const source = sourceKit();
  const cachedMesh = source.children[0].children[0] as THREE.Mesh;
  let cacheDisposed = 0;
  cachedMesh.geometry.addEventListener('dispose', () => cacheDisposed++);
  const handle = buildCircleSceneryForRefs({ refs, quality: getEnvironmentQualityProfile('low'), load: () => pending, materialFactory: cloneMaterial })!;
  const scenery = refs.scene.getObjectByName('circle_scenery')!;
  let ready = false; void handle.ready.then(() => { ready = true; });
  disposeCircleResources(refs.scene);
  await Promise.resolve();
  assert.equal(ready, true, 'cleanup must release the mount gate immediately');
  assert.equal(scenery.parent, null);
  resolve(source); await new Promise<void>(done => setImmediate(done));
  assert.equal(scenery.getObjectByName('circle_blender_architecture'), undefined);
  assert.equal(cacheDisposed, 0);
  handle.cancel(); disposeCircleResources(refs.scene);
});

test('Shipping kits preserve original envelopes and keep complete geometry clear at every roster size', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/circle/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of CIRCLE_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < .01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < .01, `${part} centered`);
    }
    for (const radius of [20, 22.5, 25, 27.5, 30]) {
      const instances = createCircleArchitectureInstances(source, radius, detail);
      assertClearPerimeter(instances, radius);
      if (radius === 20) {
        let triangles = 0, draws = 0;
        for (const child of instances.children) {
          assert.ok(child instanceof THREE.InstancedMesh);
          triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
          draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
        }
        assert.ok(draws + 2 <= 28, `${detail}: kit and subdeck require ${draws + 2} draws`);
        assert.ok(triangles < 240_000, `${detail}: ${triangles} triangle budget`);
        reports.push({ detail, triangles, draws });
      }
      disposeCircleObjectResources([instances]);
    }
  }
  assert.ok(reports[1].triangles < reports[0].triangles * .5, 'Low materially reduces repeated geometry');
});
