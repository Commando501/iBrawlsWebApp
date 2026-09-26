"""Review the connected overhand swing from front-quarter and right-profile views."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
poses=[('neutral','clean_hammer_carry',0),('lift','clean_hammer_windup',.48),
       ('loaded','clean_hammer_windup',1),('overhead','clean_hammer_strike',.30),
       ('impact','clean_hammer_strike',1),('return','clean_hammer_recover',.5)]
old_frame=scene.frame_current
old_location=scene.camera.location.copy();old_rotation=scene.camera.rotation_euler.copy();old_scale=scene.camera.data.ortho_scale
try:
    scene.camera.data.ortho_scale=3.2
    for angle,location in [('quarter',(3,6,2.8)),('right',(-6,0,2.3))]:
        scene.camera.location=location
        scene.camera.rotation_euler=(Vector((0,0,1.12))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for label,cid,t in poses:
            clip=timeline[cid];scene.frame_set(clip['start']+round(clip['duration']*t))
            scene.render.filepath=str(base/f'hammer-overhand-{angle}-{label}.png')
            bpy.ops.render.render(write_still=True)
finally:
    scene.frame_set(old_frame);scene.camera.location=old_location;scene.camera.rotation_euler=old_rotation;scene.camera.data.ortho_scale=old_scale
print('Rendered the six stages of the hammer swing from two angles')
