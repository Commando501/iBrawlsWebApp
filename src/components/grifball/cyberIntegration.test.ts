import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { createCyberArchitectureMaterial } from './cyberMaterials';
import { createCyberSkyMaterial, disposeCyberEnvironment } from './cyberLighting';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount, resolveActiveSpawnPoints } from './arenaSpawns';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';

const cyber = PREMADE_MAPS.find(map => map.id === 'cyber_hex_arena')!;

test('Cyber retains the circular floor, nine collider objects, eight authored spawns and existing roster scaling at every tier', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(cyber);
  assert.equal(toGrifballArena(cyber), cyber, 'this circular map must not be resized into a Stadium court');
  assert.equal(cyber.arenaRadius, 20);
  assert.equal(cyber.objects.filter(o => o.isCollidable).length, 9);
  assert.deepEqual(cyber.spawnPoints, [
    {x:-12,y:0,z:-12},{x:12,y:0,z:12},{x:-12,y:0,z:12},{x:12,y:0,z:-12},
    {x:0,y:0,z:-14},{x:0,y:0,z:14},{x:-14,y:0,z:0},{x:14,y:0,z:0},
  ]);
  for (const tier of ['high', 'balanced', 'low'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
    buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: cyber });
    const floor = refs.scene.getObjectByName('cyber_floor') as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    assert.ok(floor); assert.equal(floor.geometry.parameters.radiusTop, 20);
    assert.equal(floor.geometry.parameters.height, .2); assert.equal(floor.position.y, -.1);
    assert.equal(Boolean(floor.material.normalMap), tier !== 'low');
    assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
    assert.equal(refs.customMapObjects!.length, 9);
    for (const object of cyber.objects) {
      const visual = refs.scene.getObjectByName(object.id)!;
      assert.ok(visual); assert.equal(visual.userData.cyberLegacyId, object.id);
      assert.deepEqual(visual.position.toArray(), [object.position.x,object.position.y,object.position.z]);
      assert.deepEqual(visual.rotation.toArray().slice(0,3), [object.rotation.x,object.rotation.y,object.rotation.z]);
      assert.ok(new THREE.Box3().setFromObject(visual).getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-6);
    }
    const fallbackSpawns = createDefaultSpawnPoints();
    for (const [count, radius] of [[1,20],[8,27.5],[10,30],[1,20]]) {
      assert.equal(resizeArenaSceneForPlayerCount(refs.scene, fallbackSpawns, count).arenaRadius, radius);
      assert.equal(floor.scale.x * floor.geometry.parameters.radiusTop, radius);
      assert.deepEqual(resolveActiveSpawnPoints(cyber, fallbackSpawns).map(p => p.toArray()), cyber.spawnPoints!.map(p => [p.x,p.y,p.z]));
      for (const object of cyber.objects) assert.deepEqual(refs.scene.getObjectByName(object.id)!.position.toArray(), [object.position.x,object.position.y,object.position.z]);
    }
    disposeCyberResources(refs.scene);
    assert.equal(refs.scene.getObjectByName('cyber_floor'), undefined);
    for (const object of cyber.objects) assert.equal(refs.scene.getObjectByName(object.id), undefined);
  }
  assert.equal(JSON.stringify(cyber), before, 'rendering never mutates map or movement data');
});

test('Cyber owns its atmosphere while preserving live lighting and sky controls', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#182333', .008);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createCyberSkyMaterial(cyber.skyboxHue, cyber.skyboxBrightness);
  const initial = JSON.stringify(material.uniforms);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1,8,6), material); sky.name = 'skybox_mesh'; sky.userData.cyberOwnedSky = true;
  refs.skyboxMesh = sky; refs.scene.add(sky);
  const state = createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
  const lighting = {...DEFAULT_ADMIN_SETTINGS, directLightIntensity:1.3,ambientLightIntensity:.6};
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,selectedMap:cyber.id});
  assert.equal(refs.dirLight.intensity,1.3); assert.equal(refs.ambientLight.intensity,.6);
  assert.equal(JSON.stringify(material.uniforms),initial);
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:130,skyboxBrightness:8,showSkybox:false},mainAI:undefined,selectedMap:cyber.id});
  assert.equal(refs.skyboxMesh.material,material); assert.notEqual(JSON.stringify(material.uniforms),initial);
  assert.equal(sky.visible,false); assert.equal(refs.skyAtmosphere,null);
  assert.equal(refs.scene.fog.color.getHexString(),'182333'); assert.equal(refs.scene.fog.density,.008);
  disposeCyberEnvironment(refs.scene); assert.equal(sky.parent,null);
});

test('gameplay glow pulses leave Cyber locator and reactor emission stable', () => {
  const scene = new THREE.Scene();
  for (const role of ['cyber_cyan','cyber_core']) {
    const source = new THREE.MeshStandardMaterial(); source.name = role;
    const material = createCyberArchitectureMaterial(source,getEnvironmentQualityProfile('high')); source.dispose();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
    const intensity = material.emissiveIntensity;
    updateEmissiveGlowPulseForScene({scene,blinkMaterial:new THREE.MeshBasicMaterial(),elapsed:.5});
    assert.equal(material.emissiveIntensity,intensity);
    mesh.geometry.dispose(); material.dispose();
  }
});
