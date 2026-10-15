"""Reopen a canonical master; validate it and perform an unoptimized GLB smoke round trip.
Does not save changes to the master. PNG/JSON/GLB files are review outputs only.
"""
import argparse
import hashlib
import json
import math
import sys
import struct
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[3]


def assign(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]


def evaluate(scene, frame):
    bpy.context.window.scene = scene
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def points(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(dg)
    mesh = evaluated.to_mesh()
    result = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    return result


def render_character(scene, rig, out, label, frame):
    evaluate(scene, frame)
    scene.render.filepath = str(out/(label+'.png'))
    bpy.ops.render.render(write_still=True)


def main():
    if not bpy.app.background:
        raise RuntimeError('Use a separate background Blender process.')
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', nargs='?', type=Path, default=ROOT/'output/iron-vanguard/master-v004')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out = args.directory.resolve()
    manifest = json.loads((out/'master-manifest.json').read_text())
    master = out/'iron-vanguard-master.blend'
    before_hash = hashlib.sha256(master.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(master))
    scene = bpy.data.scenes['CANONICAL_Master']
    rig, body = bpy.data.objects['IV_Rig'], bpy.data.objects['IV_Body']
    actions = {name:bpy.data.actions[name] for name in manifest['actions']}
    bind, motion, inplace = (actions[n] for n in ('IV_Bind','IV_SourceMotion_Root','IV_SourceMotion_InPlace'))
    assign(rig, bind)
    evaluate(scene,1)
    bind_points = points(body)
    lo = [min(p[i] for p in bind_points) for i in range(3)]
    hi = [max(p[i] for p in bind_points) for i in range(3)]
    transform_error = max(abs(o.matrix_world[r][c]-(1 if r==c else 0))
                          for o in (rig,body) for r in range(4) for c in range(4))
    deform_groups = {g.index for g in body.vertex_groups if g.name in rig.data.bones and rig.data.bones[g.name].use_deform}
    weights = [[g.weight for g in v.groups if g.group in deform_groups and g.weight>1e-7] for v in body.data.vertices]
    report = {'master_sha256':before_hash, 'height_m':hi[2]-lo[2], 'floor_z':lo[2],
              'object_identity_error':transform_error, 'bones':len(rig.data.bones),
              'unweighted_vertices':sum(not w for w in weights), 'max_influences':max(map(len,weights)),
              'max_weight_sum_error':max(abs(sum(w)-1) for w in weights),
              'inplace_max_xy_difference_m':0, 'inplace_max_z_difference_m':0,
              'socket_max_head_error_m':0,'socket_max_orientation_error_rad':0, 'frames_checked':239}
    assert abs(report['height_m']-manifest['height_m'])<1e-5, report
    assert abs(report['floor_z'])<1e-5 and transform_error<1e-5, report
    assert report['unweighted_vertices']==0 and report['max_weight_sum_error']<1e-4, report
    travelling = {}
    assign(rig,motion)
    for frame in range(1,240):
        evaluate(scene,frame)
        travelling[frame] = {b.name:b.matrix.copy() for b in rig.pose.bones}
        for side in ('r','l'):
            name='weapon_socket_'+side
            handle=bpy.data.objects['HANDLE_'+name]
            bone=rig.pose.bones[name]
            report['socket_max_head_error_m']=max(report['socket_max_head_error_m'],
                                                 (handle.matrix_world.translation-bone.matrix.translation).length)
            difference=handle.matrix_world.to_quaternion().rotation_difference(bone.matrix.to_quaternion()).angle
            report['socket_max_orientation_error_rad']=max(report['socket_max_orientation_error_rad'],
                                                           min(difference,2*math.pi-difference))
    assign(rig,inplace)
    for frame in range(1,240):
        evaluate(scene,frame)
        travel=travelling[frame]['root'].translation
        for pb in rig.pose.bones:
            expected=travelling[frame][pb.name].translation-travel
            delta=pb.matrix.translation-expected
            report['inplace_max_xy_difference_m']=max(report['inplace_max_xy_difference_m'],math.hypot(delta.x,delta.y))
            report['inplace_max_z_difference_m']=max(report['inplace_max_z_difference_m'],abs(delta.z))
    assert report['inplace_max_xy_difference_m']<1e-4 and report['inplace_max_z_difference_m']<1e-4, report
    assert report['socket_max_head_error_m']<1e-5 and report['socket_max_orientation_error_rad']<0.001, report
    # Validate the earlier apparent source-rest mismatch only with BOTH scenes evaluated.
    source_character=next(s for s in bpy.data.scenes if '_character_' in s.name)
    source_animation=next(s for s in bpy.data.scenes if '_animation_' in s.name)
    source_rig=next(o for o in source_animation.objects if o.type=='ARMATURE')
    assign(source_rig,bpy.data.actions[manifest['source_action']])
    evaluate(source_animation,1)
    source_rest={b.name:(source_rig.matrix_world@b.matrix_local).copy() for b in source_rig.data.bones}
    evaluate(source_character,1)
    char_rig=next(o for o in source_character.objects if o.type=='ARMATURE')
    diffs=[]
    for b in char_rig.data.bones:
        difference=(char_rig.matrix_world@b.matrix_local).to_quaternion().rotation_difference(source_rest[b.name].to_quaternion()).angle
        diffs.append(math.degrees(min(difference,2*math.pi-difference)))
    report['evaluated_source_rest_max_orientation_difference_degrees']=max(diffs)
    # Character-only views of the saved bake.
    bpy.context.window.scene=scene
    bpy.data.collections['04_Weapon_Prep'].hide_render=True
    camera=scene.camera
    camera.location=(2.8,5.2,2.2)
    camera.rotation_euler=(Vector((0,0,0.9))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale=2.7
    scene.render.resolution_x=900
    scene.render.resolution_y=900
    assign(rig,bind)
    render_character(scene,rig,out,'canonical-bind',1)
    assign(rig,motion)
    sampled_points={}
    for frame in (1,49,97,145,193,239):
        render_character(scene,rig,out,f'canonical-motion-{frame:03d}',frame)
        if frame in (1,97,239):
            sampled_points[frame]=points(body)
    # Only rig and body are selected: no source scenes, weapon staging, or review camera.
    evaluate(scene,1)
    for obj in scene.objects:
        obj.select_set(False)
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active=rig
    glb=out/'canonical-character-smoke.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,
        export_animations=True,export_animation_mode='ACTIVE_ACTIONS',
        export_frame_range=True,export_force_sampling=True,export_yup=True,
        export_all_influences=True)
    payload=glb.read_bytes()
    json_size=struct.unpack_from('<I',payload,12)[0]
    gltf=json.loads(payload[20:20+json_size])
    assert len(gltf.get('meshes',[]))==1 and len(gltf.get('skins',[]))==1, 'Reference assets leaked into GLB'
    assert len(gltf.get('scenes',[]))==1 and len(gltf.get('animations',[]))==1, 'Unexpected export scenes or clips'
    check_scene=bpy.data.scenes.new('QA_GLB_Roundtrip')
    check_scene.render.fps=60
    bpy.context.window.scene=check_scene
    previous=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported=[o for o in bpy.data.objects if o not in previous]
    # Blender's glTF importer also creates an Icosphere bone display helper in glTF_not_exported.
    skinned=[o for o in imported if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
    assert len(skinned)==1, 'Expected one imported skinned character'
    assert len([o for o in imported if o.type=='ARMATURE'])==1, 'Expected one imported rig'
    imported_body=skinned[0]
    imported_rig=next(o for o in imported if o.type=='ARMATURE')
    assert {'root','weapon_socket_r','weapon_socket_l'} <= set(imported_rig.data.bones.keys()), 'Root/socket bones lost in export'
    imported_action=imported_rig.animation_data.action
    first_frame=imported_action.frame_range[0]
    errors=[]
    for frame, expected in sampled_points.items():
        evaluate(check_scene,round(first_frame+frame-1))
        actual=points(imported_body)
        tree=KDTree(len(actual))
        for i,p in enumerate(actual):
            tree.insert(p,i)
        tree.balance()
        # glTF splits/reorders vertices at UV seams; nearest positions are appropriate for a geometry smoke check.
        stride=max(1,len(expected)//2048)
        errors.append({'source_frame':frame,'max_nearest_surface_error_m':max(tree.find(p)[2] for p in expected[::stride])})
    report['glb_roundtrip']={'path':str(glb),'bytes':glb.stat().st_size,
        'animation_frames':list(imported_action.frame_range),'sampled_geometry':errors,
        'note':'Unoptimized character-only export; not a shipping asset. Nearest-vertex sample check, not topology equivalence.'}
    assert max(e['max_nearest_surface_error_m'] for e in errors)<0.0002, report['glb_roundtrip']
    assert before_hash==hashlib.sha256(master.read_bytes()).hexdigest(), 'Master changed during review'
    for path,digest in manifest['source_hashes'].items():
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest, path
    (out/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('MASTER_VALIDATED',json.dumps(report))


if __name__=='__main__':
    main()
