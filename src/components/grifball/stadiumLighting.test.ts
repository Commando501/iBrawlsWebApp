import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildStadiumFillLighting, configureStadiumShadow, createStadiumLightProbeScene, disposeStadiumEnvironment, initializeStadiumEnvironment } from './stadiumLighting';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';

test('stadium sun shadow covers every playable court corner at each quality', () => {
  const half = { x: 61.5, z: 33.08 };
  for (const mapSize of [512, 1024, 2048]) {
    const light = new THREE.DirectionalLight();
    configureStadiumShadow(light, half, { ...getEnvironmentQualityProfile(), shadowMapSize: mapSize });
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
    light.shadow.updateMatrices(light);
    assert.equal(light.shadow.mapSize.x, mapSize);
    for (const x of [-half.x, half.x]) for (const z of [-half.z, half.z]) {
      const corner = new THREE.Vector3(x, 0, z).project(light.shadow.camera);
      for (const value of corner.toArray()) assert.ok(value >= -1 && value <= 1, `corner outside shadow: ${corner.toArray()}`);
    }
    light.dispose();
  }
});

test('stadium reflection probe and fill do not add live shadow passes', () => {
  const probe = createStadiumLightProbeScene();
  let count = 0;
  probe.traverse(object => {
    assert.equal(object instanceof THREE.Light, false);
    if (object instanceof THREE.Mesh) {
      count++;
      assert.ok(Number.isFinite(object.position.length()));
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  assert.ok(count > 0);
  const fill = buildStadiumFillLighting({ x: 61.5, z: 33.08 });
  fill.traverse(object => {
    if (object instanceof THREE.Light) assert.equal(object.castShadow, false);
  });
});

test('Stadium bakes one probe per scene and releases replaced targets and scratch resources at every quality', t => {
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
    initializeStadiumEnvironment(scene, {} as THREE.WebGLRenderer, quality);
    const first = captures.at(-1)!;
    assert.equal(first.size, size);
    assert.equal(scene.environment, first.target.texture);
    assert.equal(scene.environmentIntensity, tier === 'low' ? .55 : .7);
    const count = captures.length;
    initializeStadiumEnvironment(scene, {} as THREE.WebGLRenderer, quality);
    assert.equal(captures.length, count, 'repeated initialization must not allocate a second target');

    const external = new THREE.Texture(); scene.environment = external;
    initializeStadiumEnvironment(scene, {} as THREE.WebGLRenderer, quality);
    assert.equal(first.disposed, 1);
    const second = captures.at(-1)!;
    assert.equal(scene.environment, second.target.texture);
    scene.environment = external;
    disposeStadiumEnvironment(scene); disposeStadiumEnvironment(scene);
    assert.equal(second.disposed, 1);
    assert.equal(scene.environment, external);
    external.dispose();
  }
  assert.equal(scratchDisposals, 84, 'seven probe cards each own one geometry and material');
  assert.equal(generatorDisposals, 6);
});

test('failed Stadium probe replacement frees scratch allocations and preserves the current external environment', t => {
  const scene = new THREE.Scene(), external = new THREE.Texture();
  const target = new THREE.WebGLRenderTarget(1, 1);
  let targetDisposals = 0, scratchDisposals = 0, generatorDisposals = 0;
  target.addEventListener('dispose', () => { targetDisposals++; });
  let fail = false;
  t.mock.method(THREE.PMREMGenerator.prototype, 'fromScene', (probe: THREE.Scene) => {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.addEventListener('dispose', () => { scratchDisposals++; });
      (object.material as THREE.Material).addEventListener('dispose', () => { scratchDisposals++; });
    });
    if (fail) throw new Error('Renderer unavailable');
    return target;
  });
  t.mock.method(THREE.PMREMGenerator.prototype, 'dispose', () => { generatorDisposals++; });
  initializeStadiumEnvironment(scene, {} as THREE.WebGLRenderer, getEnvironmentQualityProfile('high'));
  scene.environment = external; fail = true;
  assert.throws(() => initializeStadiumEnvironment(scene, {} as THREE.WebGLRenderer, getEnvironmentQualityProfile('high')), /Renderer unavailable/);
  assert.equal(scene.environment, external);
  assert.equal(scratchDisposals, 28);
  assert.equal(generatorDisposals, 2);
  disposeStadiumEnvironment(scene); disposeStadiumEnvironment(scene);
  assert.equal(targetDisposals, 1);
  assert.equal(scene.environment, external);
  external.dispose();
});
