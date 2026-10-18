"""Original Rainy Cyber Streets modular environment, authored in Blender.

All modules use centered metre pivots and opaque material-merged batches.
Existing gameplay collision and transforms remain owned by the game.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'public/assets/rainy/architecture'
SOURCE = ROOT / 'output/rainy'
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
    'concrete': ('#64717a', .04, .85),
    'ceramic': ('#a5b5bd', .14, .58),
    'alloy': ('#627986', .60, .40),
    'graphite': ('#26313a', .22, .70),
    'amber': ('#ffc583', .10, .38),
    'window': ('#856e51', .18, .38),
    'screen': ('#e4f9f5', .0, .80),
    'foliage': ('#3b6158', .0, .90),
}
emission = {'amber': 1.2, 'window': .10, 'screen': .15}
materials = {}
for name, (color, metal, rough) in palette.items():
    material = bpy.data.materials.new('rainy_'+name)
    material.diffuse_color = linear(color)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = linear(color)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if name in emission:
        bsdf.inputs['Emission Color'].default_value = linear(color)
        bsdf.inputs['Emission Strength'].default_value = emission[name]
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
    if bevel < (.015 if detail else .035):
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
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments or (16 if detail else 10),
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


def normalize_parts(dimensions):
    """Apply modifiers and fit exact Blender XYZ / exported XZY dimensions."""
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
            vertex.co = [p[i]*factor[i] for i in range(3)]
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)


def street_buffer():
    box('Sealed reinforced street buffer body', (0,0,0), (1.05,3.82,1.76), 'graphite', .07)
    for x in (-.50,.50):
        for y in (-1.86,1.86):
            box('Broad chamfered crash corner', (x,y,0), (.20,.28,2), 'alloy', .045)
        for z in (-.88,.88):
            box('Long impact crash rail', (x,0,z), (.20,4,.24), 'alloy', .035)
        for y in (-.88,.88):
            box('Sloped ceramic barrier shield', (x*1.04,y,0), (.13,1.56,1.55), 'ceramic', .065)
            box('Inset broad service handle', (x*1.177,y,.43), (.011,.5,.17), 'graphite', .018)
            box('Protected side safety reflector', (x*1.18,y,-.56), (.009,.36,.052), 'amber', 0)
            if detail:
                for yy in (y-.61,y+.61):
                    box('Captive shield service clamp', (x*1.181,yy,-.40), (.009,.10,.20), 'alloy', .009)
    for y in (-1.91,1.91):
        box('Shielded barrier end panel', (0,y,0), (.84,.16,1.59), 'ceramic', .055)
        box('Sheltered end cap lamp', (0,y*1.045,.55), (.48,.008,.06), 'amber', 0)
    box('Broad upper barrier cap', (0,0,.88), (.81,3.52,.22), 'ceramic', .06)
    box('Quiet top service seam', (0,0,.995), (.045,3.18,.008), 'graphite', 0)
    normalize_parts((1.2,4,2))


def cargo_crate():
    box('Recessed structural cargo core',(0,0,0),(1.80,1.80,1.80),'graphite',.09)
    for x in (-.84,.84):
        for y in (-.84,.84):
            box('Full height reinforced crate corner',(x,y,0),(.32,.32,2),'alloy',.055)
    for z in (-.87,.87):
        for sign in (-1,1):
            box('Transverse protective impact rail',(0,sign*.88,z),(1.62,.24,.26),'alloy',.04)
            box('Side protective impact rail',(sign*.88,0,z),(.24,1.62,.26),'alloy',.04)
    for sign in (-1,1):
        box('Broad recessed ceramic cargo face',(0,sign*.91,0),(1.46,.12,1.40),'ceramic',.055)
        box('Broad recessed ceramic cargo side',(sign*.91,0,0),(.12,1.46,1.40),'ceramic',.055)
        box('Deep recessed carrying slot',(0,sign*.975,.36),(.60,.008,.13),'graphite',0)
        box('Side deep carrying slot',(sign*.975,0,.36),(.008,.60,.13),'graphite',0)
        for x in (-.57,.57):
            box('Cargo tie down pocket',(x,sign*.976,-.45),(.11,.01,.18),'graphite',0)
        if detail:
            for x in (-.28,0,.28):
                box('Shallow reinforced panel rib',(x,sign*.976,-.11),(.045,.016,.36),'alloy',0)
    box('Recessed armored cargo lid',(0,0,.94),(1.47,1.47,.12),'ceramic',.04)
    box('Cargo lid central seal',(0,0,1),(.045,1.24,.006),'graphite',0)
    normalize_parts((2,2,2))


def building_block():
    box('Monolithic foundation plinth',(0,0,-17),(14,12,2),'concrete',.22)
    box('Wet armored street frontage',(0,0,-14.8),(13.2,11.2,2.6),'graphite',.10)
    # Three broad setbacks create a strong skyline without filling the playfield
    # with dozens of bright window slivers.
    tiers=[(-5.2,16.6,12.2,10.2),(7.5,8.4,10.3,8.8),(14.1,4.8,7.6,7.2)]
    for tier,(z,h,w,d) in enumerate(tiers):
        box('Deep recessed occupied building volume',(0,0,z),(w-.6,d-.6,h),'graphite',.06)
        for sign in (-1,1):
            for x in (-w/2+.45,w/2-.45):
                box('Tall concrete facade pilaster',(x,sign*(d/2-.15),z),(.9,.30,h),'concrete',.075)
            for y in (-d/2+.45,d/2-.45):
                box('Tall side concrete pilaster',(sign*(w/2-.15),y,z),(.30,.9,h),'concrete',.075)
            box('Split central concrete service spine',(0,sign*(d/2-.08),z),(.72,.44,h*.92),'concrete',.055)
            rows=(5 if detail else 3) if tier==0 else 3 if tier==1 else 2
            for i in range(rows):
                zz=z-h*.40+(i+.5)*h*.80/rows
                for x in (-w*.23,w*.23):
                    box('Inset protected occupied window',(x,sign*(d/2-.28),zz),(w*.31,.025,.55),'window',0)
                    box('Deep lower window drip ledge',(x,sign*(d/2-.07),zz-.38),(w*.34,.48,.12),'alloy',.015)
                box('Inset side occupied window band',(sign*(w/2-.28),0,zz),(.025,d-2.1,.52),'window',0)
            if tier==0:
                box('Broad lower utility access cover',(w*.28,sign*(d/2+.005),z-h*.26),(1.65,.22,2.6),'alloy',.05)
                box('Small covered access indicator',(w*.28,sign*(d/2+.121),z-h*.26+.72),(.52,.01,.06),'amber',0)
                if detail:
                    for j in range(5):
                        box('Sheltered utility vent slat',(w*.28,sign*(d/2+.125),z-h*.26-.5+j*.18),(1.2,.03,.06),'graphite',0)
        for zz in (z-h/2+.11,z+h/2-.11):
            box('Wide structural terrace reveal',(0,0,zz),(w+.42,d+.42,.34),'alloy',.06)
    for sign in (-1,1):
        beam('Foundation angled concrete buttress',(sign*5.2,-5.2,-9.8),(sign*6.5,-5.2,-15.6),.65,.8,'concrete',.08)
        box('Roof mechanical exhaust tower',(sign*2.1,0,16.7),(.85,3.6,2.6),'alloy',.07)
        if detail:
            for y in (-1.1,-.55,0,.55,1.1):
                box('Roof exhaust louvre',(sign*2.1,y,18.01),(.60,.12,.08),'graphite',0)
    box('Roof mechanical service bridge',(0,0,16.55),(3.5,2.1,.5),'graphite',.05)
    normalize_parts((14,12,36))


def streetlight():
    box('Broad bolted street lamp footing',(-.72,0,-4.65),(1.04,2,.70),'alloy',.08)
    box('Chamfered lower lamp armor',(-.72,0,-3.30),(.80,.82,2.35),'ceramic',.07)
    box('Recessed pole service door',(-.72,-.421,-3.20),(.46,.018,1.35),'graphite',.02)
    box('Tapered rectangular street lamp shaft',(-.72,0,.63),(.34,.46,6.10),'alloy',.045)
    beam('Continuous swept lamp bracket',(-.72,0,3.56),(-.22,0,4.26),.38,.46,'alloy',.045)
    beam('Extended lamp arm',(-.22,0,4.26),(1.15,0,4.43),.30,.42,'alloy',.035)
    box('Armored sodium lamp housing',(1.10,0,4.40),(1.60,.84,.52),'ceramic',.07)
    box('Recessed dark lamp socket',(1.10,0,4.13),(1.23,.65,.07),'graphite',.025)
    box('Broad guarded warm sodium lens',(1.10,0,4.085),(1.04,.46,.025),'amber',0)
    for x in (.67,1.10,1.53):
        box('Protective metal lamp lens cage',(x,0,4.06),(.045,.65,.045),'alloy',0)
    if detail:
        for x in (-1.02,-.42):
            for y in (-.7,.7):
                cylinder('Foundation captive anchor bolt',(x,y,-4.265),.07,.10,'graphite',0,8)
        box('Inset lower lamp maintenance label',(-.72,-.434,-2.90),(.23,.008,.13),'ceramic',0)
    normalize_parts((3,2,10))


def billboard_frame():
    box('Solid dark billboard backing',(0,.10,0),(11.65,1.08,7.65),'graphite',.12)
    for x in (-5.72,5.72):
        box('Armored billboard vertical stile',(x,-.12,0),(.56,1.6,8),'alloy',.09)
    for z in (-3.72,3.72):
        box('Armored billboard horizontal rail',(0,-.12,z),(10.94,1.6,.56),'alloy',.09)
    for x in (-5.35,5.35):
        box('Light ceramic edge armor',(x,-.76,0),(.18,.08,6.85),'ceramic',.015)
    for z in (-3.35,3.35):
        box('Light ceramic top and bottom trim',(0,-.76,z),(10.52,.08,.18),'ceramic',.015)
    for sign in (-1,1):
        beam('Rear diagonal wind load brace',(-4.9,.72,sign*3.0),(4.9,.72,-sign*3.0),.20,.15,'alloy',.02)
    # Blender -Y becomes Three.js +Z. Quad winding faces the playfield.
    custom('Front dog graphic screen', [(-5.20,-.69,-3.20),(5.20,-.69,-3.20),
        (5.20,-.69,3.20),(-5.20,-.69,3.20)], [(0,1,2,3)], 'screen')
    if detail:
        for x in (-4,-2,0,2,4):
            box('Lower sheltered rain drain',(x,-.927,-3.72),(.38,.012,.055),'graphite',0)
    normalize_parts((12,1.6,8))


def palm_frond(angle, z, reach, uplift, width):
    # Closed natural leaf ribbons keep foliage opaque and cheap, with connected
    # central stems rather than floating cards or transparent alpha layers.
    n=8 if detail else 5
    forward=Vector((math.cos(angle),math.sin(angle),0))
    tangent=Vector((-math.sin(angle),math.cos(angle),0))
    vertices=[]
    for i in range(n+1):
        t=i/n
        center=forward*(reach*t)+Vector((0,0,z+uplift*math.sin(t*math.pi*.86)-1.22*t*t))
        half=width*math.sin(math.pi*t)**.65+.01
        vertices.extend((center-tangent*half,center+Vector((0,0,.055*(1-t))),
            center+tangent*half,center-Vector((0,0,.025))))
    faces=[]
    for i in range(n):
        for k in range(4):
            faces.append((i*4+k,i*4+(k+1)%4,(i+1)*4+(k+1)%4,(i+1)*4+k))
    faces.extend(((3,2,1,0),tuple(n*4+k for k in range(4))))
    custom('Swept broad natural palm leaf',vertices,faces,'foliage')


def street_palm():
    box('Wide armored city planter',(0,0,-5.51),(2.1,2.1,.98),'concrete',.12)
    box('Dark sealed planter soil',(0,0,-4.99),(1.75,1.75,.10),'graphite',.04)
    cylinder('Continuous natural palm trunk',(0,0,-.74),.28,8.50,'graphite',.01)
    count=16 if detail else 9
    for i in range(count):
        zz=-4.5+i*7.7/(count-1)
        cylinder('Quiet overlapping trunk bark ring',(0,0,zz),.30+.025*math.sin(i*1.7),.19,'graphite',0,10 if detail else 8)
    cylinder('Connected natural palm crown',(0,0,3.55),.45,.95,'foliage',.02)
    count=8 if detail else 6
    for i in range(count):
        palm_frond(i*math.tau/count,3.62,3.94,1.65,.46)
    for i in range(4):
        palm_frond(i*math.pi/2+.33,3.77,2.12,2.94,.31)
    normalize_parts((8,8,12))


builders = {'street-buffer': street_buffer, 'cargo-crate': cargo_crate,
    'building-block': building_block, 'streetlight': streetlight,
    'billboard-frame': billboard_frame, 'street-palm': street_palm}


def unwrap(mesh, role):
    """Physical metre UVs except the art screen, which uses a full 0–1 chart."""
    uv = mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    if role == 'screen':
        xmin=min(v.co.x for v in mesh.vertices); xmax=max(v.co.x for v in mesh.vertices)
        zmin=min(v.co.z for v in mesh.vertices); zmax=max(v.co.z for v in mesh.vertices)
    for polygon in mesh.polygons:
        axis=max(range(3),key=lambda i:abs(polygon.normal[i]))
        for index in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = (((p.x-xmin)/(xmax-xmin),(p.z-zmin)/(zmax-zmin)) if role=='screen'
                else (p.x,p.z) if axis==1 else (p.y,p.z) if axis==0 else (p.x,p.y))


report = {'schema': 1, 'generator': 'scripts/rainy/author-kit.py', 'units': 'metres',
    'coordinates': 'glTF Y-up; centered pivots; identity transforms; metre UVs except 0–1 +Z screen',
    'provenance': 'Original Blender-authored geometry; no third-party game geometry or character imagery',
    'variants': {}}
all_exports=[]
for quality in ('high','low'):
    detail=quality=='high'
    collection=bpy.data.collections.new('Editable '+quality)
    scene.collection.children.link(collection)
    active_collection=collection
    export_collection=bpy.data.collections.new('Runtime '+quality)
    scene.collection.children.link(export_collection)
    module_report={}
    exports=[]
    for module_name,builder in builders.items():
        parts=[]
        builder()
        root=bpy.data.objects.new(module_name,None)
        export_collection.objects.link(root)
        root['module']=module_name; root['pivotMode']='center'; root['quality']=quality
        bpy.context.view_layer.update()
        deps=bpy.context.evaluated_depsgraph_get()
        merged={}
        for obj in parts:
            role=obj['paint_role']
            mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps),depsgraph=deps)
            mesh.transform(obj.matrix_world)
            mesh.update()
            unwrap(mesh,role)
            part=bpy.data.objects.new(module_name+'_'+role,mesh)
            export_collection.objects.link(part)
            merged.setdefault(role,[]).append(part)
        triangles=0
        minimum=Vector((math.inf,)*3); maximum=Vector((-math.inf,)*3)
        for role,meshes in merged.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in meshes: obj.select_set(True)
            bpy.context.view_layer.objects.active=meshes[0]
            if len(meshes)>1: bpy.ops.object.join()
            batch=meshes[0]; batch.name=module_name+'_'+role; batch.parent=root
            batch.data.materials.clear(); batch.data.materials.append(materials[role])
            for polygon in batch.data.polygons: polygon.material_index=0
            batch.data.calc_loop_triangles()
            triangles+=len(batch.data.loop_triangles)
            for vertex in batch.data.vertices:
                for axis in range(3):
                    minimum[axis]=min(minimum[axis],vertex.co[axis])
                    maximum[axis]=max(maximum[axis],vertex.co[axis])
            exports.append(batch)
        exports.append(root)
        dims=maximum-minimum
        module_report[module_name]={'triangles':triangles,'materialBatches':len(merged),
            'dimensions':[round(dims.x,4),round(dims.z,4),round(dims.y,4)],
            'boundsMin':[round(minimum.x,4),round(minimum.z,4),round(-maximum.y,4)],
            'boundsMax':[round(maximum.x,4),round(maximum.z,4),round(-minimum.y,4)],'pivot':'center'}
        source_root=bpy.data.objects.new('Source '+module_name,None)
        collection.objects.link(source_root)
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
report['materials']={'rainy_'+name:{'baseColor':color,'metalness':metal,'roughness':rough,
    'emissiveStrength':emission.get(name,0)} for name,(color,metal,rough) in palette.items()}
(DEST/'kit-v1.manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


def prepare_review():
    global active_collection
    review=bpy.data.collections.new('Review composition'); scene.collection.children.link(review)
    transforms={
        'street-buffer':[((-5,-6,1),(1,1,1))],
        'cargo-crate':[((-1.5,-6,1),(1,1,1))],
        'building-block':[((0,7,11.7),(.65,.65,.65))],
        'streetlight':[((7,-2,5),(1,1,1))],
        'billboard-frame':[((-10,4,7),(.70,.70,.70))],
        'street-palm':[((9,7,6),(1,1,1))],
    }
    for obj in all_exports[0][1]:
        if obj.type!='MESH': continue
        for location,scale in transforms[obj.parent['module']]:
            clone=obj.copy(); clone.data=obj.data; clone.parent=None
            clone.location=location; clone.scale=scale; review.objects.link(clone)
    active_collection=review
    box('Review neutral deck',(0,0,-.16),(100,100,.25),'graphite',0)
    scene.world=bpy.data.worlds.new('Rainy neutral review'); scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.11,.16,.23,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    for name,location,energy,color,size in (
        ('Overcast broad key',(-7,-6,28),16000,(.83,.91,1),12),
        ('Warm sodium bounce',(-14,-2,10),4200,(1,.77,.51),10),
        ('Soft frontal fill',(12,-15,18),14000,(.77,.89,1),13)):
        data=bpy.data.lights.new(name,'AREA')
        data.energy,data.color,data.shape,data.size=energy,color,'DISK',size
        light=bpy.data.objects.new(name,data); review.objects.link(light); light.location=location
        light.rotation_euler=(Vector((0,2,5))-light.location).to_track_quat('-Z','Y').to_euler()
    camdata=bpy.data.cameras.new('Rainy kit review camera')
    camera=bpy.data.objects.new('Rainy kit review camera',camdata); review.objects.link(camera)
    camera.location=(29,-39,25)
    camera.rotation_euler=(Vector((0,2.4,10.3))-camera.location).to_track_quat('-Z','Y').to_euler()
    camdata.type='ORTHO'; camdata.ortho_scale=44; scene.camera=camera
    scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
    scene.render.resolution_x,scene.render.resolution_y=1600,1200
    scene.render.resolution_percentage=100; scene.view_settings.view_transform='AgX'
    scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(SOURCE/'rainy-kit-review.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'rainy-kit-v1.blend'))
    if not args.skip_render: bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report,indent=2))
