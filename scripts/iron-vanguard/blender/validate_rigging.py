"""Validate an upgraded rig without saving changes to its master."""
import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action
from rig_master import render, update

ROOT=Path(__file__).resolve().parents[3]


def eval_points(obj):
    ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
    points=[ev.matrix_world@v.co for v in mesh.vertices];ev.to_mesh_clear();return points


def frame(scene,number):
    scene.frame_set(number);update()


def assert_close(value,tolerance,label):
    if value>tolerance:raise AssertionError(f'{label}: {value} > {tolerance}')


def main():
    if not bpy.app.background:raise RuntimeError('Background Blender required.')
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
    out=args.directory.resolve();master=out/'iron-vanguard-master.blend'
    manifest=json.loads((out/'rigging-manifest.json').read_text())
    source=Path(manifest['source']);master_hash=hashlib.sha256(master.read_bytes()).hexdigest()
    assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['source_sha256']
    # Source animation comparison is independent of the rig builder's in-memory state.
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=scene
    rig=bpy.data.objects['IV_Rig'];body=bpy.data.objects['IV_Body']
    original_vertices=np.array([v.co[:] for v in body.data.vertices])
    source_motion={}
    set_action(rig,bpy.data.actions['IV_SourceMotion_Root'])
    for f in range(1,240):
        frame(scene,f)
        source_motion[f]={b.name:b.matrix.copy() for b in rig.pose.bones if not b.name.startswith('weapon_socket')}
    bpy.ops.wm.open_mainfile(filepath=str(master))
    scene=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=scene
    rig=bpy.data.objects['IV_Rig'];body=bpy.data.objects['IV_Body']
    report={'master_sha256':master_hash,'source_sha256':manifest['source_sha256'],
            'source_motion_max_matrix_error':0.,'resize_cases':[],'finger_motion':{},'ik':{}}
    assert_close(float(np.abs(np.array([v.co[:] for v in body.data.vertices])-original_vertices).max()),1e-7,'Bind mesh changed')
    digits=[b for b in rig.data.bones if b.name.startswith('DEF_')]
    assert len(digits)==30,'Expected three joints per digit on both hands'
    for b in digits:
        index=body.vertex_groups[b.name].index
        assert sum(any(g.group==index and g.weight>1e-5 for g in v.groups) for v in body.data.vertices)>0,b.name
    for v in body.data.vertices:
        weights=[g.weight for g in v.groups if g.weight>1e-6]
        assert len(weights)<=4 and weights and abs(sum(weights)-1)<1e-5,'Invalid vertex weights'
    set_action(rig,bpy.data.actions['IV_SourceMotion_Root'])
    for f,expected in source_motion.items():
        frame(scene,f)
        for name,matrix in expected.items():
            actual=rig.pose.bones[name].matrix
            err=max(abs(actual[r][c]-matrix[r][c]) for r in range(4) for c in range(4))
            report['source_motion_max_matrix_error']=max(report['source_motion_max_matrix_error'],err)
    assert_close(report['source_motion_max_matrix_error'],1e-5,'Source bone animation changed')
    # Finger drivers produce real, nonzero phalanx motion for both hands.
    set_action(rig,bpy.data.actions['IV_Bind']);frame(scene,1)
    for side in ['R','L']:
        ctrl=rig.pose.bones['CTRL_Hand_'+side]
        ctrl['grip']=0.;ctrl['thumb_opposition']=0.;update()
        before={d:rig.pose.bones[f'DEF_{d}_03_{side}'].tail.copy() for d in ['Index','Middle','Ring','Pinky','Thumb']}
        ctrl['grip']=1.;ctrl['thumb_opposition']=.85;update()
        for d,p in before.items():
            dist=(rig.pose.bones[f'DEF_{d}_03_{side}'].tail-p).length
            report['finger_motion'][d+'_'+side]=dist
            assert dist>.02,('Finger did not curl',d,side,dist)
    # The current user sizes are the default (scale 1) and keep both grip anchors in contact.
    cases=[(1,1,1),(.85,.85,.85),(1.15,1.15,1.15),(.9,1.1,1.05)]
    for role in ['Hammer','Sword']:
        set_action(rig,bpy.data.actions['IV_'+role+'_Grip']);frame(scene,1)
        for size in cases:
            for axis,value in zip('xyz',size):rig[role.lower()+'_size_'+axis]=value
            update()
            ctrl=rig.pose.bones['CTRL_'+role]
            primary=bpy.data.objects[role.lower()+'_grip_primary'].matrix_world.translation
            primary_error=(rig.pose.bones['weapon_socket_r'].matrix.translation-primary).length
            record={'weapon':role,'size':size,'primary_error_m':primary_error}
            assert_close(primary_error,.0002,'Primary grip lost')
            assert_close((primary-ctrl.matrix.translation).length,1e-5,'Weapon origin differs from controller')
            if role=='Hammer':
                support=bpy.data.objects['hammer_grip_support'].matrix_world.translation
                anchor=rig.pose.bones['MCH_Hammer_Anchor_L'].matrix.translation
                record['support_marker_error_m']=(support-anchor).length
                record['support_hand_error_m']=(support-rig.pose.bones['weapon_socket_l'].matrix.translation).length
                assert_close(record['support_marker_error_m'],1e-5,'Support marker failed to resize')
                assert_close(record['support_hand_error_m'],.0002,'Support hand lost')
            report['resize_cases'].append(record)
        for axis in 'xyz':rig[role.lower()+'_size_'+axis]=1.
        update()
        # Reverse and side views expose fingers/guard contact hidden in the front overview.
        hand=rig.pose.bones['RightHand'].matrix.translation
        render(scene,out,role.lower()+'-grip-reverse',hand,(-2,3,.5),.40)
        if role=='Hammer':
            hand=rig.pose.bones['LeftHand'].matrix.translation
            render(scene,out,'hammer-support-hand',hand,(-2,3,2),.40)
    # Exercise the packaged UI and its no-pop transition into independent IK control.
    module_path=Path(__file__).parent/'rig_ui.py'
    spec=importlib.util.spec_from_file_location('iv_rig_ui',module_path)
    ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui);ui.register()
    bpy.ops.iv.choose_action(action_name='IV_Hammer_Grip')
    before={n:rig.pose.bones[n].matrix.translation.copy() for n in ['RightHand','LeftHand','RightFoot','LeftFoot']}
    bpy.ops.iv.free_ik();update()
    report['ik']['free_ik_transition_max_error_m']=max((rig.pose.bones[n].matrix.translation-p).length for n,p in before.items())
    assert_close(report['ik']['free_ik_transition_max_error_m'],.0005,'Free IK transition popped')
    # Move each independent target within reach and check endpoint tracking and no bone stretch.
    for side,prefix in [('R','Right'),('L','Left')]:
        for part,delta in [('Hand',Vector((0,.035,.015))),('Foot',Vector((0,.04,.05)))]:
            pb=rig.pose.bones['CTRL_'+part+'_'+side]
            matrix=pb.matrix.copy();matrix.translation+=delta;pb.matrix=matrix
            pb.keyframe_insert('location',frame=scene.frame_current)
            update()
            error=(rig.pose.bones[prefix+part].matrix.translation-pb.matrix.translation).length
            report['ik'][part+'_'+side+'_target_error_m']=error
            assert_close(error,.0003,'IK endpoint failed to follow')
    for pb in rig.pose.bones:
        if not pb.name.startswith('MCH_'):
            assert_close(max(abs(s-1) for s in pb.matrix.to_scale()),.0001,'Unexpected bone stretch')

    # Export and reimport evaluated finger skinning in the hammer carry pose.
    bpy.ops.iv.choose_action(action_name='IV_Hammer_Grip');update()
    expected=eval_points(body)
    for obj in scene.objects:obj.select_set(False)
    body.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
    glb=out/'rigged-grip-smoke.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,
        export_animation_mode='ACTIVE_ACTIONS',export_animations=True,export_force_sampling=True,
        export_frame_range=True,export_all_influences=True)
    payload=glb.read_bytes();n=struct.unpack_from('<I',payload,12)[0];gltf=json.loads(payload[20:20+n])
    assert len(gltf['meshes'])==1 and len(gltf['skins'])==1,'Unexpected assets in character export'
    qa=bpy.data.scenes.new('QA_Rig_Roundtrip');qa.render.fps=60;bpy.context.window.scene=qa
    before_objects=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    new=[o for o in bpy.data.objects if o not in before_objects]
    check_body=next(o for o in new if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
    check_rig=next(o for o in new if o.type=='ARMATURE')
    if check_rig.animation_data and check_rig.animation_data.action:
        qa.frame_set(round(check_rig.animation_data.action.frame_range[0]))
    update()
    actual=eval_points(check_body);tree=KDTree(len(actual))
    for i,p in enumerate(actual):tree.insert(p,i)
    tree.balance()
    error=max(tree.find(p)[2] for p in expected[::max(1,len(expected)//4096)])
    report['glb_roundtrip']={'bytes':glb.stat().st_size,'max_sampled_surface_error_m':error,
        'note':'Character-only unoptimized baked carry smoke export, not a runtime-ready control-rig export.'}
    assert_close(error,.0003,'Export changed skinned grip pose')
    assert hashlib.sha256(master.read_bytes()).hexdigest()==master_hash,'Validation changed the master'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['source_sha256'],'User source changed'
    (out/'rigging-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('RIGGING_VALIDATED',json.dumps(report))


if __name__=='__main__':main()
