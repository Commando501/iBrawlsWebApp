"""Author a separate planted diagonal hammer attack from the approved hold.
Run background Blender on an artist checkpoint with -- --output ABSOLUTE_NEW_FOLDER.
"""
import bpy,sys,math,json,argparse
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,linear_keys
from rig_master import update,render
from author_idles import signature,matrix_error,key,rotate_world,quaternion_degrees

# frame, grip-centre XYZ (None = artist hold), weapon XYZ degrees, hip XYZ offset,
# hip yaw, chest pitch/yaw, pole lift.
POSES=[
 (1,None,(0,0,0),(0,0,0),0,(0,0),0),
 (12,(-.02,.245,1.22),(10,0,8),(-.008,-.004,-.025),4,(2,4),.02),
 (34,(-.03,.25,1.52),(55,-12,22),(-.015,-.008,-.035),8,(5,10),.24),
 (41,(-.025,.31,1.55),(32,0,12),(-.008,.008,-.04),3,(-3,3),.25),
 (48,(.06,.40,1.50),(-65,-30,-10),(0,.025,-.05),0,(-8,0),.18),
 (52,(.035,.40,1.42),(-145,-30,-15),(.006,.037,-.06),-3,(-12,-3),.14),
 (55,(.025,.40,1.37),(-175,37,-20),(.008,.04,-.065),-4,(-14,-4),.12),
 (67,(.025,.44,1.33),(-165,-30,-22),(.012,.045,-.085),-5,(-17,-4),.08),
 (80,(.08,.40,1.45),(-70,-30,-8),(.01,.035,-.06),-2,(-12,-2),.12),
 (90,(0,.36,1.28),(-40,0,0),(.006,.03,-.04),0,(-10,0),.01),
 (115,None,(0,0,0),(0,0,0),0,(0,0),0),
]


def slopes(times,values):
    h=[b-a for a,b in zip(times,times[1:])]
    d=[(b-a)/dt for a,b,dt in zip(values,values[1:],h)]
    m=[0.]
    for i in range(1,len(values)-1):
        if d[i-1]*d[i]<=0:m.append(0.)
        else:
            w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1]
            m.append((w1+w2)/(w1/d[i-1]+w2/d[i]))
    return m+[0.]


def sample(times,values,t):
    if t<=times[0]:return values[0]
    if t>=times[-1]:return values[-1]
    i=next(i for i in range(len(times)-1) if times[i]<=t<=times[i+1])
    m=slopes(times,values);h=times[i+1]-times[i];u=(t-times[i])/h
    return (2*u**3-3*u**2+1)*values[i]+(u**3-2*u**2+u)*h*m[i]+(-2*u**3+3*u**2)*values[i+1]+(u**3-u**2)*h*m[i+1]


def pose_rows(mid):
    return [[*(p[1] if p[1] is not None else mid),*p[2],*p[3],p[4],*p[5],p[6]] for p in POSES]


def hinge_seed(upper,lower,target,axis):
    length_a=upper.bone.length;length_b=lower.bone.length
    distance=(target-upper.head).length
    cosine=max(-1.,min(1.,(distance**2-length_a**2-length_b**2)/(2*length_a*length_b)))
    bend=math.acos(cosine)
    rest=(upper.bone.matrix_local.inverted()@lower.bone.matrix_local).to_3x3()
    def error(angle):return abs(Vector((0,1,0)).angle(rest@(Quaternion(axis,angle)@Vector((0,1,0))))-bend)
    best=min((error(math.radians(a)),math.radians(a)) for a in range(0,171,5))
    for step in (1,.1,.01):
        center=best[1];best=min((error(center+math.radians(i*step)),center+math.radians(i*step)) for i in range(-5,6))
    lower.rotation_quaternion=Quaternion(axis,best[1])
    return distance/(length_a+length_b)


def guide_right_elbow(rig,chest_delta,baseline_angle,frame):
    upper=rig.pose.bones['RightArm'];lower=rig.pose.bones['RightForeArm'];con=lower.constraints['Arm IK']
    con.pole_angle=baseline_angle;update()
    if frame in (1,115):return
    axis=(rig.pose.bones['CTRL_Hand_R'].head-upper.head).normalized()
    def radial():
        v=lower.head-upper.head
        return (v-axis*v.dot(axis)).normalized()
    current=radial()
    wanted=chest_delta.to_3x3()@Vector((-.8,0,-1.7));wanted=(wanted-axis*wanted.dot(axis)).normalized()
    signed=lambda a,b:math.atan2(axis.dot(a.cross(b)),a.dot(b))
    con.pole_angle=baseline_angle+.02;update();response=signed(current,radial())/.02
    amount=min(1.,(frame-1)/24,(115-frame)/25);amount=max(0.,amount);amount=amount*amount*(3-2*amount)
    assert abs(response)>.1
    con.pole_angle=baseline_angle+signed(current,wanted)*amount/response;update()


