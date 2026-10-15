"""Export the accepted native v018 clip to an isolated GLB review asset."""
import bpy, json, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
P=ROOT/'output/iron-vanguard/cascadeur-attack-work';OUT=ROOT/'output/iron-vanguard/runtime-v018';OUT.mkdir(exist_ok=True)
source=P/'v018-final-review.fbx'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.fbx(filepath=str(source))
s=bpy.context.scene;s.frame_start=1;s.frame_end=71;s.render.fps=30;s.frame_set(1)
rig=next(o for o in s.objects if o.type=='ARMATURE');body=bpy.data.objects['IV_TransferBody_ShoulderFix'];hammer=bpy.data.objects['IV_TransferHammer']
assert len(rig.data.bones)==61 and len(body.data.shape_keys.key_blocks)==71
for obj in [body,hammer]:
 obj.data.materials.clear();mat=bpy.data.materials.new(obj.name+'_ReviewMaterial');mat.use_nodes=True
 bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.31,.38,.44,1) if obj==body else (.19,.24,.29,1);bsdf.inputs['Metallic'].default_value=.25;bsdf.inputs['Roughness'].default_value=.58
 obj.data.materials.append(mat)
# Use the same sampled scene clock for skeleton and morph weights, beginning at zero.
s.name='IronVanguard_Hammer_v018';bpy.ops.object.select_all(action='DESELECT')
for obj in [rig,body,hammer]:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'iron-vanguard-hammer-v018.raw.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='SCENE',export_anim_scene_split_object=False,export_frame_range=True,export_frame_step=1,export_anim_slide_to_zero=True,export_skins=True,export_morph=True,export_morph_normal=True,export_morph_animation=True,export_optimize_animation_size=False,export_extras=True)
report={'source':str(source.relative_to(ROOT)),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'fps':30,'frames':[0,70],'impact_frame':34,'duration_seconds':70/30,'joint_count':61,'corrective_count':70,'body_vertices':len(body.data.vertices),'hammer_vertices':len(hammer.data.vertices),'scope':'Local full-detail animation test, not an optimized multiplayer roster asset. Neutral review materials; source textures not included.'}
(OUT/'export-manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
