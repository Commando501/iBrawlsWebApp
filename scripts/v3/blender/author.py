import bpy, json, math
from pathlib import Path
from mathutils import Matrix, Vector, Quaternion
from array import array
import numpy as np
base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
data=json.loads((base/'runtime-audit.json').read_text())
for extra in json.loads(Path(__file__).with_name('extra-clips.json').read_text()):
    if not any(c['id']==extra['id'] for c in data['clips']):data['clips'].append(extra)
for clip in data['clips']:
    if clip['id'].startswith('clean_slide'):clip['durationFrames']=84
binding=json.loads((base/'bind.json').read_text())
C=Matrix.Rotation(math.pi/2,4,'X')
TURN=Matrix.Rotation(math.pi,4,'Y')
def mat(t):
    x,y,z,w=t['q'];return Matrix.LocRotScale(Vector(t['p']),Quaternion((w,x,y,z)),Vector(t.get('s',[1,1,1])))
rest={j['name']:mat(j) for j in data['driverJoints']}
parents={j['name']:j['parent'] if j['parent'] in rest else None for j in data['driverJoints']}
local={n:(rest[p].inverted()@m if (p:=parents[n]) else m.copy()) for n,m in rest.items()}
slotbind={s:Matrix([v['matrix'][i::4] for i in range(4)]) for s,v in binding['bindings'].items()}
def v(x):return Vector(x)
def lerp(a,b,t):return v(a).lerp(v(b),t)
def smooth(t):return t*t*(3-2*t)
def track(points,t):
    for i in range(1,len(points)):
        if t<=points[i][0]:
            ta,a=points[i-1];tb,b=points[i];return lerp(a,b,smooth((t-ta)/max(1e-8,tb-ta)))
    return v(points[-1][1])
def put_rotation(m,q):return Matrix.LocRotScale(m.translation,q,v((1,1,1)))
def pose_world():return {n:m.copy() for n,m in rest.items()}
def descendants(world,parent):
    for n in rest:
        if parents[n]==parent:world[n]=world[parent]@local[n];descendants(world,n)
def orient_segment(name,child,start,end):
    delta=(rest[child].translation-rest[name].translation).rotation_difference(end-start)
    return Matrix.LocRotScale(start,delta@rest[name].to_quaternion(),v((1,1,1)))
def ik(world,a,b,c,target,pole):
    origin=world[a].translation
    l1=(rest[b].translation-rest[a].translation).length;l2=(rest[c].translation-rest[b].translation).length
    delta=target-origin;distance=delta.length
    direction=delta.normalized();d=min(l1+l2-.006,max(abs(l1-l2)+.006,distance))
    bend=v(pole)-origin;bend-=direction*bend.dot(direction)
    if bend.length<1e-6:bend=v((1,0,0))
    bend.normalize();along=(l1*l1-l2*l2+d*d)/(2*d)
    elbow=origin+direction*along+bend*math.sqrt(max(0,l1*l1-along*along));end=origin+direction*d
    world[a]=orient_segment(a,b,origin,elbow);world[b]=orient_segment(b,c,elbow,end)
    world[c]=Matrix.LocRotScale(end,world[b].to_quaternion()@rest[b].to_quaternion().inverted()@rest[c].to_quaternion(),v((1,1,1)))
    descendants(world,c)
    return abs(distance-d)
def hand_q(side,direction):
    n='hand_'+side
    axis=rest[n].to_quaternion()@v((0,1,0))
    return axis.rotation_difference(v(direction).normalized())@rest[n].to_quaternion()

def solve_arm(world,target,q,fixed_grip,side='l',hint_override=None):
    """Use a torso-relative elbow plane and let an unoccupied wrist follow it."""
    upper,lower,hand=('upperarm_'+side,'lowerarm_'+side,'hand_'+side)
    shoulder=world[upper].translation.copy()
    torso=world['spine_03'].to_quaternion()@rest['spine_03'].to_quaternion().inverted()
    # A direction, not a point close to the hand/shoulder line: the old pole
    # became collinear and flipped the elbow in a single frame.
    hint=torso@v((.25,-.45,-.75) if side=='l' else (-.25,-.45,-.75))
    if hint_override is not None:hint=hint_override
    pole=shoulder+hint
    socket=v(binding['sockets']['leftHandGrip' if side=='l' else 'rightHandGrip']['p'])
    hand_rest=rest[lower].to_quaternion().inverted()@rest[hand].to_quaternion()
    if not fixed_grip:
        # Solve to the palm as one rigid forearm/hand segment. Iteratively
        # moving the wrist socket can oscillate on short, folded poses.
        lower_rest_q=rest[lower].to_quaternion()
        lower_vector=lower_rest_q.inverted()@(rest[hand].translation-rest[lower].translation)
        palm_vector=lower_vector+hand_rest@socket
        l1=(rest[lower].translation-rest[upper].translation).length
        l2=palm_vector.length
        delta=target-shoulder;distance=delta.length;axis=delta.normalized()
        d=min(l1+l2-.006,max(abs(l1-l2)+.006,distance))
        bend=hint-axis*hint.dot(axis)
        if bend.length<.0001:
            lateral=torso@v((1,0,0));bend=lateral-axis*lateral.dot(axis)
        bend.normalize()
        along=(l1*l1-l2*l2+d*d)/(2*d)
        elbow=shoulder+axis*along+bend*math.sqrt(max(0,l1*l1-along*along))
        end=shoulder+axis*d
        lower_q=(lower_rest_q@palm_vector).rotation_difference(end-elbow)@lower_rest_q
        world[upper]=orient_segment(upper,lower,shoulder,elbow)
        world[lower]=Matrix.LocRotScale(elbow,lower_q,v((1,1,1)))
        world[hand]=Matrix.LocRotScale(elbow+lower_q@lower_vector,lower_q@hand_rest,v((1,1,1)))
        descendants(world,hand)
        return abs(distance-d)
    wrist=target-q@socket
    error=ik(world,upper,lower,hand,wrist,pole)
    if fixed_grip:
        # Keep both handle contacts fixed, but rotate the elbow around the
        # shoulder/wrist axis when a grip would otherwise fold the wrist back.
        axis=(wrist-shoulder).normalized()
        preferred=(wrist-q@v((0,1,0))*.26)-shoulder
        preferred-=axis*preferred.dot(axis)
        current=world[lower].translation-shoulder
        current-=axis*current.dot(axis)
        if preferred.length>.0001 and current.length>.0001:
            current.normalize();preferred.normalize()
            rotation=current.rotation_difference(preferred)
            for step in range(21):
                bend=Quaternion().slerp(rotation,step/20)@current
                error=ik(world,upper,lower,hand,wrist,shoulder+bend)
                forward=(wrist-world[lower].translation).normalized()
                if forward.angle(q@v((0,1,0)))<=math.radians(55):break
        # The pommel strike rotates the shaft beyond the support wrist's
        # range. Let that hand adjust around its fixed handle contact instead
        # of forcing a backwards wrist or moving the weapon/other hand.
        for iteration in range(12 if side=='l' else 0):
            forward=(wrist-world[lower].translation).normalized()
            hand_axis=q@v((0,1,0));angle=forward.angle(hand_axis)
            if angle<=math.radians(55):break
            correction=hand_axis.rotation_difference(forward)
            q=Quaternion().slerp(correction,(angle-math.radians(50))/angle)@q
            wrist=target-q@socket
            error=ik(world,upper,lower,hand,wrist,pole)
    world[hand]=Matrix.LocRotScale(world[hand].translation,q,v((1,1,1)))
    descendants(world,hand)
    return error

