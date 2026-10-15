"""Check the saved transfer FBX by reimporting into empty Blender scenes."""
import bpy,json,sys
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree
out=Path(bpy.data.filepath).parent
report=json.loads((out/'transfer-report.json').read_text(encoding='utf-8'))
scene=bpy.context.scene;scene.frame_set(1);bpy.context.view_layer.update()
reference={}
for name in ['IV_TransferBody','IV_TransferHammer']:
 obj=bpy.data.objects[name];ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh()
 reference[name]=[obj.matrix_world@v.co/100 for v in m.vertices];ev.to_mesh_clear()
results={}
for file in ['01-iron-vanguard-rig-setup.fbx','02-iron-vanguard-approved-hammer-hold.fbx']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.fbx(filepath=str(out/file),use_anim=True,automatic_bone_orientation=False)
 bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
 rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
 assert set(rig.data.bones.keys())==set(report['bone_names'])
 entry={'bones':len(rig.data.bones),'meshes':len([o for o in bpy.context.scene.objects if o.type=='MESH']),'armature_world_scale':list(rig.matrix_world.to_scale())}
 assert entry['meshes']==2
 assert not any(n.startswith(('CTRL_','MCH_')) for n in rig.data.bones.keys())
 if file.startswith('02'):
  errors={}
  for name,points in reference.items():
   tree=KDTree(len(points))
   for i,p in enumerate(points):tree.insert(p,i)
   tree.balance();obj=bpy.data.objects[name];ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh()
   errors[name]=max(tree.find(obj.matrix_world@v.co)[2] for v in m.vertices);ev.to_mesh_clear()
  assert max(errors.values())<.0001,errors
  entry['roundtrip_mesh_error_m']=errors
  expected=report['expected_hold_bones_m'];error=max((rig.matrix_world@rig.pose.bones[n].head-Vector([expected[n][i][3] for i in range(3)])).length for n in expected)
  assert error<.0001,error
  entry['roundtrip_joint_position_error_m']=error
 results[file]=entry
report['fbx_blender_roundtrip']=results
(out/'transfer-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(results))
