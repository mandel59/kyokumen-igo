"""Reproduce the archived B objective and evaluate normal roots after full-history classification."""
import argparse
import json
from pathlib import Path
import torch
from model import GraphNet
from train import Prepared,load_data,sampling_weights,split_games


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--annotated',required=True)
    p.add_argument('--output',required=True)
    a=p.parse_args();torch.set_num_threads(4)
    old=Path('experiments/ai/v3/2026-10-21-strength/data')
    new=Path('experiments/ai/v3/2026-10-22-learning/data')
    raw=load_data(sorted(old.glob('data-*.jsonl.gz'))+[new/'selfplay.jsonl.gz',new/'cleanup.jsonl.gz'],.5,.25)
    annotated=load_data([a.annotated])
    assert len(raw)==len(annotated)
    for r,c in zip(raw,annotated):
        assert r['record']['gameId']==c['record']['gameId']
        torch.testing.assert_close(r['x'],c['x'])
        r['record']['decisionReason']=c['record']['decisionReason']
        r['record']['ply']=c['record']['ply']
    del annotated
    pinned=json.loads((new/'candidate-b-manifest.json').read_text())
    _,val=split_games(raw,20261230,pinned)
    adjacency={}
    for t in json.loads(Path('tools/ai-gnn/target/topologies.json').read_text()):
        matrix=torch.zeros(160,160)
        for i,neighbors in enumerate(t['neighbors']):matrix[i,neighbors]=1/len(neighbors)
        adjacency[t['kind'],t['size']]=matrix
    data=Prepared(val,adjacency,'cuda')
    teacher=GraphNet().cuda().eval();teacher.load_state_dict(torch.load(old/'weights.pt',weights_only=True,map_location='cuda'))
    data.anchor_policy(teacher,256,.5)
    weights=sampling_weights(val,.5)
    normal=[r for r in val if r['record']['decisionReason']!='certified-loss']
    normal_weights=sampling_weights(normal,.5);lookup={id(r):w for r,w in zip(normal,normal_weights)}
    common_weights=[lookup.get(id(r),0.) for r in val]
    report={'schemaVersion':1,'annotated':a.annotated,'validationPositions':len(val),'classifiedCertified':sum(not v for v in data.normal.tolist()),'models':{}}
    legacy_sp_cert=torch.tensor([r['record']['source']=='selfplay' and (r['record'].get('visits')==1 or r['record'].get('variant')=='certified-cleanup') for r in val],device='cuda')
    for name,path in [('baseline',old/'weights.pt'),('b',new/'candidate-b-weights.pt')]:
        model=GraphNet().cuda().eval();model.load_state_dict(torch.load(path,weights_only=True,map_location='cuda'))
        legacy=data.evaluate(model,256,weights)
        expected=pinned['initialValidationMetrics' if name=='baseline' else 'validationMetrics']['loss']
        assert abs(legacy['loss']-expected)<2e-5,(name,legacy['loss'],expected)
        report['models'][name]={'archivedObjective':legacy,
            'archivedObjectiveWithoutSelfplayCertified':data.evaluate(model,256,weights,~legacy_sp_cert),
            'commonNormal':data.evaluate(model,256,common_weights,common=True),
            'commonNormalGroups':data.group_metrics(model,256,common_weights)}
        print(name,json.dumps({k:v for k,v in report['models'][name].items() if k!='commonNormalGroups'}),flush=True)
    Path(a.output).write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
