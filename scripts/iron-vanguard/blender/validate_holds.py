import bpy,sys,json,hashlib,math,argparse
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action
from rig_master import update,render
assert bpy.app.background
ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path)
out=ap.parse_args(sys.argv[sys.argv.index('--')+1:]).directory.resolve()
def mesh_signature():
 b=bpy.data.objects['IV_Body']
 return hashlib.sha256(repr([(tuple(v.co),[(g.group,g.weight) for g in v.groups]) for v in b.data.vertices]).encode()).hexdigest()
def curve_signature(a):
 data=[]
 for layer in a.layers:
  for strip in layer.strips:
   for slot in a.slots:
    bag=strip.channelbag(slot)
    if bag:
     for c in bag.fcurves:data.append((c.data_path,c.array_index,[(tuple(k.co),tuple(k.handle_left),tuple(k.handle_right),k.interpolation) for k in c.keyframe_points]))
 return hashlib.sha256(repr(data).encode()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(out/'user-session-before.blend'))
old_actions={a.name:curve_signature(a) for a in bpy.data.actions}
old_mesh=mesh_signature();r=bpy.data.objects['IV_Rig'];rests={b.name:list(map(list,b.matrix_local)) for b in r.data.bones}
fits={n:list(map(list,bpy.data.objects[n].matrix_basis)) for n in ['IV_Hammer','IV_Sword']}
bpy.ops.wm.open_mainfile(filepath=str(out/'iron-vanguard-master.blend'))
s=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=s;r=bpy.data.objects['IV_Rig']
assert old_mesh==mesh_signature()
assert rests=={b.name:list(map(list,b.matrix_local)) for b in r.data.bones}
assert fits=={n:list(map(list,bpy.data.objects[n].matrix_basis)) for n in fits}
assert all(curve_signature(bpy.data.actions[n])==v for n,v in old_actions.items())
report={'existing_action_curves_preserved':list(old_actions),'body_geometry_weights_preserved':True,'rig_rest_preserved':True,'user_weapon_fit_preserved':True,'poses':{}}
for role in ['Hammer','Sword']:
 set_action(r,bpy.data.actions['IV_'+role+'_NaturalHold']);s.frame_set(1);update()
 rec={}
 for side,prefix in [('R','Right'),('L','Left')]:
  error=(r.pose.bones[prefix+'Hand'].head-r.pose.bones['CTRL_Hand_'+side].matrix.translation).length
  assert error<.0005;rec[side+'_hand_target_error_m']=error
 assert max(abs(x-1) for p in r.pose.bones for x in p.matrix.to_scale())<.0001
 report['poses'][role]=rec
 for label,direction in [('three-quarter',(2,6,1)),('side',(6,.8,.5)),('back',(2,-6,.5))]:render(s,out,role.lower()+'-'+label,(0,.12,1.3),direction,1.55,(1100,1100))
# Check packaged sidebar selects both new actions.
exec(compile(bpy.data.texts['IV_RIG_TOOLS.py'].as_string(),'IV_RIG_TOOLS.py','exec'),{'__name__':'__main__'})
for role in ['Hammer','Sword']:
 bpy.ops.iv.choose_action(action_name='IV_'+role+'_NaturalHold');assert r.animation_data.action.name=='IV_'+role+'_NaturalHold'
report['sidebar_pose_selection_verified']=True
(out/'hold-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
