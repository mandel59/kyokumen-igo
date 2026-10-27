// Freeze the completed study without overwriting any prior experiment.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=resolve(process.argv[2]),root='experiments/ai/v3/2026-10-27-katago-distillation',data=join(root,'data');
if(existsSync(root))throw Error('Archive already exists');
const read=file=>JSON.parse(readFileSync(join(directory,file),'utf8')),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const plan=read('plan.json'),provenance=read('provenance.json'),summary=read('independent-summary.json'),audit=read('data-audit.json'),pipeline=read('pipeline-state.json');
if(!pipeline.finished)throw Error('Pipeline has unfinished required work');
const speedFile=existsSync(join(directory,'speed-nine.json'))?'speed-nine.json':'speed.json',speed=read(speedFile);
const teacher=read('teacher-model/manifest.json'),control=read('control-model/manifest.json');
const numeric=['teacher-onnx','control-onnx','teacher-browser'].every(name=>read(name+'-command.json').exitCode===0);
const speedCoversAllBoards=speed.summary.every(r=>r.boards.length===9);
const decision={schemaVersion:1,strength:summary.strengthGates,numeric,speed:speed.passes,speedCoversAllBoards,
 eligible:summary.passesStrength&&numeric&&speed.passes&&speedCoversAllBoards,
 baseline:provenance.baseline,candidate:teacher.sha256,control:control.sha256,
 deployedModel:JSON.parse(readFileSync('dist/models/v3/manifest.json')).sha256};
decision.installed=decision.deployedModel===decision.candidate&&decision.candidate!==decision.baseline;
if(decision.eligible&&!decision.installed)throw Error('Qualified candidate requires an explicit installation decision before final archive');
writeFileSync(join(directory,'decision.json'),JSON.stringify(decision,null,2)+'\n');
mkdirSync(data,{recursive:true});copyFileSync(join(directory,'plan.json'),join(root,'plan.json'));
const copy=(source,dest)=>{mkdirSync(dirname(dest),{recursive:true});copyFileSync(source,dest);};
for(const file of readdirSync(directory)){
 if(/\.(?:json|txt|cfg|html|gz|log)$/.test(file)&&file!=='plan.json'&&!file.endsWith('.txt.gz'))copy(join(directory,file),join(data,file));
}
for(const name of ['baseline','teacher-model','control-model'])for(const file of ['manifest.json','model.onnx','weights.f32','weights.pt','golden.json','KataGo-NN-LICENSE.txt']){
 const source=join(directory,name,file);if(existsSync(source))copy(source,join(data,name,file));
}
for(const phase of ['screen','generate'])for(const file of readdirSync(join(directory,phase)))copy(join(directory,phase,file),join(data,phase,file));
copy(join(directory,'search.wasm'),join(data,'search.wasm'));
// Keep compact copies of match JSON as well as exact command records and logs.
for(const file of readdirSync(data))if(/^(?:independent|development)-(?:baseline|control)-.+\.json$/.test(file)){
 writeFileSync(join(data,file+'.gz'),gzipSync(readFileSync(join(data,file)),{level:9}));
 // Both forms intentionally retained: the runner can re-summarize JSON directly.
}
const aiDocs='docs/ai/README.md';
writeFileSync(aiDocs,readFileSync(aiDocs,'utf8')+`\n[KataGoの平面盤方策からの蒸留](../../experiments/ai/v3/2026-10-27-katago-distillation/README.md)では、平面96局と曲面の既存教材で候補と方策対照を学習し、独立384局で評価しました。配信モデルの採否と盤別結果は実験報告に記録しています。\n`);
const added=[...readdirSync('tools/ai-gnn').filter(file=>/^katago-.*\.mjs$/.test(file)||file==='test-katago-analysis.mjs').map(file=>'tools/ai-gnn/'+file),
 'dist/licenses/KataGo-NN-LICENSE.txt','dist/licenses/KataGo-v1.18.1-LICENSE.txt',
 ...(existsSync('dist/models/v3/KataGo-NN-LICENSE.txt')?['dist/models/v3/KataGo-NN-LICENSE.txt']:[])];
