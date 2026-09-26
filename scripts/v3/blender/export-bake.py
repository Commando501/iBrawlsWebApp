"""Export the currently edited Blender skeleton; does not regenerate its keys."""
import bpy, json, math
from pathlib import Path
from mathutils import Matrix, Vector

base=Path(__file__).resolve().parents[3]/'output'/'blender-repair'
timeline=json.loads((base/'repair-timeline.json').read_text())
reference=json.loads((base/'runtime-audit.json').read_text())
binding=json.loads((base/'bind.json').read_text())
definitions={c['id']:c for c in reference['clips']}
definitions.update({c['id']:c for c in json.loads(Path(__file__).with_name('extra-clips.json').read_text())})
scene=bpy.context.scene
arm=bpy.data.objects[scene.get('ibrawls_armature','iBrawls Unified Skeleton')]
saved_frame=scene.frame_current
C=Matrix.Rotation(math.pi/2,4,'X')
clips=[]
try:
    for entry in timeline:
        definition=definitions[entry['id']];samples=[]
        for frame in range(entry['duration']+1):
            scene.frame_set(entry['start']+frame);bpy.context.view_layer.update()
            world={p.name:C.inverted()@arm.matrix_world@p.matrix@C for p in arm.pose.bones}
            joints={}
            for p in arm.pose.bones:
                local=world[p.parent.name].inverted()@world[p.name] if p.parent else world[p.name]
                position,q,scale=local.decompose()
                if max(abs(x-1) for x in scale)>.0001:raise ValueError(f'Unsupported scale on {p.name}')
                joints[p.name]=[round(x,6) for x in (*position,q.x,q.y,q.z,q.w)]
            sample={'joints':joints}
            if definition['weapon']:
                weapon=definition['weapon']
                wm=C.inverted()@bpy.data.objects[scene.get('ibrawls_weapon_'+weapon,'Repaired weapon_'+weapon)].matrix_world@C
                position,q,scale=wm.decompose()
                payload={'position':list(position),'quaternion':[q.x,q.y,q.z,q.w]}
                if weapon in ('hammer','pistol'):
                    contact=world['hand_l']@Vector(binding['sockets']['leftHandGrip']['p'])
                    payload['offhand']=list(wm.inverted()@contact)
                sample['weapon']=payload
            samples.append(sample)
        clips.append({'id':entry['id'],'durationFrames':entry['duration'],'loop':definition['loop'],
                      'weapon':definition['weapon'],**({'releaseFrame':definition['releaseFrame']} if 'releaseFrame' in definition else {}),'samples':samples})
    (base/'blender-authored-clips.json').write_text(json.dumps(
        {'schema':1,'fps':60,'space':'three-y-up-game-forward-minus-z','clips':clips},separators=(',',':')))
finally:
    scene.frame_set(saved_frame)
print(f'Exported {len(clips)} edited Blender clips')
