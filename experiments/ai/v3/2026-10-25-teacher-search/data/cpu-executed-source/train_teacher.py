"""Offline supervised pilot for large teachers; outputs a native package, never browser assets."""
import argparse
import json
import math
from pathlib import Path
import random
import torch
from teacher_model import structural_inputs,tensor_hash
from teacher_package import load_package,sha
from train import Prepared,load_data,split_games,sampling_weights,loss_terms,dataset_summary


class TeacherPrepared(Prepared):
    def __init__(self,items,adjacency,device,config):
        super().__init__(items,adjacency,device)
        self.structure=None
        if config.attention_blocks:
            keys=sorted(adjacency);distance_by_board={};groups=[]
            for r in items:
                key=(r['record']['kind'],r['record']['size'])
                distances,labels=structural_inputs(r['x'][None],adjacency[key][None],r['mask'][None],config.max_distance)
                distance_by_board[key]=distances[0];groups.append(labels[0])
            # A split can omit a topology; only used boards must have structural encodings.
            self.structure=(torch.stack([distance_by_board.get(k,torch.zeros(160,160,dtype=torch.long)) for k in keys]).to(device),torch.stack(groups).to(device))

    def forward(self,model,indices):
        if self.structure is None:return super().forward(model,indices)
        d={k:v[indices] for k,v in self.data.items()};boards=self.boards[indices]
        output=model(d['x'],self.adjacency[boards],d['mask'],d['global_features'],self.structure[0][boards],self.structure[1][indices])
        losses=loss_terms(*output,d['legal'],d['policy'],self.outcome[indices],self.score[indices],d['own'],d['mask'].squeeze(-1),self.policy_weight[indices])
        return losses,output,d


def main():
    parser=argparse.ArgumentParser(__doc__)
    parser.add_argument('--package',required=True,type=Path)
    parser.add_argument('--data',required=True,nargs='+',type=Path)
    parser.add_argument('--topologies',type=Path,default=Path('tools/ai-gnn/target/topologies.json'))
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--device',choices=['cpu','cuda'],default='cuda')
    parser.add_argument('--epochs',type=int,default=8)
    parser.add_argument('--batch-size',type=int,default=32)
    parser.add_argument('--learning-rate',type=float,default=1e-4)
    parser.add_argument('--seed',type=int,default=2026102652)
    parser.add_argument('--split-manifest',type=Path)
    args=parser.parse_args()
    if args.epochs<1 or args.batch_size<1 or not math.isfinite(args.learning_rate) or args.learning_rate<=0:parser.error('Invalid training settings')
    root=Path(__file__).resolve().parents[2];output=args.output.resolve()
    if output.is_relative_to(root/'dist'):raise ValueError('Offline training output must be outside dist/')
    if output.exists() and any(output.iterdir()):raise ValueError('Output directory must be empty')
    torch.set_num_threads(4);torch.manual_seed(args.seed);torch.backends.cuda.matmul.allow_tf32=False
    model,source=load_package(args.package,args.device)
    records=load_data(args.data)
    pinned=json.loads(args.split_manifest.read_text(encoding='utf-8-sig')) if args.split_manifest else None
    training,validation=split_games(records,args.seed,pinned)
    adjacency={}
    for t in json.loads(args.topologies.read_text(encoding='utf-8-sig')):
        a=torch.zeros(160,160)
        for p,neighbors in enumerate(t['neighbors']):a[p,neighbors]=1/len(neighbors)
        adjacency[(t['kind'],t['size'])]=a
    train=TeacherPrepared(training,adjacency,args.device,model.config);val=TeacherPrepared(validation,adjacency,args.device,model.config)
    weights=sampling_weights(training);val_weights=sampling_weights(validation)
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.learning_rate,weight_decay=1e-4)
    schedule=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs,eta_min=args.learning_rate*.1)
    rng=random.Random(args.seed);history=[]
    initial=val.evaluate(model,args.batch_size,val_weights)
    best_loss=initial['loss'];best_epoch=0;best={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
    print(json.dumps({'epoch':0,'validation':initial}),flush=True)
    for epoch in range(1,args.epochs+1):
        model.train();order=rng.choices(range(len(training)),weights=weights,k=len(training));total=0
        for start in range(0,len(order),args.batch_size):
            indices=torch.tensor(order[start:start+args.batch_size],device=args.device)
            optimizer.zero_grad(set_to_none=True);loss=train.forward(model,indices)[0].mean()
            if not torch.isfinite(loss):raise ValueError('Nonfinite teacher loss')
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),5.,error_if_nonfinite=True);optimizer.step();total+=loss.item()*len(indices)
        metrics=val.evaluate(model,args.batch_size,val_weights)
        row={'epoch':epoch,'trainLoss':total/len(training),'validation':metrics,'learningRate':optimizer.param_groups[0]['lr']};history.append(row);print(json.dumps(row),flush=True)
        if metrics['loss']<best_loss:
            best_loss=metrics['loss'];best_epoch=epoch;best={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
        schedule.step()
    model.load_state_dict(best);selected=val.evaluate(model,args.batch_size,val_weights)
    board_metrics={}
    for key in sorted(adjacency):
        subset=torch.tensor([(r['record']['kind'],r['record']['size'])==key for r in validation],device=args.device)
        if subset.any():board_metrics[key[0]+str(key[1])]=val.evaluate(model,args.batch_size,val_weights,subset)
    metadata={'seed':args.seed,'epochs':args.epochs,'batchSize':args.batch_size,'learningRate':args.learning_rate,'device':args.device,'torchVersion':torch.__version__,'selection':'Minimum balanced held-out-game loss including epoch0; strength requires separate matches','selectedEpoch':best_epoch,'initialValidation':initial,'selectedValidation':selected,'validationByBoard':board_metrics,'history':history,'dataSources':{'train':dataset_summary(training),'validation':dataset_summary(validation)},'trainGames':sorted({r['record']['gameId'] for r in training}),'validationGames':sorted({r['record']['gameId'] for r in validation}),'dataSha256':{str(p):sha(p) for p in args.data},'topologiesSha256':sha(args.topologies),'splitManifestSha256':sha(args.split_manifest) if args.split_manifest else None,'sourcePackageManifestSha256':sha(args.package/'teacher.json'),'optimizer':'Fresh AdamW, weightDecay1e-4, clip5, cosine to0.1x; no optimizer resume','sampling':'source/board/game/thirds, selfplay mass0.7 when mixed','sourceSha256':{name:sha(Path(__file__).with_name(name)) for name in ['train_teacher.py','teacher_model.py','teacher_package.py','train.py','model.py']}}
    output.mkdir(parents=True,exist_ok=True);torch.save(best,output/'weights.pt')
    manifest={**source,'status':'supervised-pilot','sha256':sha(output/'weights.pt'),'tensorSha256':tensor_hash(best),'training':'training.json','warning':'Validation loss is not playing strength; independent matches required.'}
    # bootstrapMaxErrors refer to the source only, not this trained model.
    manifest.pop('bootstrapMaxErrors',None)
    (output/'teacher.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8');(output/'training.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(output),'selectedEpoch':best_epoch,'initialLoss':initial['loss'],'selectedLoss':selected['loss']}),flush=True)

if __name__=='__main__':main()
