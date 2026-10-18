"""Original hard-surface and geological kit for Canyon Plateau.

Run Blender 5.x --background --factory-startup --python this_file.py.
Source is Z-up; glTF is Y-up. Every runtime module has an identity transform,
a center pivot, and geometry baked into one mesh per shared material.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public/assets/canyon/architecture"
SOURCE = ROOT / "output/canyon"
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
    "alloy": ("#526574", .72, .42),
    "graphite": ("#202c35", .35, .66),
    "ceramic": ("#bdc7c8", .10, .49),
    "trim": ("#a69266", .78, .36),
    "cyan": ("#4ac8da", .05, .33),
    "warm": ("#ffdeb0", .04, .35),
    "rock": ("#aaa49a", .0, .94),
}
materials = {}
for name, (color, metallic, roughness) in palette.items():
    mat = bpy.data.materials.new("canyon_" + name)
    mat.diffuse_color = linear(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if name in ("cyan", "warm"):
        bsdf.inputs["Emission Color"].default_value = linear(color)
        bsdf.inputs["Emission Strength"].default_value = 1.5
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
        # Weighted corner normals retain broad, clean hard-surface highlights.
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new("Weighted planar normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
        normal.weight = 50
    parts.append(obj)
    return obj


def box(name, center, size, role="alloy", bevel=.025, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation
    return finish(obj, name, role, bevel)


def radial_box(name, radial_distance, z, size, side, role="alloy", bevel=.025):
    angle = side * math.pi / 2
    return box(name, (math.sin(angle)*radial_distance, -math.cos(angle)*radial_distance, z),
               size, role, bevel, angle)


def lathe(name, rings, segments, role="alloy"):
    vertices = [(r*math.cos(2*math.pi*i/segments), r*math.sin(2*math.pi*i/segments), z)
                for r, z in rings for i in range(segments)]
    faces = [tuple(reversed(range(segments)))]
    for j in range(len(rings)-1):
        for i in range(segments):
            n = (i+1) % segments
            faces.append((j*segments+i, j*segments+n, (j+1)*segments+n, (j+1)*segments+i))
    faces.append(tuple(range((len(rings)-1)*segments, len(rings)*segments)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    active_collection.objects.link(obj)
    return finish(obj, name, role, 0)


def anchor():
    segments = 16 if detail else 8
    lathe("Faceted impact foundation", [(1,-4),(1,-3.82),(.88,-3.66),(.81,-3.44)], segments)
    lathe("Tapered graphite core", [(.79,-3.62),(.70,-2.9),(.70,2.9),(.86,3.53),(.86,3.76)],
          segments, "graphite")
    lathe("Crown impact ring", [(.86,3.58),(1,3.79),(1,4)], segments)
    for side in range(4):
        radial_box("Recessed structural rib", .71, 0, (.12,.12,6.95), side, "alloy", .018)
        for z in (-1.53,1.53):
            radial_box("Ceramic armor segment", .755, z, (.73,.13,2.45), side, "ceramic", .04)
            radial_box("Inset armor seam", .827, z-.82, (.55,.014,.048), side, "graphite", .006)
            if detail:
                for x in (-.25,.25):
                    bolt = radial_box("Captive armor fastener", .831, z+.98, (.05,.013,.055),
                                      side, "alloy", .007)
                    bolt.location += Vector((math.cos(side*math.pi/2)*x,
                                             math.sin(side*math.pi/2)*x,0))
        radial_box("Navigation slit", .829, 2.34, (.055,.012,.5), side, "cyan", .006)
        radial_box("Service collar", .774, -.02, (.70,.15,.18), side, "alloy", .02)
        if detail:
            for z in (-3.03,3.02):
                radial_box("Recessed ventilation port", .735, z, (.46,.04,.21), side, "graphite", .02)
                for x in (-.15,0,.15):
                    fin = radial_box("Vent extraction fin", .763, z, (.025,.025,.14), side, "alloy", .004)
                    fin.location += Vector((math.cos(side*math.pi/2)*x,
                                            math.sin(side*math.pi/2)*x,0))


def cover():
    box("Cover recessed chassis", (0,0,0), (1.12,3.88,1.88), "graphite", .08)
    box("Load bearing top cap", (0,0,.91), (1.2,4,.18), "alloy", .045)
    box("Impact resistant foot", (0,0,-.89), (1.2,4,.22), "alloy", .04)
    for sign in (-1,1):
        box("Ceramic cover shield", (sign*.552,0,.01), (.076,3.48,1.38), "ceramic", .035)
        box("Shield service recess", (sign*.593,0,.39), (.012,2.7,.075), "graphite", .006)
        box("Cover status slit", (sign*.6-.006*sign,.75,.39), (.012,.34,.034), "cyan", .004)
        for y in (-1.87,1.87):
            box("Armored corner return", (sign*.51,y,-.01), (.16,.18,1.67), "alloy", .03)
        if detail:
            for y in (-1.5,1.5):
                for z in (-.51,.57):
                    box("Cover captive fastener", (sign*.594,y,z), (.012,.065,.065), "graphite", .008)
            for y in (-1.14,-.96,-.78):
                box("Cover lower vent", (sign*.593,y,-.38), (.01,.052,.24), "graphite", .008)
        box("Bronze repair marker", (sign*.593,1.24,-.37), (.01,.25,.06), "trim", .006)


def beacon():
    box("Beacon foundation", (0,0,-19.71), (3,3,.58), "alloy", .09)
    box("Beacon crown", (0,0,19.72), (3,3,.56), "alloy", .09)
    box("Dark structural core", (0,0,0), (2.02,2.02,39.1), "graphite", .09)
    for x in (-1.16,1.16):
        for y in (-1.16,1.16):
            box("Tower load bearing spine", (x,y,0), (.30,.30,38.9), "alloy", .06)
    for z in (-18,-11,-4,3,10,17.5):
        box("Armor station collar", (0,0,z), (2.72,2.72,.22), "alloy", .045)
    for side in range(4):
        for z in (-14.6,-7.6,-.6,6.4,13.4):
            radial_box("Segmented tower armor", 1.087, z, (1.45,.13,5.9), side, "ceramic", .075)
            radial_box("Tower armor inset", 1.16, z, (.08,.016,4.8), side, "graphite", .006)
            if detail:
                for zz in (-2.5,2.5):
                    radial_box("Tower locking flange", 1.172, z+zz, (1.05,.025,.065), side, "alloy", .009)
        radial_box("Beacon cyan locator", 1.171, 14.5, (.075,.018,1.25), side, "cyan", .008)
        radial_box("Optical crown socket", 1.12, 18.55, (1.55,.20,.66), side, "graphite", .05)
        radial_box("Optical crown lens", 1.228, 18.55, (.65,.012,.20), side, "warm", .025)
        radial_box("Crown maintenance marking", 1.285, 17.86, (.55,.016,.075), side, "trim", .009)
        if detail:
            for z in (-18.75,18.95):
                radial_box("Tower maintenance hatch", 1.11, z, (.8,.12,.5), side, "graphite", .04)
                for k in range(3):
                    radial_box("Maintenance extraction louver", 1.18, z-.12+k*.12,
                               (.64,.05,.04), side, "alloy", .006)


def geological_mass(name, center, scale, seed):
    """Weathered rock faces with discontinuous beds and broad diagonal clefts."""
    segments = 48 if detail else 20
    beds = 12 if detail else 7
    rows = []
    thicknesses=[1+.47*math.sin(bed*2.17+seed)+.17*math.cos(bed*3.1-seed)
                 for bed in range(beds)]
    total=sum(thicknesses)
    cursor=0
    # Each bed has a recessed undercut, protruding ledge, and weathered wall.
    for bed in range(beds):
        thickness=thicknesses[bed]/total
        for portion, ledge in ((0,-.035),(.10,.018),(.83,.006)):
            t = cursor+portion*thickness
            rows.append((t,ledge,bed))
        cursor+=thickness
    rows.append((1,-.08,beds))
    vertices = []
    for t,ledge,bed in rows:
        for i in range(segments):
            a = 2*math.pi*i/segments
            broad = .83 + .13*math.sin(a*2+seed) + .065*math.cos(a*5-seed*.4)
            erosion = .055*math.sin(a*7+t*5+seed) + .035*math.cos(a*4-t*8)
            # Several diagonal faults cut through multiple beds instead of
            # creating a uniform horizontal gap around the entire formation.
            fracture = 0
            for fault,slope,width in ((seed,.95,.17),(seed+2.3,-1.25,.24),(seed+4.4,.55,.13)):
                offset = math.atan2(math.sin(a-fault-t*slope),math.cos(a-fault-t*slope))
                fracture -= .20*math.exp(-(offset/width)**2)
            shelf_mask = max(0,min(1,(math.sin(a*2.0+bed*1.71+seed)
                                          + .55*math.cos(a*5.0-bed*.73)+.15)*.85))
            shelf_mask *= shelf_mask
            # Sloping erosion joins the broken shelves into a natural mass;
            # the crown narrows and wanders instead of ending in a flat slab.
            crown = t**4
            silhouette = 1-.12*t+.07*math.sin(t*7+seed)-crown*(.055+.045*math.sin(a*3+seed))
            radius = max(.35,(broad+erosion+fracture+ledge*shelf_mask)*silhouette)
            z = (t-.5)*2 + .115*math.sin(a*2+seed+t*2.4)*math.sin(math.pi*t)
            z += crown*(.12*math.sin(a*3+seed)+.055*math.cos(a*5-seed))
            x = math.cos(a)*radius + .07*math.sin(t*5+seed)
            y = math.sin(a)*radius + .08*math.cos(t*6+seed)
            vertices.append((center[0]+x*scale[0],center[1]+y*scale[1],center[2]+z*scale[2]))
    faces = [tuple(reversed(range(segments)))]
    for j in range(len(rows)-1):
        for i in range(segments):
            n = (i+1)%segments
            faces.append((j*segments+i,j*segments+n,(j+1)*segments+n,(j+1)*segments+i))
    faces.append(tuple(range((len(rows)-1)*segments,len(rows)*segments)))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    # Broad eroded faces are smooth; shelf undersides and crowns stay faceted.
    # Angle-marked edges preserve genuine fractures in addition to those beds.
    for polygon in mesh.polygons:
        if 0<polygon.index<len(mesh.polygons)-1:
            row=(polygon.index-1)//segments
            polygon.use_smooth=row%3!=0
    mesh.set_sharp_from_angle(angle=math.radians(42))
    obj=bpy.data.objects.new(name,mesh)
    active_collection.objects.link(obj)
    return finish(obj,name,"rock",0)


def cliff():
    geological_mass("Main stratified escarpment",(-1.8,.8,0),(8.5,5.9,15),.7)
    geological_mass("Fractured outer buttress",(4.2,-.3,-1.5),(5.0,5.3,13.5),2.3)
    geological_mass("Lower talus shoulder",(-5.3,-1.5,-6.0),(4.8,4.5,9),4.1)
    # Only this backdrop has no gameplay collider. Fit the complete layered
    # formation to its precise reusable envelope without altering its pivot.
    minimum = Vector((math.inf,math.inf,math.inf))
    maximum = Vector((-math.inf,-math.inf,-math.inf))
    for obj in parts:
        for vertex in obj.data.vertices:
            for axis in range(3):
                minimum[axis]=min(minimum[axis],vertex.co[axis])
                maximum[axis]=max(maximum[axis],vertex.co[axis])
    center=(minimum+maximum)*.5
    size=maximum-minimum
    target=(20,12,30)
    for obj in parts:
        for vertex in obj.data.vertices:
            for axis in range(3):
                vertex.co[axis]=(vertex.co[axis]-center[axis])*target[axis]/size[axis]
        obj.data.update()


builders={"anchor-spire":anchor,"buffer-cover":cover,"beacon-tower":beacon,"canyon-cliff":cliff}


def unwrap(mesh):
    """Planar UV coordinates in metres; runtime selects the physical tile size."""
    uv=mesh.uv_layers.new(name="UVMap") if not mesh.uv_layers else mesh.uv_layers.active
    for poly in mesh.polygons:
        axis=max(range(3),key=lambda i:abs(poly.normal[i]))
        for loop_index in poly.loop_indices:
            p=mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv=((p.x,p.z) if axis==1 else (p.y,p.z) if axis==0 else (p.x,p.y))


report={"schema":1,"generator":"scripts/canyon/author-kit.py","units":"metres",
        "coordinates":"glTF Y-up; front +Z; all pivots center",
        "provenance":"Original Blender-authored architecture and deterministic geological geometry; no third-party game assets",
        "variants":{}}
all_exports=[]
for quality in ("high","low"):
    detail=quality=="high"
    collection=bpy.data.collections.new("Editable "+quality)
    scene.collection.children.link(collection)
    active_collection=collection
    export_collection=bpy.data.collections.new("Runtime "+quality)
    scene.collection.children.link(export_collection)
    module_report={}
    exports=[]
    for module_name,builder in builders.items():
        parts=[]
        builder()
        root=bpy.data.objects.new(module_name,None)
        export_collection.objects.link(root)
        root["module"]=module_name
        root["pivotMode"]="center"
        root["quality"]=quality
        bpy.context.view_layer.update()
        deps=bpy.context.evaluated_depsgraph_get()
        merged={}
        for obj in parts:
            role=obj["paint_role"]
            evaluated=obj.evaluated_get(deps)
            mesh=bpy.data.meshes.new_from_object(evaluated,depsgraph=deps)
            mesh.transform(obj.matrix_world)
            mesh.update()
            unwrap(mesh)
            part=bpy.data.objects.new(module_name+"_"+role,mesh)
            export_collection.objects.link(part)
            merged.setdefault(role,[]).append(part)
        triangles=0
        minimum=Vector((math.inf,math.inf,math.inf))
        maximum=Vector((-math.inf,-math.inf,-math.inf))
        radius=0
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
            triangles+=len(batch.data.loop_triangles)
            for vertex in batch.data.vertices:
                p=vertex.co
                radius=max(radius,math.hypot(p.x,p.y))
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
            "maxHorizontalRadius":round(radius,6),"pivot":"center"}
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
    for obj in exports:
        obj.name=quality+"/"+obj.name
    collection.hide_render=True
    collection.hide_viewport=True
    export_collection.hide_render=True
    export_collection.hide_viewport=True
    all_exports.append((export_collection,exports))

report["materials"]={"canyon_"+name:{"baseColor":color,"metalness":metal,"roughness":rough,
                     "emissiveStrength":1.5 if name in ("cyan","warm") else 0}
                     for name,(color,metal,rough) in palette.items()}
(DEST/"kit-v1.manifest.json").write_text(json.dumps(report,indent=2)+"\n")


def prepare_review():
    global active_collection
    review=bpy.data.collections.new("Review composition")
    scene.collection.children.link(review)
    offsets={"anchor-spire":(-6,-3,4),"buffer-cover":(-1,-4,1),
             "beacon-tower":(5,3,10),"canyon-cliff":(-2,8,7.5)}
    scales={"anchor-spire":1,"buffer-cover":1,"beacon-tower":.5,"canyon-cliff":.5}
    for obj in all_exports[0][1]:
        if obj.type!="MESH":
            continue
        clone=obj.copy()
        clone.data=obj.data
        clone.parent=None
        module=obj.parent["module"]
        clone.location=offsets[module]
        clone.scale=(scales[module],)*3
        review.objects.link(clone)
    active_collection=review
    box("Review ground",(0,0,-.15),(160,160,.2),"graphite",0)
    scene.world=bpy.data.worlds.new("Canyon daylight")
    scene.world.use_nodes=True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.24,.34,.48,1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value=.55
    for name,location,energy,color,size in (
        ("Warm sky key",(-8,-12,24),6800,(1,.87,.70),12),
        ("Cool sky fill",(15,-3,16),5200,(.65,.82,1),14),
        ("Silhouette rim",(-4,16,20),6000,(.75,.86,1),10)):
        data=bpy.data.lights.new(name,"AREA")
        data.energy=energy
        data.color=color
        data.shape="DISK"
        data.size=size
        light=bpy.data.objects.new(name,data)
        review.objects.link(light)
        light.location=location
        light.rotation_euler=(Vector((0,0,6))-light.location).to_track_quat("-Z","Y").to_euler()
    camdata=bpy.data.cameras.new("Canyon kit review camera")
    camera=bpy.data.objects.new("Canyon kit review camera",camdata)
    review.objects.link(camera)
    camera.location=(24,-36,24)
    camera.rotation_euler=(Vector((0,1,8))-camera.location).to_track_quat("-Z","Y").to_euler()
    camdata.type="ORTHO"
    camdata.ortho_scale=31
    scene.camera=camera
    scene.render.engine="CYCLES"
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1600
    scene.render.resolution_y=1200
    scene.render.resolution_percentage=100
    scene.view_settings.view_transform="AgX"
    scene.render.image_settings.file_format="PNG"
    scene.render.filepath=str(SOURCE/"canyon-kit-review.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"canyon-kit-v1.blend"))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)


prepare_review()
print(json.dumps(report,indent=2))
