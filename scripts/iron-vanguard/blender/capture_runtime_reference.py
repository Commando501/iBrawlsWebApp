"""Capture independent native-FBX joint and surface references for the v018 GLB test."""
import json
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / 'output/iron-vanguard'
OUTPUT = ASSETS / 'runtime-v018'
OUTPUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(ASSETS / 'cascadeur-attack-work/v018-final-review.fbx'))
scene = bpy.context.scene
rig = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
body = bpy.data.objects['IV_TransferBody_ShoulderFix']
source = np.load(ASSETS / 'cascadeur-attack-work/v018-shoulder-corrective-final.npz')
rng = np.random.default_rng(184)
indices = np.unique(np.r_[
    rng.choice(len(body.data.vertices), 256, replace=False),
    rng.choice(source['vertex_indices'], 256, replace=False),
])


def yup(vector):
    return [vector.x, vector.z, -vector.y]


joint_frames = []
surface_frames = []
for frame in range(71):
    scene.frame_set(frame + 1)
    joint_frames.append({
        'frame': frame,
        'joints': {name: yup(rig.matrix_world @ bone.head) for name, bone in rig.pose.bones.items()},
    })
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    surface_frames.append([
        yup(body.matrix_world @ evaluated.data.vertices[int(index)].co) for index in indices
    ])
weights = [sorted((group.weight for group in vertex.groups if group.weight > 0), reverse=True)
           for vertex in body.data.vertices]
surface = {
    'indices': indices.tolist(),
    'positions': surface_frames,
    'vertices_with_more_than_four_weights': sum(len(row) > 4 for row in weights),
    'max_discarded_weight_at_four': max(sum(row[4:]) for row in weights),
}
(OUTPUT / 'native-joint-reference.json').write_text(json.dumps(joint_frames))
(OUTPUT / 'native-surface-reference.json').write_text(json.dumps(surface))
print(f'Captured {len(joint_frames)} frames, {len(rig.pose.bones)} joints, and {len(indices)} surface samples.')
