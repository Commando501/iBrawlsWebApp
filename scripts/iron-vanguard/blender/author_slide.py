"""Author slide entry, hold and stand-up on the saved Vanguard movement rig.
Blender --background --python author_slide.py -- --base DIR --output NEW_DIR
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector


def smooth(x):
    return x*x*(3-2*x)


def main():
    assert bpy.app.background
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    source, out = args.base.resolve(), args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if (out/'movement.blend').exists():
        raise RuntimeError('Use a new output directory to preserve previous candidates.')
    bpy.ops.wm.open_mainfile(filepath=str(source/'movement.blend'))
    scene = bpy.context.scene
    rig = next(o for o in scene.objects if o.type == 'ARMATURE')
    rig.animation_data.action = bpy.data.actions['IV_idle']
    scene.frame_set(1)
    world = rig.matrix_world.copy()
    inverse = world.inverted()
    base = {p.name: world @ p.matrix for p in rig.pose.bones}
    meshes = [o for o in scene.objects if o.type == 'MESH']
    for obj in meshes:
        scene.collection.objects.unlink(obj)
    report = json.loads((source/'manifest.json').read_text(encoding='utf-8'))
    for name, metadata in report['clips'].items():
        metadata['file'] = os.path.relpath(source/metadata.get('file',name+'.glb'),out).replace('\\','/')

    # Separate support beats: compress, lead heel out, hold; shift onto the tucked
    # boot, gather the leading foot, then extend both legs to return to standing.
    def key(time, hip, left, right, lean=0, carry=0, pitch=0, weight=0):
        return dict(time=time, hip=Vector(hip), left=Vector(left), right=Vector(right), lean=lean, carry=carry, pitch=pitch, weight=weight)
    lf, rf = base['LeftFoot'].translation, base['RightFoot'].translation
    ready = key(0,(0,0,0),lf,rf)
    hold = key(1,(0,-.035,-.615),(-.19,.70,.215),(.18,-.03,.175),lean=-6,carry=1,pitch=18,weight=1)
    enter = [ready,
        key(.22,(0,.025,-.12),lf,rf,lean=10,carry=.2,weight=.2),
        key(.58,(0,.01,-.38),(-.20,.34,.26),(.18,-.03,.175),lean=3,carry=.7,pitch=10,weight=.65),hold]
    exit = [dict(hold,time=0),
        key(.24,(0,.07,-.56),hold['left'],hold['right'],lean=18,carry=.95,pitch=18,weight=.92),
        key(.52,(0,.09,-.36),(-.20,.28,.28),hold['right'],lean=20,carry=.65,pitch=6,weight=.6),
        key(.78,(0,.025,-.13),lf,rf,lean=10,carry=.25,weight=.22),dict(ready,time=1)]
    plans=[('slide-enter',.4,enter,False),('slide',.7,[dict(hold,time=0),hold],True),('slide-exit',.65,exit,False)]
    actions=[]
    for name,duration,keys,loop in plans:
        old=bpy.data.actions.get('IV_'+name)
        if old: old.name='IV_'+name+'_previous'
        action=bpy.data.actions.new('IV_'+name);action.use_fake_user=True
        rig.animation_data.action=action;actions.append(action)
        count=round(duration*60);previous={};max_error=0.;weights=[]
        for frame in range(count+1):
            t=frame/count
            index=next((i for i in range(len(keys)-1) if t<=keys[i+1]['time']),len(keys)-2)
            a,b=keys[index:index+2];f=smooth((t-a['time'])/(b['time']-a['time']))
            k={n:a[n]*(1-f)+b[n]*f for n in a if n!='time'}
            weights.append(k['weight'])
            pivot=base['Hips'].translation
            delta=Matrix.Translation(pivot+k['hip'])@Matrix.Rotation(math.radians(-k['lean']),4,'X')@Matrix.Translation(-pivot)
            poses={n:delta@m for n,m in base.items()};poses['root']=base['root'].copy()
            def limb(first,second,end,target,pole):
                nonlocal max_error
                origin=poses[first].translation
                upper=(base[second].translation-base[first].translation).length
                lower=(base[end].translation-base[second].translation).length
                axis=target-origin
                distance=min(upper+lower-.001,max(abs(upper-lower)+.001,axis.length))
                max_error=max(max_error,abs(axis.length-distance));axis.normalize()
                target=origin+axis*distance
                along=(upper*upper-lower*lower+distance*distance)/(2*distance)
                perp=(pole-axis*pole.dot(axis)).normalized()
                joint=origin+axis*along+perp*math.sqrt(max(0,upper*upper-along*along))
                for bone,start,finish,child in [(first,origin,joint,second),(second,joint,target,end)]:
                    rest=delta@base[bone]
                    vector=(delta@base[child]).translation-rest.translation
                    matrix=vector.rotation_difference(finish-start).to_matrix().to_4x4()@rest
                    matrix.translation=start;poses[bone]=matrix
                return target
            for side in ('Left','Right'):
                # Knees keep facing forward; the trailing boot sits under the hip,
                # not turned sideways outside the body.
                foot=side+'Foot';thigh=side+'UpLeg';shin=side+'Leg'
                rest_pole=base[shin].translation-base[thigh].translation
                rest_axis=(base[foot].translation-base[thigh].translation).normalized()
                rest_pole=(rest_pole-rest_axis*rest_pole.dot(rest_axis)).normalized()
                target_pole=Vector((-.05 if side=='Left' else .05,1,.04)).normalized()
                pole=rest_pole.lerp(target_pole,k['weight']).normalized()
                goal=limb(thigh,shin,foot,k['left' if side=='Left' else 'right'],pole)
                matrix=Matrix.Rotation(math.radians(k['pitch'] if side=='Left' else 0),4,'X')@base[foot]
                matrix.translation=goal;foot_delta=matrix@base[foot].inverted()
                for pb in rig.pose.bones:
                    if pb.name==foot or any(p.name==foot for p in pb.parent_recursive):poses[pb.name]=foot_delta@base[pb.name]
            grip=(base['LeftHand'].translation+base['RightHand'].translation)*.5
            carry=Matrix.Translation(grip+Vector((0,-.07,.04))*k['carry'])@Matrix.Rotation(math.radians(-40*k['carry']),4,'Y')@Matrix.Translation(-grip)
            for n in ('weapon_hammer','weapon_hammer_tip'):poses[n]=delta@carry@base[n]
            for side in ('Left','Right'):
                hand=side+'Hand';arm=side+'Arm';forearm=side+'ForeArm'
                matrix=delta@carry@base[hand]
                original=(base[forearm].translation-base[arm].translation).normalized()
                pole=original.lerp(Vector((-1 if side=='Left' else 1,.2,-.7)).normalized(),k['carry'])
                matrix.translation=limb(arm,forearm,hand,matrix.translation,pole)
                hand_delta=matrix@base[hand].inverted()
                for pb in rig.pose.bones:
                    if pb.name==hand or any(p.name==hand for p in pb.parent_recursive):poses[pb.name]=hand_delta@base[pb.name]
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
                            for point in curve.keyframe_points:point.interpolation='LINEAR'
        scene.render.fps=60;scene.frame_start=1;scene.frame_end=count+1;scene.frame_set(1)
        bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;scene.name='IV_'+name
        bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='SCENE',export_anim_scene_split_object=False,export_frame_range=True,export_frame_step=1,export_anim_slide_to_zero=True,export_optimize_animation_size=False,export_extras=True)
        report['clips'][name]=dict(duration=count/60,loop=loop,frames=count+1,max_unreachable_target_m=max_error,file=name+'.glb',slide_weights=weights)
        print('BAKED',name,'max reach error',max_error,flush=True)
    for obj in meshes:scene.collection.objects.link(obj)
    rig.animation_data.action=actions[0];scene.frame_start=1;scene.frame_end=25;scene.frame_set(1)
    scene.name='Iron Vanguard slide entry hold and stand-up'
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'movement.blend'),compress=True)
    report['status']='Slide leg alignment, entry and stand-up revision; visual review pending.'
    report['base_library']=str(source)
    (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
