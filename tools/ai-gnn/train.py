"""uv run --project tools/ai-gnn python tools/ai-gnn/train.py --data DATA.jsonl --output DIR"""
import argparse
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import torch
from torch.nn import functional as F
from model import GraphNet, POINTS, CHANNELS, GLOBALS, HIDDEN, BLOCKS


def load_data(paths, policy_temperature=1., minimum_policy_confidence=0.):
    records = []
    for path in paths:
        opener = gzip.open if str(path).endswith('.gz') else open
        with opener(path, 'rt', encoding="utf-8") as source:
            for line in source:
                r = json.loads(line)
                if r.get("schemaVersion") != 1:
                    raise ValueError("Unsupported feature schema")
                if r.get("kind") not in ("sphere", "torus") or r.get("size") not in ({"sphere": (3, 4, 5), "torus": (7, 9, 11)}[r["kind"]]) or not isinstance(r.get("gameId"), str):
                    raise ValueError("Invalid board or game ID")
                n = 6 * r["size"] ** 2 + 2 if r["kind"] == "sphere" else r["size"] ** 2
                x = torch.tensor(r["x"], dtype=torch.float32).reshape(n, CHANNELS)
                legal = torch.tensor(r["legal"], dtype=torch.bool)
                if n > POINTS or len(legal) != POINTS + 1 or not legal.any():
                    raise ValueError("Invalid training record")
                policy = torch.tensor(r.get("policy", []), dtype=torch.float32)
                if policy.numel() == 0:
                    policy = F.one_hot(torch.tensor(r["action"]), POINTS + 1).float()
                if policy.shape != legal.shape or not torch.isfinite(policy).all() or (policy < 0).any() or policy[~legal].sum() > 1e-6 or policy.sum() <= 0:
                    raise ValueError("Invalid policy target")
                policy /= policy.sum()
                raw_policy = policy.clone()
                policy_weight = 1.
                if r.get('source') == 'selfplay':
                    policy_weight = float(policy.max().item() >= minimum_policy_confidence)
                    policy = policy.pow(1/policy_temperature)
                    policy /= policy.sum()
                own = torch.tensor(r["ownership"], dtype=torch.long)
                if own.shape != (n,) or (own < 0).any() or (own > 2).any() or r["wdl"] not in (0, 1, 2):
                    raise ValueError("Invalid outcome target")
                global_features = torch.tensor(r["global"], dtype=torch.float32)
                if global_features.shape != (GLOBALS,) or not torch.isfinite(x).all() or not torch.isfinite(global_features).all():
                    raise ValueError("Invalid features")
                margin = float(r['score'])
                if not math.isfinite(margin) or r['wdl'] != (0 if margin > 0 else 2 if margin < 0 else 1):
                    raise ValueError('Inconsistent outcome and margin')
                owner_margin = (own == 0).sum().item() - (own == 2).sum().item() + global_features[0].item()*n
                if abs(owner_margin-margin) > 1e-4:
                    raise ValueError('Ownership and score disagree')
                # Do not retain a second copy of all features as Python float lists.
                metadata = {k:v for k,v in r.items() if k not in ('x','global','legal','policy','ownership')}
                metadata.setdefault('source', 'teacher')
                records.append(dict(record=metadata, n=n, x=F.pad(x, (0, 0, 0, POINTS-n)),
                    mask=F.pad(torch.ones(n, 1), (0, 0, 0, POINTS-n)), global_features=global_features,
                    legal=legal, policy=policy, raw_policy=raw_policy, policy_weight=policy_weight, own=F.pad(own, (0, POINTS-n), value=1)))
    if not records:
        raise ValueError("No data")
    return records


