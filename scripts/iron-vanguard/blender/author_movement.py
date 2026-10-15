"""Bake movement on v018's skeleton in background Blender; artist sources are untouched.
Usage: -- --output NEW_DIRECTORY. Bakes fixed-length leg IK and shared torso/weapon motion.
"""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[3]

def main():
    assert bpy.app.background
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    out=parser.parse_args(sys.argv[sys.argv.index('--')+1:]).output.resolve();out.mkdir(parents=True,exist_ok=True)
    destination=out/'movement.blend'
    if destination.exists():raise RuntimeError('Use a new directory to preserve the previous candidate.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(ROOT/'output/iron-vanguard/cascadeur-attack-work/v018-final-review.fbx'))
    scene=bpy.context.scene;scene.frame_set(1)
    rig=next(o for o in scene.objects if o.type=='ARMATURE')
    world=rig.matrix_world.copy();inverse=world.inverted()
    base={p.name:world@p.matrix for p in rig.pose.bones}
    # Keep the accepted ready corrective; attack morphs stay in the unchanged shipping GLB.
    meshes=[o for o in scene.objects if o.type=='MESH']
    for obj in meshes:
        if obj.data.shape_keys:obj.data.shape_keys.animation_data_clear()
        scene.collection.objects.unlink(obj)
    rig.animation_data_clear();rig.matrix_world=world;scene.render.fps=60
    plans=[('idle',4.,None),('crouch',1.,None),('jump',.3,None),('fall',.6,None),('land',.26,None),('slide',.7,None)]
    for gait,seconds in [('walk',1.),('run',.7),('crouch-walk',1.2)]:
        for direction,vector in [('forward',(0,1,0)),('backward',(0,-1,0)),('left',(-1,0,0)),('right',(1,0,0))]:
            plans.append((gait+'-'+direction,seconds,Vector(vector)))
    report={'source':'v018-final-review.fbx','fps':60,'clips':{},'status':'Movement first pass; visual approval pending. Hammer attack unchanged.'}
    actions=[]
    for name,duration,direction in plans:
        count=round(duration*60);duration=count/60
        action=bpy.data.actions.new('IV_'+name);action.use_fake_user=True
        rig.animation_data_create();rig.animation_data.action=action
        previous={};max_reach_error=0.
        for frame in range(count+1):
            phase=frame/count;moving=direction is not None;crouched=name.startswith('crouch');running=name.startswith('run')
            depth=.25 if crouched else .12 if running else .06 if moving else 0.
            bob=.012*(1-math.cos(phase*math.tau*2)) if moving else 0.
            if name=='idle':depth=.002*(1-math.cos(phase*math.tau))
            if name=='land':depth=.13*math.sin(math.pi*phase)**2
            if name=='slide':depth=.36
            translation=Vector((0,-.035 if crouched else 0,-depth+bob))
            lean=math.radians(10 if running else 12 if crouched else 4 if moving else 0)
            if name=='slide':lean=math.radians(-12)
            if name=='land':lean=math.radians(6)*math.sin(math.pi*phase)**2
            pivot=base['Hips'].translation
            delta=Matrix.Translation(pivot+translation)@Matrix.Rotation(-lean,4,'X')@Matrix.Translation(-pivot)
            poses={n:delta@m for n,m in base.items()};poses['root']=base['root'].copy()
            for side,offset in [('Left',0),('Right',.5)]:
                thigh,shin,foot=(side+x for x in ['UpLeg','Leg','Foot'])
                hip=poses[thigh].translation;knee0=base[shin].translation;ankle0=base[foot].translation
                ankle=ankle0.copy();pitch=0.
                if moving:
                    p=(phase+offset)%1;travel=.34 if running else .15 if crouched else .22
                    if abs(direction.x)>.5:travel=.13 if running else .09 if crouched else .11
                    lift=.14 if running else .045 if crouched else .075
                    if p<.55:distance=travel*(1-2*p/.55)
                    else:
                        swing=(p-.55)/.45;distance=-travel*math.cos(math.pi*swing)
                        ankle.z+=lift*math.sin(math.pi*swing)**2;pitch=-.12*math.sin(math.pi*swing)
                    ankle+=direction*distance
                if name in ('jump','fall'):
                    tuck=(1-math.cos(math.pi*phase))/2 if name=='jump' else 1.
                    ankle+=Vector((0,-.08*tuck,.09*tuck));pitch=-.12*tuck
                if name=='slide':ankle+=Vector((0,.34 if side=='Left' else .20,.035))
                a=(base[thigh].translation-knee0).length;b=(knee0-ankle0).length
                axis=ankle-hip;limit=a+b-.001
                if axis.length>limit:
                    max_reach_error=max(max_reach_error,axis.length-limit);ankle=hip+axis.normalized()*limit
                distance=(ankle-hip).length;axis=(ankle-hip).normalized()
                along=(a*a-b*b+distance*distance)/(2*distance);height=math.sqrt(max(0,a*a-along*along))
                original_axis=(ankle0-base[thigh].translation).normalized()
                pole=knee0-base[thigh].translation;pole=(pole-original_axis*pole.dot(original_axis)).normalized()
                perp=(pole-axis*pole.dot(axis)).normalized()
                knee=hip+axis*along+perp*height
                for bone,start,end,original_end in [(thigh,hip,knee,knee0),(shin,knee,ankle,ankle0)]:
                    q=(original_end-base[bone].translation).rotation_difference(end-start)
                    m=q.to_matrix().to_4x4()@base[bone];m.translation=start;poses[bone]=m
                m=Matrix.Rotation(pitch,4,'X')@base[foot];m.translation=ankle;fd=m@base[foot].inverted()
                for pb in rig.pose.bones:
                    if pb.name==foot or any(p.name==foot for p in pb.parent_recursive):poses[pb.name]=fd@base[pb.name]
            for pb in rig.pose.bones:
                pb.matrix=inverse@poses[pb.name];bpy.context.view_layer.update();pb.rotation_mode='QUATERNION'
                if pb.name in previous and pb.rotation_quaternion.dot(previous[pb.name])<0:pb.rotation_quaternion.negate()
                previous[pb.name]=pb.rotation_quaternion.copy()
                for prop in ('location','rotation_quaternion','scale'):pb.keyframe_insert(prop,frame=frame+1,group=pb.name)
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    bag=strip.channelbag(slot)
                    if bag:
                        for curve in bag.fcurves:
                            for key in curve.keyframe_points:key.interpolation='LINEAR'
        scene.frame_start=1;scene.frame_end=count+1;scene.frame_set(1)
        bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;scene.name='IV_'+name
        bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='SCENE',export_anim_scene_split_object=False,export_frame_range=True,export_frame_step=1,export_anim_slide_to_zero=True,export_optimize_animation_size=False,export_extras=True)
        report['clips'][name]={'duration':duration,'loop':name not in ('jump','land'),'frames':count+1,'max_unreachable_target_m':max_reach_error}
        actions.append(action);print('BAKED',name,report['clips'][name],flush=True)
    for obj in meshes:scene.collection.objects.link(obj)
    rig.animation_data.action=actions[0];scene.name='Iron Vanguard movement review';scene.frame_start=1;scene.frame_end=241;scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(destination),compress=True)
    (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':main()
