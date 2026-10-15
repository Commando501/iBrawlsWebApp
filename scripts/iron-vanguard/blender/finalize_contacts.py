"""Finalize the hand-contact master with motion checks and review evidence."""
import bpy,sys,json,math,hashlib
from pathlib import Path
import numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,linear_keys
from rig_master import update,render
root=Path(__file__).resolve().parents[3];out=root/'output/iron-vanguard/master-v015';out.mkdir(exist_ok=True)
dest=out/'iron-vanguard-master.blend';assert not dest.exists()
source=root/'output/iron-vanguard/master-v013/iron-vanguard-master.blend'
bpy.ops.wm.open_mainfile(filepath=str(source));s=bpy.context.scene;r=bpy.data.objects['IV_Rig'];body=bpy.data.objects['IV_Body']
report={'source':str(source),'correctives':{},'motion':{},'contacts':{}}
report['remaining_visual_cleanup']='Thin glove armor edges retain local creases at tight finger bends; no corrective shape is applied.'
for role in ['Hammer','Sword']:
 set_action(r,bpy.data.actions['IV_'+role+'_ContactHold']);s.frame_set(1);update()
 if role=='Sword':
  shoulder=r.pose.bones['RightShoulder'];m=shoulder.matrix.copy();point=m.translation.copy()
  m=Matrix.Rotation(math.radians(6),4,'Z')@m;m.translation=point;shoulder.matrix=m
  shoulder.keyframe_insert('rotation_quaternion',frame=1);update()
 render(s,out,role.lower()+'-overview',(0,.12,1.3),(2,6,1),1.6,(1100,1100))
 for side,prefix in [('R','Right'),('L','Left')]:
  if role=='Sword' and side=='L':continue
  center=r.pose.bones[prefix+'Hand'].head
  for label,direction in [('front',(2,3,2)),('reverse',(-2,3,.5)),('palm',(1,-3,-1))]:render(s,out,role.lower()+'-'+side+'-'+label,center,direction,.34,(1100,1100))
 # Measure final evaluated skin, including corrective shapes, against the weapon surface.
 weapon=bpy.data.objects['IV_'+role];bvh=BVHTree.FromPolygons([weapon.matrix_world@v.co for v in weapon.data.vertices],[p.vertices[:] for p in weapon.data.polygons])
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();contact={}
 for side,prefix in [('R','Right'),('L','Left')]:
  if role=='Sword' and side=='L':continue
  names=[prefix+'Hand']+[f'DEF_{d}_{j:02d}_{side}' for d in ['Index','Middle','Ring','Pinky','Thumb'] for j in [1,2,3]]
  indices={body.vertex_groups[n].index for n in names};ids=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in indices)>.7]
  distances=[]
  for i in ids:
   p=ev.matrix_world@mesh.vertices[i].co;q,n,_,dist=bvh.find_nearest(p);distances.append(dist if (p-q).dot(n)>=0 else -dist)
  contact[side]={'vertices_measured':len(ids),'signed_depth_over_2mm':sum(d<-.002 for d in distances),'max_signed_depth_m':max(0,-min(distances))}
 ev.to_mesh_clear();report['contacts'][role]=contact
 hold=r.animation_data.action;clip=hold.copy();clip.name='IV_'+role+'_GripCheck';clip.use_fake_user=True;set_action(r,clip)
 ctrl=r.pose.bones['CTRL_'+role];base=ctrl.matrix.copy();p=base.translation.copy()
 keys=[(1,(0,0,0),(0,0)),(16,(0,.025,.025),(5,0)),(31,(.02,.02,.01),(0,6)),(46,(-.02,.02,.01),(0,-6)),(61,(0,.035,-.02),(-5,0)),(76,(0,.01,.02),(3,3)),(91,(0,0,0),(0,0))]
 for frame,offset,angles in keys:
  m=Matrix.Rotation(math.radians(angles[0]),4,'X')@Matrix.Rotation(math.radians(angles[1]),4,'Z')@base;m.translation=p+Vector(offset)
  ctrl.matrix=m;ctrl.keyframe_insert('location',frame=frame);ctrl.keyframe_insert('rotation_quaternion',frame=frame)
 linear_keys(clip)
 max_ik=0.;max_stretch=0.;max_grip=0.;baseline={}
 for frame in range(1,92):
  s.frame_set(frame);update();inv=ctrl.matrix.inverted()
  for side,prefix in [('R','Right'),('L','Left')]:
   err=(r.pose.bones[prefix+'Hand'].head-r.pose.bones['CTRL_Hand_'+side].matrix.translation).length;max_ik=max(max_ik,err)
   if side=='R' or role=='Hammer':
    relative=inv@r.pose.bones[prefix+'Hand'].matrix
    if frame==1:baseline[side]=relative.copy()
    max_grip=max(max_grip,(relative.translation-baseline[side].translation).length)
  max_stretch=max(max_stretch,max(abs(x-1) for b in r.pose.bones for x in b.matrix.to_scale()))
  if frame in [16,31,61]:render(s,out,f'{role.lower()}-motion-{frame}',(0,.12,1.3),(2,6,1),1.65,(1100,1100))
 assert max_ik<.001,(role,max_ik)
 assert max_grip<.001,(role,max_grip)
 assert max_stretch<.0001,(role,max_stretch)
 report['motion'][role]={'frames_checked':91,'max_hand_target_error_m':max_ik,'max_hand_relative_to_weapon_drift_m':max_grip,'max_bone_scale_error':max_stretch}
text=bpy.data.texts['IV_RIG_TOOLS.py'];text.clear();text.write((Path(__file__).parent/'rig_ui.py').read_text(encoding='utf-8-sig'))
notes=bpy.data.texts['START_HERE'];notes.write('\nFITTED GRIPS v015\nUse Hammer fitted grip / Sword fitted grip for the refined contact poses.\nUse Hammer grip check / Sword grip check and play frames 1-91 for a small-range attachment test.\nHand weights cleaned; localized glove armor edge creases remain for mesh cleanup.\nWeapon placement and size unchanged. Neutral hand-fit channels added to older actions to reset offsets when switching.\nContact estimates on detailed source meshes are approximate; remaining shallow overlaps are listed in contact-validation.json.\n')
set_action(r,bpy.data.actions['IV_Hammer_ContactHold']);s.frame_set(1);update()
s['stage']='Fitted finger/hand contacts, glove cleanup and small-range grip checks.'
bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
report['contact_measurement_note']='Nearest-surface normal distances on source detail meshes; not watertight collision certification.'
(out/'contact-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
