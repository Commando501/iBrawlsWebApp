import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeCircleResources, registerCircleResourceCleanup } from './circleResourceDisposal';

test('Circle cleanup releases shared scene resources once and keeps armor and other arenas alive', () => {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
  const geometry = new THREE.BoxGeometry();
  const group = new THREE.Group(); group.name = 'circle_scenery'; scene.add(group);
  const instances = new THREE.InstancedMesh(geometry, material, 12); group.add(instances);
  for (const name of ['circle_floor', 'circle_fill']) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; scene.add(mesh);
  }
  const armor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(armor);
  const stadium = new THREE.Group(); stadium.name = 'stadium_scenery'; scene.add(stadium);
  const counts = new Map<object, number>();
  for (const resource of [texture, material, geometry, instances, armor.geometry, armor.material]) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  }
  disposeCircleResources(scene); disposeCircleResources(scene); disposeCircleResources(null);
  for (const owned of [texture, material, geometry, instances]) assert.equal(counts.get(owned), 1);
  assert.equal(counts.has(armor.geometry), false); assert.equal(counts.has(armor.material), false);
  assert.deepEqual(scene.children, [armor, stadium]);
});

test('Circle cleanup releases shadow render targets and its lights while preserving foreign scene owners', () => {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(); key.name = 'circle_directional_key'; scene.add(key);
  const ambient = new THREE.AmbientLight(); ambient.name = 'circle_ambient_light'; scene.add(ambient);
  const foreign = new THREE.DirectionalLight(); foreign.name = 'other_map_light'; scene.add(foreign);
  const target = new THREE.WebGLRenderTarget(2, 2), pass = new THREE.WebGLRenderTarget(2, 2);
  key.shadow.map = target; key.shadow.mapPass = pass;
  const foreignTarget = new THREE.WebGLRenderTarget(2, 2); foreign.shadow.map = foreignTarget;
  let targetsDisposed = 0, foreignDisposed = 0, canceled = 0;
  target.addEventListener('dispose', () => targetsDisposed++); pass.addEventListener('dispose', () => targetsDisposed++);
  foreignTarget.addEventListener('dispose', () => foreignDisposed++);
  const scenery = new THREE.Group(); scenery.name = 'circle_scenery'; scene.add(scenery);
  registerCircleResourceCleanup(scenery, () => { canceled++; });
  disposeCircleResources(scene); disposeCircleResources(scene);
  assert.equal(canceled, 1); assert.equal(targetsDisposed, 2); assert.equal(foreignDisposed, 0);
  assert.deepEqual(scene.children, [foreign]);
});
