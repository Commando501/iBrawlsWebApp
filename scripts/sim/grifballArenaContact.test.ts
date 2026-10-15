import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {CustomMapData,CustomMapObject} from '../../src/types';
import {constrainCombatantToArenaBounds} from '../../src/components/grifball/arenaBounds';
import {resolveObstacleCollisions} from '../../src/game/mapPhysics';
import {isMapBodyClear} from './grifballMapCollisionOracle';
const obstacle=(type:'box'|'cylinder'|'sphere',x:number,z:number):CustomMapObject=>({id:'contact',type,position:{x,y:type==='sphere'?1:4,z},scale:{x:2.6,y:type==='sphere'?2.6:8,z:2.6},rotation:{x:0,y:0,z:0},isCollidable:true} as CustomMapObject);
const mapOf=(shape:'rectangular'|'circular',objects:CustomMapObject[]):CustomMapData=>({id:'contact',mapShape:shape,arenaRadius:10,arenaHalfExtents:{x:10,z:10},objects} as CustomMapData);
function check(map:CustomMapData,pos:THREE.Vector3){
 const half=map.arenaHalfExtents!;
 assert.ok(map.mapShape==='rectangular'?Math.abs(pos.x)<=half.x-.6+1e-8&&Math.abs(pos.z)<=half.z-.6+1e-8:Math.hypot(pos.x,pos.z)<=map.arenaRadius-.6+1e-8,`inside arena: ${pos.toArray()}`);
 assert.equal(isMapBodyClear(map,pos),true,`clear of every obstacle: ${pos.toArray()}`);
}
for(const sx of [-1,1])for(const sz of [-1,1])for(const swap of [false,true])test(`observed Synthwave pillar corner stays feasible ${sx}/${sz}/${swap}`,()=>{
 const transform=(x:number,z:number)=>swap?{x:sz*z,z:sx*x}:{x:sx*x,z:sz*z};
 const center=transform(0,-21.083333333333336),start=transform(-1.1383404801371433,-22.4),velocity=transform(10.407983848206845,0);
 const map=mapOf('rectangular',[obstacle('cylinder',center.x,center.z)]);
 map.arenaHalfExtents=swap?{x:23,z:52}:{x:52,z:23};
 const pos=new THREE.Vector3(start.x,0,start.z),vel=new THREE.Vector3(velocity.x,0,velocity.z);
 constrainCombatantToArenaBounds({pos,vel,activeCustomMap:map,arenaRadius:20});check(map,pos);
 assert.ok(pos.distanceTo(new THREE.Vector3(start.x,0,start.z))<.2,'local contact correction');
 for(let frame=0;frame<30;frame++){
  vel.set(velocity.x,0,velocity.z);pos.addScaledVector(vel,1/60);
  constrainCombatantToArenaBounds({pos,vel,activeCustomMap:map,arenaRadius:20});check(map,pos);
 }
});
for(const shape of ['rectangular','circular'] as const)for(const type of ['box','cylinder','sphere'] as const)for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2])test(`boundary conflict ${shape}/${type}/${angle}`,()=>{
 const rotate=(x:number,z:number)=>({x:x*Math.cos(angle)-z*Math.sin(angle),z:x*Math.sin(angle)+z*Math.cos(angle)});
 const center=rotate(0,8.8),start=rotate(.2,9.4),map=mapOf(shape,[obstacle(type,center.x,center.z)]);
 const pos=new THREE.Vector3(start.x,0,start.z),vel=new THREE.Vector3(2,0,1);
 constrainCombatantToArenaBounds({pos,vel,activeCustomMap:map,arenaRadius:10});check(map,pos);
 assert.ok(pos.distanceTo(new THREE.Vector3(start.x,0,start.z))<4,'nearby free exit');
});
for(const shape of ['rectangular','circular'] as const)test(`adjacent obstacles cannot invalidate selected exit ${shape}`,()=>{
 const map=mapOf(shape,[obstacle('cylinder',0,8.8),obstacle('cylinder',-1.7,8.8)]);
 const pos=new THREE.Vector3(-.2,0,9.4),vel=new THREE.Vector3(2,0,0);
 constrainCombatantToArenaBounds({pos,vel,activeCustomMap:map,arenaRadius:10});check(map,pos);
});
for(const type of ['box','cylinder','sphere'] as const)test(`ordinary obstacle resolution remains unchanged ${type}`,()=>{
 const map=mapOf('rectangular',[obstacle(type,0,0)]),pos=new THREE.Vector3(.7,0,.7),vel=new THREE.Vector3(-2,0,-2);
 const expected=resolveObstacleCollisions(pos,vel,map.objects);
 const actual=constrainCombatantToArenaBounds({pos,vel,activeCustomMap:map,arenaRadius:10});
 assert.deepEqual(pos,expected.position);assert.deepEqual(vel,expected.velocity);assert.equal(actual.grounded,expected.grounded);
});
test('platform landing retains vertical state at boundary',()=>{
 const map=mapOf('rectangular',[obstacle('box',0,8.8)]),pos=new THREE.Vector3(.2,8.1,9.4),vel=new THREE.Vector3(0,-1,0);
 const result=constrainCombatantToArenaBounds({pos,vel,activeCustomMap:map,arenaRadius:10});
 assert.equal(result.grounded,true);assert.equal(pos.y,8);assert.equal(vel.y,0);check(map,pos);
});
