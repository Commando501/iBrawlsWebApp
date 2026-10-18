import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createRainyWeather, updateRainyWeatherForScene } from './rainyWeather';
import { disposeRainyResources } from './rainyResourceDisposal';

const map = PREMADE_MAPS.find(item => item.id === 'rainy_industrial_streets')!;

test('Rain stays a single GPU draw on every quality tier with bounded density for both layouts', () => {
  for (const active of [map, toGrifballArena(map)]) {
    const counts: number[] = [];
    for (const tier of ['high', 'balanced', 'low'] as const) {
      const weather = createRainyWeather(active, getEnvironmentQualityProfile(tier))!;
      assert.ok(weather instanceof THREE.LineSegments); assert.equal(weather.children.length, 0);
      const count = weather.userData.dropCount; counts.push(count);
      assert.ok(count <= 2100); assert.equal(weather.geometry.getAttribute('position').count, count * 2);
      assert.equal(weather.geometry.getAttribute('aSeed').count, count * 2);
      const material = weather.material as THREE.ShaderMaterial;
      assert.equal(material.depthWrite, false); assert.equal(material.depthTest, true);
      assert.equal(material.transparent, true); assert.equal(weather.castShadow, false);
      assert.ok(weather.geometry.boundingBox && weather.geometry.boundingSphere);
      weather.geometry.dispose(); material.dispose();
    }
    assert.ok(counts[1] < counts[0] * .5); assert.ok(counts[2] < counts[0] * .2);
  }
});

test('Weather update changes only the uniform, preserves vertex buffers, and ignores foreign rain', () => {
  const scene = new THREE.Scene(), rain = createRainyWeather(map, getEnvironmentQualityProfile('high'))!;
  scene.add(rain);
  const position = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
  const seed = rain.geometry.getAttribute('aSeed');
  const positionBefore = Array.from(position.array), seedBefore = Array.from(seed.array), version = position.version;
  const material = rain.material as THREE.ShaderMaterial;
  updateRainyWeatherForScene(scene, 12345); assert.equal(material.uniforms.uTime.value, 12.345);
  updateRainyWeatherForScene(scene, NaN); assert.equal(material.uniforms.uTime.value, 12.345);
  updateRainyWeatherForScene(scene, Infinity); assert.equal(material.uniforms.uTime.value, 12.345);
  updateRainyWeatherForScene(scene, -1); assert.equal(material.uniforms.uTime.value, 0);
  assert.equal(rain.geometry.getAttribute('position'), position); assert.equal(position.version, version);
  assert.deepEqual(Array.from(position.array), positionBefore); assert.deepEqual(Array.from(seed.array), seedBefore);
  rain.userData.rainyWeather = false;
  updateRainyWeatherForScene(scene, 9000); assert.equal(material.uniforms.uTime.value, 0);
  const legacy = new THREE.Points(); legacy.name = 'rain_particles'; scene.add(legacy);
  disposeRainyResources(scene); assert.deepEqual(scene.children, [legacy]);
});

test('Rain is deterministic, present on Low, independent of sky visibility, and scoped to preset id', () => {
  const quality = getEnvironmentQualityProfile('low');
  const first = createRainyWeather(map, quality)!, second = createRainyWeather(map, quality)!;
  assert.equal(first.userData.dropCount, 180);
  assert.deepEqual(first.geometry.getAttribute('aSeed').array, second.geometry.getAttribute('aSeed').array);
  const scene = new THREE.Scene(), sky = new THREE.Mesh(); sky.visible = false; scene.add(sky, first);
  updateRainyWeatherForScene(scene, 1000); assert.equal(first.visible, true);
  assert.equal((first.material as THREE.ShaderMaterial).uniforms.uTime.value, 1);
  assert.equal(createRainyWeather({ ...map, id: 'user_rain_map' }, quality), undefined);
  disposeRainyResources(scene); second.geometry.dispose(); (second.material as THREE.Material).dispose();
});
