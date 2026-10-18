import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { buildCustomMapWinterSceneryForRefs } from './customMapWinterSceneryRuntime';
import { createGlacierArchitectureMaterial } from './glacierMaterials';
import { createGlacierSkyMaterial, disposeGlacierEnvironment } from './glacierLighting';
import { disposeGlacierResources } from './glacierResourceDisposal';
import { buildGlacierSceneryForRefs, GLACIER_REPLACED_OBJECT_IDS } from './glacierArchitecture';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount, resolveActiveSpawnPoints } from './arenaSpawns';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';
import { updateWeatherParticlesForScene } from './visualState';
import { createGlacierWeather } from './glacierWeather';

const glacier = PREMADE_MAPS.find(map => map.id === 'winter_glacier_rink')!;

test('Glacier retains both existing floor sizes, colliders, goals and spawns across tiers and roster changes', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(glacier);
  assert.equal(glacier.mapShape, 'rectangular');
  assert.equal(glacier.arenaRadius, 20);
  assert.deepEqual(getRectHalfExtents(glacier.arenaRadius, glacier.arenaHalfExtents), {x:24,z:12});
  const grifball = toGrifballArena(glacier);
  assert.deepEqual(getRectHalfExtents(grifball.arenaRadius, grifball.arenaHalfExtents), {x:52,z:23});
  const authored = [
    ['post_nw','cylinder',[-24,2.5,-12],[.6,5,.6]],
    ['post_sw','cylinder',[-24,2.5,12],[.6,5,.6]],
    ['post_ne','cylinder',[24,2.5,-12],[.6,5,.6]],
    ['post_se','cylinder',[24,2.5,12],[.6,5,.6]],
    ['goal_w','box',[-19,1,0],[1.5,2,4]], ['goal_e','box',[19,1,0],[1.5,2,4]],
    ['board_low_n','box',[0,.4,-12],[48,.8,.1]], ['board_low_s','box',[0,.4,12],[48,.8,.1]],
    ['board_low_w','box',[-24,.4,0],[.1,.8,24]], ['board_low_e','box',[24,.4,0],[.1,.8,24]],
    ['board_glass_n','box',[0,1.5,-12],[48,1.4,.1]], ['board_glass_s','box',[0,1.5,12],[48,1.4,.1]],
    ['board_glass_w','box',[-24,1.5,0],[.1,1.4,24]], ['board_glass_e','box',[24,1.5,0],[.1,1.4,24]],
  ];
  assert.deepEqual(glacier.objects.map(o=>[o.id,o.type,[o.position.x,o.position.y,o.position.z],[o.scale.x,o.scale.y,o.scale.z]]),authored);
  for (const object of glacier.objects) {
    assert.equal(object.isCollidable,true);
    assert.deepEqual(object.rotation,{x:0,y:0,z:0});
  }
  assert.deepEqual(grifball.objects.map(o=>o.id),['board_low_n','board_low_s','board_glass_n','board_glass_s','grifball_goal_blue','grifball_goal_red']);
  assert.deepEqual(glacier.spawnPoints, [
    {x:-16,y:0,z:-6},{x:-16,y:0,z:6},{x:-12,y:0,z:-8},{x:-12,y:0,z:8},
    {x:16,y:0,z:-6},{x:16,y:0,z:6},{x:12,y:0,z:-8},{x:12,y:0,z:8},
  ]);
  for (const active of [glacier,toGrifballArena(glacier)]) {
    const activeBefore = JSON.stringify(active);
    const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
    for (const tier of ['high','balanced','low'] as const) {
      const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
      const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
      buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: active });
      const pending = buildGlacierSceneryForRefs({ refs, activeCustomMap: active, quality,
        load: () => new Promise(() => {}), materialFactory: material => material.clone() })!;
      const floor = refs.scene.getObjectByName('glacier_floor') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      assert.ok(floor); assert.equal(floor.position.y, -.1);
      const expected = new THREE.Vector3(half.x*2,.2,half.z*2);
      assert.ok(new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3()).distanceTo(expected) < 1e-6);
      assert.equal(Boolean(floor.material.normalMap), tier !== 'low');
      assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
      assert.equal(refs.customMapObjects!.length, active.objects.length + 1);
      assert.equal(refs.scene.getObjectsByProperty('isPointLight',true).length,0, 'neutral broad fill replaces old saturated point lights');
      for (const object of active.objects) {
        const visual = refs.scene.getObjectByName(object.id)!;
        assert.ok(visual,object.id); assert.equal(visual.userData.glacierLegacyId,object.id);
        assert.deepEqual(visual.position.toArray(),[object.position.x,object.position.y,object.position.z]);
        assert.deepEqual(visual.rotation.toArray().slice(0,3),[object.rotation.x,object.rotation.y,object.rotation.z]);
        if (GLACIER_REPLACED_OBJECT_IDS.includes(object.id)) {
          const fallbackMesh = visual.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
          assert.equal(fallbackMesh.material.transparent, object.id.startsWith('board_glass'));
          if (object.id.startsWith('board_glass')) assert.equal(fallbackMesh.material.depthWrite,false);
          const geometry = fallbackMesh.geometry; geometry.computeBoundingBox();
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
      pending.cancel(); disposeGlacierResources(refs.scene);
      assert.equal(refs.scene.getObjectByName('glacier_floor'),undefined);
      for (const object of active.objects) assert.equal(refs.scene.getObjectByName(object.id),undefined);
    }
    assert.equal(JSON.stringify(active),activeBefore,'converted gameplay data stays immutable');
  }
  assert.equal(JSON.stringify(glacier),before);
});

