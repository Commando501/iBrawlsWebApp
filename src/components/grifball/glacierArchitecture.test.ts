import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { createGlacierFallbackObject } from './glacierArenaRuntime';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeGlacierObjectResources, disposeGlacierResources } from './glacierResourceDisposal';
import {
  GLACIER_ARCHITECTURE_PARTS, GLACIER_REPLACED_OBJECT_IDS, buildGlacierSceneryForRefs,
  createGlacierArchitectureInstances, createGlacierArchitectureSourceCache, createGlacierPerimeter, createGlacierRinkPaint, getGlacierArchitecturePlacements,
} from './glacierArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'winter_glacier_rink')!;
const sizes = [[.6,5,.6], [1.5,2,4], [4,.8,.1], [4,1.4,.1], [22,24,16], [6,12,6]];
const remoteParts = ['glacier-ridge', 'snowy-pine'] as const;
const sourceKit = () => {
  const source = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: '#88949d', map: texture, roughnessMap: texture }); material.name = 'glacier_alloy';
  for (const [index, name] of GLACIER_ARCHITECTURE_PARTS.entries()) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(...sizes[index] as [number, number, number]), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();

test('Glacier source cache coalesces quality requests and retries failed downloads', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createGlacierArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
  disposeGlacierObjectResources([source]);
});

test('Glacier preserves all 14 source colliders; tiled boards exactly fit both mode layouts', () => {
  const before = JSON.stringify(map);
  assert.equal(map.arenaRadius, 20); assert.equal(map.mapShape, 'rectangular');
  assert.equal(map.objects.length, 14); assert.ok(map.objects.every(object => object.isCollidable));
  const posts = [[-24,-12],[-24,12],[24,-12],[24,12]];
  for (const [index, object] of map.objects.entries()) {
    assert.deepEqual(object.rotation, {x:0,y:0,z:0});
    if (index < 4) {
      assert.equal(object.type, 'cylinder');
      assert.deepEqual(object.scale, {x:.6,y:5,z:.6});
      assert.deepEqual(object.position, {x:posts[index][0],y:2.5,z:posts[index][1]});
    } else if (index < 6) {
      assert.deepEqual(object.scale, {x:1.5,y:2,z:4});
      assert.deepEqual(object.position, {x:index===4?-19:19,y:1,z:0});
    } else {
      const alongX = object.id.endsWith('_n') || object.id.endsWith('_s');
      const glass = object.id.includes('glass');
      assert.deepEqual(object.scale, {x:alongX?48:.1,y:glass?1.4:.8,z:alongX?.1:24});
      assert.deepEqual(object.position, {x:alongX?0:object.id.endsWith('_w')?-24:24,y:glass?1.5:.4,z:alongX?object.id.endsWith('_n')?-12:12:0});
    }
  }
  for (const active of [map, toGrifballArena(map)]) {
    const activeBefore = JSON.stringify(active), placements = getGlacierArchitecturePlacements(active, 'high');
    const found = Object.entries(placements).flatMap(([part, items]) => items.filter(item => item.objectId).map(item => ({ part, ...item })));
    const originals = active.objects.filter(object => GLACIER_REPLACED_OBJECT_IDS.includes(object.id));
    assert.deepEqual([...new Set(found.map(item=>item.objectId))].sort(), originals.map(object=>object.id).sort());
    for (const object of originals) {
      const entries = found.filter(item => item.objectId === object.id); assert.ok(entries.length, object.id);
      const expected = new THREE.Box3(new THREE.Vector3(-object.scale.x/2,-object.scale.y/2,-object.scale.z/2),
        new THREE.Vector3(object.scale.x/2,object.scale.y/2,object.scale.z/2)).applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(object.position.x,object.position.y,object.position.z),new THREE.Quaternion(),new THREE.Vector3(1,1,1)));
      const union = new THREE.Box3();
      for (const entry of entries) {
        const index = GLACIER_ARCHITECTURE_PARTS.indexOf(entry.part as typeof GLACIER_ARCHITECTURE_PARTS[number]);
        const half = new THREE.Vector3().fromArray(sizes[index]).multiplyScalar(.5);
        union.union(new THREE.Box3(half.clone().negate(),half.clone()).applyMatrix4(entry.matrix));
        if (entry.part === 'rink-board' || entry.part === 'rink-glass') {
          const scale = new THREE.Vector3(); entry.matrix.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);
          assert.ok(scale.x <= 1 && scale.x > .8, 'metre-sized board details never stretch across the entire rink');
        }
      }
      assert.ok(union.min.distanceTo(expected.min)<1e-6 && union.max.distanceTo(expected.max)<1e-6, `${object.id} aggregate visual envelope`);
    }
    assert.equal(JSON.stringify(active), activeBefore);
  }
  assert.deepEqual(getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents), { x: 24, z: 12 });
  assert.deepEqual(toGrifballArena(map).arenaHalfExtents, { x: 52, z: 23 });
  assert.deepEqual(toGrifballArena(map).objects.filter(object=>object.isCollidable).map(object=>object.id),
    ['board_low_n','board_low_s','board_glass_n','board_glass_s']);
  assert.equal(JSON.stringify(map), before);
});

