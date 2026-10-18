import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeGlacierResources, registerGlacierResourceCleanup } from './glacierResourceDisposal';

test('Glacier cleanup releases owned resources and lifecycle once while leaving armor and other arenas intact', () => {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
  const geometry = new THREE.BoxGeometry();
  const group = new THREE.Group(); group.name = 'glacier_scenery'; scene.add(group);
  const instances = new THREE.InstancedMesh(geometry, material, 8); group.add(instances);
  for (const name of ['glacier_floor', 'glacier_fill']) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; scene.add(mesh);
  }
  const legacy = new THREE.Mesh(geometry, material); legacy.userData.glacierLegacyId = 'post_nw'; scene.add(legacy);
  const armor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(armor);
  const canyon = new THREE.Group(); canyon.name = 'canyon_scenery'; scene.add(canyon);
  const key = new THREE.DirectionalLight(); key.name = 'glacier_directional_key';
  key.shadow.map = new THREE.WebGLRenderTarget(16, 16);
  key.shadow.mapPass = new THREE.WebGLRenderTarget(16, 16); scene.add(key);
  const foreignKey = new THREE.DirectionalLight(); foreignKey.name = 'cyber_directional_key';
  foreignKey.shadow.map = new THREE.WebGLRenderTarget(16, 16); scene.add(foreignKey);
  let cleanups = 0; registerGlacierResourceCleanup(group, () => { cleanups++; });
  const counts = new Map<object, number>();
  for (const resource of [texture, material, geometry, instances, armor.geometry, armor.material, key.shadow.map, key.shadow.mapPass, foreignKey.shadow.map]) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  }
  disposeGlacierResources(scene); disposeGlacierResources(scene); disposeGlacierResources(null);
  for (const owned of [texture, material, geometry, instances, key.shadow.map, key.shadow.mapPass]) assert.equal(counts.get(owned), 1);
  assert.equal(cleanups, 1);
  assert.equal(counts.has(armor.geometry), false); assert.equal(counts.has(armor.material), false);
  assert.equal(counts.has(foreignKey.shadow.map), false);
  assert.equal(key.parent, null);
  assert.deepEqual(scene.children, [armor, canyon, foreignKey]);
  foreignKey.shadow.dispose();
});
