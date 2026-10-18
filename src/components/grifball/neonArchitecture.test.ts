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
import { disposeNeonObjectResources, disposeNeonResources } from './neonResourceDisposal';
import {
  NEON_ARCHITECTURE_PARTS, NEON_REPLACED_OBJECT_IDS, buildNeonSceneryForRefs,
  createNeonArchitectureInstances, createNeonArchitectureSourceCache, createNeonPerimeter, getNeonArchitecturePlacements,
} from './neonArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'synthwave_grid_arena')!;
const sizes = [[1.5, 8, 1.5], [1.2, 2, 4], [12, 38, 12], [8, 12, 8]];
const sourceKit = (withAccent = false) => {
  const source = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: '#88949d', map: texture, roughnessMap: texture }); material.name = 'neon_alloy';
  const accent = new THREE.MeshStandardMaterial(); accent.name = 'neon_accent';
  for (const name of NEON_ARCHITECTURE_PARTS) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); source.add(part);
    if (withAccent) part.add(new THREE.Mesh(new THREE.BoxGeometry(), accent));
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();

test('Neon source cache coalesces quality requests and retries failed downloads', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createNeonArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
  disposeNeonObjectResources([source]);
});

test('Neon preserves all eight collider transforms and the existing Grifball conversion', () => {
  const before = JSON.stringify(map);
  assert.equal(map.arenaRadius, 20); assert.equal(map.mapShape, 'rectangular');
  assert.deepEqual(map.objects.map(object => [object.id, object.type,
    [object.position.x, object.position.y, object.position.z],
    [object.scale.x, object.scale.y, object.scale.z], [object.rotation.x, object.rotation.y, object.rotation.z], object.isCollidable]), [
    ['neon_pillar_nw', 'cylinder', [-22,4,-11], [1.5,8,1.5], [0,0,0], true],
    ['neon_pillar_sw', 'cylinder', [-22,4,11], [1.5,8,1.5], [0,0,0], true],
    ['neon_pillar_ne', 'cylinder', [22,4,-11], [1.5,8,1.5], [0,0,0], true],
    ['neon_pillar_se', 'cylinder', [22,4,11], [1.5,8,1.5], [0,0,0], true],
    ['neon_pillar_cn', 'cylinder', [0,4,-11], [1.2,8,1.2], [0,0,0], true],
    ['neon_pillar_cs', 'cylinder', [0,4,11], [1.2,8,1.2], [0,0,0], true],
    ['grid_barrier_w', 'box', [-17,1,0], [1.2,2,4], [0,0,0], true],
    ['grid_barrier_e', 'box', [17,1,0], [1.2,2,4], [0,0,0], true],
  ]);
  for (const active of [map, toGrifballArena(map)]) {
    const activeBefore = JSON.stringify(active);
    const placements = getNeonArchitecturePlacements(active, 'high');
    const found = Object.entries(placements).flatMap(([part, items]) => items.filter(item => item.objectId).map(item => ({ part, ...item })));
    const originals = active.objects.filter(object => NEON_REPLACED_OBJECT_IDS.includes(object.id));
    assert.equal(found.length, originals.length);
    for (const object of originals) {
      const placement = found.find(item => item.objectId === object.id)!; assert.ok(placement, object.id);
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      placement.matrix.decompose(position, rotation, scale);
      assert.ok(position.distanceTo(new THREE.Vector3(object.position.x, object.position.y, object.position.z)) < 1e-7);
      const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z));
      assert.ok(rotation.angleTo(expected) < 1e-7);
      const index = NEON_ARCHITECTURE_PARTS.indexOf(placement.part as typeof NEON_ARCHITECTURE_PARTS[number]);
      assert.ok(new THREE.Vector3().fromArray(sizes[index]).multiply(scale)
        .distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-7);
    }
    assert.equal(JSON.stringify(active), activeBefore);
  }
  assert.deepEqual(getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents), { x: 24, z: 12 });
  assert.deepEqual(toGrifballArena(map).arenaHalfExtents, { x: 52, z: 23 });
  assert.deepEqual(toGrifballArena(map).objects.filter(object => object.isCollidable).map(object => object.id),
    ['neon_pillar_cn','neon_pillar_cs','grid_barrier_w','grid_barrier_e']);
  assert.equal(JSON.stringify(map), before);
});

