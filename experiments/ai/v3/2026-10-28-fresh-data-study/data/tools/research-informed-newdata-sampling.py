import json
from pathlib import Path
import torch
from train import load_data,split_games,mixed_generation_weights
root=Path('tools/ai-gnn/target/fresh-data-study-20261028')
torch.set_num_threads(2)
plan=json.loads((root/'plan.json').read_text(encoding='utf-8'));pin=json.loads((root/'split.json').read_text(encoding='utf-8'))
reports={}
for arm,path in [('Control','fresh-validation.jsonl.gz'),('NewData','fresh-all.jsonl.gz')]:
 records=[r for r in load_data([plan['legacyData'],root/path]) if r['record'].get('decisionReason')!='certified-loss']
 tr,va=split_games(records,0,pin);result={}
 for split,items in [('train',tr),('validation',va)]:
  weights=mixed_generation_weights(items,.3);boards={}
  for r,w in zip(items,weights):
   m=r['record'];key=m['kind']+str(m['size']);cell=boards.setdefault(key,dict(mass=0.,freshMass=0.,positions=0,freshPositions=0))
   cell['mass']+=w;cell['positions']+=1
   if m.get('replayGeneration',0)==1:cell['freshMass']+=w;cell['freshPositions']+=1
  for key,b in boards.items():
   assert abs(b['mass']-1/9)<1e-10
   b['freshFraction']=b['freshMass']/b['mass']
   expected=.3 if b['freshPositions'] else 0.
   assert abs(b['freshFraction']-expected)<1e-10
  result[split]=boards
 assert (arm=='NewData')==any(r['record'].get('replayGeneration',0)==1 for r in tr)
 reports[arm]=result
assert reports['Control']['validation']==reports['NewData']['validation']
(root/'results/sampling-audit.json').write_text(json.dumps(dict(passed=True,allBoardsEqualMass=True,sharedValidationWeights=True,reports=reports),indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(passed=True,trainingPositions={arm:sum(b['positions'] for b in report['train'].values()) for arm,report in reports.items()})))
