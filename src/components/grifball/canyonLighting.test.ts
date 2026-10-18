import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCanyonFillLighting, configureCanyonShadow, createCanyonLightProbeScene, createCanyonSkyMaterial, disposeCanyonEnvironment, initializeCanyonEnvironment, updateCanyonSkyMaterial } from './canyonLighting';

test('default sky has a blue zenith and restrained warm horizon; controls update existing colors', () => {
  const sky = createCanyonSkyMaterial();
  const zenith = sky.uniforms.zenithColor.value as THREE.Color;
  const horizon = sky.uniforms.horizonColor.value as THREE.Color;
  assert.ok(zenith.b > zenith.r && zenith.b > zenith.g);
  assert.ok(horizon.r > horizon.g && horizon.g > horizon.b);
  assert.equal(sky.side, THREE.BackSide); assert.equal(sky.depthWrite, false); assert.equal(sky.fog, false);
  const original = zenith.clone();
  updateCanyonSkyMaterial(sky, 140, 3.5);
  assert.equal(sky.uniforms.zenithColor.value, zenith, 'live controls do not allocate new materials or colors');
  assert.equal(sky.uniforms.horizonColor.value, horizon);
  assert.equal(zenith.equals(original), false);
  assert.equal(sky.uniforms.skyExposure.value, .5);
  updateCanyonSkyMaterial(sky, Number.NaN, Number.POSITIVE_INFINITY);
  assert.equal(zenith.equals(original), true);
  assert.equal(sky.uniforms.skyExposure.value, 1);
  updateCanyonSkyMaterial(sky, -325, -10);
  assert.equal(zenith.equals(original), true); assert.equal(sky.uniforms.skyExposure.value, 0);
  sky.dispose();
});

test('sun shadow covers full arena corners and player height at every quality without changing intensity', () => {
  const half = { x: 40, z: 40 };
  for (const tier of ['high', 'balanced', 'low'] as const) {
    const quality = getEnvironmentQualityProfile(tier), light = new THREE.DirectionalLight('#ffffff', 1.3);
    configureCanyonShadow(light, half, quality);
    light.updateMatrixWorld(true); light.target.updateMatrixWorld(true); light.shadow.updateMatrices(light);
    assert.equal(light.intensity, 1.3); assert.equal(light.color.getHexString(), 'fff0d8');
    assert.equal(light.shadow.mapSize.x, quality.shadowMapSize);
    for (const x of [-half.x, half.x]) for (const z of [-half.z, half.z]) for (const y of [0, 8]) {
      const corner = new THREE.Vector3(x, y, z).project(light.shadow.camera);
      assert.ok(corner.toArray().every(value => value >= -1 && value <= 1), `outside shadow: ${corner.toArray()}`);
    }
    const sky = createCanyonSkyMaterial();
    const sun = sky.uniforms.sunDirection.value as THREE.Vector3;
    assert.ok(light.position.clone().normalize().distanceTo(sun) < 1e-8);
    sky.dispose();
    light.dispose();
  }
});

test('outdoor probe contains three bake-only meshes and fill adds no directional or shadow lights', () => {
  const probe = createCanyonLightProbeScene();
  let meshes = 0;
  probe.traverse(object => {
    assert.equal(object instanceof THREE.Light, false);
    if (object instanceof THREE.Mesh) {
      meshes++;
      assert.equal(object.castShadow, false);
      object.geometry.dispose(); (object.material as THREE.Material).dispose();
    }
  });
  assert.equal(meshes, 3);
  const fill = buildCanyonFillLighting();
  assert.equal(fill.name, 'canyon_fill');
  assert.equal(fill.children.length, 1); assert.ok(fill.children[0] instanceof THREE.HemisphereLight);
  assert.equal((fill.children[0] as THREE.HemisphereLight).castShadow, false);
});

test('environment bake uses the tier budget once, releases scratch objects, and disposes owned sky only', t => {
  const captures: { size: number; target: THREE.WebGLRenderTarget; disposed: number }[] = [];
  let scratchGeometryDisposals = 0, scratchMaterialDisposals = 0, generatorDisposals = 0;
  t.mock.method(THREE.PMREMGenerator.prototype, 'fromScene', (probe: THREE.Scene, _sigma: number, _near: number, _far: number, options: { size: number }) => {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.addEventListener('dispose', () => { scratchGeometryDisposals++; });
      (object.material as THREE.Material).addEventListener('dispose', () => { scratchMaterialDisposals++; });
    });
    const target = new THREE.WebGLRenderTarget(1, 1), capture = { size: options.size, target, disposed: 0 };
    target.addEventListener('dispose', () => { capture.disposed++; }); captures.push(capture);
    return target;
  });
  t.mock.method(THREE.PMREMGenerator.prototype, 'dispose', () => { generatorDisposals++; });
  const renderer = {} as THREE.WebGLRenderer;
  for (const [tier, size] of [['high', 256], ['balanced', 128], ['low', 128]] as const) {
    const scene = new THREE.Scene(), quality = getEnvironmentQualityProfile(tier);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), createCanyonSkyMaterial());
    const unrelated = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial());
    let skyDisposed = 0;
    sky.geometry.addEventListener('dispose', () => { skyDisposed++; }); sky.material.addEventListener('dispose', () => { skyDisposed++; });
    scene.add(sky, unrelated);
    initializeCanyonEnvironment(scene, renderer, quality);
    const capture = captures.at(-1)!;
    assert.equal(capture.size, size); assert.equal(scene.environment, capture.target.texture);
    const count = captures.length;
    initializeCanyonEnvironment(scene, renderer, quality);
    assert.equal(captures.length, count, 'repeated initialization must not rebuild the probe');
    const replacement = new THREE.Texture();
    scene.environment = replacement;
    disposeCanyonEnvironment(scene); disposeCanyonEnvironment(scene);
    assert.equal(capture.disposed, 1); assert.equal(scene.environment, replacement);
    assert.equal(sky.parent, null); assert.equal(skyDisposed, 2);
    assert.equal(unrelated.parent, scene);
    unrelated.geometry.dispose(); unrelated.material.dispose(); replacement.dispose();
  }
  assert.equal(scratchGeometryDisposals, 9); assert.equal(scratchMaterialDisposals, 9); assert.equal(generatorDisposals, 3);
});

test('failed probe bake releases temporary resources and leaves the existing scene environment intact', t => {
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
  assert.throws(() => initializeCanyonEnvironment(scene, {} as THREE.WebGLRenderer, getEnvironmentQualityProfile('high')), /Renderer unavailable/);
  assert.equal(disposed, 7); assert.equal(scene.environment, previous);
  disposeCanyonEnvironment(scene); previous.dispose();
});
