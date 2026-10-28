// Archive a completed, stopped study without touching deployed assets or historical data.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,copyFileSync,existsSync,statSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const work='tools/ai-gnn/target/root-candidate-recall-20261028',dest='experiments/ai/v3/2026-10-28-root-candidate-recall';
assert.ok(!existsSync(dest),'Archive destination already exists');
const read=p=>JSON.parse(readFileSync(work+'/'+p)),plan=read('plan.json'),decision=read('results/decision.json'),selection=read('results/selection.json'),diagnostic=read('results/diagnostic-summary.json'),dev=read('results/development-summary.json').summaries[0],speed=read('results/speed-gates.json'),audit=read('results/replay-audit.json');
assert.equal(selection.selected,null);assert.equal(decision.status,'completed-stopped-no-adoption');assert.equal(audit.passed,true);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');assert.equal(hash('dist/ai-v3.wasm'),plan.baseline.wasmSha256);assert.equal(hash('dist/models/v3/model.onnx'),plan.baseline.modelSha256);
mkdirSync(dest+'/data',{recursive:true});const mappings=[];
function copy(src,target,{compress=false}={}){const bytes=readFileSync(src),packed=compress?gzipSync(bytes,{level:9}):bytes,path=dest+'/'+target+(compress?'.gz':'');mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,packed);mappings.push({source:src,path:relative(dest,path).replaceAll('\\','/'),sourceSha256:createHash('sha256').update(bytes).digest('hex'),sha256:hash(path),bytes:packed.length,encoding:compress?'gzip':'identity'});}
for(const file of ['plan.json','reported-game.json'])copy(work+'/'+file,file);
for(const file of ['provenance.json','builds.json','execution-notes.json','ai-v3-search.js'])copy(work+'/'+file,'data/'+file);
for(const file of readdirSync(work+'/results'))if(statSync(work+'/results/'+file).isFile())copy(work+'/results/'+file,'data/results/'+file,{compress:file.endsWith('.json')&&statSync(work+'/results/'+file).size>150000});
for(const file of readdirSync(work))if(file.endsWith('-command.json')||file.endsWith('-log.txt'))copy(work+'/'+file,'data/commands/'+file);
for(const file of readdirSync(work+'/logs'))copy(work+'/logs/'+file,'data/logs/'+file);
for(const file of readdirSync(work+'/source'))copy(work+'/source/'+file,'data/source/baseline/'+file);
for(const variant of ['A8','B16','C8plus4']){for(const file of readdirSync(work+'/builds/'+variant))copy(work+'/builds/'+variant+'/'+file,'data/source/'+variant+'/'+file);copy(work+'/'+variant+'.wasm','data/search/'+variant+'.wasm');}
copy(work+'/baseline/A8.wasm','data/search/original-A8.wasm');
for(const file of ['root-candidate-study.mjs','root-candidate-audit.mjs','root-candidate-archive.mjs','node-inference.mjs','katago-analysis.mjs','match-statistics.mjs','bench-search.mjs','test-browser.mjs','study-commands.mjs'])copy('tools/ai-gnn/'+file,'data/source/tools/'+file);
copy(work+'/speed-positions.json','data/speed-positions.json');
const modelReference='experiments/ai/v3/2026-10-27-katago-distillation/data/teacher-model/model.onnx';assert.equal(hash(modelReference),plan.baseline.modelSha256);
writeFileSync(dest+'/data/model-reference.json',JSON.stringify({model:modelReference,sha256:plan.baseline.modelSha256,localSnapshot:work+'/baseline',teacherEngine:'tools/ai-tuner/target/katago-distillation-20261027/engine/katago.exe',teacherEngineSha256:hash('tools/ai-tuner/target/katago-distillation-20261027/engine/katago.exe'),teacherNetwork:'kata1-b10c128-s1141046784-d204142634',teacherNetworkSha256:'3d8a24697ba25fe4da39af4c2b6bd405907b0ad8295322f5a550fa2d8fe4a2f4',note:'Unchanged student model is referenced from its immutable earlier experiment; no new weights were trained or installed.'},null,2)+'\n');
const boardRows=dev.boards.map(b=>'| '+b.board+' | '+b.score+'勝'+(b.games-b.score)+'敗 |').join('\n');
const report=[
 '# v3の候補手取りこぼしを減らす実験',
 '',
 '2026年10月28日実施。**両候補とも不採用、登録計画のM2で終了**しました。配信モデル・探索WASMは変更していません。',
 '',
 '16手版は開発72局で30勝42敗となり、40/72点以上の進行条件と、各盤3/8点以上の条件に届きませんでした。戦術候補追加版は速度予備試験の負荷局面で基準を超え、開発選定の対象から外しました。独立288局と追加学習には進んでいません。',
 '',
 '登録時の [計画原本](plan.json)、[棋譜fixture](reported-game.json)、[採否](data/results/decision.json)、[選定記録](data/results/selection.json) を保存しています。',
 '',
 '## 条件と局所回帰',
 '',
 '同じ現行GNN（64チャネル・6ブロック・120,905パラメータ）を使い、FPU 1・Q係数0.4・一様混合2%・64訪問を固定しました。A8は元の上位8手、B16は上位16手、C8plus4は上位8手を保持して候補外の戦術手を最大4手追加する条件です。追加手にも元の事前確率を使い、評価値のボーナスは付けていません。研究用ソースとバイナリを隔離して作成しました。',
 '',
 '| 条件 | 発端局面の選択手 | L6の訪問数（seed 0） | seed 0〜7 |',
 '| --- | --- | ---: | --- |',
 '| 元のA8・研究用A8 | J3 | 0 | 全8回J3 |',
 '| B16 | L6 | 15 | 全8回L6 |',
 '| C8plus4 | L6 | 18 | 全8回L6 |',
 '',
 '元のA8と研究用A8は、発端局面の全8seedで訪問数とQが一致しました。別途、全9盤の固定局面・複数予算でも基準との一致を検証しました。局所診断の [生データ](data/results/reported-fixture.json.gz) は圧縮保存しています。',
 '',
 '**先の棋譜解説の訂正：L6は黒6子を直ちに取る手です。** 前の説明ではこの直接の取りを見落としていました。C8plus4は捕獲6点と白K6の連を伸ばす1点の計7点で候補に追加しました。L6専用の処理はありません。[訂正記録](data/results/prior-explanation-correction.json) を保存しています。',
 '',
 '## 開発対局',
 '',
 '両候補のcanaryは各18局、計36局を完走し、どちらも11勝7敗でした。C8plus4では292手番で戦術候補を追加し、13手番で追加手を選択しました。canaryの成績は採用判定に使っていません。',
 '',
 '速度を通過したB16だけを、事前固定した新しい初期4手とseedで、全9盤・各4先後交換ペア、計72局評価しました。C8plus4の除外により、計画の最大144局のうち72局を実施しました。[実行上の記録](data/execution-notes.json) を残し、対象候補の局数や閾値は変更していません。',
 '',
 '| 盤 | B16の成績（対A8） |',
 '| --- | --- |',
 boardRows,
 '| 合計 | 30勝42敗 |',
 '',
 '得点率は41.7%、盤で層化した先後交換ペアのbootstrap 95%区間は30.6〜52.8%でした。開発用に選定へ用いた標本であり、独立な棋力推定とは扱いません。区間は50%を含むため、B16の弱化が統計的に確定したとは主張しません。今回は採用条件を満たしていないという判定です。[全体・盤別の結果](data/results/development-summary.json) に保存しました。',
 '',
 '## 教師診断',
 '',
 '別の新規自己対局72局を生成し、対局単位で開発36局と独立診断用36局へ分割しました。定めた手数の前に終局した局面は補充せず欠測として残し、開発側は140局面になりました。平面48局面だけを同一ルールのKataGo・4096訪問で解析しました。曲面にKataGoの教師ラベルは付けていません。',
 '',
 '| 診断（平面48局面） | A8 | B16 |',
 '| --- | ---: | ---: |',
 '| 教師第1候補が初期候補に入った局面 | 41/48 | 47/48 |',
 '| 教師第1候補を最終的に選んだ局面 | 16/48 | 16/48 |',
 '| 初期候補に含まれる教師方策の平均確率合計 | 79.7% | 94.1% |',
 '',
 '新たに教師第1候補を含めた6局面のうち、その手を選んだのは1局面でした。最終選択が教師と一致するようになった局面と、一致しなくなった局面が各2あり、合計は同じ16でした。候補の網羅性は改善しましたが、今回の64訪問では最終選択や開発対局の改善に結びついていません。教師の第1候補は参考であり、数学的な最善手の証明ではありません。',
 '',
 '[診断集計](data/results/diagnostic-summary.json) と [教師出力・探索診断](data/results/development-diagnostics.json.gz) を保存しました。独立診断側の教師ラベルは未生成です。collectMsProxyは履歴復元や符号化を含む時間で、戦術ヒューリスティック単独のCPU時間とは扱っていません。',
 '',
 '## 速度',
 '',
 '対局処理を停止した状態で、全9盤・各3局面の27通常局面と、発端局面・パス・敗北確定の3負荷局面を事前固定し、実際のWorkerで計測しました。2回warmup後7回計測し、A/B順を交互にしています。比較基準は元の配信A8です。',
 '',
 '| 条件 | 通常局面P95比 CPU/WASM | 通常局面P95比 WebGPU | 判定 |',
 '| --- | ---: | ---: | --- |',
 '| B16 | 1.026 | 0.992 | 全速度基準通過 |',
 '| C8plus4 | 0.981 | 1.027 | 負荷局面で未達 |',
 '',
 'C8plus4は通常局面の全体・各盤の基準を満たしましたが、WebGPUの敗北確定局面でP95が基準4.4msに対し5.7ms、比1.295となり、負荷局面の上限1.10を超えました。通常局面だけで通過扱いにせず、登録済みの条件で除外しました。7標本ではP95は最大値となり、絶対差も1.3msと小さいため、この測定から恒常的に29.5%遅いとは判断できません。合格するまでの再計測や閾値の変更は行っていません。',
 '',
 '[通常局面と負荷局面を分けた採用判定](data/results/speed-gates.json)、全試行と環境情報を保存しています。Pixel 8aの実機計測は、配信候補が残らなかったため未実施です。',
 '',
 '## 検証と停止',
 '',
 '全180局、17,258手番の探索記録を監査しました。すべての着手と終局結果をJSのGameで再生し、訪問数、候補数、合法性、診断との一致を確認しました。違法手・手数上限到達は0局です。',
 '',
 '- 3条件それぞれのRustテスト13件が通過。',
 '- 全9盤・3条件・9予算の243件の意味論チェックが通過。',
 '- 既存のv3、offline player、ゲームエンジン、WASM、探索、UIの関連回帰が通過。',
 '- B16とC8plus4の実際のEdge Workerで、CPU/WebGPU数値整合、全9盤、キャンセル、フォールバックの検証が通過。',
 '',
 '[再生監査](data/results/replay-audit.json)、[意味論の検証](data/results/semantic-checks.json)、[回帰記録](data/results/existing-regressions.json) と各テストログを保存しています。ブラウザ検証中の壊れたGPU sidecarに関する警告は、意図的なフォールバック試験の出力です。',
 '',
 '独立288局へ進む候補が残らなかったため、登録計画の停止条件に従ってM2で終了しました。独立評価、独立診断ラベル、追加学習、配信反映、commit、デプロイは実施していません。',
 '',
 '## 再現用の成果物',
 '',
 '正確なコマンドと終了コードはdata/commands、原版と3条件のRustソースはdata/source、研究用WASMはdata/search、全対局と手番ごとの圧縮診断はdata/resultsにあります。基準モデルは [既存実験のモデル](../2026-10-27-katago-distillation/data/teacher-model/model.onnx) と同じハッシュで、[参照情報](data/model-reference.json) に記録しています。教師のネットワークと実行バイナリ自体は同梱していません。',
 '',
 '研究driverはtools/ai-gnn/root-candidate-study.mjs、監査はroot-candidate-audit.mjsです。研究用の固定作業先はtools/ai-gnn/target/root-candidate-recall-20261028でした。新しいcheckoutでコマンド記録のパス構成を復元し、保存ソースからbuilds.jsonのrustc引数で3条件を構築できます。相対importは元の作業先へ復元して実行する前提です。既存成果物を上書きして再試行する運用はしません。',
 '',
 '登録計画のplan.jsonは実行前の原本を維持しています。実行後の状態は本報告とdecision.jsonを参照してください。全保存ファイルの対応・ハッシュ・圧縮形式は [manifest.json](manifest.json) に記録しました。コードと依存物の許諾・出典はリポジトリの [THIRD_PARTY.md](../../../../THIRD_PARTY.md) に従います。',
 '',
 '## 次の検証で分けたいこと',
 '',
 '候補入り後の選択を改善する案は、候補幅に応じた予算配分や方策の追加学習と分けて比較する必要があります。今回の結果を見て同じ独立標本へ条件を合わせず、次の仮説と評価条件を別計画へ固定します。短い終局局面の速度基準を見直す場合も、測定回数や絶対時間の扱いを次の測定前に定めます。',
 ''
].join('\n');
writeFileSync(dest+'/README.md',report);
writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,id:'v3/2026-10-28-root-candidate-recall',status:decision.status,created:new Date().toISOString(),baseCommit:plan.baseCommit,model:plan.baseline.modelSha256,baselineWasm:plan.baseline.wasmSha256,decision:'data/results/decision.json',archives:mappings,totalArchivedBytes:mappings.reduce((s,x)=>s+x.bytes,0)},null,2)+'\n');
const planReadme='experiments/ai/plans/v3-root-candidate-recall/README.md',old=readFileSync(planReadme,'utf8');writeFileSync(planReadme,old.replace('状態は **計画のみ・未実行** です。','状態は **M2まで実行済み・採用候補なし** です。[実験報告](../../v3/2026-10-28-root-candidate-recall/README.md) に結果を保存しました。plan.jsonは実行前の登録原本を維持しています。'));
const index='experiments/ai/README.md',previous=readFileSync(index,'utf8');writeFileSync(index,previous.replace('[v3の候補手取りこぼしを減らす改良](plans/v3-root-candidate-recall/README.md)（計画のみ・未実行）。','[v3の候補手取りこぼしを減らす改良](plans/v3-root-candidate-recall/README.md)（M2まで実行済み・採用候補なし）。').trimEnd()+'\n\n[v3の候補手取りこぼしを減らす実験](v3/2026-10-28-root-candidate-recall/README.md)は、16手版が開発30勝42敗、戦術候補追加版が速度基準未達となり、両案とも不採用でした。\n');
console.log(JSON.stringify({archive:dest,files:mappings.length,bytes:mappings.reduce((s,x)=>s+x.bytes,0),status:decision.status}));
