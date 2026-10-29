"""Post-hoc explanatory audit: separate smoothed teacher tails from raw search support."""
import collections,gzip,json,math
from pathlib import Path
import numpy as np
root=Path('tools/ai-gnn/target/research-informed-study-20261028')
plan=json.loads((root/'plan.json').read_text(encoding='utf-8'));pin=json.loads((root/'baseline/manifest.json').read_text(encoding='utf-8'))
groups=collections.defaultdict(lambda:collections.defaultdict(list))
for line in gzip.open(plan['phase0']['input'],'rt',encoding='utf-8'):
 r=json.loads(line)
 if r.get('decisionReason')=='certified-loss' or not r.get('policyEligible',True):continue
 mixed=np.asarray(r['policy'],dtype=float);mixed/=mixed.sum();legal=np.asarray(r['legal'],dtype=bool)
 if r['kind']=='plane':
  assert r['targetSearch']['requestedVisits']==512
  raw=(mixed-.02/legal.sum())/.98
  # The smallest positive root edge count is >=1/512; remove only FP32 mixture inversion residue.
  raw[raw<1e-7]=0.;raw[~legal]=0.
 else:raw=np.asarray(r['targetSearch']['policy'],dtype=float)
 assert raw.sum()>0;raw/=raw.sum()
 softened=mixed**.25;softened/=softened.sum()
 rawsoft=raw**.25;rawsoft/=rawsoft.sum()
 ent=lambda p:float(-(p*np.log(np.maximum(p,1e-30))).sum())
 values=dict(rawSupport=float((raw>0).sum()),mixedSupport=float((mixed>0).sum()),rawTail=float(np.sort(raw)[:-2].sum()),mixedTail=float(np.sort(mixed)[:-2].sum()),softenedMassOnRawZero=float(softened[raw==0].sum()),softenedEntropy=ent(softened),rawSoftenedEntropy=ent(rawsoft))
 split='train' if r['gameId'] in pin['trainGames'] else 'validation'
 for key in [split+'/all',split+'/'+r['kind'],split+'/'+r['kind']+str(r['size'])]:
  for m,v in values.items():groups[key][m].append(v)
result=dict(role='Post-hoc hypothesis only, after Soft4 preflight failed. No new training, tuning, or model-selection gate. Raw zero means unvisited/eliminated as well as disfavoured; it does not prove an action is bad.',planeRawReconstruction='Invert the documented2% legal-uniform mixture; truncate FP32 residual<1e-7, below the smallest possible positive1/512 root-edge mass.',groups={k:{m:dict(count=len(v),mean=float(np.mean(v)),median=float(np.median(v))) for m,v in a.items()} for k,a in groups.items()})
(root/'results/smoothing-diagnostic.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result['groups'].items() if k in ['train/all','train/plane','train/sphere','train/torus']}))
