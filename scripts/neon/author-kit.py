"""Original Neon Outrun Grid architecture authored in Blender, metre units.

Four centered Y-up modules ship as material-merged opaque GLBs. These visuals
preserve the exact existing gameplay envelopes; collision remains game-owned.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'public/assets/neon/architecture'
SOURCE = ROOT / 'output/neon'
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
    'ceramic': ('#aebac7', .12, .62),
    'alloy': ('#687b91', .62, .47),
    'graphite': ('#263348', .28, .76),
    'accent': ('#56c9de', .10, .43),
    'window': ('#233b51', .30, .40),
}
materials = {}
for name, (color, metal, rough) in palette.items():
    material = bpy.data.materials.new('neon_'+name)
    material.diffuse_color = linear(color)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = linear(color)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if name in ('accent', 'window'):
        bsdf.inputs['Emission Color'].default_value = linear(color)
        bsdf.inputs['Emission Strength'].default_value = .45 if name == 'accent' else .08
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
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments or (24 if detail else 12),
        radius=radius, depth=height, location=center)
    return finish(bpy.context.object, name, role, bevel)


def radial_box(name, angle, radius, z, size, role, bevel=.025):
    obj = box(name, (math.sin(angle)*radius, -math.cos(angle)*radius, z), size, role, bevel)
    obj.rotation_euler.z = angle
    return obj


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
    """Fit non-cylindrical authored modules to exact original box dimensions."""
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


def beacon_column():
    # Cardinal vertices on these exact sleeves establish the existing collision
    # cylinder. The armor and lamps all remain inside it, including bevels.
    for z in (-3.86, 3.86):
        cylinder('Circular protective impact collar', (0, 0, z), .75, .28, 'alloy', 0)
    cylinder('Continuous sealed service spine', (0, 0, 0), .49, 7.55, 'graphite', .02)
    for z in (-3.48, -.88, 1.72, 3.39):
        cylinder('Tier structural keeper', (0, 0, z), .65, .16, 'alloy', .02)
    for a in (0, math.pi/2, math.pi, 3*math.pi/2):
        for z, h in ((-2.12, 2.45), (.48, 2.42), (2.61, 1.42)):
            radial_box('Broad armored beacon face', a, .50, z, (.70, .12, h), 'ceramic', .038)
            radial_box('Recessed vertical service reveal', a, .564, z, (.15, .014, h-.24), 'graphite', .012)
            radial_box('Protected narrow navigation light', a, .573, z, (.055, .006, h-.56), 'accent', .004)
        # Shallow metal corner rails break up the uniform cylinder silhouette.
        radial_box('Long chamfered backbone rib', a+math.pi/4, .60, -.1, (.15, .15, 6.65), 'alloy', .025)
        radial_box('Armor service identification plate', a, .566, -3.11, (.34, .012, .12), 'alloy', .012)
        if detail:
            for z in (-2.94, -.1, 1.20, 3.05):
                for x in (-.26, .26):
                    obj=radial_box('Captive field panel fastener', a, .566, z, (.044, .012, .07), 'alloy', .007)
                    obj.location.x += math.cos(a)*x
                    obj.location.y += math.sin(a)*x
    cylinder('Recessed top shield disc', (0, 0, 3.94), .57, .07, 'graphite', .012)


def goal_buffer():
    box('Continuous low impact buffer chassis', (0, 0, 0), (1.06, 3.82, 1.76), 'graphite', .07)
    for x in (-.50, .50):
        for y in (-1.86, 1.86):
            box('Reinforced chamfered buffer corner', (x,y,0), (.20,.28,2), 'alloy', .04)
        for z in (-.88,.88):
            box('Long protected crash rail', (x,0,z), (.20,4,.24), 'alloy', .035)
        for y in (-.87,.87):
            box('Broad ceramic crash shield', (x*1.04,y,0), (.13,1.56,1.55), 'ceramic', .065)
            box('Inset service handle well', (x*1.176,y,.45), (.012,.48,.14), 'graphite', .018)
            if detail:
                for yy in (y-.61,y+.61):
                    box('Shield clamp plate', (x*1.181,yy,-.52), (.009,.095,.16), 'alloy', .009)
    for y in (-1.91,1.91):
        box('Armored equipment end cap', (0,y,0), (.84,.16,1.59), 'ceramic', .055)
        box('Sheltered end cap navigation marker', (0,y*1.045,.55), (.48,.008,.07), 'accent', .006)
    box('Broad upper impact cap', (0,0,.88), (.81,3.52,.22), 'ceramic', .06)
    box('Top central protected service seam', (0,0,.995), (.045,3.18,.008), 'graphite', 0)
    normalize_parts((1.2,4,2))


def city_tower():
    # Wide plinth, three receding occupied volumes, exposed crown and deep
    # facade recesses make a recognizable city silhouette from the playfield.
    box('Broad beveled civic foundation', (0,0,-18), (12,12,2), 'graphite', .20)
    box('Armored foundation terrace', (0,0,-16.68), (11.2,11.2,.65), 'ceramic', .12)
    tiers=[(-5.6,22,8.8,9.2), (9.2,7.2,6.8,7.2), (15.1,4.4,4.4,4.8)]
    for tier,(z,h,w,d) in enumerate(tiers):
        box('Recessed occupied tower volume', (0,0,z), (w-.50,d-.50,h), 'graphite', .08)
        for sign in (-1,1):
            for x in (-w/2+.35,w/2-.35):
                box('Vertical ceramic facade pier', (x,sign*(d/2-.12),z), (.70,.24,h), 'ceramic', .055)
            for y in (-d/2+.35,d/2-.35):
                box('Side ceramic facade pier', (sign*(w/2-.12),y,z), (.24,.70,h), 'ceramic', .055)
            # Opaque shallow inset windows occupy restrained bands, with real
            # mullion depth. Broad graphite gaps keep the distant view calm.
            rows=6 if tier==0 and detail else 4 if tier==0 else 2
            for i in range(rows):
                zz=z-h*.40+(i+.5)*h*.80/rows
                box('Recessed horizontal occupied window band', (0,sign*(d/2-.21),zz), (w-1.65,.045,.32), 'window', .016)
                box('Window band lower sun shelf', (0,sign*(d/2-.13),zz-.23), (w-1.58,.24,.10), 'alloy', .014)
                box('Recessed side occupied window band', (sign*(w/2-.21),0,zz), (.045,d-1.65,.32), 'window', .016)
                box('Side window band lower sun shelf', (sign*(w/2-.13),0,zz-.23), (.24,d-1.58,.10), 'alloy', .014)
            # Large center panel shields create a clear armor language.
            box('Central vertical ceramic face shield', (0,sign*(d/2-.02),z+.15), (.78,.19,h*.79), 'ceramic', .05)
            box('Sheltered tower guide stripe', (0,sign*(d/2+.078),z+h*.20), (.065,.008,h*.19), 'accent', .004)
        for zz in (z-h/2+.12,z+h/2-.12):
            box('Projecting perimeter terrace crown', (0,0,zz), (w+.42,d+.42,.34), 'alloy', .055)
    for x in (-4.25,4.25):
        for y in (-4.45,4.45):
            box('Tall exterior shadow fin', (x,y,-4.2), (.34,.34,24.8), 'alloy', .055)
            beam('Chamfered diagonal foundation buttress', (x*.91,y*.91,-12), (x*1.25,y*1.19,-16.4), .38, role='alloy', bevel=.05)
    for x in (-1.68,1.68):
        box('Split sculptural crown pylon', (x,0,17.6), (.55,3.7,2.8), 'ceramic', .08)
        box('Crown sheltered endpoint lamp', (x,-1.86,18.15), (.18,.015,.11), 'accent', .008)
    box('Crown central technical equipment', (0,0,17.58), (1.8,2.3,.64), 'graphite', .08)
    if detail:
        for x in (-.55,0,.55):
            box('Inset rooftop cooling rib', (x,0,17.94), (.12,1.9,.12), 'alloy', .018)
    normalize_parts((12,12,38))


def armored_frond(angle, z, reach, uplift, width):
    # Closed, opaque double-sided prism: a swept lance with faceted camber,
    # broad vane panels and a raised central spar; no transparency or billboards.
    n=7 if detail else 4
    forward=Vector((math.cos(angle),math.sin(angle),0))
    tangent=Vector((-math.sin(angle),math.cos(angle),0))
    vertices=[]
    for i in range(n+1):
        t=i/n
        center=forward*(.15+reach*t)+Vector((0,0,z+uplift*math.sin(t*math.pi*.8)-.64*t*t))
        half=width*math.sin(math.pi*t)**.8+.015
        vertices.extend((center-tangent*half,center+Vector((0,0,.095*(1-t))),center+tangent*half,center-Vector((0,0,.045))))
    faces=[]
    for i in range(n):
        for k in range(4):
            faces.append((i*4+k,i*4+(k+1)%4,(i+1)*4+(k+1)%4,(i+1)*4+k))
    faces.extend(((3,2,1,0),tuple(n*4+k for k in range(4))))
    custom('Swept solid armored palm vane', vertices, faces, 'alloy')
    for j in range(3 if detail else 2):
        t0=.16+j*.20; t1=t0+.16
        p0=forward*(.15+reach*t0)+Vector((0,0,z+uplift*math.sin(t0*math.pi*.8)-.64*t0*t0+.10))
        p1=forward*(.15+reach*t1)+Vector((0,0,z+uplift*math.sin(t1*math.pi*.8)-.64*t1*t1+.10))
        beam('Ceramic central palm rib',p0,p1,.055,.065,'ceramic',.007)
    # Only two tiny navigation nodes per frond; never a fully glowing canopy.
    for t in (.30,.72):
        p=forward*(.15+reach*t)+Vector((0,0,z+uplift*math.sin(t*math.pi*.8)-.64*t*t+.11))
        obj=box('Sparse canopy locator node',p,(.12,.035,.016),'accent',.004)
        obj.rotation_euler.z=angle


def neon_palm():
    cylinder('Buried circular palm foundation',(0,0,-5.73),.66,.54,'graphite',.04)
    cylinder('Tapered armored service mast',(0,0,-1.78),.30,7.4,'alloy',.02)
    for z in (-4.95,-3.35,-1.75,-.15,1.35):
        cylinder('Segmented mast ceramic sleeve',(0,0,z),.37,1.34,'ceramic',.025)
        cylinder('Protected sleeve alloy keeper',(0,0,z+.70),.40,.10,'alloy',.015)
    for a in (0,math.pi/2,math.pi,3*math.pi/2):
        radial_box('Long service mast recess',a,.373,-2.60,(.055,.01,4.5),'graphite',0)
        radial_box('Mast orientation locator',a,.382,-4.6,(.038,.008,.42),'accent',.003)
    cylinder('Mechanical radial crown hub',(0,0,2.22),.59,.8,'graphite',.04)
    cylinder('Crown protective upper collar',(0,0,2.67),.63,.14,'alloy',.02)
    count=8 if detail else 6
    for i in range(count):
        a=i*math.tau/count
        armored_frond(a,2.35,3.85,1.85,.43)
    for i in range(4):
        a=i*math.pi/2+.35
        armored_frond(a,2.65,2.20,3.1,.30)
    normalize_parts((8,8,12))


builders = {'beacon-column': beacon_column, 'goal-buffer': goal_buffer,
            'city-tower': city_tower, 'neon-palm': neon_palm}


def unwrap(mesh):
    """Physical metre UVs; runtime surface materials select repeat density."""
    uv = mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    for polygon in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        for index in polygon.loop_indices:
            p = mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = ((p.x, p.z) if axis == 1 else (p.y, p.z) if axis == 0 else (p.x, p.y))


report = {'schema': 1, 'generator': 'scripts/neon/author-kit.py', 'units': 'metres',
    'coordinates': 'glTF Y-up; centered pivots; identity root and child transforms; physical UVs',
    'provenance': 'Original Blender-authored geometry; no third-party game geometry or character imagery',
    'variants': {}}
all_exports = []
for quality in ('high', 'low'):
    detail = quality == 'high'
    collection = bpy.data.collections.new('Editable '+quality)
    scene.collection.children.link(collection)
    active_collection = collection
    export_collection = bpy.data.collections.new('Runtime '+quality)
    scene.collection.children.link(export_collection)
    module_report = {}
    exports = []
    for module_name, builder in builders.items():
        parts = []
        builder()
        root = bpy.data.objects.new(module_name, None)
        export_collection.objects.link(root)
        root['module'] = module_name
        root['pivotMode'] = 'center'
        root['quality'] = quality
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        merged = {}
        for obj in parts:
            role = obj['paint_role']
            mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps), depsgraph=deps)
            mesh.transform(obj.matrix_world)
            mesh.update()
            unwrap(mesh)
            part = bpy.data.objects.new(module_name+'_'+role, mesh)
            export_collection.objects.link(part)
            merged.setdefault(role, []).append(part)
        triangles = 0
        minimum = Vector((math.inf,)*3)
        maximum = Vector((-math.inf,)*3)
        maximum_radial = 0
        for role, meshes in merged.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in meshes:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            if len(meshes) > 1:
                bpy.ops.object.join()
            batch = meshes[0]
            batch.name = module_name+'_'+role
            batch.parent = root
            batch.data.materials.clear()
            batch.data.materials.append(materials[role])
            for polygon in batch.data.polygons:
                polygon.material_index = 0
            batch.data.calc_loop_triangles()
            triangles += len(batch.data.loop_triangles)
            for vertex in batch.data.vertices:
                p = vertex.co
                maximum_radial = max(maximum_radial, math.hypot(p.x, p.y))
                for axis in range(3):
                    minimum[axis] = min(minimum[axis], p[axis])
                    maximum[axis] = max(maximum[axis], p[axis])
            exports.append(batch)
        exports.append(root)
        dims = maximum-minimum
        module_report[module_name] = {'triangles': triangles, 'materialBatches': len(merged),
            'dimensions': [round(dims.x, 4), round(dims.z, 4), round(dims.y, 4)],
            'boundsMin': [round(minimum.x, 4), round(minimum.z, 4), round(-maximum.y, 4)],
            'boundsMax': [round(maximum.x, 4), round(maximum.z, 4), round(-minimum.y, 4)],
            'maximumHorizontalRadius': round(maximum_radial, 6), 'pivot': 'center'}
        source_root = bpy.data.objects.new('Source '+module_name, None)
        collection.objects.link(source_root)
        for obj in parts:
            obj.parent = source_root
    bpy.ops.object.select_all(action='DESELECT')
    for obj in exports:
        obj.select_set(True)
    filename = 'kit-v1.glb' if detail else 'kit-low-v1.glb'
    bpy.ops.export_scene.gltf(filepath=str(DEST/filename), use_selection=True, export_format='GLB',
        export_yup=True, export_apply=True, export_extras=True, export_cameras=False,
        export_lights=False, export_animations=False, export_texcoords=True, export_normals=True)
    report['variants'][quality] = {'file': filename, 'bytes': (DEST/filename).stat().st_size,
        'triangles': sum(x['triangles'] for x in module_report.values()), 'modules': module_report}
    for obj in exports:
        obj.name = quality+'/'+obj.name
    collection.hide_render = True
    collection.hide_viewport = True
    export_collection.hide_render = True
    export_collection.hide_viewport = True
    all_exports.append((export_collection, exports))

report['materials'] = {'neon_'+name: {'baseColor': color, 'metalness': metal, 'roughness': rough,
    'emissiveStrength': .45 if name == 'accent' else .08 if name == 'window' else 0}
    for name, (color, metal, rough) in palette.items()}
(DEST/'kit-v1.manifest.json').write_text(json.dumps(report, indent=2)+'\n')


def prepare_review():
    global active_collection
    review = bpy.data.collections.new('Review composition')
    scene.collection.children.link(review)
    transforms = {
        'beacon-column': [((-5, -3.6, 4), (1, 1, 1))],
        'goal-buffer': [((-1.2, -5, 1), (1, 1, 1))],
        'city-tower': [((3.6, 7.8, 12.35), (.65, .65, .65))],
        'neon-palm': [((7.2, -1.5, 6), (1, 1, 1))],
    }
    for obj in all_exports[0][1]:
        if obj.type != 'MESH':
            continue
        for location, scale in transforms[obj.parent['module']]:
            clone = obj.copy()
            clone.data = obj.data
            clone.parent = None
            clone.location = location
            clone.scale = scale
            review.objects.link(clone)
    active_collection = review
    box('Review neutral deck', (0, 0, -.16), (100, 100, .25), 'graphite', 0)
    scene.world = bpy.data.worlds.new('Neon neutral review')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.11, .16, .23, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    for name, location, energy, color, size in (
        ('Broad orbital key', (-7, -6, 28), 11500, (.83, .91, 1), 12),
        ('Warm mining bounce', (-14, -2, 10), 4200, (1, .77, .51), 10),
        ('Soft frontal fill', (12, -15, 18), 11000, (.77, .89, 1), 13)):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
        light = bpy.data.objects.new(name, data)
        review.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 2, 5))-light.location).to_track_quat('-Z', 'Y').to_euler()
    camdata = bpy.data.cameras.new('Neon kit review camera')
    camera = bpy.data.objects.new('Neon kit review camera', camdata)
    review.objects.link(camera)
    camera.location = (27, -37, 23)
    camera.rotation_euler = (Vector((1, 2.4, 10.7))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camdata.type = 'ORTHO'
    camdata.ortho_scale = 42
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(SOURCE/'neon-kit-review.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'neon-kit-v1.blend'))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report, indent=2))
