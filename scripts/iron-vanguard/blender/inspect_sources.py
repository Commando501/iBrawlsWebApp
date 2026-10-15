"""Import original FBXs into separate review scenes; never overwrite a review blend.
Run with Blender --background --factory-startup --python this_file [-- --output PATH].
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]

def bounds(objects):
    points = [o.matrix_world @ Vector(c) for o in objects if o.type == 'MESH' for c in o.bound_box]
    if not points:
        return None
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return {'min': lo, 'max': hi, 'size': [hi[i]-lo[i] for i in range(3)]}

def main():
    if not bpy.app.background:
        raise RuntimeError('Run in a separate background Blender process.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'reference/Meshy_AI_Iron_Vanguard_biped (1)')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/iron-vanguard/intake')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    files = sorted(args.source.rglob('*.fbx'))
    if not files:
        raise RuntimeError(f'No FBX sources in {args.source}')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    blend = out / 'iron-vanguard-source-review.blend'
    if blend.exists():
        raise FileExistsError(f'Preserving {blend}; choose a new --output directory.')
    report = {'blender': bpy.app.version_string, 'assets': [],
              'note': 'Raw imports. No scale normalization, retargeting, or weapon fitting.'}
    startup = bpy.context.scene
    for i, source in enumerate(files):
        role = ('animation' if '_Animation_' in source.name else 'character' if '_Character_' in source.name
                else 'hammer' if 'Warhammer' in source.name else 'sword')
        scene = bpy.data.scenes.new(f'{i+1:02d}_{role}_source')
        bpy.context.window.scene = scene
        scene.render.fps = 60
        scene.unit_settings.system = 'METRIC'
        previous = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=str(source), use_image_search=True)
        bpy.context.view_layer.update()
        objects = list(scene.objects)
        actions = [a for a in bpy.data.actions if a not in previous]
        asset = {'role': role, 'path': str(source.resolve()), 'scene': scene.name,
                 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'bytes': source.stat().st_size,
                 'fps': scene.render.fps/scene.render.fps_base, 'import_pose_bounds': bounds(objects),
                 'meshes': [], 'armatures': [], 'actions': [], 'images': []}
        for o in objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                asset['meshes'].append({'name': o.name, 'vertices': len(o.data.vertices),
                    'triangles': len(o.data.loop_triangles), 'scale': list(o.scale),
                    'materials': [m.name if m else None for m in o.data.materials],
                    'vertex_groups': len(o.vertex_groups),
                    'armature_modifiers': [m.object.name if m.object else None for m in o.modifiers if m.type == 'ARMATURE']})
            elif o.type == 'ARMATURE':
                asset['armatures'].append({'name': o.name, 'scale': list(o.scale),
                    'bones': [{'name': b.name, 'parent': b.parent.name if b.parent else None,
                               'head_world': list(o.matrix_world @ b.head_local),
                               'tail_world': list(o.matrix_world @ b.tail_local), 'deform': b.use_deform}
                              for b in o.data.bones],
                    'active_action': o.animation_data.action.name if o.animation_data and o.animation_data.action else None,
                    'nla_tracks': [{'name': t.name, 'strips': [{'name': s.name, 'action': s.action.name if s.action else None,
                                  'frames': [s.frame_start, s.frame_end]} for s in t.strips]}
                                   for t in o.animation_data.nla_tracks] if o.animation_data else []})
        for a in actions:
            a.use_fake_user = True
            frames = list(a.frame_range)
            asset['actions'].append({'name': a.name, 'frames': frames,
                'seconds': (frames[1]-frames[0])/asset['fps'], 'slots': [s.identifier for s in a.slots]})
        materials = {m for o in objects if o.type == 'MESH' for m in o.data.materials if m}
        images = {n.image for m in materials if m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
        asset['images'] = [{'name': img.name, 'size': list(img.size), 'path': img.filepath,
                            'has_data': img.has_data, 'packed': bool(img.packed_file)} for img in images]
        if actions:
            scene.frame_start = int(min(a.frame_range[0] for a in actions))
            scene.frame_end = int(max(a.frame_range[1] for a in actions))
            scene.frame_set(scene.frame_start)
        scene['source_fbx'] = str(source)
        scene['review_status'] = 'Raw source; scale, grips, materials, and motion require review.'
        report['assets'].append(asset)
    bpy.data.scenes.remove(startup)
    bpy.context.window.scene = next(s for s in bpy.data.scenes if '_character_' in s.name)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    (out / 'source-audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('IRON_VANGUARD_INTAKE', blend)

if __name__ == '__main__':
    main()
