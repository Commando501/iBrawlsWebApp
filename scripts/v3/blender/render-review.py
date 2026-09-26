"""Render representative repaired poses with a visible ground reference."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline=json.loads((base/'repair-timeline.json').read_text())
floor=bpy.data.objects.get('V3 repair floor')
if floor and floor.name not in scene.objects:floor=None
if not floor:
    mesh=bpy.data.meshes.new('V3 repair floor')
    mesh.from_pydata([(-3,-3,-.004),(3,-3,-.004),(3,3,-.004),(-3,3,-.004)],[],[(0,1,2,3)])
    floor=bpy.data.objects.new('V3 repair floor',mesh);scene.collection.objects.link(floor)
    material=bpy.data.materials.new('V3 repair floor');material.diffuse_color=(.12,.15,.19,1);mesh.materials.append(material)
scene.camera.location=(3,6,2.6)
scene.camera.rotation_euler=(Vector((0,0,.85))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale=2.7
review_clips=['clean_idle','clean_walk','clean_sprint','clean_slide','clean_hammer_carry','clean_hammer_windup','clean_hammer_strike','clean_sword_carry','clean_sword_slash','clean_pistol_fire']
for cid in review_clips:
    clip=next(c for c in timeline if c['id']==cid)
    scene.frame_set(clip['start']+clip['duration']//2)
    scene.render.filepath=str(base/('repaired-'+cid+'.png'));bpy.ops.render.render(write_still=True)
scene.frame_set(1)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_location=(0,0,.9)
            area.spaces.active.region_3d.view_distance=3.8
bpy.ops.wm.save_as_mainfile(filepath=str(base/'ibrawls-animation-repair.blend'))
print(f'Rendered {len(review_clips)} V3 review poses and saved the Blender review scene')
