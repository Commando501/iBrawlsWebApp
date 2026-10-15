"""Expose existing IK grip targets without changing rig mechanics or the pose.
Run through live_call.py on a separate working copy, with a session backup first.
"""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(r'G:/git/iBrawlsWebApp')
rig=bpy.data.objects['IV_Rig']
assert 'master-v018' in bpy.data.filepath, 'Run only on the separate v018 working file'
assert not rig.get('simple_posing_controls'), 'Controls already installed'
scene=bpy.context.scene
bpy.context.view_layer.update()
original={b.name:b.matrix.copy() for b in rig.pose.bones}
weapon_before={n:bpy.data.objects[n].matrix_world.copy() for n in ('IV_Hammer','IV_Sword')}

# Reuse the actual unconstrained targets; never offer the driven proxy as a hand control.
controls=rig.data.collections.get('Grip Controls') or rig.data.collections.new('Grip Controls')
shape_collection=bpy.data.collections.get('IV_Posing_Shapes') or bpy.data.collections.new('IV_Posing_Shapes')
if shape_collection.name not in scene.collection.children:scene.collection.children.link(shape_collection)
shape_collection.hide_render=True

def shape(name,radius,diamond=False):
    verts=[];edges=[]
    for plane in range(3):
        count=4 if diamond else 32
        start=len(verts)
        for i in range(count):
            a=2*math.pi*i/count
            point=[0.,0.,0.];point[plane]=radius*math.cos(a);point[(plane+1)%3]=radius*math.sin(a)
            verts.append(point);edges.append((start+i,start+(i+1)%count))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,edges,[])
    obj=bpy.data.objects.new(name,mesh);shape_collection.objects.link(obj)
    obj.hide_render=True;obj.hide_set(True)
    return obj

hand_shape=shape('IV_Visible_Grip',.065)
elbow_shape=shape('IV_Visible_Elbow',.045,True)
weapon_shape=shape('IV_Visible_Weapon',.11,True)
for name in ('MCH_Hammer_Hand_L','MCH_Hammer_Hand_R','MCH_Sword_Hand_R'):
    bone=rig.data.bones[name]
    for coll in list(bone.collections):coll.unassign(bone)
    controls.assign(bone)
for name in ('MCH_Hammer_Hand_L','MCH_Hammer_Hand_R','MCH_Sword_Hand_R','CTRL_Hand_L','CTRL_Hand_R',
             'CTRL_Elbow_L','CTRL_Elbow_R','CTRL_Hammer','CTRL_Sword'):
    pb=rig.pose.bones[name]
    pb.custom_shape=elbow_shape if 'Elbow' in name else weapon_shape if name in ('CTRL_Hammer','CTRL_Sword') else hand_shape
    pb.use_custom_shape_bone_size=False;pb.custom_shape_scale_xyz=(1,1,1)
    pb.custom_shape_translation=(0,0,0);pb.custom_shape_rotation_euler=(0,0,0)
    pb.custom_shape_transform=None
    pb.bone.color.palette='THEME04' if name.endswith('_L') else 'THEME01' if name.endswith('_R') else 'THEME09'
    pb.lock_location=(False,False,False);pb.lock_rotation=(False,False,False)
    pb.lock_rotation_w=False;pb.lock_rotations_4d=False
    pb.lock_scale=(True,True,True)

source=rig.animation_data.action
source.use_fake_user=True
action=source.copy();action.name='IV_Hammer_Posing' if rig.get('weapon_mode')==1 else 'IV_Weapon_Posing'
action.use_fake_user=True;rig.animation_data.action=action
if action.slots:rig.animation_data.action_slot=action.slots[0]
rig['simple_posing_controls']=True
ui=(ROOT/'scripts/iron-vanguard/blender/rig_ui.py').read_text(encoding='utf-8')
t=bpy.data.texts.get('IV_RIG_TOOLS.py') or bpy.data.texts.new('IV_RIG_TOOLS.py');t.clear();t.write(ui)
ns={'__name__':'__main__'};exec(compile(ui,'IV_RIG_TOOLS.py','exec'),ns)
ns['show_posing_controls'](bpy.context,rig)
scene.tool_settings.use_keyframe_insert_auto=True
bpy.context.view_layer.update()
pose_error=max(max(abs(original[p.name][i][j]-p.matrix[i][j]) for i in range(4) for j in range(4)) for p in rig.pose.bones)
assert pose_error<1e-5, pose_error
for window in bpy.context.window_manager.windows:
    for area in window.screen.areas:
        if area.type!='VIEW_3D':continue
        area.spaces.active.show_region_ui=True
        region=next(r for r in area.regions if r.type=='WINDOW')
        with bpy.context.temp_override(window=window,area=area,region=region):
            bpy.ops.iv.select_posing_control(role='Left hand',tool='MOVE')
            bpy.ops.iv.key_hold()
        for region in area.regions:
            if region.type=='UI' and hasattr(region,'active_panel_category'):
                region.active_panel_category='iBrawls'
        area.tag_redraw()
scene['authoring_stage']='v018 simple posing controls; arm alignment and grip deformation remain unfinished'
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath,compress=True)
result={'file':bpy.data.filepath,'action':action.name,'pose_change_max':pose_error,
        'visible_controls':[b.name for b in rig.data.bones if not b.hide],
        'weapon_change_max':max(max(abs(weapon_before[n][i][j]-bpy.data.objects[n].matrix_world[i][j]) for i in range(4) for j in range(4)) for n in weapon_before)}
print(json.dumps(result))
