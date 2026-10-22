import argparse
import hashlib
import json
import torch
from pathlib import Path
from train import load_data,split_games

p=argparse.ArgumentParser()
p.add_argument('--data',nargs='+',required=True)
p.add_argument('--pinned',required=True)
p.add_argument('--seed',type=int,required=True)
p.add_argument('--output',required=True)
a=p.parse_args();torch.set_num_threads(4)
records=[r for r in load_data(a.data) if r['record'].get('decisionReason')!='certified-loss']
train,validation=split_games(records,a.seed,json.loads(Path(a.pinned).read_text()))
result={'schemaVersion':1,'seed':a.seed,'trainGames':sorted({r['record']['gameId'] for r in train}),
 'validationGames':sorted({r['record']['gameId'] for r in validation}),
 'pinnedSha256':hashlib.sha256(Path(a.pinned).read_bytes()).hexdigest(),
 'dataSha256':{f:hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in a.data}}
Path(a.output).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'trainGames':len(result['trainGames']),'validationGames':len(result['validationGames'])}))