def katar_cut(u):
    # A diagonal right-to-left slice in one plane. Local X is the cutting
    # edge direction, Y the blade-face normal, and -Z the blade's long axis.
    across=v((1,-.35,0)).normalized();forward=v((0,0,1))
    angle=math.radians(-60+125*u)
    blade=across*math.sin(angle)+forward*math.cos(angle)
    edge=across*math.cos(angle)-forward*math.sin(angle)
    normal=(-blade).cross(edge).normalized()
    q=Matrix((edge,normal,-blade)).transposed().to_quaternion()
    return v((-.13,1.22,.02))+blade*.40,q

def katar_pose(cid,t):
    carry=v((-.34,1.0,.27))
    carry_q=v((0,0,-1)).rotation_difference(v((-.15,.08,1)).normalized())
    start,start_q=katar_cut(0);end,end_q=katar_cut(1)
    if cid=='clean_sword_slash':
        if t<.25:
            u=smooth(t/.25);return carry.lerp(start,u),carry_q.slerp(start_q,u)
        return katar_cut(smooth(min(1,(t-.25)/.53)))
    u=smooth(t)
    return end.lerp(carry,u),end_q.slerp(carry_q,u)

def katar_lunge(t):
    # Hold the thrust through the glide (frames 11-33). At contact, turn the
    # cutting edge through a horizontal side cut, then settle back to carry.
    carry=v((-.34,1.,.27))
    def cut(u):
        angle=math.radians(80)*u
        blade=v((math.sin(angle),0,math.cos(angle)))
        edge=v((math.cos(angle),0,-math.sin(angle)))
        q=Matrix((edge,(-blade).cross(edge),-blade)).transposed().to_quaternion()
        return v((-.20,1.05,.12))+blade*.46,q
    extended,extended_q=cut(0)
    if t<.18:
        u=smooth(t/.18);return carry.lerp(extended,u),KATAR_CARRY_Q.slerp(extended_q,u)
    if t<=.55:return extended,extended_q
    if t<.80:return cut(smooth((t-.55)/.25))
    end,end_q=cut(1);u=smooth((t-.80)/.20)
    return end.lerp(carry,u),end_q.slerp(KATAR_CARRY_Q,u)

def lunge_crouch(t):
    if t<.18:return smooth(t/.18)
    if t<.80:return 1.
    return 1-smooth((t-.80)/.20)

def slide_amount(t):
    # Preserve the accepted entry/skid timing; recovery now has 35 frames.
    frame=t*84
    if frame<17.28:return smooth(frame/17.28)
    if frame<=48.96:return 1.
    return 1-slide_ease(frame,54,80)

def slide_ease(frame,start,end):
    return smooth(max(0,min(1,(frame-start)/(end-start))))

def slide_recovery(frame):
    # Shift onto the tucked left foot before lifting the extended right boot.
    # The pelvis rises first, then the chest/hands finish settling into ready.
    shift=v((.12*slide_ease(frame,49,60)*(1-slide_ease(frame,69,84)),0,
             .10*slide_ease(frame,49,59)*(1-slide_ease(frame,65,84))))
    lean=-.34*(1-slide_ease(frame,49,61))+.20*slide_ease(frame,49,61)*(1-slide_ease(frame,63,84))
    return shift,lean,1-slide_ease(frame,55,84)

