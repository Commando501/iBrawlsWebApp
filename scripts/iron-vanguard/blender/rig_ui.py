"""Optional iBrawls Blender sidebar. Run this text once from the master Text Editor."""
import bpy
from mathutils import Matrix


def get_rig(context):
    return context.scene.objects.get('IV_Rig')



def posing_controls(rig):
    mode=int(rig.get('weapon_mode',0))
    weapon='CTRL_Hammer' if mode==1 else 'CTRL_Sword' if mode==2 else None
    left='MCH_Hammer_Hand_L' if mode==1 else 'CTRL_Hand_L'
    right='MCH_Hammer_Hand_R' if mode==1 else 'MCH_Sword_Hand_R' if mode==2 else 'CTRL_Hand_R'
    return [('Weapon',weapon),('Left hand',left),('Right hand',right),
            ('Left elbow','CTRL_Elbow_L'),('Right elbow','CTRL_Elbow_R')]


def show_posing_controls(context,rig):
    visible={name for _,name in posing_controls(rig) if name}
    for coll in rig.data.collections_all:
        coll.is_solo=False
        coll.is_visible=any(b.name in visible for b in coll.bones)
    for bone in rig.data.bones:bone.hide=bone.name not in visible
    for pb in rig.pose.bones:pb.hide=pb.name not in visible
    rig.show_in_front=True
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.overlay.show_overlays=True
                area.spaces.active.overlay.show_bones=True
                area.spaces.active.show_gizmo=True
                area.spaces.active.overlay.show_extras=False


class IV_OT_SelectControl(bpy.types.Operator):
    bl_idname='iv.select_posing_control'
    bl_label='Select posing control'
    bl_description='Select this control and show its movement arrows or rotation rings'
    role: bpy.props.StringProperty()
    tool: bpy.props.EnumProperty(items=[('MOVE','Move',''),('ROTATE','Rotate','')],default='MOVE')
    def execute(self,context):
        rig=get_rig(context)
        name=dict(posing_controls(rig)).get(self.role) if rig else None
        if not name:return {'CANCELLED'}
        if context.object and context.object.mode!='OBJECT' and context.object!=rig:
            bpy.ops.object.mode_set(mode='OBJECT')
        rig.hide_set(False);rig.select_set(True);context.view_layer.objects.active=rig
        if rig.mode!='POSE':bpy.ops.object.mode_set(mode='POSE')
        show_posing_controls(context,rig)
        for pb in rig.pose.bones:pb.select=False
        bone=rig.data.bones[name];rig.pose.bones[name].select=True;rig.data.bones.active=bone
        context.scene.transform_orientation_slots[0].type='GLOBAL'
        bpy.ops.wm.tool_set_by_id(name='builtin.move' if self.tool=='MOVE' else 'builtin.rotate')
        return {'FINISHED'}


class IV_OT_KeyHold(bpy.types.Operator):
    bl_idname='iv.key_hold'
    bl_label='Keep pose at this frame'
    bl_description='Store current grip and elbow adjustments in the active action'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        rig=get_rig(context)
        if not rig:return {'CANCELLED'}
        frame=context.scene.frame_current
        for name in {name for _,name in posing_controls(rig) if name}:
            pb=rig.pose.bones[name]
            rotation='rotation_quaternion' if pb.rotation_mode=='QUATERNION' else 'rotation_axis_angle' if pb.rotation_mode=='AXIS_ANGLE' else 'rotation_euler'
            for path in ('location',rotation,'scale'):pb.keyframe_insert(path,frame=frame)
        for side in ('L','R'):
            pb=rig.pose.bones['CTRL_Hand_'+side]
            for prop in ('grip','thumb_opposition','index_curl','middle_curl','ring_curl','pinky_curl','thumb_curl'):
                pb.keyframe_insert('["'+prop+'"]',frame=frame)
        self.report({'INFO'},'Pose stored at frame '+str(frame)+'; save the Blender file to keep it on disk')
        return {'FINISHED'}


