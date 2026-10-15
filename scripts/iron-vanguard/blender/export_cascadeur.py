"""Build a clean centimetre-scale Cascadeur transfer from an isolated master copy.
Run in background Blender with -- --output ABSOLUTE_NEW_DIRECTORY.
"""
import bpy,sys,json,math,argparse
from pathlib import Path
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,set_pose,key_pose
from author_idles import signature,matrix_error

def refresh():bpy.context.view_layer.update()
def cm(m):
    result=m.copy();result.translation*=100;return result

def main():
    assert bpy.app.background,'Run on a copy in background Blender.'
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    out=parser.parse_args(sys.argv[sys.argv.index('--')+1:]).output.resolve();out.mkdir(exist_ok=True)
    assert not (out/'01-iron-vanguard-rig-setup.fbx').exists()
    src=bpy.data.objects['IV_Rig'];body=bpy.data.objects['IV_Body'];hammer=bpy.data.objects['IV_Hammer']
    original={a.name:signature(a) for a in bpy.data.actions};source_file=bpy.data.filepath
    set_action(src,bpy.data.actions['IV_Hammer_ElbowsCorrected']);bpy.context.scene.frame_set(1);refresh()
    names=[b.name for b in src.data.bones if b.use_deform or b.name=='root']
    rest={n:src.matrix_world@src.data.bones[n].matrix_local for n in names}
    poses={n:src.matrix_world@src.pose.bones[n].matrix for n in names}
    weapon_pose=hammer.matrix_world.copy()
    weapon_rest=rest['RightHand']@poses['RightHand'].inverted()@weapon_pose
    grip_local=weapon_pose.inverted()@poses['RightHand'].translation
    # Weapon root sits at the primary grip, its bone Y axis follows the shaft.
    wr=weapon_rest@Matrix.Rotation(math.pi/2,4,'X');wr.translation=weapon_rest@grip_local
    wp=weapon_pose@Matrix.Rotation(math.pi/2,4,'X');wp.translation=weapon_pose@grip_local
    rest['weapon_hammer']=wr;poses['weapon_hammer']=wp
    tip=wr.copy();tip.translation+=wr.to_3x3()@Vector((0,.65,0));rest['weapon_hammer_tip']=tip
    tip=wp.copy();tip.translation+=wp.to_3x3()@Vector((0,.65,0));poses['weapon_hammer_tip']=tip
    deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps);mesh=ev.to_mesh()
    expected_body=[body.matrix_world@v.co for v in mesh.vertices];ev.to_mesh_clear()
    expected_weapon=[weapon_pose@v.co for v in hammer.data.vertices]
    scene=bpy.data.scenes.new('Cascadeur_Transfer');bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=.01;scene.render.fps=60
    arm=bpy.data.armatures.new('IV_TransferSkeleton');rig=bpy.data.objects.new('IV_TransferRig',arm);scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for n,m in rest.items():
        b=arm.edit_bones.new(n)
        b.length=src.data.bones[n].length*100 if n in names else (65 if n=='weapon_hammer' else 5)
        b.matrix=cm(m)
        b.use_deform=True
    for n in names:
        parent=src.data.bones[n].parent
        if parent:arm.edit_bones[n].parent=arm.edit_bones[parent.name]
    arm.edit_bones['weapon_hammer'].parent=arm.edit_bones['root']
    arm.edit_bones['weapon_hammer_tip'].parent=arm.edit_bones['weapon_hammer']
    bpy.ops.object.mode_set(mode='OBJECT')
    def copy_mesh(obj,name,transform):
        result=obj.copy();result.data=obj.data.copy();result.name=name;result.animation_data_clear()
        result.parent=None;result.matrix_world=Matrix.Identity(4);result.constraints.clear();result.modifiers.clear()
        result.data.transform(Matrix.Scale(100,4)@transform)
        result.hide_viewport=False;result.hide_render=False;scene.collection.objects.link(result);result.hide_set(False)
        mod=result.modifiers.new('Transfer skin','ARMATURE');mod.object=rig
        return result
    dst_body=copy_mesh(body,'IV_TransferBody',body.matrix_world)
    dst_weapon=copy_mesh(hammer,'IV_TransferHammer',weapon_rest);dst_weapon.vertex_groups.clear()
    dst_weapon.vertex_groups.new(name='weapon_hammer').add(list(range(len(dst_weapon.data.vertices))),1,'REPLACE')
    for obj in (rig,dst_body,dst_weapon):obj.select_set(True)
    for obj in (dst_body,dst_weapon):
        # A neutral review material avoids external texture dependencies.
        obj.data.materials.clear()
    mat=bpy.data.materials.new('IV_TransferNeutral');mat.diffuse_color=(.5,.55,.6,1)
    for obj in (dst_body,dst_weapon):obj.data.materials.append(mat)
    settings=dict(use_selection=True,object_types={'ARMATURE','MESH'},apply_unit_scale=True,apply_scale_options='FBX_SCALE_UNITS',axis_forward='-Z',axis_up='Y',add_leaf_bones=False,use_armature_deform_only=True,armature_nodetype='NULL',mesh_smooth_type='FACE',use_mesh_modifiers=True,bake_anim_use_all_actions=False,bake_anim_use_nla_strips=False,bake_anim_simplify_factor=0,path_mode='AUTO')
    scene.frame_start=1;scene.frame_end=2;refresh()
    bpy.ops.export_scene.fbx(filepath=str(out/'01-iron-vanguard-rig-setup.fbx'),bake_anim=False,**settings)
    action=bpy.data.actions.new('IV_Cascadeur_Hammer_Hold');set_action(rig,action)
    set_pose(rig,{n:cm(m) for n,m in poses.items()});refresh()
    previous={}
    for frame in (1,2):key_pose(rig,frame,list(poses),previous)
    scene.frame_set(1);refresh()
    def mesh_error(obj,expected):
        ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh()
        assert len(m.vertices)==len(expected)
        error=max((obj.matrix_world@v.co/100-e).length for v,e in zip(m.vertices,expected));ev.to_mesh_clear();return error
    errors={'body_max_vertex_error_m':mesh_error(dst_body,expected_body),'hammer_max_vertex_error_m':mesh_error(dst_weapon,expected_weapon),'bone_max_matrix_error_cm':max(matrix_error(rig.pose.bones[n].matrix,cm(m)) for n,m in poses.items())}
    assert errors['body_max_vertex_error_m']<.0001,errors
    assert errors['hammer_max_vertex_error_m']<.0001,errors
    bpy.ops.export_scene.fbx(filepath=str(out/'02-iron-vanguard-approved-hammer-hold.fbx'),bake_anim=True,**settings)
    # Persist only the transfer scene and its single hold action.
    for other in list(bpy.data.scenes):
        if other!=scene:bpy.data.scenes.remove(other)
    for obj in list(bpy.data.objects):
        if obj not in (rig,dst_body,dst_weapon):bpy.data.objects.remove(obj,do_unlink=True)
    for a in list(bpy.data.actions):
        if a!=action:bpy.data.actions.remove(a)
    scene['purpose']='Cascadeur transfer only; source Blender master remains canonical.'
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'transfer-source.blend'),compress=True)
    report={'source_master':source_file,'source_hold':'IV_Hammer_ElbowsCorrected','rejected_attack_excluded':True,'units':'centimetres','fps':60,'bone_names':list(rest),'source_action_signatures':original,'pose_transfer_checks':errors,'expected_hold_bones_m':{n:[list(row) for row in m] for n,m in poses.items()},'cascadeur_import_verified':False,'cascadeur_control_rig_created':False}
    (out/'transfer-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(errors))
if __name__=='__main__':main()
