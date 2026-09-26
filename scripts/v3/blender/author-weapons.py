"""V3 gravity hammer and energy katar: real handles, meters, +Y longitudinal axis.

Export evaluated Blender geometry for the synchronous game builder as well as GLB.
The grip is the origin, so neither sockets nor animations need arbitrary rotations.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Matrix, Vector

repo=Path(__file__).resolve().parents[3]
out=repo/'output'/'blender-repair';out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
old=bpy.data.collections.get('V3 weapon design v2')
if old:
    for obj in list(old.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.collections.remove(old)
collection=bpy.data.collections.new('V3 weapon design v2');scene.collection.children.link(collection)
palette={'primary':(.08,.22,.29,1),'secondary':(.20,.27,.31,1),'fixed':(.035,.045,.052,1),
         'undersuit':(.018,.022,.028,1),'accent':(.08,.55,.70,1),'emissive':(.15,.85,1,1)}
materials={}
for role,color in palette.items():
    mat=bpy.data.materials.new('V3 weapon '+role);mat.diffuse_color=color;mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=color
    bsdf.inputs['Metallic'].default_value=.65 if role not in ('undersuit','emissive') else .05
    bsdf.inputs['Roughness'].default_value=.65 if role=='undersuit' else .32
    if role=='emissive':bsdf.inputs['Emission Color'].default_value=color;bsdf.inputs['Emission Strength'].default_value=1.5
    materials[role]=mat

parts=[]
def finish(o,name,role,bevel=0):
    o.name=name
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o);o.data.materials.append(materials[role]);o['role']=role;parts.append(o)
    if bevel:
        mod=o.modifiers.new('Machined edge','BEVEL');mod.width=bevel;mod.segments=2
    return o
def box(name,center,size,role,bevel=.005):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center);o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,role,bevel)
def cylinder(name,center,radius,length,role,axis='Y'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=length,location=center)
    o=bpy.context.object
    if axis=='Y':o.rotation_euler.x=math.pi/2
    if axis=='X':o.rotation_euler.y=math.pi/2
    return finish(o,name,role,.002)
def prism(name,outline,thickness,role,bevel=.002):
    if sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline)))<0:outline=list(reversed(outline))
    n=len(outline);verts=[(x,y,z) for z in (-thickness/2,thickness/2) for x,y in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);collection.objects.link(o)
    return finish(o,name,role,bevel)
def hammer():
    # 1.40 m overall, 46 mm haft, two grips 240 mm apart.
    cylinder('Hammer structural haft',(0,.27,0),.023,1.10,'fixed')
    cylinder('Hammer lower grip',(0,0,0),.027,.19,'undersuit')
    cylinder('Hammer upper grip',(0,.24,0),.027,.17,'undersuit')
    for y in [-.085,-.055,-.025,.005,.035,.065,.175,.205,.235,.265,.295]:
        cylinder('Grip wrap',(0,y,0),.028,.009,'secondary')
    cylinder('Hammer pommel',(0,-.28,0),.038,.06,'secondary')
    cylinder('Hammer ferrule',(0,.72,0),.04,.11,'secondary')
    box('Hammer power spine',(0,.52,.023),(.028,.30,.024),'primary')
    box('Hammer spine light',(0,.52,.037),(.009,.20,.004),'emissive',.001)
    # A thick striking face, tapered rear housing and inset side reactors.
    box('Hammer head chassis',(0,.93,0),(.25,.29,.26),'fixed',.024)
    box('Hammer strike plate',(0,.94,-.15),(.29,.25,.055),'secondary',.016)
    box('Hammer striking inset',(0,.94,-.181),(.20,.16,.010),'emissive',.009)
    box('Hammer upper armor',(0,1.067,.015),(.275,.046,.25),'primary',.011)
    box('Hammer lower armor',(0,.801,.015),(.275,.041,.25),'primary',.010)
    box('Hammer rear counterweight',(0,.94,.14),(.19,.18,.06),'secondary',.016)
    for side in (-1,1):
        cylinder('Hammer reactor rim',(side*.13,.94,.015),.077,.014,'secondary','X')
        cylinder('Hammer recessed reactor',(side*.14,.94,.015),.052,.008,'emissive','X')
        for y in (.84,1.025):box('Hammer side rib',(side*.131,y,.018),(.018,.021,.20),'primary',.003)
def sword():
    # 0.90 m overall. The hand wraps an X-axis crossbar inside the H-frame.
    cylinder('Katar cross grip',(0,0,0),.019,.132,'undersuit','X')
    for side in (-1,1):
        box('Katar hand guard',(side*.081,.012,0),(.024,.294,.045),'secondary',.008)
        box('Katar guard inset',(side*.081,.020,.024),(.010,.18,.006),'primary',.002)
    box('Katar rear bridge',(0,-.132,0),(.178,.036,.045),'fixed',.007)
    box('Katar emitter block',(0,.155,0),(.216,.070,.065),'fixed',.010)
    box('Katar emitter face',(0,.195,0),(.19,.021,.049),'accent',.004)
    outline=[(-.09,.201),(-.124,.29),(-.092,.46),(-.048,.63),(0,.75),(.048,.63),(.092,.46),(.124,.29),(.09,.201)]
    prism('Katar luminous blade',outline,.018,'emissive',.0015)
    # Raised spine and dark emitter shoulders make the cutting silhouette readable.
    prism('Katar blade spine',[(-.025,.21),(-.018,.49),(0,.71),(.018,.49),(.025,.21)],.026,'accent',.001)
    for side in (-1,1):
        prism('Katar emitter cheek',[(side*.048,.14),(side*.108,.14),(side*.108,.245),(side*.065,.29)],.057,'primary',.005)

payload={}
for weapon,builder in [('hammer',hammer),('sword',sword)]:
    parts=[];builder();meshes=[]
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
    for o in parts:
        evaluated=o.evaluated_get(deps);mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
        positions=[];normals=[]
        normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
        for tri in mesh.loop_triangles:
            for loop_index in tri.loops:
                loop=mesh.loops[loop_index];p=o.matrix_world@mesh.vertices[loop.vertex_index].co
                n=(normal_matrix@mesh.corner_normals[loop_index].vector).normalized()
                positions.extend(round(x,6) for x in p);normals.extend(round(x,6) for x in n)
        meshes.append({'name':o.name,'role':o['role'],'positions':positions,'normals':normals})
        evaluated.to_mesh_clear()
    payload[weapon]={'meshes':meshes,'primaryGrip':[0,0,0],'offhandGrip':[0,.24,0] if weapon=='hammer' else [0,0,0],
                     'targetBodyHeightRatio':.75 if weapon=='hammer' else .5}
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out/('v3-'+weapon+'.glb')),use_selection=True,export_format='GLB')
    for o in parts:o['weapon']=weapon
(out/'blender-weapons.json').write_text(json.dumps(payload,separators=(',',':')))
collection.hide_render=True;collection.hide_viewport=True
print(json.dumps({w:{'parts':len(d['meshes']),'triangles':sum(len(m['positions'])//9 for m in d['meshes'])} for w,d in payload.items()}))
