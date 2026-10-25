"""Offline teacher models. No browser export or production-model installation."""
from dataclasses import dataclass, asdict
from functools import lru_cache
import hashlib
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

POINTS, CHANNELS, GLOBALS = 160, 32, 8

@dataclass(frozen=True)
class TeacherConfig:
    hidden: int = 256
    blocks: int = 20
    attention_blocks: int = 0
    heads: int = 8
    policy_width: int = 128
    value_width: int = 256
    max_distance: int = 32

    def validate(self):
        for name, value in asdict(self).items():
            if not isinstance(value, int) or isinstance(value, bool) or value < (0 if name == 'attention_blocks' else 1):
                raise ValueError('Invalid teacher dimension: '+name)
        if self.attention_blocks and self.hidden % self.heads:
            raise ValueError('Hidden channels must divide into attention heads')
        return self


def pool(h, mask):
    return (h*mask).sum(1)/mask.sum(1).clamp_min(1)


class GraphBlock(nn.Module):
    def __init__(self, hidden):
        super().__init__()
        self.local = nn.Linear(hidden, hidden)
        self.near = nn.Linear(hidden, hidden, bias=False)
        self.context = nn.Linear(hidden+GLOBALS, hidden)
        self.out = nn.Linear(hidden, hidden)

    def forward(self, h, adjacency, mask, global_features):
        context = torch.cat((pool(h,mask),global_features),-1)
        z = torch.relu(self.local(h)+self.near(adjacency@h)+self.context(context).unsqueeze(1))
        return (h+.25*self.out(z))*mask


class AttentionBlock(nn.Module):
    def __init__(self, hidden, heads):
        super().__init__()
        self.heads, self.head_width = heads, hidden//heads
        self.attention_norm = nn.LayerNorm(hidden)
        self.qkv = nn.Linear(hidden,3*hidden)
        self.attention_out = nn.Linear(hidden,hidden)
        self.ffn_norm = nn.LayerNorm(hidden)
        self.ffn = nn.Sequential(nn.Linear(hidden,4*hidden),nn.GELU(),nn.Linear(4*hidden,hidden))

    def forward(self, h, mask, bias):
        batch, points, hidden = h.shape
        qkv = self.qkv(self.attention_norm(h)).reshape(batch,points,3,self.heads,self.head_width).permute(2,0,3,1,4)
        z = F.scaled_dot_product_attention(qkv[0],qkv[1],qkv[2],attn_mask=bias,dropout_p=0.)
        z = z.transpose(1,2).reshape(batch,points,hidden)
        h = (h+self.attention_out(z))*mask
        return (h+self.ffn(self.ffn_norm(h)))*mask


def head(inputs, outputs, width):
    return nn.Sequential(nn.Linear(inputs,width),nn.ReLU(),nn.Linear(width,outputs))


class TeacherNet(nn.Module):
    def __init__(self, config=TeacherConfig()):
        super().__init__()
        self.config = config.validate()
        c = self.config
        self.input = nn.Linear(CHANNELS,c.hidden)
        self.blocks = nn.ModuleList(GraphBlock(c.hidden) for _ in range(c.blocks))
        self.attention_blocks = nn.ModuleList(AttentionBlock(c.hidden,c.heads) for _ in range(c.attention_blocks))
        if c.attention_blocks:
            self.distance_bias = nn.Embedding(c.max_distance+2,c.heads)
            self.group_bias = nn.Embedding(4,c.heads)
        self.policy = head(c.hidden,1,c.policy_width)
        self.passing = head(c.hidden+GLOBALS,1,c.policy_width)
        self.value = head(c.hidden+GLOBALS,3,c.value_width)
        self.score = head(c.hidden+GLOBALS,1,c.value_width)
        self.ownership = head(c.hidden,3,c.policy_width)

    def forward(self, x, adjacency, mask, global_features, distances=None, groups=None):
        h = torch.relu(self.input(x))*mask
        for block in self.blocks:
            h = block(h,adjacency,mask,global_features)
        if self.attention_blocks:
            if distances is None or groups is None:
                raise ValueError('Attention teacher requires graph distances and groups')
            same = groups.unsqueeze(2)==groups.unsqueeze(1)
            occupied = same & (groups.unsqueeze(2)>0)
            own = x[:,:,0:1]>.5
            relation = torch.where(occupied,torch.where(own,1,2),0)
            relation = torch.where(same & (groups.unsqueeze(2)<0),3,relation)
            bias = self.distance_bias(distances.clamp(0,self.config.max_distance+1)).permute(0,3,1,2)
            bias = bias+self.group_bias(relation).permute(0,3,1,2)
            bias = bias.masked_fill(~(mask.squeeze(-1)[:,None,None,:]>.5),float('-inf'))
            for block in self.attention_blocks:
                h = block(h,mask,bias)
        g = torch.cat((pool(h,mask),global_features),-1)
        return torch.cat((self.policy(h).squeeze(-1),self.passing(g)),-1),self.value(g),self.score(g).squeeze(-1),self.ownership(h)