KATAR_CARRY_Q=v((0,0,-1)).rotation_difference(v((-.15,.08,1)).normalized())
KATAR_HAND_RELATIVE=KATAR_CARRY_Q.inverted()@hand_q('r',v((-.34,1.,.27))-v((-.275,.99,.04)))
HAMMER_CARRY_Q=v((0,0,-1)).rotation_difference(v((.72,.65,.18)).normalized())
HAMMER_CARRY_GRIPS={'r':v((-.18,1.01,.34)),
    'l':v((-.18,1.01,.34))+HAMMER_CARRY_Q@(v(binding['weapons']['hammer']['offhand'])*binding['weapons']['hammer']['scale'][0])}
HAMMER_HAND_RELATIVE={s:HAMMER_CARRY_Q.inverted()@hand_q(s,p-v((-.275 if s=='r' else .275,.99,.04))) for s,p in HAMMER_CARRY_GRIPS.items()}
BALL_CARRY=v((-.29,1.13,.40))
BALL_DESIGN=json.loads((base/'blender-skull-bomb.json').read_text())
BALL_ORIGINAL_GRIP=v((0,-.197,-.025))
BALL_CONTACTS={'r':v(BALL_DESIGN['grip'])}
BALL_HAND_RELATIVE=hand_q('r',BALL_CARRY+BALL_ORIGINAL_GRIP-v((-.275,.99,.04)))

def ball_punch(t):
    # Compact chamber, straight ball-first jab, quick retraction, then settle.
    loaded=v((-.29,1.15,.29));hit=v((-.29,1.20,.74))
    punch_q=Quaternion((1,0,0),.70)
    if t<.18:
        u=smooth(t/.18);return BALL_CARRY.lerp(loaded,u),Quaternion()
    if t<.36:
        u=smooth((t-.18)/.18);return loaded.lerp(hit,u),Quaternion().slerp(punch_q,u)
    if t<.62:
        u=smooth((t-.36)/.26);return hit.lerp(loaded,u),punch_q.slerp(Quaternion(),u)
    u=smooth(min(1,(t-.62)/.24));return loaded.lerp(BALL_CARRY,u),Quaternion()

def ball_throw(t):
    loaded=v((-.48,1.50,-.32));q0=Quaternion((1,0,0),-.75)
    if t<=1/3:
        u=smooth(t*3)
        # Route around the chest/shoulder instead of cutting diagonally through it.
        p=BALL_CARRY.lerp(loaded,u)+v((-.20,.08,.15))*math.sin(math.pi*u)
        return p,Quaternion().slerp(q0,u)
    if t<=.5:
        u=(t-1/3)*6
        # An accelerating overhead path with forward/upward velocity at release.
        p=loaded*(1-u)**3+v((-.42,1.89,-.26))*3*(1-u)**2*u+v((-.25,1.69,.19))*3*(1-u)*u*u+v((-.22,1.78,.43))*u**3
        return p,q0.slerp(Quaternion((1,0,0),.25),u)
    p=track([(.5,(-.22,1.78,.43)),(.68,(.08,1.00,.40)),(1,(-.285,.997,.070))],t)
    return p,Quaternion((1,0,0),.25*(1-smooth((t-.5)/.5)))
PISTOL_CARRY_Q=v((-.85,.1,-1)).rotation_difference(v((0,0,1)))
PISTOL_HAND_Q={s:hand_q(s,p-v((-.275 if s=='r' else .275,.99,.04))) for s,p in {'r':v((-.18,1.26,.46)),'l':v((-.11,1.24,.445))}.items()}
def foot_vertices(slot):
    chunks=[]
    for item in data['meshes']:
        if item['slot']==slot:
            chunks.append(np.fromfile(base/item['positions'],dtype=np.float32).reshape(-1,3))
    return np.concatenate(chunks)
feet={s:foot_vertices(s) for s in ('footLeft','footRight')}
def minimum_y(vertices,m):
    a=np.array(m);return float(np.min(vertices@a[1,:3]+a[1,3]))
sole={s:minimum_y(vertices,mat(data['rest'][s])) for s,vertices in feet.items()}

