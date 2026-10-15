"""Render and inspect an existing intake without changing its saved Blender file."""
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[3]
out = Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else ROOT / 'output/iron-vanguard/intake'
if not bpy.app.background:
    raise RuntimeError('Run in a separate background Blender process.')
bpy.ops.wm.open_mainfile(filepath=str(out / 'iron-vanguard-source-review.blend'))
details = {}
def render(scene, name, direction=(0,-1,0.18), frame=None):
    bpy.context.window.scene = scene
    if frame is not None:
        scene.frame_set(frame)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    points = [o.evaluated_get(dg).matrix_world @ Vector(c) for o in scene.objects if o.type == 'MESH' for c in o.evaluated_get(dg).bound_box]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    center = (low+high)/2
    data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector(direction).normalized() * max(high-low) * 3
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = max(high-low)*1.25
    scene.camera = camera
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.background_type = 'WORLD'
    scene.world = bpy.data.worlds.new(name+'World')
    scene.world.color = (0.045,0.045,0.055)
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(out / (name+'.png'))
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)

scenes = {role: next(s for s in bpy.data.scenes if '_'+role+'_' in s.name) for role in ('character','animation','hammer','sword')}
for role in ('character','hammer','sword'):
    scene = scenes[role]
    details[role] = [{'object': o.name, 'color_attributes': [a.name for a in o.data.color_attributes],
                     'materials': [{'name': m.name, 'nodes': [n.type for n in m.node_tree.nodes] if m.node_tree else []}
                                   for m in o.data.materials if m]} for o in scene.objects if o.type == 'MESH']
    render(scene, role+'-front')
character = next(o for o in scenes['character'].objects if o.type == 'ARMATURE')
animation = next(o for o in scenes['animation'].objects if o.type == 'ARMATURE')
# FBX object animation can supply a 90-degree axis conversion. Evaluate each owning scene
# before comparing world-space rest bases; inactive-scene matrix_world values can be stale.
source_action = max(bpy.data.actions, key=lambda a: a.frame_range[1]-a.frame_range[0])
animation.animation_data.action = source_action
if source_action.slots:
    animation.animation_data.action_slot = source_action.slots[0]
bpy.context.window.scene = scenes['character']
scenes['character'].frame_set(1)
bpy.context.view_layer.update()
character_world_rest = {b.name:(character.matrix_world @ b.matrix_local).copy() for b in character.data.bones}
bpy.context.window.scene = scenes['animation']
scenes['animation'].frame_set(1)
bpy.context.view_layer.update()
animation_world_rest = {b.name:(animation.matrix_world @ b.matrix_local).copy() for b in animation.data.bones}
names_match = set(character.data.bones.keys()) == set(animation.data.bones.keys())
max_delta = max(abs(character.data.bones[b.name].matrix_local[r][c]-b.matrix_local[r][c])
                for b in animation.data.bones for r in range(4) for c in range(4)) if names_match else None
angles = {}
if names_match:
    for b in animation.data.bones:
        q1 = character_world_rest[b.name].to_quaternion()
        q2 = animation_world_rest[b.name].to_quaternion()
        angle = q1.rotation_difference(q2).angle
        angles[b.name] = math.degrees(min(angle, 2*math.pi-angle))
details['rig_compatibility'] = {'bone_names_match': names_match, 'max_rest_matrix_element_delta': max_delta,
                                'world_rest_orientation_difference_degrees': angles,
                                'note': 'World bases evaluated in each source scene; raw local basis differences alone do not establish incompatibility.'}
action = max(bpy.data.actions, key=lambda a: a.frame_range[1]-a.frame_range[0])
animation.animation_data.action = action
if action.slots:
    animation.animation_data.action_slot = action.slots[0]
scene = scenes['animation']
details['motion_samples'] = []
for frame in (1,49,97,145,193,239):
    render(scene, f'animation-{frame:03d}', frame=frame)
    details['motion_samples'].append({'frame': frame, 'hips_world': list(animation.matrix_world @ animation.pose.bones['Hips'].matrix.translation)})
(out/'review-details.json').write_text(json.dumps(details,indent=2),encoding='utf-8')
print('REVIEW_COMPLETE',json.dumps(details))
