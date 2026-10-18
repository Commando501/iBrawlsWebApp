import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildStadiumFillLighting, configureStadiumShadow, createStadiumLightProbeScene } from './stadiumLighting';
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
