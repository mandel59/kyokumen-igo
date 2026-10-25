"""CPU correctness tests; this does not measure playing strength."""
import json
from pathlib import Path
import torch
from model import GraphNet
from teacher_model import TeacherConfig,TeacherNet,bootstrap,structural_inputs,tensor_hash

torch.set_num_threads(4)
root=Path(__file__).resolve().parents[2]
source=torch.load(root/'experiments/ai/v3/2026-10-22-learning-revision/data/round1-t0/weights.pt',map_location='cpu',weights_only=True)
base=GraphNet().eval();base.load_state_dict(source)
golden=json.loads((root/'tests/fixtures/ai/v3-golden.json').read_text())
inputs=[torch.tensor(golden['inputs'][name]['data']).reshape(golden['inputs'][name]['shape']) for name in ['x','adjacency','mask','global_features']]
records=[]
with torch.inference_mode():
 expected=base(*inputs)
 for config in [TeacherConfig(64,6,0,8,32,64),TeacherConfig(128,8,0,8,64,128),TeacherConfig(256,20,0,8,128,256),TeacherConfig(128,6,2,4,64,128)]:
  model=bootstrap(source,config).eval();structure=structural_inputs(*inputs[:3],config.max_distance) if config.attention_blocks else ()
  actual=model(*inputs,*structure)
  errors=[float((a-b).abs().max()) for a,b in zip(actual,expected)]
  assert max(errors)<3e-4,errors
  if config.hidden==64:assert max(errors)==0
  assert tensor_hash(model.state_dict())==tensor_hash(bootstrap(source,config).state_dict())
  records.append({'config':vars(config),'parameters':sum(p.numel() for p in model.parameters()),'maxErrors':errors,'tensorHash':tensor_hash(model.state_dict())})
# Fresh, active attention weights exercise the structural encoding, not identity bootstrap branches.
torch.manual_seed(8)
model=TeacherNet(TeacherConfig(64,6,2,4,32,64)).eval()
x,adj,mask,glob=inputs
# Golden is a real board. Add a second sample with a different stone pattern.
x=x.clone();mask=mask.clone();glob=glob.clone()
x[1,:10,:3]=torch.tensor([0.,1.,0.]);x[1,10:20,:3]=torch.tensor([0.,0.,1.])
structure=structural_inputs(x,adj,mask)
permutation=torch.randperm(160)
xp,ap,mp=x[:,permutation],adj[:,permutation][:,:,permutation],mask[:,permutation]
sp=structural_inputs(xp,ap,mp)
assert torch.equal(structure[0][:,permutation][:,:,permutation],sp[0])
with torch.inference_mode():
 actual=model(x,adj,mask,glob,*structure);permuted=model(xp,ap,mp,glob,*sp)
 expected=[torch.cat((actual[0][:,:160][:,permutation],actual[0][:,160:]),-1),actual[1],actual[2],actual[3][:,permutation]]
 errors=[float((a-b).abs().max()) for a,b in zip(permuted,expected)]
 assert max(errors)<3e-5,errors
model.train();output=model(x,adj,mask,glob,*structure);sum(y.square().mean() for y in output).backward()
assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters())
try:structural_inputs(x,adj,torch.zeros_like(mask));raise AssertionError('Empty graph accepted')
except ValueError:pass
for config in [TeacherConfig(hidden=65,attention_blocks=1),TeacherConfig(blocks=0),TeacherConfig(hidden=True)]:
 try:config.validate();raise AssertionError('Invalid config accepted')
 except ValueError:pass
print(json.dumps({'bootstrap':records,'permutationMaxErrors':errors,'finiteGradients':True},indent=2))