const modified=['tools/ai-gnn/bench-search.mjs','tools/ai-gnn/README.md','tools/third-party.mjs','docs/ai/README.md','docs/ai/architectures/v3.md','docs/third-party/catalog.json','docs/third-party/catalog.schema.json','THIRD_PARTY.md','dist/credits.html','dist/third-party-catalog.json','dist/licenses/sources.json'];
let patch=execFileSync('git',['diff','--binary',provenance.baseCommit,'--',...modified],{encoding:'utf8'});
for(const file of added){
 const contents=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),lines=contents.endsWith('\n')?contents.slice(0,-1).split('\n'):contents.split('\n');
 patch+=`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(line=>'+'+line).join('\n')+'\n'+(contents.endsWith('\n')?'':'\\ No newline at end of file\n');
}
writeFileSync(join(data,'source.patch'),patch);
for(const file of [...added,...modified,'tools/ai-gnn/train.py','tools/ai-gnn/model.py','tools/ai-gnn/match.mjs','tools/ai-gnn/study-commands.mjs','tools/ai-gnn/test-browser.mjs','dist/ai-v3-search.js','dist/ai-v3-inference.js','dist/engine.js'])copy(file,join(data,'source',file));
// The already-running top-level driver preceded addition of the nine-board speed fixture.
const driver=readFileSync('tools/ai-gnn/katago-distill-run.mjs','utf8').replace("'--positions',join(directory,'speed-positions.json'),",'');
writeFileSync(join(data,'executed-pipeline-driver.mjs'),driver);
writeFileSync(join(data,'execution-notes.json'),JSON.stringify({
 actualDriver:'executed-pipeline-driver.mjs',currentDriver:'source/tools/ai-gnn/katago-distill-run.mjs',
 neuralArtifacts:'Model weights, manifests and golden inputs/outputs are archived as model artifacts. install-model.mjs restores the experimental slot and model-bound test fixture; source.patch covers source, documentation and notices.',
 speed:'The original running driver measured the historical six-board fixture. A supplementary nine-board speed run uses the same selected model and fixed visits; no training or strength evaluation was repeated.',
 configCorrection:'execution-amendment.json records the buffer-setting correction before any training-data collection.',
 teacherOutput:'Every target can be reconstructed from saved game moves, legal masks and compact root/move search statistics. Unused raw NN policy arrays and PVs were not retained.',
 reproducibility:'Actual teacher outputs are archived. Concurrent KataGo scheduling and GPU floating point prevent a bitwise replay guarantee.',
 control:'The matched control shares KataGo-selfplay positions and exact game outcomes with the teacher arm. It omits KataGo policy targets from training updates, but uses the common KataGo validation target for epoch selection. This isolates policy-target effects, not all effects of KataGo-derived data.'
},null,2)+'\n');
const pct=x=>(100*x).toFixed(1)+'%',ci=s=>s.pairedBootstrap?`${pct(s.pairedBootstrap.interval95[0])}–${pct(s.pairedBootstrap.interval95[1])}`:'なし';
const rows=summary.allVsBaseline.boards.map(b=>`| ${b.board} | ${b.score}/${b.games} | ${pct(b.score/b.games)} |`).join('\n');
const stageNames=[...pipeline.stages.map(stage=>stage.name),...['speed-nine','postrelease-browser'].filter(name=>existsSync(join(directory,name+'-command.json')))];
const stages=stageNames.map(name=>{const c=read(name+'-command.json');return`| ${name} | ${c.elapsedSeconds.toFixed(1)}秒 |`;}).join('\n');
const outcome=decision.installed?'採用基準を通過した候補を実験用v3へ反映しました。':'採用基準を満たさなかったため、配信モデルは変更していません。';
writeFileSync(join(root,'README.md'),`# KataGoの平面盤方策からv3への蒸留\n\n## 結論\n\n${outcome} 平面3盤での現行v3に対する得点率は${pct(summary.planeVsBaseline.scoreRate)}（${summary.planeVsBaseline.wins}勝${summary.planeVsBaseline.draws}分${summary.planeVsBaseline.losses}敗、ペア95%区間${ci(summary.planeVsBaseline)}）。同じ追加学習を行う方策対照への得点率は${pct(summary.planeVsControl.scoreRate)}（95%区間${ci(summary.planeVsControl)}）、曲面6盤では${pct(summary.allCurvesVsBaseline.scoreRate)}（95%区間${ci(summary.allCurvesVsBaseline)}）でした。[判定](data/decision.json)と[独立評価集計](data/independent-summary.json)を保存しています。\n\n## 識別情報\n\n- 実験ID：${plan.id}\n- 生徒：現行と同じ64チャネル・6ブロック・120,905パラメータ。探索は全て64訪問、FPU 1。\n- 教師：KataGo v1.18.1 OpenCL、公式通常ネット kata1-b10c128-s1141046784-d204142634、512訪問。最強・最新ネットではなく、生成速度と予備対戦で選んだ小型教師です。\n- 学習：PyTorch CUDA、RTX 5060 Ti。対戦：ONNX Runtime CPUと現行WASMの研究用プレイヤー。\n- 基準commit：${provenance.baseCommit}。追加ツールと速度計測の変更は[data/source.patch](data/source.patch)、ソースは[data/source/](data/source/)に保存。実行上の設定訂正・元のdriverとの差は[data/execution-notes.json](data/execution-notes.json)に記録。\n\n## 実行前の計画\n\n[plan.json](plan.json)で、データ収集・学習・独立評価の前に条件を固定しました。教師は学習に使わない先後交換12局で現行v3に12勝し、予備基準を通過しました。[速度試験](data/benchmark.json)から512訪問を選びました。\n\n平面7/9/11路それぞれ32局を生成し、各盤24局を学習・8局を検証へ分けます。各盤16局はKataGo自己対局、16局は現行v3自己対局です。曲面6盤は過去の教師蒸留48局を再生し、配信モデルの対局分割を維持します。全9盤を均等化して16エポック学習し、epoch 0/4/8/12/16から共通教師による通常局面の検証損失で選択します。開発対戦後も候補・ハイパーパラメータ・独立局数を変更しません。\n\n独立評価は候補対現行v3が全9盤・各16先後交換ペアの288局、候補対方策対照が平面3盤・各16ペアの96局、合計384局です。初期4手と同じ手数の乱数列を先後で共有します。集計は盤別に層化したペアbootstrapです。\n\n## 方法と結果\n\n面積採点・位置的スーパーコウ・自殺手禁止・死石自動除去なし・コミ6.5で、全着手と最終ラベルはアプリのGameで判定します。教師のroot edgeVisitsを合法手上で正規化し、2%の合法手一様分布を混ぜます。勝敗・点数・所属は予測値ではなく実際の終局結果です。\n\n比較用2モデルは入力局面、終局ラベル、分割、検証目標、サンプリング、初期重み、更新回数を共通にし、学習時の方策目標だけをKataGoと現行v3で変えます。対照もKataGo自己対局由来の局面と終局結果を共有するため、「KataGoを全く使わない」対照ではありません。検証目標も共通KataGo方策です。\n\n生成した平面${audit.games}局・${audit.planePositions}局面と曲面${audit.curvePositions}局面を使用しました。[全根の再生監査](data/data-audit.json)と[学習テンソルの一致監査](data/paired-tensor-audit.json)があります。蒸留候補はepoch ${teacher.selectedEpoch}、方策対照はepoch ${control.selectedEpoch}を選択しました。\n\n| 盤 | 候補の得点 / 局数（対現行v3） | 得点率 |\n| --- | --- | --- |\n${rows}\n\n各対局の全手順、打ち切り、探索設定はdata内のindependent-*.jsonに保存しています。基準別の通否は[data/decision.json](data/decision.json)にあります。\n\n## 所要時間・速度\n\n| 工程 | 経過時間 |\n| --- | --- |\n${stages}\n\n速度は同じ固定局面・seed・64訪問で順番を交互にして比較し、履歴復元・探索・推論・待機を含み、初期化と描画を除きます。[速度結果](data/${speedFile})を参照してください。\n\n## 採用と限界\n\n${outcome} 32局/盤の初期試験で、教師は小型の古い通常ネットです。曲面への転移改善やKataGo相当の棋力を主張する試験ではありません。教師のスレッド割当とGPU演算のため、seedだけで全出力のビット一致を保証しません。全ての使用方策は保存した探索統計から再構成できます。\n\n公式ネットの出所・SHA-256は[data/provenance.json](data/provenance.json)、ネットの許諾文は[data/KataGo-NN-LICENSE.txt](data/KataGo-NN-LICENSE.txt)です。生徒パッケージにも出典と許諾文を添えています。これは出典を明示する運用方針で、ライセンス本文に蒸留専用条項があるという意味ではありません。\n\n## 再現手順と保存データ\n\n実行ツールはtools/ai-gnn/katago-distill-*.mjsです。新しい作業ディレクトリにKataGoを用意し、保存したplan.json・設定・分割を使用します。各工程の正確なコマンドと経過時間はdata内の*-command.json、ログは*-log.txtです。実行済みのtargetやこのdataを上書きしません。\n\n生徒のONNX・FP32 GPU重み・PyTorchチェックポイントは[data/teacher-model/](data/teacher-model/)、方策対照は[data/control-model/](data/control-model/)、更新前は[data/baseline/](data/baseline/)です。教師ネットと実行バイナリ自体は同梱せず、公式取得URLとハッシュを保存しています。\n`);
const reportPath=join(root,'README.md');
writeFileSync(reportPath,readFileSync(reportPath,'utf8').replaceAll('現行v3','基準v3').replace('生成した平面',`証明済み敗北局面を除いた実際の学習数は${teacher.trainPositions}局面、検証数は${teacher.validationPositions}局面です。\n\n生成した平面`));
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
const artifacts=files(data).sort().map(path=>({path:relative(root,path).split('\\').join('/'),sha256:hash(path)}));
const manifest={schemaVersion:1,id:plan.id,architecture:'v3',title:'KataGoの平面盤方策からv3への蒸留',source:{baseCommit:provenance.baseCommit,patch:'data/source.patch'},
 plan:{path:'plan.json',sha256:hash(join(root,'plan.json'))},variants:['deployed baseline v3','matched v3-policy extra-training control','KataGo policy-distilled v3'],
 notes:['Pre-registered data split, training and independent gates; all failed candidates retained.','Teacher model files and executable are referenced by official URL and SHA-256, not vendored.'],artifacts};
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const catalogFile='experiments/ai/catalog.json',catalog=JSON.parse(readFileSync(catalogFile));
if(catalog.experiments.some(e=>e.id===plan.id))throw Error('Catalog entry already exists');
catalog.experiments.push({id:plan.id,architecture:'v3',title:manifest.title,path:'v3/2026-10-27-katago-distillation/'});writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');
writeFileSync('experiments/ai/README.md',readFileSync('experiments/ai/README.md','utf8')+'\n[KataGoの平面盤方策からv3への蒸留](v3/2026-10-27-katago-distillation/README.md)のデータ・学習・独立評価を保存しました。\n');
console.log(JSON.stringify({archive:root,artifacts:artifacts.length,decision}));