def split_games(records, seed, pinned=None):
    groups = {}
    for r in records:
        key = (r["record"]["kind"], r["record"]["size"])
        groups.setdefault(key, set()).add(r["record"]["gameId"])
    rng = random.Random(seed)
    validation = set()
    fixed_train = set((pinned or {}).get('trainGames', []))
    fixed_validation = set((pinned or {}).get('validationGames', []))
    if fixed_train & fixed_validation:
        raise ValueError('Pinned training and validation overlap')
    for key, ids in sorted(groups.items()):
        ids = sorted(ids)
        if len(ids) < 2:
            raise ValueError(f"Need at least two completed games per board: {key}")
        fresh = [i for i in ids if i not in fixed_train and i not in fixed_validation]
        rng.shuffle(fresh)
        chosen = {i for i in ids if i in fixed_validation}
        if fresh:
            if len(fresh) < 2 and not chosen:
                raise ValueError('Need at least two new games for a fresh split')
            chosen.update(fresh[:max(1, len(fresh)//5)])
        validation.update((key[0], key[1], i) for i in chosen)
    is_validation = lambda r: (r['record']['kind'],r['record']['size'],r['record']['gameId']) in validation
    train, validation = [r for r in records if not is_validation(r)], [r for r in records if is_validation(r)]
    if not train or not validation:
        raise ValueError('Empty training or validation partition')
    return train, validation


def sampling_weights(records, selfplay_mass=.7):
    """Equal boards, games and game thirds within each source, with a fixed source mix."""
    games = {}
    for index, item in enumerate(records):
        r = item['record']
        games.setdefault((r['source'],r['kind'],r['size'],r['gameId']), []).append(index)
    cells, phase_at, board_games = {}, {}, {}
    for key, indices in games.items():
        board_games.setdefault(key[:3], set()).add(key[3])
        for position, index in enumerate(indices):
            phase = min(2, position*3//len(indices))
            phase_at[index] = phase
            cells.setdefault((*key,phase), []).append(index)
    sources = {k[0] for k in games}
    if not sources <= {'teacher','selfplay'}:
        raise ValueError('Unknown training source')
    masses = {'selfplay':selfplay_mass,'teacher':1-selfplay_mass}
    if len(sources)==1:
        masses[next(iter(sources))] = 1.
    weights = [0.]*len(records)
    for key, indices in games.items():
        boards = sum(1 for board in board_games if board[0]==key[0])
        phases = len({phase_at[i] for i in indices})
        for index in indices:
            weights[index] = masses[key[0]] / boards / len(board_games[key[:3]]) / phases / len(cells[(*key,phase_at[index])])
    return weights


def dataset_summary(records):
    return {source:dict(positions=sum(r['record']['source']==source for r in records),
        games=len({r['record']['gameId'] for r in records if r['record']['source']==source}))
        for source in sorted({r['record']['source'] for r in records})}


def loss_terms(logits, wdl, score, ownership, legal, target, outcome, score_target, own_target, mask, policy_weight=None, anchor=None, anchor_weight=0.):
    log_probability = F.log_softmax(logits.masked_fill(~legal,-1e9),-1)
    policy = -(target*log_probability).sum(-1)
    if policy_weight is not None:
        policy = policy*policy_weight
    if anchor is not None:
        policy = policy+anchor_weight*F.kl_div(log_probability,anchor,reduction='none').sum(-1)
    value = F.cross_entropy(wdl,outcome,reduction='none')
    points = F.smooth_l1_loss(score,score_target,reduction='none')
    own = (F.cross_entropy(ownership.transpose(1,2),own_target,reduction='none')*mask).sum(1)/mask.sum(1)
    return policy+value+.5*points+.5*own


class Prepared:
    """Cache feature/target tensors on the training device once, rather than each step."""
    def __init__(self, items, adjacency, device):
        self.items, self.count = items, len(items)
        self.data = {k:torch.stack([r[k] for r in items]).to(device) for k in ('x','mask','global_features','legal','policy','own')}
        self.data['raw_policy'] = torch.stack([r.get('raw_policy',r['policy']) for r in items]).to(device)
        self.policy_weight = torch.tensor([r.get('policy_weight',1.) for r in items],device=device)
        self.anchor, self.anchor_weight = None, 0.
        keys = sorted(adjacency)
        self.adjacency = torch.stack([adjacency[k] for k in keys]).to(device)
        self.boards = torch.tensor([keys.index((r['record']['kind'],r['record']['size'])) for r in items],device=device)
        self.outcome = torch.tensor([r['record']['wdl'] for r in items],device=device)
        self.score = torch.tensor([r['record']['score']/r['n'] for r in items],device=device)
        self.n = torch.tensor([r['n'] for r in items],device=device)
        self.indices = torch.arange(len(items),device=device)

    def forward(self, model, indices):
        d = {k:v[indices] for k,v in self.data.items()}
        output = model(d['x'],self.adjacency[self.boards[indices]],d['mask'],d['global_features'])
        loss = loss_terms(*output,d['legal'],d['policy'],self.outcome[indices],self.score[indices],d['own'],d['mask'].squeeze(-1),
            self.policy_weight[indices],None if self.anchor is None else self.anchor[indices],self.anchor_weight)
        return loss, output, d

    @torch.no_grad()
    def anchor_policy(self, teacher, batch_size, weight):
        teacher.eval();self.anchor = torch.empty_like(self.data['policy']);self.anchor_weight = weight
        for start in range(0,self.count,batch_size):
            ix = self.indices[start:start+batch_size]
            logits = teacher(self.data['x'][ix],self.adjacency[self.boards[ix]],self.data['mask'][ix],self.data['global_features'][ix])[0]
            self.anchor[ix] = F.softmax(logits.masked_fill(~self.data['legal'][ix],-1e9),-1)

    @torch.no_grad()
    def evaluate(self, model, batch_size, weights=None, subset=None):
        model.eval()
        indices = self.indices if subset is None else self.indices[subset]
        mass = torch.ones(self.count,device=self.indices.device) if weights is None else torch.tensor(weights,device=self.indices.device)
        mass = mass/mass[indices].sum()
        totals = torch.zeros(11,device=self.indices.device)
        for start in range(0,len(indices),batch_size):
            ix = indices[start:start+batch_size]
            losses, (logits,wdl,score,own), d = self.forward(model,ix)
            ranked = logits.masked_fill(~d['legal'],-1e9).topk(5,-1).indices
            targets = d['raw_policy'].argmax(-1)
            probability = F.softmax(wdl,-1)
            entropy = -(d['raw_policy']*d['raw_policy'].clamp_min(1e-30).log()).sum(-1)
            ce = -(d['raw_policy']*F.log_softmax(logits.masked_fill(~d['legal'],-1e9),-1)).sum(-1)
            totals += torch.stack([(losses*mass[ix]).sum(),losses.sum(),(ranked[:,0]==targets).sum(),
                (ranked==targets[:,None]).any(-1).sum(),(ce-entropy).sum(),(wdl.argmax(-1)==self.outcome[ix]).sum(),
                ((probability-F.one_hot(self.outcome[ix],3))**2).sum(),((score-self.score[ix]).abs()*self.n[ix]).sum(),
                (((own.argmax(-1)==d['own'])*d['mask'].squeeze(-1)).sum(-1)/self.n[ix]).sum(),
                ((ranked[:,0]==160)&(targets==160)).sum(),(targets==160).sum()])
        t = totals.cpu().tolist();n = len(indices)
        return dict(loss=t[0],unweightedLoss=t[1]/n,policyTop1=t[2]/n,policyTop5=t[3]/n,policyKL=t[4]/n,
            wdlAccuracy=t[5]/n,wdlBrier=t[6]/n,scoreMAE=t[7]/n,ownershipAccuracy=t[8]/n,passRecall=t[9]/max(1,t[10]),positions=n)


def batch(items, adjacency):
    return [torch.stack([r[key] for r in items]) for key in ("x",)] + [
        torch.stack([adjacency[(r["record"]["kind"], r["record"]["size"])] for r in items]),
        torch.stack([r["mask"] for r in items]), torch.stack([r["global_features"] for r in items])]


def loss_for(model, items, adjacency):
    device = next(model.parameters()).device
    logits, wdl, score, ownership = model(*(t.to(device) for t in batch(items, adjacency)))
    legal = torch.stack([r["legal"] for r in items]).to(device)
    target = torch.stack([r["policy"] for r in items]).to(device)
    policy_loss = -(target * F.log_softmax(logits.masked_fill(~legal, -1e9), -1)).sum(-1).mean()
    value_loss = F.cross_entropy(wdl, torch.tensor([r["record"]["wdl"] for r in items],device=device))
    score_target = torch.tensor([r["record"]["score"]/r["n"] for r in items], dtype=torch.float32,device=device)
    if not torch.isfinite(score_target).all():
        raise ValueError("Nonfinite score")
    score_loss = F.smooth_l1_loss(score, score_target)
    own_target = torch.stack([r["own"] for r in items]).to(device)
    mask = torch.stack([r["mask"].squeeze(-1) for r in items]).to(device)
    own_loss = (F.cross_entropy(ownership.transpose(1, 2), own_target, reduction="none") * mask).sum(1)/mask.sum(1)
    return policy_loss + value_loss + 0.5 * score_loss + 0.5 * own_loss.mean()


def prediction_metrics(model, items, adjacency):
    device = next(model.parameters()).device
    logits, wdl, _, _ = model(*(t.to(device) for t in batch(items, adjacency)))
    legal = torch.stack([r["legal"] for r in items]).to(device)
    targets = torch.stack([r["policy"] for r in items]).to(device).argmax(-1)
    ranked = logits.masked_fill(~legal, -1e9).topk(5, -1).indices
    outcomes = torch.tensor([r["record"]["wdl"] for r in items],device=device)
    return dict(policyTop1=(ranked[:,0]==targets).sum().item(),
                policyTop5=(ranked==targets[:,None]).any(-1).sum().item(),
                wdlAccuracy=(wdl.argmax(-1)==outcomes).sum().item())


def export(model, directory, examples, adjacency, metadata):
    directory.mkdir(parents=True, exist_ok=True)
    model.eval()
    inputs = batch(examples[:2], adjacency)
    # Export with a shared adjacency input: all leaves within a search use the same board.
    inputs[1] = inputs[1][:1]
    names = ["x", "adjacency", "mask", "global_features"]
    outputs = ["policy", "wdl", "score", "ownership"]
    model_path = directory / "model.onnx"
    with torch.no_grad():
        torch.onnx.export(model, tuple(inputs), str(model_path), input_names=names, output_names=outputs,
            dynamic_axes={name: {0: "batch"} for name in names + outputs if name != "adjacency"},
            opset_version=17, dynamo=False, external_data=False)
        expected = model(*inputs)
    import onnx
    onnx.checker.check_model(onnx.load(str(model_path)))
    metadata.update(dict(architecture="v3", featureVersion=1, points=POINTS, channels=CHANNELS,
        globals=GLOBALS, hidden=HIDDEN, blocks=BLOCKS,
        parameters=sum(p.numel() for p in model.parameters()),
        model="model.onnx", sha256=hashlib.sha256(model_path.read_bytes()).hexdigest(),
        status="experimental", accepted=False))
    from export_webgpu import export_webgpu
    export_webgpu(model, directory, metadata)
    (directory / "manifest.json").write_text(json.dumps(metadata, indent=2)+"\n", encoding="utf-8", newline="\n")
    golden = dict(inputs={k:dict(shape=list(v.shape), data=v.flatten().tolist()) for k,v in zip(names,inputs)},
                  outputs={k:dict(shape=list(v.shape), data=v.flatten().tolist()) for k,v in zip(outputs,expected)})
    (directory / "golden.json").write_text(json.dumps(golden)+"\n", encoding="utf-8", newline="\n")
    torch.save(model.state_dict(), directory / "weights.pt")
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", nargs="+", required=True)
    parser.add_argument("--topologies", default="tools/ai-gnn/target/topologies.json")
    parser.add_argument("--output", default="tools/ai-gnn/target/model")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=20261021)
    parser.add_argument("--resume", help="A trusted local weights.pt checkpoint")
    parser.add_argument("--device", choices=("cpu", "cuda", "auto"), default="cpu")
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--best-validation", action="store_true", help="Export the epoch with the lowest validation loss")
    parser.add_argument('--split-manifest', help='Preserve train/validation game IDs from a previous model')
    parser.add_argument('--balanced', action='store_true', help='Balance source, board, game and game thirds')
    parser.add_argument('--selfplay-mass', type=float, default=.7)
    parser.add_argument('--cosine', action='store_true')
    parser.add_argument('--minimum-learning-rate', type=float, default=3e-5)
    parser.add_argument('--ema-decay', type=float, default=0.)
    parser.add_argument('--policy-temperature', type=float, default=1.)
    parser.add_argument('--minimum-policy-confidence', type=float, default=0.)
    parser.add_argument('--policy-anchor', help='Trusted frozen policy checkpoint used to limit policy drift')
    parser.add_argument('--policy-anchor-weight', type=float, default=0.)
    parser.add_argument('--trainable', choices=('all','value'), default='all', help='Value-only calibration preserves the complete policy function')
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1 or not 0 < args.selfplay_mass < 1 or not 0 <= args.ema_decay < 1:
        parser.error("Invalid epochs, batch size, mixture or EMA decay")
    if args.learning_rate <= 0 or args.minimum_learning_rate <= 0 or (args.cosine and args.minimum_learning_rate > args.learning_rate):
        parser.error('Invalid learning rate range')
    if args.policy_temperature <= 0 or not 0 <= args.minimum_policy_confidence <= 1 or args.policy_anchor_weight < 0 or (args.policy_anchor_weight and not args.policy_anchor):
        parser.error('Invalid policy supervision settings')
    if args.resume and not args.split_manifest:
        previous = Path(args.resume).with_name('manifest.json')
        if previous.is_file():
            args.split_manifest = str(previous)
    torch.set_num_threads(4)
    torch.manual_seed(args.seed)
    device = "cuda" if args.device == "auto" and torch.cuda.is_available() else args.device
    if device == "auto":
        device = "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA unavailable; use uv sync --project tools/ai-gnn --extra cuda")
    rng = random.Random(args.seed)
    model = GraphNet()
    if args.resume:
        model.load_state_dict(torch.load(args.resume, weights_only=True))
    if args.trainable=='value':
        if not args.resume:
            parser.error('Value-only learning requires a trained checkpoint')
        for name,parameter in model.named_parameters():
            parameter.requires_grad_(name.startswith('value.'))
    model.to(device)
    records = load_data(args.data,args.policy_temperature,args.minimum_policy_confidence)
    pinned = json.loads(Path(args.split_manifest).read_text(encoding='utf-8')) if args.split_manifest else None
    train, validation = split_games(records, args.seed, pinned)
    data_sources = dict(train=dataset_summary(train),validation=dataset_summary(validation))
    print(json.dumps(dict(dataSources=data_sources)),flush=True)
    topology_data = json.loads(Path(args.topologies).read_text(encoding="utf-8"))
    adjacency = {}
    for t in topology_data:
        a = torch.zeros(POINTS, POINTS)
        for p, neighbors in enumerate(t["neighbors"]):
            a[p, neighbors] = 1/len(neighbors)
        adjacency[(t["kind"], t["size"])] = a
    trainable_parameters = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable_parameters, lr=args.learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs,eta_min=args.minimum_learning_rate) if args.cosine else None
    ema = copy.deepcopy(model).eval().requires_grad_(False) if args.ema_decay else None
    prepared_train, prepared_validation = Prepared(train,adjacency,device), Prepared(validation,adjacency,device)
    if args.policy_anchor:
        teacher = GraphNet().to(device).eval()
        teacher.load_state_dict(torch.load(args.policy_anchor,map_location=device,weights_only=True))
        prepared_train.anchor_policy(teacher,args.batch_size,args.policy_anchor_weight)
        prepared_validation.anchor_policy(teacher,args.batch_size,args.policy_anchor_weight)
        del teacher
    train_weights = sampling_weights(train,args.selfplay_mass) if args.balanced else None
    validation_weights = sampling_weights(validation,args.selfplay_mass) if args.balanced else None
    initial_metrics = prepared_validation.evaluate(model,args.batch_size,validation_weights)
    initial_by_source = {}
    for source in sorted({r['record']['source'] for r in validation}):
        subset = torch.tensor([r['record']['source']==source for r in validation],device=device)
        initial_by_source[source] = prepared_validation.evaluate(model,args.batch_size,validation_weights,subset)
    print(json.dumps(dict(epoch=0,validation=initial_metrics)),flush=True)
    history = []
    best_loss, best_state, best_epoch = initial_metrics['loss'], None, 0
    if args.best_validation:
        best_state = {k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
    for epoch in range(args.epochs):
        order = rng.choices(range(len(train)),weights=train_weights,k=len(train)) if args.balanced else list(range(len(train)))
        if not args.balanced:
            rng.shuffle(order)
        order = torch.tensor(order,device=device)
        model.train()
        total = 0
        for start in range(0, len(train), args.batch_size):
            indices = order[start:start+args.batch_size]
            optimizer.zero_grad()
            loss = prepared_train.forward(model,indices)[0].mean()
            if not torch.isfinite(loss):
                raise ValueError("Nonfinite training loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable_parameters, 5)
            optimizer.step()
            if ema is not None:
                with torch.no_grad():
                    for average, value in zip(ema.parameters(),model.parameters()):
                        average.lerp_(value,1-args.ema_decay)
            total += loss.item()*len(indices)
        model.eval()
        val_metrics = prepared_validation.evaluate(ema if ema is not None else model,args.batch_size,validation_weights)
        val = val_metrics['loss']
        metrics = dict(epoch=epoch+1,trainLoss=total/len(train),validationLoss=val,learningRate=optimizer.param_groups[0]['lr'],validation=val_metrics)
        history.append(metrics)
        if val < best_loss:
            best_loss, best_epoch = val, epoch+1
            if args.best_validation:
                best_state = {k:v.detach().cpu().clone() for k,v in (ema if ema is not None else model).state_dict().items()}
        print(json.dumps(metrics), flush=True)
        if scheduler is not None:
            scheduler.step()
    if best_state is not None:
        model.load_state_dict(best_state)
    elif ema is not None:
        model.load_state_dict(ema.state_dict())
    validation_metrics = prepared_validation.evaluate(model,args.batch_size,validation_weights)
    by_source = {}
    for source in sorted({r['record']['source'] for r in validation}):
        subset = torch.tensor([r['record']['source']==source for r in validation],device=device)
        by_source[source] = prepared_validation.evaluate(model,args.batch_size,validation_weights,subset)
    model.cpu()
    model.eval()
    print(json.dumps(dict(validationMetrics=validation_metrics)),flush=True)
    # Golden batch must have a common topology, as in production searches.
    examples = [r for r in validation if (r["record"]["kind"],r["record"]["size"]) ==
                (validation[0]["record"]["kind"],validation[0]["record"]["size"])]
    metadata = export(model, Path(args.output), examples, adjacency,
        dict(seed=args.seed, epochs=args.epochs, trainPositions=len(train), validationPositions=len(validation),
            trainGames=sorted({r["record"]["gameId"] for r in train}),
            validationGames=sorted({r["record"]["gameId"] for r in validation}), history=history,
            device=device, torchVersion=torch.__version__, learningRate=args.learning_rate,
            selectedEpoch=best_epoch if args.best_validation else args.epochs,
            selection=("minimum balanced validation loss including initial checkpoint" if args.balanced else "minimum validation loss including initial checkpoint") if args.best_validation else "last epoch",
            validationMetrics=validation_metrics,initialValidationMetrics=initial_metrics,validationBySource=by_source,initialValidationBySource=initial_by_source,
            sampling='source/board/game/thirds' if args.balanced else 'uniform positions',selfplayMass=args.selfplay_mass,
            emaDecay=args.ema_decay,learningRateSchedule='cosine' if args.cosine else 'constant',minimumLearningRate=args.minimum_learning_rate,
            splitManifestSha256=hashlib.sha256(Path(args.split_manifest).read_bytes()).hexdigest() if args.split_manifest else None,
            dataSources=data_sources,
            policyTemperature=args.policy_temperature,minimumPolicyConfidence=args.minimum_policy_confidence,
            policyAnchorSha256=hashlib.sha256(Path(args.policy_anchor).read_bytes()).hexdigest() if args.policy_anchor else None,policyAnchorWeight=args.policy_anchor_weight,
            trainable=args.trainable,trainableParameters=sum(p.numel() for p in trainable_parameters),
            dataSha256={str(p):hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in args.data}))
    print(json.dumps(dict(parameters=metadata["parameters"], onnxBytes=(Path(args.output)/"model.onnx").stat().st_size)))


if __name__ == "__main__":
    main()
