"""Upgrade a user-edited master with finger skinning, resizable grips, torso cleanup and IK.
Never runs the intake builder and never overwrites an existing master.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action, set_pose, key_pose, linear_keys

ROOT=Path(__file__).resolve().parents[3]
I=Matrix.Identity(4)


def update():
    rig=bpy.data.objects.get('IV_Rig')
    if rig:rig.update_tag()
    bpy.context.view_layer.update()


def prop(owner,name,value,lo=0,hi=1,description=''):
    owner[name]=value
    owner.id_properties_ui(name).update(min=lo,max=hi,soft_min=lo,soft_max=hi,description=description)


def driver(owner,path,rig,property_path,expression,index=None):
    curve=owner.driver_add(path) if index is None else owner.driver_add(path,index)
    d=curve.driver;d.type='SCRIPTED';d.expression=expression
    var=d.variables.new();var.name='v';var.type='SINGLE_PROP'
    var.targets[0].id=rig;var.targets[0].data_path=property_path
    return d


def new_bone(rig,name,head,tail,parent='root',deform=False,roll=None):
    b=rig.data.edit_bones.new(name);b.head=head;b.tail=tail
    b.parent=rig.data.edit_bones[parent] if parent else None
    b.use_deform=deform
    if roll is not None:b.align_roll(Vector(roll))
    return b


def matrix_bone(rig,name,matrix,length=.08,parent='root'):
    b=new_bone(rig,name,matrix.translation,matrix.translation+matrix.to_3x3()@Vector((0,length,0)),parent)
    b.matrix=matrix;b.length=length
    return b


def render(scene,out,name,center=(0,0,1),direction=(3,6,2),scale=2.7,size=(1100,1100)):
    cam=scene.camera;cam.location=Vector(center)+Vector(direction)
    cam.rotation_euler=(Vector(center)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=scale
    scene.render.resolution_x=size[0];scene.render.resolution_y=size[1]
    scene.render.filepath=str(out/(name+'.png'));update()
    bpy.ops.render.render(write_still=True)


def smoothstep(a,b,x):
    t=min(1,max(0,(x-a)/(b-a)))
    return t*t*(3-2*t)


def weights_array(body,n):
    w=np.zeros((len(body.data.vertices),n),dtype=np.float32)
    for v in body.data.vertices:
        for g in v.groups:w[v.index,g.group]=g.weight
    return w


def apply_weights(body,indices,weights):
    groups=list(body.vertex_groups)
    for vi in indices:
        row=weights[vi]
        best=np.argsort(row)[-4:]
        best=[int(j) for j in best if row[j]>1e-6]
        total=sum(float(row[j]) for j in best)
        if total<=0:raise RuntimeError('Unweighted vertex')
        for g in list(body.data.vertices[vi].groups):groups[g.group].remove([int(vi)])
        for j in best:groups[j].add([int(vi)],float(row[j]/total),'REPLACE')


def smooth_torso(body,rig,out):
    coords=np.array([v.co[:] for v in body.data.vertices])
    w=weights_array(body,len(body.vertex_groups))
    np.savez_compressed(out/'original-skin-weights.npz',weights=w,coordinates=coords)
    trunk=[body.vertex_groups[n].index for n in ['Hips','Spine02','Spine01','Spine','neck']]
    mask=(coords[:,2]>.98)&(coords[:,2]<1.85)&(np.abs(coords[:,0])<.68)
    ids=np.flatnonzero(mask)
    tree=KDTree(len(coords))
    for i,p in enumerate(coords):tree.insert(p,i)
    tree.balance()
    neighbors=np.zeros((len(ids),48),dtype=np.int32);factors=np.zeros((len(ids),48),dtype=np.float32)
    for k,i in enumerate(ids):
        for j,(_,idx,dist) in enumerate(tree.find_n(coords[i],48)):
            neighbors[k,j]=idx
            factors[k,j]=math.exp(-((dist/.022)**2)) if dist<.04 else 0
    factors/=factors.sum(1)[:,None]
    before=float(np.mean(np.sum((w[ids,None,:]-w[neighbors])**2,axis=2)*factors))
    original=w.copy()
    # The helmet should move rigidly with Head; fade into the flexible neck.
    head_group=body.vertex_groups['Head'].index
    for i in np.flatnonzero(coords[:,2]>1.53):
        t=smoothstep(1.53,1.62,coords[i,2])
        w[i]*=1-t;w[i,head_group]+=t
    for iteration in range(30):
        average=(w[neighbors]*factors[:,:,None]).sum(1)
        w[ids]=.25*w[ids]+.75*average
    # Fade the cleanup at region boundaries so no new skinning seam is introduced.
    for i in ids:
        influence=smoothstep(.98,1.04,coords[i,2])*(1-smoothstep(.62,.68,abs(coords[i,0])))
        w[i]=original[i]*(1-influence)+w[i]*influence
    apply_weights(body,ids,w)
    final=weights_array(body,len(body.vertex_groups))
    after=float(np.mean(np.sum((final[ids,None,:]-final[neighbors])**2,axis=2)*factors))
    return {'vertices_smoothed':len(ids),'neighbor_weight_variation_before':before,
            'neighbor_weight_variation_after':after,'backup':'original-skin-weights.npz'}


def main():
    if not bpy.app.background:raise RuntimeError('Run in a separate background Blender process.')
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',type=Path,default=ROOT/'output/iron-vanguard/master-v004/iron-vanguard-master.blend')
    ap.add_argument('--output',type=Path,default=ROOT/'output/iron-vanguard/master-v005')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    source=args.source.resolve();out=args.output.resolve();dest=out/'iron-vanguard-master.blend'
    if dest.exists():raise FileExistsError(f'Preserving existing master: {dest}')
    out.mkdir(parents=True,exist_ok=True)
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=scene
    rig=bpy.data.objects['IV_Rig'];body=bpy.data.objects['IV_Body']
    if 'CTRL_Hand_R' in rig.data.bones:raise RuntimeError('This master already has the rigging upgrade.')
    report={'source':str(source),'source_sha256':digest,'destination':str(dest)}
    weapon_col=bpy.data.collections['04_Weapon_Prep']
    # Before/after evidence uses the same source frame and camera.
    weapon_col.hide_render=True
    set_action(rig,bpy.data.actions['IV_SourceMotion_Root']);scene.frame_set(97);update()
    render(scene,out,'torso-before',rig.pose.bones['Spine'].matrix.translation,(2,6,1),.90)
    set_action(rig,bpy.data.actions['IV_Bind']);scene.frame_set(1);update()
    report['torso_cleanup']=smooth_torso(body,rig,out)
    original_names=[b.name for b in rig.data.bones]
    original_rest={b.name:b.matrix_local.copy() for b in rig.data.bones}
    hands={s:rig.data.bones[n+'Hand'].head_local.copy() for s,n in [('R','Right'),('L','Left')]}
    # Bake the USER'S nonuniform mesh scales into geometry and corresponding markers.
    # New size controls start at 1, so the user's selected dimensions are the baseline.
    report['weapons']={}
    marker_positions={}
    for role in ['Hammer','Sword']:
        obj=bpy.data.objects['IV_'+role];parent=obj.parent
        matrix=obj.matrix_basis.copy()
        before=[obj.matrix_world@Vector(c) for c in obj.bound_box]
        obj.data.transform(matrix);obj.matrix_basis=I
        marker_positions[role]={}
        for marker in list(parent.children):
            if marker.type=='EMPTY':
                marker.location=matrix@marker.location
                marker_positions[role][marker.name]=marker.location.copy()
        report['weapons'][role]={'baked_user_mesh_transform':list(map(list,matrix)),
            'baseline_world_size':[max(v[i] for v in before)-min(v[i] for v in before) for i in range(3)]}
    bpy.context.view_layer.objects.active=rig
    for o in scene.objects:o.select_set(False)
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    digit_specs={}
    # Anatomical coordinates are measured relative to each wrist: u along fingers, v toward thumb, z dorsal.
    for side in ['R','L']:
        sign=1 if side=='R' else -1;hand='RightHand' if side=='R' else 'LeftHand'
        ratio=1 if side=='R' else .93
        ys=[.035,.007,-.023,-.049] if side=='R' else [.032,.003,-.026,-.052]
        specs={}
        for digit,start,end,y in zip(['Index','Middle','Ring','Pinky'],[.100,.100,.092,.082],[.207,.216,.199,.178],ys):
            a=start*ratio;d=(end-start)*ratio
            specs[digit]=[Vector((sign*x,y,z))+hands[side] for x,z in
                          [(a,.006),(a+d*.43,.009),(a+d*.76,.002),(a+d,-.006)]]
        specs['Thumb']=[hands[side]+Vector((sign*x*ratio,y,z)) for x,y,z in
                        [(.038,.035,-.009),(.068,.061,-.005),(.103,.071,.002),(.133,.067,.006)]]
        digit_specs[side]=specs
        for digit,pts in specs.items():
            parent=hand
            for j in range(3):
                name=f'DEF_{digit}_{j+1:02d}_{side}'
                new_bone(rig,name,pts[j],pts[j+1],parent,True,(0,0,1))
                parent=name
        # A socket's +Y points along the fingers, +Z along the handle/knuckle row.
        u=Vector((sign,0,0));v=Vector((0,1,0));w=u.cross(v)
        socket=rig.data.edit_bones['weapon_socket_'+side.lower()]
        mat=Matrix((w,u,v)).transposed().to_4x4()
        mat.translation=hands[side]+Vector((sign*.106,-.002,-.030))
        socket.matrix=mat;socket.length=.06

    for side,prefix in [('R','Right'),('L','Left')]:
        for limb,upper,lower,end in [('Hand','Arm','ForeArm','Hand'),('Foot','UpLeg','Leg','Foot')]:
            target=rig.data.edit_bones[prefix+end]
            matrix_bone(rig,'CTRL_'+limb+'_'+side,target.matrix.copy(),.10)
            a=rig.data.edit_bones[prefix+upper].head.copy()
            b=rig.data.edit_bones[prefix+lower].head.copy()
            c=target.head.copy();axis=(c-a).normalized()
            normal=b-(a+axis*(b-a).dot(axis))
            if normal.length<.001:normal=Vector((0,1,0))
            pole=b+normal.normalized()*.45
            matrix_bone(rig,'CTRL_'+('Elbow' if limb=='Hand' else 'Knee')+'_'+side,Matrix.Translation(pole),.08)
    for role in ['Hammer','Sword']:
        matrix_bone(rig,'CTRL_'+role,I,.16)
        for side in (['R','L'] if role=='Hammer' else ['R']):
            offset=Vector((0,0,0)) if side=='R' else marker_positions['Hammer']['hammer_grip_support']
            anchor=Matrix.Translation(offset)
            matrix_bone(rig,'MCH_'+role+'_Anchor_'+side,anchor,.05,'CTRL_'+role)
            socket=rig.data.edit_bones['weapon_socket_'+side.lower()].matrix.copy()
            hand=rig.data.edit_bones['RightHand' if side=='R' else 'LeftHand'].matrix.copy()
            target=anchor@socket.inverted()@hand
            matrix_bone(rig,'MCH_'+role+'_Hand_'+side,target,.08,'MCH_'+role+'_Anchor_'+side)
    bpy.ops.object.mode_set(mode='OBJECT')
    for name in rig.data.bones.keys():
        rig.pose.bones[name].rotation_mode='QUATERNION'
    controls=rig.data.collections.new('Animator Controls')
    fingers=rig.data.collections.new('Fingers')
    mechanisms=rig.data.collections.new('Grip Mechanisms');mechanisms.is_visible=False
    for b in rig.data.bones:
        if b.name.startswith('CTRL_'):controls.assign(b);b.color.palette='THEME04'
        if b.name.startswith('DEF_'):fingers.assign(b);b.color.palette='THEME03'
        if b.name.startswith('MCH_'):mechanisms.assign(b)

    # Transfer only existing hand weights, preserving wrist/forearm contributions.
    for side in ['R','L']:
        sign=1 if side=='R' else -1
        hand_group=body.vertex_groups['RightHand' if side=='R' else 'LeftHand']
        digit_groups={}
        for digit in digit_specs[side]:
            digit_groups[digit]=[body.vertex_groups.new(name=f'DEF_{digit}_{j+1:02d}_{side}') for j in range(3)]
        count=0
        for vertex in body.data.vertices:
            weight=next((g.weight for g in vertex.groups if g.group==hand_group.index),0)
            if weight<.05:continue
            p=vertex.co;relative=p-hands[side];x=relative.x*sign;y=relative.y
            if y>.052 and x>.025:
                digit='Thumb'
            else:
                digit=min(['Index','Middle','Ring','Pinky'],key=lambda d:abs(y-(digit_specs[side][d][0].y-hands[side].y)))
            pts=digit_specs[side][digit]
            if digit=='Thumb':
                direction=(pts[1]-pts[0]).normalized()
                progress=(p-pts[0]).dot(direction)
                amount=smoothstep(-.004,.025,progress)*smoothstep(.036,.056,y)
            else:
                base=(pts[0].x-hands[side].x)*sign
                amount=smoothstep(base-.022,base+.012,x)
            if amount<.001:continue
            # Blend adjacent phalanges at their shared joint; avoid nearest-bone discontinuities.
            joints=[(q-hands[side]).x*sign for q in pts]
            dist=x
            w=[1-smoothstep(joints[1]-.010,joints[1]+.010,dist),
               smoothstep(joints[1]-.010,joints[1]+.010,dist)*(1-smoothstep(joints[2]-.009,joints[2]+.009,dist)),
               smoothstep(joints[2]-.009,joints[2]+.009,dist)]
            total=sum(w)
            hand_group.add([vertex.index],weight*(1-amount),'REPLACE')
            for group,value in zip(digit_groups[digit],w):
                if value>1e-5:group.add([vertex.index],weight*amount*value/total,'REPLACE')
            count+=1
        report['finger_vertices_'+side]=count

    prop(rig,'weapon_mode',1,0,2,'0 free hands, 1 hammer, 2 sword. Choose carry actions to load authored poses.')
    for name in ['arm_ik_R','arm_ik_L','leg_ik_R','leg_ik_L']:
        prop(rig,name,0.0,description='IK influence: 0 FK/source animation, 1 animator control.')
    for role in ['Hammer','Sword']:
        for axis in 'xyz':
            prop(rig,role.lower()+'_size_'+axis,1.0,.5,2.0,'Resize weapon and grip anchors together from the user-approved baseline.')
    for side in ['R','L']:
        ctrl=rig.pose.bones['CTRL_Hand_'+side]
        prop(ctrl,'grip',0.0)
        for digit in digit_specs[side]:
            prop(ctrl,digit.lower()+'_curl',0.0,-.5,.5,'Per-finger adjustment added to whole-hand grip.')
            for j,angle in enumerate(([25,50,45] if digit=='Thumb' else [62,85,52])):
                pb=rig.pose.bones[f'DEF_{digit}_{j+1:02d}_{side}'];pb.rotation_mode='XYZ'
                d=driver(pb,'rotation_euler',rig,f'pose.bones["CTRL_Hand_{side}"]["grip"]',
                         f'-{math.radians(angle)}*min(1.3,max(0,v+c))',0)
                var=d.variables.new();var.name='c';var.type='SINGLE_PROP'
                var.targets[0].id=rig;var.targets[0].data_path=f'pose.bones["CTRL_Hand_{side}"]["{digit.lower()}_curl"]'
        prop(ctrl,'thumb_opposition',0.0)
        pb=rig.pose.bones['DEF_Thumb_01_'+side]
        driver(pb,'rotation_euler',rig,f'pose.bones["CTRL_Hand_{side}"]["thumb_opposition"]',
               f'v*{-.65 if side=="R" else .65}',2)

    # Keep all rig dependencies inside one armature: weapon -> grip targets -> hand controls -> arm IK.
    for side,prefix in [('R','Right'),('L','Left')]:
        for role,mode in [('Hammer',1),('Sword',2)]:
            if side=='L' and role=='Sword':continue
            con=rig.pose.bones['CTRL_Hand_'+side].constraints.new('COPY_TRANSFORMS')
            con.name='Follow '+role+' grip';con.target=rig;con.subtarget='MCH_'+role+'_Hand_'+side
            con.target_space='POSE';con.owner_space='POSE'
            driver(con,'influence',rig,'["weapon_mode"]',f'1 if v=={mode} else 0')
        for limb,upper,lower,end,kind in [('Hand','Arm','ForeArm','Hand','arm'),('Foot','UpLeg','Leg','Foot','leg')]:
            pb=rig.pose.bones[prefix+lower]
            con=pb.constraints.new('IK');con.name=kind.title()+' IK';con.target=rig
            con.subtarget='CTRL_'+limb+'_'+side;con.chain_count=2;con.use_stretch=False
            con.pole_target=rig;con.pole_subtarget='CTRL_'+('Elbow' if kind=='arm' else 'Knee')+'_'+side
            driver(con,'influence',rig,f'["{kind}_ik_{side}"]','v')
            rot=rig.pose.bones[prefix+end].constraints.new('COPY_ROTATION')
            rot.name=limb+' orientation';rot.target=rig;rot.subtarget='CTRL_'+limb+'_'+side
            rot.target_space='POSE';rot.owner_space='POSE'
            driver(rot,'influence',rig,f'["{kind}_ik_{side}"]','v')
            for n in [prefix+upper,prefix+lower]:rig.pose.bones[n].ik_stretch=0

    # Update the actual renderable weapon and its marker siblings together.
    weapon_col.hide_render=False;weapon_col.name='04_Equipped_Weapons'
    for role,mode in [('Hammer',1),('Sword',2)]:
        parent=bpy.data.objects['PREP_'+role];parent.name='ATTACH_'+role
        parent.parent=rig;parent.parent_type='BONE';parent.parent_bone='CTRL_'+role
        parent.matrix_parent_inverse=I
        parent.matrix_basis=Matrix.Translation((0,-rig.data.bones['CTRL_'+role].length,0))
        for i,axis in enumerate('xyz'):
            driver(parent,'scale',rig,f'["{role.lower()}_size_{axis}"]','v',i)
        for obj in [parent]+list(parent.children):
            driver(obj,'hide_render',rig,'["weapon_mode"]',f'v!={mode}')
            driver(obj,'hide_viewport',rig,'["weapon_mode"]',f'v!={mode}')
        parent['status']='Authored carry fit; user baseline sizes retained and adjustable through rig properties.'
        parent['attach_to']='CTRL_'+role
        for marker in parent.children:
            if marker.type=='EMPTY':marker['status']='Authored weapon marker; inherits weapon size controls.'
        parent['resize_workflow']='Change IV_Rig '+role.lower()+'_size_x/y/z; grip anchors follow automatically.'
        for side in (['R','L'] if role=='Hammer' else ['R']):
            name='MCH_'+role+'_Anchor_'+side
            offset=rig.data.bones[name].head_local
            for i,axis in enumerate('xyz'):
                driver(rig.pose.bones[name],'location',rig,f'["{role.lower()}_size_{axis}"]',f'(v-1)*{offset[i]}',i)

    # Simple custom control shapes stored outside any rendered scene.
    shapes=bpy.data.collections.new('IV_Control_Shapes')
    verts=[(math.cos(i*math.tau/24),math.sin(i*math.tau/24),0) for i in range(24)]
    data=bpy.data.meshes.new('IV_Control_Ring');data.from_pydata(verts,[(i,(i+1)%24) for i in range(24)],[])
    shape=bpy.data.objects.new('IV_Control_Ring',data);shapes.objects.link(shape)
    for pb in rig.pose.bones:
        if pb.name.startswith('CTRL_'):
            pb.custom_shape=shape;pb.use_custom_shape_bone_size=False;pb.custom_shape_scale_xyz=(.08,.08,.08)

    # Source clips explicitly disable new controls, so adding a rig does not break legacy playback.
    property_names=['weapon_mode','arm_ik_R','arm_ik_L','leg_ik_R','leg_ik_L']
    for name in ['IV_Bind','IV_SourceMotion_Root','IV_SourceMotion_InPlace']:
        action=bpy.data.actions[name];set_action(rig,action)
        for p in property_names:rig[p]=0;rig.keyframe_insert(data_path=f'["{p}"]',frame=1,group='Rig settings')
        for side in ['R','L']:
            ctrl=rig.pose.bones['CTRL_Hand_'+side]
            for p in ['grip','thumb_opposition']+[d.lower()+'_curl' for d in digit_specs[side]]:
                ctrl[p]=0;ctrl.keyframe_insert(data_path=f'["{p}"]',frame=1,group=ctrl.name)
    set_action(rig,bpy.data.actions['IV_Bind']);scene.frame_set(1);update()
    # Calibrate IK roll with targets at the measured rest pose.
    rig['weapon_mode']=0
    for side,prefix in [('R','Right'),('L','Left')]:
        for lower,kind in [('ForeArm','arm'),('Leg','leg')]:
            rig[kind+'_ik_'+side]=1.;update()
            con=rig.pose.bones[prefix+lower].constraints[kind.title()+' IK']
            expected=rig.data.bones[prefix+lower].head_local
            best=(1e9,0)
            for step in range(72):
                con.pole_angle=-math.pi+step*math.tau/72
                update()
                err=(rig.pose.bones[prefix+lower].head-expected).length
                if err<best[0]:best=(err,con.pole_angle)
            center_angle=best[1]
            for step in range(-100,101):
                con.pole_angle=center_angle+math.radians(step*.05)
                update()
                err=(rig.pose.bones[prefix+lower].head-expected).length
                if err<best[0]:best=(err,con.pole_angle)
            con.pole_angle=best[1];rig[kind+'_ik_'+side]=0
            report.setdefault('ik_poles',{})[kind+'_'+side]={'angle':best[1],'rest_elbow_or_knee_error_m':best[0]}
    # Carry pose actions key all bones to prevent stale transforms when switching actions.
    rest={b.name:b.matrix_local.copy() for b in rig.data.bones}
    carries={}
    for role,mode in [('Hammer',1),('Sword',2)]:
        set_action(rig,None)
        for pb in rig.pose.bones:
            if not pb.name.startswith('DEF_'):pb.matrix_basis=I
        rig['weapon_mode']=mode
        for p in ['arm_ik_R','arm_ik_L','leg_ik_R','leg_ik_L']:rig[p]=1.
        for side in ['R','L']:
            ctrl=rig.pose.bones['CTRL_Hand_'+side]
            ctrl['grip']=.95 if side=='R' or role=='Hammer' else .12
            ctrl['thumb_opposition']=.85 if side=='R' or role=='Hammer' else .10
        if role=='Hammer':
            z=Vector((-.60,0,.80));y=Vector((0,1,0));x=y.cross(z)
            world=Matrix((x,y,z)).transposed().to_4x4();world.translation=Vector((.21,.30,1.18))
        else:
            world=Matrix.Translation((.32,.32,1.18))
            # Left arm rests at the side rather than remaining in T-pose.
            hand=rig.data.bones['LeftHand']
            transform=Matrix.Rotation(math.radians(-75),4,'Y')
            left=transform@hand.matrix_local
            left.translation=Vector((-.29,.055,1.04))
            rig.pose.bones['CTRL_Hand_L'].matrix_basis=rest['CTRL_Hand_L'].inverted()@left
        rig.pose.bones['CTRL_'+role].matrix_basis=rest['CTRL_'+role].inverted()@world
        for side,sign in [('R',1),('L',-1)]:
            pole=rig.pose.bones['CTRL_Elbow_'+side]
            desired=Vector((sign*.65,-.12,1.12))
            pole.location=desired-rest[pole.name].translation
        update()
        for p in property_names:rig.keyframe_insert(data_path=f'["{p}"]',frame=1,group='Rig settings')
        for side in ['R','L']:
            ctrl=rig.pose.bones['CTRL_Hand_'+side]
            for p in ['grip','thumb_opposition']+ [d.lower()+'_curl' for d in digit_specs[side]]:
                ctrl.keyframe_insert(data_path=f'["{p}"]',frame=1,group=ctrl.name)
        key_pose(rig,1,[n for n in rest if not n.startswith(('DEF_','MCH_'))],{})
        action=rig.animation_data.action;action.name='IV_'+role+'_Grip';action.use_fake_user=True
        action.asset_mark();linear_keys(action);carries[role]=action
        scene.frame_set(1);update()
        render(scene,out,role.lower()+'-grip')
        hand_point=rig.pose.bones['RightHand'].matrix.translation
        render(scene,out,role.lower()+'-hand',hand_point,(2,3,2),.40)
        report['weapons'][role]['primary_socket_error_m']=(rig.pose.bones['weapon_socket_r'].matrix.translation-rig.pose.bones['CTRL_'+role].matrix.translation).length
        if role=='Hammer':
            report['weapons'][role]['support_socket_error_m']=(rig.pose.bones['weapon_socket_l'].matrix.translation-rig.pose.bones['MCH_Hammer_Anchor_L'].matrix.translation).length

    set_action(rig,bpy.data.actions['IV_SourceMotion_Root']);scene.frame_set(97);update()
    render(scene,out,'torso-after',rig.pose.bones['Spine'].matrix.translation,(2,6,1),.90)
    # Weight integrity after finger assignment: prune negligible terms and normalize to four influences.
    final=weights_array(body,len(body.vertex_groups))
    apply_weights(body,range(len(body.data.vertices)),final)
    final=weights_array(body,len(body.vertex_groups))
    report['skin']={'max_influences':int((final>1e-6).sum(1).max()),'unweighted_vertices':int((final.sum(1)==0).sum()),
                    'max_weight_sum_error':float(np.abs(final.sum(1)-1).max())}
    report['bones']=len(rig.data.bones);report['actions']=[a.name for a in carries.values()]
    report['future_sizing']='IV_Rig hammer_size_x/y/z and sword_size_x/y/z scale weapon mesh and grip targets together.'
    report['status']='Rigging candidate; inspect rendered grips and source-motion torso comparison.'
    set_action(rig,carries['Hammer']);scene.frame_set(1);update()
    render(scene,out,'master-overview')
    rig['hand_status']='30 finger deform bones, per-finger curls and thumb opposition; source hand geometry retained.'
    scene['stage']='Authored finger grips, resizable weapons, limb IK, and upper-body weight cleanup; motion-specific refinement remains.'
    ui_text=bpy.data.texts.new('IV_RIG_TOOLS.py')
    ui_text.write((Path(__file__).parent/'rig_ui.py').read_text(encoding='utf-8-sig'))
    notes=bpy.data.texts.get('START_HERE');notes.clear()
    notes.write('IRON VANGUARD RIGGING MASTER\n\n'
        'Run the IV_RIG_TOOLS.py text once to enable the iBrawls sidebar in the 3D View.\n'
        'Choose IV_Hammer_Grip or IV_Sword_Grip on IV_Rig to load equipped carry poses.\n'
        'IV_SourceMotion_Root/InPlace and IV_Bind disable IK and fingers to preserve source playback.\n'
        'Pose controls: CTRL_Hand_R/L, CTRL_Foot_R/L, elbow/knee poles, CTRL_Hammer, CTRL_Sword.\n'
        'Rig custom properties: weapon_mode (0 free / 1 hammer / 2 sword), arm_ik_R/L, leg_ik_R/L.\n'
        'Hand control custom properties: grip, per-digit curl, thumb_opposition.\n'
        'Resize with rig hammer_size_x/y/z and sword_size_x/y/z so grip targets follow.\n'
        'To change grip placement, edit MCH weapon anchor bones in Edit Mode; keep hand offsets intact.\n'
        'User weapon scales from source master were baked into mesh AND markers.\n'
        'This is an editable authoring rig: bake evaluated deform bones for runtime export.\n')
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest,'Source changed while building'
    bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
    (out/'rigging-manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('RIGGING_COMPLETE',json.dumps(report))


if __name__=='__main__':main()
