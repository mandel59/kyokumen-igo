// Save a completed registered round without changing deployed model assets.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join,relative} from 'node:path';
const root='tools/ai-gnn/target/curve-retention-study-20261029',dest='experiments/ai/v3/2026-10-29-curve-retention';
if(existsSync(dest))throw Error('Archive exists');
const read=p=>JSON.parse(readFileSync(root+'/'+p)),maybe=p=>existsSync(root+'/'+p)?read(p):null;
const plan=read('plan.json'),preflight=read('results/preflight.json'),dev=maybe('results/development-summary.json'),selection=maybe('results/selection.json'),ind=maybe('results/independent-decision.json'),latency=maybe('results/latency-decision.json'),timed=maybe('results/equal-time.json');
if(preflight.candidateIds.length&&!selection)throw Error('Development incomplete');
if(selection?.selected&&!ind)throw Error('Independent evaluation incomplete');
if(dev&&!read('results/development-replay-audit.json').passed)throw Error('Development replay audit missing');
if(ind&&!read('results/independent-replay-audit.json').passed)throw Error('Independent replay audit missing');
if(ind?.passesStrength&&!latency)throw Error('Latency gate incomplete');
if(ind?.passesStrength&&latency?.passed&&!timed)throw Error('Registered equal-time diagnostic incomplete');
const qualified=Boolean(ind?.passesStrength&&latency?.passed&&timed);
const reason=!preflight.candidateIds.length?'Preflight gate failed':!selection.selected?'Development adoption gates failed':!ind.passesStrength?'Independent strength gates failed':!latency.passed?'Client latency gate failed':'All registered gates passed; qualified for local integration';
const decision={schemaVersion:1,finished:new Date().toISOString(),qualified,adopted:false,productionUpdated:false,reason,trainingRuns:3,epochs:48,newTeacherQueries:0,developmentGames:dev?dev.results.reduce((s,r)=>s+r.all.games,0):0,independentGames:ind?432:0,independentConsumed:Boolean(ind),preflight,selection,independent:ind,latency,equalTime:timed?{completed:true,path:'results/equal-time.json'}:null};
writeFileSync(root+'/results/decision.json',JSON.stringify(decision,null,2)+'\n');
const files=[],hash=b=>createHash('sha256').update(b).digest('hex');
function copy(source,target){const b=readFileSync(source),compress=b.length>65536&&/\.(json|jsonl|log|txt)$/.test(source),out=target+(compress?'.gz':'');mkdirSync(join(dest,out,'..'),{recursive:true});const bytes=compress?gzipSync(b,{level:9}):b;writeFileSync(join(dest,out),bytes);files.push({source,archive:out,compressed:compress,originalBytes:b.length,originalSha256:hash(b),storedSha256:hash(bytes)});}
function tree(base){for(const e of readdirSync(base,{withFileTypes:true})){const p=join(base,e.name);if(e.isDirectory())tree(p);else copy(p,'data/workspace/'+relative(root,p).replaceAll('\\','/'));}}
tree(root);
const tools=['curve-retention-prepare.mjs','curve-retention-train.mjs','curve-retention-preflight.py','curve-retention-verify.mjs','curve-retention-matches.mjs','curve-retention-audit.mjs','curve-retention-diagnostic.py','curve-retention-fixture.mjs','curve-retention-archive.mjs','completed-q-target.mjs','test-completed-q-target.mjs','test_curve_retention.py','model.py','train.py','test_training.py','test_model.py','test_soft_policy.py','test_fresh_replay.py','export_webgpu.py','node-inference.mjs','study-commands.mjs','match-statistics.mjs','test-browser.mjs','browser-data-host.mjs'];
for(const f of tools)copy('tools/ai-gnn/'+f,'data/tools/'+f);
for(const f of ['curve-retention-bench.mjs','curve-retention-equal-time.mjs'])if(existsSync('tools/ai-gnn/'+f))copy('tools/ai-gnn/'+f,'data/tools/'+f);
for(const f of ['engine.js','ai-position.js','ai-v3-search.js','ai-v3-inference.js','ai-v3-webgpu.js','ai-v3.js','record.js'])copy('dist/'+f,'data/runtime/'+f);
for(const f of ['README.md','plan.json'])copy('experiments/ai/plans/v3-curve-retention/'+f,'data/plan/'+f);
const decisionLink=files.find(f=>f.archive.startsWith('data/workspace/results/decision.json')).archive;
const table=preflight.results.map(r=>'| '+r.id+' | '+r.selectedEpoch+' | '+(100*r.relativeGain).toFixed(3)+'% |').join('\n');
const games=dev?dev.results.map(r=>'| '+r.id+' | '+r.all.wins+'勝'+r.all.losses+'敗 | '+(100*r.plane.scoreRate).toFixed(1)+'% | '+(100*r.curves.scoreRate).toFixed(1)+'% |').join('\n'):'対局未実施';
const drift=read('results/curve-drift-diagnostic.json').results.map(r=>'| '+r.id+' | '+r.equalBoardMean.policyKL.toFixed(5)+' | '+r.equalBoardMean.wdlKL.toFixed(5)+' |').join('\n');
const fixture=read('results/reported-game-diagnostic.json').rows.filter(r=>r.seed===0).map(r=>'| '+r.id+' | '+r.L6.rank+' | '+r.L6.visits+' | '+r.selected+' |').join('\n');
const hold=ind?'独立432局は'+ind.result.all.wins+'勝'+ind.result.all.losses+'敗。得点率'+(100*ind.result.all.scoreRate).toFixed(2)+'%、ペア単位95%区間'+ind.result.all.pairedBootstrap.interval95.map(x=>(100*x).toFixed(2)).join('〜')+'%。':'独立432局は未実施。失敗後に別候補へ差し替えたり追加対局で条件を満たすまで続けたりしていない。';
const gateRows=selection?selection.candidates.map(r=>'| '+r.id+' | '+r.all.score+'/'+r.all.games+' | '+Object.entries(r.gates).filter(([,v])=>!v).map(([k])=>k).join(', ')+' |').join('\n'):'候補なし';
const report=['# 曲面保持とcompleted-Q教師によるv3改善実験','',
 '2026年10月29日実施。[事前計画](../../plans/v3-curve-retention/README.md)に従い、対照Control、曲面保持CurveGuard、曲面保持＋Q教師CompletedQを比較した。**'+(qualified?'全ての採用条件を通過した候補を保存した。配信資産の更新は別の統合記録に従う。':'今回も総合採用条件を満たさず、配信モデルとWASMを維持する。')+'**','',
 '[最終判定]('+decisionLink+')に採否と全条件を保存。'+reason+'。','',
 '## 変更した内容','',
 '前回は新しい平面データでL6を選べるようになったが、曲面の条件を割って不採用だった。今回は同じ追加データ・対局分割・各盤1/9の学習重みを保ち、学習法と曲面の方策教師を分けて比較した。','',
 'CurveGuardは固定した配信モデルの方策・勝敗・得点・所有の出力を曲面の学習局面だけで保持する。係数1で方策KL＋勝敗KL＋0.5得点MSE＋0.5所有KLを追加し、平面の損失と共通のモデル選択損失へは加えない。推論用の出力やパラメータは増やしていない。','',
 'CompletedQは保持損失を同じにし、既存の4096訪問の曲面教師からQ・訪問数・生のNN事前分布・根NNの勝敗値を使って未探索手を補完する。log(prior)+0.1×(50+最大子訪問数)×completedQを合法手で正規化。WDL値は既知の[-1,1]尺度なので範囲の再正規化は行わない。追加の一様混合・事前混合はしない。','',
 '[Gumbel論文](https://davidstarsilver.wordpress.com/wp-content/uploads/2025/04/gumbel-alphazero.pdf)と[公式実装](https://github.com/google-deepmind/mctx/blob/main/mctx/_src/qtransforms.py)を参考にした学習目標の比較で、配信探索のGumbel化ではない。近似Qでの勝率向上を理論保証として扱わない。古い教師モデル8e5b41...の保存済み探索を使用し、現在のモデルで再探索したと誤解しないよう来歴も保存した。','',
 '## データ・学習・事前判定','',
 '新たな教師問い合わせや自己対局の収集は0。曲面の学習3,534局面のpolicyだけを変更し、入力・合法手・勝敗/得点/所有・全ての共通検証教師が完全に同じことを監査した。学習10,486・検証3,544局面、全方式16epoch・各9,263サンプル・合計2,320更新で、元の配信重みから開始した。','',
 'モデル選択は0/4/8/12/16epochの共通検証損失で行い、保持損失を混ぜない。検証改善0.1%以上・各盤損失1.02倍以下・epoch0以外の選択を候補の条件とした。','',
 '| 方式 | 選択epoch | 共通検証損失の相対改善 |','| --- | ---: | ---: |',table,'',
 '## 新しい対局','',
 '| 方式 | 基準v3との開発成績 | 平面 | 曲面 |','| --- | --- | ---: | ---: |',games,'',
 '先後交換4ペア/盤、全9盤、64訪問・FPU1・コミ6.5で、共通の合法な初期4手と各手seedを使用。40/72点以上・各盤3/8点以上・平面と曲面各50%以上に加え、総得点がControlを上回り曲面得点がControl以上の候補だけを次へ進めた。','',
 '| 候補 | 全体得点 | 満たさなかった開発条件 |','| --- | ---: | --- |',gateRows,'',
 hold,'',
 '独立採用条件は全体55%以上・ペアを維持した盤別bootstrap95%区間下限50%超・各盤19/48点以上・平面/曲面各50%以上と、正確性・実Worker速度。候補は最大1つで、独立評価後の再選定や局数追加はしない。結果は固定訪問数でのPC検証であり、人間の段位や全機器での強さを表すものではない。','',
 '## 説明用の診断','',
 '曲面の共通検証局面で元モデルからの出力のずれを盤ごとに均等平均した。これは保持が働くかの指標で、棋力ではない。','',
 '| 方式 | 方策KL | 勝敗KL |','| --- | ---: | ---: |',drift,'',
 '公開L6局面のseed0の再現は以下。4 seedの全結果を保存し、モデル選択や学習には使っていない。','',
 '| モデル | L6の順位 | L6訪問 | 選択 |','| --- | ---: | ---: | --- |',fixture,'',
 '## 正確性・再現','',
 'Python31件の学習/モデル回帰テストと、completed-Qの手計算・未訪問・同Q・合法手マスク・並べ替え・手番・不正入力の検証が通過。事前条件を通過した3モデルは実Edge WorkerのCPU/WebGPU・全9盤・キャンセル・フォールバックを通過した。全対局の合法性・手番・seed・完了訪問数・採点とソースのハッシュを再生監査する。推論は64チャネル・6ブロック・120,905パラメータを維持した。','',
 '全モデル・checkpoint・ログ・コマンド・加工教師・分割・全棋譜・探索診断・監査・実行ソースを保存した。大きいJSONとログはgzip圧縮し、元と保存後のSHA-256をmanifest.jsonへ記録。旧教師と追加平面データは不変の既存アーカイブをハッシュで参照する。',''].join('\n');
writeFileSync(dest+'/README.md',report);writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,files},null,2)+'\n');
console.log(JSON.stringify({archive:dest,files:files.length,qualified,reason}));
