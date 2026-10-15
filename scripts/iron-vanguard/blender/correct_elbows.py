"""Correct IK elbow bend seeds in artist holds; retain hand/weapon placement.
Run background Blender on a backed-up artist file, with -- --output NEW_DIRECTORY.
"""
import bpy,math,json,sys,argparse
from pathlib import Path
from mathutils import Vector,Quaternion
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action
from rig_master import update,render


def matrix_error(a,b):return max(abs(a[i][j]-b[i][j]) for i in range(4) for j in range(4))


def correct_side(rig,side,axis,frame):
    prefix='Left' if side=='L' else 'Right'
    upper=rig.pose.bones[prefix+'Arm'];lower=rig.pose.bones[prefix+'ForeArm']
    elbow=lower.head.copy();wrist=rig.pose.bones[prefix+'Hand'].matrix.copy()
    bend=(lower.head-upper.head).normalized().angle((lower.tail-lower.head).normalized())
    rest=(upper.bone.matrix_local.inverted()@lower.bone.matrix_local).to_3x3()
    axis=Vector(axis).normalized()
    # Match the current geometric flexion with a positive anatomical bend seed.
    # A seed matched to chain reach avoids the solver reverting toward its near-straight rest bias.
    def bend_error(angle):
        direction=rest@(Quaternion(axis,angle)@Vector((0,1,0)))
        return abs(Vector((0,1,0)).angle(direction)-bend)
    best=min((bend_error(math.radians(i)),math.radians(i)) for i in range(171))
    for step in (.1,.01,.001):
        center=best[1]
        best=min((bend_error(center+math.radians(i*step)),center+math.radians(i*step)) for i in range(-10,11))
    lower.rotation_mode='QUATERNION';lower.rotation_quaternion=Quaternion(axis,best[1])
    lower.keyframe_insert('rotation_quaternion',frame=frame)
    con=lower.constraints['Arm IK'];update()
    # Calibrate pole roll against the artist's elbow position, not a nearly straight bind pose.
    best=(1e9,con.pole_angle)
    for deg in range(-180,180,5):
        con.pole_angle=math.radians(deg);update();error=(lower.head-elbow).length
        if error<best[0]:best=(error,con.pole_angle)
    for step in (.1,.01,.001):
        center=best[1]
        for i in range(-50 if step==.1 else -10,51 if step==.1 else 11):
            con.pole_angle=center+math.radians(i*step);update();error=(lower.head-elbow).length
            if error<best[0]:best=(error,con.pole_angle)
    con.pole_angle=best[1];con.keyframe_insert('pole_angle',frame=frame);update()
    rel=(upper.bone.matrix_local.inverted()@lower.bone.matrix_local).inverted()@(upper.matrix.inverted()@lower.matrix)
    report={'elbow_position_change_m':(lower.head-elbow).length,
            'wrist_position_change_m':(rig.pose.bones[prefix+'Hand'].head-wrist.translation).length,
            'wrist_rotation_change_deg':math.degrees(wrist.to_quaternion().rotation_difference(rig.pose.bones[prefix+'Hand'].matrix.to_quaternion()).angle),
            'seed_axis':list(axis),'result_bend_axis':list(rel.to_quaternion().axis),
            'pole_angle_degrees':math.degrees(con.pole_angle),
            'seed_degrees':math.degrees(lower.rotation_quaternion.angle)}
    assert report['elbow_position_change_m']<.0002,report
    assert report['wrist_position_change_m']<.0001,report
    assert report['wrist_rotation_change_deg']<.1,report
    assert rel.to_quaternion().axis.dot(axis)>.98,report
    return report


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output
    assert out.is_absolute(),'Use an absolute output path; Blender may change the working directory'
    out.mkdir(parents=True,exist_ok=True);destination=out/'elbow-candidate.blend'
    assert not destination.exists(),'Never overwrite a candidate'
    r=bpy.data.objects['IV_Rig'];s=bpy.context.scene
    current_action=r.animation_data.action;current_frame=s.frame_current
    original_poles={side:r.pose.bones[prefix+'ForeArm'].constraints['Arm IK'].pole_angle for side,prefix in [('L','Left'),('R','Right')]}
    source=bpy.data.actions['IV_SourceMotion_Root']
    set_action(r,source);s.frame_set(1);update()
    axes={};source_before={}
    for side,prefix in [('L','Left'),('R','Right')]:
        a=r.pose.bones[prefix+'Arm'];f=r.pose.bones[prefix+'ForeArm']
        rel=(a.bone.matrix_local.inverted()@f.bone.matrix_local).inverted()@(a.matrix.inverted()@f.matrix)
        axis=rel.to_quaternion().axis;axis.y=0;axes[side]=axis.normalized()
    for frame in range(1,240):
        s.frame_set(frame);update();source_before[frame]={p.name:p.matrix.copy() for p in r.pose.bones if not p.name.startswith(('MCH','CTRL','DEF'))}
    # Explicit baseline keys prevent pole roll leaking between the corrected and historical actions.
    baseline_actions=[]
    for action in list(bpy.data.actions):
        if not action.name.startswith('IV_'):continue
        set_action(r,action)
        for side,prefix in [('L','Left'),('R','Right')]:
            con=r.pose.bones[prefix+'ForeArm'].constraints['Arm IK']
            con.pole_angle=original_poles[side];con.keyframe_insert('pole_angle',frame=1)
        baseline_actions.append(action.name)
    s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO'
    s.display.shading.color_type='SINGLE';s.display.shading.single_color=(.65,.65,.65)
    s.render.resolution_percentage=100
    reports={};new_actions=[]
    for role,action_name in [('Hammer','IV_Hammer_Posing'),('Sword',current_action.name)]:
        original=bpy.data.actions[action_name];original.use_fake_user=True
        set_action(r,original);s.frame_set(current_frame if role=='Sword' else 1);update()
        frame=s.frame_current
        hands={p:r.pose.bones[p+'Hand'].matrix.copy() for p in ('Left','Right')}
        weapons={n:bpy.data.objects[n].matrix_world.copy() for n in ('IV_Hammer','IV_Sword')}
        render(s,out,role.lower()+'-before',(0,.05,1.30),(2,6,1),1.15,(1000,1000))
        action=original.copy();action.name='IV_'+role+'_ElbowsCorrected';action.use_fake_user=True
        set_action(r,action);update();new_actions.append(action.name)
        report={side:correct_side(r,side,axes[side],frame) for side in ('L','R')}
        s.frame_set(frame+1);s.frame_set(frame);update()
        report['weapon_matrix_change']=max(matrix_error(weapons[n],bpy.data.objects[n].matrix_world) for n in weapons)
        report['hand_position_change_m']=max((hands[p].translation-r.pose.bones[p+'Hand'].head).length for p in hands)
        assert report['weapon_matrix_change']<1e-6
        assert report['hand_position_change_m']<.0001
        for label,direction in [('front',(2,6,1)),('right',(6,1,.3)),('left',(-6,1,.3))]:
            render(s,out,role.lower()+'-after-'+label,(0,.05,1.30),direction,1.15,(1000,1000))
        reports[role]=report
    # Verify the original source clip with IK disabled has no pose changes.
    set_action(r,source);err=0.
    for frame in range(1,240):
        s.frame_set(frame);update()
        err=max(err,max(matrix_error(matrix,r.pose.bones[name].matrix) for name,matrix in source_before[frame].items()))
    assert err<1e-5,err
    set_action(r,bpy.data.actions['IV_Sword_ElbowsCorrected']);s.frame_set(current_frame);update()
    result={'holds':reports,'source_pose_max_error':err,'baseline_pole_actions':baseline_actions,'new_actions':new_actions,
            'note':'Corrects elbow bend orientation only; finger deformation and large animation arcs still require review.'}
    (out/'elbow-validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    bpy.ops.wm.save_as_mainfile(filepath=str(destination),compress=True)
    print(json.dumps(result))

if __name__=='__main__':main()
