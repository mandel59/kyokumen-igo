// Update only the local experimental v3 slot after every preregistered gate passes.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
const directory=resolve(process.argv[2]),read=name=>JSON.parse(readFileSync(join(directory,name)));
const strength=read('independent-summary.json'),speed=read('speed-nine.json'),provenance=read('provenance.json'),plan=read('plan.json');
const numeric=['teacher-onnx','control-onnx','teacher-browser'].every(name=>read(name+'-command.json').exitCode===0);
const profile={schemaVersion:1,planId:plan.id,recorded:new Date().toISOString(),strengthGates:strength.strengthGates,
 speed:speed.passes,speedCoversAllBoards:speed.summary.every(s=>s.boards.length===9),numeric,
 strength:{planes:strength.planeVsBaseline,curves:strength.allCurvesVsBaseline,control:strength.planeVsControl},
 speedResults:speed.summary,baseline:provenance.baseline,candidate:read('teacher-model/manifest.json').sha256,control:read('control-model/manifest.json').sha256};
profile.eligible=strength.passesStrength&&profile.speed&&profile.speedCoversAllBoards&&numeric;
writeFileSync(join(directory,'student-profile.json'),JSON.stringify(profile,null,2)+'\n');
if(!profile.eligible){console.log('Candidate did not pass every gate; deployed weights remain unchanged.');process.exit(0);}
const current=JSON.parse(readFileSync('dist/models/v3/manifest.json'));
if(current.sha256!==provenance.baseline)throw Error('Deployed model changed during study; refusing to overwrite it');
const source=join(directory,'teacher-model/manifest.json'),manifest=read('teacher-model/manifest.json');
manifest.accepted=true;manifest.teacherProvenance={name:basename(provenance.model.path),url:provenance.model.url,sha256:provenance.model.sha256,
 license:'https://katagotraining.org/network_license/'};
manifest.dataSha256=Object.fromEntries(Object.entries(manifest.dataSha256).map(([file,sha])=>['experiments/ai/v3/2026-10-27-katago-distillation/data/'+basename(file),sha]));
manifest.acceptance={study:plan.id,profile:'experiments/ai/v3/2026-10-27-katago-distillation/data/student-profile.json',
 independentGames:384,planes:strength.planeVsBaseline.scoreRate,curves:strength.allCurvesVsBaseline.scoreRate,control:strength.planeVsControl.scoreRate,
 fixedVisits:64,parameters:120905,scope:'PC WebGPU and WASM; mobile speed not measured',allGatesPassed:true};
writeFileSync(source,JSON.stringify(manifest,null,2)+'\n');
execFileSync(process.execPath,['tools/ai-gnn/install-model.mjs',join(directory,'teacher-model')],{stdio:'inherit',windowsHide:true});
copyFileSync(join(directory,'KataGo-NN-LICENSE.txt'),'dist/models/v3/KataGo-NN-LICENSE.txt');
const pct=x=>(x*100).toFixed(1)+'%';
let docs=readFileSync('docs/ai/architectures/v3.md','utf8');
docs=docs.replace(/通常対局の標準はv2です。[^\n]+/,`通常対局の標準はv2です。実験用v3には、[KataGoの平面盤方策を蒸留したモデル](../../../experiments/ai/v3/2026-10-27-katago-distillation/README.md)を採用しました。同じ120,905パラメータ・64訪問で、独立評価の対現行v3得点率は平面${pct(strength.planeVsBaseline.scoreRate)}、曲面${pct(strength.allCurvesVsBaseline.scoreRate)}、方策対照に対しては平面${pct(strength.planeVsControl.scoreRate)}でした。全9盤の事前採用基準とPCのCPU/WASM・WebGPU速度基準を通過しています。スマートフォンの実機速度は未計測です。`);
docs=docs.replace(/球面・トーラスに加え、平面の7・9・11路盤でもv3を使えます。[^\n]+/,'球面・トーラスに加え、平面の7・9・11路盤でもv3を使えます。平面盤の隣接関係を探索へ渡し、端はつなぎません。配信モデルはKataGoの平面盤教師と曲面の既存教師データを混ぜて再学習したものです。');
docs=docs.replace('## 現在の配信モデル',`## 現在の配信モデル\n\n平面96局と曲面の既存48局を使い、KataGoのroot edgeVisitsから着手方策を蒸留しました。勝敗・得点・所属はアプリのルールによる実際の終局値です。候補と追加学習対照を同じ条件で学習し、独立384局と全9盤の固定局面速度比較を通過しました。[全記録](../../../experiments/ai/v3/2026-10-27-katago-distillation/README.md)と[採用profile](../../../experiments/ai/v3/2026-10-27-katago-distillation/data/student-profile.json)を参照してください。ONNX SHA-256は \`${manifest.sha256}\`。\n\n## 2026-10-25時点の配信モデル`);
writeFileSync('docs/ai/architectures/v3.md',docs.replace('対現行v3得点率','更新前v3への得点率'));
const index='docs/ai/README.md';
writeFileSync(index,readFileSync(index,'utf8').replace(/v3は `\?ai=v3` で試す実験実装です。[^\n]+/,`v3は \`?ai=v3\` で試す実験実装です。[KataGoの平面盤方策を蒸留した小型モデル](../../experiments/ai/v3/2026-10-27-katago-distillation/README.md)を採用しています。独立384局と全9盤のCPU/WASM・WebGPU速度基準を通過しました。[仕様](architectures/v3.md)と[開発手順](../../tools/ai-gnn/README.md)を参照してください。`));
const tools='tools/ai-gnn/README.md';
writeFileSync(tools,readFileSync(tools,'utf8').replace('配信中の重みは曲面のみで学習したものです。平面盤での棋力を改善するには、平面盤を含むデータで候補を学習し、全盤の独立対戦で評価してください。','配信モデルはKataGoの平面盤教師と曲面の既存教材を混ぜて再学習し、全9盤の独立対戦と速度基準を通過したものです。次の候補も、全盤で独立に評価してから採用します。'));
profile.installed=true;profile.candidate=manifest.sha256;profile.installedAt=new Date().toISOString();
writeFileSync(join(directory,'student-profile.json'),JSON.stringify(profile,null,2)+'\n');
console.log('Installed qualified experimental v3 model',manifest.sha256);
