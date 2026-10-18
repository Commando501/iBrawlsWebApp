"""Original Glacier Hockey Rink kit; reproducible Blender source in metres.

All pivots and transforms are centered/baked. Gameplay owns collision.
Only glass uses alpha. Snow and foliage are closed, connected geometry.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'public/assets/glacier/architecture'
SOURCE = ROOT / 'output/glacier'
DEST.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--skip-render', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def linear(color):
    rgb = [int(color[i:i+2], 16)/255 for i in (1, 3, 5)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb)+(1,)


palette = {
    'ceramic': ('#a9bac2', .10, .62),
    'alloy': ('#637d8b', .58, .41),
    'graphite': ('#253b48', .18, .72),
    'red': ('#b94146', .16, .57),
    'glass': ('#b6d7e3', .0, .19),
    'ice': ('#799eb1', .02, .68),
    'snow': ('#dce6e9', .0, .92),
    'foliage': ('#29494a', .0, .95),
    'bark': ('#655e58', .0, .92),
}
materials = {}
for name, (color, metal, rough) in palette.items():
    material = bpy.data.materials.new('glacier_'+name)
    material.diffuse_color = linear(color)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = linear(color)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if name == 'glass':
        bsdf.inputs['Alpha'].default_value = .20
        material.diffuse_color = linear(color)[:3]+(.20,)
        material.surface_render_method = 'DITHERED'
    materials[name] = material

active_collection = None
parts = []
detail = True


def finish(obj, name, role, bevel=0, smooth=False):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    active_collection.objects.link(obj)
    obj.data.materials.append(materials[role])
    obj['paint_role'] = role
    if bevel < (.009 if detail else .035):
        bevel = 0
    if bevel:
        mod = obj.modifiers.new('Machined edge roll', 'BEVEL')
        mod.width = bevel
        mod.segments = 2 if detail and bevel >= .035 else 1
        obj.data.set_sharp_from_angle(angle=math.radians(35))
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new('Weighted planar normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
    elif smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    parts.append(obj)
    return obj


def box(name, center, size, role='alloy', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, role, bevel)


def cylinder(name, center, radius, height, role='alloy', bevel=.025, segments=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments or (20 if detail else 12),
        radius=radius, depth=height, location=center)
    return finish(bpy.context.object, name, role, bevel)


def beam(name, start, end, width, depth=None, role='alloy', bevel=.025):
    start, end = Vector(start), Vector(end)
    obj = box(name, (start+end)/2, (width, depth or width, (end-start).length), role, bevel)
    obj.rotation_euler = (end-start).to_track_quat('Z', 'Y').to_euler()
    return obj


def custom(name, vertices, faces, role):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    active_collection.objects.link(obj)
    return finish(obj, name, role)


def normalize_parts(dimensions, radial_limit=None):
    """Fit exact Blender XYZ / exported XZY dimensions, bake transforms."""
    for obj in parts:
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.update()
    minimum, maximum = Vector((math.inf,)*3), Vector((-math.inf,)*3)
    for obj in parts:
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    center = (minimum+maximum)/2
    factor = [dimensions[i]/(maximum[i]-minimum[i]) for i in range(3)]
    for obj in parts:
        matrix = obj.matrix_world.copy()
        for vertex in obj.data.vertices:
            p = matrix @ vertex.co-center
            p = Vector([p[i]*factor[i] for i in range(3)])
            if radial_limit and math.hypot(p.x,p.y) > radial_limit:
                ratio = radial_limit/math.hypot(p.x,p.y)
                p.x *= ratio; p.y *= ratio
            vertex.co = p
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)


def anchor_post():
    # Every rail, cap and fastener stays inside the existing radius-.3 cylinder.
    cylinder('Full height anchor structural core',(0,0,0),.222,4.76,'graphite',.03)
    cylinder('Broad cylindrical base armor',(0,0,-2.28),.30,.44,'alloy',.035 if detail else 0,24 if detail else 12)
    cylinder('Broad cylindrical upper crown',(0,0,2.28),.30,.44,'alloy',.035 if detail else 0,24 if detail else 12)
    for z in (-1.7,1.7):
        cylinder('Protected anchor collar',(0,0,z),.285,.23,'alloy',.025)
    for a in (0,math.pi/2,math.pi,3*math.pi/2):
        radial=Vector((math.cos(a),math.sin(a),0))
        obj=box('Long ceramic inset anchor shield',radial*.227,(.16,.10,3.0),'ceramic',.025)
        obj.rotation_euler.z=a-math.pi/2
        obj=box('Restrained red hockey anchor marker',radial*.232+Vector((0,0,.99)),(.13,.10,.18),'red',.012)
        obj.rotation_euler.z=a-math.pi/2
        if detail:
            for z in (-1.26,1.26):
                obj=box('Captive shield clamp',radial*.243+Vector((0,0,z)),(.12,.07,.11),'alloy',.01)
                obj.rotation_euler.z=a-math.pi/2
    normalize_parts((.6,.6,5),radial_limit=.3)


def goal_buffer():
    # A closed solid training goal keeps its original box collision legible.
    box('Continuous reinforced goal block',(0,0,0),(1.40,3.80,1.83),'graphite',.07)
    for x in (-.64,.64):
        for y in (-1.88,1.88):
            box('Rounded red goal corner',(x,y,0),(.22,.24,2),'red',.045)
        for z in (-.88,.88):
            box('Thick red hockey goal crossbar',(x,0,z),(.22,4,.24),'red',.045)
        # The closed face behind the net pattern prevents a walk-through reading.
        box('Solid inset ceramic backstop',(x*1.075,0,0),(.06,3.53,1.45),'ceramic',.028)
        net_columns=9 if detail else 6
        for i in range(net_columns):
            y=-1.56+i*3.12/(net_columns-1)
            box('Recessed goal net vertical rib',(x*1.126,y,0),(.015,.027,1.40),'alloy',0)
        for z in (-.48,0,.48):
            box('Recessed goal net horizontal rib',(x*1.13,0,z),(.016,3.40,.028),'alloy',0)
        box('Broad red lower safety pad',(x*1.125,0,-.68),(.05,3.40,.16),'red',.012)
    for y in (-1.92,1.92):
        box('Armored solid goal end cap',(0,y,0),(1.12,.16,1.63),'ceramic',.035)
        box('Goal end equipment recess',(0,y*1.045,.18),(.57,.01,.28),'graphite',0)
    box('Sealed upper goal armor',(0,0,.91),(1.10,3.48,.18),'ceramic',.04)
    normalize_parts((1.5,4,2))


def rink_board():
    box('Continuous insulated rink board core',(0,0,0),(4,.084,.80),'graphite',.014)
    for side in (-1,1):
        box('Broad quiet ceramic hockey board face',(0,side*.044,.025),(3.87,.012,.62),'ceramic',.008)
        box('Broad replaceable lower alloy scuff strip',(0,side*.047,-.305),(3.88,.006,.095),'alloy',0)
        box('Restrained red perimeter upper trim',(0,side*.048,.344),(3.88,.004,.034),'red',0)
        for x in (-1.91,1.91):
            box('Narrow panel seam edge',(x,side*.045,0),(.032,.010,.64),'alloy',0)
        if detail:
            for x in (-1.84,1.84):
                for z in (-.24,.24):
                    box('Flush captive board fixing',(x,side*.049,z),(.024,.002,.024),'alloy',0)
    normalize_parts((4,.1,.8))


def rink_glass():
    # Actual glass is a closed thin pane; the narrow frame stays readable.
    box('Clear armored rink glass',(0,0,0),(3.88,.018,1.30),'glass',0)
    for x in (-1.975,1.975):
        box('Narrow alloy glass mullion',(x,0,0),(.05,.10,1.4),'alloy',.01)
    for z in (-.68,.68):
        box('Thin horizontal glass retaining channel',(0,0,z),(3.92,.075,.04),'alloy',.009)
    if detail:
        for x in (-1.92,1.92):
            for z in (-.56,.56):
                box('Small pane retention clip',(x,-.022,z),(.06,.07,.08),'alloy',.01)
    normalize_parts((4,.1,1.4))


def ice_massif(cx,cy,rx,ry,height,seed):
    n=24 if detail else 12
    levels=[(0,1),(height*.13,1.01),(height*.27,.91),(height*.30,.96),
        (height*.44,.84),(height*.47,.88),(height*.61,.79),(height*.64,.83),
        (height*.78,.74),(height*.81,.78),(height*.92,.64),(height,.61)] if detail else [
        (0,1),(height*.27,.93),(height*.47,.88),(height*.64,.82),
        (height*.81,.76),(height*.92,.65),(height,.61)]
    vertices=[]
    for level,(z,r) in enumerate(levels):
        for j in range(n):
            a=math.tau*j/n
            irregular=1+.18*math.sin(j*2.14+seed)+.08*math.cos(j*3.16+level*.73)
            # Lateral compression and leaning fractures feel like exposed glacier,
            # rather than regular low-poly cones or glowing crystalline spikes.
            x=cx+rx*r*math.cos(a)*irregular+.12*z*math.sin(seed)
            y=cy+ry*r*math.sin(a)*irregular+.045*z*math.cos(seed)
            dz=(.64*math.sin(a*3+seed)+.31*math.cos(j*2.4))*min(1,z*.1)
            vertices.append((x,y,z+dz))
    faces=[]
    for level in range(len(levels)-1):
        for j in range(n):
            k=level*n+j; q=level*n+(j+1)%n
            faces.extend(((k,q,q+n),(k,q+n,k+n)))
    faces.extend((tuple(reversed(range(n))),tuple((len(levels)-1)*n+j for j in range(n))))
    custom('Fractured stratified glacier massif',vertices,faces,'ice')
    # A closed snow skin follows the upper ice rings; no alpha snow cards.
    first=len(levels)-2
    cap=[]
    for level in range(first,len(levels)):
        for j in range(n):
            p=Vector(vertices[level*n+j]); p.z+=.14
            if level==first:
                p.z+=.30+.25*math.sin(j*1.7+seed)
                p.x=cx+(p.x-cx)*.98; p.y=cy+(p.y-cy)*.98
            cap.append(p)
    capfaces=[]
    for level in range(1):
        for j in range(n):
            k=level*n+j; q=level*n+(j+1)%n
            capfaces.extend(((k,q,q+n),(k,q+n,k+n)))
    capfaces.extend((tuple(reversed(range(n))),tuple(n+j for j in range(n))))
    custom('Wind packed glacier summit snow',cap,capfaces,'snow')


def glacier_ridge():
    ice_massif(-5,-.3,6.6,6.2,19.1,.23)
    ice_massif(2.1,2.3,6.8,5.6,24.5,1.61)
    ice_massif(7,-2.4,4.9,5.7,16.9,3.2)
    normalize_parts((22,16,24))


def pine_branch(angle,height,length,width,rise):
    forward=Vector((math.cos(angle),math.sin(angle),0))
    tangent=Vector((-math.sin(angle),math.cos(angle),0))
    n=8 if detail else 4
    vertices=[]
    for i in range(n+1):
        t=i/n
        # Uneven broad bough outline, closed four-sided cross section.
        half=width*(math.sin(math.pi*t)**.73)*(.78+.22*math.cos(i*2.1))+.025
        center=forward*(length*t)+Vector((0,0,height+rise*t-.11*math.sin(t*math.pi)))
        thickness=.48*(1-t)+.012
        vertices.extend((center-tangent*half,center+Vector((0,0,thickness)),
            center+tangent*half,center-Vector((0,0,thickness*.5))))
    faces=[]
    for i in range(n):
        for k in range(4):
            faces.append((i*4+k,i*4+(k+1)%4,(i+1)*4+(k+1)%4,(i+1)*4+k))
    faces.extend(((3,2,1,0),tuple(n*4+k for k in range(4))))
    custom('Connected evergreen branch bough',vertices,faces,'foliage')
    # A narrower four-sided snow load rests directly on the upper bough.
    snow=[]
    for i in range(n+1):
        t=i/n; half=width*math.sin(math.pi*t)**.73*.50+.012
        center=forward*(length*t)+Vector((0,0,height+rise*t-.11*math.sin(t*math.pi)+.48*(1-t)))
        snow.extend((center-tangent*half,center+Vector((0,0,.15*(1-t)+.012)),
            center+tangent*half,center-Vector((0,0,.04))))
    custom('Closed snow pillow on evergreen bough',snow,faces,'snow')


def snowy_pine():
    cylinder('Continuous naturally tapered conifer trunk',(0,0,5.6),.18,11.2,'bark',0,12 if detail else 8)
    # Every branch touches the trunk; root and crown form a complete silhouette.
    for level in range(9):
        height=2.7+level*.97
        length=3.00-level*.32
        count=8 if detail else 6
        for j in range(count):
            pine_branch(math.tau*j/count+level*.39,height,length,length*.31,-.55)
    for j in range(4):
        pine_branch(math.tau*j/4,10.6,.54,.14,.58)
    if detail:
        for z in (1,1.6,2.2):
            cylinder('Quiet conifer bark joint',(0,0,z),.19,.08,'bark',0,10)
    normalize_parts((6,6,12))


builders = {'anchor-post':anchor_post, 'goal-buffer':goal_buffer, 'rink-board':rink_board,
    'rink-glass':rink_glass, 'glacier-ridge':glacier_ridge, 'snowy-pine':snowy_pine}


def unwrap(mesh):
    """Physical metre UVs, allowing shared runtime material tiling."""
    uv=mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    for polygon in mesh.polygons:
        axis=max(range(3),key=lambda i:abs(polygon.normal[i]))
        for index in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv=(p.x,p.z) if axis==1 else (p.y,p.z) if axis==0 else (p.x,p.y)


report={'schema':1,'generator':'scripts/glacier/author-kit.py','units':'metres',
    'coordinates':'glTF Y-up; centered pivots; identity transforms; physical metre UVs',
    'provenance':'Original Blender-authored geometry; no third-party game geometry or character imagery',
    'variants':{}}
all_exports=[]
for quality in ('high','low'):
    detail=quality=='high'
    collection=bpy.data.collections.new('Editable '+quality); scene.collection.children.link(collection)
    active_collection=collection
    export_collection=bpy.data.collections.new('Runtime '+quality); scene.collection.children.link(export_collection)
    module_report={}; exports=[]
    for module_name,builder in builders.items():
        parts=[]; builder()
        root=bpy.data.objects.new(module_name,None); export_collection.objects.link(root)
        root['module']=module_name; root['pivotMode']='center'; root['quality']=quality
        bpy.context.view_layer.update(); deps=bpy.context.evaluated_depsgraph_get(); merged={}
        for obj in parts:
            role=obj['paint_role']
            mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps),depsgraph=deps)
            mesh.transform(obj.matrix_world); mesh.update(); unwrap(mesh)
            part=bpy.data.objects.new(module_name+'_'+role,mesh); export_collection.objects.link(part)
            merged.setdefault(role,[]).append(part)
        triangles=0; minimum=Vector((math.inf,)*3); maximum=Vector((-math.inf,)*3)
        for role,meshes in merged.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in meshes: obj.select_set(True)
            bpy.context.view_layer.objects.active=meshes[0]
            if len(meshes)>1: bpy.ops.object.join()
            batch=meshes[0]; batch.name=module_name+'_'+role; batch.parent=root
            batch.data.materials.clear(); batch.data.materials.append(materials[role])
            for polygon in batch.data.polygons: polygon.material_index=0
            batch.data.calc_loop_triangles(); triangles+=len(batch.data.loop_triangles)
            for vertex in batch.data.vertices:
                for axis in range(3):
                    minimum[axis]=min(minimum[axis],vertex.co[axis]); maximum[axis]=max(maximum[axis],vertex.co[axis])
            exports.append(batch)
        exports.append(root); dims=maximum-minimum
        module_report[module_name]={'triangles':triangles,'materialBatches':len(merged),
            'dimensions':[round(dims.x,4),round(dims.z,4),round(dims.y,4)],
            'boundsMin':[round(minimum.x,4),round(minimum.z,4),round(-maximum.y,4)],
            'boundsMax':[round(maximum.x,4),round(maximum.z,4),round(-minimum.y,4)],'pivot':'center'}
        source_root=bpy.data.objects.new('Source '+module_name,None); collection.objects.link(source_root)
        for obj in parts: obj.parent=source_root
    bpy.ops.object.select_all(action='DESELECT')
    for obj in exports: obj.select_set(True)
    filename='kit-v1.glb' if detail else 'kit-low-v1.glb'
    bpy.ops.export_scene.gltf(filepath=str(DEST/filename),use_selection=True,export_format='GLB',
        export_yup=True,export_apply=True,export_extras=True,export_cameras=False,
        export_lights=False,export_animations=False,export_texcoords=True,export_normals=True)
    report['variants'][quality]={'file':filename,'bytes':(DEST/filename).stat().st_size,
        'triangles':sum(x['triangles'] for x in module_report.values()),'modules':module_report}
    for obj in exports: obj.name=quality+'/'+obj.name
    collection.hide_render=True; collection.hide_viewport=True
    export_collection.hide_render=True; export_collection.hide_viewport=True
    all_exports.append((export_collection,exports))
report['materials']={'glacier_'+name:{'baseColor':color,'metalness':metal,'roughness':rough,
    'emissiveStrength':0,'opacity':.2 if name=='glass' else 1} for name,(color,metal,rough) in palette.items()}
(DEST/'kit-v1.manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


def prepare_review():
    global active_collection
    review=bpy.data.collections.new('Review composition'); scene.collection.children.link(review)
    transforms={
        'anchor-post':[((-7,-6,2.5),(1,1,1))],
        'goal-buffer':[((-3.5,-5,1),(1,1,1))],
        'rink-board':[((2,-5,.4),(1,1,1))],
        'rink-glass':[((2,-5,1.5),(1,1,1))],
        'glacier-ridge':[((-2,8,9.6),(.8,.8,.8))],
        'snowy-pine':[((9,1,6),(1,1,1))],
    }
    for obj in all_exports[0][1]:
        if obj.type!='MESH': continue
        for location,scale in transforms[obj.parent['module']]:
            clone=obj.copy(); clone.data=obj.data; clone.parent=None
            clone.location=location; clone.scale=scale; review.objects.link(clone)
    active_collection=review
    box('Review neutral snow deck',(0,0,-.15),(100,100,.20),'snow',0)
    scene.world=bpy.data.worlds.new('Glacier neutral review'); scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.25,.30,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    for name,location,energy,color,size in (
        ('Glacier broad sun',(-9,-6,32),20000,(1,.94,.86),10),
        ('Glacier soft sky',(18,-12,18),12000,(.73,.86,1),14)):
        data=bpy.data.lights.new(name,'AREA'); data.energy,data.color,data.shape,data.size=energy,color,'DISK',size
        light=bpy.data.objects.new(name,data); review.objects.link(light); light.location=location
        light.rotation_euler=(Vector((0,2,5))-light.location).to_track_quat('-Z','Y').to_euler()
    camdata=bpy.data.cameras.new('Glacier kit review camera')
    camera=bpy.data.objects.new('Glacier kit review camera',camdata); review.objects.link(camera)
    camera.location=(29,-39,25)
    camera.rotation_euler=(Vector((0,2.4,7.8))-camera.location).to_track_quat('-Z','Y').to_euler()
    camdata.type='ORTHO'; camdata.ortho_scale=34; scene.camera=camera
    scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
    scene.render.resolution_x,scene.render.resolution_y=1600,1200
    scene.render.resolution_percentage=100; scene.view_settings.view_transform='AgX'
    scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(SOURCE/'glacier-kit-review.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'glacier-kit-v1.blend'))
    if not args.skip_render: bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report,indent=2))
