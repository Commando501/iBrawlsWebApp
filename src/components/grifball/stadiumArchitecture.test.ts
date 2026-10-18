import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { disposeStadiumResources } from './stadiumResourceDisposal';
import { buildCustomMapStadiumSceneryForRefs } from './customMapStadiumSceneryRuntime';
import { createInitialGrifballThreeRefs } from './threeRefs';
import type { CustomMapData } from '../../types';
import {
  attachStadiumArchitecture, createStadiumArchitectureInstances, createStadiumArchitectureSourceCache,
  getStadiumArchitecturePlacements, STADIUM_ARCHITECTURE_PARTS,
} from './stadiumArchitecture';

function sourceKit() {
  const root = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  for (const name of STADIUM_ARCHITECTURE_PARTS) {
    const group = new THREE.Group();
    group.name = name;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.position.y = 2;
    group.add(mesh);
    root.add(group);
  }
  return root;
}

test('architecture cache coalesces concurrent requests and retries failed loads independently by quality', async () => {
  const kit = sourceKit();
  const requests: string[] = [];
  let fail = true;
  const load = createStadiumArchitectureSourceCache(async detail => {
    requests.push(detail);
    if (detail === 'high' && fail) throw new Error('offline');
    return kit;
  });
  const first = load('high');
  assert.equal(first, load('high'));
  await assert.rejects(first, /offline/);
  fail = false;
  assert.equal(await load('high'), kit);
  assert.equal(await load('high'), kit);
  assert.equal(await load('low'), kit);
  assert.deepEqual(requests, ['high', 'high', 'low']);
});

test('architecture placement keeps the playable court and both goal approaches clear for legacy and resized arenas', () => {
  for (const half of [{ x: 30, z: 20 }, { x: 52, z: 23 }, { x: 61.5, z: 33.08 }]) {
    for (const detail of ['high', 'low'] as const) {
      const placements = getStadiumArchitecturePlacements(half, detail);
      for (const [part, matrices] of Object.entries(placements)) {
        assert.ok(matrices.length > 0);
        for (const matrix of matrices) {
          const position = new THREE.Vector3().setFromMatrixPosition(matrix);
          assert.ok(Math.abs(position.x) > half.x || Math.abs(position.z) > half.z, part);
          if (part === 'barrier-panel' && Math.abs(position.x) > half.x) {
            const width = new THREE.Vector3().setFromMatrixScale(matrix).x * 8;
            assert.ok(Math.abs(position.z) - width / 2 >= 6 - 1e-6, 'leave a 12m goal tunnel opening');
          }
        }
      }
    }
    assert.ok(getStadiumArchitecturePlacements(half, 'low')['support-pylon'].length < getStadiumArchitecturePlacements(half, 'high')['support-pylon'].length);
  }
});

test('repeated architecture is batched with independent geometry, material and texture ownership per scene', () => {
  const source = sourceKit();
  const first = createStadiumArchitectureInstances(source, { x: 52, z: 23 }, 'high');
  const surviving = createStadiumArchitectureInstances(source, { x: 52, z: 23 }, 'high');
  const sourceMesh = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const firstMesh = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const survivingMesh = surviving.children[0] as typeof firstMesh;
  assert.equal(first.children.length, 4, 'one draw per source material/part, independent of repetition count');
  assert.ok(firstMesh.count > 20);
  assert.notEqual(firstMesh.geometry, sourceMesh.geometry);
  assert.notEqual(firstMesh.geometry, survivingMesh.geometry);
  assert.notEqual(firstMesh.material, survivingMesh.material);
  assert.notEqual(firstMesh.material.map, sourceMesh.material.map);
  assert.notEqual(firstMesh.material.map, survivingMesh.material.map);
  assert.equal(firstMesh.material.map, firstMesh.material.roughnessMap, 'texture slots share a single scene-owned handle');
  assert.equal(firstMesh.material.map!.source, sourceMesh.material.map!.source, 'decoded image can be shared safely');
  firstMesh.geometry.computeBoundingBox();
  assert.equal(firstMesh.geometry.boundingBox!.min.y, 1.5, 'nested source transforms are baked into the instance geometry');
  let sourceDisposed = 0;
  let survivorDisposed = 0;
  sourceMesh.geometry.addEventListener('dispose', () => sourceDisposed++);
  sourceMesh.material.addEventListener('dispose', () => sourceDisposed++);
  sourceMesh.material.map!.addEventListener('dispose', () => sourceDisposed++);
  survivingMesh.geometry.addEventListener('dispose', () => survivorDisposed++);
  survivingMesh.material.addEventListener('dispose', () => survivorDisposed++);
  survivingMesh.material.map!.addEventListener('dispose', () => survivorDisposed++);
  const scene = new THREE.Scene();
  const owner = new THREE.Group(); owner.name = 'stadium_scenery'; owner.add(first); scene.add(owner);
  disposeStadiumResources(scene);
  assert.equal(sourceDisposed, 0);
  assert.equal(survivorDisposed, 0);
});

