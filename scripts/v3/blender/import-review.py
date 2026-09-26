import bpy, json, math
from array import array
from mathutils import Matrix, Vector, Quaternion
from pathlib import Path
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
data=json.loads((base/'runtime-audit.json').read_text())
scene=bpy.data.scenes.new('iBrawls Animation Repair')
bpy.context.window.scene=scene
scene.render.fps=60
root=bpy.data.collections.new('Runtime armor - original')
scene.collection.children.link(root)
scene['ibrawls_original_collection']=root.name
C=Matrix.Rotation(math.pi/2,4,'X')
def matrix(t):
    x,y,z,w=t['q']
    return C @ Matrix.LocRotScale(Vector(t['p']),Quaternion((w,x,y,z)),Vector(t['s'])) @ C.inverted()
parents={}
for slot,t in data['rest'].items():
    o=bpy.data.objects.new(slot,None);root.objects.link(o);o.matrix_world=matrix(t);parents[slot]=o;o['ibrawls_slot']=slot
for slot in ('weapon_hammer','weapon_sword','weapon_pistol'):
    o=bpy.data.objects.new(slot,None);root.objects.link(o);parents[slot]=o;o['ibrawls_slot']=slot
for n,item in enumerate(data['meshes']):
    p=array('f');p.frombytes((base/item['positions']).read_bytes())
    idx=array('I');idx.frombytes((base/item['indices']).read_bytes())
    verts=[(p[i],-p[i+2],p[i+1]) for i in range(0,len(p),3)]
    faces=[idx[i:i+3] for i in range(0,len(idx),3)]
    mesh=bpy.data.meshes.new(item['slot']+' surface');mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(item['slot']+' surface '+str(n),mesh);root.objects.link(o);o.parent=parents[item['slot']]
    for mi,m in enumerate(item['materials']):
        mat=bpy.data.materials.new(item['slot']+' material '+str(mi));mat.diffuse_color=(*m['color'],1);mesh.materials.append(mat)
    for g in item['groups']:
        for face in mesh.polygons[g['start']//3:(g['start']+g['count'])//3]:face.material_index=g['materialIndex']
    if item['colors']:
        colors=array('f');colors.frombytes((base/item['colors']).read_bytes())
        attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        rgba=[]
        for i in range(0,len(colors),3):rgba.extend(list(colors[i:i+3])+[1])
        attr.data.foreach_set('color',rgba)
offset=1
for clip in data['clips']:
    scene.timeline_markers.new(clip['id'],frame=offset)
    clip['blenderStart']=offset
    for f in clip['frames']:
        for slot,t in f['parts'].items():
            o=parents[slot];o.matrix_world=matrix(t);o.rotation_mode='QUATERNION'
            for path in ('location','rotation_quaternion','scale'):o.keyframe_insert(path,frame=offset+f['frame'],group=clip['id'])
    offset+=clip['durationFrames']+15
scene.frame_end=offset
for slot,o in parents.items():
    if slot.startswith('weapon_'):o.hide_render=True;o.hide_viewport=True
scene.frame_set(1)
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.studio_light='paint.sl'
scene.display.shading.color_type='VERTEX'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH'
scene.display.shading.background_type='WORLD'
scene.world=bpy.data.worlds.new('Repair Studio');scene.world.color=(.055,.065,.085)
scene.view_settings.view_transform='Standard'
camera_data=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
camera_data.type='ORTHO';camera_data.ortho_scale=3.1
camera.location=(3,-6,2.6);camera.rotation_euler=(Vector((0,0,1.05))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=800;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(base/'runtime-idle.png')
bpy.ops.wm.save_as_mainfile(filepath=str(base/'ibrawls-animation-repair.blend'))
bpy.ops.render.render(write_still=True)
(base/'blender-timeline.json').write_text(json.dumps([{'id':c['id'],'start':c['blenderStart'],'duration':c['durationFrames']} for c in data['clips']],indent=2))
print(json.dumps({'scene':scene.name,'parts':len(parents),'meshes':len(data['meshes']),'clips':len(data['clips']),'file':str(base/'ibrawls-animation-repair.blend')}))