test('The game weather tick advances GPU snow while keeping its vertex buffers immutable', () => {
  const scene = new THREE.Scene();
  const weather = createGlacierWeather(glacier, getEnvironmentQualityProfile('high'))!;
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

test('Glacier preset bypasses the old icebergs and CPU snow while user glacier scenery remains enabled', t => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){ throw new Error('legacy canvas requested'); }}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');});
  assert.doesNotThrow(()=>buildCustomMapWinterSceneryForRefs({refs,activeCustomMap:glacier}));
  assert.doesNotThrow(()=>buildCustomMapWinterSceneryForRefs({refs,activeCustomMap:toGrifballArena(glacier)}));
  assert.equal(refs.scene.children.length,0);
  assert.throws(()=>buildCustomMapWinterSceneryForRefs({refs,activeCustomMap:{...glacier,id:'my_glacier_arena'}}),/legacy canvas requested/);
});

test('Glacier keeps its atmosphere and still responds to live lighting and sky controls', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#9bafbc',.008);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createGlacierSkyMaterial(glacier.skyboxHue,glacier.skyboxBrightness), initial = JSON.stringify(material.uniforms);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material); sky.name='skybox_mesh'; sky.userData.glacierOwnedSky=true;
  refs.skyboxMesh=sky; refs.scene.add(sky);
  const state = createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
  const lighting = {...DEFAULT_ADMIN_SETTINGS,directLightIntensity:1.3,ambientLightIntensity:.6};
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,selectedMap:glacier.id});
  assert.equal(refs.dirLight.intensity,1.3); assert.equal(refs.ambientLight.intensity,.6);
  assert.equal(JSON.stringify(material.uniforms),initial);
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:220,skyboxBrightness:5,showSkybox:false},mainAI:undefined,selectedMap:glacier.id});
  assert.equal(refs.skyboxMesh.material,material); assert.notEqual(JSON.stringify(material.uniforms),initial);
  assert.equal(sky.visible,false); assert.equal(refs.skyAtmosphere,null);
  assert.equal(refs.scene.fog.color.getHexString(),'9bafbc'); assert.equal(refs.scene.fog.density,.008);
  disposeGlacierEnvironment(refs.scene); assert.equal(sky.parent,null);
});

test('Gameplay glow pulses leave Glacier ice, glass and ceramic non-emissive', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const scene = new THREE.Scene(), blinkMaterial = new THREE.MeshBasicMaterial();
  for (const role of ['glacier_ice','glacier_glass','glacier_ceramic']) {
    const source = new THREE.MeshStandardMaterial(); source.name=role;
    const material=createGlacierArchitectureMaterial(source,getEnvironmentQualityProfile('high'));source.dispose();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);
    const intensity=material.emissiveIntensity;
    updateEmissiveGlowPulseForScene({scene,blinkMaterial,elapsed:.5});assert.equal(material.emissiveIntensity,intensity);
    mesh.geometry.dispose();material.dispose();
  }
  blinkMaterial.dispose();
});

test('Glacier attachment and cleanup do not alter another upgraded arena or user glacier maps', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
  refs.scene.userData.environmentQuality=getEnvironmentQualityProfile('low');
  const cyber=PREMADE_MAPS.find(map=>map.id==='cyber_hex_arena')!;
  buildCustomMapBaseArenaForRefs({refs,activeCustomMap:cyber});
  const before=refs.scene.children.slice(), references=refs.customMapObjects!.slice();
  let loads=0;
  for (const foreign of [cyber,{...glacier,id:'my_glacier_arena'}]) {
    assert.equal(buildGlacierSceneryForRefs({refs,activeCustomMap:foreign,load:async()=>{loads++;return new THREE.Group();}}),undefined);
  }
  disposeGlacierResources(refs.scene);disposeGlacierEnvironment(refs.scene);
  assert.equal(loads,0);assert.deepEqual(refs.scene.children,before);assert.deepEqual(refs.customMapObjects,references);
  assert.ok(refs.scene.getObjectByName('cyber_floor'));disposeCyberResources(refs.scene);
});
