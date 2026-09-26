"""Evaluate every authored frame without replacing scene objects or keys."""
from pathlib import Path
import json, math
source=Path(__file__).with_name('author.py')
scope={'__file__':str(source)}
exec(compile(source.read_text().split("\nonly_clips=globals()")[0],str(source),'exec'),scope)
rows=[]
for clip in scope['data']['clips']:
    row={'id':clip['id']};previous={};metrics={}
    for frame in range(clip['durationFrames']+1):
        world,weapon,error=scope['sample'](clip['id'],frame/clip['durationFrames'])
        for side in ('l','r'):
            elbow=world['lowerarm_'+side];hand=world['hand_'+side]
            axis=hand.to_quaternion()@scope['v']((0,1,0))
            values={side+'Wrist':math.degrees((hand.translation-elbow.translation).angle(axis))}
            if clip['id']=='clean_ball_throw':values[side+('HeldWrist' if frame<=45 else 'ReleasedWrist')]=values[side+'Wrist']
            if side in previous:
                old_elbow,old_q=previous[side]
                values[side+'ElbowStep']=(elbow.translation-old_elbow).length
                angle=old_q.rotation_difference(elbow.to_quaternion()).angle
                values[side+'RotationStep']=math.degrees(min(angle,2*math.pi-angle))
            previous[side]=(elbow.translation.copy(),elbow.to_quaternion())
            for name,value in values.items():
                if value>metrics.get(name,[-1])[0]:metrics[name]=[round(value,5),frame]
    row.update(metrics);rows.append(row)
destination=scope['base']/'motion-source-audit.json'
destination.write_text(json.dumps(rows,indent=2))
joins=[]
for a,b in [('clean_hammer_carry','clean_hammer_windup'),('clean_hammer_windup','clean_hammer_strike'),('clean_hammer_strike','clean_hammer_recover'),('clean_hammer_recover','clean_hammer_carry'),('clean_hammer_carry','clean_hammer_melee'),('clean_hammer_melee','clean_hammer_melee_recover'),('clean_hammer_melee_recover','clean_hammer_carry'),('clean_sword_carry','clean_sword_slash'),('clean_sword_slash','clean_sword_recover'),('clean_sword_recover','clean_sword_carry'),('clean_sword_carry','clean_sword_lunge'),('clean_sword_lunge','clean_sword_carry'),('clean_ball_carry','clean_ball_punch'),('clean_ball_punch','clean_ball_carry'),('clean_ball_carry','clean_ball_throw'),('clean_ball_throw','clean_idle'),('clean_idle','clean_hit_react'),('clean_hit_react','clean_idle'),('clean_pistol_carry','clean_pistol_fire'),('clean_pistol_fire','clean_pistol_carry')]:
    wa=scope['sample'](a,1)[0];wb=scope['sample'](b,0)[0]
    max_position=max((wa[n].translation-wb[n].translation).length for n in wa)
    max_rotation=max(min((d:=wa[n].to_quaternion().rotation_difference(wb[n].to_quaternion()).angle),2*math.pi-d) for n in wa)
    joins.append({'from':a,'to':b,'position':round(max_position,6),'degrees':round(math.degrees(max_rotation),4)})
(scope['base']/'motion-source-joins.json').write_text(json.dumps(joins,indent=2))
print(str(destination))
