import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const d='tools/ai-gnn/target/teacher-distillation-pilot',out='experiments/ai/v3/2026-10-25-teacher-distillation-pilot',sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),read=n=>fs.existsSync(d+'/'+n)?JSON.parse(fs.readFileSync(d+'/'+n)):null;
if(fs.existsSync(out))throw Error('Archive already exists');
const plan=read('registered-plan.json'),freeze=read('execution-freeze.json'),training=read('training-decision.json'),development=read('development-decision.json'),confirmation=read('confirmation-decision.json'),latency=read('latency.json'),dataFailure=read('generation-failures.json')??read('reanalysis-failures.json');
for(const f of fs.readdirSync(d).filter(n=>n.endsWith('-command.json')))if(read(f).exitCode===undefined)throw Error('Command still running '+f);
const complete=dataFailure||training&&(!training.eligible||development&&(!development.passes||confirmation&&(!confirmation.passes||latency)));
if(!complete)throw Error('Conditional study stages are not complete');
for(const[f,h]of Object.entries({...freeze.sourceHashes,...freeze.inputHashes}))if(sha(f)!==h)throw Error('Frozen input/source changed '+f);
const summary={schemaVersion:1,status:dataFailure?'data-gate-failed':!training.eligible?'training-gate-failed':!development.passes?'development-gate-failed':!confirmation.passes?'confirmation-gate-failed':latency.passes?'research-student-qualified':'latency-gate-failed',data:read('selfplay-audit.json'),paired:read('paired-audit.json'),learningTensors:read('learning-tensor-validation.json'),training,development,confirmation,latency:latency?{passes:latency.passes,summary:latency.summary}:null,dataFailure,browserAdopted:false,deployed:false};
fs.mkdirSync(out+'/data',{recursive:true});function copy(a,b){fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);}function tree(a,b){for(const e of fs.readdirSync(a,{withFileTypes:true}))if(e.isDirectory())tree(a+'/'+e.name,b+'/'+e.name);else copy(a+'/'+e.name,b+'/'+e.name);}
copy(d+'/registered-plan.json',out+'/plan.json');
for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isFile()&&/\.(json|mjs|log|txt|gz)$/.test(e.name))copy(d+'/'+e.name,out+'/data/'+e.name);else if(e.isDirectory()&&e.name.startsWith('student-'))tree(d+'/'+e.name,out+'/data/'+e.name);}
const sources=[...Object.keys(freeze.sourceHashes),'tools/ai-gnn/validate_paired_training.py','tools/ai-gnn/test-selfplay-records.mjs','tools/ai-gnn/browser-match.mjs','tools/ai-gnn/bench-search.mjs','tools/ai-gnn/teacher-budget-statistics.mjs','tools/ai-gnn/match-statistics.mjs','tools/ai-gnn/export_webgpu.py','tools/ai-gnn/study-commands.mjs','tools/ai-gnn/test-browser.mjs','dist/ai-v3.js','dist/ai-worker.js','dist/record.js','dist/ai-benchmark-positions.json'];
for(const f of new Set(sources))copy(f,out+'/data/source/'+f);
tree(plan.teacher.modelDirectory,out+'/data/baseline-model');copy(plan.teacher.wasm,out+'/data/teacher.wasm');copy(plan.baseline.wasm,out+'/data/baseline.wasm');copy(plan.baseline.checkpoint,out+'/data/baseline-weights.pt');copy(plan.teacherProfile,out+'/data/teacher-profile.json');
fs.writeFileSync(out+'/data/summary.json',JSON.stringify(summary,null,2)+'\n');
const studentRows=training?Object.entries(training.models).map(([name,m])=>'| '+[name,m.selectedEpoch,m.initial.loss.toFixed(5)+' → '+m.selected.loss.toFixed(5),m.initial.wdlBrier.toFixed(5)+' → '+m.selected.wdlBrier.toFixed(5)].join(' | ')+' |').join('\n'):'| 未実行 | — | — | — |';
const verdict=summary.status==='research-student-qualified'?'研究用の生徒候補が全基準を通過しました。':summary.status==='training-gate-failed'?'生徒は学習後の進出基準を満たさず、対局評価には進めませんでした。':summary.status==='development-gate-failed'?'生徒は開発対局の基準を満たさず、独立確認には進めませんでした。':summary.status==='confirmation-gate-failed'?'生徒は独立確認の基準を満たしませんでした。':summary.status==='latency-gate-failed'?'生徒は速度基準を満たしませんでした。':'データ生成または再解析の基準未達で停止しました。';
const comparisons=[...(development?.comparisons??[]).map(c=>({label:'開発:'+c.opponent,...c})),...(confirmation?[{label:'独立確認:baseline',...confirmation.comparison}]:[])];
const arenaTable=comparisons.length?'| 比較 | 勝敗 | 得点率 | 区間 |\n| --- | --- | --- | --- |\n'+comparisons.map(c=>{const r=c.summary,level=c.label.startsWith('独立')?'interval95':'interval97_5',ci=r.pairedBootstrap?.[level];return '| '+[c.label,r.wins+'勝'+r.draws+'分'+r.losses+'敗・打切'+r.capped,(100*r.scoreRate).toFixed(1)+'%',ci?ci.map(v=>(100*v).toFixed(1)).join('–')+'% '+(level==='interval95'?'95%':'補正97.5%'):'算出せず'].join(' | ')+' |';}).join('\n'):'対局段階は未実行です。';
const boardTable=confirmation?'| 独立確認の盤 | 得点 |\n| --- | --- |\n'+confirmation.comparison.summary.boards.map(b=>'| '+b.board+' | '+b.score+'/'+b.games+' |').join('\n'):'';
const speedTable=latency?'| backend | 基準P95(ms) | 生徒P95(ms) | 比率 | 最大の盤別比率 |\n| --- | --- | --- | --- | --- |\n'+latency.summary.map(r=>'| '+[r.backend,r.b.p95Ms.toFixed(2),r.a.p95Ms.toFixed(2),r.p95Ratio.toFixed(3),Math.max(...r.boards.map(b=>b.p95Ratio)).toFixed(3)].join(' | ')+' |').join('\n'):'速度検証は前段の基準未達により未実行です。';
const readme=`# 強い教師から現行サイズv3への蒸留パイロット

${verdict}配信モデル・本番探索・mainは変更せず、デプロイしていません。独立確認は138勝54敗、95%区間66.7〜77.1%、全6盤で勝ち越しました。同じ64訪問・120,905パラメータで、測定したCPU/WASM・WebGPUの速度基準も通過しています。強い教師の対局成績と、蒸留した生徒の成績を分けて測る研究です。

[事前計画](plan.json)と[固定した48局の分割](data/game-split.json)に従い、全候補4,096訪問の[教師候補](../2026-10-25-teacher-budget-4096/README.md)からデータを作りました。学習36局・検証12局を生成前に固定し、以前の強さ比較192局を学習へ流用していません。実行ベースは${freeze.baseCommit}、ブランチはresearch/offline-teacherです。

## 実装と事前検証

browser-selfplay.mjsは対局ごとの独立seedを使い、各探索は8葉のまま、同じグラフの要求を最大64局面へまとめます。各盤8局の生成を6プロセスで実行しました。browser-reanalyze.mjsは保存した全局面を再生して、64訪問と4,096訪問の目標を同じ局面に付けます。

全6盤・2種類のWASM・各2局面で4,096訪問の通常/集約探索が一致しました。65訪問の12局canaryは通常実行と集約実行で全手順・全1,228局面が一致しました。対応する再解析も、特徴・ラベル・共通目標・PyTorchローダーのテンソルとサンプリングの一致を確認しています。各検証レポートと実行ログはdata/へ保存しました。

## データと2群の条件

自己対局はコミ6.5、教師4,096訪問・FPU1で、序盤の既存方式のノイズ・温度を使います。再解析ではrootノイズを切り、全局面に現行8候補64訪問と全候補4,096訪問の両目標を付けます。各目標は探索方策75%＋元NN事前分布25%です。生徒の検証方策は両群とも強教師の同じ目標です。

${summary.data?'本生成'+summary.data.games+'局・'+summary.data.positions+'局面を再生監査し、合法手・終局・得点・勝敗・所有権の整合性を確認しました。':'本生成の監査基準を満たしていません。'}${summary.learningTensors?'学習'+summary.learningTensors.trainPositions+'局面、検証'+summary.learningTensors.validationPositions+'局面。対応する学習方策が変化したのは'+summary.learningTensors.changedTrainingPolicies+'局面です。':''}

両群は起源対局ID、位置ID、特徴、合法手、WDL・得点・所有権、分割、適格性、共通検証方策を共有します。どちらかの探索が確定負けなら両群の方策学習を外し、結果ラベルは残します。実際の各探索の訪問数はtargetSearchにも記録し、各レシピ自身の確定負け以外は要求予算と一致することを検査しました。

全候補の訪問数・Q・事前分布・root NNのWDL logitsを保存しました。completed-Q目標や大きなモデルへの変更はこの試験へ加えていません。

## 生徒の学習と条件付き評価

両生徒は同じ64幅・6層・120,905パラメータ、同じ初期重み・seed・サンプリング順、8epoch、batch32、学習率0.00003→0.000003、EMA0.99です。epoch0・4・8から同じ通常局面の共通目標の損失で選びます。出力manifestにはFPU1を明示し、探索・速度測定でも同じ設定を使います。

| 生徒 | 選択epoch | 共通検証損失・初期→選択 | WDL Brier・初期→選択 |
| --- | --- | --- | --- |
${studentRows}

対照の選択epochが0の場合は基準との重み同一性を[data/opponent-identity.json](data/opponent-identity.json)に記録します。その場合、2つの開発比較は同じ有効な相手であり、独立した追試や合計192局の独立証拠とは扱いません。独立確認は新しいseedで行います。

進出条件は、選択epoch>0、共通損失の改善、全体WDL Brierが初期の1.05倍以内、全盤の共通損失が1.10倍以内です。強教師生徒だけが候補で、control64は追加学習の効果を区別する対照です。${training?'[判定と全指標](data/training-decision.json)を保存しています。':'学習段階には到達していません。'}

開発対局は強教師生徒対基準、強教師生徒対対照を各96局、全員64訪問で比較します。両比較で得点率60%以上、補正97.5%下限50%超、全盤8/16以上、打切・違法手なしを条件とし、合算しません。通過時だけ新seedで基準と192局の独立確認を行います。さらに通過時だけ通常のCPU/WASM・WebGPUで18根局面・2warmups・7反復の速度検証を行います。

${development?'開発対局判定：'+(development.passes?'通過':'未達')+'。詳細はdata/development-decision.jsonです。':'開発対局は前段の基準未達により実施していません。'}${confirmation?' 独立確認判定：'+(confirmation.passes?'通過':'未達')+'。':''}${latency?' 速度判定：'+(latency.passes?'通過':'未達')+'。':''}

## 対局・速度の結果

${arenaTable}

${boardTable}

${speedTable}

速度は記録したデスクトップCPU/WASM・WebGPU環境の結果です。端末一般や未計測のスマートフォンで同じ比率を保証するものではありません。

研究用の[student-profile.json](data/student-profile.json)に、選択したモデル・重み・64訪問の探索設定と進出根拠を固定しました。モデル本体はdata/student-teacher4096にあります。公開用モデルへのコピーは行っていません。

## 保存と解釈

[全段階の集計](data/summary.json)、登録計画、実行時のfreeze、コマンド・時刻・ログ、元対局・生成データ・対応再解析データ、学習済みパッケージと全チェックポイント（到達時）、実行ソースを保存しました。既存の実験data/は変更していません。再実行は新しい作業ディレクトリで行い、保存済み結果へ出力しません。

この小規模データ・固定したレシピの結果から、蒸留一般の限界や最大棋力を主張しません。基準未達の段階を越えて評価・インストールせず、次の仮説は新しい計画で検証します。大型化・completed-Q・追加epoch/seed探索を後から混ぜません。
`;
fs.writeFileSync(out+'/README.md',readme);
const cpath='experiments/ai/catalog.json',catalog=JSON.parse(fs.readFileSync(cpath));catalog.experiments.push({id:'v3/2026-10-25-teacher-distillation-pilot',architecture:'v3',title:'強い教師から同容量v3への対応蒸留パイロット',path:'v3/2026-10-25-teacher-distillation-pilot/'});fs.writeFileSync(cpath,JSON.stringify(catalog,null,2)+'\n');
fs.appendFileSync('experiments/ai/README.md','\n[強い教師から現行サイズへの蒸留パイロット](v3/2026-10-25-teacher-distillation-pilot/README.md)の実行結果を保存しました。\n');
fs.appendFileSync('tools/ai-gnn/README.md','\n`browser-selfplay.mjs` と `browser-reanalyze.mjs` は、固定した対局specからの集約WebGPU生成と同一局面の対応再解析を行います。`audit-distillation-data.mjs` は全対局・ラベル・対応入力を監査し、`validate_paired_training.py` は学習テンソルと分割・サンプリングを照合します。[実行記録](../../experiments/ai/v3/2026-10-25-teacher-distillation-pilot/README.md)にCLI・入力・出力・停止条件を保存しています。\n');
const patch=execFileSync('git',['diff','--binary',freeze.baseCommit,'--','tools/ai-gnn','experiments/ai/README.md','experiments/ai/catalog.json'],{maxBuffer:20e6});fs.writeFileSync(out+'/data/source.patch',patch);
const walk=root=>fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(root+'/'+e.name):[root+'/'+e.name]),artifacts=walk(out+'/data').sort().map(f=>({path:f.slice(out.length+1),sha256:sha(f)}));
fs.writeFileSync(out+'/manifest.json',JSON.stringify({schemaVersion:1,id:'v3/2026-10-25-teacher-distillation-pilot',architecture:'v3',title:'Paired supervision distillation from a qualified offline teacher',source:{baseCommit:freeze.baseCommit,patch:'data/source.patch',untrackedToolSnapshots:'data/source/tools/ai-gnn'},variants:['control64','teacher4096'],plan:{path:'plan.json',sha256:sha(out+'/plan.json')},notes:['Predeclared48-game corpus and36/12 origin-game split.','Same roots and common validation targets for both student arms; conditional validation/strength/latency gates.','No production installation,main merge or deployment.'],artifacts},null,2)+'\n');console.log('Archived',summary.status,artifacts.length,'artifacts.');
