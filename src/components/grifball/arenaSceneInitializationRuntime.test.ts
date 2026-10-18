import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { resolveSkyboxAtmosphereSettings } from '../../game/skyboxTextures';
import { disposeFailedArenaSceneInitialization } from './arenaSceneInitializationRuntime';
import { createCanyonSkyMaterial } from './canyonLighting';
import { createInitialGrifballThreeRefs } from './threeRefs';

test('failed environment initialization clears its owned resources and references while retaining cached sky textures', () => {
  for (const kind of ['canyon', 'stadium', 'hangar', 'cyber', 'jungle', 'asteroid', 'neon', 'rainy'] as const) {
    const refs = createInitialGrifballThreeRefs(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    let rendererDisposals = 0;
    const renderer = { dispose: () => { rendererDisposals++; } } as THREE.WebGLRenderer;
    const sharedSkyTexture = new THREE.Texture();
    const material = kind === 'canyon' ? createCanyonSkyMaterial() : new THREE.MeshBasicMaterial({ map: sharedSkyTexture });
    const skybox = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material); skybox.name = 'skybox_mesh';
    const floor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); floor.name = `${kind}_floor`;
    const atmosphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial());
    const atmosphereGroup = new THREE.Group(); atmosphereGroup.add(atmosphereMesh);
    const atmosphere = { group: atmosphereGroup, skyboxTextureId: 'grifball_stadium' as const, settings: resolveSkyboxAtmosphereSettings('grifball_stadium') };
    scene.add(camera, skybox, floor, atmosphereGroup);
    Object.assign(refs, { scene, camera, renderer, skyboxMesh: skybox, skyAtmosphere: atmosphere, customMapObjects: [floor] });
    const counts = new Map<object, number>();
    const owned = [skybox.geometry, skybox.material, floor.geometry, floor.material, atmosphereMesh.geometry, atmosphereMesh.material];
    for (const resource of [...owned, sharedSkyTexture]) {
      const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
      dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
    }
    disposeFailedArenaSceneInitialization({ scene, camera, renderer }, refs);
    for (const resource of owned) assert.equal(counts.get(resource), 1);
    assert.equal(counts.has(sharedSkyTexture), false, 'sky cache survives a failed mount');
    assert.equal(rendererDisposals, 1);
    assert.equal(refs.scene, null); assert.equal(refs.camera, null); assert.equal(refs.renderer, null);
    assert.equal(refs.skyboxMesh, null); assert.equal(refs.skyAtmosphere, null); assert.deepEqual(refs.customMapObjects, []);
    assert.equal(scene.children.length, 1, 'only the resource-free camera remains');
    sharedSkyTexture.dispose();
  }
});

test('failed scene cleanup cannot clear another scene that has taken ownership of the shared refs', () => {
  const refs = createInitialGrifballThreeRefs(), failedScene = new THREE.Scene(), failedCamera = new THREE.PerspectiveCamera();
  let disposed = 0;
  const failedRenderer = { dispose: () => { disposed++; } } as THREE.WebGLRenderer;
  const oldSky = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), createCanyonSkyMaterial()); oldSky.name = 'skybox_mesh'; failedScene.add(oldSky);
  const surviving = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const renderer = { dispose: (): void => { assert.fail('new renderer must survive'); } } as THREE.WebGLRenderer;
  const skybox = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial());
  const objects = [new THREE.Group()];
  Object.assign(refs, { scene: surviving, camera, renderer, skyboxMesh: skybox, customMapObjects: objects });
  disposeFailedArenaSceneInitialization({ scene: failedScene, camera: failedCamera, renderer: failedRenderer }, refs);
  assert.equal(disposed, 1); assert.equal(oldSky.parent, null);
  assert.equal(refs.scene, surviving); assert.equal(refs.camera, camera); assert.equal(refs.renderer, renderer);
  assert.equal(refs.skyboxMesh, skybox); assert.equal(refs.customMapObjects, objects);
  skybox.geometry.dispose(); skybox.material.dispose();
});
