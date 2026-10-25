"""Native Torch inference worker. Line-delimited JSON/base64 over private stdio."""
import argparse
import base64
import json
import sys
import traceback
import numpy as np
import torch
from teacher_model import structural_inputs
from teacher_package import load_package


def send(value):
    print(json.dumps(value,allow_nan=False,separators=(',',':')),flush=True)


def array(message,name,shape):
    raw=base64.b64decode(message[name],validate=True)
    if len(raw)!=int(np.prod(shape))*4:raise ValueError('Invalid '+name+' length')
    value=np.frombuffer(raw,dtype='<f4').reshape(shape).copy()
    if not np.isfinite(value).all():raise ValueError('Nonfinite '+name)
    return value


def main():
    parser=argparse.ArgumentParser(__doc__)
    parser.add_argument('--directory',required=True)
    parser.add_argument('--device',choices=['cpu','cuda'],default='cuda')
    parser.add_argument('--threads',type=int,default=4)
    args=parser.parse_args()
    if args.threads<1:raise ValueError('Invalid CPU thread count')
    torch.set_num_threads(args.threads)
    torch.backends.cuda.matmul.allow_tf32=False
    model,manifest=load_package(args.directory,args.device)
    adjacencies={}
    send({'ready':True,'backend':args.device,'manifest':manifest,'batchSize':8})
    for line in sys.stdin:
        message=json.loads(line);request_id=message.get('id')
        try:
            op=message.get('op')
            if op=='close':send({'id':request_id,'ok':True});break
            if op=='adjacency':
                key=message['key']
                if not isinstance(key,str) or len(key)>100:raise ValueError('Invalid graph key')
                if key not in adjacencies and len(adjacencies)>=24:raise ValueError('Too many registered graphs')
                a=array(message,'adjacency',(1,160,160))
                if (a<0).any():raise ValueError('Negative adjacency')
                adjacencies[key]=(a,torch.from_numpy(a).to(args.device))
                send({'id':request_id,'ok':True});continue
            if op!='evaluate':raise ValueError('Unknown operation')
            count=message['count']
            if not isinstance(count,int) or isinstance(count,bool) or not 1<=count<=64:raise ValueError('Invalid inference batch size')
            x=array(message,'x',(count,160,32));mask=array(message,'mask',(count,160,1));glob=array(message,'global_features',(count,8))
            if not np.isin(mask,[0.,1.]).all() or (mask.sum(1)==0).any():raise ValueError('Invalid point mask')
            adjacency,device_adjacency=adjacencies[message['key']]
            structure=structural_inputs(x,adjacency,mask,model.config.max_distance) if model.config.attention_blocks else ()
            with torch.inference_mode():
                output=model(torch.from_numpy(x).to(args.device),device_adjacency,torch.from_numpy(mask).to(args.device),torch.from_numpy(glob).to(args.device),*(v.to(args.device) for v in structure))
                names=['policy','wdl','score','ownership'] if message.get('auxiliary',False) else ['policy','wdl']
                packed=torch.cat([v.flatten() for v in output[:len(names)]]).float().cpu().numpy()
            if not np.isfinite(packed).all():raise ValueError('Nonfinite teacher output')
            send({'id':request_id,'names':names,'data':base64.b64encode(packed.astype('<f4',copy=False).tobytes()).decode('ascii')})
        except Exception as error:
            send({'id':request_id,'error':str(error)})

if __name__=='__main__':
    try:main()
    except Exception:
        traceback.print_exc(file=sys.stderr);sys.exit(1)
