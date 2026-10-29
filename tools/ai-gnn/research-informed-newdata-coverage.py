import json
from pathlib import Path
import torch
from model import GraphNet
from train import load_data,split_games,mixed_generation_weights
root=Path('tools/ai-gnn/target/fresh-data-study-20261028')
torch.set_num_threads(2);plan=json.loads((root/'plan.json').read_text(encoding='utf-8'));pin=json.loads((root/'split.json').read_text(encoding='utf-8'))
records=[r for r in load_data([plan['legacyData'],root/'fresh-validation.jsonl.gz']) if r['record'].get('decisionReason')!='certified-loss']
_,items=split_games(records,0,pin);weights=mixed_generation_weights(items,.3)
adjacency={}
for t in json.loads((root/'topologies.json').read_text(encoding='utf-8')):
 a=torch.zeros(160,160)
 for p,neighbors in enumerate(t['neighbors']):a[p,neighbors]=1/len(neighbors)
 adjacency[t['kind'],t['size']]=a
device='cuda' if torch.cuda.is_available() else 'cpu';results=[]
for name in ['baseline','Control-r0-model','NewData-r0-model']:
 model=GraphNet().eval().to(device);model.load_state_dict(torch.load(root/name/'weights.pt',map_location=device,weights_only=True))
 groups={}
 for start in range(0,len(items),64):
  chunk=items[start:start+64];legal=torch.stack([r['legal'] for r in chunk]).to(device)
  args=[torch.stack([r[k] for r in chunk]).to(device) for k in ['x','mask','global_features']]
  adj=torch.stack([adjacency[r['record']['kind'],r['record']['size']] for r in chunk]).to(device)
  with torch.no_grad():rank=model(args[0],adj,args[1],args[2])[0].masked_fill(~legal,-float('inf')).argsort(dim=-1,descending=True,stable=True).cpu()
  for i,(r,order) in enumerate(zip(chunk,rank)):
   m=r['record'];target=r['selection_policy'];best=int(target.argmax());mass=float(target[order[:8]].sum());recall=float(best in order[:8]);w=weights[start+i]
   for key in ['all',m['kind']+str(m['size']),'fresh' if m.get('replayGeneration',0)==1 else 'legacy']:
    cell=groups.setdefault(key,dict(positions=0,mass=0.,recall=0.,weight=0.,weightedMass=0.,weightedRecall=0.))
    cell['positions']+=1;cell['mass']+=mass;cell['recall']+=recall;cell['weight']+=w;cell['weightedMass']+=w*mass;cell['weightedRecall']+=w*recall
 for cell in groups.values():
  cell['top8Mass']=cell.pop('mass')/cell['positions'];cell['top8Recall']=cell.pop('recall')/cell['positions']
  cell['weightedTop8Mass']=cell.pop('weightedMass')/cell['weight'];cell['weightedTop8Recall']=cell.pop('weightedRecall')/cell['weight']
 results.append(dict(model=name,groups=groups))
(root/'results/coverage-diagnostic.json').write_text(json.dumps(dict(role='Explanatory common-validation diagnostic only; not independent strength evidence or model-selection override. Legal NN ranking does not include tactical pruning.',results=results),indent=2)+'\n',encoding='utf-8')
print(json.dumps([dict(model=r['model'],overall=r['groups']['all'],fresh=r['groups']['fresh']) for r in results]))
