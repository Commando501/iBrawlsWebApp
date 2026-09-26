"""Render slide entry, held posture, and recovery from two review angles."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
poses=[('held',48/84),('weight-shift',56/84),('push',62/84),('step',68/84),('plant',74/84),('settle',79/84),('neutral',1)]
old_frame=scene.frame_current;old_location=scene.camera.location.copy();old_rotation=scene.camera.rotation_euler.copy();old_scale=scene.camera.data.ortho_scale
try:
    scene.camera.data.ortho_scale=3.1
    for angle,location in [('quarter',(3,6,2.8)),('side',(6,0,2.0))]:
        scene.camera.location=location
        scene.camera.rotation_euler=(Vector((0,0,.85))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for item in ('hammer','sword','pistol','ball'):
            clip=timeline['clean_slide_'+item]
            for label,t in poses:
                scene.frame_set(clip['start']+round(clip['duration']*t))
                scene.render.filepath=str(base/f'slide-{item}-{angle}-{label}.png');bpy.ops.render.render(write_still=True)
finally:
    scene.frame_set(old_frame);scene.camera.location=old_location;scene.camera.rotation_euler=old_rotation;scene.camera.data.ortho_scale=old_scale
print('Rendered all four slide holds through entry, held posture, and recovery')
