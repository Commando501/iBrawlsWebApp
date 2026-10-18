import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { getSkyboxTexture } from '../../game/skyboxTextures';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount } from './arenaSpawns';
import { buildHangarBaseArenaForRefs } from './hangarArenaRuntime';
import { buildHangarSceneryForRefs, HANGAR_ARCHITECTURE_PARTS } from './hangarArchitecture';
import { createHangarArchitectureMaterial } from './hangarMaterials';
import { disposeHangarObjectResources, disposeHangarResources } from './hangarResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';

function mockImages(t: TestContext) {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
}
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
function sourceKit() {
  const group = new THREE.Group();
  for (const part of HANGAR_ARCHITECTURE_PARTS) {
    const root = new THREE.Group(); root.name = part;
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'hangar_alloy' })));
    group.add(root);
  }
  return group;
}

test('Hangar integration preserves the original 40m circular floor with a 0m surface at each quality', t => {
  mockImages(t);
  const originalSettings = JSON.stringify(DEFAULT_ADMIN_SETTINGS);
  for (const tier of ['high', 'balanced', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
    buildHangarBaseArenaForRefs({ refs, adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, quality });
    const floor = refs.scene.getObjectByName('hangar_floor') as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    assert.ok(floor.geometry instanceof THREE.CylinderGeometry);
    assert.equal(floor.geometry.parameters.radiusTop, 20); assert.equal(floor.geometry.parameters.radiusBottom, 20);
    assert.equal(floor.geometry.parameters.height, .2); assert.equal(floor.geometry.parameters.radialSegments, 64);
    const bounds = new THREE.Box3().setFromObject(floor);
    assert.ok(bounds.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(40, .2, 40)) < 1e-6);
    assert.ok(Math.abs(bounds.max.y) < 1e-7);
    assert.equal(floor.receiveShadow, true);
    assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
    assert.equal(refs.dirLight!.intensity, DEFAULT_ADMIN_SETTINGS.directLightIntensity);
    assert.equal(refs.ambientLight!.intensity, DEFAULT_ADMIN_SETTINGS.ambientLightIntensity);
    assert.deepEqual(refs.customMapObjects, [], 'render construction adds no collision objects');
    disposeHangarResources(refs.scene);
    assert.equal(refs.scene.getObjectByName('hangar_floor'), undefined);
    assert.equal(refs.scene.getObjectByName('hangar_fill'), undefined);
  }
  assert.equal(JSON.stringify(DEFAULT_ADMIN_SETTINGS), originalSettings, 'movement and gameplay tuning stay untouched');
});

test('existing roster-size radius and eight spawn slots remain unchanged through expansion and contraction', t => {
  mockImages(t);
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const quality = getEnvironmentQualityProfile('low'); refs.scene.userData.environmentQuality = quality;
  buildHangarBaseArenaForRefs({ refs, adminSettings: DEFAULT_ADMIN_SETTINGS, quality });
  const handle = buildHangarSceneryForRefs({ refs, quality, load: () => new Promise(() => {}) })!;
  const spawns = createDefaultSpawnPoints();
  const floor = refs.scene.getObjectByName('hangar_floor') as THREE.Mesh;
  const shell = refs.scene.getObjectByName('hangar_scenery')!;
  const roof = refs.scene.getObjectByName('hangar_ceiling')!;
  const expected = [[1, 1], [2, 1], [3, 1.125], [4, 1.125], [5, 1.25], [6, 1.25], [7, 1.375], [8, 1.375], [9, 1.5], [16, 1.5], [2, 1]];
  for (const [count, scale] of expected) {
    assert.deepEqual(resizeArenaSceneForPlayerCount(refs.scene, spawns, count), { scale, arenaRadius: 20 * scale });
    assert.deepEqual(floor.scale.toArray(), [scale, 1, scale]);
    assert.deepEqual(roof.scale.toArray(), [scale, 1, scale]);
    assert.equal(shell.userData.arenaRadius, 20 * scale);
    assert.equal(spawns.length, 8);
    for (const [index, spawn] of spawns.entries()) {
      const angle = index * Math.PI / 4;
      assert.ok(spawn.distanceTo(new THREE.Vector3(13 * scale * Math.cos(angle), 0, 13 * scale * Math.sin(angle))) < 1e-9);
    }
    const key = refs.dirLight!;
    key.updateMatrixWorld(true); key.target.updateMatrixWorld(true); key.shadow.updateMatrices(key);
    for (const x of [-20, 20]) for (const z of [-20, 20]) {
      assert.ok(new THREE.Vector3(x * scale, 0, z * scale).project(key.shadow.camera).toArray().every(value => value >= -1 && value <= 1));
    }
  }
  handle.cancel(); disposeHangarResources(refs.scene);
});

