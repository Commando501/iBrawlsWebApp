"""Verify grip revision against the backed-up artist session."""
import bpy,sys,json,hashlib
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action
from rig_master import update
root=Path(__file__).resolve().parents[3];out=root/'output/iron-vanguard/master-v015';source=root/'output/iron-vanguard/grip-work/user-session-before.blend'
def snapshot():
 r=bpy.data.objects['IV_Rig'];b=bpy.data.objects['IV_Body']
 return {'vertices':np.array([v.co[:] for v in b.data.vertices]),'weights':[[tuple((g.group,round(g.weight,7))) for g in v.groups] for v in b.data.vertices],'rest':{p.name:list(map(list,p.matrix_local)) for p in r.data.bones},'weapons':{n:list(map(list,bpy.data.objects[n].matrix_basis)) for n in ['IV_Hammer','IV_Sword']}}
bpy.ops.wm.open_mainfile(filepath=str(source));before=snapshot();r=bpy.data.objects['IV_Rig'];s=bpy.context.scene
motion={};set_action(r,bpy.data.actions['IV_SourceMotion_Root'])
for f in range(1,240):
 s.frame_set(f);update();motion[f]={p.name:p.matrix.copy() for p in r.pose.bones if not p.name.startswith('MCH_')}
bpy.ops.wm.open_mainfile(filepath=str(out/'iron-vanguard-master.blend'));after=snapshot();r=bpy.data.objects['IV_Rig'];s=bpy.context.scene
assert np.array_equal(before['vertices'],after['vertices'])
assert before['rest']==after['rest'];assert before['weapons']==after['weapons']
changed=[i for i,(a,b) in enumerate(zip(before['weights'],after['weights'])) if sorted(a)!=sorted(b)]
for i in changed:
 p=before['vertices'][i];assert abs(p[0])>.68 and 1.28<p[2]<1.48,(i,p)
for v in bpy.data.objects['IV_Body'].data.vertices:
 weights=[g.weight for g in v.groups if g.weight>1e-6];assert weights and len(weights)<=4 and abs(sum(weights)-1)<1e-5
set_action(r,bpy.data.actions['IV_SourceMotion_Root']);max_error=0
for f,poses in motion.items():
 s.frame_set(f);update()
 for n,m in poses.items():max_error=max(max_error,max(abs(m[i][j]-r.pose.bones[n].matrix[i][j]) for i in range(4) for j in range(4)))
assert max_error<1e-5
exec(compile(bpy.data.texts['IV_RIG_TOOLS.py'].as_string(),'IV_RIG_TOOLS.py','exec'),{'__name__':'__main__'})
for role in ['Hammer','Sword']:
 for suffix in ['ContactHold','GripCheck','NaturalHold','Grip']:
  name='IV_'+role+'_'+suffix;assert bpy.data.actions[name].use_fake_user
  bpy.ops.iv.choose_action(action_name=name)
  if suffix in ['NaturalHold','Grip']:
   assert all(p.location.length<1e-6 and abs(p.rotation_quaternion.w-1)<1e-6 for p in r.pose.bones if p.name.startswith('MCH_') and '_Hand_' in p.name)
report={'bind_geometry_preserved':True,'rest_rig_preserved':True,'weapon_transforms_preserved':True,'changed_hand_weight_vertices':len(changed),'max_source_bone_matrix_error':max_error,'source_frames_checked':239,'max_skin_influences':4,'pose_switching_and_action_persistence':True,'master_sha256':hashlib.sha256((out/'iron-vanguard-master.blend').read_bytes()).hexdigest()}
(out/'preservation-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
