import {readFileSync,writeFileSync,readdirSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join,relative} from 'node:path';
const root='tools/ai-gnn/target/research-informed-study-20261028',dest='experiments/ai/v3/2026-10-28-research-informed-study';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const p=JSON.parse(readFileSync(root+'/plan.json')),preflight=JSON.parse(readFileSync(root+'/results/preflight.json'));
if(preflight.bothSoftReplicasEligible)throw Error('This archiver currently expects the registered preflight stop');
if(existsSync(dest))throw Error('Archive exists');
const controls=preflight.results.filter(r=>r.arm==='Control'),soft=preflight.results.filter(r=>r.arm==='Soft4');
const decision={schemaVersion:1,date:new Date().toISOString(),adopted:false,reason:'Both Soft4 replicas select epoch0 and fail the registered common-validation improvement gate.',trainingRuns:4,epochs:32,developmentGames:0,independentGames:0,independentConsumed:false,productionUpdated:false,results:preflight.results};
writeFileSync(root+'/results/decision.json',JSON.stringify(decision,null,2)+'\n');
const shaList=['tools/ai-gnn/model.py','tools/ai-gnn/train.py','tools/ai-gnn/test_training.py','tools/ai-gnn/test_model.py','tools/ai-gnn/test_soft_policy.py'];
writeFileSync(root+'/results/correctness.json',JSON.stringify({trainingTests:16,modelTests:2,softPolicyTests:4,totalPassed:22,commands:['python -m unittest discover -s tools/ai-gnn -p test_soft_policy.py -v','python -m unittest discover -s tools/ai-gnn -p test_training.py','python -m unittest discover -s tools/ai-gnn -p test_model.py'],sourceHashes:Object.fromEntries(shaList.map(p=>[p,hash(p)])),exportParity:preflight.results.map(r=>({id:r.id,parameters:r.inferenceParameters,maxErrors:r.exportParityMaxErrors})),workerAndLatency:'Not run: registered validation gate failed before matches. No strength or speed gain claimed.'},null,2)+'\n');
const files=[];
function copy(source,target){mkdirSync(join(dest,target,'..'),{recursive:true});const bytes=readFileSync(source),compress=bytes.length>65536&&/\.(json|jsonl|log|txt)$/.test(source),out=target+(compress?'.gz':'');writeFileSync(join(dest,out),compress?gzipSync(bytes,{level:9}):bytes);files.push({source,archive:out,compressed:compress,originalBytes:bytes.length,originalSha256:createHash('sha256').update(bytes).digest('hex'),storedSha256:hash(join(dest,out))});}
function tree(base){for(const e of readdirSync(base,{withFileTypes:true})){const f=join(base,e.name);if(e.isDirectory())tree(f);else copy(f,'data/workspace/'+relative(root,f).replaceAll('\\','/'));}}
tree(root);
for(const name of ['research-informed-setup.py','research-informed-coverage.py','research-informed-train.mjs','research-informed-preflight.py','research-informed-matches.mjs','research-informed-archive.mjs','model.py','train.py','test_soft_policy.py','test_training.py','test_model.py','export_webgpu.py','study-commands.mjs'])copy('tools/ai-gnn/'+name,'data/tools/'+name);
for(const name of ['README.md','plan.json'])copy('experiments/ai/plans/v3-research-informed-improvement/'+name,'data/plan/'+name);
const validation=JSON.parse(readFileSync(root+'/results/coverage.json')).groups['validation/all'];
const table=preflight.results.map(r=>'| '+r.id+' | '+r.selectedEpoch+' | '+(r.relativeGain*100).toFixed(3)+'% | '+(r.eligible?'対照として有効':'基準不達')+' |').join('\n');
const report=['# 研究を踏まえたv3補助方策学習の実験','',
 '2026年10月28日実施。教師診断と2方式×2 seedの学習を完了。**Soft4は両seedとも学習前のepoch0を選び、対局評価の前提条件に届かなかったため不採用**。通常対局のモデル・WASMは更新していない。','',
 '[事前計画](../../plans/v3-research-informed-improvement/README.md)と[最終判定](data/workspace/results/decision.json)を参照。独立評価は未実施で、旧実験の独立局も学習や選択に使っていない。','',
 '## 教師の診断','',
 '生データ12,453局面から証明済み負け67局面を従来どおり除外し、学習9,263・検証3,123局面を使用。元対局144群の分割重複とpositionId重複は0。別対局間で同じモデル入力になる指紋は31件あり、共通序盤などの一致として明示した。由来対局の漏洩とは区別する。','',
 '学習局面の98.834%で上位2手以外に1%以上の教師確率があったため、補助学習を試す事前条件を満たした。検証局面では教師最善手の上位8候補への包含率は'+(validation.top8Recall.mean*100).toFixed(2)+'%、教師確率の被覆率は'+(validation.top8Mass.mean*100).toFixed(2)+'%。これはNNの合法手順位であり、戦術的な候補除外まで再現した値ではない。','',
 '曲面の教師と共通検証目標は、ノイズなし4096探索の最終方策75%＋元NN事前分布25%。平面はKataGo512の方策（変換時の合法一様混合2%を含む）。初回監査は曲面のvalidationPolicyを生の探索方策と同一視して失敗したため、生成ソースを照合して監査を修正した。教師データ自体は変更していない。','',
 '[全診断](data/workspace/results/coverage.json.gz)と[データ監査](data/workspace/results/data-audit.json)に盤・時期・教師・捕獲・呼吸点別の集計を保存。','',
 '## 学習結果','',
 '通常の追加学習Controlと、温度4・係数1の学習専用補助方策出力を追加したSoft4を比較。各2 seed、8epoch、共通の対局分割・ミニバッチ順・学習率・EMAを使用。選択には補助損失を含めず、既存形式の共通検証損失を使った。','',
 '| 方式 | 選択epoch | 共通検証損失の相対改善 | 判定 |','| --- | ---: | ---: | --- |',table,'',
 'Soft4は更新後の共通検証損失が悪化し、初期重みが最良だった。事前の0.1%以上改善を満たさず、対局0局で終了。係数・温度・学習回数を結果に合わせて変更していない。この結果は、この小型GNN・既存教師・初期化・係数・8epochという条件で改善を確認できなかったことを示し、KataGoの手法全般の否定ではない。','',
 '## 実装・検証','',
 '補助出力は通常の着手・パス出力から乱数を消費せず複製する。違法手と盤外を除外し、教師のゼロ確率を維持。学習後の出力は補助出力を除去し、推論時120,905パラメータの元形式へ戻す。選択した学習用重みと推論用重みの一致を4モデルで確認した。','',
 '既存学習16件・モデル2件・新規補助学習4件の計22テストが通過。係数0で通常学習と同じ更新結果になること、補助損失が本体へ伝わること、対象外局面の損失が変わらないこと、出力除去時の一致を確認した。各モデルのPyTorch golden一致と推論形式も確認。事前条件で止まったため実ブラウザ・速度・独立棋力評価は未実施。','',
 '## 次段階','',
 '第1段階を閉じ、新規教師・データ収集の費用と教師の強さを別計画で予備測定する。係数の探索を続けるより、新しい局面・教師の質・学習目標を分離して調べる。','',
 'data/workspaceに不変の実行用計画、登録記録、4学習のコマンド・ログ・全checkpoint・選択モデルを保存した。大きいJSONとログはgzip圧縮し、manifest.jsonに元と保存後のSHA-256を記録。教師本体は以前の保存データをハッシュで参照する。',''].join('\n');
writeFileSync(dest+'/README.md',report);writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,files},null,2)+'\n');
for(const f of files){if(hash(join(dest,f.archive))!==f.storedSha256)throw Error('Archive hash mismatch');}
console.log(JSON.stringify({archive:dest,files:files.length,decision:decision.reason}));