def collision_measure(rig,body,weapon):
    # Only head, torso, pelvis, upper arms and legs: hands intentionally touch the handle.
    if not hasattr(collision_measure,'cached_polygons'):
        excluded={g.index for g in body.vertex_groups if 'Hand' in g.name or 'ForeArm' in g.name or g.name.startswith('DEF_')}
        allowed={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in excluded)<.5}
        collision_measure.cached_polygons=[tuple(p.vertices) for p in body.data.polygons if all(i in allowed for i in p.vertices)]
    deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps);mesh=ev.to_mesh()
    polygons=collision_measure.cached_polygons
    bvh=BVHTree.FromPolygons([body.matrix_world@v.co for v in mesh.vertices],polygons)
    w=bpy.data.objects['IV_Hammer'];wbvh=BVHTree.FromPolygons([w.matrix_world@v.co for v in w.data.vertices],[tuple(p.vertices) for p in w.data.polygons])
    overlaps=bvh.overlap(wbvh);ev.to_mesh_clear()
    return len(overlaps)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--preview',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output
    assert out.is_absolute();out.mkdir(parents=True,exist_ok=True);assert not (out/'attack-candidate.blend').exists()
    r=bpy.data.objects['IV_Rig'];s=bpy.context.scene
    original={a.name:signature(a) for a in bpy.data.actions}
    source=bpy.data.actions['IV_Hammer_ElbowsCorrected'];set_action(r,source);s.frame_set(1);update()
    base={p.name:p.matrix.copy() for p in r.pose.bones};basis={p.name:p.matrix_basis.copy() for p in r.pose.bones}
    baseline_pole=r.pose.bones['RightForeArm'].constraints['Arm IK'].pole_angle
    ctrl=r.pose.bones['CTRL_Hammer'];mid=(base['LeftHand'].translation+base['RightHand'].translation)*.5
    local_mid=base['CTRL_Hammer'].inverted()@mid
    axes={side:Vector((.7513168,0,.6599418) if side=='L' else (.7584819,0,-.6516942)).normalized() for side in ('L','R')}
    action=source.copy();action.name='IV_Hammer_Attack';action.use_fake_user=True;set_action(r,action)
    for prop in ('iv_loop_start','iv_loop_end','iv_loop_seconds','iv_review_status','iv_approved_at_utc'):
        if prop in action:del action[prop]
    action['iv_clip_end']=115;action['iv_review_status']='draft';action['iv_source_hold']=source.name
    action['iv_attack_phases']='Wind-up 1-41; strike 42-55; follow-through 56-67; recovery 68-115'
    times=[p[0] for p in POSES];rows=pose_rows(mid);columns=list(zip(*rows));previous={}
    names=['Hips','Spine02','Spine01','Spine','Head','CTRL_Hammer','CTRL_Elbow_L','CTRL_Elbow_R','LeftForeArm','RightForeArm']
    reaches=[]
    for frame in range(1,116):
        values=[sample(times,col,frame) for col in columns]
        centre=Vector(values[:3]);rx,ry,rz=values[3:6];hip_offset=Vector(values[6:9]);hip_yaw=values[9];pitch,yaw=values[10:12];lift=values[12]
        for name in names:r.pose.bones[name].matrix_basis=basis[name]
        update()
        hips=r.pose.bones['Hips'];m=Matrix.Rotation(math.radians(hip_yaw),4,'Z')@base['Hips'];m.translation=base['Hips'].translation+hip_offset;hips.matrix=m;key(hips,frame,previous);update()
        for name,weight in [('Spine02',.25),('Spine01',.40),('Spine',.35)]:
            pb=r.pose.bones[name];rotate_world(pb,pitch*weight,0,yaw*weight);key(pb,frame,previous);update()
        head=r.pose.bones['Head'];rotate_world(head,-pitch*.4,0,-(hip_yaw+yaw)*.55);key(head,frame,previous);update()
        rot=Matrix.Rotation(math.radians(rz),4,'Z')@Matrix.Rotation(math.radians(rx),4,'X')@Matrix.Rotation(math.radians(ry),4,'Y')@base['CTRL_Hammer']
        rot.translation=centre-rot.to_3x3()@local_mid;ctrl.matrix=rot;key(ctrl,frame,previous);update()
        chest_delta=r.pose.bones['Spine'].matrix@base['Spine'].inverted()
        for side,prefix in [('L','Left'),('R','Right')]:
            pole=r.pose.bones['CTRL_Elbow_'+side];m=chest_delta@base[pole.name]
            m.translation+=Vector(((-.08 if side=='L' else .06)*lift/.25,.06*lift/.25,lift if side=='L' else 0))
            pole.matrix=m;key(pole,frame,previous)
        update()
        reach={}
        for side,prefix in [('L','Left'),('R','Right')]:
            lower=r.pose.bones[prefix+'ForeArm']
            if frame in (1,115):lower.matrix_basis=basis[lower.name]
            else:reach[side]=hinge_seed(r.pose.bones[prefix+'Arm'],lower,r.pose.bones['CTRL_Hand_'+side].head,axes[side])
            key(lower,frame,previous)
        update()
        guide_right_elbow(r,chest_delta,baseline_pole,frame)
        r.pose.bones['RightForeArm'].constraints['Arm IK'].keyframe_insert('pole_angle',frame=frame)
        reaches.append({'frame':frame,**reach})
    linear_keys(action)
    # Exact return to the artist's hold.
    for c in action.layers[0].strips[0].channelbag(action.slots[0]).fcurves:
        if len(c.keyframe_points)>1:c.keyframe_points[-1].co.y=c.keyframe_points[0].co.y
    s.render.engine='BLENDER_WORKBENCH';s.render.resolution_percentage=100
    s.display.shading.light='STUDIO';s.display.shading.color_type='SINGLE';s.display.shading.single_color=(.65,.65,.65)
    stats={'max_hand_error_m':0.,'max_grip_drift_m':0.,'max_foot_drift_m':0.,'max_limb_step_deg':0.,'max_reach_ratio':max(v for row in reaches for k,v in row.items() if k!='frame')}
    contacts={};last=None;first=None;rel0={};feet={};position_errors=[]
    for frame in range(1,116):
        s.frame_set(frame);update();current={}
        if frame==1:
            first={p.name:p.matrix.copy() for p in r.pose.bones};feet={p:r.pose.bones[p+'Foot'].head.copy() for p in ('Left','Right')}
            rel0={p:ctrl.matrix.inverted()@r.pose.bones[p+'Hand'].matrix for p in ('Left','Right')}
        for side,prefix in [('L','Left'),('R','Right')]:
            error=(r.pose.bones[prefix+'Hand'].head-r.pose.bones['CTRL_Hand_'+side].head).length
            if error>.001:position_errors.append((frame,side,error))
            stats['max_hand_error_m']=max(stats['max_hand_error_m'],error)
            relative=ctrl.matrix.inverted()@r.pose.bones[prefix+'Hand'].matrix
            stats['max_grip_drift_m']=max(stats['max_grip_drift_m'],(relative.translation-rel0[prefix].translation).length)
            stats['max_foot_drift_m']=max(stats['max_foot_drift_m'],(r.pose.bones[prefix+'Foot'].head-feet[prefix]).length)
            for part in ('Arm','ForeArm','UpLeg','Leg'):
                name=prefix+part;current[name]=r.pose.bones[name].matrix.to_quaternion()
                if last:stats['max_limb_step_deg']=max(stats['max_limb_step_deg'],quaternion_degrees(last[name].rotation_difference(current[name])))
        last=current
        if frame in times:
            contacts[frame]=collision_measure(r,bpy.data.objects['IV_Body'],bpy.data.objects['IV_Hammer'])
            for label,d in [('front',(2,6,.8)),('side',(6,1,.3))]:render(s,out,f'pose-{frame:03d}-{label}',(0,.25,1.12),d,2.8,(1000,1000))
    stats['return_matrix_error']=max(matrix_error(first[p.name],p.matrix) for p in r.pose.bones)
    stats['start_hold_error']=max(matrix_error(first[n],m) for n,m in base.items())
    report={'metrics':stats,'collisions_at_key_poses':contacts,'reach_failures':position_errors,'original_signatures':original,'note':'Draft diagonal attack; geometry overlap counts exclude intentional hand/forearm grip contact.'}
    (out/'attack-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report['metrics']),flush=True);print('COLLISIONS',contacts,flush=True)
    assert all(signature(bpy.data.actions[n])==v for n,v in original.items())
    # Save the diagnostic draft even if a pose still needs refinement; do not promote it until checks pass.
    s.frame_start=1;s.frame_end=115;s.frame_set(1);update()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'attack-candidate.blend'),compress=True)
    if args.preview:
        folder=out/'frames';folder.mkdir(exist_ok=True)
        for sample_index in range(58):
            frame=1+sample_index*2;s.frame_set(frame);update()
            render(s,folder,f'{sample_index:04d}',(0,.25,1.12),(2,6,.8),2.8,(900,900))

if __name__=='__main__':main()
