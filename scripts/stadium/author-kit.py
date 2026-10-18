"""Author Championship Stadium's reusable hard-surface kit in Blender.

Run: blender --background --factory-startup --python scripts/stadium/author-kit.py
All dimensions are metres. Source is Z-up; exported glTF is Y-up/front +Z.
Editable .blend and review image go to ignored output/stadium; shipping GLBs
and an independently inspectable geometry report go to public/assets/stadium.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public/assets/stadium/architecture"
SOURCE = ROOT / "output/stadium"
DEST.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--skip-render", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1


def linear(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


palette = {
    # Painted metal keeps roughness/material response distinct from bare edges.
    "alloy": ("#516675", .78, .38),
    "graphite": ("#17232f", .45, .55),
    "ceramic": ("#bac5c7", .10, .43),
    "trim": ("#a69266", .82, .32),
    "cyan": ("#4ac8da", .08, .24),
    "warm": ("#ffdeb0", .04, .30),
}
materials = {}
for name, (color, metallic, roughness) in palette.items():
    mat = bpy.data.materials.new("stadium_" + name)
    mat.diffuse_color = linear(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if name in ("cyan", "warm"):
        bsdf.inputs["Emission Color"].default_value = linear(color)
        bsdf.inputs["Emission Strength"].default_value = 2.0 if name == "cyan" else 3.0
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
        mod = obj.modifiers.new("Machined radius", "BEVEL")
        mod.width = bevel
        mod.segments = 2 if detail and bevel >= .025 else 1
        mod.affect = "EDGES"
    parts.append(obj)
    return obj


def box(name, center, size, role="alloy", bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, role, bevel)


def plate(name, outline, depth, front, role="alloy", bevel=.025):
    """Extruded X/Z outline with the visible face toward Blender -Y."""
    # Positive signed X/Z area gives outward front normal toward -Y.
    if sum(outline[i][0]*outline[(i+1) % len(outline)][1]
           - outline[(i+1) % len(outline)][0]*outline[i][1]
           for i in range(len(outline))) < 0:
        outline = list(reversed(outline))
    count = len(outline)
    vertices = [(x, y, z) for y in (front, front + depth) for x, z in outline]
    faces = [tuple(range(count)), tuple(reversed(range(count, 2*count)))]
    faces += [(i, i+count, (i+1) % count+count, (i+1) % count) for i in range(count)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    active_collection.objects.link(obj)
    return finish(obj, name, role, bevel)


def bolt(name, x, z, front, radius=.065, role="alloy"):
    if not detail:
        return
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=radius, depth=.028,
                                      location=(x, front+.014, z), rotation=(math.pi/2, 0, 0))
    finish(bpy.context.object, name, role, .006)


def barrier():
    # Chamfered impact casing, a dark recessed channel, and two armor cheeks.
    plate("Impact chassis", [(-4,.15),(-3.84,0),(3.84,0),(4,.15),(4,2.94),
          (3.72,3.2),(-3.72,3.2),(-4,2.94)], .58, -.23, "graphite", .045)
    box("Upper machined cap", (0,-.015,3.07), (7.65,.67,.26), "alloy", .045)
    box("Ground impact beam", (0,-.035,.23), (7.75,.63,.36), "alloy", .04)
    for side in (-1,1):
        pts = [(side*x,z) for x,z in ((.13,.58),(3.55,.58),(3.75,.82),
               (3.75,2.61),(3.48,2.84),(.13,2.84))]
        plate("Ceramic impact shield", pts, .12, -.315, "ceramic", .045)
        plate("Shoulder inset", [(side*x,z) for x,z in ((.31,2.50),(3.33,2.50),
              (3.53,2.68),(.31,2.68))], .018, -.335, "graphite", .012)
        box("Cyan status slit", (side*1.72,-.345,2.58), (2.55,.01,.045), "cyan", .005)
        if detail:
            for x in (.45,3.45):
                for z in (.78,2.33):
                    bolt("Armor recessed fastener", side*x,z,-.35,.052,"graphite")
            for z in (1.12,1.35,1.58):
                box("Side vent cut", (side*3.45,-.341,z), (.13,.016,.085), "graphite", .008)
        box("Buttress seam", (side*3.90,.015,1.59), (.14,.63,2.55), "alloy", .025)
    box("Center spine", (0,-.28,1.68), (.16,.14,2.55), "alloy", .028)


def pylon():
    # Larger base and collar preserve an architectural silhouette at distance.
    box("Foundation shoe", (0,0,.26), (2,2.5,.52), "alloy", .07)
    plate("Structural spine", [(-.69,.48),(.69,.48),(.69,13.9),(.88,14.55),
          (.88,15.62),(-.88,15.62),(-.88,14.55),(-.69,13.9)], 1.4,-.7,"graphite",.06)
    for side in (-1,1):
        plate("Load bearing fluted web", [(side*x,z) for x,z in ((.48,.52),(.94,.52),
              (.94,1.5),(.65,3.6),(.65,13.3),(.95,14.35),(.95,15.7),(.48,15.7))],
              1.9,-.95,"alloy",.045)
    box("Crown saddle", (0,0,15.82), (2,2.5,.36),"alloy",.055)
    for z in (1.08,4.7,8.32,11.94):
        box("Service ring", (0,0,z), (1.73,2.1,.22),"alloy",.025)
        for sign in (-1,1):
            box("Ceramic service panel", (0,sign*.735,z+1.72), (.82,.12,2.75),"ceramic",.04)
            box("Service panel seam", (0,sign*.803,z+1.72), (.065,.016,2.1),"graphite",.008)
            box("Vertical navigation strip", (.26,sign*.808,z+1.72), (.055,.016,2.25),"cyan",.007)
            if detail:
                for x in (-.28,.28):
                    for zz in (-1.15,1.15):
                        # Both sides share visible bolt geometry through mirrored placement.
                        bolt("Pylon inspection fastener",x,z+1.72+zz,sign*.82,.047,"alloy")
    if detail:
        for side in (-1,1):
            for z in (3.1,7.3,11.5):
                box("Recess edge rib", (side*.60,-.97,z), (.15,.12,.34),"graphite",.018)


def fixture():
    plate("Floodlight armored chassis", [(-3,-.38),(-2.77,-.6),(2.77,-.6),(3,-.38),
          (3,.37),(2.78,.6),(-2.78,.6),(-3,.37)], .84,-.34,"graphite",.05)
    for sign in (-1,1):
        box("Optical visor rail", (0,-.05,sign*.49), (5.78,.88,.20),"alloy",.035)
    if detail:
        for x in (-2.63,2.63):
            box("Service end cap", (x,-.005,0), (.45,.95,.83),"alloy",.06)
            bolt("Optical service fastener",x,0,-.49,.1,"graphite")
    for x in (-1.95,-.65,.65,1.95):
        box("Recessed optical cell", (x,-.355,0), (1.13,.22,.72),"alloy",.07)
        box("Optical reflector well", (x,-.478,0), (.94,.025,.50),"graphite",.045)
        box("Warm optical lens", (x,-.495,0), (.78,.01,.35),"warm",.035)
        if detail:
            for xx in (-.25,0,.25):
                box("Lens shield fin", (x+xx,-.494,0), (.018,.012,.32),"alloy",.004)
    if detail:
        for x in (-2,-1,0,1,2):
            box("Rear heat sink fin", (x,.43,0), (.065,.14,.8),"alloy",.015)


def vent():
    plate("Vent socket", [(-1.5,-.8),(-1.3,-1),(1.3,-1),(1.5,-.8),
          (1.5,.8),(1.3,1),(-1.3,1),(-1.5,.8)], .42,-.17,"alloy",.035)
    box("Vent dark well", (0,-.22,0), (2.67,.055,1.64),"graphite",.06)
    for z in (-.58,-.29,0,.29,.58):
        slat=box("Angled extraction louver", (0,-.168,z), (2.36,.15,.12),"alloy",.022)
        slat.rotation_euler.x=.24
    for x in (-1.28,1.28):
        box("Bronze service rail", (x,-.225,0), (.065,.045,1.46),"trim",.012)
        if detail:
            for z in (-.77,.77):
                bolt("Vent captive fastener",x,z,-.25,.05,"graphite")


builders = {"barrier-panel":barrier,"support-pylon":pylon,"light-fixture":fixture,"vent-module":vent}


def unwrap(mesh):
    """Metre-scaled planar UVs; coherent tile density across separated plates."""
    uv = mesh.uv_layers.new(name="UVMap") if not mesh.uv_layers else mesh.uv_layers.active
    for poly in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(poly.normal[i]))
        for loop_index in poly.loop_indices:
            p = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = ((p.x,p.z) if axis==1 else (p.y,p.z) if axis==0 else (p.x,p.y))


report = {"schema":1,"generator":"scripts/stadium/author-kit.py","units":"metres",
          "coordinates":"glTF Y-up; front +Z", "variants":{}}
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
        # Three.js reserves extras.pivot for its own numeric pivot extension.
        root["pivotMode"] = "bottom-center" if module_name in ("barrier-panel","support-pylon") else "center"
        root["quality"] = quality
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        merged = {}
        for obj in parts:
            role = obj["paint_role"]
            evaluated = obj.evaluated_get(deps)
            mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=deps)
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
            bpy.context.view_layer.objects.active=meshes[0]
            if len(meshes)>1:
                bpy.ops.object.join()
            batch=meshes[0]
            batch.name=module_name+"_"+role
            batch.parent=root
            batch.data.materials.clear()
            batch.data.materials.append(materials[role])
            for poly in batch.data.polygons:
                poly.material_index=0
            batch.data.calc_loop_triangles()
            triangles += len(batch.data.loop_triangles)
            for vertex in batch.data.vertices:
                p=vertex.co
                for axis in range(3):
                    minimum[axis]=min(minimum[axis],p[axis])
                    maximum[axis]=max(maximum[axis],p[axis])
            exports.append(batch)
        exports.append(root)
        dims=maximum-minimum
        module_report[module_name]={"triangles":triangles,"materialBatches":len(merged),
            "dimensions":[round(dims.x,4),round(dims.z,4),round(dims.y,4)],
            "boundsMin":[round(minimum.x,4),round(minimum.z,4),round(-maximum.y,4)],
            "boundsMax":[round(maximum.x,4),round(maximum.z,4),round(-minimum.y,4)],
            "pivot":root["pivotMode"]}
        # Keep editable parts separated for a useful DCC source layout.
        source_root=bpy.data.objects.new("Source "+module_name,None)
        collection.objects.link(source_root)
        for obj in parts:
            obj.parent=source_root
    bpy.ops.object.select_all(action="DESELECT")
    for obj in exports:
        obj.select_set(True)
    filename="kit-v1.glb" if quality=="high" else "kit-low-v1.glb"
    bpy.ops.export_scene.gltf(filepath=str(DEST/filename),use_selection=True,export_format="GLB",
        export_yup=True,export_apply=True,export_extras=True,export_cameras=False,
        export_lights=False,export_animations=False,export_texcoords=True,export_normals=True)
    report["variants"][quality]={"file":filename,"bytes":(DEST/filename).stat().st_size,
        "triangles":sum(x["triangles"] for x in module_report.values()),"modules":module_report}
    # Free exact stable names before building the next variant. Native-source
    # prefixes distinguish its two collections, but both shipped files use the
    # same root and mesh names so the loader never relies on suffix heuristics.
    for obj in exports:
        obj.name=quality+"/"+obj.name
    collection.hide_render=True
    collection.hide_viewport=True
    export_collection.hide_render=True
    export_collection.hide_viewport=True
    all_exports.append((export_collection,exports))

report["materials"]={"stadium_"+name:{"baseColor":color,"metalness":metal,"roughness":rough}
                     for name,(color,metal,rough) in palette.items()}
(DEST/"kit-v1.manifest.json").write_text(json.dumps(report,indent=2)+"\n")


def prepare_review():
    global active_collection
    review=bpy.data.collections.new("Review composition")
    scene.collection.children.link(review)
    offsets={"barrier-panel":(-2,0,.02),"support-pylon":(5,2,0),
             "light-fixture":(-2,1,5),"vent-module":(-2,-.7,1.6)}
    for obj in all_exports[0][1]:
        if obj.type != "MESH":
            continue
        clone=obj.copy()
        clone.data=obj.data
        clone.parent=None
        module=obj.parent["module"]
        clone.location=offsets[module]
        review.objects.link(clone)
    active_collection=review
    floor=box("Review ground",(0,0,-.16),(200,200,.2),"graphite",0)
    scene.world=bpy.data.worlds.new("Cool studio sky")
    scene.world.use_nodes=True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.16,.21,.29,1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value=.8
    for name,location,energy,color,size in (
        ("Key",(-8,-10,16),2800,(.80,.91,1),12),
        ("Warm fill",(10,-5,10),2200,(1,.82,.61),9),
        ("Rim",(5,6,14),3500,(.42,.72,1),8)):
        data=bpy.data.lights.new(name,"AREA")
        data.energy=energy;data.color=color;data.shape="DISK";data.size=size
        obj=bpy.data.objects.new(name,data);review.objects.link(obj);obj.location=location
        obj.rotation_euler=(Vector((0,0,5))-obj.location).to_track_quat("-Z","Y").to_euler()
    camdata=bpy.data.cameras.new("Kit review camera")
    camera=bpy.data.objects.new("Kit review camera",camdata)
    review.objects.link(camera)
    camera.location=(20,-30,18)
    camera.rotation_euler=(Vector((.8,0,6.8))-camera.location).to_track_quat("-Z","Y").to_euler()
    camdata.type="ORTHO";camdata.ortho_scale=27
    scene.camera=camera
    scene.render.engine="CYCLES";scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
    scene.view_settings.view_transform="AgX"
    scene.render.image_settings.file_format="PNG"
    scene.render.filepath=str(SOURCE/"championship-kit-review.png")
    # Save a useful opening scene as well as both hidden editable collections.
    # The review proxies share mesh data and never enter the shipped GLBs.
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"championship-kit-v1.blend"))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report,indent=2))
