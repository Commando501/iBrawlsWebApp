"""Build a versioned canonical Blender master from the immutable intake.
Run only in background Blender. Existing destinations are never overwritten.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
IDENTITY = Matrix.Identity(4)


def collection(scene, name):
    result = bpy.data.collections.new(name)
    scene.collection.children.link(result)
    return result


def duplicate(source, target, name):
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    obj.animation_data_clear()
    target.objects.link(obj)
    return obj


def empty(target, name, position, parent=None):
    obj = bpy.data.objects.new(name, None)
    target.objects.link(obj)
    obj.empty_display_type = 'ARROWS'
    obj.empty_display_size = 0.06
    obj.parent = parent
    obj.location = position
    return obj


def set_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    if action and action.slots:
        rig.animation_data.action_slot = action.slots[0]


def set_pose(rig, matrices):
    # Explicit parent target matrices avoid relying on depsgraph updates between bones.
    for bone in rig.data.bones:
        if bone.name not in matrices:
            continue
        parent_args = {}
        if bone.parent:
            parent_args = {'parent_matrix': matrices[bone.parent.name],
                           'parent_matrix_local': bone.parent.matrix_local}
        basis = bone.convert_local_to_pose(matrices[bone.name], bone.matrix_local,
                                           invert=True, **parent_args)
        rig.pose.bones[bone.name].matrix_basis = basis


def key_pose(rig, frame, names, previous):
    for name in names:
        pb = rig.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        if name in previous and pb.rotation_quaternion.dot(previous[name]) < 0:
            pb.rotation_quaternion.negate()
        previous[name] = pb.rotation_quaternion.copy()
        pb.keyframe_insert('location', frame=frame, group=name)
        pb.keyframe_insert('rotation_quaternion', frame=frame, group=name)
        # This pipeline rejects non-unit scaling; don't introduce animation scale channels.
        if max(abs(s-1) for s in pb.scale) > 0.0001:
            raise RuntimeError(f'Unexpected animated scale on {name}: {tuple(pb.scale)}')
        pb.scale = (1, 1, 1)


def linear_keys(action):
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag = strip.channelbag(slot)
                if bag:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'LINEAR'


def main():
    if not bpy.app.background:
        raise RuntimeError('Use a separate background Blender process; this opens the intake file.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--intake', type=Path, default=ROOT/'output/iron-vanguard/intake')
    parser.add_argument('--output', type=Path, default=ROOT/'output/iron-vanguard/master-v004')
    parser.add_argument('--height', type=float, default=1.8)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if not 0.5 <= args.height <= 4:
        raise ValueError('Expected a character height between 0.5 and 4 metres.')
    out = args.output.resolve()
    blend = out/'iron-vanguard-master.blend'
    if blend.exists():
        raise FileExistsError(f'Preserving existing master {blend}. Use a new --output directory.')
    intake = args.intake.resolve()
    audit = json.loads((intake/'source-audit.json').read_text(encoding='utf-8'))
    for asset in audit['assets']:
        if hashlib.sha256(Path(asset['path']).read_bytes()).hexdigest() != asset['sha256']:
            raise RuntimeError(f'Source changed since intake: {asset["path"]}')
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(intake/'iron-vanguard-source-review.blend'))
    sources = {a['role']: bpy.data.scenes[a['scene']] for a in audit['assets']}
    source_world = {}
    for role, source_scene in sources.items():
        bpy.context.window.scene = source_scene
        source_scene.frame_set(1)
        bpy.context.view_layer.update()
        source_world[role] = {o.name: o.matrix_world.copy() for o in source_scene.objects}
    character = next(o for o in sources['character'].objects if o.type == 'ARMATURE')
    source_mesh = next(o for o in sources['character'].objects if o.type == 'MESH')
    motion_rig = next(o for o in sources['animation'].objects if o.type == 'ARMATURE')
    source_action = max(bpy.data.actions, key=lambda a: a.frame_range[1]-a.frame_range[0])
    source_names = [b.name for b in character.data.bones]
    if set(source_names) != set(motion_rig.data.bones.keys()):
        raise RuntimeError('Source and character bone names differ; explicit mapping required.')

    # Evaluate world rest geometry directly, not the current source action.
    points = [source_world['character'][source_mesh.name] @ v.co for v in source_mesh.data.vertices]
    lo = Vector([min(p[i] for p in points) for i in range(3)])
    hi = Vector([max(p[i] for p in points) for i in range(3)])
    factor = args.height/(hi.z-lo.z)
    origin = Vector(((hi.x+lo.x)/2, (hi.y+lo.y)/2, lo.z))
    transform = Matrix.Scale(factor, 4) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation(-origin)
    inv_transform = transform.inverted()

    scene = bpy.data.scenes.new('CANONICAL_Master')
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene.render.fps = 60
    scene.frame_start = 1
    scene.frame_end = round(source_action.frame_range[1])
    scene['canonical_height_m'] = args.height
    scene['canonical_forward'] = '+Y (GLB -Z)'
    scene['canonical_up'] = '+Z (GLB +Y)'
    scene['stage'] = 'Canonical FK foundation; grip markers provisional; no finger rig or IK yet.'
    body_col = collection(scene, '01_Character')
    rig_col = collection(scene, '02_Rig')
    socket_col = collection(scene, '03_Socket_Handles')
    weapon_col = collection(scene, '04_Weapon_Prep')
    guide_col = collection(scene, '05_Review')
    rig = duplicate(character, rig_col, 'IV_Rig')
    rig.data.name = 'IV_Skeleton'
    rig.parent = None
    rig.data.transform(transform @ source_world['character'][character.name])
    rig.matrix_world = IDENTITY
    rig.show_in_front = True
    rig.data.display_type = 'OCTAHEDRAL'
    mesh = duplicate(source_mesh, body_col, 'IV_Body')
    mesh.data.name = 'IV_Body_SourceTopology'
    mesh.data.transform(transform @ source_world['character'][source_mesh.name])
    mesh.parent = rig
    mesh.matrix_parent_inverse = IDENTITY
    mesh.matrix_basis = IDENTITY
    for modifier in mesh.modifiers:
        if modifier.type == 'ARMATURE':
            modifier.object = rig
    for pb in rig.pose.bones:
        pb.matrix_basis = IDENTITY
        pb.rotation_mode = 'QUATERNION'
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    root = rig.data.edit_bones.new('root')
    root.head = (0, 0, 0)
    root.tail = (0, 0.20, 0)
    root.use_deform = False
    rig.data.edit_bones['Hips'].parent = root
    for side, hand in [('r', 'RightHand'), ('l', 'LeftHand')]:
        parent = rig.data.edit_bones[hand]
        socket = rig.data.edit_bones.new('weapon_socket_'+side)
        socket.head = parent.head.lerp(parent.tail, 0.38)
        socket.tail = socket.head + (parent.tail-parent.head).normalized()*0.06
        socket.align_roll(parent.z_axis)
        socket.parent = parent
        socket.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    deform_collection = rig.data.collections.new('Deform / source FK')
    controls_collection = rig.data.collections.new('Root')
    sockets_collection = rig.data.collections.new('Sockets / provisional')
    for name in source_names:
        deform_collection.assign(rig.data.bones[name])
    controls_collection.assign(rig.data.bones['root'])
    for side in ('r','l'):
        name = 'weapon_socket_'+side
        sockets_collection.assign(rig.data.bones[name])
        handle = empty(socket_col, 'HANDLE_'+name, (0,0,0))
        handle.parent = rig
        handle.parent_type = 'BONE'
        handle.parent_bone = name
        handle.matrix_basis = Matrix.Translation((0,-rig.data.bones[name].length,0))
        handle['purpose'] = 'Socket head visualization; edit the socket bone to fit the palm.'
    rig['canonical_source'] = str(intake/'iron-vanguard-source-review.blend')
    rig['retarget_method'] = 'F * source_pose * source_rest_inverse * F_inverse * target_rest'
    rig['motion_policy'] = 'root carries XY translation; Hips retains vertical motion and rotation'
    rig['hand_status'] = 'Source open-hand weights retained. Finger rigging/grip sculpting pending.'

    # Keep original source actions untouched; new clean rest and compensated actions belong to IV_Rig.
    rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    set_action(rig, None)
    set_pose(rig, rest)
    key_pose(rig, 1, list(rest), {})
    bind = rig.animation_data.action
    bind.name = 'IV_Bind'
    bind.use_fake_user = True
    linear_keys(bind)

    set_action(motion_rig, source_action)
    source_scene = sources['animation']
    bpy.context.window.scene = source_scene
    source_scene.frame_set(1)
    bpy.context.view_layer.update()
    source_rest = {b.name: (motion_rig.matrix_world @ b.matrix_local).copy() for b in motion_rig.data.bones}
    sampled = []
    for frame in range(1, scene.frame_end+1):
        bpy.context.window.scene = source_scene
        source_scene.frame_set(frame)
        bpy.context.view_layer.update()
        pose = {n: transform @ motion_rig.matrix_world @ motion_rig.pose.bones[n].matrix
                   @ source_rest[n].inverted() @ inv_transform @ rest[n] for n in source_names}
        sampled.append((frame, pose))
    first_hips = sampled[0][1]['Hips'].translation.copy()
    bpy.context.window.scene = scene
    set_action(rig, None)
    previous = {}
    keyed_names = ['root']+source_names
    for frame, matrices in sampled:
        travel = matrices['Hips'].translation-first_hips
        matrices['root'] = Matrix.Translation((travel.x,travel.y,0)) @ rest['root']
        set_pose(rig, matrices)
        key_pose(rig, frame, keyed_names, previous)
    action = rig.animation_data.action
    action.name = 'IV_SourceMotion_Root'
    action.use_fake_user = True
    linear_keys(action)
    # A separate in-place action retains all body motion relative to the motion root.
    in_place = action.copy()
    in_place.name = 'IV_SourceMotion_InPlace'
    in_place.use_fake_user = True
    for layer in in_place.layers:
        for strip in layer.strips:
            for slot in in_place.slots:
                bag = strip.channelbag(slot)
                if bag:
                    for curve in bag.fcurves:
                        if curve.data_path == 'pose.bones["root"].location':
                            for key in curve.keyframe_points:
                                key.co.y = 0
                                key.handle_left.y = 0
                                key.handle_right.y = 0

    # Verify every baked frame against the independent source-space skin deformation matrices.
    errors = {'max_joint_position_m': 0, 'max_deformation_matrix_element': 0,
              'checked_frames': len(sampled), 'checked_source_bones': len(source_names)}
    for frame, expected in sampled:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        for name in source_names:
            actual = rig.pose.bones[name].matrix
            errors['max_joint_position_m'] = max(errors['max_joint_position_m'],
                                                 (actual.translation-expected[name].translation).length)
            got = actual @ rest[name].inverted()
            want = expected[name] @ rest[name].inverted()
            errors['max_deformation_matrix_element'] = max(errors['max_deformation_matrix_element'],
                max(abs(got[r][c]-want[r][c]) for r in range(4) for c in range(4)))
    if errors['max_joint_position_m'] > 0.0001 or errors['max_deformation_matrix_element'] > 0.0001:
        raise RuntimeError(f'Retarget validation failed: {errors}')

    # Source-proportion weapons, with meaningful mesh origins. Fitting remains a separate authoring pass.
    weapons = {}
    specs = {
        'hammer': {'grip': (0,0,-0.50), 'support': (0,0,-0.12), 'tip': (-0.40,0,0.65),
                   'turn': Matrix.Identity(4), 'stage': (-1.45,0,0.65)},
        'sword': {'grip': (0,0,0.04), 'support': None, 'tip': (-0.21,0,0.075),
                  'turn': Matrix.Rotation(-math.pi/2,4,'Z'), 'stage': (1.30,0,0.90)}
    }
    for role, spec in specs.items():
        src = next(o for o in sources[role].objects if o.type == 'MESH')
        group = empty(weapon_col, 'PREP_'+role.title(), spec['stage'])
        if role == 'sword':
            group.rotation_euler.z = math.pi/2  # Side-on presentation; assembly-local +Y is blade-forward.
        group['status'] = 'Provisional grip position and source-relative scale; not fitted to closed fingers.'
        group['attach_to'] = 'weapon_socket_r'
        weapon = duplicate(src, weapon_col, 'IV_'+role.title())
        weapon.parent = group
        conversion = Matrix.Scale(factor,4) @ spec['turn'] @ Matrix.Translation(-Vector(spec['grip']))
        weapon.data.transform(conversion @ source_world[role][src.name])
        weapon.matrix_parent_inverse = IDENTITY
        weapon.matrix_basis = IDENTITY
        marker = empty(weapon_col, role+'_grip_primary', (0,0,0), group)
        marker['status'] = 'Provisional; assembly origin equals primary grip.'
        tip = conversion @ Vector(spec['tip'])
        empty(weapon_col, role+'_impact' if role=='hammer' else role+'_tip', tip, group)
        if spec['support']:
            empty(weapon_col, role+'_grip_support', conversion @ Vector(spec['support']), group)
        weapons[role] = {'source_uniform_scale':factor, 'source_grip':spec['grip'],
                         'assembly':group.name, 'mesh':weapon.name, 'status':'provisional'}
    # Setup a review camera outside the character export selection.
    data = bpy.data.cameras.new('Review_Camera')
    cam = bpy.data.objects.new('Review_Camera', data)
    guide_col.objects.link(cam)
    cam.location = (3.6,6.5,2.8)
    cam.rotation_euler = (Vector((0,0,args.height/2))-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = 4.4
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('IV_Review_World')
    scene.world.color = (0.035,0.042,0.055)
    scene.display.shading.background_type = 'WORLD'
    scene.timeline_markers.new('Source motion start',frame=1)
    scene.timeline_markers.new('Source motion end',frame=scene.frame_end)
    set_action(rig, bind)
    scene.frame_set(1)
    bpy.context.view_layer.update()
    for obj in scene.objects:
        obj.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_location = (0,0,args.height/2)
                area.spaces.active.region_3d.view_distance = 3.6
                area.spaces.active.region_3d.view_rotation = cam.rotation_euler.to_quaternion()
                area.spaces.active.clip_end = 100
    notes = bpy.data.texts.new('START_HERE')
    notes.write('IRON VANGUARD CANONICAL MASTER\n\n'
                'Scene: CANONICAL_Master. Rig: IV_Rig. Mesh: IV_Body.\n'
                f'Height: {args.height} m. +Y forward / +Z up in Blender; -Z forward / +Y up in GLB.\n'
                'Actions: IV_Bind, IV_SourceMotion_Root, IV_SourceMotion_InPlace (60 fps, frames 1-239).\n'
                'Select IV_Rig and choose an action in the Action Editor to preview.\n'
                'root owns horizontal motion; Hips retains vertical motion and rotation.\n'
                'Sockets are editable non-deforming bones. Weapons are staged at source-relative scale.\n'
                'Grips are provisional: hands are open, no finger controls or arm/leg IK yet.\n'
                'Source scenes/actions remain available for reference. Save new versions before hand editing.\n'
                'Original dense topology and normal map retained; materials and deformation need artistic cleanup.\n')
    report = {'height_m':args.height, 'scale_from_source':factor, 'source_to_canonical':list(map(list,transform)),
              'blend':str(blend), 'canonical_scene':scene.name, 'rig':rig.name, 'mesh':mesh.name,
              'axes':{'blender_forward':'+Y','blender_up':'+Z','gltf_forward':'-Z','gltf_up':'+Y'},
              'bones':list(rest), 'source_action':source_action.name,
              'actions':[bind.name,action.name,in_place.name], 'fps':60, 'frames':[1,scene.frame_end],
              'retarget_validation':errors, 'weapon_prep':weapons,
              'source_hashes':{a['path']:a['sha256'] for a in audit['assets']},
              'limitations':['Open hands; finger rigging pending','Weapon grip positions provisional',
                             'No animator IK controls yet','Source weights retained; surface quality unapproved',
                             'No gameplay integration or runtime optimization']}
    # Fit the entire staged asset set in camera space; staging height differs from body height.
    bpy.context.view_layer.update()
    all_points = [obj.matrix_world @ Vector(corner) for obj in scene.objects if obj.type == 'MESH'
                  for corner in obj.bound_box]
    low = Vector([min(v[i] for v in all_points) for i in range(3)])
    high = Vector([max(v[i] for v in all_points) for i in range(3)])
    center = (low+high)/2
    cam.location = center+Vector((3.6,6.5,2.0))
    cam.rotation_euler = (center-cam.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    local = [cam.matrix_world.inverted() @ point for point in all_points]
    width = max(v.x for v in local)-min(v.x for v in local)
    height = max(v.y for v in local)-min(v.y for v in local)
    offset = Vector(((max(v.x for v in local)+min(v.x for v in local))/2,
                     (max(v.y for v in local)+min(v.y for v in local))/2, 0))
    cam.location += cam.rotation_euler.to_quaternion() @ offset
    cam.data.ortho_scale = max(width,height*scene.render.resolution_x/scene.render.resolution_y)*1.15
    for clip in (bind,action,in_place):
        clip.asset_mark()
        clip.asset_data.description = 'Iron Vanguard canonical skeleton; 60 FPS. Source-derived motion needs artistic refinement.'
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    (out/'master-manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    scene.render.filepath = str(out/'master-overview.png')
    bpy.ops.render.render(write_still=True)
    print('CANONICAL_MASTER_COMPLETE',json.dumps(report['retarget_validation']))


if __name__ == '__main__':
    main()
