"""Replace the rejected outward hand offsets with reviewed grip placement corrections."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,linear_keys
from rig_master import render,update
root=Path(__file__).resolve().parents[3];out=root/'output/iron-vanguard/master-v016';out.mkdir(exist_ok=True);dest=out/'iron-vanguard-master.blend';assert not dest.exists()
bpy.ops.wm.open_mainfile(filepath=str(root/'output/iron-vanguard/grip-correction/user-session-before.blend'))
r=bpy.data.objects['IV_Rig'];s=bpy.context.scene;report={'status':'Grip placement correction; close-up finger deformation is still unfinished.','poses':{}}
for role in ['Hammer','Sword']:
 set_action(r,bpy.data.actions['IV_'+role+'_NaturalHold']);s.frame_set(1);update()
 original_weapon=bpy.data.objects['IV_'+role].matrix_world.copy();action=r.animation_data.action.copy();action.name='IV_'+role+'_GripCorrection';action.use_fake_user=True;set_action(r,action)
 weapon=r.pose.bones['CTRL_'+role].matrix.copy()
 sides=['R','L'] if role=='Hammer' else ['R']
 for side in sides:
  p=r.pose.bones['MCH_'+role+'_Hand_'+side]
  if role=='Hammer':
   offset=Vector((.010 if side=='R' else -.020,-.018,-.025 if side=='L' else 0))
   m=p.matrix.copy();m.translation+=weapon.to_3x3()@offset;p.matrix=m
   p.keyframe_insert('location',frame=1);p.keyframe_insert('rotation_quaternion',frame=1)
  ctrl=r.pose.bones['CTRL_Hand_'+side];ctrl['grip']=.80 if role=='Hammer' else .88;ctrl['thumb_opposition']=.8
  for digit in ['index','middle','ring','pinky','thumb']:ctrl[digit+'_curl']=0.
  for name in ['grip','thumb_opposition','index_curl','middle_curl','ring_curl','pinky_curl','thumb_curl']:ctrl.keyframe_insert(data_path=f'["{name}"]',frame=1)
 if role=='Sword':
  p=r.pose.bones['RightShoulder'];m=p.matrix.copy();point=m.translation.copy();m=Matrix.Rotation(math.radians(6),4,'Z')@m;m.translation=point;p.matrix=m;p.keyframe_insert('rotation_quaternion',frame=1)
 s.frame_set(1);update()
 assert max(abs(original_weapon[i][j]-bpy.data.objects['IV_'+role].matrix_world[i][j]) for i in range(4) for j in range(4))<1e-6
 render(s,out,role.lower()+'-overview',(0,.15,1.32),(2,6,1),1.6,(1100,1100))
 for side in sides:
  center=r.pose.bones['RightHand' if side=='R' else 'LeftHand'].head
  for label,d in [('front',(2,3,2)),('reverse',(-2,3,.5))]:render(s,out,role.lower()+'-'+side+'-'+label,center,d,.30,(1000,1000))
 # Keep the earlier movement test, replacing its incorrect hand offsets and digit settings.
 targets={p.name:p.matrix_basis.copy() for p in r.pose.bones if p.name.startswith('MCH_') and '_Hand_' in p.name}
 props={side:{k:r.pose.bones['CTRL_Hand_'+side][k] for k in ['grip','thumb_opposition','index_curl','middle_curl','ring_curl','pinky_curl','thumb_curl']} for side in ['R','L']}
 shoulder=r.pose.bones['RightShoulder'].matrix_basis.copy()
 clip=bpy.data.actions['IV_'+role+'_GripCheck'].copy();clip.name='IV_'+role+'_CorrectedGripCheck';clip.use_fake_user=True;set_action(r,clip)
 for name,m in targets.items():
  p=r.pose.bones[name];p.matrix_basis=m;p.keyframe_insert('location',frame=1);p.keyframe_insert('rotation_quaternion',frame=1)
 for side,values in props.items():
  ctrl=r.pose.bones['CTRL_Hand_'+side]
  for name,v in values.items():ctrl[name]=v;ctrl.keyframe_insert(data_path=f'["{name}"]',frame=1)
 p=r.pose.bones['RightShoulder'];p.matrix_basis=shoulder;p.keyframe_insert('rotation_quaternion',frame=1)
 max_error=0.
 for frame in range(1,92):
  s.frame_set(frame);update()
  for side,prefix in [('R','Right'),('L','Left')]:max_error=max(max_error,(r.pose.bones[prefix+'Hand'].head-r.pose.bones['CTRL_Hand_'+side].matrix.translation).length)
 assert max_error<.001,(role,max_error)
 report['poses'][role]={'attachment_frames_checked':91,'max_hand_target_error_m':max_error,'weapon_placement_preserved':True}
text=bpy.data.texts['IV_RIG_TOOLS.py'];text.clear();text.write((Path(__file__).parent/'rig_ui.py').read_text())
notes=bpy.data.texts['START_HERE'];notes.write('\nGRIP CORRECTION v016\nThe v015 automatic contact fit was rejected: hands closed beside the handle.\nUse Hammer grip correction / Sword grip correction. These restore centered placement; detailed finger mesh deformation remains unfinished.\nThe original and rejected actions are retained for recovery, but the rejected fit is no longer a sidebar preset.\n')
set_action(r,bpy.data.actions['IV_Hammer_GripCorrection']);s.frame_set(1);update()
s['stage']='Grip placement correction after rejected v015 fit; hand deformation still requires rebuilding/polish.'
bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
(out/'correction-review.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