class IV_PT_Posing(bpy.types.Panel):
    bl_label='Pose the hold'
    bl_idname='IV_PT_posing'
    bl_space_type='VIEW_3D'
    bl_region_type='UI'
    bl_category='iBrawls'
    @classmethod
    def poll(cls,context):return get_rig(context) is not None
    def draw(self,context):
        layout=self.layout;rig=get_rig(context)
        row=layout.row(align=True)
        for label,name in [('Hammer hold','IV_Hammer_ElbowsCorrected'),('Sword hold','IV_Sword_ElbowsCorrected')]:
            if name in bpy.data.actions:
                op=row.operator('iv.choose_action',text=label);op.action_name=name
        row=layout.row(align=True)
        for label,name in [('Hammer idle','IV_Hammer_Idle'),('Sword idle','IV_Sword_Idle')]:
            if name in bpy.data.actions:
                op=row.operator('iv.choose_action',text=label);op.action_name=name
        if 'IV_Hammer_Attack' in bpy.data.actions:
            op=layout.operator('iv.choose_action',text='Hammer attack');op.action_name='IV_Hammer_Attack'
        active=rig.animation_data.action if rig.animation_data else None
        if active and (active.get('iv_loop_end') or active.get('iv_clip_end')):
            kind='attack' if active.get('iv_clip_end') else 'idle'
            layout.operator('iv.play_preview',text=('Pause ' if context.screen.is_animation_playing else 'Play ')+kind,icon='PAUSE' if context.screen.is_animation_playing else 'PLAY')
        layout.label(text='Choose a part, then drag its gizmo.')
        for label,name in posing_controls(rig):
            if not name:continue
            row=layout.row(align=True);row.label(text=label)
            op=row.operator('iv.select_posing_control',text='Move');op.role=label;op.tool='MOVE'
            if 'elbow' not in label:
                op=row.operator('iv.select_posing_control',text='Rotate');op.role=label;op.tool='ROTATE'
        layout.label(text='Hand moves: arm follows, weapon stays.')
        layout.label(text='Weapon moves: attached hands follow.')
        layout.prop(context.scene.tool_settings,'use_keyframe_insert_auto',text='Remember moves automatically')
        layout.operator('iv.key_hold',icon='KEY_HLT')
        layout.label(text='Ctrl+S saves the file.')


class IV_OT_Action(bpy.types.Operator):
    bl_idname='iv.choose_action'
    bl_label='Load rig pose'
    bl_options={'REGISTER','UNDO'}
    action_name: bpy.props.StringProperty()
    def execute(self,context):
        rig=get_rig(context);action=bpy.data.actions.get(self.action_name)
        if not rig or not action:return {'CANCELLED'}
        rig.animation_data_create();rig.animation_data.action=action
        if action.slots:rig.animation_data.action_slot=action.slots[0]
        if context.screen and context.screen.is_animation_playing:bpy.ops.screen.animation_cancel(restore_frame=False)
        context.scene.frame_start=1
        preview_end=action.get('iv_loop_end') or action.get('iv_clip_end')
        if preview_end:
            context.scene.frame_end=int(preview_end)
            if 'iv_auto_key_before_idle' not in rig:rig['iv_auto_key_before_idle']=context.scene.tool_settings.use_keyframe_insert_auto
            context.scene.tool_settings.use_keyframe_insert_auto=False
        elif self.action_name.endswith('GripCheck'):
            context.scene.frame_end=91
        else:context.scene.frame_end=239
        if not preview_end and 'iv_auto_key_before_idle' in rig:
            context.scene.tool_settings.use_keyframe_insert_auto=bool(rig['iv_auto_key_before_idle']);del rig['iv_auto_key_before_idle']
        context.scene.use_preview_range=False
        context.scene.frame_set(1)
        rig.update_tag();context.view_layer.update()
        if rig.get('simple_posing_controls'):show_posing_controls(context,rig)
        return {'FINISHED'}


class IV_OT_PlayPreview(bpy.types.Operator):
    bl_idname='iv.play_preview'
    bl_label='Play / pause animation'
    bl_description='Play or pause the selected animation'
    def execute(self,context):
        bpy.ops.screen.animation_play()
        return {'FINISHED'}


class IV_OT_Editable(bpy.types.Operator):
    bl_idname='iv.editable_action'
    bl_label='Duplicate action for editing'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        rig=get_rig(context)
        if not rig or not rig.animation_data or not rig.animation_data.action:return {'CANCELLED'}
        action=rig.animation_data.action.copy();action.name=action.name.split('.')[0]+'_Edit'
        action.use_fake_user=True;rig.animation_data.action=action
        if action.slots:rig.animation_data.action_slot=action.slots[0]
        return {'FINISHED'}


