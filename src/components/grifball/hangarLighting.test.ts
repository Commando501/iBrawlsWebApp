import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildHangarFillLighting, configureHangarShadow, createHangarLightProbeScene, disposeHangarEnvironment, initializeHangarEnvironment } from './hangarLighting';

test('one key shadow covers rectangular and circular play areas without overriding user intensity', () => {
  for (const bounds of [28, { x: 52, z: 23 }]) for (const tier of ['high', 'balanced', 'low'] as const) {
    const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
    const quality = getEnvironmentQualityProfile(tier), light = new THREE.DirectionalLight('#ffffff', 1.3);
    configureHangarShadow(light, bounds, quality);
    light.updateMatrixWorld(true); light.target.updateMatrixWorld(true); light.shadow.updateMatrices(light);
    assert.equal(light.intensity, 1.3); assert.equal(light.color.getHexString(), 'e5eef7');
    assert.equal(light.shadow.mapSize.x, quality.shadowMapSize);
    for (const x of [-half.x, half.x]) for (const z of [-half.z, half.z]) for (const y of [0, 8]) {
      const corner = new THREE.Vector3(x, y, z).project(light.shadow.camera);
      assert.ok(corner.toArray().every(value => value >= -1 && value <= 1), `outside shadow: ${corner.toArray()}`);
    }
    light.dispose();
  }
});

test('enclosed strip probe has bounded bake-only geometry while fill adds no shadow passes', () => {
  const probe = createHangarLightProbeScene();
  let meshes = 0, triangles = 0, roofStrips = 0, warmDoors = 0;
  probe.traverse(object => {
    assert.equal(object instanceof THREE.Light, false);
    if (object instanceof THREE.Mesh) {
      meshes++; triangles += object.geometry.index?.count / 3 || object.geometry.getAttribute('position').count / 3;
      roofStrips += Number(object.name === 'hangar_probe_roof_strip');
      warmDoors += Number(object.name === 'hangar_probe_warm_door');
      assert.equal(object.castShadow, false);
      object.geometry.dispose(); (object.material as THREE.Material).dispose();
    }
  });
  assert.equal(meshes, 8); assert.ok(triangles < 30); assert.equal(roofStrips, 2); assert.equal(warmDoors, 2);
  const fill = buildHangarFillLighting();
  assert.equal(fill.name, 'hangar_fill');
  const lights = fill.children.filter(object => object instanceof THREE.Light);
  assert.equal(lights.length, 2);
  assert.ok(lights[0] instanceof THREE.HemisphereLight); assert.ok(lights[1] instanceof THREE.DirectionalLight);
  lights.forEach(light => { assert.equal(light.castShadow, false); light.dispose(); });
});

test('environment bake respects each tier once and cleans scratch resources without touching sky', t => {
  const captures: { size: number; target: THREE.WebGLRenderTarget; disposed: number }[] = [];
  let scratchDisposals = 0, generatorDisposals = 0;
  t.mock.method(THREE.PMREMGenerator.prototype, 'fromScene', (probe: THREE.Scene, _sigma: number, _near: number, _far: number, options: { size: number }) => {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.addEventListener('dispose', () => { scratchDisposals++; });
      (object.material as THREE.Material).addEventListener('dispose', () => { scratchDisposals++; });
    });
    const target = new THREE.WebGLRenderTarget(1, 1), capture = { size: options.size, target, disposed: 0 };
    target.addEventListener('dispose', () => { capture.disposed++; }); captures.push(capture);
    return target;
  });
  t.mock.method(THREE.PMREMGenerator.prototype, 'dispose', () => { generatorDisposals++; });
  for (const [tier, size] of [['high', 256], ['balanced', 128], ['low', 128]] as const) {
    const scene = new THREE.Scene(), quality = getEnvironmentQualityProfile(tier);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial());
    sky.name = 'skybox_mesh'; scene.add(sky);
    initializeHangarEnvironment(scene, {} as THREE.WebGLRenderer, quality);
    const capture = captures.at(-1)!;
    assert.equal(capture.size, size); assert.equal(scene.environment, capture.target.texture);
    assert.equal(scene.environmentIntensity, tier === 'low' ? .58 : .72);
    const count = captures.length;
    initializeHangarEnvironment(scene, {} as THREE.WebGLRenderer, quality);
    assert.equal(captures.length, count);
    const replacement = new THREE.Texture(); scene.environment = replacement;
    disposeHangarEnvironment(scene); disposeHangarEnvironment(scene);
    assert.equal(capture.disposed, 1); assert.equal(scene.environment, replacement);
    assert.equal(sky.parent, scene, 'legacy sky and live sky controls remain independent');
    sky.geometry.dispose(); sky.material.dispose(); replacement.dispose();
  }
  assert.equal(scratchDisposals, 48); assert.equal(generatorDisposals, 3);
});

test('a failed probe bake frees scratch resources and leaves an external environment intact', t => {
  let disposed = 0;
  t.mock.method(THREE.PMREMGenerator.prototype, 'fromScene', (probe: THREE.Scene) => {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.addEventListener('dispose', () => { disposed++; });
      (object.material as THREE.Material).addEventListener('dispose', () => { disposed++; });
    });
    throw new Error('Renderer unavailable');
  });
  t.mock.method(THREE.PMREMGenerator.prototype, 'dispose', () => { disposed++; });
  const scene = new THREE.Scene(), previous = new THREE.Texture(); scene.environment = previous;
  assert.throws(() => initializeHangarEnvironment(scene, {} as THREE.WebGLRenderer, getEnvironmentQualityProfile('high')), /Renderer unavailable/);
  assert.equal(disposed, 17); assert.equal(scene.environment, previous);
  disposeHangarEnvironment(scene); previous.dispose();
});

test('owned sky cleanup works before probe readiness and preserves cached textures and other map skies', () => {
  const scene = new THREE.Scene(), cachedSky = new THREE.Texture();
  let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
  const owned = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ map: cachedSky }));
  owned.name = 'skybox_mesh'; owned.userData.hangarOwnedSky = true;
  owned.geometry.addEventListener('dispose', () => { geometryDisposals++; });
  owned.material.addEventListener('dispose', () => { materialDisposals++; });
  cachedSky.addEventListener('dispose', () => { textureDisposals++; });
  const otherMap = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ map: cachedSky }));
  otherMap.name = 'skybox_mesh';
  scene.add(owned, otherMap);
  disposeHangarEnvironment(scene); disposeHangarEnvironment(scene);
  assert.equal(owned.parent, null); assert.equal(otherMap.parent, scene);
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1); assert.equal(textureDisposals, 0);
  otherMap.geometry.dispose(); otherMap.material.dispose(); cachedSky.dispose();
});
