"""Original Circle Arena architecture, in metres. No gameplay/collision meshes.

Five centered modules with baked transforms, shared surface roles and metre UVs.
The topology is authored separately for High and Low; silhouettes stay identical.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'public/assets/circle/architecture'
SOURCE = ROOT / 'output/circle'
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
    'ceramic': ('#a8bac7', .12, .60),
    'alloy': ('#617786', .65, .39),
    'graphite': ('#253744', .20, .72),
    'cyan': ('#46bdce', .14, .44),
    'light': ('#c0e8ed', .05, .40),
    'dark': ('#101e28', .10, .80),
}
emission = {'cyan': .35, 'light': .55}
materials = {}
for name, (color, metal, rough) in palette.items():
    material = bpy.data.materials.new('circle_'+name)
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


def finish(obj, name, role, bevel=0):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    active_collection.objects.link(obj)
    obj.data.materials.append(materials[role])
    obj['paint_role'] = role
    if bevel < (.008 if detail else .045):
        bevel = 0
    if bevel:
        mod = obj.modifiers.new('Armor edge chamfer', 'BEVEL')
        mod.width = bevel
        mod.segments = 2 if detail and bevel >= .04 else 1
        obj.data.set_sharp_from_angle(angle=math.radians(35))
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new('Weighted armor normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
    parts.append(obj)
    return obj


def box(name, center, size, role='alloy', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, role, bevel)


def cylinder(name, center, radius, height, role='alloy', bevel=.015, segments=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments or (16 if detail else 8),
        radius=radius, depth=height, location=center)
    return finish(bpy.context.object, name, role, bevel)


def normalize_parts(dimensions):
    """Bake to exact Blender XYZ (exported XZY) centered envelope."""
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
            vertex.co = Vector([p[i]*factor[i] for i in range(3)])
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)


def perimeter_pylon():
    box('Continuous graphite structural spine',(0,0,0),(.82,.82,8.7),'graphite',.07)
    for z in (-4.24,4.24):
        box('Broad octagonal mounting collar',(0,0,z),(1.2,1.2,.52),'alloy',.12)
    for side in (-1,1):
        for z in (-2.1,1.65):
            box('Large quiet ceramic armor plate',(0,side*.45,z),(.79,.16,3.3),'ceramic',.08)
        box('Recessed shoulder status surround',(0,side*.49,3.65),(.61,.08,.28),'graphite',.025)
        box('Short inset cyan shoulder marker',(0,side*.535,3.65),(.37,.015,.065),'cyan',.008)
        for x in (-.48,.48):
            box('Long outer machined rail',(x,side*.35,0),(.15,.18,7.9),'alloy',.035)
        for z in (-3.85,-.3,3.4):
            box('Recessed horizontal collar key',(0,side*.48,z),(.72,.09,.12),'alloy',.018)
        if detail:
            for x in (-.28,.28):
                for z in (-3.46,-.78,.28,3.02):
                    bolt=cylinder('Captive hex armor fastener',(x,side*.54,z),.035,.012,'alloy',0,6)
                    bolt.rotation_euler.x=math.pi/2
    normalize_parts((1.2,1.2,9))


def ring_beam():
    box('Continuous overhead box girder',(0,0,0),(7,.9,.5),'graphite',.045)
    for side in (-1,1):
        for x in (-2.28,0,2.28):
            box('Broad overhead segmented armor',(x,side*.435,.045),(2.20,.055,.29),'ceramic',.025)
        box('Machined lower load rail',(0,side*.40,-.205),(6.85,.10,.075),'alloy',.012)
        for x in (-3.29,-1.15,1.15,3.29):
            box('Overhead exposed joint clamp',(x,side*.435,0),(.10,.09,.42),'alloy',.014)
    for x in (-2.35,0,2.35):
        box('Recessed downlight protective housing',(x,0,-.235),(.90,.38,.03),'alloy',.015)
        box('Narrow frosted downlight lens',(x,0,-.249),(.68,.08,.002),'light',0)
    if detail:
        for x in (-3.0,-1.6,1.6,3.0):
            for side in (-1,1):
                bolt=cylinder('Small overhead service latch',(x,side*.468,0),.023,.01,'alloy',0,6)
                bolt.rotation_euler.x=math.pi/2
    normalize_parts((7,.9,.5))


def projector_node():
    box('Projector armored lower plinth',(0,0,-.39),(1.8,1.2,.42),'alloy',.10)
    box('Projector inset dark chassis',(0,0,.04),(1.53,1.02,.63),'graphite',.07)
    for side in (-1,1):
        box('Projector machined side shoulder',(side*.76,0,.04),(.22,1.05,.76),'alloy',.055)
    box('Projector upper frame',(0,0,.48),(1.50,.94,.24),'alloy',.07)
    box('Recessed projector aperture well',(0,0,.575),(1.17,.66,.055),'dark',.025)
    box('Narrow cyan emitter element',(0,0,.599),(.68,.10,.002),'cyan',0)
    box('Inset black diagnostic panel',(0,-.521,.03),(.75,.02,.25),'dark',.02)
    box('Short diagnostic status strip',(.19,-.535,.06),(.20,.005,.025),'cyan',0)
    for x in (-.38,-.19,0,.19,.38):
        box('Recessed rear cooling channel',(x,.52,.02),(.055,.024,.29),'dark',0)
    if detail:
        for x in (-.62,.62):
            for y in (-.36,.36):
                cylinder('Projector recessed captive fastener',(x,y,.604),.032,.012,'alloy',0,6)
        for x in (-.59,.59):
            box('Projector lower service latch',(x,-.59,-.38),(.15,.02,.14),'graphite',.015)
    normalize_parts((1.8,1.2,1.2))


def service_pod():
    box('Sealed graphite equipment housing',(0,0,0),(3.84,2.24,2.80),'graphite',.14)
    for x in (-1.83,1.83):
        box('Large structural side buttress',(x,0,0),(.34,2.4,3),'alloy',.10)
    for side in (-1,1):
        for x in (-.84,.84):
            box('Large ceramic service access leaf',(x,side*1.145,.07),(1.55,.10,2.45),'ceramic',.07)
            box('Dark recessed lower cooling vent',(x,side*1.202,-.66),(1.14,.015,.46),'dark',.025)
            for z in (-.81,-.69,-.57):
                box('Broad sparse vent louver',(x,side*1.22,z),(1.08,.06,.045),'alloy',.012)
            box('Dark upper maintenance port',(x,side*1.202,.79),(.54,.02,.21),'dark',.025)
            box('Quiet recessed service indicator',(x+.10,side*1.217,.79),(.17,.006,.035),'light',0)
        box('Shared upper armor lintel',(0,side*1.14,1.30),(3.32,.11,.15),'alloy',.022)
        if detail:
            for x in (-1.47,-.20,.20,1.47):
                for z in (-1.02,1.08):
                    bolt=cylinder('Service door captive fastener',(x,side*1.207,z),.034,.012,'alloy',0,6)
                    bolt.rotation_euler.x=math.pi/2
    box('Raised sealed upper ceramic cover',(0,0,1.39),(3.32,2.07,.22),'ceramic',.07)
    box('Recessed roof maintenance rail',(0,0,1.49),(2.55,.32,.02),'graphite',.01)
    normalize_parts((4,2.4,3))


def backdrop_spire():
    box('Long graphite monolith spine',(0,0,0),(2.65,2.65,23.6),'graphite',.18)
    for z in (-10.95,10.95):
        box('Octagonal monolith base and crown',(0,0,z),(3.5,3.5,2.1),'alloy',.30)
    for side in (-1,1):
        for z in (-6.7,0,6.7):
            box('Large monolith ceramic armor shield',(0,side*1.42,z),(2.34,.30,5.95),'ceramic',.16)
        for x in (-1.39,1.39):
            box('Long monolith load bearing rail',(x,side*1.16,0),(.30,.36,20.6),'alloy',.08)
        for z in (-10,-3.4,3.4,10):
            box('Recessed spire expansion seam',(0,side*1.47,z),(2.14,.18,.28),'graphite',.025)
        for z in (-7.5,7.5):
            box('Small cyan monolith status inset',(0,side*1.581,z),(.13,.008,1.3),'cyan',.006)
        if detail:
            for x in (-.84,.84):
                for z in (-8.9,-4.5,-2.2,2.2,4.5,8.9):
                    box('Recessed armor clamp',(x,side*1.583,z),(.13,.018,.22),'alloy',.02)
    normalize_parts((3.5,3.5,24))


builders = {'perimeter-pylon':perimeter_pylon, 'ring-beam':ring_beam,
    'projector-node':projector_node, 'service-pod':service_pod, 'backdrop-spire':backdrop_spire}


def unwrap(mesh):
    """Physical metre UVs for shared runtime coatings."""
    uv=mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    for polygon in mesh.polygons:
        axis=max(range(3),key=lambda i:abs(polygon.normal[i]))
        for index in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv=(p.x,p.z) if axis==1 else (p.y,p.z) if axis==0 else (p.x,p.y)


report={'schema':1,'generator':'scripts/circle/author-kit.py','units':'metres',
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
report['materials']={'circle_'+name:{'baseColor':color,'metalness':metal,'roughness':rough,
    'emissiveStrength':emission.get(name,0),'opacity':1} for name,(color,metal,rough) in palette.items()}
(DEST/'kit-v1.manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


def prepare_review():
    global active_collection
    review=bpy.data.collections.new('Review composition'); scene.collection.children.link(review)
    transforms={
        'perimeter-pylon':[((-5,0,4.5),(1,1,1))],
        'ring-beam':[((0,0,9.0),(1,1,1))],
        'projector-node':[((-3,-3,.6),(1,1,1))],
        'service-pod':[((3,-1,1.5),(1,1,1))],
        'backdrop-spire':[((5,8,8.4),(.7,.7,.7))],
    }
    for obj in all_exports[0][1]:
        if obj.type!='MESH': continue
        for location,scale in transforms[obj.parent['module']]:
            clone=obj.copy(); clone.data=obj.data; clone.parent=None
            clone.location=location; clone.scale=scale; review.objects.link(clone)
    active_collection=review
    box('Review neutral graphite deck',(0,0,-.15),(100,100,.20),'graphite',0)
    scene.world=bpy.data.worlds.new('Circle neutral review'); scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.22,.29,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.55
    for name,location,energy,color,size in (
        ('Circle broad soft key',(-10,-10,28),16000,(1,.94,.87),10),
        ('Circle neutral cool fill',(16,-4,16),11000,(.75,.88,1),12)):
        data=bpy.data.lights.new(name,'AREA'); data.energy,data.color,data.shape,data.size=energy,color,'DISK',size
        light=bpy.data.objects.new(name,data); review.objects.link(light); light.location=location
        light.rotation_euler=(Vector((0,1,5))-light.location).to_track_quat('-Z','Y').to_euler()
    camdata=bpy.data.cameras.new('Circle kit review camera')
    camera=bpy.data.objects.new('Circle kit review camera',camdata); review.objects.link(camera)
    camera.location=(25,-35,22)
    camera.rotation_euler=(Vector((0,2,7.0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camdata.type='ORTHO'; camdata.ortho_scale=28; scene.camera=camera
    scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
    scene.render.resolution_x,scene.render.resolution_y=1600,1200
    scene.render.resolution_percentage=100; scene.view_settings.view_transform='AgX'
    scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(SOURCE/'circle-kit-review.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'circle-kit-v1.blend'))
    if not args.skip_render: bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report,indent=2))
