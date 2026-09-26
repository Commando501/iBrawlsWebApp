"""Review the crouch silhouette, carry clearance, and entry/exit timing."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
saved=(scene.frame_current,scene.camera.location.copy(),scene.camera.rotation_euler.copy(),scene.camera.data.ortho_scale,scene.render.resolution_x,scene.render.resolution_y,scene.cycles.samples,scene.render.filepath)
try:
    scene.render.resolution_x=480;scene.render.resolution_y=480;scene.cycles.samples=8
    scene.camera.data.ortho_scale=2.45
    for angle,location in [('quarter',(3,6,2.4)),('side',(6,0,1.8))]:
        scene.camera.location=location
        scene.camera.rotation_euler=(Vector((0,0,.85))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for item in ('unarmed','hammer','sword','pistol','ball'):
            clip=timeline['clean_crouch'+('' if item=='unarmed' else '_'+item)]
            for frame in ([0,18,54,96,120] if item=='unarmed' else [54]):
                scene.frame_set(clip['start']+frame)
                scene.render.filepath=str(base/f'crouch-{item}-{angle}-{frame}.png')
                bpy.ops.render.render(write_still=True)
finally:
    scene.frame_set(saved[0]);scene.camera.location=saved[1];scene.camera.rotation_euler=saved[2];scene.camera.data.ortho_scale=saved[3]
    scene.render.resolution_x=saved[4];scene.render.resolution_y=saved[5];scene.cycles.samples=saved[6];scene.render.filepath=saved[7]
print('Rendered crouch entry/exit and all five held silhouettes from two angles')