test('Ridges and pines stay beyond both floors; snow foundation stays below the ice', () => {
  for (const active of [map, toGrifballArena(map)]) {
    const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
    const protectedBounds = new THREE.Box3(new THREE.Vector3(-half.x - 3, -200, -half.z - 3), new THREE.Vector3(half.x + 3, 200, half.z + 3));
    for (const detail of ['high', 'low'] as const) {
      const placements = getGlacierArchitecturePlacements(active, detail);
      assert.equal(placements['glacier-ridge'].length, detail === 'high' ? 10 : 6);
      assert.equal(placements['snowy-pine'].length, detail === 'high' ? 12 : 6);
      for (const part of remoteParts) {
        const size = new THREE.Vector3().fromArray(sizes[GLACIER_ARCHITECTURE_PARTS.indexOf(part)]).multiplyScalar(.5);
        for (const item of placements[part]) {
          const bounds = new THREE.Box3(size.clone().negate(), size.clone()).applyMatrix4(item.matrix);
          assert.equal(bounds.intersectsBox(protectedBounds), false, `${part} full bounds`);
        }
      }
      const perimeter = createGlacierPerimeter(active, cloneMaterial, detail);
      assert.equal(perimeter.children.length, 3); perimeter.updateMatrixWorld(true);
      perimeter.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        assert.equal(object.castShadow, false);
        const position = object.geometry.getAttribute('position');
        for (let index = 0; index < position.count; index++) assert.ok(position.getY(index) <= -.199);
      });
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0));
      for (const placement of placements['snowy-pine']) {
        const position = new THREE.Vector3(), scale = new THREE.Vector3();
        placement.matrix.decompose(position,new THREE.Quaternion(),scale); ray.ray.origin.set(position.x,0,position.z);
        const hit = ray.intersectObject(perimeter,true)[0];
        assert.ok(hit && Math.abs(hit.point.y - (position.y - 6 * scale.y)) < 1e-6, 'pine base touches snow');
      }
      const ground = new THREE.Raycaster(new THREE.Vector3(0,0,0), new THREE.Vector3(0,-1,0)).intersectObject(perimeter,true)[0];
      assert.ok(ground && Math.abs(ground.point.y + .2) < 1e-6, 'structural base meets underside of ice');
      disposeGlacierObjectResources([perimeter]);
    }
  }
});

