import json,hashlib,torch
from pathlib import Path
root=Path('tools/ai-gnn/target/learning-scope-study-20261028')
plan=json.loads((root/'plan.json').read_text(encoding='utf-8'))
baseline=torch.load(root/'baseline/weights.pt',map_location='cpu',weights_only=True)
results=[]
for arm in plan['training']['arms']:
 folder=root/(arm['id']+'-model');manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
 state=torch.load(folder/'weights.pt',map_location='cpu',weights_only=True)
 changed=[key for key in baseline if not torch.equal(baseline[key],state[key])]
 nonpolicy=[key for key in changed if arm['trainable']=='value' and not key.startswith('value.')]
 if nonpolicy:raise ValueError('Frozen tensor changed: '+str(nonpolicy))
 initial=manifest['initialSelectionMetrics']['loss'];selected=manifest['selectionMetrics']['loss']
 ratios={key:manifest['validationGroups'][key]['loss']/value['loss'] for key,value in manifest['initialValidationGroups'].items() if key.startswith('board/')}
 eligible=manifest['selectedEpoch']>0 and bool(changed) and selected<=initial*.999 and max(ratios.values())<=1.02
 results.append(dict(id=arm['id'],eligible=eligible,selectedEpoch=manifest['selectedEpoch'],changedTensors=changed,outOfScopeTensorsChanged=0,scope=arm['trainable'],trainableParameters=manifest['trainableParameters'],initialSelectionLoss=initial,selectionLoss=selected,relativeGain=1-selected/initial,perBoardLossRatios=ratios,modelSha256=manifest['sha256']))
result=dict(schemaVersion=1,results=results,notes='Exact tensor comparisons preserve backbone/value/score/ownership; old validation partitions are reused only for model selection. Match outcomes remain independent.')
(root/'results/preflight.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(results))
