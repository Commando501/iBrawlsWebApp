"""Original Jungle Ruined Outpost kit, authored in Blender in physical metres.

Runtime modules have centered Y-up pivots, baked transforms and stable bounds.
The kit contains only visual geometry; existing game collisions remain authoritative.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public/assets/jungle/architecture"
SOURCE = ROOT / "output/jungle"
DEST.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--skip-render", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1


def linear(color):
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb) + (1,)


palette = {
    "stone": ("#8c9487", .02, .90),
    "bark": ("#5e5547", .0, .96),
    "moss": ("#52664a", .0, .94),
    "ceramic": ("#aeb7ab", .06, .73),
    "alloy": ("#64716c", .54, .65),
    "graphite": ("#35413d", .16, .80),
    "jade": ("#76b7a1", .05, .40),
    "leaf": ("#3d674c", .0, .88),
    "leaf_light": ("#62805a", .0, .86),
}
materials = {}
for name, (color, metallic, roughness) in palette.items():
    mat = bpy.data.materials.new("jungle_"+name)
    mat.diffuse_color = linear(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if name == "jade":
        bsdf.inputs["Emission Color"].default_value = linear(color)
        bsdf.inputs["Emission Strength"].default_value = .45
    materials[name] = mat

active_collection = None
parts = []
detail = True


def finish(obj, name, role, bevel=0, smooth=False):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    active_collection.objects.link(obj)
    obj.data.materials.append(materials[role])
    obj["paint_role"] = role
    if not detail and bevel < .035:
        bevel = 0
    if bevel:
        mod = obj.modifiers.new("Worn structural edge radius", "BEVEL")
        mod.width = bevel
        mod.segments = 2 if detail else 1
        obj.data.set_sharp_from_angle(angle=math.radians(36))
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new("Weighted broad surface normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    elif smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    parts.append(obj)
    return obj


def box(name, center, size, role="stone", bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, role, bevel)


def cylinder(name, center, radius, height, role="alloy", bevel=.025, segments=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments or (20 if detail else 12),
        radius=radius, depth=height, location=center)
    return finish(bpy.context.object, name, role, bevel)


def custom(name, vertices, faces, role, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    active_collection.objects.link(obj)
    return finish(obj, name, role, smooth=smooth)


def beam(name, start, end, radius, role="bark", radius_end=None, sides=None):
    start, end = Vector(start), Vector(end)
    delta = end-start
    bpy.ops.mesh.primitive_cone_add(vertices=sides or (8 if detail else 6),
        radius1=radius, radius2=radius if radius_end is None else radius_end,
        depth=delta.length, location=(start+end)/2)
    obj = bpy.context.object
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return finish(obj, name, role, smooth=True)


def radial_box(name, angle, radius, z, size, role, bevel=.025):
    obj = box(name, (math.sin(angle)*radius, -math.cos(angle)*radius, z), size, role, bevel)
    obj.rotation_euler.z = angle
    return obj


def normalize_parts(dimensions):
    """Fit only non-cylindrical authored modules to their unchanged box envelope."""
    for obj in parts:
        # Evaluate bevels before measuring. Their real rotated bounds can be
        # slightly smaller than the unmodified object's bounding-box corners.
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.update()
    minimum, maximum = Vector((math.inf,)*3), Vector((-math.inf,)*3)
    for obj in parts:
        for vertex in obj.data.vertices:
            p = obj.matrix_world @ vertex.co
            for axis in range(3):
                minimum[axis] = min(minimum[axis], p[axis])
                maximum[axis] = max(maximum[axis], p[axis])
    center = (minimum+maximum)/2
    factors = [dimensions[axis]/(maximum[axis]-minimum[axis]) for axis in range(3)]
    for obj in parts:
        matrix = obj.matrix_world.copy()
        for vertex in obj.data.vertices:
            point = matrix @ vertex.co-center
            vertex.co = [point[axis]*factors[axis] for axis in range(3)]
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)


def relic_spire():
    # Twelve-sided collars include all four cardinal points. Every vertex,
    # including plate corners, stays inside the original .6 m cylinder.
    cylinder("Ancient continuous core", (0, 0, -.10), .39, 3.8, "graphite", .025, 12)
    cylinder("Weathered plinth", (0, 0, -1.78), .6, .44, "stone", 0, 12)
    cylinder("Relic upper crown", (0, 0, 1.84), .6, .32, "stone", 0, 12)
    cylinder("Recessed base joint", (0, 0, -1.48), .49, .16, "alloy", .018, 12)
    cylinder("Crown internal joint", (0, 0, 1.61), .47, .14, "alloy", .015, 12)
    for i in range(4):
        a = i*math.pi/2
        for z, height in ((-.90, .90), (.67, 1.54)):
            radial_box("Eroded ceramic shield", a, .41, z, (.59, .16, height), "ceramic", .045)
            if detail:
                radial_box("Inset shield fracture", a, .492, z-height*.30, (.21, .008, .027), "graphite", 0)
        radial_box("Protected crystal pocket", a, .405, -.17, (.42, .15, .43), "graphite", .035)
        radial_box("Small jade relic window", a, .485, -.17, (.18, .015, .29), "jade", .018)
        # Major armor returns preserve the V3 industrial language, with worn
        # stone replacing polished factory metal on this abandoned outpost.
        radial_box("Relic continuous corner rib", a+math.pi/4, .42, .04, (.11, .14, 3.18), "stone", .025)


def moss_boulder():
    # Broad angular strata produce cover that reads as a solid rock mass, with
    # selective moss only on the crown. The floor receives no clutter meshes.
    n = 20 if detail else 12
    levels = [(-1.5, .90), (-1.24, 1.34), (-.35, 1.48), (.44, 1.41), (1.10, 1.25), (1.50, .77)]
    vertices = []
    for j, (z, radius) in enumerate(levels):
        for i in range(n):
            a = i*math.tau/n
            rounded_square = .82+.18/max(abs(math.cos(a)), abs(math.sin(a)))
            r = radius*rounded_square*(1+.04*math.sin(i*1.81+j*2.2))
            vertices.append((r*math.cos(a), r*math.sin(a), z+.07*math.sin(i*2.37+j)*math.sin(math.pi*j/(len(levels)-1))))
    faces = [tuple(reversed(range(n)))]
    for j in range(len(levels)-1):
        for i in range(n):
            faces.append((j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i))
    faces.append(tuple((len(levels)-1)*n+i for i in range(n)))
    custom("Stratified weathered stone", vertices, faces, "stone")
    top = (len(levels)-1)*n
    moss_vertices = [(0, 0, 1.514)]
    for i in range(n):
        p = Vector(vertices[top+i])
        p.x *= .78+.08*math.sin(i*3.7)
        p.y *= .78+.08*math.sin(i*3.7)
        p.z += .014
        moss_vertices.append(p)
    custom("Broken crown moss island", moss_vertices,
        [(0, i+1, (i+1)%n+1) for i in range(n)], "moss")
    # A few small edge plates add fractured depth without floating stones or
    # protrusions beyond the original collision volume.
    for i in range(4 if detail else 2):
        a = i*2.12+.3
        p = (.82*math.cos(a), .82*math.sin(a), 1.26)
        rock = box("Attached crown fracture", p, (.58, .42, .30), "stone", .09)
        rock.rotation_euler.z = a
    normalize_parts((3, 3, 3))


def trunk_mesh(name, height, radius, role="bark", canopy=False):
    n = 32 if detail else 16
    rings = 10 if detail else 6
    verts = []
    for j in range(rings):
        t = j/(rings-1)
        z = -height/2+t*height
        # Asymmetrical bark ridges remain within the cylindrical gameplay
        # bounds. The remote tree gains a natural bend higher in its crown.
        bend_x = .50*math.sin(t*2.1)*t if canopy else .07*math.sin(t*4)
        bend_y = .27*math.sin(t*4.0)*t if canopy else .04*math.sin(t*5)
        for i in range(n):
            a = i*math.tau/n
            taper = (1-.66*t) if canopy else (.76+.10*(1-t))
            ridges = .90+.08*math.sin(a*8+.27*math.sin(t*4))+.02*math.cos(a*5)
            r = radius*taper*ridges
            verts.append((bend_x+r*math.cos(a), bend_y+r*math.sin(a), z))
    faces = [tuple(reversed(range(n))), tuple((rings-1)*n+i for i in range(n))]
    for j in range(rings-1):
        for i in range(n):
            faces.append((j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i))
    return custom(name, verts, faces, role, smooth=True)


def buttress(name, angle, radius, z, height, width, role="bark"):
    # Wedge roots are real volume, not grass cards. All corners are computed
    # on the radial cylinder so gameplay tree roots never extend its footprint.
    a = Vector((math.cos(angle), math.sin(angle), 0))
    b = Vector((-math.sin(angle), math.cos(angle), 0))
    inner = radius*.32
    verts = [a*inner+b*width*.55+Vector((0, 0, z)),
             a*inner-b*width*.55+Vector((0, 0, z)),
             a*radius+Vector((0, 0, z)),
             a*radius*.63+b*width*.23+Vector((0, 0, z+height*.42)),
             a*radius*.63-b*width*.23+Vector((0, 0, z+height*.42)),
             a*inner+Vector((0, 0, z+height))]
    return custom(name, verts, [(0, 2, 1), (0, 3, 2), (2, 4, 1), (2, 3, 4),
        (0, 5, 3), (1, 4, 5), (3, 5, 4), (0, 1, 5)], role, smooth=True)


def ancient_trunk():
    trunk_mesh("Ridged ancient hardwood", 7, 1)
    for i in range(8):
        a = i*math.pi/4
        buttress("Contained spreading root", a, 1, -3.5, 2.2+.3*math.sin(i*1.7), .37)
    # A sparse moss seam low on the bark, never foliage across sightlines.
    for i in range(5 if detail else 3):
        a = i*1.9+.27
        start = (.77*math.cos(a), .77*math.sin(a), -3.1)
        end = (.72*math.cos(a+.07), .72*math.sin(a+.07), -2.24+.12*math.sin(i))
        beam("Sheltered root moss seam", start, end, .035, "moss", .016, 6)


def ruined_wall():
    # A damaged armored masonry slab retains the full existing blocking
    # envelope. Shallow recesses and chipped corner geometry do the detailing.
    box("Ancient structural wall core", (0, 0, -.02), (2.88, .46, 1.88), "stone", .10)
    for x in (-1.39, 1.39):
        box("Eroded stone end shoulder", (x, 0, -.03), (.22, .60, 1.94), "stone", .055)
    box("Continuous buried foundation", (0, 0, -.89), (3, .60, .22), "stone", .045)
    for side in (-1, 1):
        for i, x in enumerate((-.89, 0, .89)):
            top = (.77, .92, .71)[i]
            h = 1.28 if i != 1 else 1.44
            panel = box("Weathered pale armor fragment", (x, side*.245, top-h/2),
                (.81, .10, h), "ceramic", .045)
            # Fasteners are broad and infrequent; no busy striped wall texture.
            if detail:
                for z in (-.37, .43):
                    box("Ancient flush shield clamp", (x+.28, side*.297, z), (.065, .006, .10), "alloy", .006)
        box("Recessed structural reinforcement", (0, side*.257, -.66), (2.55, .065, .15), "alloy", .025)
    for i, x in enumerate((-.93, -.29, .45, 1.04)):
        obj = box("Broken top coping", (x, 0, .83+(i%2)*.07), (.54, .53, .20), "stone", .065)
        obj.rotation_euler.y = (-.04, .03, -.06, .02)[i]
        if i in (0, 2):
            box("Sheltered upper moss seam", (x, 0, .943+(i%2)*.07), (.34, .31, .015), "moss", 0)
    normalize_parts((3, .6, 2))


def leaf(name, base, direction, length, width, role):
    """Closed opaque lanceolate leaf: pointed silhouette and a raised midrib."""
    base = Vector(base)
    direction = Vector(direction).normalized()
    across = direction.cross(Vector((0, 0, 1))).normalized()
    if across.length < .1:
        across = Vector((1, 0, 0))
    up = across.cross(direction).normalized()
    center = base+direction*length*.50+up*width*.16
    outline = [base, base+direction*length*.28+across*width*.48,
        base+direction*length*.65+across*width*.36, base+direction*length,
        base+direction*length*.65-across*width*.36,
        base+direction*length*.28-across*width*.48]
    vertices = outline+[center+up*.025, center-up*.025]
    faces = [(i, (i+1)%6, 6) for i in range(6)]+[((i+1)%6, i, 7) for i in range(6)]
    return custom(name, vertices, faces, role)


def frond(base, angle, length, seed):
    base = Vector(base)
    outward = Vector((math.cos(angle), math.sin(angle), -.12))
    across = Vector((-math.sin(angle), math.cos(angle), 0))
    count = 6 if detail else 3
    stem = [base+outward*(length*t)+Vector((0, 0, .35*math.sin(math.pi*t))) for t in (0, .35, .70, 1)]
    for i in range(3):
        beam("Compound frond stem", stem[i], stem[i+1], .018 if detail else .014, "bark", .009, 5)
    for j in range(count):
        t = .12+.77*j/(count-1)
        center = base+outward*length*t+Vector((0, 0, .35*math.sin(math.pi*t)))
        for side in (-1, 1):
            direction = outward*.52+across*side*.85+Vector((0, 0, -.04-.13*t))
            l = (.73+.30*math.sin(math.pi*t))*length*.45
            leaf("Tapered tropical leaflet", center, direction, l, l*.42,
                "leaf_light" if (j+seed+(1 if side > 0 else 0))%5 == 0 else "leaf")
    leaf("Frond terminal lance", stem[-1], outward, length*.40, length*.17, "leaf")


def jungle_canopy():
    trunk = trunk_mesh("Remote emergent trunk", 20, 1.3, canopy=True)
    trunk.location.z = -2
    for i in range(7 if detail else 5):
        buttress("Remote broad buttress", i*math.tau/(7 if detail else 5)+.1, 2.0, -12, 4.1, .75)
    branch_count = 8 if detail else 6
    for i in range(branch_count):
        a = i*2.399+.25
        z = 4.5+(i%3)*1.8
        reach = 3.6+.55*math.sin(i*1.8)
        p0 = Vector((.20, .06, z))
        p1 = Vector((math.cos(a)*reach*.55, math.sin(a)*reach*.55, z+2.1))
        p2 = Vector((math.cos(a)*reach, math.sin(a)*reach, z+2.2))
        beam("Sweeping primary branch", p0, p1, .27, radius_end=.16, sides=10 if detail else 6)
        beam("Tapered crown branch", p1, p2, .16, radius_end=.065, sides=8 if detail else 6)
        for j in range(2):
            # Layered flat sprays leave daylight windows between branches,
            # unlike a sphere or an alpha billboard filled with hidden pixels.
            origin = p1.lerp(p2, .28+j*.30)
            frond(origin, a+(j-1)*.90, 2.3+.25*math.sin(i+j), i+j)
    for i in range(3 if detail else 2):
        a = i*2.2+.4
        frond((.35*math.cos(a), .35*math.sin(a), 10.4+i*.35), a, 2.5, i)
    # A sparse understory belongs to this remote background module only. Its
    # lower branches help the forest horizon read at player eye level without
    # adding leaves to the playable ancient-trunk collision module.
    for i in range(3 if detail else 2):
        a = i*2.17+1.3
        start = Vector((.1, .1, -6.8+i*2.4))
        end = start+Vector((math.cos(a)*2.8, math.sin(a)*2.8, 1.2))
        beam("Remote understory branch", start, end, .18, radius_end=.05)
        for j in range(2 if detail else 1):
            frond(end, a+(j-.5)*.9, 2.2, i+j)
    normalize_parts((12, 12, 24))


builders = {"relic-spire": relic_spire, "moss-boulder": moss_boulder,
            "ancient-trunk": ancient_trunk, "ruined-wall": ruined_wall, "jungle-canopy": jungle_canopy}


def unwrap(mesh):
    """Planar metre UVs consumed by the runtime surface library."""
    uv = mesh.uv_layers.new(name="UVMap") if not mesh.uv_layers else mesh.uv_layers.active
    for poly in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(poly.normal[i]))
        for index in poly.loop_indices:
            p = mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = ((p.x, p.z) if axis == 1 else (p.y, p.z) if axis == 0 else (p.x, p.y))


report = {"schema": 1, "generator": "scripts/jungle/author-kit.py", "units": "metres",
    "coordinates": "glTF Y-up; centered pivots; baked child transforms; ruined wall width on X",
    "provenance": "Original Blender-authored natural forms and relic architecture; no third-party game geometry or character imagery",
    "variants": {}}
all_exports = []
for quality in ("high", "low"):
    detail = quality == "high"
    collection = bpy.data.collections.new("Editable "+quality)
    scene.collection.children.link(collection)
    active_collection = collection
    export_collection = bpy.data.collections.new("Runtime "+quality)
    scene.collection.children.link(export_collection)
    module_report, exports = {}, []
    for module_name, builder in builders.items():
        parts = []
        builder()
        root = bpy.data.objects.new(module_name, None)
        export_collection.objects.link(root)
        root["module"], root["pivotMode"], root["quality"] = module_name, "center", quality
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        merged = {}
        for obj in parts:
            role = obj["paint_role"]
            mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps), depsgraph=deps)
            mesh.transform(obj.matrix_world)
            mesh.update()
            unwrap(mesh)
            part = bpy.data.objects.new(module_name+"_"+role, mesh)
            export_collection.objects.link(part)
            merged.setdefault(role, []).append(part)
        triangles = 0
        minimum, maximum = Vector((math.inf,)*3), Vector((-math.inf,)*3)
        maximum_radial = 0
        for role, meshes in merged.items():
            bpy.ops.object.select_all(action="DESELECT")
            for obj in meshes:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            if len(meshes) > 1:
                bpy.ops.object.join()
            batch = meshes[0]
            batch.name = module_name+"_"+role
            batch.parent = root
            batch.data.materials.clear()
            batch.data.materials.append(materials[role])
            for poly in batch.data.polygons:
                poly.material_index = 0
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
        module_report[module_name] = {"triangles": triangles, "materialBatches": len(merged),
            "dimensions": [round(dims.x, 4), round(dims.z, 4), round(dims.y, 4)],
            "boundsMin": [round(minimum.x, 4), round(minimum.z, 4), round(-maximum.y, 4)],
            "boundsMax": [round(maximum.x, 4), round(maximum.z, 4), round(-minimum.y, 4)],
            "maximumHorizontalRadius": round(maximum_radial, 6), "pivot": "center"}
        source_root = bpy.data.objects.new("Source "+module_name, None)
        collection.objects.link(source_root)
        for obj in parts:
            obj.parent = source_root
    bpy.ops.object.select_all(action="DESELECT")
    for obj in exports:
        obj.select_set(True)
    filename = "kit-v1.glb" if detail else "kit-low-v1.glb"
    bpy.ops.export_scene.gltf(filepath=str(DEST/filename), use_selection=True, export_format="GLB",
        export_yup=True, export_apply=True, export_extras=True, export_cameras=False,
        export_lights=False, export_animations=False, export_texcoords=True, export_normals=True)
    report["variants"][quality] = {"file": filename, "bytes": (DEST/filename).stat().st_size,
        "triangles": sum(x["triangles"] for x in module_report.values()), "modules": module_report}
    for obj in exports:
        obj.name = quality+"/"+obj.name
    collection.hide_render = collection.hide_viewport = True
    export_collection.hide_render = export_collection.hide_viewport = True
    all_exports.append((export_collection, exports))

report["materials"] = {"jungle_"+name: {"baseColor": color, "metalness": metal, "roughness": rough,
    "emissiveStrength": .45 if name == "jade" else 0}
    for name, (color, metal, rough) in palette.items()}
(DEST/"kit-v1.manifest.json").write_text(json.dumps(report, indent=2)+"\n")


def prepare_review():
    global active_collection
    review = bpy.data.collections.new("Review composition")
    scene.collection.children.link(review)
    placements = {"relic-spire": [(-6, -3, 2), (1, -2, 2)],
        "moss-boulder": [(5, -4, 1.5)], "ancient-trunk": [(-5, 3, 3.5)],
        "ruined-wall": [(-2.5, -5, 1)], "jungle-canopy": [(5, 9, 12)]}
    for obj in all_exports[0][1]:
        if obj.type != "MESH":
            continue
        for location in placements[obj.parent["module"]]:
            clone = obj.copy()
            clone.data = obj.data
            clone.parent = None
            clone.location = location
            review.objects.link(clone)
    active_collection = review
    box("Review neutral ground", (0, 0, -.15), (200, 200, .25), "graphite", 0)
    scene.world = bpy.data.worlds.new("Jungle neutral review")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.25, .32, .29, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .48
    for name, location, energy, color, size in (
        ("Warm canopy daylight", (-12, -9, 26), 9500, (1, .90, .72), 16),
        ("Cool open sky", (14, 2, 25), 10000, (.75, .89, 1), 14),
        ("Soft frontal fill", (2, -15, 13), 5200, (.88, .94, .88), 12)):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.color, data.shape, data.size = energy, color, "DISK", size
        light = bpy.data.objects.new(name, data)
        review.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 7))-light.location).to_track_quat("-Z", "Y").to_euler()
    camdata = bpy.data.cameras.new("Jungle kit review camera")
    camera = bpy.data.objects.new("Jungle kit review camera", camdata)
    review.objects.link(camera)
    camera.location = (33, -42, 25)
    camera.rotation_euler = (Vector((0, 2, 10))-camera.location).to_track_quat("-Z", "Y").to_euler()
    camdata.type, camdata.ortho_scale = "ORTHO", 34
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1400
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(SOURCE/"jungle-kit-review.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"jungle-kit-v1.blend"))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report, indent=2))
