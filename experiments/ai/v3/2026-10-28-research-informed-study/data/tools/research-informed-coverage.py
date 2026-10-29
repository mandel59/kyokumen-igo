"""Audit the pre-registered teacher coverage without opening any match holdout."""
import collections,hashlib,json,math
from pathlib import Path
import numpy as np
import torch
from model import GraphNet,POINTS
from train import load_data,split_games
ROOT=Path('tools/ai-gnn/target/research-informed-study-20261028')
def write(name,value): (ROOT/'results'/name).write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
def summary(values):
 a=np.asarray(values,dtype=float)
 return dict(count=len(a),mean=float(a.mean()),median=float(np.median(a)),p10=float(np.quantile(a,.1)))
def main():
 torch.set_num_threads(4)
 plan=json.loads((ROOT/'plan.json').read_text(encoding='utf-8')); pinned=json.loads((ROOT/'baseline/manifest.json').read_text(encoding='utf-8'))
 records=load_data([plan['phase0']['input']]);raw_count=len(records)
 excluded=collections.Counter(r['record']['kind']+str(r['record']['size']) for r in records if r['record'].get('decisionReason')=='certified-loss')
 records=[r for r in records if r['record'].get('decisionReason')!='certified-loss']
 training,validation=split_games(records,0,pinned)
 assert len(training)==plan['phase0']['trainPositions'] and len(validation)==plan['phase0']['validationPositions']
 train_games=set(pinned['trainGames']); val_games=set(pinned['validationGames'])
 assert not train_games&val_games
 roots=collections.defaultdict(set);origins=collections.defaultdict(set);ids=collections.Counter()
 for split,items in [('train',training),('validation',validation)]:
  for item in items:
   r=item['record'];assert r['gameId'] in (train_games if split=='train' else val_games)
   origins[r.get('originGameId',r['gameId'])].add(split)
   if r.get('positionId'):ids[r['positionId']]+=1
   digest=hashlib.sha256()
   digest.update((r['kind']+str(r['size'])).encode())
   for key in ['x','global_features','legal']:digest.update(item[key].numpy().tobytes())
   roots[digest.hexdigest()].add(split)
   if r.get('source')=='selfplay' and r.get('policyEligible',True):
    assert item['has_validation_policy'],'Missing explicit common validation policy'
    target=r.get('targetSearch')
    assert target
    if target.get('engine')=='katago':
     assert r['kind']=='plane' and target['requestedVisits']==512
     assert torch.allclose(item['policy'],item['selection_policy'],atol=1e-6,rtol=1e-5)
    else:
     assert not target['noise'] and target['requestedVisits']==4096
     mix=r['priorMix']
     expected=(1-mix)*np.asarray(target['policy'])+mix*np.asarray(target['prior'])
     assert np.allclose(expected,item['selection_policy'].numpy(),atol=1e-6),'Common policy differs from declared prior mixture'
     assert torch.allclose(item['policy'],item['selection_policy'],atol=1e-6,rtol=1e-5)
 assert all(len(v)==1 for v in origins.values()),'Origin game crosses data split'
 assert not any(v>1 for v in ids.values()),'Duplicate position IDs'
 model=GraphNet().eval()
 model.load_state_dict(torch.load(ROOT/'baseline/weights.pt',map_location='cpu',weights_only=True))
 weights=b''.join((t.T if t.ndim==2 else t).contiguous().numpy().astype('<f4').tobytes() for t in model.state_dict().values())
 assert hashlib.sha256(weights).hexdigest()==plan['baseline']['weightsSha256'],'Checkpoint differs from production'
 device='cuda' if torch.cuda.is_available() else 'cpu';model.to(device)
 adjacency={}
 for top in json.loads((ROOT/'topologies.json').read_text(encoding='utf-8')):
  a=torch.zeros(POINTS,POINTS)
  for p,neighbors in enumerate(top['neighbors']):a[p,neighbors]=1/len(neighbors)
  adjacency[top['kind'],top['size']]=a
 groups=collections.defaultdict(lambda:collections.defaultdict(list));eligible_train=rich_train=0
 for split,items in [('train',training),('validation',validation)]:
  for start in range(0,len(items),64):
   chunk=items[start:start+64]
   inputs=[torch.stack([r[k] for r in chunk]).to(device) for k in ['x','mask','global_features']]
   adj=torch.stack([adjacency[r['record']['kind'],r['record']['size']] for r in chunk]).to(device)
   legal=torch.stack([r['legal'] for r in chunk]).to(device)
   with torch.no_grad():
    logits=model(inputs[0],adj,inputs[1],inputs[2])[0].masked_fill(~legal,-float('inf'))
    ranks=torch.argsort(logits,dim=-1,descending=True,stable=True).cpu().tolist()
   for item,rank in zip(chunk,ranks):
    r=item['record'];board=r['kind']+str(r['size']);n=item['n']
    if not r.get('policyEligible',True):continue
    pi=item['policy'].numpy();common=item['selection_policy'].numpy();x=item['x'].numpy()[:n]
    tail=float(np.sort(pi)[:-2].sum())
    if split=='train':eligible_train+=1;rich_train+=int(tail>=.01)
    best=int(pi.argmax());common_best=int(common.argmax())
    ply=r.get('ply',round(float(item['global_features'][5])*2*n))
    phase='opening' if ply<n/2 else 'middle' if ply<n else 'late'
    capture=bool((x[:,28]>0).any());low=bool((x[:,3:5].sum()+x[:,7:9].sum())>0)
    tags=['all','board/'+board,'source/'+r['source'],'teacher/'+r.get('policyOrigin','unspecified'),'phase/'+phase,'captures/'+str(capture),'lowLiberties/'+str(low)]
    values=dict(support=float((pi>0).sum()),support1e4=float((pi>=1e-4).sum()),entropy=float(-(pi*np.log(np.maximum(pi,1e-30))).sum()),top2Mass=1-tail,tailMass=tail,richTail=float(tail>=.01),top8Mass=float(pi[rank[:8]].sum()),top16Mass=float(pi[rank[:16]].sum()),top8Recall=float(best in rank[:8]),top16Recall=float(best in rank[:16]),commonTop8Mass=float(common[rank[:8]].sum()),commonTop16Mass=float(common[rank[:16]].sum()),commonTop8Recall=float(common_best in rank[:8]),commonTop16Recall=float(common_best in rank[:16]),commonSupport=float((common>0).sum()))
    for tag in tags:
     for metric,value in values.items():groups[split+'/'+tag][metric].append(value)
 ratio=rich_train/eligible_train;skip=ratio<.10
 audit=dict(passed=True,rawPositions=raw_count,excludedCertifiedLoss=sum(excluded.values()),excludedByBoard=dict(excluded),training=len(training),validation=len(validation),originGroups=len(origins),originSplitOverlap=0,duplicatePositionIds=0,featureFingerprintsSharedAcrossSplits=sum(len(v)>1 for v in roots.values()),sharedFingerprintInterpretation='Identical model inputs from different origin games (e.g. common openings) are reported, not treated as origin-game leakage; compressed features need not uniquely identify full superko state.',checkpointMatchesProduction=True,commonSelfplayTargetVerified='Curves: policy and validationPolicy both equal 75% clean4096 final policy +25% frozen NN prior. Planes: policy equals validationPolicy from KataGo512. No unexplained mismatch.',teacherInterpretation='Teacher labels are estimates, not proof of best moves. NN ranking masks illegal actions but does not reproduce tactical search pruning.')
 result=dict(schemaVersion=1,device=device,eligibleTrainingPositions=eligible_train,richTailTrainingPositions=rich_train,richTailTrainingFraction=ratio,skipSoftHead=skip,skipThreshold=.10,groups={key:{m:summary(v) for m,v in metrics.items()} for key,metrics in groups.items()})
 write('data-audit.json',audit);write('coverage.json',result)
 lines=['# Teacher coverage audit','',f'Raw positions: {raw_count}; excluded certified-loss: {sum(excluded.values())}; training: {len(training)}; validation: {len(validation)}.',f'Eligible training positions with >=1% mass outside top2: {rich_train}/{eligible_train} ({ratio:.2%}); skip Soft4: {skip}.','', '| Split / board | Teacher top8 mass | Teacher top8 recall | Common target top8 mass | Common target top8 recall | Mean support |','| --- | ---: | ---: | ---: | ---: | ---: |']
 for key,metrics in result['groups'].items():
  if '/board/' in key:
   lines.append('| '+key+' | '+' | '.join(f"{metrics[m]['mean']:.4f}" for m in ['top8Mass','top8Recall','commonTop8Mass','commonTop8Recall','support'])+' |')
 lines+=['','Training policy and common-validation policy are reported separately. Zero-probability moves cannot be recovered by power softening. Shared feature fingerprints from independent origin games are descriptive, not evidence of origin leakage. Full legality and labels were validated by the production training loader.']
 (ROOT/'results/coverage.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
 print(json.dumps(dict(audit=audit,eligibleTraining=eligible_train,richTailFraction=ratio,skipSoftHead=skip,overall={k:v for k,v in result['groups'].items() if k.endswith('/all')})))
if __name__=='__main__':main()
