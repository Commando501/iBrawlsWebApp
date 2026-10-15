"""Fit hand targets and digit curls against the actual weapon surfaces in a new master."""
import argparse,hashlib,json,math,sys,time
from pathlib import Path
import bpy,numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
from build_master import set_action,key_pose,linear_keys
from rig_master import update,render
DIGITS=['Index','Middle','Ring','Pinky','Thumb']

def clean_hand_weights(body,rig):
 groups=list(body.vertex_groups);names=[g.name for g in groups]
 w=np.zeros((len(body.data.vertices),len(groups)),dtype=np.float64)
 for v in body.data.vertices:
  for g in v.groups:w[v.index,g.group]=g.weight
 original=w.copy();coords=np.array([v.co[:] for v in body.data.vertices]);changed=[]
 edges=np.array([e.vertices[:] for e in body.data.edges]);src=np.concatenate((edges[:,0],edges[:,1]));dst=np.concatenate((edges[:,1],edges[:,0]))
 for side,prefix,sign in [('R','Right',1),('L','Left',-1)]:
  wrist=rig.data.bones[prefix+'Hand'].head_local
  u=(coords[:,0]-wrist.x)*sign
  members=[i for i,n in enumerate(names) if n==prefix+'Hand' or n.startswith('DEF_') and n.endswith('_'+side)]
  mask=(w[:,members].sum(1)>.60)&(u>.01)
  indices=np.flatnonzero(mask);changed.extend(indices.tolist())
  fore=names.index(prefix+'ForeArm');hand=names.index(prefix+'Hand')
  fade=np.clip((u-.01)/.035,0,1);fade=fade*fade*(3-2*fade)
  transfer=w[:,fore]*fade*mask;w[:,fore]-=transfer;w[:,hand]+=transfer
  # Smooth along mesh edges, rather than across adjacent but separate fingers.
  active=mask[src]&mask[dst];a=src[active];b=dst[active]
  count=np.bincount(a,minlength=len(w));safe=np.maximum(count,1)
  for _ in range(14):
   accum=np.zeros_like(w);np.add.at(accum,a,w[b]);average=accum/safe[:,None]
   valid=mask&(count>0);w[valid]=.55*w[valid]+.45*average[valid]
  # The raised plate on the back of each glove must follow the palm, not different fingers.
  dorsal=np.clip((coords[:,2]-wrist.z-.017)/.015,0,1)
  distal=np.clip((.155-u)/.025,0,1)
  plate=dorsal*distal*mask
  w*=1-plate[:,None];w[:,hand]+=plate
  for vi in indices:
   best=np.argsort(w[vi])[-4:];best=[int(j) for j in best if w[vi,j]>1e-6];total=sum(w[vi,j] for j in best)
   for g in list(body.data.vertices[vi].groups):groups[g.group].remove([int(vi)])
   for j in best:groups[j].add([int(vi)],float(w[vi,j]/total),'REPLACE')
 return {'hand_vertices_smoothed':len(changed),'region':'Hand/finger weights only; mesh-edge smoothing and distal forearm-weight removal.'}

