"""Original Blender-authored Cyber Hex Grid kit; metre units, centered Y-up GLBs.

No collision geometry or movement parameters are changed by this visual kit.
Run Blender --background --factory-startup --python this_file.py.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public/assets/cyber/architecture"
SOURCE = ROOT / "output/cyber"
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
    "alloy": ("#73858f", .68, .46),
    "graphite": ("#29343e", .28, .68),
    "ceramic": ("#b7c4c8", .08, .55),
    "trim": ("#9dabb0", .74, .40),
    "cyan": ("#83ced9", .04, .42),
    "core": ("#a18bcd", .02, .38),
}
materials = {}
for name, (color, metallic, roughness) in palette.items():
    mat = bpy.data.materials.new("cyber_"+name)
    mat.diffuse_color = linear(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if name in ("cyan", "core"):
        bsdf.inputs["Emission Color"].default_value = linear(color)
        bsdf.inputs["Emission Strength"].default_value = .65 if name == "cyan" else 1.15
    materials[name] = mat

active_collection = None
parts = []
detail = True


def finish(obj, name, role, bevel=.025):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    active_collection.objects.link(obj)
    obj.data.materials.append(materials[role])
    obj["paint_role"] = role
    if not detail and bevel < .03:
        bevel = 0
    if bevel:
        mod = obj.modifiers.new("Machined edge radius", "BEVEL")
        mod.width = bevel
        mod.segments = 2 if detail else 1
        mod.affect = "EDGES"
        obj.data.set_sharp_from_angle(angle=math.radians(35))
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new("Weighted planar normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
        normal.weight = 50
    parts.append(obj)
    return obj


def box(name, center, size, role="alloy", bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, role, bevel)


def cylinder(name, center, radius, height, role="alloy", bevel=.025, segments=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments or (24 if detail else 12),
        radius=radius, depth=height, location=center)
    return finish(bpy.context.object, name, role, bevel)


def ring(name, radius, thickness, role="alloy", rotation=(0, 0, 0), center=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=32 if detail else 20,
        minor_segments=8 if detail else 6, major_radius=radius, minor_radius=thickness,
        location=center, rotation=rotation)
    return finish(bpy.context.object, name, role, 0)


def radial_box(name, angle, radius, z, size, role="alloy", bevel=.025):
    # Local X is tangential, local Y is radial. Check all corner radii, not just
    # the box origin, when fitting the existing circular collision envelope.
    obj = box(name, (math.sin(angle)*radius, -math.cos(angle)*radius, z), size, role, bevel)
    obj.rotation_euler.z = angle
    return obj


def tech_column():
    cylinder("Continuous graphite mast", (0, 0, 0), .64, 5.65, "graphite", .035)
    for z in (-2.775, 2.775):
        # Twelve-sided rings reach exactly +/- .9 m and set the unchanged
        # circular silhouette. All other vertices stay inside their radius.
        cylinder("Full diameter anchor collar", (0, 0, z), .9, .45, "alloy", .045, 12)
        cylinder("Inset collar shoulder", (0, 0, z*.89), .79, .17, "graphite", .022, 12)
    for i in range(6):
        a = i*math.tau/6
        for z in (-1.36, 1.36):
            radial_box("Broad ceramic mast shield", a, .71, z, (.55, .14, 2.08), "ceramic", .045)
            radial_box("Shield shadow reveal", a, .784, z-.72, (.38, .008, .045), "graphite", 0)
            if detail:
                for x in (-.18, .18):
                    # The paired lock pins remain flush with the armor.
                    pin = radial_box("Flush shield lock", a, .786, z+.79, (.055, .012, .075), "trim", .007)
                    pin.location.x += math.cos(a)*x
                    pin.location.y += math.sin(a)*x
            else:
                radial_box("Flush shield lock", a, .786, z+.79, (.20, .012, .055), "trim", .006)
        radial_box("Recessed status channel", a, .705, 0, (.30, .13, .47), "graphite", .025)
        radial_box("Protected cyan locator", a, .774, 0, (.18, .015, .30), "cyan", .012)
        radial_box("Outer longitudinal rib", a+math.pi/6, .705, 0, (.14, .17, 5.13), "alloy", .027)
        if detail:
            for z in (-1.2, 1.2):
                radial_box("Rib protective keeper", a+math.pi/6, .795, z, (.16, .04, .18), "alloy", .015)


def tactical_cover():
    box("Impact resistant backbone", (0, 0, 0), (3.72, .62, 2.22), "graphite", .06)
    for z in (-1.11, 1.14):
        box("Wide armored cap rail", (0, 0, z), (3.44, .8, .28 if z < 0 else .22), "alloy", .045)
    for x in (-1.86, 1.86):
        box("Vertical protected end cheek", (x, 0, 0), (.28, .78, 2.5), "alloy", .045)
        for sign in (-1, 1):
            box("End cheek shadow inset", (x, sign*.395, -.06), (.10, .01, 1.65), "graphite", .008)
    for sign in (-1, 1):
        for x in (-.89, .89):
            box("Broad ceramic cover panel", (x, sign*.326, -.03), (1.65, .13, 1.91), "ceramic", .055)
            box("Low impact plate", (x, sign*.394, -.70), (1.39, .012, .27), "alloy", .02)
            box("Upper panel expansion reveal", (x, sign*.395, .53), (1.18, .008, .035), "graphite", 0)
            if detail:
                for xx in (x-.66, x+.66):
                    box("Captive cover fastener", (xx, sign*.395, .77), (.055, .008, .09), "alloy", .006)
        box("Central shield joint", (0, sign*.334, 0), (.09, .10, 1.94), "graphite", .015)
        box("Recessed cover locator", (0, sign*.395, 1.14), (.70, .01, .055), "cyan", .006)


def recharge_crate():
    box("Graphite chassis", (0, 0, 0), (1.43, 1.43, 1.43), "graphite", .07)
    box("Load spreading base", (0, 0, -.70), (1.6, 1.6, .20), "alloy", .045)
    for x in (-.69, .69):
        box("Recessed lid side rim", (x, 0, .70), (.22, 1.6, .20), "alloy", .035)
    for y in (-.69, .69):
        box("Recessed lid end rim", (0, y, .70), (1.16, .22, .20), "alloy", .035)
    for x in (-.69, .69):
        for y in (-.69, .69):
            box("Reinforced crate corner", (x, y, 0), (.22, .22, 1.2), "alloy", .032)
    for i in range(4):
        a = i*math.pi/2
        radial_box("Inset ceramic equipment door", a, .714, 0, (1.10, .13, 1.09), "ceramic", .04)
        radial_box("Service latch pocket", a, .782, .25, (.44, .012, .16), "graphite", .015)
        radial_box("Locking bar", a, .792, .25, (.29, .008, .055), "alloy", .007)
        radial_box("Charge status lens", a, .786, -.27, (.40, .012, .055), "cyan", .006)
        if detail:
            for z in (-.02, -.10):
                radial_box("Passive cooling slot", a, .783, z, (.65, .01, .025), "graphite", .003)
    box("Top equipment recess", (0, 0, .727), (1.16, 1.16, .10), "graphite", .025)
    box("Top ceramic lid", (0, 0, .782), (.84, .84, .012), "ceramic", 0)
    if detail:
        for x in (-.48, .48):
            box("Recessed carry handle", (x, 0, .783), (.09, .50, .008), "alloy", .01)


def reactor_core():
    # Three structural rings define the exact existing 1.75 m sphere. Their
    # outer radius is 1.75; no cube corner or bracket can exceed that sphere.
    for rot in ((0, 0, 0), (math.pi/2, 0, 0), (0, math.pi/2, 0)):
        ring("Spherical containment cage", 1.60, .15, "alloy", rot)
    cylinder("Protected violet reaction chamber", (0, 0, 0), .72, 1.33, "core", .025, 12)
    for z in (-.83, .83):
        cylinder("Graphite chamber closure", (0, 0, z), .86, .34, "graphite", .035, 12)
        cylinder("Machined chamber endcap", (0, 0, z*1.30), .65, .17, "trim", .028, 12)
        ring("Recessed containment locator", .75, .025, "cyan", center=(0, 0, z*.76))
    for i in range(6):
        a = i*math.tau/6
        radial_box("Core chamber shield spine", a, .74, 0, (.19, .15, 1.65), "graphite", .025)
        radial_box("Containment attachment", a, 1.20, 0, (.19, .47, .25), "trim", .035)
        if detail:
            radial_box("Protected diagnostic lens", a, .825, .32, (.07, .02, .16), "cyan", .008)


def relay_fin():
    box("Relay continuous service spine", (0, .17, 0), (3.35, 2.40, 14), "graphite", .10)
    for x in (-1.77, 1.77):
        box("Long armored relay rail", (x, 0, 0), (.46, 2.96, 12.64), "alloy", .075)
        for y in (-1.47, 1.47):
            box("Rail longitudinal reveal", (x, y+math.copysign(.02, y), 0), (.12, .02, 12.4), "graphite", .018)
    for z in (-6.66, 6.66):
        box("Relay full width anchor", (0, 0, z), (4, 2.98, .68), "alloy", .075)
    for sign in (-1, 1):
        for z in (-4.77, -1.59, 1.59, 4.77):
            box("Broad relay ceramic armor", (0, sign*1.32, z), (2.94, .20, 2.91), "ceramic", .085)
            box("Inset relay panel shadow", (.88, sign*1.425, z), (.065, .01, 2.14), "graphite", .007)
        for z in (-3.18, 0, 3.18):
            box("Dark relay service crossband", (0, sign*1.32, z), (2.85, .18, .15), "graphite", .02)
            box("Recessed cyan signal tab", (-.80, sign*1.42, z), (.42, .02, .055), "cyan", .008)
        if detail:
            for x in (-1.13, 1.13):
                for z in (-5.86, -3.68, -2.68, -.50, .50, 2.68, 3.68, 5.86):
                    box("Relay shield restraint", (x, sign*1.429, z), (.11, .018, .19), "alloy", .015)
        # Deep slots in the header carry architectural scale without adding a
        # bright repeating grid to player-height walls or the combat floor.
        for x in ([-.92, -.46, 0, .46, .92] if detail else [-.8, 0, .8]):
            box("Relay header extraction slot", (x, sign*1.49, 6.66), (.20, .02, .29), "graphite", .025)


builders = {"tech-column": tech_column, "tactical-cover": tactical_cover,
            "recharge-crate": recharge_crate, "reactor-core": reactor_core, "relay-fin": relay_fin}


def unwrap(mesh):
    """Planar metre UVs consumed by the shared runtime surface library."""
    uv = mesh.uv_layers.new(name="UVMap") if not mesh.uv_layers else mesh.uv_layers.active
    for poly in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(poly.normal[i]))
        for index in poly.loop_indices:
            p = mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = ((p.x, p.z) if axis == 1 else (p.y, p.z) if axis == 0 else (p.x, p.y))


report = {"schema": 1, "generator": "scripts/cyber/author-kit.py", "units": "metres",
    "coordinates": "glTF Y-up; centered pivots; baked child transforms; tactical cover width on X",
    "provenance": "Original Blender-authored architecture; no third-party game geometry or character imagery",
    "variants": {}}
all_exports = []
for quality in ("high", "low"):
    detail = quality == "high"
    collection = bpy.data.collections.new("Editable "+quality)
    scene.collection.children.link(collection)
    active_collection = collection
    export_collection = bpy.data.collections.new("Runtime "+quality)
    scene.collection.children.link(export_collection)
    module_report = {}
    exports = []
    for module_name, builder in builders.items():
        parts = []
        builder()
        root = bpy.data.objects.new(module_name, None)
        export_collection.objects.link(root)
        root["module"] = module_name
        root["pivotMode"] = "center"
        root["quality"] = quality
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
        minimum = Vector((math.inf, math.inf, math.inf))
        maximum = Vector((-math.inf, -math.inf, -math.inf))
        maximum_sphere = 0
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
                maximum_sphere = max(maximum_sphere, p.length)
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
            "maximumSphereRadius": round(maximum_sphere, 6),
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
    collection.hide_render = True
    collection.hide_viewport = True
    export_collection.hide_render = True
    export_collection.hide_viewport = True
    all_exports.append((export_collection, exports))

report["materials"] = {"cyber_"+name: {"baseColor": color, "metalness": metal, "roughness": rough,
    "emissiveStrength": .65 if name == "cyan" else 1.15 if name == "core" else 0}
    for name, (color, metal, rough) in palette.items()}
(DEST/"kit-v1.manifest.json").write_text(json.dumps(report, indent=2)+"\n")


def prepare_review():
    global active_collection
    review = bpy.data.collections.new("Review composition")
    scene.collection.children.link(review)
    transforms = {
        "tech-column": [((-5.7, 0, 3), (1, 1, 1)), ((5.7, 0, 3), (1, 1, 1))],
        "tactical-cover": [((-3.1, -3.5, 1.25), (1, 1, 1))],
        "recharge-crate": [((3.1, -3.5, .8), (1, 1, 1))],
        "reactor-core": [((0, .3, 3.0), (1, 1, 1))],
        "relay-fin": [((-4.4, 5.1, 7), (1, 1, 1)), ((4.4, 5.1, 7), (1, 1, 1))],
    }
    for obj in all_exports[0][1]:
        if obj.type != "MESH":
            continue
        module = obj.parent["module"]
        for location, scale in transforms[module]:
            clone = obj.copy()
            clone.data = obj.data
            clone.parent = None
            clone.location = location
            clone.scale = scale
            review.objects.link(clone)
    active_collection = review
    box("Review neutral deck", (0, 0, -.15), (100, 100, .25), "graphite", 0)
    scene.world = bpy.data.worlds.new("Cyber neutral review")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.18, .24, .32, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .42
    for name, location, energy, color, size in (
        ("Broad cool daylight", (-7, -6, 19), 6200, (.82, .91, 1), 12),
        ("Warm edge bounce", (-12, -3, 8), 2600, (1, .84, .68), 9),
        ("Soft frontal fill", (12, -12, 11), 5800, (.76, .88, 1), 12)):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        review.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 5))-light.location).to_track_quat("-Z", "Y").to_euler()
    camdata = bpy.data.cameras.new("Cyber kit review camera")
    camera = bpy.data.objects.new("Cyber kit review camera", camdata)
    review.objects.link(camera)
    camera.location = (22, -31, 18)
    camera.rotation_euler = (Vector((0, .5, 6))-camera.location).to_track_quat("-Z", "Y").to_euler()
    camdata.type = "ORTHO"
    camdata.ortho_scale = 29
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(SOURCE/"cyber-kit-review.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"cyber-kit-v1.blend"))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report, indent=2))
