"""Original modular Industrial Hangar architecture, authored in Blender.

Run Blender --background --factory-startup --python this_file.py.
Source is Z-up; export is Y-up. Shipping module pivots and child transforms are
identity, with geometry merged into one reusable mesh per material role.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public/assets/hangar/architecture"
SOURCE = ROOT / "output/hangar"
DEST.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--skip-render", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1


def linear(color):
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


palette = {
    "alloy": ("#687984", .72, .43),
    "graphite": ("#252e36", .35, .67),
    "ceramic": ("#aebbc0", .08, .57),
    "trim": ("#a3977e", .70, .41),
    "amber": ("#be8e49", .08, .61),
    "light": ("#c8e4ee", .0, .32),
}
materials = {}
for name, (color, metallic, roughness) in palette.items():
    mat = bpy.data.materials.new("hangar_" + name)
    mat.diffuse_color = linear(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if name == "light":
        bsdf.inputs["Emission Color"].default_value = linear(color)
        bsdf.inputs["Emission Strength"].default_value = 2.0
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


def bar_between(name, a, b, thickness, depth, role="alloy", bevel=.02):
    a, b = Vector(a), Vector(b)
    obj = box(name, (a+b)*.5, (thickness, depth, (b-a).length), role, bevel)
    obj.rotation_euler = (b-a).to_track_quat("Z", "Y").to_euler()
    return obj


def wall():
    # Blender -Y is the positive-Z arena-facing side after glTF conversion.
    # The rear skin and outer frame set the exact 10.68 x 12 x .55 envelope.
    box("Continuous wall backing", (0, .225, 0), (10.68, .10, 12), "graphite", 0)
    for x in (-5.18, 5.18):
        box("Outer load frame", (x, -.075, 0), (.32, .40, 12), "alloy", .035)
        box("Frame expansion seam", (x, -.271, 0), (.075, .008, 10.5), "graphite", .003)
    for z, height in ((-5.74, .52), (5.74, .52)):
        box("Continuous structural header", (0, -.075, z), (10.68, .40, height), "alloy", .04)
    box("Central structural mullion", (0, -.075, 0), (.22, .35, 11.2), "alloy", .025)
    box("Low impact rail", (0, -.125, -3.94), (10.02, .25, .25), "alloy", .028)
    box("Service level lintel", (0, -.10, 3.58), (10.02, .28, .24), "alloy", .025)
    for side in (-1, 1):
        x = side * 2.59
        box("Inset ceramic armor shield", (x, .025, -.09), (4.72, .24, 6.98), "ceramic", .07)
        # Broad secondary recesses carry depth; sparse vertical seams avoid a
        # busy checkerboard behind player silhouettes.
        box("Lower graphite impact panel", (x, -.025, -4.77), (4.72, .21, 1.20), "graphite", .045)
        box("Impact panel raised center", (x, -.138, -4.77), (4.17, .025, .72), "alloy", .02)
        box("Lower maintenance marking", (x, -.155, -4.77), (.62, .012, .075), "amber", .008)
        box("Armor vertical relief", (x + side*1.49, -.101, -.09), (.055, .012, 5.90), "graphite", .005)
        box("Recessed upper ventilation bed", (x, .07, 4.55), (4.72, .15, 1.54), "graphite", .035)
        for z in ([3.97,4.20,4.43,4.66,4.89,5.12] if detail else [4.12,4.55,4.98]):
            box("Deep extraction louver", (x, -.065, z), (4.32, .17, .10 if detail else .16), "alloy", .018)
        if detail:
            for xx in (x-2.04,x+2.04):
                for z in (-3.14,2.96):
                    box("Captive shield fastener", (xx, -.107, z), (.095, .018, .12), "trim", .014)
            box("Armor access recess", (x-side*1.42, -.108, -2.60), (.45, .025, .48), "graphite", .025)
            box("Recessed latch", (x-side*1.42, -.125, -2.60), (.22, .015, .055), "trim", .007)
        else:
            box("Service latch", (x-side*1.42, -.108, -2.60), (.26, .015, .065), "trim", .005)
    # One vertical service run per bay, balanced by a broad ceramic field.
    # Geometry stays within .275 m of the module center on either side.
    box("Service conduit bed", (-4.65, -.132, -.10), (.24, .07, 6.45), "graphite", .02)
    box("Protected vertical conduit", (-4.65, -.187, -.10), (.075, .07, 6.17), "alloy", .025)
    for z in (-2.88,2.66):
        box("Conduit connector", (-4.65, -.20, z), (.19, .09, .20), "alloy", .022)
    if detail:
        for z in (-1.72,.10,1.92):
            box("Conduit retaining band", (-4.65, -.227, z), (.14, .035, .065), "trim", .008)
    for x in (-4.50,4.50):
        box("Bay upper warning tab", (x, -.211, 5.74), (.40, .018, .09), "amber", .008)


def column():
    box("H beam central web", (0,0,0), (.28,1.2,12), "graphite", .035)
    for y in (-.59,.59):
        box("H beam wide flange", (0,y,0), (1.5,.20,12), "alloy", .04)
    for z in (-5.75,5.75):
        box("Full section impact collar", (0,0,z), (1.5,1.5,.50), "alloy", .045)
    for sign in (-1,1):
        for z in (-2.47,2.47):
            box("Column ceramic facing", (0,sign*.713,z), (.91,.074,4.12), "ceramic", .03)
            box("Column face split seam", (0,sign*.749,z-.90), (.68,.002,.055), "graphite", 0)
            if detail:
                for x in (-.31,.31):
                    for zz in (z-1.75,z+1.75):
                        box("Column captive bolt", (x,sign*.749,zz), (.065,.002,.085), "trim", 0)
            else:
                box("Column lock inset", (0,sign*.749,z+1.75), (.25,.002,.06), "trim", 0)
        box("Column service seam", (0,sign*.715,0), (.91,.07,.22), "graphite", .02)
        box("Column lower warning panel", (0,sign*.749,-5.15), (.76,.002,.12), "amber", 0)
    # Stiffener plates are readable from oblique angles and produce genuine
    # H-section cavities, rather than a stack of differently colored cubes.
    for z in (-4.76,-1.0,1.0,4.76):
        box("Web transverse stiffener", (0,0,z), (1.12,1.08,.12), "alloy", .016)
    if detail:
        for x in (-.14,.14):
            box("Column recessed utility channel", (x,0,0), (.035,.35,8.4), "trim", .008)


def truss():
    for z in (-.645,.645):
        box("Continuous I chord flange", (0,0,z), (50,.5,.21), "alloy", .03)
    for x in range(-25,26,5):
        # End posts remain inside the exact fifty-metre source envelope.
        box("Truss vertical web", (max(-24.92,min(24.92,x)),0,0), (.16,.30,1.29), "graphite", .02)
    for i in range(10):
        x = -25+i*5
        if detail:
            bar_between("Triangulated steel web", (x+.08,0,-.54), (x+2.5,0,.54), .12,.24)
            bar_between("Triangulated steel web", (x+2.5,0,.54), (x+4.92,0,-.54), .12,.24)
            for y in (-.16,.16):
                box("Bolted web joint plate", (x+2.5,y,.45), (.40,.04,.24), "trim", .02)
        else:
            a,b = ((-.54,.54) if i%2==0 else (.54,-.54))
            bar_between("Reduced triangulated web", (x+.08,0,a), (x+4.92,0,b), .12,.24,bevel=0)
    if not detail:
        for x in (-20,0,20):
            box("Joint plate", (x,-.16,0), (.36,.04,.35), "trim", 0)


def light_fixture():
    box("High bay cast housing", (0,0,.09), (4,1.2,.32), "alloy", .045)
    for y in (-.52,.52):
        box("Lens protective edge", (0,y,-.13), (4,.16,.24), "graphite", .025)
    for x in (-1.92,1.92):
        box("Lens protective end", (x,0,-.13), (.16,.90,.24), "graphite", .02)
    box("Recessed diffuser substrate", (0,0,-.13), (3.63,.85,.12), "graphite", .03)
    for x in (-1.35,-.45,.45,1.35):
        box("Cool optical diffuser", (x,0,-.208), (.82,.73,.025), "light", .02)
    if detail:
        for x in [-1.65+i*.30 for i in range(12)]:
            box("Dissipation fin", (x,0,.251-.011), (.065,.95,.020), "graphite", .006)
        for x in (-1.85,1.85):
            box("Recessed suspension socket", (x,0,.248), (.16,.28,.004), "graphite", 0)


builders = {"wall-bay":wall, "support-column":column,
            "ceiling-truss":truss, "high-bay-light":light_fixture}


def unwrap(mesh):
    """Planar coordinates in metres, tiled by the runtime physical materials."""
    uv = mesh.uv_layers.new(name="UVMap") if not mesh.uv_layers else mesh.uv_layers.active
    for poly in mesh.polygons:
        axis = max(range(3),key=lambda i:abs(poly.normal[i]))
        for index in poly.loop_indices:
            p = mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = ((p.x,p.z) if axis==1 else (p.y,p.z) if axis==0 else (p.x,p.y))


report = {"schema":1, "generator":"scripts/hangar/author-kit.py", "units":"metres",
          "coordinates":"glTF Y-up; wall front +Z; centered pivots; baked child transforms",
          "provenance":"Original Blender-authored industrial architecture; no third-party game geometry",
          "variants":{}}
all_exports = []
for quality in ("high","low"):
    detail = quality == "high"
    collection = bpy.data.collections.new("Editable " + quality)
    scene.collection.children.link(collection)
    active_collection = collection
    export_collection = bpy.data.collections.new("Runtime " + quality)
    scene.collection.children.link(export_collection)
    module_report = {}
    exports = []
    for module_name,builder in builders.items():
        parts = []
        builder()
        root = bpy.data.objects.new(module_name,None)
        export_collection.objects.link(root)
        root["module"] = module_name
        root["pivotMode"] = "center"
        root["quality"] = quality
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        merged = {}
        for obj in parts:
            role = obj["paint_role"]
            mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps),depsgraph=deps)
            mesh.transform(obj.matrix_world)
            mesh.update()
            unwrap(mesh)
            part = bpy.data.objects.new(module_name+"_"+role,mesh)
            export_collection.objects.link(part)
            merged.setdefault(role,[]).append(part)
        triangles = 0
        minimum = Vector((math.inf,math.inf,math.inf))
        maximum = Vector((-math.inf,-math.inf,-math.inf))
        for role,meshes in merged.items():
            bpy.ops.object.select_all(action="DESELECT")
            for obj in meshes:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            if len(meshes)>1:
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
                for axis in range(3):
                    minimum[axis] = min(minimum[axis],vertex.co[axis])
                    maximum[axis] = max(maximum[axis],vertex.co[axis])
            exports.append(batch)
        exports.append(root)
        dims = maximum-minimum
        module_report[module_name] = {"triangles":triangles,"materialBatches":len(merged),
            "dimensions":[round(dims.x,4),round(dims.z,4),round(dims.y,4)],
            "boundsMin":[round(minimum.x,4),round(minimum.z,4),round(-maximum.y,4)],
            "boundsMax":[round(maximum.x,4),round(maximum.z,4),round(-minimum.y,4)],
            "pivot":"center"}
        source_root = bpy.data.objects.new("Source " + module_name,None)
        collection.objects.link(source_root)
        for obj in parts:
            obj.parent = source_root
    bpy.ops.object.select_all(action="DESELECT")
    for obj in exports:
        obj.select_set(True)
    filename = "kit-v1.glb" if detail else "kit-low-v1.glb"
    bpy.ops.export_scene.gltf(filepath=str(DEST/filename),use_selection=True,export_format="GLB",
        export_yup=True,export_apply=True,export_extras=True,export_cameras=False,
        export_lights=False,export_animations=False,export_texcoords=True,export_normals=True)
    report["variants"][quality] = {"file":filename,"bytes":(DEST/filename).stat().st_size,
        "triangles":sum(x["triangles"] for x in module_report.values()),"modules":module_report}
    for obj in exports:
        obj.name = quality+"/"+obj.name
    collection.hide_render = True
    collection.hide_viewport = True
    export_collection.hide_render = True
    export_collection.hide_viewport = True
    all_exports.append((export_collection,exports))

report["materials"] = {"hangar_"+name:{"baseColor":color,"metalness":metal,"roughness":rough,
    "emissiveStrength":2 if name=="light" else 0}
    for name,(color,metal,rough) in palette.items()}
(DEST/"kit-v1.manifest.json").write_text(json.dumps(report,indent=2)+"\n")


def prepare_review():
    global active_collection
    review = bpy.data.collections.new("Review composition")
    scene.collection.children.link(review)
    transforms = {
        "wall-bay":[((-5.34,1,6),(1,1,1)),((5.34,1,6),(1,1,1))],
        "support-column":[((-10.68,.65,6),(1,1,1)),((0,.65,6),(1,1,1)),((10.68,.65,6),(1,1,1))],
        "ceiling-truss":[((0,-2,11.8),(.44,1,1))],
        "high-bay-light":[((-5.34,-2,10.75),(1,1,1)),((5.34,-2,10.75),(1,1,1))],
    }
    for obj in all_exports[0][1]:
        if obj.type != "MESH":
            continue
        module = obj.parent["module"]
        for location,scale in transforms[module]:
            clone = obj.copy()
            clone.data = obj.data
            clone.parent = None
            clone.location = location
            clone.scale = scale
            review.objects.link(clone)
    active_collection = review
    box("Review deck",(0,0,-.15),(100,100,.25),"graphite",0)
    scene.world = bpy.data.worlds.new("Industrial neutral review")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.21,.27,.34,1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .45
    for name,location,energy,color,size in (
        ("Broad cool ceiling source",(-4,-7,19),5300,(.81,.90,1),12),
        ("Warm side practical",(-18,-7,8),3500,(1,.82,.62),10),
        ("Soft front fill",(14,-13,12),5200,(.75,.86,1),14)):
        data = bpy.data.lights.new(name,"AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name,data)
        review.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0,0,5))-obj.location).to_track_quat("-Z","Y").to_euler()
    camdata = bpy.data.cameras.new("Hangar kit review camera")
    camera = bpy.data.objects.new("Hangar kit review camera",camdata)
    review.objects.link(camera)
    camera.location = (24,-34,19)
    camera.rotation_euler = (Vector((0,-.5,6))-camera.location).to_track_quat("-Z","Y").to_euler()
    camdata.type = "ORTHO"
    camdata.ortho_scale = 30
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(SOURCE/"hangar-kit-review.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"hangar-kit-v1.blend"))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report,indent=2))
