import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeRainyObjectResources, disposeRainyResources } from './rainyResourceDisposal';
import {
  RAINY_ARCHITECTURE_PARTS, RAINY_REPLACED_OBJECT_IDS, buildRainySceneryForRefs,
  createRainyArchitectureInstances, createRainyArchitectureSourceCache, createRainyPerimeter, getRainyArchitecturePlacements,
} from './rainyArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'rainy_industrial_streets')!;
const sizes = [[1.2, 2, 4], [2, 2, 2], [14, 36, 12], [3, 10, 2], [12, 8, 1.6], [8, 12, 8]];
const remoteParts = ['building-block', 'streetlight', 'billboard-frame', 'street-palm'] as const;
const sourceKit = () => {
  const source = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: '#88949d', map: texture, roughnessMap: texture }); material.name = 'rainy_alloy';
  for (const name of RAINY_ARCHITECTURE_PARTS) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();

test('Rainy source cache coalesces quality requests and retries failed downloads', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createRainyArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
  disposeRainyObjectResources([source]);
});

test('Rainy preserves all four collider transforms and the existing Grifball conversion', () => {
  const before = JSON.stringify(map);
  assert.equal(map.arenaRadius, 20); assert.equal(map.mapShape, 'rectangular');
  assert.deepEqual(map.objects.map(object => [object.id, object.type,
    [object.position.x, object.position.y, object.position.z],
    [object.scale.x, object.scale.y, object.scale.z], [object.rotation.x, object.rotation.y, object.rotation.z], object.isCollidable]), [
    ['rainy_barrier_w', 'box', [-17,1,0], [1.2,2,4], [0,0,0], true],
    ['rainy_barrier_e', 'box', [17,1,0], [1.2,2,4], [0,0,0], true],
    ['rainy_crate_nw', 'box', [-6,1,-5], [2,2,2], [0,.4,0], true],
    ['rainy_crate_se', 'box', [6,1,5], [2,2,2], [0,-.3,0], true],
  ]);
  for (const active of [map, toGrifballArena(map)]) {
    const activeBefore = JSON.stringify(active), placements = getRainyArchitecturePlacements(active, 'high');
    const found = Object.entries(placements).flatMap(([part, items]) => items.filter(item => item.objectId).map(item => ({ part, ...item })));
    const originals = active.objects.filter(object => RAINY_REPLACED_OBJECT_IDS.includes(object.id));
    assert.equal(found.length, originals.length);
    for (const object of originals) {
      const placement = found.find(item => item.objectId === object.id)!; assert.ok(placement, object.id);
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      placement.matrix.decompose(position, rotation, scale);
      assert.ok(position.distanceTo(new THREE.Vector3(object.position.x, object.position.y, object.position.z)) < 1e-7);
      const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z));
      assert.ok(rotation.angleTo(expected) < 1e-7);
      const index = RAINY_ARCHITECTURE_PARTS.indexOf(placement.part as typeof RAINY_ARCHITECTURE_PARTS[number]);
      assert.ok(new THREE.Vector3().fromArray(sizes[index]).multiply(scale)
        .distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-7);
    }
    assert.equal(JSON.stringify(active), activeBefore);
  }
  assert.deepEqual(getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents), { x: 24, z: 12 });
  assert.deepEqual(toGrifballArena(map).arenaHalfExtents, { x: 52, z: 23 });
  assert.deepEqual(toGrifballArena(map).objects.filter(object => object.isCollidable).map(object => object.id), RAINY_REPLACED_OBJECT_IDS);
  assert.equal(JSON.stringify(map), before);
});