class Fit:
 def __init__(self,rig,body,role,side):
  self.r=rig;self.body=body;self.role=role;self.side=side
  self.ctrl=rig.pose.bones['CTRL_Hand_'+side];self.target=rig.pose.bones['MCH_'+role+'_Hand_'+side]
  self.base=self.target.matrix.copy();self.weapon=rig.pose.bones['CTRL_'+role].matrix.copy();self.inv=self.weapon.inverted()
  obj=bpy.data.objects['IV_'+role]
  self.bvh=BVHTree.FromPolygons([self.inv@obj.matrix_world@v.co for v in obj.data.vertices],[tuple(p.vertices) for p in obj.data.polygons])
  hand='RightHand' if side=='R' else 'LeftHand'
  names=[hand]+[f'DEF_{d}_{j:02d}_{side}' for d in DIGITS for j in [1,2,3]]
  groups={g.index:g.name for g in body.vertex_groups}
  ids=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>.70]
  ids=ids[::max(1,len(ids)//1600)];self.ids=ids
  self.co=np.array([list(body.data.vertices[i].co)+[1] for i in ids])
  self.weights={n:np.array([sum(g.weight for g in body.data.vertices[i].groups if groups[g.group]==n) for i in ids]) for n in groups.values()}
  self.weights={n:w for n,w in self.weights.items() if np.max(w)>0}
  self.rest={n:rig.data.bones[n].matrix_local.inverted() for n in self.weights}
  self.masks={d:np.array([sum(g.weight for g in body.data.vertices[i].groups if groups[g.group].startswith('DEF_'+d+'_')) for i in ids])>.65 for d in DIGITS}
  self.initial=np.array([0.,0.,0.,0.,.95,.95,.95,.95,.95,.85,0.,0.])
  self.calls=0
 def apply(self,x):
  # World delta expressed in weapon-control coordinates; rest bones remain untouched.
  m=self.weapon@Matrix.Translation(x[:3])@Matrix.Rotation(float(x[3]),4,'Z')@Matrix.Rotation(float(x[10]),4,'X')@Matrix.Rotation(float(x[11]),4,'Y')@self.inv@self.base
  self.target.matrix=m
  self.ctrl['grip']=.8
  for i,d in enumerate(DIGITS):self.ctrl[d.lower()+'_curl']=float(x[4+i]-.8)
  self.ctrl['thumb_opposition']=float(x[9]);update()
 def points(self):
  p=np.zeros((len(self.ids),3))
  for name,w in self.weights.items():
   mat=np.array(self.inv@self.r.pose.bones[name].matrix@self.rest[name])
   p+=(self.co@mat.T)[:,:3]*w[:,None]
  return p
 def score(self,x,details=False):
  self.apply(x);points=self.points();signed=[]
  for p in points:
   q,n,idx,dist=self.bvh.find_nearest(Vector(p))
   signed.append(dist if (Vector(p)-q).dot(n)>=0 else -dist)
  signed=np.array(signed);inside=np.maximum(0,-signed-.001)
  # Penalize significant surface crossings; seat each finger close to the surface.
  penalty=8*np.mean(inside**2)+2*np.max(inside)**2
  gaps={}
  for d,mask in self.masks.items():
   distances=np.abs(signed[mask]);gap=float(np.percentile(distances,12));gaps[d]=gap
   penalty+=.5*max(0,gap-.0015)**2
  penalty+=.001*np.sum((x[:3]-self.initial[:3])**2)+.0000002*np.sum((x[4:9]-.85)**2)
  self.calls+=1
  if details:return {'score':float(penalty),'sampled_vertices':len(signed),'vertices_with_signed_depth_over_2mm':int(np.sum(signed<-.002)),'max_signed_depth_m':float(max(0,-min(signed))),'finger_near_surface_distance_m':gaps,'parameters':x.tolist(),'note':'Nearest-surface normal estimate on detailed meshes, not a watertight collision certificate.'}
  return penalty
 def optimize(self):
  x=self.initial.copy();before=self.score(x,True)
  # Seed each hand on a clear part of its handle before minimizing contact error.
  seeds=[x.copy()]
  if self.role=='Hammer':
   for dz in ([0,-.025,-.045] if self.side=='L' else [0,-.01]):
    q=x.copy();q[:3]=[-.004,-.022,dz];seeds.append(q)
  else:
   for dy in [-.012,0,.012]:
    q=x.copy();q[:3]=[.003,dy,-.008];seeds.append(q)
  for dx in [-.045,-.025,0,.025,.045]:
   for dy in [-.025,0,.025]:
    for curl in [.55,.8,1.05]:
     q=self.initial.copy();q[:3]=[dx,dy,-.045 if self.role=='Hammer' and self.side=='L' else 0];q[4:9]=curl;q[9]=.45;seeds.append(q)
  if self.role=='Sword':
   for dx in [-.03,0,.03]:
    for rx,ry in [(-.3,-.2),(.3,.2),(-.3,.2),(.3,-.2)]:
     q=self.initial.copy();q[:3]=[dx,0,0];q[10:12]=[rx,ry];seeds.append(q)
  x=min(seeds,key=self.score);best=self.score(x)
  limits=[(-.07,.07),(-.06,.05),(-.070,.020),(-.35,.35)]+[(.42,1.20)]*5+[(0,1),(-.50,.50),(-.50,.50)]
  for scale in [1,.5,.25,.10,.05]:
   steps=np.array([.010,.010,.012,.10,.14,.14,.14,.14,.14,.16,.10,.10])*scale
   for iteration in range(5):
    improved=False
    for j in range(len(x)):
     for sign in [-1,1]:
      trial=x.copy();trial[j]=np.clip(trial[j]+sign*steps[j],*limits[j]);value=self.score(trial)
      if value<best:best=value;x=trial;improved=True
    if not improved:break
   print('FIT_PROGRESS',self.role,self.side,scale,best,flush=True)
  self.apply(x)
  self.target.keyframe_insert('location',frame=1);self.target.keyframe_insert('rotation_quaternion',frame=1)
  for p in ['grip','thumb_opposition']+[d.lower()+'_curl' for d in DIGITS]:self.ctrl.keyframe_insert(data_path=f'["{p}"]',frame=1)
  after=self.score(x,True)
  return {'before':before,'after':after,'evaluations':self.calls}

def main():
 assert bpy.app.background
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True)
 a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);out=a.output.resolve();dest=out/'iron-vanguard-master.blend'
 assert not dest.exists();out.mkdir(parents=True,exist_ok=True)
 digest=hashlib.sha256(a.source.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(a.source.resolve()))
 s=bpy.data.scenes['CANONICAL_Master'];bpy.context.window.scene=s;r=bpy.data.objects['IV_Rig'];body=bpy.data.objects['IV_Body']
 targets=[p for p in r.pose.bones if p.name.startswith('MCH_') and '_Hand_' in p.name]
 # Every existing rig action explicitly resets newly animated hand offsets, preventing action-switch residue.
 for action in list(bpy.data.actions):
  if not action.name.startswith('IV_'):continue
  set_action(r,action)
  for p in targets:
   p.matrix_basis=Matrix.Identity(4);p.keyframe_insert('location',frame=1);p.keyframe_insert('rotation_quaternion',frame=1)
 report={'source':str(a.source.resolve()),'source_sha256':digest,'fits':{}}
 report['hand_weight_cleanup']=clean_hand_weights(body,r)
 for role in ['Hammer','Sword']:
  set_action(r,bpy.data.actions['IV_'+role+'_NaturalHold']);s.frame_set(1);update()
  action=r.animation_data.action.copy();action.name='IV_'+role+'_ContactHold';action.use_fake_user=True;set_action(r,action)
  report['fits'][role]={}
  for side in (['R','L'] if role=='Hammer' else ['R']):
   fit=Fit(r,body,role,side);report['fits'][role][side]=fit.optimize()
  linear_keys(action);s.frame_set(1);update()
  render(s,out,role.lower()+'-overview',(0,.12,1.3),(2,6,1),1.6,(1100,1100))
  for side,prefix in [('R','Right'),('L','Left')]:
   if side=='L' and role=='Sword':continue
   center=r.pose.bones[prefix+'Hand'].head
   for label,direction in [('front',(2,3,2)),('reverse',(-2,3,.5)),('palm',(1,-3,-1))]:render(s,out,role.lower()+'-'+side+'-'+label,center,direction,.34,(1100,1100))
 text=bpy.data.texts['IV_RIG_TOOLS.py'];text.clear();text.write((Path(__file__).parent/'rig_ui.py').read_text(encoding='utf-8-sig'))
 set_action(r,bpy.data.actions['IV_Hammer_ContactHold']);s.frame_set(1);update()
 assert hashlib.sha256(a.source.read_bytes()).hexdigest()==digest
 bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
 (out/'contact-fit.json').write_text(json.dumps(report,indent=2));print('FIT_COMPLETE',json.dumps(report),flush=True)
if __name__=='__main__':main()
