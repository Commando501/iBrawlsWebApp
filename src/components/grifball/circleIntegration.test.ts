import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createDefaultSpawnPoints, resizeArenaSceneForPlayerCount } from './arenaSpawns';
import { buildCircleBaseArenaForRefs } from './circleArenaRuntime';
import { buildCircleSceneryForRefs, CIRCLE_ARCHITECTURE_PARTS } from './circleArchitecture';
import { createCircleArchitectureMaterial } from './circleMaterials';
import { createCircleSkyMaterial, disposeCircleEnvironment } from './circleLighting';
import { disposeCircleObjectResources, disposeCircleResources } from './circleResourceDisposal';
import { buildHangarBaseArenaForRefs } from './hangarArenaRuntime';
import { disposeHangarResources } from './hangarResourceDisposal';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { syncAdminSettingsVisualStateForState, updateEmissiveGlowPulseForScene } from './visualState';
import { resolveActiveCustomMap } from './mapSelection';
import type { ReplayFile } from '../../types';

test('Circle preserves its original floor, no interior colliders and existing roster sizing across quality tiers', t => {
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const before=JSON.stringify(DEFAULT_ADMIN_SETTINGS);
  for(const tier of ['high','balanced','low'] as const){
    const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
    const quality=getEnvironmentQualityProfile(tier);
    buildCircleBaseArenaForRefs({refs,adminSettings:DEFAULT_ADMIN_SETTINGS,quality});
    const handle=buildCircleSceneryForRefs({refs,quality,load:()=>new Promise(()=>{})})!;
    const floor=refs.scene.getObjectByName('circle_floor') as THREE.Mesh<THREE.CylinderGeometry,THREE.MeshStandardMaterial>;
    assert.ok(floor.geometry instanceof THREE.CylinderGeometry);
    assert.equal(floor.geometry.parameters.radiusTop,20);assert.equal(floor.geometry.parameters.radiusBottom,20);
    assert.equal(floor.geometry.parameters.height,.2);assert.equal(floor.geometry.parameters.radialSegments,64);
    assert.equal(floor.position.y,-.1);assert.equal(Boolean(floor.material.normalMap),tier!=='low');
    assert.equal(refs.dirLight!.shadow.mapSize.x,quality.shadowMapSize);
    assert.equal(refs.dirLight!.intensity,DEFAULT_ADMIN_SETTINGS.directLightIntensity);
    assert.equal(refs.ambientLight!.intensity,DEFAULT_ADMIN_SETTINGS.ambientLightIntensity);
    const spawns=createDefaultSpawnPoints();
    for(const [count,scale] of [[1,1],[2,1],[3,1.125],[4,1.125],[5,1.25],[6,1.25],[7,1.375],[8,1.375],[9,1.5],[16,1.5],[2,1]]){
      assert.deepEqual(resizeArenaSceneForPlayerCount(refs.scene,spawns,count),{scale,arenaRadius:20*scale});
      assert.deepEqual(floor.scale.toArray(),[scale,1,scale]);
      assert.equal(refs.scene.getObjectByName('circle_scenery')!.userData.arenaRadius,20*scale);
      const bounds=new THREE.Box3().setFromObject(floor);
      assert.ok(bounds.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(40*scale,.2,40*scale))<1e-6);
      assert.ok(Math.abs(bounds.max.y)<1e-7);
      assert.equal(spawns.length,8);
      spawns.forEach((spawn,index)=>assert.ok(spawn.distanceTo(new THREE.Vector3(13*scale*Math.cos(index*Math.PI/4),0,13*scale*Math.sin(index*Math.PI/4)))<1e-9));
      assert.deepEqual(refs.customMapObjects,[],'scenery never enters the collider registry');
      const key=refs.dirLight!;key.updateMatrixWorld(true);key.target.updateMatrixWorld(true);key.shadow.updateMatrices(key);
      for(const x of [-20,20])for(const z of [-20,20])assert.ok(new THREE.Vector3(x*scale,0,z*scale).project(key.shadow.camera).toArray().every(value=>value>=-1&&value<=1));
    }
    handle.cancel();disposeCircleResources(refs.scene);
    assert.equal(refs.scene.getObjectByName('circle_floor'),undefined);
    assert.equal(refs.scene.getObjectByName('circle_scenery'),undefined);
  }
  assert.equal(JSON.stringify(DEFAULT_ADMIN_SETTINGS),before,'movement and game settings stay immutable');
});