test('Background stays outside both floors; supported scenery never introduces surface geometry', () => {
  for (const active of [map, toGrifballArena(map)]) {
    const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
    const protectedBounds = new THREE.Box3(new THREE.Vector3(-half.x - 3, -200, -half.z - 3), new THREE.Vector3(half.x + 3, 200, half.z + 3));
    for (const detail of ['high', 'low'] as const) {
      const placements = getRainyArchitecturePlacements(active, detail);
      assert.equal(placements['building-block'].length, detail === 'high' ? 12 : 6);
      assert.equal(placements['street-palm'].length, detail === 'high' ? 6 : 4);
      assert.equal(placements['streetlight'].length, detail === 'high' ? 6 : 4);
      assert.equal(placements['billboard-frame'].length, 1);
      for (const part of remoteParts) {
        const size = new THREE.Vector3().fromArray(sizes[RAINY_ARCHITECTURE_PARTS.indexOf(part)]).multiplyScalar(.5);
        for (const item of placements[part]) {
          const bounds = new THREE.Box3(size.clone().negate(), size.clone()).applyMatrix4(item.matrix);
          assert.equal(bounds.intersectsBox(protectedBounds), false, `${part} full bounds`);
        }
      }
      const perimeter = createRainyPerimeter(active, cloneMaterial, detail);
      assert.equal(perimeter.children.length, 3); perimeter.updateMatrixWorld(true);
      perimeter.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        assert.equal(object.castShadow, false);
        const position = object.geometry.getAttribute('position');
        for (let index = 0; index < position.count; index++) {
          const p = new THREE.Vector3().fromBufferAttribute(position, index);
          assert.ok(p.y <= -.149 || Math.abs(p.x) > half.x + 3 || Math.abs(p.z) > half.z + 3,
            'only billboard supports rise above the underside, far outside the map');
        }
      });
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0));
      for (const part of ['street-palm','streetlight'] as const) {
        for (const placement of placements[part]) {
          const p = new THREE.Vector3().setFromMatrixPosition(placement.matrix); ray.ray.origin.set(p.x,0,p.z);
          const hit = ray.intersectObject(perimeter,true)[0];
          assert.ok(hit && Math.abs(hit.point.y + 1.1) < 1e-6, `${part} base touches its plinth`);
        }
      }
      const board = new THREE.Vector3().setFromMatrixPosition(placements['billboard-frame'][0].matrix);
      for (const side of [-1,1]) {
        ray.ray.origin.set(board.x + side * 4.35, board.y, board.z);
        const hit = ray.intersectObject(perimeter,true)[0]; assert.ok(hit && Math.abs(hit.point.y - 10) < 1e-6, 'posts meet billboard bottom');
      }
      const ground = new THREE.Raycaster(new THREE.Vector3(0,0,0), new THREE.Vector3(0,-1,0)).intersectObject(perimeter,true)[0];
      assert.ok(ground && Math.abs(ground.point.y + .2) < 1e-6, 'structural base meets underside of floor');
      disposeRainyObjectResources([perimeter]);
    }
  }
});

test('Instances own geometry and texture handles without mutating source kits or screen UVs', () => {
  for (const factory of [undefined, cloneMaterial, (material: THREE.Material) => material]) {
    const source = sourceKit(), original = JSON.stringify(source.toJSON());
    const first = createRainyArchitectureInstances(source, map, 'high', factory);
    const second = createRainyArchitectureInstances(source, map, 'high', factory);
    const cached = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const a = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const b = second.children[0] as typeof a;
    assert.equal(first.children.length, 6); assert.equal(a.count, 2);
    assert.notEqual(a.geometry, cached.geometry); assert.notEqual(a.geometry, b.geometry);
    assert.notEqual(a.material, cached.material); assert.notEqual(a.material, b.material);
    assert.notEqual(a.material.map, cached.material.map); assert.notEqual(a.material.map, b.material.map);
    assert.equal(a.material.map, a.material.roughnessMap); assert.equal(a.material.userData.preserveEmissiveIntensity, true);
    assert.deepEqual(a.geometry.getAttribute('uv').array, cached.geometry.getAttribute('uv').array);
    assert.equal(JSON.stringify(source.toJSON()), original);
    let sharedDisposed = 0;
    for (const resource of [cached.geometry, cached.material, cached.material.map!, b.geometry, b.material, b.material.map!]) {
      const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
      dispatcher.addEventListener('dispose', () => sharedDisposed++);
    }
    disposeRainyObjectResources([first]); assert.equal(sharedDisposed, 0);
    disposeRainyObjectResources([second, source]);
  }
});

