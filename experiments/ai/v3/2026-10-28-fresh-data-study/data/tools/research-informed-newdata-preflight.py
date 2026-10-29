"""Registered NewData loss/architecture checks; no match outcomes are consumed."""
import hashlib,json
from pathlib import Path
import torch
from model import GraphNet
ROOT=Path('tools/ai-gnn/target/fresh-data-study-20261028')
torch.set_num_threads(4)
plan=json.loads((ROOT/'plan.json').read_text(encoding='utf-8'));rows=[]
for replica,seed in enumerate([plan['training']['seed']]):
 for arm in plan['training']['arms']:
  name=arm['id']+'-r'+str(replica);folder=ROOT/(name+'-model');m=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
  state=torch.load(folder/'weights.pt',map_location='cpu',weights_only=True)
  assert sum(v.numel() for v in state.values())==120905 and not any(k.startswith('auxiliary_') for k in state)
  expected=b''.join((v.T if v.ndim==2 else v).contiguous().numpy().astype('<f4').tobytes() for v in state.values())
  assert (folder/'weights.f32').read_bytes()==expected
  assert hashlib.sha256(expected).hexdigest()==m['webgpu']['sha256']
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
  assert m['samplesPerEpoch']==9263 and all(h['sampledPositions']==9263 and h['optimizerSteps']==145 for h in m['history'])
  eligible=arm['id']=='Control' or (m['selectedEpoch']>0 and gain>=.001 and max(ratios.values())<=1.02)
  rows.append(dict(id=name,arm=arm['id'],replica=replica,seed=seed,eligible=eligible,selectedEpoch=m['selectedEpoch'],initialLoss=initial,selectedLoss=loss,relativeGain=gain,perBoardRatios=ratios,inferenceParameters=m['parameters'],trainingParameters=m['trainableParameters'],exportParityMaxErrors=errors,sha256=m['sha256']))
result=dict(schemaVersion=1,results=rows,newDataEligible=all(r['eligible'] for r in rows if r['arm']=='NewData'),notes='Control remains a valid comparator even with epoch0. Both arms use identical common old+fresh validation and optimizer-step count. Numerical/Worker checks are additional required gates.')
(ROOT/'results/preflight.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(newDataEligible=result['newDataEligible'],results=[{k:r[k] for k in ['id','eligible','selectedEpoch','relativeGain']} for r in rows])))
