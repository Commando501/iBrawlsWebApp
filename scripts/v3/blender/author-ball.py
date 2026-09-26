"""V3 skull-bomb: editable Blender parts, Y-up geometry, face toward +Z."""
import bpy,json,math
from pathlib import Path
from mathutils import Matrix,Vector
out=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
scene=bpy.context.scene
old=bpy.data.collections.get('V3 skull bomb design')
if old:
    for obj in list(old.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.collections.remove(old)
collection=bpy.data.collections.new('V3 skull bomb design');scene.collection.children.link(collection)
palette={'shell':'#263943','bone':'#d7cfb0','socket':'#11191e','metal':'#73818b','warning':'#db882c','ember':'#ff9c35'}
materials={};parts=[]
MODEL_SCALE=.5  # 25% larger than the previous .4 scale, half the original dimensions.
for role,color in palette.items():
    rgb=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))+(1,)
    mat=bpy.data.materials.new('Skull bomb '+role);mat.diffuse_color=rgb;mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=rgb
    bsdf.inputs['Metallic'].default_value=.65 if role in ('shell','metal') else .2
    bsdf.inputs['Roughness'].default_value=.42
    if role=='ember':bsdf.inputs['Emission Color'].default_value=rgb;bsdf.inputs['Emission Strength'].default_value=2
    materials[role]=mat
def finish(o,name,role,bevel=0):
    o.name='Skull bomb '+name
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o);o.data.materials.append(materials[role]);o['role']=role;parts.append(o)
    if bevel:
        mod=o.modifiers.new('Armored edge','BEVEL');mod.width=bevel;mod.segments=1
    return o
def box(name,p,size,role,bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,role,bevel)
def sphere(name,p,size,role):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,radius=1,location=p)
    o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,role)
def bar(name,a,b,radius,role):
    a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=radius,depth=(b-a).length,location=(a+b)/2)
    o=bpy.context.object;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return finish(o,name,role,.002)
def plate(name,outline,z,depth,role):
    if sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline)))<0:
        outline=list(reversed(outline))
    n=len(outline);verts=[(x,y,z+d) for d in (-depth/2,depth/2) for x,y in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);return finish(o,name,role,.004)
sphere('cranium',(0,.018,-.015),(.205,.205,.17),'shell')
box('jaw housing',(0,-.123,.046),(.27,.14,.23),'shell',.026)
# Bone-colored facial plates surround genuinely inset dark socket panels.
plate('forehead',[(-.15,.085),(-.12,.155),(0,.189),(.12,.155),(.15,.085),(.035,.068),(0,.091),(-.035,.068)],.141,.047,'bone')
for side in (-1,1):
    def mirrored(points):return [(x*side,y) for x,y in (points if side==1 else list(reversed(points)))]
    plate('eye well',mirrored([(.026,.070),(.150,.086),(.161,.025),(.107,-.020),(.026,.001)]),.159,.026,'socket')
    plate('eye ember',mirrored([(.045,.043),(.126,.056),(.121,.021),(.068,.006)]),.177,.007,'ember')
    plate('cheek',mirrored([(.121,-.013),(.162,.018),(.178,-.062),(.121,-.106),(.066,-.077)]),.157,.048,'bone')
    plate('temple',mirrored([(.155,.08),(.186,.06),(.190,-.018),(.158,-.006)]),.111,.052,'metal')
    box('side detonator',(side*.202,.015,-.020),(.022,.087,.087),'metal',.01)
    box('side warning',(side*.216,.015,-.020),(.005,.038,.045),'warning',.003)
plate('nose',[(-.028,.002),(0,.027),(.028,.002),(.020,-.058),(-.020,-.058)],.185,.022,'socket')
box('mouth recess',(0,-.103,.182),(.19,.078,.025),'socket',.004)
for x in (-.071,-.024,.024,.071):
    box('upper tooth',(x,-.082,.204),(.032,.047,.027),'bone',.003)
    box('lower tooth',(x,-.139,.193),(.032,.033,.025),'bone',.003)
box('chin',(0,-.169,.155),(.22,.047,.078),'bone',.012)
box('fuse collar',(0,.217,-.024),(.090,.032,.074),'metal',.007)
bar('fuse lower',(0,.228,-.024),(.012,.263,-.023),.011,'socket')
bar('fuse wick',(.012,.263,-.023),(.042,.281,-.023),.009,'warning')
sphere('fuse ember',(.044,.282,-.023),(.015,.015,.015),'ember')
# Shallow rear ribs retain the bomb silhouette from behind.
for x in (-.09,0,.09):box('rear rib',(x,.02,-.175),(.020,.18,.018),'metal',.006)
for o in parts:
    o.location*=MODEL_SCALE
    o.data.transform(Matrix.Scale(MODEL_SCALE,4))
    for modifier in o.modifiers:
        if modifier.type=='BEVEL':modifier.width*=MODEL_SCALE
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();meshes=[]
for o in parts:
    evaluated=o.evaluated_get(deps);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();positions=[];normals=[]
    normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
    for tri in mesh.loop_triangles:
        for i in tri.loops:
            p=o.matrix_world@mesh.vertices[mesh.loops[i].vertex_index].co
            n=(normal_matrix@mesh.corner_normals[i].vector).normalized()
            positions.extend(round(x,6) for x in p);normals.extend(round(x,6) for x in n)
    meshes.append({'name':o.name,'role':o['role'],'positions':positions,'normals':normals});evaluated.to_mesh_clear()
payload={'meshes':meshes,'palette':palette,'grip':[x*MODEL_SCALE for x in (0,-.197,-.025)],'radius':.30*MODEL_SCALE}
(out/'blender-skull-bomb.json').write_text(json.dumps(payload,separators=(',',':')))
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'v3-skull-bomb.glb'),use_selection=True,export_format='GLB',export_yup=False)
# Replace the old sphere under the existing animated review object.
ball=bpy.data.objects.get(scene.get('ibrawls_weapon_ball',''))
if ball:
    previous=list(ball.children)
    visibility=previous[0].animation_data.action if previous and previous[0].animation_data else None
    for child in previous:bpy.data.objects.remove(child,do_unlink=True)
    C=Matrix.Rotation(math.pi/2,4,'X')
    target=bpy.data.collections[scene['ibrawls_repaired_collection']]
    for o in parts:
        child=o.copy();child.data=o.data.copy();target.objects.link(child);child.parent=ball;child.matrix_local=C@o.matrix_world
        if visibility:child.animation_data_create();child.animation_data.action=visibility
collection.hide_render=True;collection.hide_viewport=True
bpy.ops.wm.save_as_mainfile(filepath=str(out/'ibrawls-animation-repair.blend'))
print(json.dumps({'parts':len(parts),'triangles':sum(len(m['positions'])//9 for m in meshes)}))
