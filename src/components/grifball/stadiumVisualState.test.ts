import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { getSkyboxTexture, resolveSkyboxAtmosphereSettings, resolveSkyboxTextureId } from '../../game/skyboxTextures';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import type { CustomMapData, ReplayFile } from '../../types';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { disposeSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import { syncStadiumVisualStateForRefs } from './stadiumVisualState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { syncAdminSettingsVisualStateForState } from './visualState';

const stadium = PREMADE_MAPS.find(map => map.id === 'championship_stadium')!;

function mockCanvas(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => {
      const context = new Proxy<Record<string, unknown>>({
        createLinearGradient: () => gradient, createRadialGradient: () => gradient,
      }, { get: (target, key) => target[key as string] ?? (() => {}), set: (target, key, value) => { target[key as string] = value; return true; } });
      return { width: 0, height: 0, getContext: (type: string) => type === '2d' ? context : null };
    } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}

function harness(t: TestContext, map: CustomMapData = stadium) {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  refs.scene.background = new THREE.Color(map.fogColor ?? '#030712');
  refs.scene.fog = new THREE.FogExp2(map.fogColor ?? '#030712', map.fogDensity);
  refs.ambientLight = new THREE.AmbientLight();
  refs.dirLight = new THREE.DirectionalLight('#e4edff');
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  refs.skyboxMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material);
  refs.scene.add(refs.skyboxMesh);
  const atmosphere = new THREE.Group();
  refs.scene.add(atmosphere);
  const skyType = resolveSkyboxTextureId(map.skyboxTexture === 'matched' ? map.theme : map.skyboxTexture ?? map.theme);
  refs.skyAtmosphere = { group: atmosphere, skyboxTextureId: skyType, settings: resolveSkyboxAtmosphereSettings(skyType, map.atmosphere) };
  const state = createInitialGrifballRuntimeState({ adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, debugMode: false, isMultiplayer: false, multiplayerRole: null });
  t.after(() => {
    refs.skyboxMesh!.geometry.dispose(); material.dispose(); texture.dispose();
    disposeSkyAtmosphereForRefs(refs);
  });
  return { refs, state, texture, material, atmosphere };
}

test('Stadium gameplay and lighting adjustments preserve its authored sky, fog and atmosphere', t => {
  const { refs, state, texture, material, atmosphere } = harness(t);
  const settings = { ...DEFAULT_ADMIN_SETTINGS, maxHP: 222, directLightIntensity: 1.1, ambientLightIntensity: .4 };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: settings, mainAI: undefined, selectedMap: stadium.id });
  assert.equal(state.playerMaxHP, 222);
  assert.equal(refs.dirLight!.intensity, 1.1);
  assert.equal(refs.ambientLight!.intensity, .4);
  assert.equal(material.map, texture);
  assert.equal((refs.scene!.background as THREE.Color).getHexString(), '0b0c10');
  assert.equal(refs.scene!.fog!.color.getHexString(), '0b0c10');
  assert.equal((refs.scene!.fog as THREE.FogExp2).density, stadium.fogDensity);
  assert.equal(refs.skyAtmosphere!.group, atmosphere);
  assert.equal(refs.dirLight!.color.getHexString(), 'e4edff');
});

test('Stadium explicit sky controls still update colors; visibility changes preserve the chosen backdrop', t => {
  mockCanvas(t);
  const { refs, state, material, atmosphere } = harness(t);
  const settings = { ...DEFAULT_ADMIN_SETTINGS, skyboxHue: 151, skyboxBrightness: 3.5, showSkybox: false };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: settings, mainAI: undefined, selectedMap: stadium.id });
  const chosenTexture = getSkyboxTexture('grifball_stadium', 151, 3.5, 'hsl(151, 70%, 3.5%)');
  assert.equal(material.map, chosenTexture);
  assert.equal(refs.skyboxMesh!.visible, false);
  assert.equal(atmosphere.visible, false);
  const chosenFog = refs.scene!.fog!.color.clone();
  assert.equal(chosenFog.equals(new THREE.Color('hsl(151, 70%, 3.5%)')), true);
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: { ...settings, maxHP: 333, showSkybox: true }, mainAI: undefined, selectedMap: stadium.id });
  assert.equal(material.map, chosenTexture);
  assert.equal(refs.scene!.fog!.color.equals(chosenFog), true);
  assert.equal(refs.skyboxMesh!.visible, true);
  assert.equal(atmosphere.visible, true);
  assert.equal((refs.scene!.fog as THREE.FogExp2).density, stadium.fogDensity);
});

test('replay Stadium receives the same stability regardless of the menu map selection', t => {
  const { refs, state, material, texture } = harness(t);
  syncAdminSettingsVisualStateForState({
    state, refs, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, ambientLightIntensity: .3 }, mainAI: undefined,
    selectedMap: 'circle', replayData: { mapType: stadium.id } as ReplayFile,
  });
  assert.equal(material.map, texture);
  assert.equal(refs.scene!.fog!.color.getHexString(), '0b0c10');
});

test('user-authored Stadium themes preserve their own fog and support explicit sky type changes', t => {
  mockCanvas(t);
  const map = { ...stadium, id: 'user_stadium', fogColor: '#364456', skyboxTexture: 'matched' };
  const { refs, state, texture, material } = harness(t, map);
  const settings = { ...DEFAULT_ADMIN_SETTINGS, ambientLightIntensity: .3 };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: settings, mainAI: undefined, selectedMap: map.id, customMap: map });
  assert.equal(material.map, texture);
  assert.equal(refs.scene!.fog!.color.getHexString(), '364456');
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: settings, mainAI: undefined, selectedMap: map.id, customMap: { ...map, skyboxTexture: 'space' } });
  assert.equal(refs.skyAtmosphere!.skyboxTextureId, 'space');
  assert.equal(material.map, getSkyboxTexture('space', settings.skyboxHue!, settings.skyboxBrightness!, `hsl(${settings.skyboxHue}, 70%, ${settings.skyboxBrightness}%)`));
  assert.equal(refs.scene!.fog!.color.getHexString(), '364456');
});

test('the Stadium helper leaves other themes and absent scenes untouched', t => {
  const { refs, material, texture } = harness(t);
  const args = { refs, adminSettings: DEFAULT_ADMIN_SETTINGS, skyControlsChanged: true };
  assert.equal(syncStadiumVisualStateForRefs({ ...args, activeCustomMap: { ...stadium, theme: 'space' } }), false);
  assert.equal(syncStadiumVisualStateForRefs({ ...args, activeCustomMap: null }), false);
  assert.equal(material.map, texture);
  assert.equal(refs.scene!.fog!.color.getHexString(), '0b0c10');
  assert.equal(syncStadiumVisualStateForRefs({ ...args, refs: { ...refs, scene: null }, activeCustomMap: stadium }), false);
});
