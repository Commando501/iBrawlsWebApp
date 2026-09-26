"""Close views of the previous left-arm failure poses."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
saved=(scene.frame_current,scene.camera.location.copy(),scene.camera.rotation_euler.copy(),scene.camera.data.ortho_scale,scene.render.resolution_x,scene.render.resolution_y,scene.cycles.samples)
try:
    scene.render.resolution_x=800;scene.render.resolution_y=800;scene.cycles.samples=16
    scene.camera.data.ortho_scale=1.7
    for angle,location in [('front-left',(-3,6,2.6)),('left',(-6,0,2.2))]:
        scene.camera.location=location
        scene.camera.rotation_euler=(Vector((0,0,1.13))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for cid,frame in [('clean_ball_walk',67),('clean_ball_sprint',67),('clean_ball_punch',13),('clean_ball_throw',32),('clean_sword_lunge',11),('clean_hammer_melee',31)]:
            scene.frame_set(timeline[cid]['start']+frame)
            scene.render.filepath=str(base/f'left-arm-{cid}-{angle}.png')
            bpy.ops.render.render(write_still=True)
finally:
    scene.frame_set(saved[0]);scene.camera.location=saved[1];scene.camera.rotation_euler=saved[2];scene.camera.data.ortho_scale=saved[3]
    scene.render.resolution_x=saved[4];scene.render.resolution_y=saved[5];scene.cycles.samples=saved[6]
print('Rendered 12 close views of the repaired left arm')