test('Circle honors a roster resize that arrives while architecture is downloading', async t=>{
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
  const quality=getEnvironmentQualityProfile('low');buildCircleBaseArenaForRefs({refs,adminSettings:DEFAULT_ADMIN_SETTINGS,quality});
  const source=new THREE.Group();
  for(const part of CIRCLE_ARCHITECTURE_PARTS){const root=new THREE.Group();root.name=part;root.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({name:'circle_alloy'})));source.add(root);}
  let complete!:(source:THREE.Group)=>void;
  const handle=buildCircleSceneryForRefs({refs,quality,load:()=>new Promise(resolve=>{complete=resolve;})})!;
  await Promise.resolve();const spawns=createDefaultSpawnPoints();resizeArenaSceneForPlayerCount(refs.scene,spawns,8);
  const saved=spawns.map(spawn=>spawn.toArray());complete(source);await handle.ready;
  const shell=refs.scene.getObjectByName('circle_scenery')!;
  assert.equal(shell.userData.architectureStatus,'ready');assert.equal(shell.userData.arenaRadius,27.5);
  assert.equal(refs.scene.getObjectByName('circle_fallback_architecture'),undefined);
  const architecture=refs.scene.getObjectByName('circle_blender_architecture')!;
  const pylon=architecture.children.find(object=>object.userData.circlePart==='perimeter-pylon'||object.userData.architecturePart==='perimeter-pylon') as THREE.InstancedMesh;
  assert.ok(pylon);const matrix=new THREE.Matrix4();pylon.getMatrixAt(0,matrix);
  const position=new THREE.Vector3().setFromMatrixPosition(matrix);assert.ok(Math.abs(Math.hypot(position.x,position.z)-31.5)<1e-5);
  assert.deepEqual(spawns.map(spawn=>spawn.toArray()),saved);assert.deepEqual(refs.customMapObjects,[]);
  disposeCircleResources(refs.scene);disposeCircleObjectResources([source]);
});

test('Circle and recorded Circle sessions keep their sky and honor explicit lighting controls',()=>{
  for(const replay of [false,true]){
    const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
    refs.scene.fog=new THREE.FogExp2('#17232f',.008);refs.ambientLight=new THREE.AmbientLight();refs.dirLight=new THREE.DirectionalLight();
    const material=createCircleSkyMaterial(224,4),initial=JSON.stringify(material.uniforms);
    const sky=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material);sky.name='skybox_mesh';sky.userData.circleOwnedSky=true;refs.skyboxMesh=sky;refs.scene.add(sky);
    const state=createInitialGrifballRuntimeState({adminSettings:{...DEFAULT_ADMIN_SETTINGS},debugMode:false,isMultiplayer:false,multiplayerRole:null});
    const selection={selectedMap:replay?'hangar':'circle',replayData:replay?{mapType:'circle'} as ReplayFile:undefined};
    assert.equal(resolveActiveCustomMap(selection),null);
    const lighting={...DEFAULT_ADMIN_SETTINGS,directLightIntensity:1.2,ambientLightIntensity:.6};
    syncAdminSettingsVisualStateForState({state,refs,adminSettings:lighting,mainAI:undefined,...selection});
    assert.equal(refs.dirLight.intensity,1.2);assert.equal(refs.ambientLight.intensity,.6);assert.equal(JSON.stringify(material.uniforms),initial);
    syncAdminSettingsVisualStateForState({state,refs,adminSettings:{...lighting,skyboxHue:195,skyboxBrightness:6,showSkybox:false},mainAI:undefined,...selection});
    assert.notEqual(JSON.stringify(material.uniforms),initial);assert.equal(refs.skyboxMesh.material,material);assert.equal(sky.visible,false);
    assert.equal(refs.scene.fog.color.getHexString(),'17232f');assert.equal(refs.scene.fog.density,.008);assert.equal(refs.skyAtmosphere,null);
    disposeCircleEnvironment(refs.scene);assert.equal(sky.parent,null);
  }
});

test('Gameplay pulses do not brighten Circle floor or fixture accents',t=>{
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const scene=new THREE.Scene(),materials:THREE.MeshStandardMaterial[]=[];
  for(const role of ['circle_ceramic','circle_cyan','circle_light']){
    const source=new THREE.MeshStandardMaterial({name:role}),material=createCircleArchitectureMaterial(source,getEnvironmentQualityProfile('high'));source.dispose();materials.push(material);scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
  }
  const intensities=materials.map(material=>material.emissiveIntensity);
  for(const elapsed of [0,.5,2]){updateEmissiveGlowPulseForScene({scene,elapsed});assert.deepEqual(materials.map(material=>material.emissiveIntensity),intensities);}
  disposeCircleObjectResources(scene.children.slice());
});

test('Circle resource cleanup leaves another upgraded arena intact',t=>{
  t.mock.method(THREE.ImageLoader.prototype,'load',()=>({} as HTMLImageElement));
  const refs=createInitialGrifballThreeRefs();refs.scene=new THREE.Scene();
  buildHangarBaseArenaForRefs({refs,adminSettings:DEFAULT_ADMIN_SETTINGS,quality:getEnvironmentQualityProfile('low')});
  const previous=refs.scene.children.slice();disposeCircleResources(refs.scene);disposeCircleEnvironment(refs.scene);
  assert.deepEqual(refs.scene.children,previous);assert.ok(refs.scene.getObjectByName('hangar_floor'));disposeHangarResources(refs.scene);
});
