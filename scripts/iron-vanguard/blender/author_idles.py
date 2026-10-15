"""Author subtle four-second weapon idles from the artist's corrected holds.
Use background Blender on a saved checkpoint: -- --output ABSOLUTE_NEW_FOLDER.
"""
import bpy,sys,math,json,hashlib,argparse
from pathlib import Path
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,linear_keys
from rig_master import update,render


def curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag=strip.channelbag(slot)
                if bag:
                    yield from bag.fcurves


def signature(action):
    data=[(c.data_path,c.array_index,[(list(k.co),list(k.handle_left),list(k.handle_right),k.interpolation) for k in c.keyframe_points]) for c in curves(action)]
    return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()


def quaternion_degrees(q):return math.degrees(2*math.atan2(math.sqrt(q.x*q.x+q.y*q.y+q.z*q.z),abs(q.w)))


def matrix_error(a,b):return max(abs(a[i][j]-b[i][j]) for i in range(4) for j in range(4))


def key(pb,frame,previous):
    pb.rotation_mode='QUATERNION'
    if pb.name in previous and pb.rotation_quaternion.dot(previous[pb.name])<0:pb.rotation_quaternion.negate()
    previous[pb.name]=pb.rotation_quaternion.copy()
    pb.keyframe_insert('location',frame=frame,group=pb.name)
    pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)


