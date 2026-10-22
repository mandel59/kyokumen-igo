// Summarize the completed, predeclared comparison without rerunning or selecting players.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join,relative,resolve} from 'node:path';
import {Game,createTopology} from '../../dist/engine.js';
import {matchStatistics} from './match-statistics.mjs';
const directory='experiments/ai/v3/2026-10-22-vs-v2',data=directory+'/data';
const read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const plan=read(directory+'/plan.json'),execution=read(data+'/execution.json');
assert.equal(execution.status,'ready-for-summary');assert.equal(hash(directory+'/plan.json'),execution.planSha256);
if(existsSync(data+'/summary.json'))throw new Error('Completed summary already exists');
for(const[p,h]of Object.entries(execution.hashes))assert.equal(hash(p),h,'Configuration changed: '+p);
const primary=read(data+'/primary-browser.json'),secondary=read(data+'/secondary-fixed.json');
assert.equal(primary.models.a,plan.modelSha256);assert.equal(primary.models.b,'v2-deployed');
assert.equal(primary.fpu.a,plan.v3.fpu);assert.equal(primary.configurations.b.depth,4);
assert.equal(primary.provenance.wasm.a,plan.wasmSha256.v3);assert.equal(primary.provenance.wasm.b,plan.wasmSha256.v2);
assert.equal(secondary.aConfig.model,plan.modelSha256);assert.equal(secondary.aConfig.fpu,plan.v3.fpu);
assert.equal(secondary.aConfig.wasmSha256,plan.wasmSha256.v3);assert.equal(secondary.bConfig.wasmSha256,plan.wasmSha256.v2);
const primaryStats=matchStatistics(primary,{seed:plan.primary.bootstrapSeed,iterations:plan.statistics.iterations});
assert.deepEqual(primaryStats,primary.summary);assert.equal(primaryStats.games,plan.primary.games);
const secondaryStats=matchStatistics(secondary,{seed:plan.secondary.bootstrapSeed,iterations:plan.statistics.iterations});
assert.equal(secondaryStats.games,plan.secondary.games);
let replays=0;
for(const report of[primary,secondary])for(const board of report.boards)for(const record of board.games){
 const game=new Game(createTopology(board.kind,board.size),report.komi);
 for(const move of record.moves)assert.ok((move===-1?game.pass():game.play(move)).ok,'Illegal replay move');
 assert.equal(game.ended,record.ended);const score=game.score();
 assert.equal((score.black-score.white)*(record.aColor===1?1:-1),record.marginForA);
 const aScore=game.ended?(score.winner===0?.5:score.winner===record.aColor?1:0):null;
 assert.equal(aScore,record.aScore);replays++;
}
const quantile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const distribution=values=>({count:values.length,meanMs:values.reduce((s,v)=>s+v,0)/values.length,medianMs:quantile(values,.5),p95Ms:quantile(values,.95),totalMs:values.reduce((s,v)=>s+v,0)});
const timing={};
for(const side of['a','b']){
 const turns=primary.boards.flatMap(b=>b.games).flatMap(g=>g.turnMetrics).filter(t=>t.side===side);
 timing[side==='a'?'v3':'v2']=distribution(turns.map(t=>t.elapsedMs));
}
timing.v3WithoutCertifiedLoss=distribution(primary.boards.flatMap(b=>b.games).flatMap(g=>g.turnMetrics).filter(t=>t.side==='a'&&!t.provenLoss).map(t=>t.elapsedMs));
const summary={schemaVersion:1,id:plan.id,finished:execution.finished,sourceBaseCommit:execution.baseCommit,modelSha256:plan.modelSha256,
 primary:{role:plan.primary.role,configurations:primary.configurations,statistics:primaryStats,timing,environment:primary.environment},
 secondary:{role:plan.secondary.role,configurations:{v3:secondary.aConfig,v2:secondary.bConfig},statistics:secondaryStats,
  meanComputeMs:{v3:secondary.summary.metrics.a_ms/secondary.summary.metrics.a_turns,v2:secondary.summary.metrics.b_ms/secondary.summary.metrics.b_turns}},
 elapsedSeconds:{primary:read(data+'/primary-browser-command.json').elapsedSeconds,secondary:read(data+'/secondary-fixed-command.json').elapsedSeconds},
 verification:{replayedGames:replays,allMovesLegal:true,allScoresMatch:true,configurationsUnchanged:true},
 limits:['Current application configurations, not equal compute time: v2 depth 4 has no deadline interface.',
  'Fixed six boards, komi 6.5, sampled four-move openings, one device; no human-rank estimate.',
  'v2 API exposes move and elapsed time, not MCTS visits or proof flags. Its zero visit/proof counters in raw metrics mean unavailable.',
  'Per-board samples are smaller than the aggregate; do not infer an ordering of board-specific improvements.'],
 promotion:false};
