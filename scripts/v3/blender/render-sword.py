"""Render the katar slash with the real blade-tip path for orientation review."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector,Matrix
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
weapon=bpy.data.objects[scene['ibrawls_weapon_sword']]
clip=timeline['clean_sword_slash']
C=Matrix.Rotation(math.pi/2,4,'X')
points=[]
for frame in range(15,48):
    scene.frame_set(clip['start']+frame)
    points.append(weapon.matrix_world@(C@Vector((0,0,-.75))))
curve=bpy.data.curves.new('Katar cutting tip path','CURVE');curve.dimensions='3D';curve.bevel_depth=.003
spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
for p,co in zip(spline.points,points):p.co=(*co,1)
path=bpy.data.objects.new('Katar cutting tip path',curve);scene.collection.objects.link(path)
material=bpy.data.materials.new('Katar path gold');material.diffuse_color=(1,.55,.06,1);curve.materials.append(material)
poses=[('ready','clean_sword_slash',0),('loaded','clean_sword_slash',.25),('cut','clean_sword_slash',.5),
       ('finish','clean_sword_slash',.78),('return','clean_sword_recover',.5),('neutral','clean_sword_recover',1)]
old_frame=scene.frame_current;old_location=scene.camera.location.copy();old_rotation=scene.camera.rotation_euler.copy();old_scale=scene.camera.data.ortho_scale
try:
    scene.camera.data.ortho_scale=3.2
    for angle,location in [('quarter',(3,6,2.8)),('high',(0,4,5))]:
        scene.camera.location=location
        scene.camera.rotation_euler=(Vector((0,0,1.0))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for label,cid,t in poses:
            c=timeline[cid];scene.frame_set(c['start']+round(c['duration']*t))
            scene.render.filepath=str(base/f'katar-slash-{angle}-{label}.png');bpy.ops.render.render(write_still=True)
finally:
    bpy.data.objects.remove(path,do_unlink=True);bpy.data.curves.remove(curve);bpy.data.materials.remove(material)
    scene.frame_set(old_frame);scene.camera.location=old_location;scene.camera.rotation_euler=old_rotation;scene.camera.data.ortho_scale=old_scale
print('Rendered katar slash and recovery with blade-tip trajectory')
