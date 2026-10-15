"""Export approved sword idle rotations and the rigid sword from a background copy.
The canonical master is read-only. The sword GLB keeps the approved world pose;
its grip matrix converts it to RightHand space in the runtime.
"""
import bpy, sys, json, argparse
from pathlib import Path
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).parent))
from build_master import set_action
from author_idles import signature

def main():
    assert bpy.app.background
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    out=parser.parse_args(sys.argv[sys.argv.index('--')+1:]).output.resolve()
    out.mkdir(parents=True,exist_ok=True)
    assert not (out/'sword-source.json').exists(), 'Use a fresh output directory.'
    scene=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=scene
    rig=bpy.data.objects['IV_Rig'];sword=bpy.data.objects['IV_Sword']
    action=bpy.data.actions['IV_Sword_Idle'];sig=signature(action)
    set_action(rig,action);scene.frame_set(1);bpy.context.view_layer.update()
    # Blender Z-up -> glTF Y-up. Keep exact source world geometry and grip.
    c=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    hand=c@rig.matrix_world@rig.pose.bones['RightHand'].matrix
    names=[p.name for p in rig.pose.bones if p.bone.use_deform and not any(t in p.name for t in ['UpLeg','ToeBase','Foot','Leg']) and p.name not in ['Hips','root']]
    data={'source':str(Path(bpy.data.filepath).name),'action':action.name,'signature':sig,'duration':4,'gripMatrix':[hand[r][col] for col in range(4) for r in range(4)],'tracks':{n:[] for n in names},'times':[]}
    for f in range(1,242,2):
        scene.frame_set(f);bpy.context.view_layer.update();data['times'].append((f-1)/60)
        for n in names:
            p=rig.pose.bones[n];m=p.parent.matrix.inverted()@p.matrix if p.parent else p.matrix
            q=m.to_quaternion();data['tracks'][n].append([q.x,q.y,q.z,q.w])
    scene.frame_set(1);bpy.context.view_layer.update()
    deps=bpy.context.evaluated_depsgraph_get();ev=sword.evaluated_get(deps)
    mesh=bpy.data.meshes.new_from_object(ev);mesh.transform(sword.matrix_world)
    dst_scene=bpy.data.scenes.new('Sword_Runtime_Export');bpy.context.window.scene=dst_scene
    obj=bpy.data.objects.new('IV_Sword',mesh);dst_scene.collection.objects.link(obj)
    obj.hide_render=False;obj.hide_set(False)
    # Preserve silhouette; the original source is much denser than the small prop needs.
    before=len(mesh.polygons);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    if before>9000:
        dec=obj.modifiers.new('Runtime simplification','DECIMATE');dec.ratio=9000/before
        bpy.ops.object.modifier_apply(modifier=dec.name)
    for p in obj.data.polygons:p.use_smooth=True
    obj.data.materials.clear();mat=bpy.data.materials.new('Vanguard sword steel');mat.diffuse_color=(.34,.43,.49,1);mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.34,.43,.49,1);bsdf.inputs['Metallic'].default_value=.65;bsdf.inputs['Roughness'].default_value=.32
    obj.data.materials.append(mat)
    bpy.ops.export_scene.gltf(filepath=str(out/'sword.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_animations=False)
    assert signature(action)==sig
    data['meshPolygons']={'source':before,'export':len(obj.data.polygons)}
    (out/'sword-source.json').write_text(json.dumps(data),encoding='utf-8')
    print(json.dumps({'tracks':names,'polygons':data['meshPolygons'],'bytes':(out/'sword.glb').stat().st_size}),flush=True)
if __name__=='__main__':main()