writeFileSync(data+'/summary.json',JSON.stringify(summary,null,2)+'\n');
const pct=n=>(100*n).toFixed(1)+'%',fmt=n=>n.toFixed(2),interval=s=>s.pairedBootstrap?s.pairedBootstrap.interval95.map(pct).join('〜'):'打ち切りを含むため算出せず';
const boardRows=primaryStats.boards.map((b,i)=>'| '+b.board+' | '+b.score+' / '+b.games+' | '+secondaryStats.boards[i].score+' / '+secondaryStats.boards[i].games+' |').join('\n');
const direction=primaryStats.pairedBootstrap?.interval95[0]>.5?'この評価条件ではv3がv2を上回りました。':primaryStats.pairedBootstrap?.interval95[1]<.5?'この評価条件ではv2がv3を上回りました。':'今回の標本では全体の優劣を確定できませんでした。';
writeFileSync(directory+'/README.md',[
 '# 現行v2とv3の強さの比較','',
 direction+'実Workerで現行アプリの設定を比較し、v3は'+primaryStats.wins+'勝'+primaryStats.losses+'敗'+primaryStats.draws+'分、得点率'+pct(primaryStats.scoreRate)+'でした。打ち切りは'+primaryStats.capped+'局、先後交換ペアによる95%信頼区間は'+interval(primaryStats)+'です。','',
 '## 評価条件','',
 'v3は現行重み`'+plan.modelSha256+'`、親平均FPU、WebGPU、1手300ms・最大4096訪問です。v2は現行配信WASM・盤別係数・深さ4です。双方ともアプリと同じ合法手・終盤判定を使います。v2は時間制限型ではないため、同じ計算時間という比較ではありません。UIの最低表示待ち400ms、描画、初期化、メッセージ転送は着手計算時間に含めません。','',
 '全6盤、コミ6.5、ランダムな合法4手から開始し、同じ開始配置と手数別seedで先後を交換しました。主比較は各盤8ペア・計96局、seed '+plan.primary.seed+'、v3/v2を同一Worker内で交互に呼び出しています。他の計算ジョブを同時実行していません。補助比較はCPU ONNXのv3を128訪問、v2を深さ4に固定し、各盤4ペア・計48局、seed '+plan.secondary.seed+'で実行しました。訪問数とalpha-betaの深さは同じ探索量を表しません。','',
 '## 対戦結果','',
 '| 盤 | 実ブラウザでのv3得点 | 固定128訪問のv3得点 |','| --- | ---: | ---: |',boardRows,'',
 '主比較：'+primaryStats.wins+'勝'+primaryStats.losses+'敗'+primaryStats.draws+'分、'+pct(primaryStats.scoreRate)+'、95%区間'+interval(primaryStats)+'。補助比較：'+secondaryStats.wins+'勝'+secondaryStats.losses+'敗'+secondaryStats.draws+'分、'+pct(secondaryStats.scoreRate)+'、95%区間'+interval(secondaryStats)+'、打ち切り'+secondaryStats.capped+'局。区間は盤別層化、先後交換ペアを単位とする10,000回bootstrapです。','',
 '## 計算時間と実行環境','',
 '| 現行アプリ構成 | 全着手の平均 | 中央値 | P95 |','| --- | ---: | ---: | ---: |',
 '| v3 WebGPU | '+fmt(timing.v3.meanMs)+'ms | '+fmt(timing.v3.medianMs)+'ms | '+fmt(timing.v3.p95Ms)+'ms |',
 '| v2 WASM深さ4 | '+fmt(timing.v2.meanMs)+'ms | '+fmt(timing.v2.medianMs)+'ms | '+fmt(timing.v2.p95Ms)+'ms |','',
 '敗北確定で即時パスする手も上表に含みます。v3でその手を除いた平均は'+fmt(timing.v3WithoutCertifiedLoss.meanMs)+'msです。v2 APIは証明フラグや訪問数を返さないため、それらを比較しません。','',
 'ブラウザ'+primary.environment.browser+'、Node '+primary.environment.node+'、CPU '+primary.environment.cpu.trim()+'。主比較は'+fmt(summary.elapsedSeconds.primary/60)+'分、補助比較は'+fmt(summary.elapsedSeconds.secondary/60)+'分でした。v3の全着手でWebGPU経路を検証しています。盤別の標本は全体より小さく、他の端末・コミ・人間への段級位には直接換算しません。','',
 '## 保存データと検証','',
 '[事前計画](plan.json)、[実行とハッシュ](data/execution.json)、[集計](data/summary.json)、[実ブラウザ全棋譜](data/primary-browser.json)、[固定訪問数の全棋譜](data/secondary-fixed.json)、[ソース差分](data/source.patch)、[全成果物目録](manifest.json)を保存しています。全'+replays+'局を再生し、合法手・終局・得点・勝敗が一致しました。勝敗を見て条件・重み・局数を変えることや、モデルの採用・配信切り替えは行っていません。','',
 '実行コードの基準は`'+plan.sourceBaseCommit+'`です。各`*-command.json`のcommand・argsが実際のコマンドです。追試は同じ入力と設定で新しい出力先へ保存し、既存結果は上書きしません。比較用の`run-v2-comparison.mjs`は今回の固定パスを持ち、実行済み記録があると停止します。','',
 '```powershell','node tools/ai-tuner/check-experiments.mjs','```',''
].join('\n'));
const scope=['tools/ai-gnn/browser-match.mjs','tools/ai-gnn/match.mjs','tools/ai-gnn/run-v2-comparison.mjs',
 'tools/ai-gnn/finish-v2-comparison.mjs','experiments/ai/catalog.json','experiments/ai/README.md',directory+'/README.md',directory+'/plan.json'];
