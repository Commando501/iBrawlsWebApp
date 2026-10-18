import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { buildCustomMapSynthwaveSceneryForRefs } from './customMapSynthwaveSceneryRuntime';
import { createNeonArchitectureMaterial } from './neonMaterials';
import { createNeonSkyMaterial, disposeNeonEnvironment } from './neonLighting';
import { disposeNeonResources } from './neonResourceDisposal';
import { buildNeonSceneryForRefs, NEON_REPLACED_OBJECT_IDS } from './neonArchitecture';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount, resolveActiveSpawnPoints } from './arenaSpawns';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';

const neon = PREMADE_MAPS.find(map => map.id === 'synthwave_grid_arena')!;

test('Neon retains both existing floor sizes, colliders, goals and spawns across tiers and roster changes', t => {
  t.mock.method(THREE.ImageLoader.prototype, 'load', () => ({} as HTMLImageElement));
  const before = JSON.stringify(neon);
  assert.deepEqual(neon.spawnPoints, [
    {x:-16,y:0,z:-6},{x:-16,y:0,z:6},{x:-12,y:0,z:-8},{x:-12,y:0,z:8},
    {x:16,y:0,z:-6},{x:16,y:0,z:6},{x:12,y:0,z:-8},{x:12,y:0,z:8},
  ]);
  for (const active of [neon,toGrifballArena(neon)]) {
    const activeBefore = JSON.stringify(active);
    const half = getRectHalfExtents(active.arenaRadius, active.arenaHalfExtents);
    for (const tier of ['high','balanced','low'] as const) {
      const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
      const quality = getEnvironmentQualityProfile(tier); refs.scene.userData.environmentQuality = quality;
      buildCustomMapBaseArenaForRefs({ refs, activeCustomMap: active });
      const pending = buildNeonSceneryForRefs({ refs, activeCustomMap: active, quality,
        load: () => new Promise(() => {}), materialFactory: material => material.clone() })!;
      const floor = refs.scene.getObjectByName('neon_floor') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      assert.ok(floor); assert.equal(floor.position.y, -.1);
      const expected = new THREE.Vector3(half.x*2,.2,half.z*2);
      assert.ok(new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3()).distanceTo(expected) < 1e-6);
      assert.equal(Boolean(floor.material.normalMap), tier !== 'low');
      assert.equal(refs.dirLight!.shadow.mapSize.x, quality.shadowMapSize);
      assert.equal(refs.customMapObjects!.length, active.objects.length + 1);
      assert.equal(refs.scene.getObjectsByProperty('isPointLight',true).length,0, 'neutral broad fill replaces old saturated point lights');
      for (const object of active.objects) {
        const visual = refs.scene.getObjectByName(object.id)!;
        assert.ok(visual,object.id); assert.equal(visual.userData.neonLegacyId,object.id);
        assert.deepEqual(visual.position.toArray(),[object.position.x,object.position.y,object.position.z]);
        assert.deepEqual(visual.rotation.toArray().slice(0,3),[object.rotation.x,object.rotation.y,object.rotation.z]);
        if (NEON_REPLACED_OBJECT_IDS.includes(object.id)) {
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
      pending.cancel(); disposeNeonResources(refs.scene);
      assert.equal(refs.scene.getObjectByName('neon_floor'),undefined);
      for (const object of active.objects) assert.equal(refs.scene.getObjectByName(object.id),undefined);
    }
    assert.equal(JSON.stringify(active),activeBefore,'converted gameplay data stays immutable');
  }
  assert.equal(JSON.stringify(neon),before);
});

test('Neon preset bypasses the old canvas sun, palms and city while user synthwave scenery remains enabled', t => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){ throw new Error('legacy canvas requested'); }}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');});
  assert.doesNotThrow(()=>buildCustomMapSynthwaveSceneryForRefs({refs,activeCustomMap:neon}));
  assert.doesNotThrow(()=>buildCustomMapSynthwaveSceneryForRefs({refs,activeCustomMap:toGrifballArena(neon)}));
  assert.equal(refs.scene.children.length,0);
  assert.throws(()=>buildCustomMapSynthwaveSceneryForRefs({refs,activeCustomMap:{...neon,id:'my_synthwave_arena'}}),/legacy canvas requested/);
});

test('Neon keeps its atmosphere and still responds to live lighting and sky controls', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  refs.scene.fog = new THREE.FogExp2('#323747',.005);
  refs.ambientLight = new THREE.AmbientLight(); refs.dirLight = new THREE.DirectionalLight();
  const material = createNeonSkyMaterial(neon.skyboxHue,neon.skyboxBrightness), initial = JSON.stringify(material.uniforms);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material); sky.name='skybox_mesh'; sky.userData.neonOwnedSky=true;
  refs.skyboxMesh=sky; refs.scene.add(sky);
  const state = createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
  const lighting = {...DEFAULT_ADMIN_SETTINGS,directLightIntensity:1.3,ambientLightIntensity:.6};
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,selectedMap:neon.id});
  assert.equal(refs.dirLight.intensity,1.3); assert.equal(refs.ambientLight.intensity,.6);
  assert.equal(JSON.stringify(material.uniforms),initial);
  syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:220,skyboxBrightness:5,showSkybox:false},mainAI:undefined,selectedMap:neon.id});
  assert.equal(refs.skyboxMesh.material,material); assert.notEqual(JSON.stringify(material.uniforms),initial);
  assert.equal(sky.visible,false); assert.equal(refs.skyAtmosphere,null);
  assert.equal(refs.scene.fog.color.getHexString(),'323747'); assert.equal(refs.scene.fog.density,.005);
  disposeNeonEnvironment(refs.scene); assert.equal(sky.parent,null);
});

test('Gameplay glow pulses leave Neon accent, window and armor emission stable', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const scene = new THREE.Scene(), blinkMaterial = new THREE.MeshBasicMaterial();
  for (const role of ['neon_accent','neon_window','neon_ceramic']) {
    const source = new THREE.MeshStandardMaterial(); source.name=role;
    const material=createNeonArchitectureMaterial(source,getEnvironmentQualityProfile('high'));source.dispose();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);
    const intensity=material.emissiveIntensity;
    updateEmissiveGlowPulseForScene({scene,blinkMaterial,elapsed:.5});assert.equal(material.emissiveIntensity,intensity);
    mesh.geometry.dispose();material.dispose();
  }
  blinkMaterial.dispose();
});

test('Neon attachment and cleanup do not alter another upgraded arena or user synthwave maps', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
  refs.scene.userData.environmentQuality=getEnvironmentQualityProfile('low');
  const cyber=PREMADE_MAPS.find(map=>map.id==='cyber_hex_arena')!;
  buildCustomMapBaseArenaForRefs({refs,activeCustomMap:cyber});
  const before=refs.scene.children.slice(), references=refs.customMapObjects!.slice();
  let loads=0;
  for (const foreign of [cyber,{...neon,id:'my_synthwave_arena'}]) {
    assert.equal(buildNeonSceneryForRefs({refs,activeCustomMap:foreign,load:async()=>{loads++;return new THREE.Group();}}),undefined);
  }
  disposeNeonResources(refs.scene);disposeNeonEnvironment(refs.scene);
  assert.equal(loads,0);assert.deepEqual(refs.scene.children,before);assert.deepEqual(refs.customMapObjects,references);
  assert.ok(refs.scene.getObjectByName('cyber_floor'));disposeCyberResources(refs.scene);
});