@lru_cache(maxsize=24)
def _distances(adjacency_bytes, valid_bytes, max_distance):
    adjacency = np.frombuffer(adjacency_bytes,dtype=np.float32).reshape(POINTS,POINTS)
    valid = np.frombuffer(valid_bytes,dtype=np.uint8).astype(bool)
    neighbors = [np.flatnonzero(adjacency[p]>0).tolist() for p in range(POINTS)]
    result = np.full((POINTS,POINTS),max_distance+1,dtype=np.int64)
    for p in np.flatnonzero(valid):
        distances = np.full(POINTS,-1,dtype=np.int64);distances[p]=0;queue=[int(p)]
        for q in queue:
            for r in neighbors[q]:
                if valid[r] and distances[r]<0:
                    distances[r]=distances[q]+1;queue.append(r)
        reachable = distances>=0
        result[p,reachable]=np.minimum(distances[reachable],max_distance+1)
    return result


def structural_inputs(x, adjacency, mask, max_distance=32):
    """CPU preprocessing, independent of vertex IDs; same-group labels are only compared for equality."""
    x = np.asarray(x,dtype=np.float32)
    adjacency = np.asarray(adjacency,dtype=np.float32)
    mask = np.asarray(mask,dtype=np.float32)
    if x.ndim!=3 or x.shape[1:]!=(POINTS,CHANNELS) or mask.shape!=(len(x),POINTS,1) or adjacency.shape not in [(1,POINTS,POINTS),(len(x),POINTS,POINTS)]:
        raise ValueError('Invalid structural input shapes')
    distances, groups = [], []
    for b in range(len(x)):
        a = adjacency[0 if len(adjacency)==1 else b];valid = mask[b,:,0]>.5
        if not valid.any():raise ValueError('Empty graph')
        distances.append(_distances(a.tobytes(),valid.astype(np.uint8).tobytes(),max_distance).copy())
        colors = x[b,:,:3].argmax(-1);labels=np.zeros(POINTS,dtype=np.int64);seen=set();stone_id=1;region_id=-1
        for p in np.flatnonzero(valid):
            p=int(p)
            if p in seen:continue
            label=region_id if colors[p]==2 else stone_id
            if colors[p]==2:region_id-=1
            else:stone_id+=1
            queue=[p];seen.add(p)
            for q in queue:
                labels[q]=label
                for r in np.flatnonzero(a[q]>0):
                    r=int(r)
                    if valid[r] and r not in seen and colors[r]==colors[p]:seen.add(r);queue.append(r)
        groups.append(labels)
    return torch.from_numpy(np.stack(distances)),torch.from_numpy(np.stack(groups))


def tensor_hash(state):
    digest=hashlib.sha256()
    for name,tensor in sorted(state.items()):
        tensor=tensor.detach().cpu().contiguous();digest.update(name.encode());digest.update(str(tuple(tensor.shape)).encode());digest.update(str(tensor.dtype).encode());digest.update(tensor.numpy().tobytes())
    return digest.hexdigest()


def bootstrap(source, config, seed=2026102651, noise=1e-3):
    """Widen a v3 checkpoint and add identity residual branches. No strength claim before training."""
    if not np.isfinite(noise) or noise<0:raise ValueError('Invalid bootstrap noise')
    torch.manual_seed(seed);model=TeacherNet(config)
    old_hidden=source['input.weight'].shape[0]
    old_blocks=1+max(int(k.split('.')[1]) for k in source if k.startswith('blocks.'))
    if config.hidden%old_hidden or config.hidden<old_hidden or config.blocks<old_blocks:
        raise ValueError('Bootstrap requires wider channels and at least the original blocks')
    def expanded(weight, outputs, hidden_inputs=None):
        old_out,old_in=weight.shape
        if outputs%old_out:raise ValueError('Head width must be a multiple of the source width')
        out_repeat=outputs//old_out
        inputs=old_in if hidden_inputs is None else hidden_inputs
        if inputs<old_in or inputs%old_in:raise ValueError('Invalid input widening')
        in_repeat=inputs//old_in
        result=weight.repeat(out_repeat,in_repeat)/in_repeat
        if noise and in_repeat>1:
            perturb=torch.randn_like(result).reshape(outputs,in_repeat,old_in)
            perturb-=perturb.mean(1,keepdim=True)
            result=result+noise*perturb.reshape_as(result)
        return result
    def copy_linear(layer,prefix,hidden_input=False,context=False):
        weight=source[prefix+'.weight'];outputs=layer.weight.shape[0]
        if context:
            hidden=expanded(weight[:,:old_hidden],outputs,config.hidden)
            value=torch.cat((hidden,weight[:,old_hidden:].repeat(outputs//weight.shape[0],1)),-1)
        else:value=expanded(weight,outputs,config.hidden if hidden_input else layer.weight.shape[1])
        layer.weight.copy_(value)
        if layer.bias is not None:layer.bias.copy_(source[prefix+'.bias'].repeat(outputs//weight.shape[0]))
    with torch.no_grad():
        copy_linear(model.input,'input')
        for i,block in enumerate(model.blocks):
            if i<old_blocks:
                for name in ['local','near','out']:copy_linear(getattr(block,name),f'blocks.{i}.{name}',hidden_input=True)
                copy_linear(block.context,f'blocks.{i}.context',context=True)
            else:block.out.weight.zero_();block.out.bias.zero_()
        for block in model.attention_blocks:
            block.attention_out.weight.zero_();block.attention_out.bias.zero_();block.ffn[2].weight.zero_();block.ffn[2].bias.zero_()
        for name in ['policy','passing','value','score','ownership']:
            layers=getattr(model,name);copy_linear(layers[0],name+'.0',hidden_input=name in ['policy','ownership'],context=name not in ['policy','ownership']);copy_linear(layers[2],name+'.2')
    return model
