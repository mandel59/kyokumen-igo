"""Explanatory validation-only retention drift; not an adoption or tuning gate."""
import json,hashlib
from pathlib import Path
import torch
from torch.nn import functional as F
from model import GraphNet
from train import load_data,split_games,curve_retention_loss,mixed_generation_weights
root=Path('tools/ai-gnn/target/curve-retention-study-20261029')
torch.set_num_threads(2);plan=json.loads((root/'plan.json').read_text(encoding='utf-8'));pin=json.loads((root/'split.json').read_text(encoding='utf-8'))
records=[r for r in load_data([plan['data']['legacy'],plan['data']['fresh']]) if r['record'].get('decisionReason')!='certified-loss']
_,validation=split_games(records,0,pin);items=[r for r in validation if r['record']['kind']!='plane']
adjacency={}
for t in json.loads((root/'topologies.json').read_text(encoding='utf-8')):
 a=torch.zeros(160,160)
 for p,neighbors in enumerate(t['neighbors']):a[p,neighbors]=1/len(neighbors)
 adjacency[t['kind'],t['size']]=a
device='cuda' if torch.cuda.is_available() else 'cpu'
baseline=GraphNet().to(device).eval();baseline.load_state_dict(torch.load(root/'baseline/weights.pt',map_location=device,weights_only=True))
results=[]
for arm in plan['arms']:
 name=arm['id']+'-r0';model=GraphNet().to(device).eval();model.load_state_dict(torch.load(root/(name+'-model/weights.pt'),map_location=device,weights_only=True))
 groups={}
 for start in range(0,len(items),64):
  batch=items[start:start+64];legal=torch.stack([r['legal'] for r in batch]).to(device);mask=torch.stack([r['mask'] for r in batch]).to(device)
  inputs=[torch.stack([r[k] for r in batch]).to(device) for k in ['x','global_features']]
  adj=torch.stack([adjacency[r['record']['kind'],r['record']['size']] for r in batch]).to(device)
  with torch.no_grad():
   old=baseline(inputs[0],adj,mask,inputs[1]);out=model(inputs[0],adj,mask,inputs[1])
   targets=dict(policy=old[0].masked_fill(~legal,-1e9).softmax(-1),wdl=old[1].softmax(-1),score=old[2],ownership=old[3].softmax(-1))
   policy=F.kl_div(out[0].masked_fill(~legal,-1e9).log_softmax(-1),targets['policy'],reduction='none').sum(-1)
   value=F.kl_div(out[1].log_softmax(-1),targets['wdl'],reduction='none').sum(-1)
   total=curve_retention_loss(out,targets,legal,mask.squeeze(-1))
  for r,p,v,l in zip(batch,policy.cpu().tolist(),value.cpu().tolist(),total.cpu().tolist()):
   key=r['record']['kind']+str(r['record']['size']);g=groups.setdefault(key,dict(count=0,policyKL=0.,wdlKL=0.,retentionLoss=0.))
   g['count']+=1;g['policyKL']+=p;g['wdlKL']+=v;g['retentionLoss']+=l
 for g in groups.values():
  for k in ['policyKL','wdlKL','retentionLoss']:g[k]/=g['count']
 mean={k:sum(g[k] for g in groups.values())/len(groups) for k in ['policyKL','wdlKL','retentionLoss']}
 results.append(dict(id=name,equalBoardMean=mean,boards=groups))
(root/'results/curve-drift-diagnostic.json').write_text(json.dumps(dict(role='Common-validation diagnostic only; output drift is not playing strength and does not select a candidate.',results=results),indent=2)+'\n',encoding='utf-8')
print(json.dumps([dict(id=r['id'],**r['equalBoardMean']) for r in results]))
