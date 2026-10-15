"""Retime the reviewed 115-frame attack path, preserving its sampled poses."""
import bpy,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from author_idles import signature
from build_master import set_action
from rig_master import update
mapping=[(1,1),(41,41),(48,51),(52,57),(55,65),(67,81),(80,99),(90,111),(115,141)]
def remap(f):
    if f<=1:return f
    if f>=115:return f+26
    for (a,x),(b,y) in zip(mapping,mapping[1:]):
        if a<=f<=b:return x+(f-a)*(y-x)/(b-a)
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(exist_ok=True)
assert not (out/'attack-candidate.blend').exists()
report=json.loads((Path(bpy.data.filepath).parent/'attack-validation.json').read_text(encoding='utf-8'))
a=bpy.data.actions['IV_Hammer_Attack']
for layer in a.layers:
 for strip in layer.strips:
  for slot in a.slots:
   bag=strip.channelbag(slot)
   if not bag:continue
   for curve in bag.fcurves:
    for k in curve.keyframe_points:
     k.co.x=remap(k.co.x);k.handle_left.x=k.co.x;k.handle_right.x=k.co.x
    curve.update()
a['iv_clip_end']=141
a['iv_attack_phases']='Wind-up 1-41; strike 42-65; follow-through 66-81; recovery 82-141'
a['iv_retiming']='Extended strike and recovery; original dense poses preserved.'
s=bpy.context.scene;s.frame_end=141;s.frame_set(1);update()
assert all(signature(bpy.data.actions[n])==v for n,v in report['original_signatures'].items())
report['pre_retime_metrics']=report.pop('metrics')
report['pre_retime_full_sweep']=report.pop('full_sweep')
report['frame_mapping']=mapping
report['note']='Retimed draft. Clearance checks exclude hands and forearms; visual review and deformation polish remain.'
(out/'attack-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'attack-candidate.blend'),compress=True)
