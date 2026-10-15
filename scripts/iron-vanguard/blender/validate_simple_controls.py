"""Exercise the actual selection/gizmo operators on a disposable action, then restore."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
rig=bpy.data.objects['IV_Rig'];scene=bpy.context.scene
assert rig.get('simple_posing_controls')
base=rig.animation_data.action;frame=scene.frame_current
before={b.name:b.matrix.copy() for b in rig.pose.bones}
window=bpy.context.window_manager.windows[0]
area=next(a for a in window.screen.areas if a.type=='VIEW_3D')
region=next(r for r in area.regions if r.type=='WINDOW')
report=[]
trial=None
try:
    with bpy.context.temp_override(window=window,area=area,region=region):
        for role,target,wrist in [('Left hand','MCH_Hammer_Hand_L','LeftHand'),('Right hand','MCH_Hammer_Hand_R','RightHand'),
                                  ('Weapon','CTRL_Hammer',None),('Left elbow','CTRL_Elbow_L',None),('Right elbow','CTRL_Elbow_R',None)]:
            for tool in (('MOVE','ROTATE') if 'elbow' not in role else ('MOVE',)):
                trial=base.copy();trial.name='IV_Control_Test';rig.animation_data.action=trial
                if trial.slots:rig.animation_data.action_slot=trial.slots[0]
                scene.frame_set(frame);bpy.context.view_layer.update()
                start=rig.pose.bones[target].matrix.copy()
                weapon=bpy.data.objects['IV_Hammer'].matrix_world.copy()
                tips={side:rig.pose.bones[side+'Hand'].matrix.copy() for side in ('Left','Right')}
                bpy.ops.iv.select_posing_control(role=role,tool=tool)
                assert rig.data.bones.active.name==target
                assert [p.name for p in rig.pose.bones if p.select]==[target]
                if tool=='MOVE':bpy.ops.transform.translate(value=(.01,0,0),orient_type='GLOBAL')
                else:bpy.ops.transform.rotate(value=math.radians(5),orient_axis='Y',orient_type='GLOBAL')
                bpy.context.view_layer.update()
                end=rig.pose.bones[target].matrix.copy()
                movement=(end.translation-start.translation).length
                angle=start.to_quaternion().rotation_difference(end.to_quaternion()).angle
                if tool=='MOVE':assert abs(movement-.01)<1e-4,(role,movement)
                else:assert abs(angle-math.radians(5))<1e-4,(role,angle)
                row={'control':role,'operation':tool,'translation_m':movement,'rotation_degrees':math.degrees(angle)}
                if wrist:
                    hand=rig.pose.bones[wrist].matrix.copy()
                    row['hand_target_error_m']=(hand.translation-end.translation).length
                    row['wrist_rotation_error_degrees']=math.degrees(hand.to_quaternion().rotation_difference(end.to_quaternion()).angle)
                    assert row['hand_target_error_m']<.001,row
                    assert row['wrist_rotation_error_degrees']<.1,row
                    assert max(abs(weapon[i][j]-bpy.data.objects['IV_Hammer'].matrix_world[i][j]) for i in range(4) for j in range(4))<1e-5
                if role=='Weapon':
                    for side in ('Left','Right'):
                        actual=rig.pose.bones[side+'Hand'].matrix.translation
                        expected=rig.pose.bones['MCH_Hammer_Hand_'+side[0]].matrix.translation
                        assert (actual-expected).length<.001
                    assert (bpy.data.objects['IV_Hammer'].matrix_world.translation-weapon.translation).length>1e-5 or tool=='ROTATE'
                if 'elbow' in role:
                    for side in ('Left','Right'):
                        assert (rig.pose.bones[side+'Hand'].matrix.translation-tips[side].translation).length<.001
                bpy.ops.iv.key_hold()
                scene.frame_set(frame+1);scene.frame_set(frame);bpy.context.view_layer.update()
                row['frame_reload_error']=max(abs(end[i][j]-rig.pose.bones[target].matrix[i][j]) for i in range(4) for j in range(4))
                assert row['frame_reload_error']<1e-5,row
                report.append(row)
                rig.animation_data.action=base
                if base.slots:rig.animation_data.action_slot=base.slots[0]
                bpy.data.actions.remove(trial);trial=None
                scene.frame_set(frame)
finally:
    rig.animation_data.action=base
    if base.slots:rig.animation_data.action_slot=base.slots[0]
    if trial:bpy.data.actions.remove(trial)
    scene.frame_set(frame);bpy.context.view_layer.update()
    with bpy.context.temp_override(window=window,area=area,region=region):
        bpy.ops.iv.select_posing_control(role='Left hand',tool='MOVE')
restored=max(max(abs(before[p.name][i][j]-p.matrix[i][j]) for i in range(4) for j in range(4)) for p in rig.pose.bones)
assert restored<1e-5,restored
result={'checks':report,'restored_pose_error':restored,'note':'Control behavior only; no visual grip approval.'}
Path(bpy.data.filepath).with_name('simple-controls-validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath,compress=True)
with bpy.context.temp_override(window=window,area=area,region=region):
    bpy.ops.screen.screenshot(filepath=str(Path(bpy.data.filepath).with_name('posing-panel.png')))
print(json.dumps(result))