class IV_OT_FreeIK(bpy.types.Operator):
    bl_idname='iv.free_ik'
    bl_label='Free IK from current pose'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        rig=get_rig(context)
        if not rig:return {'CANCELLED'}
        # Preserve the loaded template and capture the evaluated endpoints before disabling weapon following.
        if rig.animation_data and rig.animation_data.action:
            action=rig.animation_data.action.copy();action.name='IV_FreeIK_Edit';action.use_fake_user=True
            rig.animation_data.action=action
            if action.slots:rig.animation_data.action_slot=action.slots[0]
        desired={}
        for side,prefix in [('R','Right'),('L','Left')]:
            for part in ['Hand','Foot']:desired['CTRL_'+part+'_'+side]=rig.pose.bones[prefix+part].matrix.copy()
        frame=context.scene.frame_current
        for name,value in [('weapon_mode',0),('arm_ik_R',1.),('arm_ik_L',1.),('leg_ik_R',1.),('leg_ik_L',1.)]:
            rig[name]=value;rig.keyframe_insert(data_path=f'["{name}"]',frame=frame)
        rig.update_tag();context.view_layer.update()
        for name,matrix in desired.items():
            pb=rig.pose.bones[name];bone=pb.bone
            pb.matrix_basis=bone.convert_local_to_pose(matrix,bone.matrix_local,
                parent_matrix=pb.parent.matrix,parent_matrix_local=bone.parent.matrix_local,invert=True)
            pb.rotation_mode='QUATERNION'
            pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_quaternion',frame=frame)
        rig.update_tag();context.view_layer.update()
        return {'FINISHED'}


class IV_PT_Rig(bpy.types.Panel):
    bl_label='Pose library and advanced settings'
    bl_idname='IV_PT_rig'
    bl_parent_id='IV_PT_posing'
    bl_options={'DEFAULT_CLOSED'}
    bl_space_type='VIEW_3D'
    bl_region_type='UI'
    bl_category='iBrawls'
    @classmethod
    def poll(cls,context):return get_rig(context) is not None
    def draw(self,context):
        layout=self.layout;rig=get_rig(context)
        layout.label(text='Grip placement corrections')
        for label,name in [('Hammer grip correction','IV_Hammer_GripCorrection'),('Sword grip correction','IV_Sword_GripCorrection')]:
            if name in bpy.data.actions:
                op=layout.operator('iv.choose_action',text=label);op.action_name=name
        for label,name in [('Hammer grip check','IV_Hammer_CorrectedGripCheck'),('Sword grip check','IV_Sword_CorrectedGripCheck')]:
            if name in bpy.data.actions:
                op=layout.operator('iv.choose_action',text=label);op.action_name=name
        layout.label(text='Refined holding poses')
        for label,name in [('Hammer natural hold','IV_Hammer_NaturalHold'),('Sword natural hold','IV_Sword_NaturalHold')]:
            if name in bpy.data.actions:
                op=layout.operator('iv.choose_action',text=label);op.action_name=name
        layout.label(text='Pose / clip templates')
        for label,name in [('Hammer grip','IV_Hammer_Grip'),('Sword grip','IV_Sword_Grip'),
                           ('Bind pose','IV_Bind'),('Source motion','IV_SourceMotion_Root')]:
            op=layout.operator('iv.choose_action',text=label);op.action_name=name
        layout.operator('iv.editable_action')
        layout.operator('iv.free_ik')
        box=layout.box();box.label(text='Weapon: 0 free / 1 hammer / 2 sword')
        box.prop(rig,'["weapon_mode"]',text='Weapon mode')
        mode=int(rig.get('weapon_mode',0))
        if mode in (1,2):
            role='hammer' if mode==1 else 'sword'
            for axis in 'xyz':box.prop(rig,f'["{role}_size_{axis}"]',text=role.title()+' size '+axis.upper())
        box=layout.box();box.label(text='IK influence')
        for name in ['arm_ik_R','arm_ik_L','leg_ik_R','leg_ik_L']:box.prop(rig,f'["{name}"]',text=name)
        for side,label in [('R','Right hand'),('L','Left hand')]:
            ctrl=rig.pose.bones['CTRL_Hand_'+side]
            box=layout.box();box.label(text=label)
            for name in ['grip','thumb_opposition','index_curl','middle_curl','ring_curl','pinky_curl','thumb_curl']:
                box.prop(ctrl,f'["{name}"]',text=name.replace('_',' ').title())
        layout.label(text='Pose-mode ring controls: hands, feet,')
        layout.label(text='elbows, knees, hammer and sword.')


CLASSES=(IV_OT_Action,IV_OT_PlayPreview,IV_OT_Editable,IV_OT_FreeIK,IV_OT_SelectControl,IV_OT_KeyHold,IV_PT_Posing,IV_PT_Rig)
def register():
    for cls in reversed(CLASSES):
        old=getattr(bpy.types,cls.__name__,None)
        if old:
            try:bpy.utils.unregister_class(old)
            except RuntimeError:pass
    for cls in CLASSES:bpy.utils.register_class(cls)

if __name__=='__main__':register()
