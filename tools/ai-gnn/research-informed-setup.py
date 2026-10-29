import json,hashlib,shutil,subprocess,datetime
from pathlib import Path
root=Path('tools/ai-gnn/target/research-informed-study-20261028')
if root.exists(): raise RuntimeError('Refuse to overwrite study workspace')
root.mkdir(parents=True);(root/'results').mkdir();(root/'sources').mkdir();(root/'baseline').mkdir()
plan_path=Path('experiments/ai/plans/v3-research-informed-improvement/plan.json')
plan=json.loads(plan_path.read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
for path,key in [(plan['baseline']['model'],'modelSha256'),(plan['baseline']['weights'],'weightsSha256'),(plan['baseline']['wasm'],'wasmSha256')]:
 assert sha(path)==plan['baseline'][key],path
assert sha(plan['phase0']['input'])==plan['phase0']['inputSha256']
shutil.copy2(plan_path,root/'plan.json')
for name in ['model.onnx','weights.f32','manifest.json','KataGo-NN-LICENSE.txt']:shutil.copy2(Path('dist/models/v3')/name,root/'baseline'/name)
shutil.copy2('experiments/ai/v3/2026-10-27-katago-distillation/data/teacher-model/weights.pt',root/'baseline/weights.pt')
shutil.copy2('tools/ai-gnn/target/learning-scope-study-20261028/topologies.json',root/'topologies.json')
shutil.copy2('tools/ai-gnn/target/learning-scope-study-20261028/reported-game.json',root/'reported-game.json')
shutil.copy2('dist/ai-v3.wasm',root/'search.wasm')
sources=['tools/ai-gnn/train.py','tools/ai-gnn/model.py','tools/ai-gnn/export_webgpu.py','tools/ai-gnn/research-informed-setup.py','tools/ai-gnn/research-informed-coverage.py','dist/ai-v3-search.js','dist/ai-position.js','dist/engine.js']
for p in sources:shutil.copy2(p,root/'sources'/Path(p).name)
record=dict(started=datetime.datetime.now(datetime.timezone.utc).isoformat(),planSha256=sha(plan_path),sourceHashes={p:sha(p) for p in sources},baselineCheckpointSha256=sha(root/'baseline/weights.pt'),topologiesSha256=sha(root/'topologies.json'),authorization='User requested experiment execution after the planning turn.',preliminaryInspection='Read-only inspection counted raw records and tail support before the full audit; no learning or match outcomes viewed.')
(root/'registration.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(workspace=str(root),registered=True,planSha256=record['planSha256'])))
