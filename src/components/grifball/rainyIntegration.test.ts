import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { buildCustomMapRainyStreetsSceneryForRefs } from './customMapRainyStreetsSceneryRuntime';
import { createRainyArchitectureMaterial } from './rainyMaterials';
import { createRainySkyMaterial, disposeRainyEnvironment } from './rainyLighting';
import { disposeRainyResources } from './rainyResourceDisposal';
import { buildRainySceneryForRefs, RAINY_REPLACED_OBJECT_IDS } from './rainyArchitecture';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount, resolveActiveSpawnPoints } from './arenaSpawns';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';
import { updateWeatherParticlesForScene } from './visualState';
import { createRainyWeather } from './rainyWeather';

const rainy = PREMADE_MAPS.find(map => map.id === 'rainy_industrial_streets')!;

test('Rainy retains both existing floor sizes, colliders, goals and spawns across tiers and roster changes', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(rainy);
  assert.equal(rainy.mapShape, 'rectangular');
  assert.equal(rainy.arenaRadius, 20);
  assert.deepEqual(getRectHalfExtents(rainy.arenaRadius, rainy.arenaHalfExtents), {x:24,z:12});
  const grifball = toGrifballArena(rainy);
  assert.deepEqual(getRectHalfExtents(grifball.arenaRadius, grifball.arenaHalfExtents), {x:52,z:23});
  assert.deepEqual(rainy.objects.map(({id,position,rotation,scale,isCollidable})=>({id,position,rotation,scale,isCollidable})), [
    {id:'rainy_barrier_w',position:{x:-17,y:1,z:0},rotation:{x:0,y:0,z:0},scale:{x:1.2,y:2,z:4},isCollidable:true},
    {id:'rainy_barrier_e',position:{x:17,y:1,z:0},rotation:{x:0,y:0,z:0},scale:{x:1.2,y:2,z:4},isCollidable:true},
    {id:'rainy_crate_nw',position:{x:-6,y:1,z:-5},rotation:{x:0,y:.4,z:0},scale:{x:2,y:2,z:2},isCollidable:true},
    {id:'rainy_crate_se',position:{x:6,y:1,z:5},rotation:{x:0,y:-.3,z:0},scale:{x:2,y:2,z:2},isCollidable:true},
  ]);
  assert.deepEqual(rainy.spawnPoints, [
    {x:-16,y:0,z:-6},{x:-16,y:0,z:6},{x:-12,y:0,z:-8},{x:-12,y:0,z:8},
    {x:16,y:0,z:-6},{x:16,y:0,z:6},{x:12,y:0,z:-8},{x:12,y:0,z:8},
  ]);
  for (const active of [rainy,toGrifballArena(rainy)]) {
    const activeBefore = JSON.stringify(active);
    const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
    for (const tier of ['high','balanced','low'] as const) {
      const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
      const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
      buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: active });
      const pending = buildRainySceneryForRefs({ refs, activeCustomMap: active, quality,
        load: () => new Promise(() => {}), materialFactory: material => material.clone() })!;
      const floor = refs.scene.getObjectByName('rainy_floor') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      assert.ok(floor); assert.equal(floor.position.y, -.1);
      const expected = new THREE.Vector3(half.x*2,.2,half.z*2);
      assert.ok(new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3()).distanceTo(expected) < 1e-6);
      assert.equal(Boolean(floor.material.normalMap), tier !== 'low');
      assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
      assert.equal(refs.customMapObjects!.length, active.objects.length + 1);
      assert.equal(refs.scene.getObjectsByProperty('isPointLight',true).length,0, 'neutral broad fill replaces old saturated point lights');
      for (const object of active.objects) {
        const visual = refs.scene.getObjectByName(object.id)!;
        assert.ok(visual,object.id); assert.equal(visual.userData.rainyLegacyId,object.id);
        assert.deepEqual(visual.position.toArray(),[object.position.x,object.position.y,object.position.z]);
        assert.deepEqual(visual.rotation.toArray().slice(0,3),[object.rotation.x,object.rotation.y,object.rotation.z]);
        if (RAINY_REPLACED_OBJECT_IDS.includes(object.id)) {
          const geometry = (visual.children[0] as THREE.Mesh).geometry; geometry.computeBoundingBox();
          assert.ok(geometry.boundingBox!.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(object.scale.x,object.scale.y,object.scale.z)) < 1e-6);
        } else {
          assert.equal(object.gameModeKind,'grifball_goal');
          assert.ok(visual.children.some(child=>child.userData.goalPlateTeam === object.goalPlateTeam),'existing goal visual and scoring tag retained');
        }
      }
      const fallback = createDefaultSpawnPoints();
      for (const count of [1,8,10,1]) {
        resizeArenaSceneForPlayerCount(refs.scene,fallback,count);
        assert.ok(new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3()).distanceTo(expected)<1e-6, 'roster scaling never resizes a rectangular arena');
        assert.deepEqual(resolveActiveSpawnPoints(active,fallback).map(point=>point.toArray()),active.spawnPoints!.map(point=>[point.x,point.y,point.z]));
        for (const object of active.objects) assert.deepEqual(refs.scene.getObjectByName(object.id)!.position.toArray(),[object.position.x,object.position.y,object.position.z]);
      }
      pending.cancel(); disposeRainyResources(refs.scene);
      assert.equal(refs.scene.getObjectByName('rainy_floor'),undefined);
      for (const object of active.objects) assert.equal(refs.scene.getObjectByName(object.id),undefined);
    }
    assert.equal(JSON.stringify(active),activeBefore,'converted gameplay data stays immutable');
  }
  assert.equal(JSON.stringify(rainy),before);
});

