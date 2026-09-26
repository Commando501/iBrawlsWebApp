import bpy,json
from pathlib import Path
from mathutils import Vector,Matrix
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
timeline={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())}
old=(scene.frame_current,scene.camera.location.copy(),scene.camera.rotation_euler.copy(),scene.camera.data.ortho_scale)
try:
    scene.camera.data.ortho_scale=3.2
    for angle,location in [('quarter',(3,6,2.8)),('side',(6,0,2.0))]:
        scene.camera.location=location;scene.camera.rotation_euler=(Vector((0,0,.95))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        for cid,frames in [('clean_ball_carry',[0]),('clean_ball_walk',[22]),('clean_ball_sprint',[22]),('clean_slide_ball',[36,62]),('clean_ball_punch',[0,17,30,46,60,72]),('clean_ball_throw',[0,15,30,39,45,54,67,90])]:
            for f in frames:
                scene.frame_set(timeline[cid]['start']+f);scene.render.filepath=str(base/f'{cid}-{angle}-{f}.png');bpy.ops.render.render(write_still=True)
finally:
    scene.frame_set(old[0]);scene.camera.location=old[1];scene.camera.rotation_euler=old[2];scene.camera.data.ortho_scale=old[3]
# Separate product view, leaving the animated scene untouched.
hero=bpy.data.scenes.new('Skull bomb product review');hero.render.engine='CYCLES';hero.cycles.samples=32
hero.render.resolution_x=800;hero.render.resolution_y=800;hero.render.resolution_percentage=100
hero.world=bpy.data.worlds.new('Skull bomb studio');hero.world.color=(.07,.07,.07)
for source in bpy.data.collections['V3 skull bomb design'].objects:
    obj=source.copy();obj.data=source.data.copy();hero.collection.objects.link(obj)
camera=bpy.data.objects.new('Skull bomb camera',bpy.data.cameras.new('Skull bomb camera'));hero.collection.objects.link(camera)
camera.location=(.65,.42,.95);camera.rotation_euler=(Vector((0,.04,0))-camera.location).to_track_quat('-Z','Y').to_euler();direction=(Vector((0,.04,0))-camera.location).normalized();right=direction.cross(Vector((0,1,0))).normalized();up=right.cross(direction);camera.rotation_euler=Matrix((right,up,-direction)).transposed().to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=.72;hero.camera=camera
for name,p,power,size in [('key',(1,1,1),70,1),('fill',(-1,.2,.7),35,1),('rim',(0,.7,-1),90,.7)]:
    light=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));hero.collection.objects.link(light);light.location=p;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
hero.render.filepath=str(base/'skull-bomb-product.png');bpy.ops.render.render(write_still=True,scene=hero.name)
print('Rendered skull bomb and runner motions')