test('Rink markings remain one restrained surface draw inside either unchanged floor', () => {
  for (const active of [map,toGrifballArena(map)]) {
    const paint = createGlacierRinkPaint(active), half = getRectHalfExtents(active.arenaRadius,active.arenaHalfExtents);
    const vertices = paint.geometry.getAttribute('position'), material = paint.material as THREE.MeshBasicMaterial;
    assert.equal(material.depthWrite,false); assert.ok(material.opacity < .4); assert.equal(material.vertexColors,true);
    assert.equal(paint.castShadow,false); assert.equal(paint.children.length,0);
    for (let index=0;index<vertices.count;index++) {
      assert.ok(Math.abs(vertices.getX(index)) < half.x && Math.abs(vertices.getZ(index)) < half.z);
      assert.ok(Math.abs(vertices.getY(index)-.012)<1e-6);
    }
    disposeGlacierObjectResources([paint]);
  }
});

test('Immediate fallback keeps cylinder and box envelopes plus readable glass transparency', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  for (const object of map.objects) {
    const group = createGlacierFallbackObject(object,getEnvironmentQualityProfile('low'))!; assert.ok(group,object.id);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    assert.ok(size.distanceTo(new THREE.Vector3(object.scale.x,object.scale.y,object.scale.z))<1e-6,object.id);
    const mesh = group.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.Material>;
    assert.equal(mesh.userData.id,object.id); assert.equal(group.name,object.id);
    assert.equal(mesh.material.transparent,object.id.includes('glass'));
    if (object.id.includes('glass')) assert.ok(mesh.material.opacity > .1 && mesh.material.opacity < .65);
    disposeGlacierObjectResources([group]);
  }
  assert.equal(createGlacierFallbackObject({...map.objects[0],id:'user_prop'},getEnvironmentQualityProfile('high')),undefined);
});

test('Instances own geometry and texture handles without mutating source kits or authored UVs', () => {
  for (const factory of [undefined, cloneMaterial, (material: THREE.Material) => material]) {
    const source = sourceKit(), original = JSON.stringify(source.toJSON());
    const first = createGlacierArchitectureInstances(source, map, 'high', factory);
    const second = createGlacierArchitectureInstances(source, map, 'high', factory);
    const cached = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const a = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const b = second.children[0] as typeof a;
    assert.equal(first.children.length, 6); assert.equal(a.count, 4);
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
    disposeGlacierObjectResources([first]); assert.equal(sharedDisposed, 0);
    disposeGlacierObjectResources([second, source]);
  }
});

test('Kit attachment hides only tagged props; cancellation preserves fallback and independently animated snow', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const legacy = GLACIER_REPLACED_OBJECT_IDS.map((id, index) => {
    const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.glacierLegacyId = id;
    mesh.visible = index !== 0; refs.scene!.add(mesh); refs.customMapObjects!.push(mesh); return mesh;
  });
  const actor = new THREE.Mesh(); actor.name = 'iron_vanguard'; refs.scene.add(actor);
  const source = sourceKit();
  const handle = buildGlacierSceneryForRefs({ refs, activeCustomMap: map, load: async () => source, materialFactory: cloneMaterial })!;
  await handle.ready;
  assert.ok(legacy.every(mesh => !mesh.visible)); assert.equal(actor.visible, true);
  assert.ok(refs.scene.getObjectByName('glacier_blender_architecture'));
  assert.equal(refs.customMapObjects!.length, 15, 'one scenery root registered');
  handle.cancel(); handle.cancel();
  assert.ok(legacy.every((mesh, index) => mesh.visible === (index !== 0)));
  assert.equal(refs.scene.getObjectByName('glacier_blender_architecture'), undefined);
  assert.ok(refs.scene.getObjectByName('glacier_subdeck')); assert.ok(refs.scene.getObjectByName('glacier_weather'));
  for (const mesh of legacy) assert.equal(refs.scene.getObjectByName(mesh.name), mesh);
  disposeGlacierResources(refs.scene); assert.deepEqual(refs.scene.children, [actor]);
  disposeGlacierObjectResources([source]);
});

