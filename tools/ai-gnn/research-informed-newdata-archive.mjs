// Archive the completed NewData round, including every failed model and game.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join,relative} from 'node:path';
const root='tools/ai-gnn/target/fresh-data-study-20261028',dest='experiments/ai/v3/2026-10-28-fresh-data-study';
if(existsSync(dest))throw Error('Archive exists');
const read=p=>JSON.parse(readFileSync(root+'/'+p)),plan=read('plan.json'),preflight=read('results/preflight.json'),dev=existsSync(root+'/results/development-summary.json')?read('results/development-summary.json'):null,selection=existsSync(root+'/results/selection.json')?read('results/selection.json'):null,ind=existsSync(root+'/results/independent-decision.json')?read('results/independent-decision.json'):null;
if(preflight.newDataEligible&&!selection)throw Error('Development selection is incomplete');
if(selection?.selected&&!ind)throw Error('Registered independent evaluation is incomplete');
if(dev&&!read('results/development-replay-audit.json').passed)throw Error('Development audit failed');
if(ind&&!read('results/independent-replay-audit.json').passed)throw Error('Independent audit failed');
if(ind?.passesStrength&&!existsSync(root+'/results/latency-decision.json'))throw Error('Strength passed; latency decision required');
const latency=existsSync(root+'/results/latency-decision.json')?read('results/latency-decision.json'):null;
const adopted=Boolean(ind?.passesStrength&&latency?.passed);
const candidate=dev?.results.find(r=>r.id==='NewData-r0'),control=dev?.results.find(r=>r.id==='Control-r0');
const developmentGateDetails=candidate?{overall:candidate.all.score>=40,everyBoard:candidate.all.boards.every(b=>b.score>=3),plane:candidate.plane.scoreRate>=.5,curves:candidate.curves.scoreRate>=.5,higherThanControl:candidate.all.score>control.all.score,failedBoards:candidate.all.boards.filter(b=>b.score<3).map(b=>({board:b.board,score:b.score,minimum:3}))}:null;
const decision={schemaVersion:1,finished:new Date().toISOString(),adopted,reason:!preflight.newDataEligible?'Registered common-validation gate failed':!selection.selected?'Registered development strength/Control comparison gate failed':!ind.passesStrength?'Registered independent strength gate failed':!latency?.passed?'Registered latency/correctness gate failed':'All required gates passed',trainingRuns:2,epochs:32,developmentGames:dev?144:0,independentGames:ind?432:0,productionUpdated:false,developmentGateDetails,sourcePlanSha256:createHash('sha256').update(readFileSync(root+'/plan.json')).digest('hex'),independentConsumed:Boolean(ind),preflight,selection,independent:ind,latency};
writeFileSync(root+'/results/decision.json',JSON.stringify(decision,null,2)+'\n');
const files=[],hash=b=>createHash('sha256').update(b).digest('hex');
function copy(source,target){const bytes=readFileSync(source),compress=bytes.length>65536&&/\.(json|jsonl|log|txt)$/.test(source),out=target+(compress?'.gz':'');mkdirSync(join(dest,out,'..'),{recursive:true});const data=compress?gzipSync(bytes,{level:9}):bytes;writeFileSync(join(dest,out),data);files.push({source,archive:out,compressed:compress,originalBytes:bytes.length,originalSha256:hash(bytes),storedSha256:hash(data)});}
function tree(base){for(const e of readdirSync(base,{withFileTypes:true})){const p=join(base,e.name);if(e.isDirectory())tree(p);else copy(p,'data/workspace/'+relative(root,p).replaceAll('\\','/'));}}
tree(root);
const tools=['research-informed-newdata.mjs','research-informed-newdata-prepare.mjs','research-informed-newdata-train.mjs','research-informed-newdata-preflight.py','research-informed-newdata-sampling.py','research-informed-newdata-verify.mjs','research-informed-newdata-matches.mjs','research-informed-newdata-audit.mjs','research-informed-newdata-archive.mjs','model.py','train.py','test_fresh_replay.py','test_soft_policy.py','test_training.py','test_model.py','node-inference.mjs','study-commands.mjs','selfplay-records.mjs','selfplay-policy.mjs','training-search.mjs','katago-analysis.mjs','test-browser.mjs','match-statistics.mjs','export_webgpu.py','browser-data-host.mjs','research-informed-newdata-fixture.mjs','research-informed-newdata-coverage.py','research-informed-newdata-exclusion.mjs'];
for(const f of tools)copy('tools/ai-gnn/'+f,'data/tools/'+f);
for(const f of ['engine.js','ai-position.js','ai-v3-search.js','ai-v3-inference.js','ai-v3-webgpu.js','ai-v3.js','record.js'])copy('dist/'+f,'data/runtime/'+f);
for(const f of ['README.md','plan.json'])copy('experiments/ai/plans/v3-fresh-data-study/'+f,'data/plan/'+f);
const rows=preflight.results.map(r=>'| '+r.id+' | '+r.selectedEpoch+' | '+(r.relativeGain*100).toFixed(3)+'% |').join('\n');
const matches=dev?dev.results.map(r=>'| '+r.id+' | '+r.all.wins+'勝'+r.all.losses+'敗'+(r.all.draws?' '+r.all.draws+'分':'')+' | '+(r.plane.scoreRate*100).toFixed(1)+'% | '+(r.curves.scoreRate*100).toFixed(1)+'% |').join('\n'):'対局未実施。';
const conclusion=adopted?'採用基準を通過。配信資産の変更は別途結果に明記する。':'**今回の新規データ追加は採用しない。配信中のモデル・WASMを維持する。**';
const hold=ind?'独立432局：'+ind.result.all.wins+'勝'+ind.result.all.losses+'敗、得点率'+(ind.result.all.scoreRate*100).toFixed(2)+'%、ペア単位95%区間'+ind.result.all.pairedBootstrap.interval95.map(x=>(100*x).toFixed(2)).join('〜')+'%。':'独立432局は未実施。候補を差し替えたり、追加対局で採用条件を満たすまで続けたりしていない。';
const browser=preflight.newDataEligible?'2モデルとも実Edge WorkerでCPU/WebGPUの数値、全9盤の探索、キャンセル、フォールバックと本番経路を確認。':'事前条件で終了し、実ブラウザ検証は未実施。';
const report=['# 新規の平面教師データを追加したv3比較','',
 '2026年10月28〜29日実施。[事前計画](../../plans/v3-fresh-data-study/README.md)に従い、同じ更新回数で既存データのみのControlと新規データ追加NewDataを比較した。'+conclusion,'',
 '[最終判定](data/workspace/results/decision.json)に全採否を記録。理由：'+decision.reason+'。','',
 '## 新しい学習データ','',
 '[教師の予備実験](../2026-10-28-fresh-teacher-pilot/README.md)は12勝0敗・0.244秒/局面で通過し、その12局を本収集や学習から除外した。本収集は7/9/11路各8局、計24局・1,648局面。12局は既存棋譜のN/3手までの履歴から分岐し、KataGo方策で進める12局と現在のv3方策で進める12局を混ぜた。ラベルは全てKataGo512の根の辺訪問数から得た方策に合法一様2%を加えたもの。','',
 '新規学習1,224局面・検証424局面。全棋譜と局面を再生し、特徴量・合法手・最終勝敗・面積得点・所有を確認。元対局の学習/検証区分を分岐先へ引き継ぎ、打ち切りと由来対局の分割重複は0。証明済み負けを従来どおり除外した実学習では新規1,223局面・検証421局面を使用した。8手で終わったv3自己対局も結果に応じて除外せず保持した。','',
 '各盤の総重みを1/9とし、NewDataは各平面の旧70%・新30%、曲面は既存データ100%。Controlは既存データのみ。両方式の共通検証は同じ旧＋新規検証局面・同じ重み。実データで盤ごとの総量、混合比、対照学習への新規局面非混入、共通検証の一致を監査した。','',
 '## 学習と事前判定','',
 '各方式16epoch、各epoch9,263サンプル・145更新、合計2,320更新。学習seed・初期重み・AdamW・学習率1e-4→1e-5・EMA0.99・推論規模を共通化し、0/4/8/12/16epochから共通検証損失で選んだ。入力の総局面数が違っても更新回数を増やしていない。','',
 '| 方式 | 選択epoch | 共通検証損失の相対改善 |','| --- | ---: | ---: |',rows,'',
 '共通検証の改善はモデル選択の情報であり、独立した棋力向上の証明ではない。学習seedは1つのため、手法一般の優劣にも限界がある。','',
 '## 新しい対局','',
 '| 方式 | 基準v3との開発72局 | 平面 | 曲面 |','| --- | --- | ---: | ---: |',matches,'',
 '開発対局は全9盤・先後交換4ペア/盤。2方式に共通の合法な初期4手と各手seedを用い、64訪問・FPU1・コミ6.5・6N手上限で比較した。採用候補はNewDataのみと事前固定し、40/72点以上、各盤3/8点以上、平面・曲面各50%以上、かつControlを上回ることを次段階の条件とした。','',
 hold,'',
 candidate?'NewDataは全体41/72点と平面18/24点を満たしたが、曲面23/48点（47.9%）が50%に届かず、トーラス7路2/8点も盤別最低3/8点に届かなかった。事前条件で不採用とし、独立評価を開いていない。':'',
 '',
 '## 公開L6局面の診断',
 '',
 '今回の追加学習入力14,101局面に、公開局面と同一のモデル入力は学習・検証とも0件だった。基準はL6が14位・訪問0でJ3、Controlは12位・訪問0でJ3、NewDataは8位・20訪問となりL6を選んだ。seed0〜3の4通りで一致した。この局面は説明用であり、学習や採用基準には使っていない。公開棋譜は元の実行環境を含まないため、今回固定した基準と候補モデルでの再現として扱う。',
 '',
 '共通検証で教師最善手が合法NN上位8候補に入る割合（局面単純平均）は、基準82.70%、Control84.76%、NewData85.10%。新規検証局面では76.96%、77.67%、78.86%。この診断もモデル選択に使った検証分割であり、独立の棋力証明ではない。',
 '',
 '各手の探索診断、完了訪問数、seed、手番、全棋譜と採点を保存し、再生監査に通した。探索の確定値を根で直接反映する場合は子の訪問数合計が総訪問数-1に届かないため、総訪問数のカウンタと子への実訪問数を区別した。','',
 '## 実装と検証','',
 '固定サンプル数と盤内の旧新混合を学習CLIへ追加。既存の通常学習の動作は既定値で維持する。学習・モデル・補助方策・新旧混合の計25テストが通過。'+browser+' 推論形式は64チャネル・6ブロック・120,905パラメータを維持した。','',
 latency?'速度の詳細はdata/workspace/results/latency-decision.jsonを参照。':'独立棋力・速度の必要条件に到達していない場合は、速度向上やスマートフォンでの強化を主張しない。','',
 '計画・登録記録・生成した全棋譜/教師・監査・共通分割・2モデルの全checkpoint/学習ログ・コマンド・対局・ソースを保存した。大きいJSONとログはgzip圧縮し、元/保存後のSHA-256をmanifest.jsonへ記録。元教師データとKataGo実行本体は既存の不変データをハッシュで参照する。','',
 '次の研究候補はcompleted-Qによる全合法手の学習目標と、学習時のGumbel候補抽出。新規データ追加と同時に変更せず、別の事前登録比較として扱う。',''].join('\n');
writeFileSync(dest+'/README.md',report);writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,files},null,2)+'\n');
console.log(JSON.stringify({archive:dest,files:files.length,reason:decision.reason,adopted}));