test('City and palms stay outside both full floors and three-batch subdeck never enters the playfield', () => {
  for (const active of [map, toGrifballArena(map)]) {
    const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
    const protectedBounds = new THREE.Box3(new THREE.Vector3(-half.x - 3, -200, -half.z - 3), new THREE.Vector3(half.x + 3, 200, half.z + 3));
    for (const detail of ['high', 'low'] as const) {
      const placements = getNeonArchitecturePlacements(active, detail);
      assert.equal(placements['city-tower'].length, detail === 'high' ? 12 : 6);
      assert.equal(placements['neon-palm'].length, detail === 'high' ? 8 : 4);
      for (const part of ['city-tower', 'neon-palm'] as const) {
        const size = new THREE.Vector3().fromArray(sizes[NEON_ARCHITECTURE_PARTS.indexOf(part)]).multiplyScalar(.5);
        for (const item of placements[part]) {
          const bounds = new THREE.Box3(size.clone().negate(), size.clone()).applyMatrix4(item.matrix);
          assert.equal(bounds.intersectsBox(protectedBounds), false, `${part} conservative full bounds`);
        }
      }
    }
    const triangleCounts: number[] = [];
    for (const detail of ['high','low'] as const) {
      const perimeter = createNeonPerimeter(active, cloneMaterial, detail);
      assert.equal(perimeter.children.length, 3);
      assert.ok(new THREE.Box3().setFromObject(perimeter).max.y <= -.149);
      perimeter.traverse(object => { if (object instanceof THREE.Mesh) assert.equal(object.castShadow, false); });
      perimeter.updateMatrixWorld(true);
      for (const palm of getNeonArchitecturePlacements(active,detail)['neon-palm']) {
        const position = new THREE.Vector3().setFromMatrixPosition(palm.matrix);
        const ray = new THREE.Raycaster(new THREE.Vector3(position.x,0,position.z), new THREE.Vector3(0,-1,0));
        const plinth = ray.intersectObject(perimeter,true)[0];
        assert.ok(plinth,'each palm has a solid plinth directly beneath its base');
        assert.ok(Math.abs(plinth.point.y + 1.1) < 1e-6,'plinth top touches the unchanged palm base');
        for (const fraction of [.2,.5,.8]) {
          const inset = Math.sign(position.z) * (half.z - .8);
          ray.ray.origin.set(position.x,0,inset+(position.z-inset)*fraction);
          const support=ray.intersectObject(perimeter,true)[0];
          assert.ok(support && support.point.y < -.15 && support.point.y > -1.5,'solid arm connects plinth to existing deck foundation');
        }
      }
      triangleCounts.push(perimeter.children.reduce((sum,child)=>{
        const geometry=(child as THREE.Mesh).geometry;
        return sum+(geometry.index?.count??geometry.getAttribute('position').count)/3;
      },0));
      disposeNeonObjectResources([perimeter]);
    }
    assert.equal(triangleCounts[0]-triangleCounts[1],4*36,'Low omits supports for its four omitted palms');
  }
});

test('Instances own geometry and texture handles with cloning and passthrough factories', () => {
  for (const factory of [undefined, cloneMaterial, (material: THREE.Material) => material]) {
    const source = sourceKit();
    const first = createNeonArchitectureInstances(source, map, 'high', factory);
    const second = createNeonArchitectureInstances(source, map, 'high', factory);
    const cached = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const a = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const b = second.children[0] as typeof a;
    assert.equal(first.children.length, 4); assert.equal(a.count, 6);
    assert.notEqual(a.geometry, cached.geometry); assert.notEqual(a.geometry, b.geometry);
    assert.notEqual(a.material, cached.material); assert.notEqual(a.material, b.material);
    assert.notEqual(a.material.map, cached.material.map); assert.notEqual(a.material.map, b.material.map);
    assert.equal(a.material.map, a.material.roughnessMap); assert.equal(a.material.userData.preserveEmissiveIntensity, true);
    let sharedDisposed = 0;
    for (const resource of [cached.geometry, cached.material, cached.material.map!, b.geometry, b.material, b.material.map!]) {
      const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
      dispatcher.addEventListener('dispose', () => sharedDisposed++);
    }
    disposeNeonObjectResources([first]); assert.equal(sharedDisposed, 0);
    disposeNeonObjectResources([second, source]);
  }
});