test('a roster update while the kit downloads survives asynchronous replacement without moving the floor or spawns', async t => {
  mockImages(t);
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const quality = getEnvironmentQualityProfile('high'); refs.scene.userData.environmentQuality = quality;
  buildHangarBaseArenaForRefs({ refs, adminSettings: DEFAULT_ADMIN_SETTINGS, quality });
  let complete!: (source: THREE.Group) => void;
  const source = sourceKit();
  const handle = buildHangarSceneryForRefs({ refs, quality, load: () => new Promise(resolve => { complete = resolve; }) })!;
  await Promise.resolve();
  const spawns = createDefaultSpawnPoints();
  resizeArenaSceneForPlayerCount(refs.scene, spawns, 8);
  const savedSpawns = spawns.map(spawn => spawn.toArray());
  complete(source); await handle.ready;
  const shell = refs.scene.getObjectByName('hangar_scenery')!;
  assert.equal(shell.userData.architectureStatus, 'ready'); assert.equal(shell.userData.arenaRadius, 27.5);
  assert.equal(refs.scene.getObjectByName('hangar_fallback_architecture'), undefined);
  const wall = shell.getObjectByProperty('name', 'hangar_blender_architecture')!.children.find(object => object.userData.hangarPart === 'wall-bay') as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(); wall.getMatrixAt(0, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.abs(Math.hypot(position.x, position.z) - 20.6 * 1.375) < 1e-5);
  const floor = refs.scene.getObjectByName('hangar_floor')!;
  const bounds = new THREE.Box3().setFromObject(floor);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - 55) < 1e-6);
  assert.ok(Math.abs(bounds.max.y) < 1e-7);
  assert.deepEqual(spawns.map(spawn => spawn.toArray()), savedSpawns);
  assert.deepEqual(refs.customMapObjects, []);
  disposeHangarResources(refs.scene); disposeHangarObjectResources([source]);
});

test('Hangar sky survives unrelated settings; explicit controls update it without resurrecting the old atmosphere', t => {
  mockCanvas(t);
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.background = new THREE.Color('#101923'); refs.scene.fog = new THREE.FogExp2('#101923', .012);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight('#e5eef7');
  const map = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map });
  refs.skyboxMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material); refs.scene.add(refs.skyboxMesh);
  const state = createInitialGrifballRuntimeState({ adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, debugMode: false, isMultiplayer: false, multiplayerRole: null });
  const gameplay = { ...DEFAULT_ADMIN_SETTINGS, maxHP: 222, directLightIntensity: 1.1, ambientLightIntensity: .4 };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: gameplay, mainAI: undefined, selectedMap: 'hangar' });
  assert.equal(state.playerMaxHP, 222); assert.equal(refs.dirLight.intensity, 1.1); assert.equal(refs.ambientLight.intensity, .4);
  assert.equal(material.map, map); assert.equal(refs.scene.background.getHexString(), '101923');
  assert.equal(refs.scene.fog.color.getHexString(), '101923'); assert.equal(refs.scene.fog.density, .012);
  assert.equal(refs.dirLight.color.getHexString(), 'e5eef7'); assert.equal(refs.skyAtmosphere, null);
  const sky = { ...gameplay, skyboxHue: 151, skyboxBrightness: 3.5, showSkybox: false };
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: sky, mainAI: undefined, selectedMap: 'hangar' });
  assert.equal(refs.skyboxMesh.material, material); assert.notEqual(material.map, map);
  assert.equal(material.map, getSkyboxTexture('hangar', 151, 3.5, 'hsl(151, 70%, 3.5%)'));
  assert.equal(refs.skyboxMesh.visible, false); assert.equal(refs.skyAtmosphere, null);
  const selectedSky = material.map;
  syncAdminSettingsVisualStateForState({ state, refs, adminSettings: { ...sky, showSkybox: true, maxHP: 333 }, mainAI: undefined, selectedMap: 'hangar' });
  assert.equal(refs.skyboxMesh.visible, true); assert.equal(material.map, selectedSky);
  assert.equal(refs.scene.fog.density, .012); assert.equal(refs.skyAtmosphere, null);
  refs.skyboxMesh.geometry.dispose(); material.dispose(); map.dispose();
});

test('real Hangar fixture materials retain their intensity under gameplay glow pulses', () => {
  const scene = new THREE.Scene();
  const authored = ['amber', 'light'].map(role => {
    const source = new THREE.MeshStandardMaterial({ name: `hangar_${role}` });
    const material = createHangarArchitectureMaterial(source, getEnvironmentQualityProfile('high')); source.dispose();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    return { material, intensity: material.emissiveIntensity };
  });
  const legacy = new THREE.MeshStandardMaterial({ emissive: '#00ffff', emissiveIntensity: .5 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), legacy));
  updateEmissiveGlowPulseForScene({ scene, elapsed: 0 });
  assert.equal(legacy.emissiveIntensity, 2);
  for (const { material, intensity } of authored) assert.equal(material.emissiveIntensity, intensity);
  updateEmissiveGlowPulseForScene({ scene, elapsed: .5 });
  for (const { material, intensity } of authored) assert.equal(material.emissiveIntensity, intensity);
  disposeHangarObjectResources(scene.children.slice());
});
