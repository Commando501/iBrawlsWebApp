"""Original Vanguard Asteroid Mine architecture authored in Blender, metre units.

Six centered Y-up modules ship as material-merged opaque GLBs. These visuals
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
DEST = ROOT / 'public/assets/asteroid/architecture'
SOURCE = ROOT / 'output/asteroid'
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
    'rock': ('#707681', .02, .91),
    'ore': ('#a78553', .32, .72),
    'ceramic': ('#b4bec4', .09, .62),
    'alloy': ('#72818c', .65, .49),
    'graphite': ('#2d3744', .28, .74),
    'amber': ('#e3ac62', .04, .40),
    'hazard': ('#a88a4d', .10, .72),
}
materials = {}
for name, (color, metal, rough) in palette.items():
    material = bpy.data.materials.new('asteroid_'+name)
    material.diffuse_color = linear(color)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = linear(color)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if name == 'amber':
        bsdf.inputs['Emission Color'].default_value = linear(color)
        bsdf.inputs['Emission Strength'].default_value = .65
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
    if not detail and bevel < .035:
        bevel = 0
    if bevel:
        mod = obj.modifiers.new('Machined edge roll', 'BEVEL')
        mod.width = bevel
        mod.segments = 2 if detail else 1
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


def ore_extractor():
    # Cardinal cylinder collar vertices define exact radius1.3 and height5.
    cylinder('Lower extractor pressure vessel', (0, 0, -1.50), .92, 1.70, 'graphite', .04)
    cylinder('Upper extractor pressure vessel', (0, 0, 1.69), .92, 1.20, 'graphite', .04)
    for z, h in ((-2.25, .5), (2.30, .4)):
        cylinder('Full diameter containment flange', (0, 0, z), 1.3, h, 'alloy', .045, 24 if detail else 12)
        cylinder('Inset machined flange shoulder', (0, 0, z*.82), 1.12, .15, 'graphite', .018)
    cylinder('Protected amber extraction chamber', (0, 0, .16), .84, 1.55, 'amber', .02)
    for z in (-.72, 1.04):
        cylinder('Chamber keeper ring', (0, 0, z), .98, .13, 'alloy', .018)
    for i in range(8):
        angle = i*math.tau/8
        radial_box('Longitudinal chamber cage', angle, .98, .14, (.14, .18, 1.84), 'alloy', .022)
        for z, h in ((-1.48, 1.19), (1.61, .94)):
            radial_box('Broad insulated pressure shield', angle, .985, z, (.63, .17, h), 'ceramic', .045)
            radial_box('Shield expansion reveal', angle, 1.075, z-h*.25, (.43, .008, .035), 'graphite', 0)
        radial_box('Recessed service status lamp', angle, 1.078, -1.20, (.15, .012, .055), 'amber', .005)
        if detail:
            for z in (-2.25, 2.30):
                radial_box('Flange tooling slot', angle, 1.284, z, (.19, .015, .11), 'graphite', .012)
            for z in (1.43, 1.52, 1.61):
                radial_box('Cooling grille recess', angle, 1.074, z, (.36, .008, .025), 'graphite', 0)
            radial_box('Captured shield latch', angle, 1.079, -1.82, (.16, .015, .08), 'alloy', .009)


def fractured_mass(name, center, scale, seed, ore=True):
    # Uneven rings and offset crowns produce fractured, slab-like basalt. The
    # crown is slanted rather than a spherical primitive or uniform low-poly ball.
    n = 18 if detail else 10
    profile = [(-.5, .60), (-.40, .92), (-.10, 1), (.22, .86), (.43, .64), (.5, .36)]
    verts = []
    for j, (height, width) in enumerate(profile):
        for i in range(n):
            a = i*math.tau/n
            square = .77+.23/max(abs(math.cos(a)), abs(math.sin(a)))
            fractured = 1+.11*math.sin(i*2.73+seed+j*.61)+.06*math.sin(i*1.27+j*2.2)
            radius = .5*width*square*fractured
            x = math.cos(a)*radius + .12*height
            y = math.sin(a)*radius - .06*height
            z = height+.065*math.sin(i*1.9+seed)*math.sin(math.pi*j/(len(profile)-1))
            verts.append((center[0]+x*scale[0], center[1]+y*scale[1], center[2]+z*scale[2]))
    faces = [tuple(reversed(range(n)))]
    for j in range(len(profile)-1):
        for i in range(n):
            # Split select facets diagonally for visible fracture changes.
            a, b, c, d = j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i
            if (i+j)%3 == 0:
                faces.extend(((a, b, c), (a, c, d)))
            else:
                faces.append((a, b, c, d))
    faces.append(tuple((len(profile)-1)*n+i for i in range(n)))
    custom(name, verts, faces, 'rock')
    if ore:
        # Sparse fracture-infill mineral slivers sit against a few faces, never
        # an all-over glowing pattern. Mineral material itself is nonemissive.
        for i in (1, n//2+1, n-2):
            base = Vector(verts[n+i])
            mid = Vector(verts[2*n+i])
            top = Vector(verts[3*n+i])
            tangent = Vector((-math.sin(i*math.tau/n), math.cos(i*math.tau/n), 0))*min(scale)*.014
            push = Vector((math.cos(i*math.tau/n), math.sin(i*math.tau/n), 0))*.006
            custom('Narrow exposed ore fracture', [base+push-tangent, base+push+tangent,
                mid+push+tangent*.65, top+push, mid+push-tangent*.40],
                [(0, 1, 2), (0, 2, 4), (4, 2, 3)], 'ore')


def ore_cluster():
    fractured_mass('Main fractured ore body', (0, 0, .03), (2.10, 2.12, 3), .8)
    fractured_mass('Sheared attached ore shoulder', (.54, .15, -.43), (1.15, 1.7, 1.8), 2.6)
    fractured_mass('Small attached basal fracture', (-.52, -.29, -.80), (1.12, 1.18, 1.25), 4.7, False)
    normalize_parts((2.2, 2.2, 3))


def freight_container():
    box('Sealed freight chassis', (0, 0, 0), (1.61, 3.32, 1.77), 'graphite', .06)
    for z in (-.90, .90):
        for x in (-.79, .79):
            box('Long protected cargo rail', (x, 0, z), (.22, 3.5, .20), 'alloy', .035)
        for y in (-1.64, 1.64):
            box('Reinforced cargo end rail', (0, y, z), (1.36, .22, .20), 'alloy', .035)
    for x in (-.79, .79):
        for y in (-1.64, 1.64):
            box('Freight corner post', (x, y, 0), (.22, .22, 1.60), 'alloy', .03)
            box('Lift identification collar', (x, y, .58), (.225, .225, .14), 'hazard', .014)
    for sign in (-1, 1):
        box('Broad inset corrugated siding', (sign*.806, 0, 0), (.12, 2.98, 1.52), 'ceramic', .035)
        for y in ([-1.22, -.81, -.40, 0, .40, .81, 1.22] if detail else [-1.2, -.6, 0, .6, 1.2]):
            box('Formed cargo siding rib', (sign*.874, y, 0), (.045, .075, 1.35), 'ceramic', .012)
        box('Two leaf equipment door', (0, sign*1.667, 0), (1.34, .12, 1.53), 'ceramic', .045)
        box('Door central weather seal', (0, sign*1.731, 0), (.043, .014, 1.47), 'graphite', 0)
        for x in (-.44, .44):
            box('Vertical transport latch', (x, sign*1.74, .02), (.055, .018, 1.18), 'alloy', .007)
            box('Protected latch pocket', (x, sign*1.75, .17), (.17, .014, .12), 'graphite', .008)
        box('Service identification plate', (0, sign*1.749, -.52), (.55, .008, .13), 'hazard', .006)
    box('Inset cargo lid', (0, 0, .912), (1.31, 2.97, .045), 'ceramic', .025)
    if detail:
        for y in (-1.1, -.55, 0, .55, 1.1):
            box('Roof formed stiffener', (0, y, .949), (1.12, .07, .03), 'ceramic', .008)
    normalize_parts((1.8, 3.5, 2))


def blast_partition():
    box('Continuous blast backbone', (0, 0, 0), (4.74, .26, 2.72), 'graphite', .05)
    for x in (-2.34, 2.34):
        box('Machined blast door jamb', (x, 0, 0), (.32, .40, 3), 'alloy', .045)
    for z in (-1.37, 1.37):
        box('Protected horizontal blast rail', (0, 0, z), (4.4, .40, .26), 'alloy', .035)
    for side in (-1, 1):
        for x in (-1.07, 1.07):
            box('Large blast ceramic shield', (x, side*.14, .01), (2.02, .105, 2.39), 'ceramic', .045)
            box('Lower impact skirting plate', (x, side*.196, -.83), (1.82, .008, .34), 'alloy', .015)
            box('Broad recessed service seam', (x, side*.197, .62), (1.56, .006, .038), 'graphite', 0)
            if detail:
                for xx in (x-.77, x+.77):
                    box('Captive shield bolt', (xx, side*.197, 1.02), (.065, .006, .09), 'alloy', .006)
        box('Protected central joint', (0, side*.165, 0), (.09, .065, 2.46), 'graphite', .015)
        box('Small amber passage marker', (0, side*.196, 1.37), (.52, .008, .055), 'amber', .004)
    normalize_parts((5, .4, 3))


def asteroid_crag():
    fractured_mass('Large asymmetric fractured basalt', (-1.2, .7, .2), (11.8, 12.1, 13.5), 3.2)
    fractured_mass('Sheared rear crag slab', (3, 2.1, -.5), (7.8, 8.8, 11.6), 6.1, False)
    fractured_mass('Attached jutting foreground shelf', (1.4, -3, -3.6), (9.8, 7.6, 6.1), 8.6)
    if detail:
        fractured_mass('Exposed stepped fracture', (-4.7, -1.6, -4.4), (4.7, 6.2, 4.5), 10.1, False)
    normalize_parts((14, 14, 14))


def mining_gantry():
    # Open truss silhouette belongs beyond the combat floor; no opaque wall
    # or oversized light plane obscures the existing local cover arrangement.
    for x in (-4.8, 4.8):
        for y in (-2.55, 2.55):
            box('Gantry ground foundation', (x, y, -7.55), (1.7, 1.7, .9), 'graphite', .09)
            box('Tall structural gantry column', (x, y, -.65), (.48, .48, 13.0), 'alloy', .05)
            box('Column ceramic impact guard', (x, y, -5.6), (.60, .60, 2.1), 'ceramic', .055)
        for y in (-2.55, 2.55):
            for z in (-4, 0, 4):
                # Repeated shallow diagonals give real silhouette depth.
                beam('Portal diagonal brace', (x, y, z-1.8), (x, -y, z+1.8), .17, role='alloy', bevel=.018)
        for z in (-4, 0, 4):
            beam('Portal cross tie', (x, -2.55, z), (x, 2.55, z), .25, role='alloy', bevel=.02)
    for y in (-2.55, 2.55):
        box('Upper gantry traverse', (0, y, 5.88), (12, .64, .90), 'alloy', .065)
        box('Traverse sheltered service cavity', (0, y+math.copysign(.33, y), 5.91), (9.6, .018, .24), 'graphite', .015)
        for x in (-3.6, 3.6):
            box('Small gantry worklight', (x, y+math.copysign(.345, y), 5.91), (.96, .012, .12), 'amber', .008)
        beam('Under beam corner gusset', (-4.8, y, 3.8), (-3.1, y, 5.5), .30, role='alloy')
        beam('Under beam corner gusset', (4.8, y, 3.8), (3.1, y, 5.5), .30, role='alloy')
    box('Maintenance bridge deck', (0, 0, 5.3), (10.3, 5.8, .38), 'graphite', .05)
    for y in (-3.25, 3.25):
        box('Bridge outer ceramic armor', (0, y, 5.37), (10.4, .5, .9), 'ceramic', .065)
        box('Bridge hazard identification', (-3.8, y+math.copysign(.255, y), 5.38), (.9, .012, .20), 'hazard', .008)
    box('Suspended extraction motor enclosure', (0, 0, 6.80), (3.1, 3.1, 2.4), 'ceramic', .12)
    box('Motor lower cradle', (0, 0, 5.60), (3.6, 3.6, .34), 'alloy', .055)
    cylinder('Extraction spindle', (0, 0, 2.7), .45, 5.4, 'alloy', .04)
    cylinder('Suspended drill pressure sleeve', (0, 0, 3.2), .86, 2.5, 'graphite', .045)
    for z in (2.05, 3.2, 4.35):
        cylinder('Extraction sleeve keeper', (0, 0, z), 1.0, .18, 'alloy', .025)
    for i in range(4):
        angle = i*math.pi/2
        radial_box('Motor equipment panel reveal', angle, 1.556, 6.8, (2.38, .012, .64), 'graphite', .025)
        radial_box('Protected motor worklight', angle, 1.565, 7.24, (.58, .012, .10), 'amber', .008)
        if detail:
            for z in (6.62, 6.80, 6.98):
                radial_box('Motor grille division', angle, 1.566, z, (2.02, .012, .045), 'alloy', .006)
    normalize_parts((12, 7, 16))


builders = {'ore-extractor': ore_extractor, 'ore-cluster': ore_cluster,
    'freight-container': freight_container, 'blast-partition': blast_partition,
    'asteroid-crag': asteroid_crag, 'mining-gantry': mining_gantry}


def unwrap(mesh):
    """Physical metre UVs; runtime surface materials select repeat density."""
    uv = mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    for polygon in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        for index in polygon.loop_indices:
            p = mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = ((p.x, p.z) if axis == 1 else (p.y, p.z) if axis == 0 else (p.x, p.y))


report = {'schema': 1, 'generator': 'scripts/asteroid/author-kit.py', 'units': 'metres',
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

report['materials'] = {'asteroid_'+name: {'baseColor': color, 'metalness': metal, 'roughness': rough,
    'emissiveStrength': .65 if name == 'amber' else 0}
    for name, (color, metal, rough) in palette.items()}
(DEST/'kit-v1.manifest.json').write_text(json.dumps(report, indent=2)+'\n')


def prepare_review():
    global active_collection
    review = bpy.data.collections.new('Review composition')
    scene.collection.children.link(review)
    transforms = {
        'ore-extractor': [((-5.2, -3.1, 2.5), (1, 1, 1))],
        'ore-cluster': [((1.9, -5, 1.5), (1, 1, 1))],
        'freight-container': [((5.7, -3, 1), (1, 1, 1))],
        'blast-partition': [((-1.1, -1.2, 1.5), (1, 1, 1))],
        'asteroid-crag': [((-9.7, 7.5, 5.6), (.80, .80, .80))],
        'mining-gantry': [((3.6, 7, 8), (1, 1, 1))],
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
    scene.world = bpy.data.worlds.new('Asteroid neutral review')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.11, .16, .23, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    for name, location, energy, color, size in (
        ('Broad orbital key', (-7, -6, 23), 8500, (.83, .91, 1), 12),
        ('Warm mining bounce', (-14, -2, 10), 4200, (1, .77, .51), 10),
        ('Soft frontal fill', (12, -15, 12), 7800, (.77, .89, 1), 13)):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
        light = bpy.data.objects.new(name, data)
        review.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 2, 5))-light.location).to_track_quat('-Z', 'Y').to_euler()
    camdata = bpy.data.cameras.new('Asteroid kit review camera')
    camera = bpy.data.objects.new('Asteroid kit review camera', camdata)
    review.objects.link(camera)
    camera.location = (27, -37, 23)
    camera.rotation_euler = (Vector((-.5, 2.4, 6.1))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camdata.type = 'ORTHO'
    camdata.ortho_scale = 34
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(SOURCE/'asteroid-kit-review.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'asteroid-kit-v1.blend'))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report, indent=2))