const git=args=>{const r=spawnSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const untracked=new Set(git(['ls-files','--others','--exclude-standard']).trim().split('\n'));
let patch=git(['diff','--binary',plan.sourceBaseCommit,'--',...scope]);
for(const p of scope)if(untracked.has(p)){
 const r=spawnSync('git',['diff','--no-index','--binary','--','/dev/null',p],{encoding:'utf8',maxBuffer:32*1024*1024});assert.ok([0,1].includes(r.status),r.stderr);patch+=r.stdout;
}
writeFileSync(data+'/source.patch',patch);
const sources=[];
for(const p of new Set([...scope,...Object.keys(execution.hashes)])){
 const snapshot=join(data,'source',p);mkdirSync(resolve(snapshot,'..'),{recursive:true});writeFileSync(snapshot,readFileSync(p));sources.push({path:p,sha256:hash(p),snapshot});
}
writeFileSync(data+'/source-manifest.json',JSON.stringify({baseCommit:plan.sourceBaseCommit,patchSha256:hash(data+'/source.patch'),sources},null,2)+'\n');
const artifacts=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else artifacts.push({path:relative(directory,p).replaceAll('\\','/'),sha256:hash(p)});}}
walk(data);artifacts.sort((a,b)=>a.path.localeCompare(b.path));
const manifest={schemaVersion:1,id:plan.id,architecture:'v3',title:'Current application v3 WebGPU versus deployed v2 WASM',
 source:{baseCommit:plan.sourceBaseCommit,patch:'data/source.patch'},plan:{path:'plan.json',sha256:execution.planSha256},
 variants:['v3:'+plan.modelSha256,'v2:'+plan.wasmSha256.v2],result:{path:'data/summary.json',promotion:false},artifacts};
writeFileSync(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({primary:primaryStats,secondary:secondaryStats,timing,replayed:replays,artifacts:artifacts.length}));
