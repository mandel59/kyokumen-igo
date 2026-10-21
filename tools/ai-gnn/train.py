"""uv run --project tools/ai-gnn python tools/ai-gnn/train.py --data DATA.jsonl --output DIR"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import torch
from torch.nn import functional as F
from model import GraphNet, POINTS, CHANNELS, GLOBALS, HIDDEN, BLOCKS


def load_data(paths):
    records = []
    for path in paths:
        with open(path, encoding="utf-8") as source:
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
                own = torch.tensor(r["ownership"], dtype=torch.long)
                if own.shape != (n,) or (own < 0).any() or (own > 2).any() or r["wdl"] not in (0, 1, 2):
                    raise ValueError("Invalid outcome target")
                global_features = torch.tensor(r["global"], dtype=torch.float32)
                if global_features.shape != (GLOBALS,) or not torch.isfinite(x).all() or not torch.isfinite(global_features).all():
                    raise ValueError("Invalid features")
                records.append(dict(record=r, n=n, x=F.pad(x, (0, 0, 0, POINTS-n)),
                    mask=F.pad(torch.ones(n, 1), (0, 0, 0, POINTS-n)), global_features=global_features,
                    legal=legal, policy=policy, own=F.pad(own, (0, POINTS-n), value=1)))
    if not records:
        raise ValueError("No data")
    return records


def split_games(records, seed):
    groups = {}
    for r in records:
        key = (r["record"]["kind"], r["record"]["size"])
        groups.setdefault(key, set()).add(r["record"]["gameId"])
    rng = random.Random(seed)
    validation = set()
    for key, ids in sorted(groups.items()):
        ids = sorted(ids)
        if len(ids) < 2:
            raise ValueError(f"Need at least two completed games per board: {key}")
        rng.shuffle(ids)
        validation.update(ids[:max(1, len(ids)//5)])
    return ([r for r in records if r["record"]["gameId"] not in validation],
            [r for r in records if r["record"]["gameId"] in validation])


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
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        parser.error("epochs and batch size must be positive")
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
    model.to(device)
    records = load_data(args.data)
    train, validation = split_games(records, args.seed)
    topology_data = json.loads(Path(args.topologies).read_text(encoding="utf-8"))
    adjacency = {}
    for t in topology_data:
        a = torch.zeros(POINTS, POINTS)
        for p, neighbors in enumerate(t["neighbors"]):
            a[p, neighbors] = 1/len(neighbors)
        adjacency[(t["kind"], t["size"])] = a
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    history = []
    best_loss, best_state, best_epoch = float("inf"), None, 0
    for epoch in range(args.epochs):
        rng.shuffle(train)
        model.train()
        total = 0
        for start in range(0, len(train), args.batch_size):
            items = train[start:start+args.batch_size]
            optimizer.zero_grad()
            loss = loss_for(model, items, adjacency)
            if not torch.isfinite(loss):
                raise ValueError("Nonfinite training loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5)
            optimizer.step()
            total += loss.item()*len(items)
        model.eval()
        with torch.no_grad():
            val = sum(loss_for(model, validation[i:i+args.batch_size], adjacency).item()*len(validation[i:i+args.batch_size])
                for i in range(0,len(validation),args.batch_size))/len(validation)
        metrics = dict(epoch=epoch+1, trainLoss=total/len(train), validationLoss=val)
        history.append(metrics)
        if val < best_loss:
            best_loss, best_epoch = val, epoch+1
            if args.best_validation:
                best_state = {k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
        print(json.dumps(metrics), flush=True)
    if best_state is not None:
        model.load_state_dict(best_state)
    model.cpu()
    model.eval()
    validation_metrics = dict(policyTop1=0, policyTop5=0, wdlAccuracy=0)
    with torch.no_grad():
        for i in range(0,len(validation),args.batch_size):
            for key,value in prediction_metrics(model,validation[i:i+args.batch_size],adjacency).items():
                validation_metrics[key] += value/len(validation)
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
            selection="minimum validation loss" if args.best_validation else "last epoch",
            validationMetrics=validation_metrics,
            dataSha256={str(p):hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in args.data}))
    print(json.dumps(dict(parameters=metadata["parameters"], onnxBytes=(Path(args.output)/"model.onnx").stat().st_size)))


if __name__ == "__main__":
    main()
