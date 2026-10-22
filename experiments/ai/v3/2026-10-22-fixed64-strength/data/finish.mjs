// Verify and summarize a completed run; preserve previous experiments and results.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../../../../dist/engine.js';
import {matchStatistics} from '../../../../../tools/ai-gnn/match-statistics.mjs';
const dir='experiments/ai/v3/2026-10-22-fixed64-strength',data=dir+'/data';
const read=p=>JSON.parse(readFileSync(p)),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(existsSync(data+'/summary.json'),false,'Refusing to overwrite a completed study');
const plan=read(dir+'/plan.json'),execution=read(data+'/execution.json'),report=read(data+'/primary-browser.json'),historical=read(plan.historicalReference);
assert.equal(execution.status,'ready-for-summary');assert.equal(hash(dir+'/plan.json'),execution.planSha256);
for(const[p,h]of Object.entries(execution.hashes))assert.equal(hash(p),h,'Measured input changed: '+p);
assert.equal(report.models.a,plan.modelSha256);assert.equal(report.configurations.a.maxSimulations,64);assert.equal(report.configurations.a.budgetMs,null);
assert.equal(report.budgetMsPerMove,null);assert.equal(report.fpu.a,1);assert.equal(report.configurations.b.depth,4);
assert.equal(report.provenance.wasm.a,plan.wasmSha256.v3);assert.equal(report.provenance.wasm.b,plan.wasmSha256.v2);
assert.equal(report.seed,plan.evaluation.seed);assert.equal(report.pairsPerBoard,8);
const statistics=matchStatistics(report,{seed:plan.evaluation.bootstrapSeed,iterations:plan.evaluation.bootstrapIterations});
assert.deepEqual(statistics,report.summary);assert.equal(statistics.games,96);
let replays=0,openingComparisons=0,ordinaryTurns=0,earlyCertifiedLosses=0;
for(const r of[read(data+'/preflight.json'),report])for(const b of r.boards)for(const record of b.games){
 const g=new Game(createTopology(b.kind,b.size),r.komi);
 for(const move of record.moves)assert.ok((move===-1?g.pass():g.play(move)).ok,'Illegal replay move');
 assert.equal(g.ended,record.ended);const score=g.score();
 assert.equal((score.black-score.white)*(record.aColor===1?1:-1),record.marginForA);
 assert.equal(record.aScore,g.ended?(score.winner===0?.5:score.winner===record.aColor?1:0):null);replays++;
 for(const t of record.turnMetrics){
  if(t.side==='a'){
   assert.equal(t.backend,'v3-webgpu');
   if(t.provenLoss){assert.ok(t.simulations>=1&&t.simulations<=64);if(r===report)earlyCertifiedLosses++;}
   else{assert.equal(t.simulations,64);if(r===report)ordinaryTurns++;}
  }else assert.equal(t.backend,'v2-wasm');
 }
 if(r===report){
  const oldBoard=historical.boards.find(x=>x.kind===b.kind&&x.size===b.size),old=oldBoard.games.find(x=>x.pair===record.pair&&x.aColor===record.aColor);
  assert.deepEqual(record.moves.slice(0,4),old.moves.slice(0,4),'Historical starting position differs');openingComparisons++;
 }
}
const quantile=(xs,p)=>xs.slice().sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const distribution=xs=>({count:xs.length,meanMs:xs.reduce((s,x)=>s+x,0)/xs.length,medianMs:quantile(xs,.5),p95Ms:quantile(xs,.95)});
const turns=report.boards.flatMap(b=>b.games).flatMap(g=>g.turnMetrics);
const timing={v3:distribution(turns.filter(t=>t.side==='a').map(t=>t.elapsedMs)),v3WithoutCertifiedLoss:distribution(turns.filter(t=>t.side==='a'&&!t.provenLoss).map(t=>t.elapsedMs)),v2:distribution(turns.filter(t=>t.side==='b').map(t=>t.elapsedMs))};
const boards=statistics.boards.map((b,i)=>({...b,wins:report.boards[i].games.filter(g=>g.aScore===1).length,draws:report.boards[i].games.filter(g=>g.aScore===.5).length,losses:report.boards[i].games.filter(g=>g.aScore===0).length,capped:report.boards[i].games.filter(g=>!g.ended).length,historical300msScore:historical.boards[i].games.reduce((s,g)=>s+(g.aScore??0),0)}));
const summary={schemaVersion:1,id:plan.id,sourceBaseCommit:plan.sourceBaseCommit,modelSha256:plan.modelSha256,configurations:report.configurations,statistics,boards,timing,
 elapsedSeconds:read(data+'/primary-browser-command.json').elapsedSeconds,environment:report.environment,
 verification:{replayedGames:replays,allMovesLegal:true,allScoresMatch:true,ordinaryV3TurnsAtExactly64Visits:ordinaryTurns,certifiedLossTurns:earlyCertifiedLosses,sameHistoricalOpeningGames:openingComparisons,inputsUnchanged:true},
 historical300ms:{path:plan.historicalReference,sha256:hash(plan.historicalReference),statistics:historical.summary,interpretation:'Historical context with the same openings, not a head-to-head 64-versus-300ms match; the search implementation changed to enforce exact visits.'},
 limits:['96 games with paired openings on six fixed boards, komi 6.5, v2 depth 4; not equal compute time or a human rank estimate.','Only eight opening pairs per board; per-board outcomes are diagnostic.','Dedicated WebGPU on one PC, with every ordinary v3 turn verified at exactly 64 visits. Small numerical differences on other inference backends may change play.'],promotion:false};
