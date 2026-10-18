import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { resolveSkyboxAtmosphereSettings } from '../../game/skyboxTextures';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { createCanyonArchitectureMaterial } from './canyonMaterials';
import { createCanyonSkyMaterial, disposeCanyonEnvironment } from './canyonLighting';
import { disposeCanyonResources } from './canyonResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';

const canyon = PREMADE_MAPS.find(map => map.id === 'forerunner_canyon')!;
const createState = () => createInitialGrifballRuntimeState({
  adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, debugMode: false, isMultiplayer: false, multiplayerRole: null,
});

test('Canyon base integration preserves playable floor dimensions and original prop identifiers without mutating map data', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(canyon);
  for (const tier of ['high', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
    buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: canyon });
    const floor = refs.scene.getObjectByName('canyon_floor') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    assert.ok(floor); assert.equal(floor.position.y, -.1);
    const bounds = new THREE.Box3().setFromObject(floor);
    assert.ok(bounds.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(48, .2, 24)) < 1e-6);
    assert.ok(Math.abs(bounds.max.y) < 1e-7);
    assert.equal(floor.material.name, 'canyon_quiet_composite_floor');
    assert.equal(Boolean(floor.material.normalMap), tier === 'high');
    assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
    assert.equal(refs.customMapObjects!.length, canyon.objects.length);
    assert.deepEqual(canyon.objects.filter(object => object.isCollidable).map(object => object.id),
      ['spire_nw', 'spire_sw', 'spire_ne', 'spire_se', 'spire_cn', 'spire_cs', 'barrier_w', 'barrier_e']);
    for (const object of canyon.objects) {
      const visual = refs.scene.getObjectByName(object.id)!;
      assert.ok(visual); assert.equal(visual.userData.canyonLegacyId, object.id);
      assert.deepEqual(visual.position.toArray(), [object.position.x, object.position.y, object.position.z]);
      assert.deepEqual(visual.rotation.toArray().slice(0, 3), [object.rotation.x, object.rotation.y, object.rotation.z]);
    }
    disposeCanyonResources(refs.scene);
    assert.equal(refs.scene.getObjectByName('canyon_floor'), undefined);
    for (const object of canyon.objects) assert.equal(refs.scene.getObjectByName(object.id), undefined);
  }
  assert.equal(JSON.stringify(canyon), before, 'render integration must not alter collision, spawn, or gameplay map fields');
});

test('Canyon settings preserve the authored sky on unrelated changes and apply live sky controls without replacing its shader', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#9a7c66', .007);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createCanyonSkyMaterial(canyon.skyboxHue, canyon.skyboxBrightness);
  const zenith = material.uniforms.zenithColor.value as THREE.Color;
  const originalZenith = zenith.clone();
  refs.skyboxMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material); refs.scene.add(refs.skyboxMesh);
  const state = createState();
  const changedGameplay = { ...DEFAULT_ADMIN_SETTINGS, maxHP: 222, ambientLightIntensity: .4, directLightIntensity: 1.1 };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: changedGameplay, mainAI: undefined, selectedMap: canyon.id });
  assert.equal(state.playerMaxHP, 222); assert.equal(refs.ambientLight.intensity, .4); assert.equal(refs.dirLight.intensity, 1.1);
  assert.equal(zenith.equals(originalZenith), true, 'unrelated settings keep the map-authored blue zenith');
  assert.equal(material.uniforms.skyExposure.value, 1);
  const changedSky = { ...changedGameplay, skyboxHue: 140, skyboxBrightness: 3.5, showSkybox: false };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: changedSky, mainAI: undefined, selectedMap: canyon.id });
  assert.equal(refs.skyboxMesh.material, material); assert.equal(material.uniforms.zenithColor.value, zenith);
  assert.equal(zenith.equals(originalZenith), false); assert.equal(material.uniforms.skyExposure.value, .5);
  assert.equal(refs.skyboxMesh.visible, false); assert.equal(refs.skyAtmosphere, null);
  assert.equal(refs.scene.fog.color.getHexString(), '9a7c66'); assert.equal(refs.scene.fog.density, .007);
  disposeCanyonEnvironment(refs.scene);
  assert.equal(refs.skyboxMesh.parent, null);
});

test('a user-authored Forerunner map retains its ordinary atmosphere and color settings', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#000000', .016);
  const customMap = { ...canyon, id: 'user_forerunner_arena' };
  const atmosphere = new THREE.Group(); refs.scene.add(atmosphere);
  refs.skyAtmosphere = { group: atmosphere, skyboxTextureId: 'forerunner', settings: resolveSkyboxAtmosphereSettings('forerunner', customMap.atmosphere) };
  const state = createState(); const settings = { ...DEFAULT_ADMIN_SETTINGS, skyboxHue: 180, skyboxBrightness: 6, showSkybox: false };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: settings, mainAI: undefined, selectedMap: customMap.id, customMap });
  assert.equal(refs.skyAtmosphere.group, atmosphere); assert.equal(atmosphere.visible, false);
  assert.equal(refs.scene.fog.color.equals(new THREE.Color('hsl(180, 70%, 6%)')), true);
  assert.equal(refs.scene.fog.density, .016);
});

test('frame glow updates keep authored Canyon accent intensities while preserving legacy pulses', () => {
  const scene = new THREE.Scene();
  const authored = ['cyan', 'warm'].map(role => {
    const source = new THREE.MeshStandardMaterial(); source.name = `canyon_${role}`;
    const material = createCanyonArchitectureMaterial(source, getEnvironmentQualityProfile('high')); source.dispose();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    return { material, intensity: material.emissiveIntensity };
  });
  const legacy = new THREE.MeshStandardMaterial({ emissive: '#00ffff', emissiveIntensity: .5 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), legacy));
  const blinkMaterial = new THREE.MeshBasicMaterial();
  updateEmissiveGlowPulseForScene({ scene, blinkMaterial, elapsed: 0 });
  assert.equal(legacy.emissiveIntensity, 2, 'existing maps retain their pulsing effect');
  for (const { material, intensity } of authored) assert.equal(material.emissiveIntensity, intensity);
  updateEmissiveGlowPulseForScene({ scene, blinkMaterial, elapsed: .5 });
  for (const { material, intensity } of authored) assert.equal(material.emissiveIntensity, intensity);
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
  });
  blinkMaterial.dispose();
});