test('late architecture completion is ignored after cancellation or scene disposal', async () => {
  for (const cancel of [true, false]) {
    let resolve!: (group: THREE.Group) => void;
    const pending = new Promise<THREE.Group>(r => { resolve = r; });
    const scene = new THREE.Scene(); const parent = new THREE.Group(); scene.add(parent);
    const handle = attachStadiumArchitecture(parent, { x: 52, z: 23 }, getEnvironmentQualityProfile('high'), { load: () => pending });
    if (cancel) handle.cancel(); else parent.removeFromParent();
    resolve(sourceKit()); await handle.ready;
    assert.equal(parent.children.length, 0);
  }
});

test('architecture failures preserve the existing arena and successful loads use the selected fallback kit', async () => {
  const scene = new THREE.Scene(); const parent = new THREE.Group(); scene.add(parent);
  const fallback = new THREE.Group(); fallback.name = 'existing_scenery'; parent.add(fallback);
  let failures = 0;
  await attachStadiumArchitecture(parent, { x: 52, z: 23 }, getEnvironmentQualityProfile('low'), {
    load: async () => { throw new Error('network failure'); }, onError: () => failures++,
  }).ready;
  assert.equal(failures, 1);
  assert.deepEqual(parent.children, [fallback]);
  assert.equal(parent.userData.architectureStatus, 'fallback');
  let requested = '';
  await attachStadiumArchitecture(parent, { x: 52, z: 23 }, getEnvironmentQualityProfile('low'), {
    load: async detail => { requested = detail; return sourceKit(); },
  }).ready;
  assert.equal(requested, 'low');
  assert.equal(parent.userData.architectureStatus, 'ready');
  assert.equal(parent.children[0], fallback);
  assert.equal(parent.children[1].name, 'stadium_blender_architecture');
});

test('shipping Blender kits build bounded instance batches with matching high and low silhouettes', async () => {
  const reports: Record<string, { triangles: number; batches: number; bounds: THREE.Box3 }> = {};
  for (const detail of ['high', 'low'] as const) {
    const path = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const buffer = await readFile(new URL(`../../../public/assets/stadium/architecture/${path}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')).scene;
    const instances = createStadiumArchitectureInstances(source, { x: 61.5, z: 33.08 }, detail);
    const report = { triangles: 0, batches: instances.children.length, bounds: new THREE.Box3() };
    for (const child of instances.children) {
      assert.ok(child instanceof THREE.InstancedMesh);
      report.triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
      report.bounds.union(child.boundingBox!);
    }
    assert.ok(report.batches <= 16, `the ${detail} kit must remain at most 16 draws for all repetitions`);
    // At the sprint-calibrated 123m x 66.16m court: 241,520 high / 55,176 low.
    assert.ok(report.triangles < 260_000, `${detail} architecture triangle budget`);
    assert.ok(report.bounds.max.y >= 15.99 && report.bounds.max.y <= 16.01, 'authored 16m pylon height must survive instancing');
    assert.ok(report.bounds.min.y >= -0.001, 'bottom pivots stay on the ground');
    reports[detail] = report;
  }
  assert.ok(reports.low.triangles < reports.high.triangles * 0.4, 'the lighter kit must materially reduce rendered geometry');
  assert.ok(reports.low.bounds.min.distanceTo(reports.high.bounds.min) < 0.005);
  assert.ok(reports.low.bounds.max.distanceTo(reports.high.bounds.max) < 0.005);
});

test('scene integration applies one quality snapshot to seats, atmosphere and imported architecture', async t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => ({ scene: sourceKit() }));
  const counts: Record<string, number> = {};
  for (const tier of ['high', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs();
    refs.scene = new THREE.Scene();
    const quality = getEnvironmentQualityProfile(tier);
    const activeCustomMap = { theme: 'grifball_stadium', arenaRadius: 61.5, arenaHalfExtents: { x: 61.5, z: 33.08 } } as CustomMapData;
    const handle = buildCustomMapStadiumSceneryForRefs({ refs, activeCustomMap, quality });
    assert.ok(handle);
    await handle.ready;
    const seats = refs.scene.getObjectByName('stadium_seat_pans') as THREE.InstancedMesh;
    counts[tier] = seats.count;
    const dust = refs.scene.getObjectByName('stadium_dust_particles') as THREE.Points;
    assert.equal(dust.geometry.getAttribute('position').count, quality.dustCount);
    assert.equal(refs.scene.getObjectByName('stadium_blender_architecture')!.userData.detail, quality.architectureDetail);
    const concourse = refs.scene.getObjectByName('stadium_upper_concourse')!;
    assert.ok(concourse.children.length > 0);
    assert.equal(refs.customMapObjects!.length, 1, 'all added scenery shares the existing scene disposal root');
    handle.cancel();
    disposeStadiumResources(refs.scene);
    assert.equal(refs.scene.children.length, 0);
  }
  assert.ok(counts.low <= counts.high / 3, 'the low profile materially reduces seating density');
});