writeFileSync(data+'/summary.json',JSON.stringify(summary,null,2)+'\n');
const pct=x=>(100*x).toFixed(1)+'%',interval=statistics.pairedBootstrap?.interval95.map(pct).join('〜')??'打ち切りのため算出せず';
const direction=statistics.pairedBootstrap?.interval95[0]>.5?'この評価条件では64訪問でもv3がv2を上回った。':'この標本では64訪問のv3の優位を確定できなかった。';
writeFileSync(dir+'/README.md',[
 '# 共通64訪問のv3と現行v2の対戦','',
 direction+' '+statistics.wins+'勝'+statistics.losses+'敗'+statistics.draws+'分、得点率'+pct(statistics.scoreRate)+'、先後交換ペアによる95%区間は'+interval+'。打ち切りは'+statistics.capped+'局だった。','',
 '## 条件','',
 'Pixel 8aの計測で採用したPC・スマートフォン共通の64訪問を評価した。実ブラウザーWorkerの専用WebGPUで、v3の現行重み・FPU 1・戦術と終盤の判定を使い、v2は現行WASM・深さ4とした。v3には時間制限を設定せず、敗北確定時を除く全'+ordinaryTurns+'手が厳密に64訪問だった。v2と同じ計算時間という意味ではない。','',
 '[事前計画](plan.json)を固定してから、全6盤・コミ6.5、各8組の先後交換、計96局を実行した。ランダムな合法4手から開始し、前回300ms評価と開始局面・手数ごとのseedを揃えた。seedは'+plan.evaluation.seed+'。機能確認の2局は勝率から除外した。結果を見て局数やモデルを変更していない。','',
 '## 盤別結果','',
 '| 盤 | 64訪問の勝敗 | 得点率 | 過去の300ms評価での得点 |','| --- | --- | ---: | ---: |',
 ...boards.map(b=>'| '+b.board+' | '+b.wins+'勝'+b.losses+'敗'+b.draws+'分 | '+pct(b.score/b.games)+' | '+b.historical300msScore+' / '+b.games+' |'),'',
 '過去の300ms設定は91勝5敗、94.8%。開始局面は同じだが、300ms版と64訪問版を直接対戦させた結果ではない。今回は厳密な訪問数制御の実装に変わっており、差を訪問数だけの効果として断定しない。各盤は8ペアであり、全体より不確実性が大きい。','',
 '## 計算時間と検証','',
 'PC上の平均着手計算時間はv3 '+timing.v3.meanMs.toFixed(2)+'ms、v2 '+timing.v2.meanMs.toFixed(2)+'ms。v3の敗北確定後の早期パスを除く平均は'+timing.v3WithoutCertifiedLoss.meanMs.toFixed(2)+'ms。ブラウザー '+report.environment.browser+'、CPU '+report.environment.cpu.trim()+'。対戦の所要時間は'+summary.elapsedSeconds.toFixed(2)+'秒。これらはPCでの計算時間で、Pixel 8aの時間は[別の計測](../2026-10-22-pixel8a-visits/README.md)にある。','',
 '機能確認を含む'+replays+'局の全棋譜を再生し、合法手・終局・得点・勝敗を照合した。評価96局の開始4手が過去の評価と一致すること、通常手が64訪問であること、入力コードと重みが実行中に変わっていないことを確認した。','',
 '## 保存データと再実行','',
 '[集計](data/summary.json)、[全棋譜と手ごとの計測](data/primary-browser.json)、[実行条件と入力ハッシュ](data/execution.json)、[ソース差分](data/source.patch)、[保存物目録](manifest.json)を保存した。基準コミットは `'+plan.sourceBaseCommit+'`、未コミットの実行コード・モデル・WASMは `data/source/` に固定している。実行コマンドは各 `*-command.json` にあり、[実行スクリプト](data/run.mjs)と[検証・集計](data/finish.mjs)も保存した。既存結果は上書きしないため、追試では新しい実験パス・出力先を用意する。','',
 '```powershell','node tools/ai-tuner/check-experiments.mjs','```','',
 'この結果はv2との相対評価で、人間の段級位や他の盤・コミの棋力には換算しない。モデルの変更・公開サイトへのデプロイは行っていない。',''
].join('\n'));
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(dir+'/'+e.name):[dir+'/'+e.name]);
const artifacts=files(data).sort().map(p=>({path:p.slice(dir.length+1),sha256:hash(p)}));
const manifest={schemaVersion:1,id:plan.id,architecture:'v3',title:'Actual browser 64-visit v3 versus current v2 depth 4',source:{baseCommit:plan.sourceBaseCommit,patch:'data/source.patch',snapshot:'data/source/'},plan:{path:'plan.json',sha256:execution.planSha256},variants:['v3:'+plan.modelSha256+':64-visits','v2:'+plan.wasmSha256.v2+':depth-4'],result:{path:'data/summary.json',promotion:false},artifacts};
writeFileSync(dir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({statistics,boards,timing,verification:summary.verification,artifacts:artifacts.length},null,2));
