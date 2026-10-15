"""Refine saved Iron Vanguard holding poses; retain input master and user weapon fits."""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,key_pose,linear_keys
from rig_master import update,render

def aim_elbow(rig,side,desired):
    prefix='Right' if side=='R' else 'Left'
    shoulder=rig.pose.bones[prefix+'Arm'].head.copy()
    wrist=rig.pose.bones['CTRL_Hand_'+side].matrix.translation.copy()
    axis=(wrist-shoulder).normalized()
    u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u).normalized()
    pole=rig.pose.bones['CTRL_Elbow_'+side];base=pole.matrix.copy()
    best=(float('inf'),None)
    for step in range(120):
        angle=step*math.tau/120
        m=base.copy();m.translation=(shoulder+wrist)*.5+.45*(u*math.cos(angle)+v*math.sin(angle))
        pole.matrix=m;update()
        err=(rig.pose.bones[prefix+'ForeArm'].head-Vector(desired)).length
        if err<best[0]:best=(err,m.copy())
    pole.matrix=best[1];update()

def rotate_world(pb,axis,degrees):
    m=pb.matrix.copy();p=m.translation.copy()
    m=Matrix.Rotation(math.radians(degrees),4,axis)@m;m.translation=p
    pb.matrix=m;update()

def main():
    assert bpy.app.background
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);src=args.source.resolve();out=args.output.resolve()
    dest=out/'iron-vanguard-master.blend'
    if dest.exists():raise FileExistsError(dest)
    out.mkdir(parents=True,exist_ok=True);digest=hashlib.sha256(src.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(src));s=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=s
    r=bpy.data.objects['IV_Rig'];report={'source':str(src),'source_sha256':digest,'poses':{},'weapon_fit_preserved':True}
    fits={n:bpy.data.objects[n].matrix_basis.copy() for n in ['IV_Hammer','IV_Sword']}
    for role in ['Hammer','Sword']:
        original=bpy.data.actions['IV_'+role+'_Grip'];set_action(r,original);s.frame_set(1);update()
        before_weapon=bpy.data.objects['IV_'+role].matrix_world.copy()
        render(s,out,role.lower()+'-before',(0,.12,1.30),(2,6,1),1.55,(1100,1100))
        action=original.copy();action.name='IV_'+role+'_NaturalHold';action.use_fake_user=True;set_action(r,action)
        # Small chest turn and forward engagement distributed over the spine.
        for name,pitch,yaw in [('Spine02',-1.0,1.0 if role=='Hammer' else -1.5),('Spine01',-1.5,1.5 if role=='Hammer' else -2.0),('Spine',-.5,.5 if role=='Hammer' else -.5)]:
            rotate_world(r.pose.bones[name],'X',pitch);rotate_world(r.pose.bones[name],'Z',yaw)
        # Settle and slightly protract the clavicles without moving the weapon targets.
        for side,prefix,sign in [('R','Right',1),('L','Left',-1)]:
            rotate_world(r.pose.bones[prefix+'Shoulder'],'Y',sign*2.0)
            rotate_world(r.pose.bones[prefix+'Shoulder'],'Z',sign*3.0)
        if role=='Sword':
            p=r.pose.bones['CTRL_Hand_L'];m=p.matrix.copy();m.translation=Vector((-.28,.19,1.12));p.matrix=m
            h=r.pose.bones['CTRL_Hand_L'];h['grip']=.32;h['thumb_opposition']=.25
            for prop in ['grip','thumb_opposition']:h.keyframe_insert(data_path=f'["{prop}"]',frame=1)
        update()
        for side,desired in [('R',(.32,.045,1.25)),('L',(-.29,.07,1.26) if role=='Hammer' else (-.34,.015,1.26))]:aim_elbow(r,side,desired)
        # Keep the gaze level and directed ahead after the chest adjustment.
        head=r.pose.bones['Head'];head_basis=r.data.bones['Head'].matrix_local.to_quaternion()
        hm=head_basis.to_matrix().to_4x4();hm.translation=head.matrix.translation;head.matrix=hm;update()
        key_pose(r,1,[p.name for p in r.pose.bones if not p.name.startswith(('DEF_','MCH_'))],{})
        linear_keys(action);s.frame_set(1);update()
        record={'action':action.name,'weapon_world_matrix_max_error':max(abs(before_weapon[i][j]-bpy.data.objects['IV_'+role].matrix_world[i][j]) for i in range(4) for j in range(4)),'arms':{}}
        assert record['weapon_world_matrix_max_error']<1e-6
        for side,prefix in [('R','Right'),('L','Left')]:
            a=r.pose.bones[prefix+'Arm'].head;b=r.pose.bones[prefix+'ForeArm'].head;c=r.pose.bones[prefix+'Hand'].head
            err=(c-r.pose.bones['CTRL_Hand_'+side].matrix.translation).length
            record['arms'][side]={'target_error_m':err,'elbow_interior_angle_degrees':math.degrees((a-b).angle(c-b)),'elbow':list(b),'wrist':list(c)}
            assert err<.0005,(role,side,err)
        report['poses'][role]=record
        for label,direction in [('front',(0,6,.45)),('three-quarter',(2,6,1)),('side',(6,.8,.5)),('back',(2,-6,.5))]:
            render(s,out,role.lower()+'-'+label,(0,.12,1.30),direction,1.55,(1100,1100))
        for side,prefix in [('R','Right'),('L','Left')]:
            render(s,out,role.lower()+'-hand-'+side,r.pose.bones[prefix+'Hand'].head,(2,3,2),.42,(900,900))
    for n,m in fits.items():assert max(abs(m[i][j]-bpy.data.objects[n].matrix_basis[i][j]) for i in range(4) for j in range(4))<1e-7
    text=bpy.data.texts.get('IV_RIG_TOOLS.py');text.clear();text.write((Path(__file__).parent/'rig_ui.py').read_text(encoding='utf-8-sig'))
    notes=bpy.data.texts.get('START_HERE');notes.write('\nNATURAL HOLDS v009\nChoose Hammer natural hold or Sword natural hold in the iBrawls sidebar.\nOriginal grip actions and user mesh placement corrections are retained.\nNew holds are keyed at frame 1; duplicate before further animation.\n')
    set_action(r,bpy.data.actions['IV_Hammer_NaturalHold']);s.frame_set(1);update()
    render(s,out,'master-overview',(0,.12,1.10),(2,6,1),2.3,(1100,1100))
    s['stage']='Upper body natural holds refined from user-saved v008 weapon fits.'
    assert hashlib.sha256(src.read_bytes()).hexdigest()==digest
    bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
    report['destination']=str(dest);report['master_sha256']=hashlib.sha256(dest.read_bytes()).hexdigest()
    (out/'hold-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':main()
