"""Check paired learning tensors and the preregistered whole-game split."""
import argparse,hashlib,json
from pathlib import Path
import torch
from train import load_data,split_games,sampling_weights
p=argparse.ArgumentParser();p.add_argument('--control',required=True);p.add_argument('--teacher',required=True);p.add_argument('--split',required=True);p.add_argument('--output',required=True);a=p.parse_args()
if Path(a.output).exists():raise ValueError('Output already exists')
torch.set_num_threads(4);left=load_data([a.control]);right=load_data([a.teacher]);fixed=json.loads(Path(a.split).read_text())
assert len(left)==len(right) and len(left)>0
changed=0;digest=hashlib.sha256()
for x,y in zip(left,right):
 for row in (x,y):
  target=row['record']['targetSearch'];assert 1<=target['completedVisits']<=target['requestedVisits']
  if not target['provenLoss']:assert target['completedVisits']==target['requestedVisits']
 for key in ['x','mask','global_features','legal','own','selection_policy']:assert torch.equal(x[key],y[key]),key
 for key in ['gameId','positionId','kind','size','ply','wdl','score','source','decisionReason','policyEligible']:assert x['record'][key]==y['record'][key],key
 assert x['policy_weight']==y['policy_weight'];changed+=not torch.equal(x['policy'],y['policy']);digest.update(x['record']['positionId'].encode())
 for key in ['x','mask','global_features','legal','own','selection_policy']:digest.update(x[key].numpy().tobytes())
train1,val1=split_games(left,2026102683,fixed);train2,val2=split_games(right,2026102683,fixed)
for one,two in [(train1,train2),(val1,val2)]:
 assert [r['record']['positionId'] for r in one]==[r['record']['positionId'] for r in two]
 assert sampling_weights(one)==sampling_weights(two)
assert {r['record']['gameId'] for r in train1}==set(fixed['trainGames'])
assert {r['record']['gameId'] for r in val1}==set(fixed['validationGames'])
report={'schemaVersion':1,'positions':len(left),'changedTrainingPolicies':changed,'sharedTrainingTensors':True,'sharedSamplingWeightsAndOrder':True,'trainPositions':len(train1),'validationPositions':len(val1),'trainGames':len(fixed['trainGames']),'validationGames':len(fixed['validationGames']),'commonTensorSha256':digest.hexdigest(),'inputs':{f:hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in [a.control,a.teacher,a.split]}}
Path(a.output).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
