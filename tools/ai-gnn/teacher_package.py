"""Separate native teacher packages; never export/install into dist/."""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import torch
from teacher_model import TeacherConfig,TeacherNet,bootstrap,tensor_hash


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_package(directory,device='cpu'):
    directory=Path(directory)
    manifest=json.loads((directory/'teacher.json').read_text(encoding='utf-8-sig'))
    if manifest.get('format')!='offline-teacher-v1' or manifest.get('weights')!='weights.pt':
        raise ValueError('Unsupported teacher package')
    if sha(directory/'weights.pt')!=manifest['sha256']:raise ValueError('Teacher checksum mismatch')
    model=TeacherNet(TeacherConfig(**manifest['config']))
    state=torch.load(directory/'weights.pt',map_location='cpu',weights_only=True)
    if tensor_hash(state)!=manifest['tensorSha256']:raise ValueError('Teacher tensor checksum mismatch')
    model.load_state_dict(state,strict=True)
    if sum(p.numel() for p in model.parameters())!=manifest['parameters']:raise ValueError('Teacher parameter count mismatch')
    return model.to(device).eval(),manifest


def main():
    parser=argparse.ArgumentParser(__doc__)
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--preset',choices=['clone','gnn','hybrid'],default='gnn')
    parser.add_argument('--seed',type=int,default=2026102651)
    parser.add_argument('--noise',type=float,default=.001)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    output=args.output.resolve()
    if output.is_relative_to(root/'dist'):raise ValueError('Offline teacher output must be outside dist/')
    if output.exists() and any(output.iterdir()):raise ValueError('Teacher output directory must be empty')
    torch.set_num_threads(4)
    presets={'clone':TeacherConfig(64,6,0,8,32,64),'gnn':TeacherConfig(),'hybrid':TeacherConfig(384,6,12,8,128,256)}
    config=presets[args.preset]
    source=torch.load(args.source,map_location='cpu',weights_only=True)
    model=bootstrap(source,config,args.seed,args.noise)
    # Verify functional preservation on the fixed production fixture, all four heads.
    golden=json.loads((root/'tests/fixtures/ai/v3-golden.json').read_text())
    inputs=[torch.tensor(golden['inputs'][name]['data']).reshape(golden['inputs'][name]['shape']) for name in ['x','adjacency','mask','global_features']]
    from model import GraphNet
    from teacher_model import structural_inputs
    base=GraphNet().eval();base.load_state_dict(source)
    structure=structural_inputs(*inputs[:3],config.max_distance) if config.attention_blocks else ()
    model.eval()
    with torch.inference_mode():errors=[float((a-b).abs().max()) for a,b in zip(model(*inputs,*structure),base(*inputs))]
    if max(errors)>3e-4:raise ValueError('Function-preserving bootstrap failed: '+str(errors))
    output.mkdir(parents=True,exist_ok=True)
    torch.save(model.state_dict(),output/'weights.pt')
    manifest={'format':'offline-teacher-v1','status':'untrained-bootstrap','config':asdict(config),'parameters':sum(p.numel() for p in model.parameters()),'weights':'weights.pt','sha256':sha(output/'weights.pt'),'tensorSha256':tensor_hash(model.state_dict()),'sourceCheckpointSha256':sha(args.source),'seed':args.seed,'noise':args.noise,'features':{'points':160,'channels':32,'globals':8},'search':{'fpu':1},'bootstrapMaxErrors':errors,'warning':'Capacity expansion only. Playing strength must be established after training and independent matches.'}
    (output/'teacher.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