test('Missing, malformed, canceled, detached or disposed pending kits keep fallback and never attach late', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached', 'disposed'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = new THREE.Mesh(); legacy.userData.glacierLegacyId = 'post_nw'; refs.scene.add(legacy);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let errors = 0;
    const handle = buildGlacierSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => errors++ })!;
    const group = refs.scene.getObjectByName('glacier_scenery')!;
    assert.ok(group.getObjectByName('glacier_subdeck')); assert.equal(legacy.visible, true);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') group.removeFromParent();
    if (outcome === 'disposed') { disposeGlacierResources(refs.scene); await handle.ready; }
    const source = outcome === 'invalid' ? new THREE.Group() : sourceKit();
    if (outcome === 'failed') reject(new Error('offline')); else resolve(source);
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(group.getObjectByName('glacier_blender_architecture'), undefined);
    assert.equal(legacy.visible, true); assert.equal(errors, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'disposed') disposeGlacierObjectResources([group]);
    disposeGlacierObjectResources([source]);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildGlacierSceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_glacier_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'theme matching alone does not affect user maps');
});

test('Shipping Blender kits fit colliders, preserve transparent boards, and meet draw budgets', async () => {
  const reports: {detail:string;triangles:number;draws:number}[]=[];
  for (const detail of ['high','low'] as const) {
    const filename=detail==='high'?'kit-v1.glb':'kit-low-v1.glb';
    const bytes=await readFile(new URL(`../../../public/assets/glacier/architecture/${filename}`,import.meta.url));
    const source=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
    for (const [index,part] of GLACIER_ARCHITECTURE_PARTS.entries()) {
      const root=source.getObjectByName(part)!;assert.ok(root,part);
      const bounds=new THREE.Box3().setFromObject(root);
      assert.ok(bounds.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index]))<.01,part);
      assert.ok(bounds.getCenter(new THREE.Vector3()).length()<.01,`${part} centered`);
      if (part==='anchor-post') root.traverse(child=>{
        if (!(child instanceof THREE.Mesh)) return;
        const position=child.geometry.getAttribute('position');
        for(let i=0;i<position.count;i++) {
          const vertex=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(child.matrixWorld);
          assert.ok(Math.hypot(vertex.x,vertex.z)<=.30001,'anchor vertices fit cylinder collision radius');
        }
      });
    }
    for (const active of [map,toGrifballArena(map)]) {
      const instances=createGlacierArchitectureInstances(source,active,detail);
      const half=getRectHalfExtents(active.arenaRadius,active.arenaHalfExtents);
      let triangles=0,draws=0;
      for(const child of instances.children) {
        assert.ok(child instanceof THREE.InstancedMesh);
        triangles+=(child.geometry.index?.count??child.geometry.getAttribute('position').count)/3*child.count;
        draws+=Array.isArray(child.material)?child.geometry.groups.length:1;
        for(const material of Array.isArray(child.material)?child.material:[child.material]) {
          assert.equal(material.transparent,material.name==='glacier_glass');
          if (!material.transparent) assert.equal(material.opacity,1);
        }
        if(remoteParts.includes(child.userData.architecturePart)) {
          assert.equal(child.castShadow,false,'background adds no shadow passes');
          const position=child.geometry.getAttribute('position'),matrix=new THREE.Matrix4();
          for(let instance=0;instance<child.count;instance++) {
            child.getMatrixAt(instance,matrix);
            for(let index=0;index<position.count;index++) {
              const vertex=new THREE.Vector3().fromBufferAttribute(position,index).applyMatrix4(matrix);
              assert.ok(Math.abs(vertex.x)>half.x+3||Math.abs(vertex.z)>half.z+3,'actual remote vertices outside entire floor');
            }
          }
        }
      }
      assert.ok(draws+5<35,`${detail}: ${draws+5} draws including foundation, paint and snow`);
      assert.ok(triangles<(detail==='high'?200_000:65_000),`${detail}: ${triangles} triangles`);
      if(active===map)reports.push({detail,triangles,draws});
      disposeGlacierObjectResources([instances]);
    }
    disposeGlacierObjectResources([source]);
  }
  assert.ok(reports[1].triangles<reports[0].triangles*.5,'Low materially reduces geometry');
});