test('Kit attachment hides only tagged props; cancellation preserves fallback and independently animated rain', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const legacy = RAINY_REPLACED_OBJECT_IDS.map((id, index) => {
    const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.rainyLegacyId = id;
    mesh.visible = index !== 0; refs.scene!.add(mesh); refs.customMapObjects!.push(mesh); return mesh;
  });
  const actor = new THREE.Mesh(); actor.name = 'iron_vanguard'; refs.scene.add(actor);
  const source = sourceKit();
  const handle = buildRainySceneryForRefs({ refs, activeCustomMap: map, load: async () => source, materialFactory: cloneMaterial })!;
  await handle.ready;
  assert.ok(legacy.every(mesh => !mesh.visible)); assert.equal(actor.visible, true);
  assert.ok(refs.scene.getObjectByName('rainy_blender_architecture'));
  assert.equal(refs.customMapObjects!.length, 5, 'one scenery root registered');
  handle.cancel(); handle.cancel();
  assert.ok(legacy.every((mesh, index) => mesh.visible === (index !== 0)));
  assert.equal(refs.scene.getObjectByName('rainy_blender_architecture'), undefined);
  assert.ok(refs.scene.getObjectByName('rainy_subdeck')); assert.ok(refs.scene.getObjectByName('rainy_weather'));
  for (const mesh of legacy) assert.equal(refs.scene.getObjectByName(mesh.name), mesh);
  disposeRainyResources(refs.scene); assert.deepEqual(refs.scene.children, [actor]);
  disposeRainyObjectResources([source]);
});

test('Missing, malformed, canceled, detached or disposed pending kits keep fallback and never attach late', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached', 'disposed'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = new THREE.Mesh(); legacy.userData.rainyLegacyId = 'rainy_barrier_w'; refs.scene.add(legacy);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let errors = 0;
    const handle = buildRainySceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => errors++ })!;
    const group = refs.scene.getObjectByName('rainy_scenery')!;
    assert.ok(group.getObjectByName('rainy_subdeck')); assert.equal(legacy.visible, true);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') group.removeFromParent();
    if (outcome === 'disposed') { disposeRainyResources(refs.scene); await handle.ready; }
    const source = outcome === 'invalid' ? new THREE.Group() : sourceKit();
    if (outcome === 'failed') reject(new Error('offline')); else resolve(source);
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(group.getObjectByName('rainy_blender_architecture'), undefined);
    assert.equal(legacy.visible, true); assert.equal(errors, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'disposed') disposeRainyObjectResources([group]);
    disposeRainyObjectResources([source]);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildRainySceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_rainy_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'theme matching alone does not affect user maps');
});

test('Shipping Blender kits fit collision envelopes, preserve single-image screens and meet draw budgets', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/rainy/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of RAINY_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const bounds = new THREE.Box3().setFromObject(root);
      assert.ok(bounds.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < .01, part);
      assert.ok(bounds.getCenter(new THREE.Vector3()).length() < .01, `${part} centered`);
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const material = child.material as THREE.Material;
        if (material.name !== 'rainy_screen') return;
        const uv = child.geometry.getAttribute('uv'); assert.ok(uv, 'billboard has authored UVs');
        for (let index = 0; index < uv.count; index++) {
          assert.ok(uv.getX(index) >= 0 && uv.getX(index) <= 1 && uv.getY(index) >= 0 && uv.getY(index) <= 1,
            'single image UV range, including optimized interleaved attributes');
        }
      });
    }
    for (const active of [map,toGrifballArena(map)]) {
      const instances = createRainyArchitectureInstances(source, active, detail);
      const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
      let triangles = 0, draws = 0;
      for (const child of instances.children) {
        assert.ok(child instanceof THREE.InstancedMesh);
        triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
        draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          assert.equal(material.transparent, false); assert.equal(material.opacity, 1);
        }
        if (remoteParts.includes(child.userData.architecturePart)) {
          assert.equal(child.castShadow, false, 'background adds no shadow passes');
          const position = child.geometry.getAttribute('position'), matrix = new THREE.Matrix4();
          for (let instance = 0; instance < child.count; instance++) {
            child.getMatrixAt(instance, matrix);
            for (let index = 0; index < position.count; index++) {
              const vertex = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(matrix);
              assert.ok(Math.abs(vertex.x) > half.x + 3 || Math.abs(vertex.z) > half.z + 3, 'actual remote vertices outside entire floor');
            }
          }
        }
      }
      assert.ok(draws + 4 < 35, `${detail}: ${draws + 4} draws including foundation/rain`);
      assert.ok(triangles < (detail === 'high' ? 220_000 : 65_000), `${detail}: ${triangles} triangles`);
      if (active === map) reports.push({ detail, triangles, draws });
      disposeRainyObjectResources([instances]);
    }
    disposeRainyObjectResources([source]);
  }
  assert.ok(reports[1].triangles < reports[0].triangles * .5, 'Low materially reduces geometry');
});