test('The game weather tick advances GPU rain while keeping its vertex buffers immutable', () => {
  const scene = new THREE.Scene();
  const weather = createRainyWeather(rainy, getEnvironmentQualityProfile('high'))!;
  scene.add(weather);
  const positions = weather.geometry.getAttribute('position') as THREE.BufferAttribute;
  const initial = positions.array.slice(), version = positions.version;
  updateWeatherParticlesForScene({scene, frameState:{}, now:1200});
  const material = weather.material as THREE.ShaderMaterial;
  assert.equal(material.uniforms.uTime.value,1.2);
  updateWeatherParticlesForScene({scene, frameState:{}, now:2400});
  assert.equal(material.uniforms.uTime.value,2.4);
  assert.deepEqual(positions.array,initial);
  assert.equal(positions.version,version);
  weather.geometry.dispose(); material.dispose();
});

test('Rainy preset bypasses the old canvas city and CPU particles while user rainy scenery remains enabled', t => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){ throw new Error('legacy canvas requested'); }}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');});
  assert.doesNotThrow(()=>buildCustomMapRainyStreetsSceneryForRefs({refs,activeCustomMap:rainy}));
  assert.doesNotThrow(()=>buildCustomMapRainyStreetsSceneryForRefs({refs,activeCustomMap:toGrifballArena(rainy)}));
  assert.equal(refs.scene.children.length,0);
  assert.throws(()=>buildCustomMapRainyStreetsSceneryForRefs({refs,activeCustomMap:{...rainy,id:'my_rainy_arena'}}),/legacy canvas requested/);
});

test('Rainy keeps its atmosphere and still responds to live lighting and sky controls', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#101c28',.012);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createRainySkyMaterial(rainy.skyboxHue,rainy.skyboxBrightness), initial = JSON.stringify(material.uniforms);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material); sky.name='skybox_mesh'; sky.userData.rainyOwnedSky=true;
  refs.skyboxMesh=sky; refs.scene.add(sky);
  const state = createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
  const lighting = {...DEFAULT_ADMIN_SETTINGS,directLightIntensity:1.3,ambientLightIntensity:.6};
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,selectedMap:rainy.id});
  assert.equal(refs.dirLight.intensity,1.3); assert.equal(refs.ambientLight.intensity,.6);
  assert.equal(JSON.stringify(material.uniforms),initial);
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:220,skyboxBrightness:5,showSkybox:false},mainAI:undefined,selectedMap:rainy.id});
  assert.equal(refs.skyboxMesh.material,material); assert.notEqual(JSON.stringify(material.uniforms),initial);
  assert.equal(sky.visible,false); assert.equal(refs.skyAtmosphere,null);
  assert.equal(refs.scene.fog.color.getHexString(),'101c28'); assert.equal(refs.scene.fog.density,.012);
  disposeRainyEnvironment(refs.scene); assert.equal(sky.parent,null);
});

test('Gameplay glow pulses leave Rainy accent, window and armor emission stable', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const scene = new THREE.Scene(), blinkMaterial = new THREE.MeshBasicMaterial();
  for (const role of ['rainy_amber','rainy_window','rainy_ceramic']) {
    const source = new THREE.MeshStandardMaterial(); source.name=role;
    const material=createRainyArchitectureMaterial(source,getEnvironmentQualityProfile('high'));source.dispose();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);
    const intensity=material.emissiveIntensity;
    updateEmissiveGlowPulseForScene({scene,blinkMaterial,elapsed:.5});assert.equal(material.emissiveIntensity,intensity);
    mesh.geometry.dispose();material.dispose();
  }
  blinkMaterial.dispose();
});

test('Rainy attachment and cleanup do not alter another upgraded arena or user rainy maps', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
  refs.scene.userData.environmentQuality=getEnvironmentQualityProfile('low');
  const cyber=PREMADE_MAPS.find(map=>map.id==='cyber_hex_arena')!;
  buildCustomMapBaseArenaForRefs({refs,activeCustomMap:cyber});
  const before=refs.scene.children.slice(), references=refs.customMapObjects!.slice();
  let loads=0;
  for (const foreign of [cyber,{...rainy,id:'my_rainy_arena'}]) {
    assert.equal(buildRainySceneryForRefs({refs,activeCustomMap:foreign,load:async()=>{loads++;return new THREE.Group();}}),undefined);
  }
  disposeRainyResources(refs.scene);disposeRainyEnvironment(refs.scene);
  assert.equal(loads,0);assert.deepEqual(refs.scene.children,before);assert.deepEqual(refs.customMapObjects,references);
  assert.ok(refs.scene.getObjectByName('cyber_floor'));disposeCyberResources(refs.scene);
});

