import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { createAsteroidArchitectureMaterial } from './asteroidMaterials';
import { createAsteroidSkyMaterial, disposeAsteroidEnvironment } from './asteroidLighting';
import { disposeAsteroidResources } from './asteroidResourceDisposal';
import { buildAsteroidSceneryForRefs } from './asteroidArchitecture';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount, resolveActiveSpawnPoints } from './arenaSpawns';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';

const asteroid = PREMADE_MAPS.find(map => map.id === 'vanguard_starbase')!;

test('Asteroid retains the circular floor, seven collider objects, eight authored spawns and existing roster scaling at every tier', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(asteroid);
  assert.equal(toGrifballArena(asteroid), asteroid, 'this circular map must not be resized into a Stadium court');
  assert.equal(asteroid.arenaRadius, 19);
  assert.equal(asteroid.objects.filter(o => o.isCollidable).length, 7);
  assert.deepEqual(asteroid.spawnPoints, [
    {x:-10,y:0,z:-10},{x:10,y:0,z:10},{x:-10,y:0,z:10},{x:10,y:0,z:-10},
    {x:-13,y:0,z:0},{x:13,y:0,z:0},{x:0,y:0,z:-13},{x:0,y:0,z:13},
  ]);
  for (const tier of ['high', 'balanced', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
    buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: asteroid });
    const pending = buildAsteroidSceneryForRefs({ refs, activeCustomMap: asteroid, quality,
      load: () => new Promise(() => {}), materialFactory: material => material.clone() })!;
    const floor = refs.scene.getObjectByName('asteroid_floor') as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    assert.ok(floor); assert.equal(floor.geometry.parameters.radiusTop, 19);
    assert.equal(floor.geometry.parameters.height, .2); assert.equal(floor.position.y, -.1);
    assert.equal(Boolean(floor.material.normalMap), tier !== 'low');
    assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
    assert.equal(refs.customMapObjects!.length, 8, 'seven retained legacy references plus scenery');
    assert.equal(refs.scene.getObjectsByProperty('isPointLight', true).length, 0, 'broad bounce replaces two legacy local lights');
    for (const object of asteroid.objects) {
      const visual = refs.scene.getObjectByName(object.id)!;
      assert.ok(visual); assert.equal(visual.userData.asteroidLegacyId, object.id);
      assert.deepEqual(visual.position.toArray(), [object.position.x,object.position.y,object.position.z]);
      assert.deepEqual(visual.rotation.toArray().slice(0,3), [object.rotation.x,object.rotation.y,object.rotation.z]);
      const geometry = (visual.children[0] as THREE.Mesh).geometry; geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox!.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-6,
        'local geometry retains collision dimensions; world AABBs legitimately expand for authored yaw');
    }
    const fallbackSpawns = createDefaultSpawnPoints();
    for (const [count, radius] of [[1,20],[8,27.5],[10,30],[1,20]]) {
      assert.equal(resizeArenaSceneForPlayerCount(refs.scene, fallbackSpawns, count).arenaRadius, radius);
      assert.equal(floor.scale.x * floor.geometry.parameters.radiusTop, 19 * radius / 20);
      assert.equal(refs.scene.getObjectByName('asteroid_scenery')!.userData.arenaRadius, 19 * radius / 20);
      assert.deepEqual(resolveActiveSpawnPoints(asteroid, fallbackSpawns).map(p => p.toArray()), asteroid.spawnPoints!.map(p => [p.x,p.y,p.z]));
      for (const object of asteroid.objects) assert.deepEqual(refs.scene.getObjectByName(object.id)!.position.toArray(), [object.position.x,object.position.y,object.position.z]);
    }
    pending.cancel();
    disposeAsteroidResources(refs.scene);
    assert.equal(refs.scene.getObjectByName('asteroid_floor'), undefined);
    for (const object of asteroid.objects) assert.equal(refs.scene.getObjectByName(object.id), undefined);
  }
  assert.equal(JSON.stringify(asteroid), before, 'rendering never mutates map or movement data');
});

test('Asteroid owns its atmosphere while preserving live lighting and sky controls', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#101824', .006);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createAsteroidSkyMaterial(asteroid.skyboxHue, asteroid.skyboxBrightness);
  const initial = JSON.stringify(material.uniforms);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1,8,6), material); sky.name = 'skybox_mesh'; sky.userData.asteroidOwnedSky = true;
  refs.skyboxMesh = sky; refs.scene.add(sky);
  const state = createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
  const lighting = {...DEFAULT_ADMIN_SETTINGS, directLightIntensity:1.3,ambientLightIntensity:.6};
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,selectedMap:asteroid.id});
  assert.equal(refs.dirLight.intensity,1.3); assert.equal(refs.ambientLight.intensity,.6);
  assert.equal(JSON.stringify(material.uniforms),initial);
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:220,skyboxBrightness:5,showSkybox:false},mainAI:undefined,selectedMap:asteroid.id});
  assert.equal(refs.skyboxMesh.material,material); assert.notEqual(JSON.stringify(material.uniforms),initial);
  assert.equal(sky.visible,false); assert.equal(refs.skyAtmosphere,null);
  assert.equal(refs.scene.fog.color.getHexString(),'101824'); assert.equal(refs.scene.fog.density,.006);
  disposeAsteroidEnvironment(refs.scene); assert.equal(sky.parent,null);
});

test('gameplay glow pulses leave Asteroid ore and floodlight emission stable', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const scene = new THREE.Scene();
  for (const role of ['asteroid_ore','asteroid_amber','asteroid_ceramic']) {
    const source = new THREE.MeshStandardMaterial(); source.name = role;
    const material = createAsteroidArchitectureMaterial(source,getEnvironmentQualityProfile('high')); source.dispose();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
    const intensity = material.emissiveIntensity;
    updateEmissiveGlowPulseForScene({scene,blinkMaterial:new THREE.MeshBasicMaterial(),elapsed:.5});
    assert.equal(material.emissiveIntensity,intensity);
    mesh.geometry.dispose(); material.dispose();
  }
});

test('Asteroid attachment and cleanup do not alter another upgraded arena or user space maps', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.userData.environmentQuality = getEnvironmentQualityProfile('low');
  const cyber = PREMADE_MAPS.find(map => map.id === 'cyber_hex_arena')!;
  buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: cyber });
  const before = refs.scene.children.slice(), references = refs.customMapObjects!.slice();
  let loads = 0;
  for (const foreign of [cyber, { ...asteroid, id: 'my_space_outpost' }]) {
    assert.equal(buildAsteroidSceneryForRefs({ refs, activeCustomMap: foreign,
      load: async () => { loads++; return new THREE.Group(); } }), undefined);
  }
  disposeAsteroidResources(refs.scene); disposeAsteroidEnvironment(refs.scene);
  assert.equal(loads, 0); assert.deepEqual(refs.scene.children, before);
  assert.deepEqual(refs.customMapObjects, references);
  assert.ok(refs.scene.getObjectByName('cyber_floor'));
  disposeCyberResources(refs.scene);
});