# All clips use this single native skeleton; elbows/knees are solved without bone stretch.
# Authoring uses the source's +Z facing, then rotates the entire baked rig to game -Z.
def sample(cid,t):
    carry_item=cid.removeprefix('clean_slide_') if cid.startswith('clean_slide_') else None
    if carry_item:cid='clean_slide'
    if cid in ('clean_ball_walk','clean_ball_sprint'):
        carry_item='ball';cid='clean_walk' if cid=='clean_ball_walk' else 'clean_sprint'
    world=pose_world();phase=2*math.pi*t;run=cid=='clean_sprint';walk=cid=='clean_walk'
    bob=.004*math.sin(phase)
    lean=0.;twist=0.;lower=.02
    if walk:lower=.035;bob=.015*math.cos(phase*2);twist=.05*math.sin(phase)
    if run:lower=.10;bob=.022*math.cos(phase*2);lean=.18;twist=.08*math.sin(phase)
    if cid=='clean_slide':
        slide=slide_amount(t);lower=.02+.56*slide;lean=-.34*slide;bob=0
        slide_frame=t*84;slide_shift=v((0,0,0));arm_slide=slide
        if slide_frame>48.96:slide_shift,lean,arm_slide=slide_recovery(slide_frame)
    if cid=='clean_sword_lunge':
        glide=lunge_crouch(t);bob=0;lower=.02+.21*glide;lean=.20*glide
        twist=.26*smooth(max(0,min(1,(t-.55)/.25)))*glide
    if cid=='clean_hit_react':
        # Fast impact, a small counter-settle, then a longer return to ready.
        lower,lean,twist=track([(0,(.02,0,0)),(.18,(.045,-.14,.09)),(.65,(.025,.018,-.012)),(1,(.02,0,0))],t);bob=0
    if cid=='clean_ball_punch':
        lower,lean,twist=track([(0,(.02,0,0)),(.18,(.04,-.02,-.08)),(.36,(.035,.12,.20)),(.62,(.04,.02,-.04)),(.86,(.02,0,0)),(1,(.02,0,0))],t);bob=0
    if cid=='clean_ball_throw':
        lower,lean,twist=track([(0,(.02,0,0)),(1/3,(.085,-.22,-.65)),(.5,(.025,.18,.38)),(.68,(.06,.24,.30)),(1,(.02,0,0))],t);bob=0
    # A pickaxe-like load over the character's right shoulder, then a weighted
    # forward fold. Endpoints match across windup -> strike -> recovery.
    if cid=='clean_hammer_windup':
        bob=0;lean=-.10*smooth(t);twist=-.16*smooth(t);lower=.02+.025*smooth(t)
    if cid=='clean_hammer_strike':
        drive=smooth(min(1,t/.72));bob=0;lean=-.10+.34*drive;twist=-.16+.20*drive;lower=.045+.055*drive
    if cid=='clean_hammer_recover':
        settle=smooth(t);bob=0;lean=.24*(1-settle);twist=.04*(1-settle);lower=.10-.08*settle
    if cid=='clean_hammer_melee':
        body=track([(0,(.02,0,0)),(.22,(.065,.035,-.04)),(.85,(.01,-.045,.09)),(1,(.01,-.045,.09))],t)
        lower,lean,twist=body;bob=0
    if cid=='clean_hammer_melee_recover':
        settle=smooth(t);lower=.01+.01*settle;lean=-.045*(1-settle);twist=.09*(1-settle);bob=0
    if cid=='clean_sword_slash':
        bob=0
        twist=-.12*smooth(t/.25) if t<.25 else -.12+.32*smooth(min(1,(t-.25)/.53))
    if cid=='clean_sword_recover':bob=0;twist=.20*(1-smooth(t))
    world['pelvis'].translation+=v((0,-lower+bob,0))
    if cid=='clean_slide':world['pelvis'].translation+=slide_shift
    if cid=='clean_ball_throw':
        world['pelvis'].translation+=track([(0,(0,0,0)),(1/3,(-.045,0,-.07)),(.5,(.025,0,.045)),(.68,(.015,0,.025)),(1,(0,0,0))],t)
    if cid=='clean_ball_punch':
        world['pelvis'].translation+=track([(0,(0,0,0)),(.18,(0,0,-.015)),(.36,(0,0,.065)),(.62,(0,0,0)),(1,(0,0,0))],t)
    descendants(world,'pelvis')
    for n in ('spine_01','spine_02','spine_03'):
        world[n]=put_rotation(world[n],Quaternion((1,0,0),lean/3)@Quaternion((0,1,0),twist/3)@world[n].to_quaternion());descendants(world,n)
    if cid=='clean_slide':
        world['neck_01']=put_rotation(world['neck_01'],Quaternion((1,0,0),-lean*(.16/.34))@world['neck_01'].to_quaternion());descendants(world,'neck_01')
    errors=[]
    for side,sign,slot in [('l',1,'footLeft'),('r',-1,'footRight')]:
        foot=rest['foot_'+side].translation.copy();foot.y-=sole[slot]
        if walk or run:
            u=(t+(0 if side=='l' else .5))%1
            stride=.23 if run else .15
            if u<.6:foot.z+=stride*(1-2*u/.6)
            else:
                s=(u-.6)/.4
                # Hermite swing matches the planted foot's travel velocity at
                # both ends. Squared lift eases off/on the ground without a pop.
                foot.z+=stride*(-1-4*s/3+10*s*s-20*s*s*s/3)
                foot.y+=(.15 if run else .075)*math.sin(math.pi*s)**2
        foot_q=rest['foot_'+side].to_quaternion()
        if cid=='clean_slide':
            placement=slide;lift=0;toe=slide
            if slide_frame>48.96:
                step=slide_ease(slide_frame,56,74) if side=='r' else slide_ease(slide_frame,74,84)
                placement=1-step
                lift=(.09 if side=='r' else .035)*math.sin(math.pi*step)**2
                toe=1-slide_ease(slide_frame,49,57)
            foot.z+=(.68 if side=='r' else .10)*placement
            foot.x+=(sign*.065)*placement
            if side=='r':foot_q=Quaternion((1,0,0),-.28*toe)@foot_q
            # Ground the tilted leading boot by its heel, not its old flat sole.
            foot.y-=minimum_y(feet[slot],Matrix.LocRotScale(foot,foot_q,v((1,1,1)))@slotbind[slot])
            foot.y+=lift
        if cid=='clean_sword_lunge':
            # A stable split stance reads as a slide, with no running foot cycle.
            foot.z+=(.34 if side=='r' else -.22)*lunge_crouch(t)
            foot.x+=sign*.035*lunge_crouch(t)
        if cid=='clean_ball_throw' and side=='l':
            step=smooth(min(1,t/.30));back=smooth(max(0,(t-.72)/.28))
            foot.z+=.22*step*(1-back)
            foot.y+=.055*math.sin(math.pi*(step if t<.30 else back))**2
        errors.append(ik(world,'thigh_'+side,'calf_'+side,'foot_'+side,foot,(sign*.3,.5,1)))
        world['foot_'+side]=Matrix.LocRotScale(world['foot_'+side].translation,foot_q,v((1,1,1)));descendants(world,'foot_'+side)
    hand_targets={'l':v((.285,.80,.045)),'r':v((-.285,.80,.045))}
    hand_directions={'l':v((0,-1,.1)),'r':v((0,-1,.1))}
    if walk or run:
        for side,sign in [('l',1),('r',-1)]:
            swing=math.sin(phase)*(1 if side=='l' else -1)
            hand_targets[side]=v((sign*.275,1.02 if run else .83,.12+swing*(.18 if run else .13)))
            if run:hand_targets[side].y=.95+.17*swing
            hand_directions[side]=v((0,-.55 if run else -.95,.8 if run else .2))
    if cid=='clean_slide':
        hand_targets['l']=hand_targets['l'].lerp(v((.30,.64,.30)),arm_slide)+slide_shift
        hand_targets['r']=hand_targets['r'].lerp(v((-.32,.43,-.04)),arm_slide)+slide_shift
        hand_directions['l']=hand_directions['l'].lerp(v((0,.1,1)),arm_slide)
    if cid=='clean_sword_lunge':
        hand_targets['l']=hand_targets['l'].lerp(v((.30,.70,-.02)),lunge_crouch(t))
    if cid=='clean_ball_throw':
        # The free arm reaches forward during the coil, then pulls back as
        # the throwing shoulder unwinds into the overhead release.
        hand_targets['l']=track([(0,(.285,.80,.045)),(1/3,(.32,1.20,.30)),(.5,(.25,.95,.04)),(.68,(.28,.85,.015)),(1,(.285,.80,.045))],t)
    if cid=='clean_ball_punch':
        hand_targets['l']=track([(0,(.285,.80,.045)),(.18,(.25,1.06,.20)),(.36,(.25,1.06,.20)),(.62,(.26,1.0,.16)),(.86,(.285,.80,.045)),(1,(.285,.80,.045))],t)
    weapon=carry_item or ('hammer' if 'hammer' in cid else 'sword' if 'sword' in cid else 'pistol' if 'pistol' in cid else 'ball' if 'ball' in cid else None)
    weapon_matrix=None
    if weapon:
        if weapon=='hammer':
            carry=(-.18,1.01,.34);raised=(-.17,1.50,.18);hit=(-.17,.92,.54)
            carry_d=(.72,.65,.18);raised_d=(-.36,.42,-.83);hit_d=(.06,-.66,.75)
            point=v(carry);direction=v(carry_d)
            if cid=='clean_hammer_windup':
                point=track([(0,carry),(.48,(-.20,1.28,.44)),(.92,raised),(1,raised)],t)
                direction=track([(0,carry_d),(.48,(-.10,.97,.22)),(.92,raised_d),(1,raised_d)],t)
            if cid=='clean_hammer_strike':
                point=track([(0,raised),(.30,(-.17,1.49,.38)),(.72,hit),(1,hit)],t)
                direction=track([(0,raised_d),(.30,(-.18,.96,.22)),(.72,hit_d),(1,hit_d)],t)
            if cid=='clean_hammer_recover':
                point=track([(0,hit),(.52,(-.18,1.00,.43)),(1,carry)],t)
                direction=track([(0,hit_d),(.52,(.46,.23,.86)),(1,carry_d)],t)
            # Drive the pommel upward in front of the right side. The heavy
            # head counter-rotates down outside the left arm, clear of the body.
            butt_hit=(-.17,1.36,.52);butt_hit_d=(.88,-.42,-.20)
            if cid=='clean_hammer_melee':
                point=track([(0,carry),(.22,(-.21,.96,.35)),(.85,butt_hit),(1,butt_hit)],t)
                direction=track([(0,carry_d),(.22,(.76,.60,.20)),(.85,butt_hit_d),(1,butt_hit_d)],t)
            if cid=='clean_hammer_melee_recover':
                point=lerp(butt_hit,carry,smooth(t));direction=lerp(butt_hit_d,carry_d,smooth(t))
        elif weapon=='sword':
            point=v((-.34,1.0,.27));direction=v((-.15,.08,1))
        elif weapon=='ball':
            point=BALL_CARRY.copy();direction=v((0,0,-1))
            if walk or run:point+=v((.012*math.sin(phase),bob,.012*math.cos(phase)-.012))
        else:
            point=v((-.18,1.26,.46));direction=v((0,0,1))
            if cid=='clean_pistol_fire':
                pulse=smooth(t/.10) if t<.10 else 1-smooth((t-.10)/.38) if t<.48 else 0
                point+=v((0,.025*pulse,-.025*pulse));direction.y=.1*pulse
        # Align the rebuilt shaft/blade along corrected local -Z.
        source_axis=v((0,0,-1)) if weapon!='pistol' else v((-.85,.1,-1))
        q=source_axis.rotation_difference(direction.normalized())
        if carry_item and cid=='clean_slide':
            target={'hammer':(-.18,.66,.34),'sword':(-.34,.77,.28),'pistol':(-.18,.84,.32),'ball':(-.29,.78,.42)}[carry_item]
            point=point.lerp(v(target),arm_slide)+slide_shift
            if carry_item=='ball':
                clearance=slide_ease(slide_frame,49,59)*(1-slide_ease(slide_frame,67,84))
                point+=v((0,-.02,.12))*clearance
        if cid=='clean_ball_punch':point,q=ball_punch(t)
        if cid=='clean_ball_throw':point,q=ball_throw(t)
        # Keep the accepted hand path as the prop shrinks; move its center
        # toward the palm by the change in the authored underside grip.
        if weapon=='ball':point+=q@(BALL_ORIGINAL_GRIP-BALL_CONTACTS['r'])
        katar_motion=cid in ('clean_sword_slash','clean_sword_recover','clean_sword_lunge')
        if katar_motion:point,q=katar_lunge(t) if cid=='clean_sword_lunge' else katar_pose(cid,t)
        katar_hand_q=q@KATAR_HAND_RELATIVE if katar_motion or carry_item=='sword' else None
        hammer_melee=cid in ('clean_hammer_melee','clean_hammer_melee_recover') or carry_item=='hammer'
        hammer_hand_q={s:q@relative for s,relative in HAMMER_HAND_RELATIVE.items()} if hammer_melee else {}
        fixed_hand_q=hammer_hand_q if hammer_melee else {'r':katar_hand_q} if katar_hand_q else PISTOL_HAND_Q if carry_item=='pistol' else {'r':q@BALL_HAND_RELATIVE} if weapon=='ball' else {}
        if cid=='clean_ball_throw' and t>.5:
            fixed_hand_q['r']=fixed_hand_q['r'].slerp(hand_q('r',(0,-1,.1)),smooth((t-.5)/.5))
        scale=v((1,1,1)) if weapon=='ball' else v(binding['weapons'][weapon]['scale'])
        weapon_matrix=Matrix.LocRotScale(point,q,scale)
        hand_targets['r']=point
        hand_directions['r']=direction.cross(v((1,0,0))) if weapon=='hammer' else v((0,0,1))
        if hand_directions['r'].length<.1:hand_directions['r']=v((0,-1,0))
        if weapon=='hammer':
            hand_targets['l']=weapon_matrix@v(binding['weapons']['hammer']['offhand'])
        if weapon=='pistol':
            hand_targets['l']=point+v((.07,-.02,-.015));hand_directions['l']=v((0,0,1))
        if weapon=='ball':
            hand_targets['r']=point+q@BALL_CONTACTS['r']
        for side,sign in [('r',-1),('l',1)]:
            if side=='r' or weapon in ('hammer','pistol'):
                hand_directions[side]=(hand_targets[side]-v((sign*.275,.99,.04))).normalized()
        # Project the rigid weapon into both arms' reachable volume, keeping
        # the grip separation and orientation fixed instead of stretching wrists.
        active_sides=['r','l'] if weapon in ('hammer','pistol') else ['r']
        for iteration in range(16):
            for side in active_sides:
                qh=fixed_hand_q.get(side) or hand_q(side,hand_directions[side]);socket=v(binding['sockets']['leftHandGrip' if side=='l' else 'rightHandGrip']['p'])
                wrist=hand_targets[side]-qh@socket;shoulder=world['upperarm_'+side].translation
                limit=(rest['lowerarm_'+side].translation-rest['upperarm_'+side].translation).length+(rest['hand_'+side].translation-rest['lowerarm_'+side].translation).length-.009
                delta=wrist-shoulder
                if delta.length>limit:
                    shift=shoulder+delta.normalized()*limit-wrist
                    weapon_matrix.translation+=shift
                    for s in active_sides:hand_targets[s]+=shift
    for side,sign in [('l',1),('r',-1)]:
        q=hand_q(side,hand_directions[side]);socket=v(binding['sockets']['leftHandGrip' if side=='l' else 'rightHandGrip']['p'])
        if weapon=='sword' and katar_motion and side=='r':q=katar_hand_q
        if weapon=='hammer' and hammer_melee:q=hammer_hand_q[side]
        if weapon and side in fixed_hand_q:q=fixed_hand_q[side]
        if side=='l':
            errors.append(solve_arm(world,hand_targets[side],q,weapon in ('hammer','pistol')))
            continue
        if not weapon:
            errors.append(solve_arm(world,hand_targets[side],q,False,side='r'))
            continue
        if cid=='clean_ball_throw':
            if t<=.5:
                shoulder=world['upperarm_r'].translation
                torso=world['spine_03'].to_quaternion()@rest['spine_03'].to_quaternion().inverted()
                hint=lerp(v((-.29,.94,.025))-shoulder,torso@v((-.25,-.45,-.75)),smooth(min(1,t/.2)))
                errors.append(solve_arm(world,hand_targets[side],q,True,side='r',hint_override=hint))
            else:
                # Once the ball leaves, use an FK follow-through. Chasing its
                # former grip with IK caused a pole flip as the hand crossed
                # the chest. Interpolate rotations, then rebuild child joints
                # so the shoulder, elbow and wrist remain connected.
                release={n:TURN.inverted()@m for n,m in sample(cid,.5)[0].items()}
                follow={n:m.copy() for n,m in release.items()}
                solve_arm(follow,v((.08,1.0,.40)),q,False,side='r')
                neutral={n:TURN.inverted()@m for n,m in sample('clean_idle',0)[0].items()}
                a,b,u=(release,follow,smooth((t-.5)/.18)) if t<.68 else (follow,neutral,smooth((t-.68)/.32))
                for joint in ('upperarm_r','lowerarm_r','hand_r'):
                    rotation=a[joint].to_quaternion().slerp(b[joint].to_quaternion(),u)
                    world[joint]=put_rotation(world[joint],rotation);descendants(world,joint)
            continue
        wrist=hand_targets[side]-q@socket
        # Elbows hang below the shoulders, close to the ribcage. The old wide
        # pole (.8 m lateral) forced every pose into a winged/chicken-arm shape.
        pole=(sign*.29,.94,.025) if weapon else (sign*.19,1.0,-.20)
        if cid=='clean_sword_lunge':
            torso=world['spine_03'].to_quaternion()@rest['spine_03'].to_quaternion().inverted()
            stable=world['upperarm_r'].translation+torso@v((-.25,-.45,-.75))
            pole=lerp(pole,stable,lunge_crouch(t))
        if cid=='clean_slide':pole=lerp(pole,(sign*.22,.46,-.12),arm_slide)+slide_shift
        errors.append(ik(world,'upperarm_'+side,'lowerarm_'+side,'hand_'+side,wrist,pole))
        world['hand_'+side]=Matrix.LocRotScale(world['hand_'+side].translation,q,v((1,1,1)));descendants(world,'hand_'+side)
    # Ground correction is based on visible armor soles, never hidden bind helpers.
    ground=min(minimum_y(vertices,world[binding['bindings'][s]['joint']]@slotbind[s]) for s,vertices in feet.items())
    for n in world:world[n].translation.y-=ground
    if weapon_matrix:weapon_matrix.translation.y-=ground
    if cid=='clean_ball_throw' and t>.5:
        # Only the review ball follows this flight. Gameplay receives a release
        # marker and takes ownership of the projectile after that frame.
        release=TURN.inverted()@sample(cid,.5)[1]
        previous=TURN.inverted()@sample(cid,44/90)[1]
        elapsed=(t*90-45)/60
        velocity=(release.translation-previous.translation)*60
        # Preview landing only; never bake a flight through the floor.
        landing=(velocity.y+math.sqrt(velocity.y**2+19.62*max(0,release.translation.y-BALL_DESIGN['radius'])))/9.81
        elapsed=min(elapsed,landing)
        weapon_matrix=release.copy();weapon_matrix.translation+=velocity*elapsed+v((0,-4.905*elapsed*elapsed,0))
        weapon_matrix=put_rotation(weapon_matrix,release.to_quaternion()@Quaternion((0,0,1),elapsed*9))
    return {n:TURN@m for n,m in world.items()},TURN@weapon_matrix if weapon_matrix else None,max(errors)

