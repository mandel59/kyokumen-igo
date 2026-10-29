"""Registered Soft4 loss/architecture checks; no match outcomes are consumed."""
import hashlib,json
from pathlib import Path
import torch
from model import GraphNet
ROOT=Path('tools/ai-gnn/target/research-informed-study-20261028')
torch.set_num_threads(4)
plan=json.loads((ROOT/'plan.json').read_text(encoding='utf-8'));rows=[]
for replica,seed in enumerate(plan['phase1']['training']['seeds']):
 for arm in plan['phase1']['arms']:
  name=arm['id']+'-r'+str(replica);folder=ROOT/(name+'-model');m=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
  state=torch.load(folder/'weights.pt',map_location='cpu',weights_only=True)
  training=torch.load(folder/'selected-training-weights.pt',map_location='cpu',weights_only=True)
  assert sum(v.numel() for v in state.values())==120905 and not any(k.startswith('auxiliary_') for k in state)
  assert all(torch.equal(v,training[k]) for k,v in state.items())
  assert len((folder/'weights.f32').read_bytes())==120905*4
  assert hashlib.sha256((folder/'model.onnx').read_bytes()).hexdigest()==m['sha256']
  assert m['selectionCorpusSha256']==json.loads((ROOT/'Control-r0-model/manifest.json').read_text(encoding='utf-8'))['selectionCorpusSha256']
  model=GraphNet().eval();model.load_state_dict(state)
  inputs=json.loads((folder/'golden.json').read_text(encoding='utf-8'))
  args=[torch.tensor(inputs['inputs'][k]['data']).reshape(inputs['inputs'][k]['shape']) for k in ['x','adjacency','mask','global_features']]
  with torch.no_grad():output=model(*args)
  errors={}
  for key,actual in zip(['policy','wdl','score','ownership'],output):
   target=torch.tensor(inputs['outputs'][key]['data']).reshape(inputs['outputs'][key]['shape'])
   errors[key]=float((actual-target).abs().max());torch.testing.assert_close(actual,target,atol=2e-5,rtol=1e-5)
  initial=m['initialSelectionMetrics']['loss'];loss=m['selectionMetrics']['loss'];gain=1-loss/initial
  ratios={k:v['loss']/m['initialValidationGroups'][k]['loss'] for k,v in m['validationGroups'].items() if k.startswith('board/')}
  eligible=arm['id']=='Control' or (m['selectedEpoch']>0 and gain>=.001 and max(ratios.values())<=1.02)
  rows.append(dict(id=name,arm=arm['id'],replica=replica,seed=seed,eligible=eligible,selectedEpoch=m['selectedEpoch'],initialLoss=initial,selectedLoss=loss,relativeGain=gain,perBoardRatios=ratios,inferenceParameters=m['parameters'],trainingParameters=m['trainableParameters'],exportParityMaxErrors=errors,sha256=m['sha256']))
result=dict(schemaVersion=1,results=rows,bothSoftReplicasEligible=all(r['eligible'] for r in rows if r['arm']=='Soft4'),notes='Control remains a valid comparator even with epoch0. Auxiliary loss is excluded from common validation and checkpoint selection. Numerical/Worker checks are additional required gates.')
(ROOT/'results/preflight.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(bothSoftReplicasEligible=result['bothSoftReplicasEligible'],results=[{k:r[k] for k in ['id','eligible','selectedEpoch','relativeGain']} for r in rows])))
