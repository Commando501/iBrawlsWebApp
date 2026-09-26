"""Review the upward pommel strike from front-quarter and right-profile views."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
poses=[('neutral','clean_hammer_carry',0),('load','clean_hammer_melee',.22),('rise','clean_hammer_melee',.55),('impact','clean_hammer_melee',1),('return','clean_hammer_melee_recover',.5),('settled','clean_hammer_melee_recover',1)]
old_frame=scene.frame_current
old_location=scene.camera.location.copy();old_rotation=scene.camera.rotation_euler.copy();old_scale=scene.camera.data.ortho_scale
try:
    scene.camera.data.ortho_scale=3.2
    for angle,location in [('quarter',(3,6,2.8)),('right',(-6,0,2.3))]:
        scene.camera.location=location
        scene.camera.rotation_euler=(Vector((0,0,1.12))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for label,cid,t in poses:
            clip=timeline[cid];scene.frame_set(clip['start']+round(clip['duration']*t))
            scene.render.filepath=str(base/f'hammer-melee-{angle}-{label}.png')
            bpy.ops.render.render(write_still=True)
finally:
    scene.frame_set(old_frame);scene.camera.location=old_location;scene.camera.rotation_euler=old_rotation;scene.camera.data.ortho_scale=old_scale
print('Rendered the six stages of the hammer melee from two angles')