only_clips=globals().get('ONLY_CLIPS')
if only_clips=='all':only_clips=[clip['id'] for clip in data['clips']]
if only_clips:
    unknown=set(only_clips)-{clip['id'] for clip in data['clips']}
    if unknown:raise ValueError(f'Unknown V3 clip IDs: {sorted(unknown)}')
if not only_clips:
    scene=bpy.context.scene
    original=bpy.data.collections.get(scene.get('ibrawls_original_collection','Runtime armor - original'));original.hide_render=True;original.hide_viewport=True
    previous=bpy.data.collections.get(scene.get('ibrawls_repaired_collection','Rebuilt animations - unified rig'))
    if previous and previous.name not in scene.collection.children:previous=None
    if previous:
        for obj in list(previous.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.collections.remove(previous)
    for marker in list(scene.timeline_markers):
        if marker.name.startswith('REPAIRED '):scene.timeline_markers.remove(marker)
    collection=bpy.data.collections.new('Rebuilt animations - unified rig');scene.collection.children.link(collection)
    scene['ibrawls_repaired_collection']=collection.name
    armor={}
    for slot in data['rest']:
        o=bpy.data.objects.new('Repaired '+slot,None);collection.objects.link(o);o.rotation_mode='QUATERNION';armor[slot]=o
    weapons={}
    for weapon in ('hammer','sword','pistol'):
        o=bpy.data.objects.new('Repaired weapon_'+weapon,None);collection.objects.link(o);o.rotation_mode='QUATERNION';weapons[weapon]=o
        scene['ibrawls_weapon_'+weapon]=o.name
    for old in original.objects:
        if old.type!='MESH':continue
        slot=old.parent.get('ibrawls_slot',old.parent.name)
        new=bpy.data.objects.new('Repaired '+old.name,old.data);collection.objects.link(new)
        new.parent=weapons[slot[7:]] if slot.startswith('weapon_') else armor[slot]

    armdata=bpy.data.armatures.new('iBrawls Unified Skeleton');arm=bpy.data.objects.new('iBrawls Unified Skeleton',armdata);collection.objects.link(arm)
    scene['ibrawls_armature']=arm.name
    bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for n,m in rest.items():
        bone=armdata.edit_bones.new(n);bone.matrix=C@m@C.inverted();bone.length=.06
    for n,p in parents.items():
        if p:armdata.edit_bones[n].parent=armdata.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT');arm.show_in_front=True;arm.display_type='WIRE'
    for p in arm.pose.bones:p.rotation_mode='QUATERNION'
    blender_local={n:(armdata.bones[p].matrix_local.inverted()@armdata.bones[n].matrix_local
                      if p else armdata.bones[n].matrix_local.copy()) for n,p in parents.items()}
    for slot,o in armor.items():
        joint=binding['bindings'][slot]['joint']
        o.parent=arm;o.parent_type='BONE';o.parent_bone=joint
        # Blender's bone-parent origin is at the tail. Cancel that offset so the
        # unchanged armor bind is relative to the native joint at the head.
        o.matrix_parent_inverse=Matrix.Translation((0,-armdata.bones[joint].length,0))
        o.matrix_basis=C@slotbind[slot]@C.inverted()
else:
    scene=bpy.context.scene
    arm=bpy.data.objects[scene['ibrawls_armature']]
    armdata=arm.data
    collection=bpy.data.collections[scene['ibrawls_repaired_collection']]
    armor={slot:next(o for o in collection.objects if o.name.split('.')[0]=='Repaired '+slot) for slot in data['rest']}
    weapons={w:bpy.data.objects[scene['ibrawls_weapon_'+w]] for w in ('hammer','sword','pistol')}
    blender_local={n:(armdata.bones[p].matrix_local.inverted()@armdata.bones[n].matrix_local
                      if p else armdata.bones[n].matrix_local.copy()) for n,p in parents.items()}
# Copy the same authored skull-bomb used by the runtime mesh builder.
if 'ball' not in weapons:
    ball=bpy.data.objects.get(scene.get('ibrawls_weapon_ball',''))
    if not ball:
        ball=bpy.data.objects.new('Repaired weapon_ball',None);collection.objects.link(ball);ball.rotation_mode='QUATERNION'
        design=bpy.data.collections.get('V3 skull bomb design')
        if not design:raise RuntimeError('Run the ball authoring workflow before rebuilding the unified rig.')
        for source in design.objects:
            mesh=source.copy();mesh.data=source.data.copy();collection.objects.link(mesh);mesh.parent=ball;mesh.matrix_local=C@source.matrix_world
            mesh.hide_render=True;mesh.hide_viewport=True
            mesh.keyframe_insert('hide_render',frame=1);mesh.keyframe_insert('hide_viewport',frame=1)
    weapons['ball']=ball;scene['ibrawls_weapon_ball']=ball.name
clips=[];timeline=[];start=1
existing_ranges={c['id']:c for c in json.loads((base/'repair-timeline.json').read_text())} if only_clips else {}
for clip in data['clips']:
    if only_clips and clip['id'] not in only_clips:
        start+=clip['durationFrames']+15
        continue
    if only_clips and clip['id'] in existing_ranges:
        start=existing_ranges[clip['id']]['start']
        following=[c['start'] for c in existing_ranges.values() if c['start']>start]
        if following and start+clip['durationFrames']>=min(following):
            raise ValueError(f"Updated clip overlaps next range: {clip['id']}")
    for weapon,o in weapons.items():
        for child in o.children:
            child.hide_render=child.hide_viewport=weapon!=clip['weapon']
            child.keyframe_insert('hide_render',frame=start)
            child.keyframe_insert('hide_viewport',frame=start)
    samples=[];worst=0
    for f in range(clip['durationFrames']+1):
        world,wm,error=sample(clip['id'],f/clip['durationFrames']);worst=max(worst,error)
        joints={}
        for n,m in world.items():
            p=parents[n];lm=world[p].inverted()@m if p else m
            pos,q,scale=lm.decompose();joints[n]=[round(x,6) for x in (*pos,q.x,q.y,q.z,q.w)]
            pb=arm.pose.bones[n];pb.matrix_basis=blender_local[n].inverted()@C@lm@C.inverted()
            for path in ('location','rotation_quaternion'):pb.keyframe_insert(path,frame=start+f,group=n)
        weapon_pose=None
        if wm:
            o=weapons[clip['weapon']];o.matrix_world=C@wm@C.inverted()
            for path in ('location','rotation_quaternion','scale'):o.keyframe_insert(path,frame=start+f,group=clip['id'])
            p,q,s=wm.decompose();weapon_pose={'position':[round(x,6) for x in p],'quaternion':[round(x,6) for x in (q.x,q.y,q.z,q.w)]}
            if clip['weapon'] in ('hammer','pistol'):
                contact=world['hand_l']@v(binding['sockets']['leftHandGrip']['p'])
                weapon_pose['offhand']=[round(x,6) for x in wm.inverted()@contact]
        samples.append({'joints':joints,**({'weapon':weapon_pose} if weapon_pose else {})})
    clips.append({'id':clip['id'],'durationFrames':clip['durationFrames'],'loop':clip['loop'],'weapon':clip['weapon'],'samples':samples})
    timeline.append({'id':clip['id'],'start':start,'duration':clip['durationFrames'],'maxReachClamp':round(worst,6)})
    if not scene.timeline_markers.get('REPAIRED '+clip['id']):scene.timeline_markers.new('REPAIRED '+clip['id'],frame=start)
    start+=clip['durationFrames']+15
if not only_clips:(base/'blender-authored-clips.json').write_text(json.dumps({'schema':1,'fps':60,'space':'three-y-up-game-forward-minus-z','clips':clips},separators=(',',':')))
if only_clips:
    existing=json.loads((base/'repair-timeline.json').read_text())
    replacements={c['id']:c for c in timeline}
    timeline=[replacements.get(c['id'],c) for c in existing]
    timeline.extend(c for cid,c in replacements.items() if not any(e['id']==cid for e in existing))
(base/'repair-timeline.json').write_text(json.dumps(timeline,indent=2))
scene.frame_end=timeline[-1]['start']+timeline[-1]['duration']
max_binding_error=0;binding_samples=0
for clip in timeline:
    if only_clips and clip['id'] not in only_clips:continue
    for frame in (0,clip['duration']//2,clip['duration']):
        binding_samples+=1
        scene.frame_set(clip['start']+frame);bpy.context.view_layer.update()
        expected,_,_=sample(clip['id'],frame/clip['duration'])
        for slot,o in armor.items():
            target=C@expected[binding['bindings'][slot]['joint']]@slotbind[slot]@C.inverted()
            error=max(abs(o.matrix_world[i][j]-target[i][j]) for i in range(4) for j in range(4))
            max_binding_error=max(max_binding_error,error)
if max_binding_error>.0001:raise RuntimeError(f'Blender armor binding drift: {max_binding_error}')
(base/'blender-binding-validation.json').write_text(json.dumps({'samples':binding_samples,'maxMatrixError':max_binding_error},indent=2))
scene.frame_set(1)
scene.camera.location=(3,6,2.6);scene.camera.rotation_euler=(Vector((0,0,.85))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale=2.6
if not globals().get('SKIP_RENDER'):
    scene.render.filepath=str(base/'repaired-idle.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(base/'ibrawls-animation-repair.blend'))
print(json.dumps({'clips':len(clips),'timeline':timeline}))