test('Team tints split only accent batches and preserve neutral armor plus stable low emission', () => {
  const source = sourceKit(true), original = JSON.stringify(source.toJSON());
  const instances = createNeonArchitectureInstances(source, map, 'high', cloneMaterial);
  const armor = instances.children.filter(child => (child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.name === 'neon_alloy');
  assert.equal(armor.length, 4);
  for (const child of armor) {
    const mesh = child as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    assert.equal(mesh.material.color.getHexString(), '88949d'); assert.equal(mesh.material.emissiveIntensity, 1);
    assert.equal(mesh.userData.accent, 'none');
  }
  const accents = instances.children.filter(child => child.userData.architecturePart === 'beacon-column' && child.userData.accent !== 'none');
  assert.deepEqual(accents.map(child => child.userData.accent), ['blue', 'red', 'amber']);
  assert.deepEqual(accents.map(child => (child as THREE.InstancedMesh).count), [2,2,2]);
  assert.deepEqual(accents.map(child => (child as THREE.InstancedMesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>).material.color.getHexString()), ['43b9e3','e56576','e1b57c']);
  for (const child of accents) assert.equal((child as THREE.InstancedMesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>).material.emissiveIntensity,.55);
  assert.equal(JSON.stringify(source.toJSON()), original, 'cached source materials and matrices stay immutable');
  disposeNeonObjectResources([instances, source]);
});

test('Kit attachment hides only tagged props; cancellation restores exact visibility and original lookup', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const legacy = NEON_REPLACED_OBJECT_IDS.map((id, index) => {
    const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.neonLegacyId = id;
    mesh.visible = index !== 0; refs.scene!.add(mesh); refs.customMapObjects!.push(mesh); return mesh;
  });
  const actor = new THREE.Mesh(); actor.name = 'iron_vanguard'; refs.scene.add(actor);
  const handle = buildNeonSceneryForRefs({ refs, activeCustomMap: map, load: async () => sourceKit(), materialFactory: cloneMaterial })!;
  await handle.ready;
  assert.ok(legacy.every(mesh => !mesh.visible)); assert.equal(actor.visible, true);
  assert.ok(refs.scene.getObjectByName('neon_blender_architecture'));
  handle.cancel(); handle.cancel();
  assert.ok(legacy.every((mesh, index) => mesh.visible === (index !== 0)));
  assert.equal(refs.scene.getObjectByName('neon_blender_architecture'), undefined);
  assert.ok(refs.scene.getObjectByName('neon_subdeck'));
  for (const mesh of legacy) {
    assert.equal(refs.scene.getObjectByName(mesh.name), mesh); assert.ok(refs.customMapObjects!.includes(mesh));
  }
  disposeNeonResources(refs.scene); assert.equal(refs.scene.children[0], actor);
});

test('Missing, malformed, canceled, detached or disposed pending kits keep fallback and never attach late', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached', 'disposed'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = new THREE.Mesh(); legacy.userData.neonLegacyId = 'neon_pillar_nw'; refs.scene.add(legacy);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let errors = 0;
    const handle = buildNeonSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => errors++ })!;
    const group = refs.scene.getObjectByName('neon_scenery')!;
    assert.ok(group.getObjectByName('neon_subdeck')); assert.equal(legacy.visible, true);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') group.removeFromParent();
    if (outcome === 'disposed') { disposeNeonResources(refs.scene); await handle.ready; }
    if (outcome === 'failed') reject(new Error('offline')); else resolve(outcome === 'invalid' ? new THREE.Group() : sourceKit());
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(group.getObjectByName('neon_blender_architecture'), undefined);
    assert.equal(legacy.visible, true); assert.equal(errors, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'disposed') disposeNeonObjectResources([group]);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildNeonSceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_synthwave_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'theme matching alone must not alter user maps');
});

test('Shipping Blender kits fit original collision envelopes, keep scenery out of both modes and meet draw budgets', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/neon/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of NEON_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < .01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < .01, `${part} centered`);
      if (part === 'beacon-column') {
        root.updateMatrixWorld(true); const inverse = root.matrixWorld.clone().invert();
        root.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          const transform = inverse.clone().multiply(child.matrixWorld), position = child.geometry.getAttribute('position');
          for (let i = 0; i < position.count; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform);
            assert.ok(Math.hypot(vertex.x,vertex.z) <= .7501, 'column stays inside cylinder collider');
          }
        });
      }
    }
    for (const active of [map,toGrifballArena(map)]) {
      const instances = createNeonArchitectureInstances(source, active, detail);
      const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
      let triangles = 0, draws = 0;
      for (const child of instances.children) {
        assert.ok(child instanceof THREE.InstancedMesh);
        triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
        draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          assert.equal(material.transparent, false); assert.equal(material.opacity, 1);
        }
        if (child.userData.architecturePart === 'city-tower' || child.userData.architecturePart === 'neon-palm') {
          assert.equal(child.castShadow, false, 'distant scenery adds no shadow passes');
          const position = child.geometry.getAttribute('position'), matrix = new THREE.Matrix4();
          for (let instance = 0; instance < child.count; instance++) {
            child.getMatrixAt(instance, matrix);
            for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
              const vertex = new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);
              assert.ok(Math.abs(vertex.x) > half.x + 3 || Math.abs(vertex.z) > half.z + 3, 'actual remote geometry outside entire floor');
            }
          }
        }
      }
      assert.ok(draws + 3 <= 26, `${detail}: ${draws + 3} draws`);
      assert.ok(triangles < (detail === 'high' ? 180_000 : 50_000), `${detail}: ${triangles} triangles`);
      if (active === map) reports.push({ detail, triangles, draws });
      disposeNeonObjectResources([instances]);
    }
    disposeNeonObjectResources([source]);
  }
  assert.ok(reports[1].triangles < reports[0].triangles * .5, 'Low materially reduces geometry');
});
