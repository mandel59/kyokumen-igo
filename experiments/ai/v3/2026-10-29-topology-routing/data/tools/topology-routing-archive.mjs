// Archive the one fixed routing candidate, including unsuccessful commands and all traces.
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';
import{gzipSync}from'node:zlib';
import{join,relative}from'node:path';
const root='tools/ai-gnn/target/topology-routing-study-20261029',dest='experiments/ai/v3/2026-10-29-topology-routing';
if(existsSync(dest))throw Error('Archive already exists');
const read=p=>JSON.parse(readFileSync(root+'/'+p)),maybe=p=>existsSync(root+'/'+p)?read(p):null;
const plan=read('plan.json'),selection=read('results/selection.json'),dev=read('results/development-summary.json'),audit=read('results/development-replay-audit.json'),ind=maybe('results/independent-decision.json'),latency=maybe('results/latency-decision.json'),timed=maybe('results/equal-time.json');
assert.ok(audit.passed);if(selection.selected)assert.ok(ind,'Independent phase required');if(ind){assert.ok(read('results/independent-replay-audit.json').passed);if(ind.passesStrength)assert.ok(latency,'Latency gates required');}if(ind?.passesStrength&&latency?.passed)assert.ok(timed);
const qualified=Boolean(ind?.passesStrength&&latency?.passed&&timed),integration=maybe('results/local-integration.json');
if(qualified)assert.ok(integration?.passed,'Qualified bundle must complete local integration');
const reason=!selection.selected?'Development gates failed':!ind.passesStrength?'Independent strength gates failed':!latency.passed?'Client latency gates failed':'All gates passed; locally integrated';
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const[f,sha]of Object.entries(read('results/preflight.json').runtimeHashes))assert.equal(hash(readFileSync(f)),sha,'Frozen runtime changed: '+f);
if(!qualified){assert.equal(hash(readFileSync(plan.baseline.model)),plan.baseline.modelSha256);assert.equal(hash(readFileSync(plan.baseline.wasm)),plan.baseline.wasmSha256);}
const decision={schemaVersion:1,finished:new Date().toISOString(),qualified,adopted:Boolean(integration?.passed),productionUpdated:Boolean(integration?.passed),reason,trainingRuns:0,newTeacherQueries:0,developmentGames:audit.games,developmentTurns:audit.turns,independentGames:ind?432:0,independentConsumed:Boolean(ind),selection,independent:ind,latency,equalTime:timed?{completed:true,path:'results/equal-time.json'}:null,modelNNBytes:read('registration.json').components,limitation:'Fixed64 visits on a PC; no human-rank or phone speed claim.'};
writeFileSync(root+'/results/decision.json',JSON.stringify(decision,null,2)+'\n');
const files=[];
function copy(source,target){const b=readFileSync(source),compress=b.length>65536&&/\.(json|jsonl|log|txt)$/.test(source),out=target+(compress?'.gz':'');mkdirSync(join(dest,out,'..'),{recursive:true});const bytes=compress?gzipSync(b,{level:9}):b;writeFileSync(join(dest,out),bytes);files.push({source,archive:out,compressed:compress,originalBytes:b.length,originalSha256:hash(b),storedSha256:hash(bytes)});}
function tree(base){for(const e of readdirSync(base,{withFileTypes:true})){const p=join(base,e.name);if(e.isDirectory())tree(p);else copy(p,'data/workspace/'+relative(root,p).replaceAll('\\','/'));}}
tree(root);
for(const f of ['topology-routing-prepare.mjs','topology-routing-matches.mjs','topology-routing-audit.mjs','topology-routing-archive.mjs','topology-routing-fixture.mjs','topology-routing-fixture-browser.mjs','topology-routing-install.mjs','node-topology-inference.mjs','test-node-topology-inference.mjs','match.mjs','selfplay.mjs','reanalyze.mjs','refresh-search-targets.mjs','test-onnx.mjs','bench-inference.mjs','replay-endgame.mjs','test-topology-routing.mjs','test-topology-routing-integrity.mjs','test-topology-routing-browser.mjs','topology-routing-timing-prepare.mjs','topology-routing-latency.mjs','topology-routing-cold-bench.mjs','topology-routing-equal-time.mjs','test-player.mjs','test-browser.mjs','node-inference.mjs','study-commands.mjs','match-statistics.mjs','browser-data-host.mjs','search-campaign-bench.mjs'])copy('tools/ai-gnn/'+f,'data/tools/'+f);
for(const f of ['ai-v3.js','ai-v3-routing.js','ai-v3-inference.js','ai-v3-webgpu.js','ai-v3-search.js','ai-worker.js','engine.js','ai-position.js'])copy('dist/'+f,'data/runtime/'+f);
copy('v3-tests.mjs','data/tools/v3-tests.mjs');
if(integration?.passed){
 for(const suffix of['','/plane'])for(const f of['model.onnx','weights.f32','manifest.json','KataGo-NN-LICENSE.txt'])copy('dist/models/v3'+suffix+'/'+f,'data/installed/models/v3'+suffix+'/'+f);
 copy('tests/fixtures/ai/v3-golden.json','data/installed/tests/fixtures/ai/v3-golden.json');
}
for(const f of ['README.md','plan.json'])copy('experiments/ai/plans/v3-topology-routing/'+f,'data/plan/'+f);
const r=dev.results[0],boards=r.all.boards.map(b=>'| '+b.board+' | '+b.score+'/'+b.games+' | '+(ind?(()=>{const x=ind.result.all.boards.find(x=>x.board===b.board);return x.score+'/'+x.games;})():'未実施')+' |').join('\n');
const report=['# 盤面別モデルによるv3改善実験','',
 '2026年10月29日実施。平面用NewDataと曲面用CompletedQを固定し、盤面の種類だけで切り替える1候補を、新しい開発72局で配信v3と比較した。'+(qualified?'全採用条件を満たし、ローカルの配信資産へ反映した。':'採用条件を満たさず、配信モデルとWASMは維持した。'),'',
 '[登録計画](../../plans/v3-topology-routing/README.md) / [最終判定](data/workspace/results/decision.json) / [全棋譜監査](data/workspace/results/development-replay-audit.json)','',
 '## 対局結果','',
 '| 対象 | 基準v3に対する成績 |','| --- | ---: |',
 '| 全体 | '+r.all.wins+'勝'+r.all.losses+'敗 ('+(100*r.all.scoreRate).toFixed(1)+'%) |',
 '| 平面 | '+r.plane.wins+'勝'+r.plane.losses+'敗 |',
 '| 曲面 | '+r.curves.wins+'勝'+r.curves.losses+'敗 |','',
 '| 盤面 | 開発の得点/局数 | 独立の得点/局数 |','| --- | ---: | ---: |',boards,'',
 '開発採用条件は40/72点以上、各盤3/8点以上、平面・曲面それぞれ50%以上。'+reason+'。未達条件: '+(Object.entries(selection.candidates[0].gates).filter(([,v])=>!v).map(([k])=>k).join(', ')||'なし')+'。','',
 ind?'独立432局は'+ind.result.all.wins+'勝'+ind.result.all.losses+'敗、得点率'+(100*ind.result.all.scoreRate).toFixed(2)+'%、先後ペアを保つ盤別層化bootstrap95%区間'+ind.result.all.pairedBootstrap.interval95.map(x=>(100*x).toFixed(2)).join('〜')+'%。独立条件の未達: '+(Object.entries(ind.gates).filter(([,v])=>!v).map(([k])=>k).join(', ')||'なし')+'。':'独立432局・速度採用試験は未実施。登録した停止条件に従い、この組合せの追加対局や結果を見た別モデルへの差替えは行っていない。','',
 '各盤4ペアで先後を入れ替え、同じ合法な初手4手と各手seedを共有した。64訪問・FPU1・上位8候補・コミ6.5・最大6N手。制限到達も除外せず実際の面積で採点する。全'+audit.games+'局・'+audit.turns+'手を再生し、手番、seed、モデルハッシュ、合法性、訪問数、最終採点を照合した。打切りは'+audit.capped+'局。過去の2モデルの対局成績は合算していない。','',
 '## 実装と正確性','',
 'manifestの任意のmodelRoutesで平面だけ子モデルへ振り分け、宣言したSHA-256を照合する。探索中のキャンセルと完了待ち・破棄後に新しいモデルを初期化する。同時に有効なプレイヤーは1つで、1手では120,905パラメータの1モデルだけを使う。両モデルのONNXとFP32を合わせた保存サイズは1,972,042バイト（単体986,021バイト）。通常の単一モデルmanifestでは経路は有効にならない。','',
 '切替・初期化・連続要求・キャンセル・破棄・読込失敗の7テストと、異なるモデルの拒否を実際のローダーで確認する2テスト、従来プレイヤーとv3全体の回帰チェックを通過した。実Edge WorkerではCPU/WebGPU各9盤で単体子モデルとの選択手と方策が完全一致し、アプリWorkerで平面7/9/11→トーラス7の切替、初期化中のキャンセル後の再開を通過した。速度測定ではないため初期化時間の採用可否は主張しない。','',
 'テスト実行時にVMのNodeオプションを省いた1回の起動失敗も保存した。--experimental-vm-modulesを付けた再実行は成功し、実装変更は不要だった。','',
 '独立対局では球面4が20勝28敗、平面7が19勝29敗であり、盤面ごとの課題は残る。これらも除外せず、事前に定めた各盤19/48点以上の下限と合わせて判定した。','',
 '## 速度と容量','',
 latency?'通常/ストレス速度: '+latency.warmAndStressPass+'、初期化/切替速度: '+latency.coldAndSwitchPass+'。[全速度判定](data/workspace/results/latency-decision.json)と[同一時間の局面診断](data/workspace/results/equal-time.json)を参照。基準モデルのみで時間予算を固定してから候補を測定し、対局・学習とは同時に実行していない。':'独立強度の条件を通過していないため速度採用試験は行っていない。実ブラウザの正確性試験で得た時間を速度の採用根拠にしない。','',
 'ONNXとFP32の合計保存サイズは2モデルで1,972,042バイト、単体は986,021バイト。通常の推論バックエンドが1つの形式を読み込む場合、各形式のロード容量は別途記録される。同時に使うモデル数と1手の推論規模は増やさない。初期化・切替には再読み込みが必要になる。実機スマートフォンの測定は行っていない。','',
 '## 元のL6局面','',
 '元の40手目は学習や採否に使わず別の診断にした。基準v3ではL6の事前確率順位14位・0訪問・J3選択、候補では8位・20訪問・L6選択となった。実Edge WorkerのCPU/WebGPUも4seedずつ全てL6を選んだ。[ブラウザ診断](data/workspace/results/reported-browser-diagnostic.json)に実際の子モデルSHAと選択手を記録した。独立対局とは別の公開局面であり、この結果から一般的な強さを判定しない。','',
 '## 採用後の互換性確認','',
 integration?.passed?'ローカルのv3モデル・子モデル・検証用goldenを反映し、全9盤のNode ONNX・実Edge CPU/WebGPU・実アプリWorker・探索回帰を再度通過した。[反映記録](data/workspace/results/local-integration.json)に前後のハッシュを保存した。学習・再解析・対局CLIは盤面ごとにモデルを指定し、各盤や教師行に実際の子モデルSHAを記録する。Node用共通切替処理も全9盤で単体子モデルとの全出力一致と旧単体モデルの互換性を通過した。':'ローカル資産への反映は行っていない。','',
 '対局実験に使ったソースはworkspace/sourcesと各phaseの登録情報で固定している。採用後のCLI互換変更と実際に反映した資産は別のtools/installedスナップショットに保存した。配信WASMと推論計算式は変更していない。','',
 '## 保存と次の検討','',
 'モデル2個、単体基準、全棋譜、各手の探索診断、コマンドと失敗を含むログ、事前登録、実行ソース、ブラウザ報告を保存した。大きなJSON/ログはgzip圧縮し、元ファイルと保存ファイルのSHA-256をmanifest.jsonに記録した。学習・教師問い合わせはこの切替実験では0回。','',
 '平面と曲面を別々に評価する必要性は残る。次の学習実験は今回の開発棋譜を独立検証として再利用せず、平面の教師改善と曲面の保持を同時に検証する新しい計画・seedで行う。人間の棋力や実機スマートフォンの速度は未検証。',''].join('\n');
writeFileSync(dest+'/README.md',report);writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,files},null,2)+'\n');console.log(JSON.stringify({archive:dest,files:files.length,qualified,reason}));