def rotate_world(pb,x,y,z):
    m=pb.matrix.copy();position=m.translation.copy()
    m=Matrix.Rotation(math.radians(z),4,'Z')@Matrix.Rotation(math.radians(y),4,'Y')@Matrix.Rotation(math.radians(x),4,'X')@m
    m.translation=position;pb.matrix=m


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output
    assert out.is_absolute();out.mkdir(parents=True,exist_ok=True)
    destination=out/'idle-candidate.blend';assert not destination.exists()
    r=bpy.data.objects['IV_Rig'];s=bpy.context.scene
    old_signatures={a.name:signature(a) for a in bpy.data.actions}
    report={'period_seconds':4,'fps':60,'playback_frames':[1,240],'duplicate_end_frame':241,'original_action_signatures':old_signatures,'clips':{}}
    s.render.fps=60;s.render.fps_base=1;s.render.resolution_percentage=100
    s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO';s.display.shading.color_type='SINGLE'
    s.display.shading.single_color=(.65,.65,.65)
    for role in ('Hammer','Sword'):
        source=bpy.data.actions['IV_'+role+'_ElbowsCorrected'];set_action(r,source);s.frame_set(1);update()
        base_m={p.name:p.matrix.copy() for p in r.pose.bones}
        base_b={p.name:p.matrix_basis.copy() for p in r.pose.bones}
        action=source.copy();action.name='IV_'+role+'_Idle';action.use_fake_user=True;set_action(r,action)
        action['iv_loop_start']=1;action['iv_loop_end']=240;action['iv_loop_seconds']=4.
        action['iv_source_hold']=source.name
        names=['Hips','Spine02','Spine01','Spine','Head','CTRL_'+role,'CTRL_Elbow_L','CTRL_Elbow_R']
        if role=='Sword':names.append('CTRL_Hand_L')
        previous={}
        # Dense 60-Hz samples retain the authored periodic motion exactly and remain bake-ready.
        for frame in range(1,242):
            phase=math.tau*(frame-1)/240;breath=.5*(1-math.cos(phase));sway=math.sin(phase)
            for name in names:r.pose.bones[name].matrix_basis=base_b[name]
            update()
            hips=r.pose.bones['Hips'];m=base_m['Hips'].copy()
            position=m.translation+Vector((.005*sway,.0015*breath,-.002*breath))
            m=Matrix.Rotation(math.radians(.18*sway),4,'Y')@m;m.translation=position
            hips.matrix=m;key(hips,frame,previous);update()
            for name,factor in [('Spine02',.25),('Spine01',.45),('Spine',.30)]:
                pb=r.pose.bones[name];rotate_world(pb,-.8*factor*breath,-.25*factor*sway,.18*factor*sway)
                key(pb,frame,previous);update()
            chest_delta=r.pose.bones['Spine'].matrix@base_m['Spine'].inverted()
            head=r.pose.bones['Head'];rotate_world(head,.55*breath,.12*sway,-.12*sway);key(head,frame,previous);update()
            # Weapon and poles share torso motion; attachment offsets and finger curls stay fixed.
            for name in ['CTRL_'+role,'CTRL_Elbow_L','CTRL_Elbow_R']:
                pb=r.pose.bones[name];pb.matrix=chest_delta@base_m[name];key(pb,frame,previous)
            if role=='Sword':
                pb=r.pose.bones['CTRL_Hand_L'];pb.matrix=chest_delta@base_m[pb.name]
                m=pb.matrix.copy();m.translation+=Vector((.0015*sway,0,-.001*breath));pb.matrix=m;key(pb,frame,previous)
            update()
        linear_keys(action)
        varied_paths={f'pose.bones["{n}"].{path}' for n in names for path in ('location','rotation_quaternion')}
        for c in curves(action):
            if c.data_path in varied_paths:
                # Close the duplicate endpoint exactly, avoiding accumulated matrix conversion roundoff.
                c.keyframe_points[-1].co.y=c.keyframe_points[0].co.y
                modifier=c.modifiers.new('CYCLES');modifier.mode_before='REPEAT';modifier.mode_after='REPEAT'
        action.asset_mark();action.asset_data.description='Four-second subtle '+role.lower()+' idle from artist hold; foot plant and grip attachment verified.'
        s.frame_set(1);update()
        first={p.name:p.matrix.copy() for p in r.pose.bones}
        first_feet={prefix:r.pose.bones[prefix+'Foot'].matrix.copy() for prefix in ('Left','Right')}
        ctrl=r.pose.bones['CTRL_'+role]
        rel0={side:ctrl.matrix.inverted()@r.pose.bones[prefix+'Hand'].matrix for side,prefix in [('L','Left'),('R','Right')] if side=='R' or role=='Hammer'}
        stats={'max_hand_target_error_m':0.,'max_hand_weapon_drift_m':0.,'max_grip_rotation_drift_deg':0.,'max_foot_drift_m':0.,'max_joint_step_deg':0.,'max_bone_scale_error':0.,'max_root_change':0.}
        last=None;hip_positions=[];weapon_positions=[]
        for frame in range(1,242):
            s.frame_set(frame);update();current={}
            for side,prefix in [('L','Left'),('R','Right')]:
                hand=r.pose.bones[prefix+'Hand'];target=r.pose.bones['CTRL_Hand_'+side]
                stats['max_hand_target_error_m']=max(stats['max_hand_target_error_m'],(hand.head-target.head).length)
                stats['max_foot_drift_m']=max(stats['max_foot_drift_m'],(r.pose.bones[prefix+'Foot'].head-first_feet[prefix].translation).length)
                if side in rel0:
                    relative=ctrl.matrix.inverted()@hand.matrix
                    stats['max_hand_weapon_drift_m']=max(stats['max_hand_weapon_drift_m'],(relative.translation-rel0[side].translation).length)
                    stats['max_grip_rotation_drift_deg']=max(stats['max_grip_rotation_drift_deg'],math.degrees(relative.to_quaternion().rotation_difference(rel0[side].to_quaternion()).angle))
                for part in ('Arm','ForeArm','UpLeg','Leg'):
                    name=prefix+part;current[name]=r.pose.bones[name].matrix.to_quaternion()
                    if last:stats['max_joint_step_deg']=max(stats['max_joint_step_deg'],quaternion_degrees(last[name].rotation_difference(current[name])))
            stats['max_bone_scale_error']=max(stats['max_bone_scale_error'],max(abs(v-1) for p in r.pose.bones for v in p.matrix.to_scale()))
            stats['max_root_change']=max(stats['max_root_change'],matrix_error(r.pose.bones['root'].matrix,first['root']))
            last=current;hip_positions.append(list(r.pose.bones['Hips'].head));weapon_positions.append(list(ctrl.head))
        stats['loop_matrix_error']=max(matrix_error(first[p.name],p.matrix) for p in r.pose.bones)
        stats['start_hold_position_error_m']=max((first[n].translation-base_m[n].translation).length for n in first)
        stats['hips_peak_to_peak_m']=[max(p[i] for p in hip_positions)-min(p[i] for p in hip_positions) for i in range(3)]
        stats['weapon_peak_to_peak_m']=[max(p[i] for p in weapon_positions)-min(p[i] for p in weapon_positions) for i in range(3)]
        assert stats['hips_peak_to_peak_m'][0]>.009,stats
        assert stats['weapon_peak_to_peak_m'][2]>.002,stats
        assert stats['max_hand_target_error_m']<.0001,stats
        assert stats['max_hand_weapon_drift_m']<.0001,stats
        assert stats['max_grip_rotation_drift_deg']<.1,stats
        assert stats['max_foot_drift_m']<.0001,stats
        assert stats['max_joint_step_deg']<1,stats
        assert stats['max_bone_scale_error']<1e-4,stats
        assert stats['loop_matrix_error']<1e-4,stats
        assert stats['start_hold_position_error_m']<.0001,stats
        report['clips'][role]=stats
        print(role, json.dumps(stats),flush=True)
        # Render a sampled full-loop preview plus side views at maximum inhale.
        preview=out/(role.lower()+'-frames');preview.mkdir(exist_ok=True)
        for sample in range(96):
            f=1+sample*2.5;s.frame_set(int(f),subframe=f-int(f));update()
            render(s,preview,f'{sample:04d}',(0,.08,1.00),(2,6,.6),2.25,(800,900))
        s.frame_set(121);update()
        for label,d in [('right',(6,1,.3)),('left',(-6,1,.3))]:render(s,out,role.lower()+'-inhale-'+label,(0,.05,1.30),d,1.15,(900,900))
    assert all(signature(bpy.data.actions[n])==digest for n,digest in old_signatures.items()),'Original action changed'
    set_action(r,bpy.data.actions['IV_Hammer_Idle']);s.frame_set(1);update();s.frame_start=1;s.frame_end=240
    s['authoring_stage']='v020 first subtle hammer/sword idle loops; attack arcs and mesh polish remain'
    bpy.ops.wm.save_as_mainfile(filepath=str(destination),compress=True)
    (out/'idle-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('IDLE_COMPLETE',json.dumps(report['clips']),flush=True)

if __name__=='__main__':main()
