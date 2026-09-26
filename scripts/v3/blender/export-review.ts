import fs from 'node:fs';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCombatantMeshRig } from '../../../src/components/grifball/combatantModels';
import { V3_AUTHORED_ANIMATION_CLIP_IDS, getV3AuthoredAnimationClip, sampleV3AuthoredClip } from '../../../src/components/grifball/v3AuthoredAnimationClips';
import { applyV3CleanRigPose, getV3CleanRig, resetV3CleanRigPose } from '../../../src/components/grifball/v3CleanRig';
import { getV3Mesh2MotionDriverRig } from '../../../src/components/grifball/v3Mesh2MotionDriverRig';
import { animateV3WeaponMeshes } from '../../../src/components/grifball/combatantAnimationV3';

const scene = new THREE.Scene();
const rig = createCombatantMeshRig(scene, 200, false, {modelSystem:'v3'}, {v3QualityTier:'desktop',v3SourceFidelity:'exact'});
const model = rig.group;
const clean = getV3CleanRig(model);
const driver = getV3Mesh2MotionDriverRig(model);
resetV3CleanRigPose(model);
const slots = model.userData.v3PartGroups as Record<string,THREE.Group>;
const transform = (o:THREE.Object3D) => { const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();o.matrixWorld.decompose(p,q,s);return {p:p.toArray(),q:q.toArray(),s:s.toArray()}; };
const meshes:any[]=[];
fs.mkdirSync('output/blender-repair/geometry',{recursive:true});
for(const [slot,group] of Object.entries({...slots,weapon_hammer:rig.hammer,weapon_sword:rig.sword,weapon_pistol:rig.pistol})) {
 if(!group) continue;
 group.updateWorldMatrix(true,true);
 const inverse=group.matrixWorld.clone().invert();
 group.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return;
  if(o instanceof THREE.InstancedMesh)throw new Error('Instancing requires explicit export');
  const raw=o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
  raw.deleteAttribute('normal');raw.deleteAttribute('uv');
  const geometry=mergeVertices(raw,0.000001);raw.dispose();
  const pos=geometry.getAttribute('position');
  const color=geometry.getAttribute('color');
  const mats=Array.isArray(o.material)?o.material:[o.material];
  const prefix='geometry/mesh-'+meshes.length;
  const write=(suffix:string,a:Float32Array|Uint32Array)=>{fs.writeFileSync('output/blender-repair/'+prefix+suffix,Buffer.from(a.buffer,a.byteOffset,a.byteLength));return prefix+suffix;};
  meshes.push({slot,name:o.name,vertexCount:pos.count,positions:write('.positions.bin',new Float32Array(pos.array)),indices:write('.indices.bin',new Uint32Array(geometry.index?geometry.index.array:Array.from({length:pos.count},(_,i)=>i))),colors:color?write('.colors.bin',new Float32Array(color.array)):null,groups:geometry.groups,materials:mats.map((m:any)=>({color:m.color?.toArray()??[.5,.5,.5],emissive:m.emissive?.toArray()??[0,0,0]}))});
  geometry.dispose();
 });
}
const rest=Object.fromEntries(Object.entries(slots).map(([k,v])=>[k,transform(v)]));
const driverJoints=Object.values(driver.joints).map(j=>({name:j.name,parent:j.parentName,...transform(j.object)}));
const clips:any[]=[];
for(const id of V3_AUTHORED_ANIMATION_CLIP_IDS){
 const clip=getV3AuthoredAnimationClip(id);
 const weapon=id.includes('hammer')?'hammer':id.includes('sword')?'sword':id.includes('pistol')?'pistol':null;
 const frames=[];
 for(let frame=0;frame<=clip.durationFrames;frame++){
  const sample=sampleV3AuthoredClip(id,{frame});
  applyV3CleanRigPose(model,sample.pose);
  if(weapon)animateV3WeaponMeshes({hammerModel:rig.hammer,swordModel:rig.sword,pistolModel:rig.pistol,combatantModel:model,activeWeapon:weapon,weaponState:'IDLE',weaponTimer:0,dt:1,isLunging:false,settings:{},v3AnimationAuthority:'cleanRig',v3AuthoredClipId:id,v3AuthoredNormalizedTime:frame/clip.durationFrames,v3AuthoredSampleOverride:sample});
  model.updateMatrixWorld(true);
  const parts=Object.fromEntries(Object.entries(slots).map(([k,v])=>[k,transform(v)]));
  if(weapon)parts['weapon_'+weapon]=transform(rig[weapon]!);
  frames.push({frame,parts,pose:sample.pose});
 }
 clips.push({id,label:clip.label,durationFrames:clip.durationFrames,loop:clip.loop,weapon,frames});
 console.log(id,frames.length);
}
fs.mkdirSync('output/blender-repair',{recursive:true});
fs.writeFileSync('output/blender-repair/runtime-audit.json',JSON.stringify({schema:1,fps:60,space:'three-y-up',meshes,rest,cleanJoints:Object.values(clean.joints).map(j=>({name:j.name,parent:j.parent,p:j.restWorldPosition})),driverJoints,clips}));
console.log(JSON.stringify({meshes:meshes.length,vertices:meshes.reduce((n,m)=>n+m.vertexCount,0),clips:clips.length}));
