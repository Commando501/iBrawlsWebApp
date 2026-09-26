"""Three readable poses per clip for a complete V3 motion review."""
import bpy,json
from pathlib import Path
from mathutils import Vector
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline=json.loads((base/'repair-timeline.json').read_text())
saved=(scene.frame_current,scene.camera.location.copy(),scene.camera.rotation_euler.copy(),scene.camera.data.ortho_scale,scene.render.resolution_x,scene.render.resolution_y,scene.cycles.samples,scene.render.filepath)
manifest=[]
try:
    scene.render.resolution_x=384;scene.render.resolution_y=384;scene.cycles.samples=8
    scene.camera.data.ortho_scale=2.45
    scene.camera.location=(3,6,2.6)
    scene.camera.rotation_euler=(Vector((0,0,.92))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    for clip in timeline:
        poses=[]
        for t in (.18,.50,.82):
            frame=round(clip['duration']*t)
            scene.frame_set(clip['start']+frame)
            path=base/f"motion-{clip['id']}-{frame}.png"
            scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
            poses.append({'frame':frame,'path':str(path)})
        manifest.append({'id':clip['id'],'poses':poses})
finally:
    scene.frame_set(saved[0]);scene.camera.location=saved[1];scene.camera.rotation_euler=saved[2];scene.camera.data.ortho_scale=saved[3]
    scene.render.resolution_x=saved[4];scene.render.resolution_y=saved[5];scene.cycles.samples=saved[6];scene.render.filepath=saved[7]
(base/'motion-review-images.json').write_text(json.dumps(manifest,indent=2))
print(f'Rendered three review poses for each of the {len(timeline)} V3 clips')
