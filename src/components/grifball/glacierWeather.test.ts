import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createGlacierWeather, updateGlacierWeatherForScene } from './glacierWeather';
import { disposeGlacierResources } from './glacierResourceDisposal';

const map = PREMADE_MAPS.find(item => item.id === 'winter_glacier_rink')!;

test('Snow stays a single GPU draw on every quality tier with bounded density for both layouts', () => {
  for (const active of [map, toGrifballArena(map)]) {
    const counts: number[] = [];
    for (const tier of ['high', 'balanced', 'low'] as const) {
      const weather = createGlacierWeather(active, getEnvironmentQualityProfile(tier))!;
      assert.ok(weather instanceof THREE.Points); assert.equal(weather.children.length, 0);
      const count = weather.userData.flakeCount; counts.push(count);
      assert.ok(count <= 990); assert.equal(weather.geometry.getAttribute('position').count, count);
      assert.equal(weather.geometry.getAttribute('aSeed').count, count);
      const material = weather.material as THREE.ShaderMaterial;
      assert.equal(material.depthWrite, false); assert.equal(material.depthTest, true);
      assert.equal(material.transparent, true); assert.equal(weather.castShadow, false);
      assert.ok(weather.geometry.boundingBox && weather.geometry.boundingSphere);
      weather.geometry.dispose(); material.dispose();
    }
    assert.ok(counts[1] <= counts[0] * .5); assert.ok(counts[2] < counts[0] * .2);
  }
});

test('Weather update changes only the uniform, preserves vertex buffers, and ignores foreign snow', () => {
  const scene = new THREE.Scene(), snow = createGlacierWeather(map, getEnvironmentQualityProfile('high'))!;
  scene.add(snow);
  const position = snow.geometry.getAttribute('position') as THREE.BufferAttribute;
  const seed = snow.geometry.getAttribute('aSeed');
  const positionBefore = Array.from(position.array), seedBefore = Array.from(seed.array), version = position.version;
  const material = snow.material as THREE.ShaderMaterial;
  updateGlacierWeatherForScene(scene, 12345); assert.equal(material.uniforms.uTime.value, 12.345);
  updateGlacierWeatherForScene(scene, NaN); assert.equal(material.uniforms.uTime.value, 12.345);
  updateGlacierWeatherForScene(scene, Infinity); assert.equal(material.uniforms.uTime.value, 12.345);
  updateGlacierWeatherForScene(scene, -1); assert.equal(material.uniforms.uTime.value, 0);
  assert.equal(snow.geometry.getAttribute('position'), position); assert.equal(position.version, version);
  assert.deepEqual(Array.from(position.array), positionBefore); assert.deepEqual(Array.from(seed.array), seedBefore);
  snow.userData.glacierWeather = false;
  updateGlacierWeatherForScene(scene, 9000); assert.equal(material.uniforms.uTime.value, 0);
  const legacy = new THREE.Points(); legacy.name = 'snow_particles'; scene.add(legacy);
  disposeGlacierResources(scene); assert.deepEqual(scene.children, [legacy]);
});

test('Snow is deterministic, present on Low, independent of sky visibility, and scoped to preset id', () => {
  const quality = getEnvironmentQualityProfile('low');
  const first = createGlacierWeather(map, quality)!, second = createGlacierWeather(map, quality)!;
  assert.equal(first.userData.flakeCount, 100);
  assert.deepEqual(first.geometry.getAttribute('aSeed').array, second.geometry.getAttribute('aSeed').array);
  const scene = new THREE.Scene(), sky = new THREE.Mesh(); sky.visible = false; scene.add(sky, first);
  updateGlacierWeatherForScene(scene, 1000); assert.equal(first.visible, true);
  assert.equal((first.material as THREE.ShaderMaterial).uniforms.uTime.value, 1);
  assert.equal(createGlacierWeather({ ...map, id: 'user_snow_map' }, quality), undefined);
  disposeGlacierResources(scene); second.geometry.dispose(); (second.material as THREE.Material).dispose();
});
