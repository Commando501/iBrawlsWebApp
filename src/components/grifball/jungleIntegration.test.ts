import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { createJungleArchitectureMaterial } from './jungleMaterials';
import { createJungleSkyMaterial, disposeJungleEnvironment } from './jungleLighting';
import { disposeJungleResources } from './jungleResourceDisposal';
import { buildJungleSceneryForRefs } from './jungleArchitecture';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount, resolveActiveSpawnPoints } from './arenaSpawns';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';

const jungle = PREMADE_MAPS.find(map => map.id === 'botanical_outpost')!;

test('Jungle retains the circular floor, seven collider objects, eight authored spawns and existing roster scaling at every tier', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(jungle);
  assert.equal(toGrifballArena(jungle), jungle, 'this circular map must not be resized into a Stadium court');
  assert.equal(jungle.arenaRadius, 21);
  assert.equal(jungle.objects.filter(o => o.isCollidable).length, 7);
  assert.deepEqual(jungle.spawnPoints, [
    {x:-14,y:0,z:-8},{x:14,y:0,z:8},{x:-8,y:0,z:14},{x:8,y:0,z:-14},
    {x:-15,y:0,z:0},{x:15,y:0,z:0},{x:0,y:0,z:-15},{x:0,y:0,z:15},
  ]);
  for (const tier of ['high', 'balanced', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
    buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: jungle });
    const pending = buildJungleSceneryForRefs({ refs, activeCustomMap: jungle, quality,
      load: () => new Promise(() => {}), materialFactory: material => material.clone() })!;
    const floor = refs.scene.getObjectByName('jungle_floor') as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    assert.ok(floor); assert.equal(floor.geometry.parameters.radiusTop, 21);
    assert.equal(floor.geometry.parameters.height, .2); assert.equal(floor.position.y, -.1);
    assert.equal(Boolean(floor.material.normalMap), tier !== 'low');
    assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
    assert.equal(refs.customMapObjects!.length, 8, 'seven retained legacy references plus scenery');
    assert.equal(refs.scene.getObjectsByProperty('isPointLight', true).length, 0, 'baked broad bounce replaces three legacy local lights');
    for (const object of jungle.objects) {
      const visual = refs.scene.getObjectByName(object.id)!;
      assert.ok(visual); assert.equal(visual.userData.jungleLegacyId, object.id);
      assert.deepEqual(visual.position.toArray(), [object.position.x,object.position.y,object.position.z]);
      assert.deepEqual(visual.rotation.toArray().slice(0,3), [object.rotation.x,object.rotation.y,object.rotation.z]);
      const geometry = (visual.children[0] as THREE.Mesh).geometry; geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox!.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-6,
        'local geometry retains collision dimensions; world AABBs legitimately expand for authored yaw');
    }
    const fallbackSpawns = createDefaultSpawnPoints();
    for (const [count, radius] of [[1,20],[8,27.5],[10,30],[1,20]]) {
      assert.equal(resizeArenaSceneForPlayerCount(refs.scene, fallbackSpawns, count).arenaRadius, radius);
      assert.equal(floor.scale.x * floor.geometry.parameters.radiusTop, 21 * radius / 20);
      assert.equal(refs.scene.getObjectByName('jungle_scenery')!.userData.arenaRadius, 21 * radius / 20);
      assert.deepEqual(resolveActiveSpawnPoints(jungle, fallbackSpawns).map(p => p.toArray()), jungle.spawnPoints!.map(p => [p.x,p.y,p.z]));
      for (const object of jungle.objects) assert.deepEqual(refs.scene.getObjectByName(object.id)!.position.toArray(), [object.position.x,object.position.y,object.position.z]);
    }
    pending.cancel();
    disposeJungleResources(refs.scene);
    assert.equal(refs.scene.getObjectByName('jungle_floor'), undefined);
    for (const object of jungle.objects) assert.equal(refs.scene.getObjectByName(object.id), undefined);
  }
  assert.equal(JSON.stringify(jungle), before, 'rendering never mutates map or movement data');
});

test('Jungle owns its atmosphere while preserving live lighting and sky controls', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#7e9187', .009);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createJungleSkyMaterial(jungle.skyboxHue, jungle.skyboxBrightness);
  const initial = JSON.stringify(material.uniforms);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1,8,6), material); sky.name = 'skybox_mesh'; sky.userData.jungleOwnedSky = true;
  refs.skyboxMesh = sky; refs.scene.add(sky);
  const state = createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
  const lighting = {...DEFAULT_ADMIN_SETTINGS, directLightIntensity:1.3,ambientLightIntensity:.6};
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,selectedMap:jungle.id});
  assert.equal(refs.dirLight.intensity,1.3); assert.equal(refs.ambientLight.intensity,.6);
  assert.equal(JSON.stringify(material.uniforms),initial);
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:130,skyboxBrightness:8,showSkybox:false},mainAI:undefined,selectedMap:jungle.id});
  assert.equal(refs.skyboxMesh.material,material); assert.notEqual(JSON.stringify(material.uniforms),initial);
  assert.equal(sky.visible,false); assert.equal(refs.skyAtmosphere,null);
  assert.equal(refs.scene.fog.color.getHexString(),'7e9187'); assert.equal(refs.scene.fog.density,.009);
  disposeJungleEnvironment(refs.scene); assert.equal(sky.parent,null);
});

test('gameplay glow pulses leave Jungle relic and foliage emission stable', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const scene = new THREE.Scene();
  for (const role of ['jungle_jade','jungle_leaf','jungle_ceramic']) {
    const source = new THREE.MeshStandardMaterial(); source.name = role;
    const material = createJungleArchitectureMaterial(source,getEnvironmentQualityProfile('high')); source.dispose();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
    const intensity = material.emissiveIntensity;
    updateEmissiveGlowPulseForScene({scene,blinkMaterial:new THREE.MeshBasicMaterial(),elapsed:.5});
    assert.equal(material.emissiveIntensity,intensity);
    mesh.geometry.dispose(); material.dispose();
  }
});

test('Jungle attachment and cleanup do not alter another upgraded arena or user nature maps', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.userData.environmentQuality = getEnvironmentQualityProfile('low');
  const cyber = PREMADE_MAPS.find(map => map.id === 'cyber_hex_arena')!;
  buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: cyber });
  const before = refs.scene.children.slice(), references = refs.customMapObjects!.slice();
  let loads = 0;
  for (const foreign of [cyber, { ...jungle, id: 'my_nature_outpost' }]) {
    assert.equal(buildJungleSceneryForRefs({ refs, activeCustomMap: foreign,
      load: async () => { loads++; return new THREE.Group(); } }), undefined);
  }
  disposeJungleResources(refs.scene); disposeJungleEnvironment(refs.scene);
  assert.equal(loads, 0); assert.deepEqual(refs.scene.children, before);
  assert.deepEqual(refs.customMapObjects, references);
  assert.ok(refs.scene.getObjectByName('cyber_floor'));
  disposeCyberResources(refs.scene);
});

