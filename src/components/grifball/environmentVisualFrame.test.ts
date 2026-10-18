import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  updateEmissiveGlowPulseForScene,
  updateEnvironmentVisualFrameForScene,
  updateWeatherParticlesForScene,
  type WeatherParticleFrameState,
} from './visualState';

function gpuWeather(kind: 'rain' | 'snow') {
  const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } } });
  const object = kind === 'rain'
    ? new THREE.LineSegments(new THREE.BufferGeometry(), material)
    : new THREE.Points(new THREE.BufferGeometry(), material);
  object.name = kind === 'rain' ? 'rainy_weather' : 'glacier_weather';
  object.userData[kind === 'rain' ? 'rainyWeather' : 'glacierWeather'] = true;
  return object;
}

function legacyWeather(kind: 'rain' | 'snow') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([2, 10, 3], 3));
  const object = new THREE.Points(geometry, new THREE.PointsMaterial());
  object.name = `${kind}_particles`;
  object.userData.velocities = [new THREE.Vector3(1, -2, .5)];
  return object;
}

function glowMaterial() {
  return new THREE.MeshStandardMaterial({ emissive: '#28aaff', emissiveIntensity: .3 });
}

test('Shared frame walks a large dynamic scene once and writes a shared glow material once', t => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = glowMaterial();
  const ignored = glowMaterial(); ignored.userData.preserveEmissiveIntensity = true;
  for (let i = 0; i < 250; i++) {
    const branch = new THREE.Group();
    branch.add(new THREE.Mesh(geometry, i % 2 ? [material, material] : ignored));
    scene.add(branch);
  }
  let writes = 0, intensity = material.emissiveIntensity, visits = 0;
  Object.defineProperty(material, 'emissiveIntensity', {
    configurable: true,
    get: () => intensity,
    set: (value: number) => { writes++; intensity = value; },
  });
  const objects: THREE.Object3D[] = []; scene.traverse(object => objects.push(object));
  for (const object of objects) {
    const original = object.traverse;
    t.mock.method(object, 'traverse', function (this: THREE.Object3D, callback: (object: THREE.Object3D) => void) {
      visits++;
      original.call(this, callback);
    });
  }
  t.mock.method(scene, 'getObjectByName', () => { throw new Error('Unexpected recursive name search'); });
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 0 });
  assert.equal(visits, objects.length);
  assert.equal(writes, 1);
  assert.equal(intensity, 2);
  assert.equal(ignored.emissiveIntensity, .3);
  geometry.dispose(); material.dispose(); ignored.dispose();
});

test('Shared glow observes late subtrees, removal, reparenting, material swaps and live flags', () => {
  const scene = new THREE.Scene(), foreignScene = new THREE.Scene();
  const initial = glowMaterial(), changed = glowMaterial(), blink = glowMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), initial);
  const branch = new THREE.Group(); scene.add(branch);
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 0 });
  branch.add(mesh);
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 0 });
  assert.equal(initial.emissiveIntensity, 2);
  mesh.material = changed;
  changed.userData.preserveEmissiveIntensity = true;
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 500 });
  assert.equal(changed.emissiveIntensity, .3);
  changed.userData.preserveEmissiveIntensity = false;
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 0 });
  assert.equal(changed.emissiveIntensity, 2);
  changed.emissive.set(0); changed.emissiveIntensity = .4;
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 1000 });
  assert.equal(changed.emissiveIntensity, .4);
  changed.emissive.set('#28aaff'); foreignScene.add(branch);
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 0 });
  assert.equal(changed.emissiveIntensity, .4);
  scene.add(branch); mesh.material = blink;
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 0, blinkMaterial: blink });
  assert.equal(blink.emissiveIntensity, .3);
  updateEmissiveGlowPulseForScene({ scene, elapsed: 0 });
  assert.equal(blink.emissiveIntensity, 2);
  mesh.geometry.dispose(); [initial, changed, blink].forEach(material => material.dispose());
});

test('Shared weather keeps nested GPU and legacy systems running with original delta clamp', () => {
  const scene = new THREE.Scene(), branch = new THREE.Group();
  const rain = gpuWeather('rain'), snow = gpuWeather('snow');
  const legacyRain = legacyWeather('rain'), legacySnow = legacyWeather('snow');
  branch.add(rain, snow, legacyRain, legacySnow); scene.add(branch);
  const frameState: WeatherParticleFrameState = {};
  updateEnvironmentVisualFrameForScene({ scene, frameState, now: 1000 });
  updateEnvironmentVisualFrameForScene({ scene, frameState, now: 1200 });
  assert.equal(rain.material.uniforms.uTime.value, 1.2);
  assert.equal(snow.material.uniforms.uTime.value, 1.2);
  for (const object of [legacyRain, legacySnow]) {
    const position = object.geometry.getAttribute('position');
    assert.ok(Math.abs(position.getX(0) - 2.1) < 1e-6);
    assert.ok(Math.abs(position.getY(0) - 9.8) < 1e-6);
    assert.ok(Math.abs(position.getZ(0) - 3.05) < 1e-6);
    assert.equal((position as THREE.BufferAttribute).version, 2);
  }
  for (const object of [rain, snow, legacyRain, legacySnow]) { object.geometry.dispose(); object.material.dispose(); }
});

test('Weather lookup preserves first named object, live renaming, replacement and detached subtrees', () => {
  const scene = new THREE.Scene(), branch = new THREE.Group();
  const blocker = new THREE.Group(); blocker.name = 'rainy_weather';
  const rain = gpuWeather('rain'), replacement = gpuWeather('rain');
  branch.add(rain); scene.add(blocker, branch);
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 1000 });
  assert.equal(rain.material.uniforms.uTime.value, 0);
  blocker.name = 'ordinary_group';
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 2000 });
  assert.equal(rain.material.uniforms.uTime.value, 2);
  rain.name = 'disabled_rain'; branch.add(replacement);
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 3000 });
  assert.equal(rain.material.uniforms.uTime.value, 2);
  assert.equal(replacement.material.uniforms.uTime.value, 3);
  scene.remove(branch);
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 4000 });
  assert.equal(replacement.material.uniforms.uTime.value, 3);
  scene.add(branch);
  updateWeatherParticlesForScene({ scene, frameState: {}, now: 5000 });
  assert.equal(replacement.material.uniforms.uTime.value, 5);
  for (const object of [rain, replacement]) { object.geometry.dispose(); object.material.dispose(); }
});

test('Shared frame retains glow then atmosphere then weather ordering', () => {
  const scene = new THREE.Scene(), material = glowMaterial(), rain = gpuWeather('rain');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh, rain);
  let atmosphereCalls = 0;
  updateEnvironmentVisualFrameForScene({ scene, frameState: {}, now: 1000, updateAtmosphere: () => {
    atmosphereCalls++;
    assert.equal(material.emissiveIntensity, 2 + Math.sin(4) * .8);
    assert.equal(rain.material.uniforms.uTime.value, 0);
  } });
  assert.equal(atmosphereCalls, 1);
  assert.equal(rain.material.uniforms.uTime.value, 1);
  mesh.geometry.dispose(); material.dispose(); rain.geometry.dispose(); rain.material.dispose();
});
