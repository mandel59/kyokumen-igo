import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../../../../dist/engine.js';
import {antipodalMap,colorAntipodal} from '../../../../../tools/ai-gnn/antipodal.mjs';
const dir='experiments/ai/v3/2026-10-23-antipodal',data=dir+'/data';
const read=p=>JSON.parse(readFileSync(p)),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(existsSync(data+'/summary.json'),false,'Do not overwrite a completed report');
const plan=read(dir+'/plan.json'),execution=read(data+'/execution.json'),report=read(data+'/primary-browser.json');
assert.equal(execution.status,'ready-for-summary');assert.equal(hash(dir+'/plan.json'),execution.planSha256);
for(const[p,h]of Object.entries(execution.hashes))assert.equal(hash(p),h,'Measured inputs changed: '+p);
assert.equal(report.games.length,96);assert.equal(report.komi,6.5);assert.equal(report.openingMoves,0);
let replays=0,ordinaryV3Turns=0;
for(const r of[read(data+'/preflight.json'),report])for(const record of r.games){
 const game=new Game(createTopology('sphere',record.size),r.komi),map=antipodalMap(game.topology);
 let fallback=0,mirrored=0,firstIllegal=null,firstAsymmetric=null;
 assert.equal(record.turns.length,record.moves.length);
 for(const [index,t]of record.turns.entries()){
  assert.equal(t.ply,index+1);assert.equal(record.moves[index],t.move??-1);
  if(game.turn===2){
   assert.equal(t.color,'white');const target=game.lastMove===null?null:map[game.lastMove];assert.equal(t.target,target);
   const legal=target===null?{ok:true}:game.analyze(target);
   if(legal.ok){assert.equal(t.mode,'mirror');assert.equal(t.move,target);mirrored++;}
   else{assert.equal(t.mode,'v2-fallback');assert.equal(t.illegalReason,legal.reason);fallback++;firstIllegal??={ply:game.moves+1,target,reason:legal.reason};}
  }else{
   assert.equal(t.color,'black');assert.equal(t.mode,record.player);
   if(record.player==='v3'&&!t.provenLoss){assert.equal(t.simulations,64);if(r===report)ordinaryV3Turns++;}
  }
  const applied=t.move===null?game.pass():game.play(t.move);assert.ok(applied.ok);assert.equal(applied.captured??0,t.captured);
  if(game.turn===1){const symmetric=colorAntipodal(game.board,map);assert.equal(t.symmetricAfterWhite,symmetric);if(!symmetric)firstAsymmetric??=game.moves;}
 }
 assert.equal(game.ended,record.ended);assert.deepEqual(game.score(),record.score);
 assert.equal(fallback,record.whiteFallbackMoves);assert.equal(mirrored,record.whiteMirrorMoves);
 assert.deepEqual(firstIllegal,record.firstIllegalMirror);assert.equal(firstAsymmetric,record.firstAsymmetryPly);replays++;
}
const conditions=[];
for(const size of[3,4,5])for(const player of['v2','v3']){
 const games=report.games.filter(g=>g.size===size&&g.player===player);assert.equal(games.length,16);
 const ended=games.filter(g=>g.ended),pure=games.filter(g=>g.whiteFallbackMoves===0),broken=games.filter(g=>g.whiteFallbackMoves>0);
 const count=xs=>({games:xs.length,blackWins:xs.filter(g=>g.ended&&g.score.winner===1).length,whiteWins:xs.filter(g=>g.ended&&g.score.winner===2).length,draws:xs.filter(g=>g.ended&&g.score.winner===0).length,capped:xs.filter(g=>!g.ended).length});
 const reasons={};for(const g of games)for(const t of g.turns.filter(t=>t.mode==='v2-fallback'))reasons[t.illegalReason]=(reasons[t.illegalReason]??0)+1;
 const rawMargins=ended.map(g=>g.score.black-g.score.white+report.komi);
 conditions.push({size,points:6*size*size+2,player,...count(games),uniqueTrajectories:new Set(games.map(g=>JSON.stringify(g.moves))).size,
  pureMirror:count(pure),neededFallback:count(broken),gamesWithAsymmetry:games.filter(g=>g.firstAsymmetryPly!==null).length,
  fallbackReasons:reasons,komiOnlyWhiteWins:ended.filter(g=>g.score.winner===2&&g.score.black===g.score.white-report.komi).length,
  blackRawMarginRange:rawMargins.length?[Math.min(...rawMargins),Math.max(...rawMargins)]:null,
  firstIllegalPly:broken.length?[Math.min(...broken.map(g=>g.firstIllegalMirror.ply)),Math.max(...broken.map(g=>g.firstIllegalMirror.ply))]:null});
}
const totals=Object.fromEntries(['v2','v3'].map(player=>{
 const selected=conditions.filter(c=>c.player===player),keys=['games','blackWins','whiteWins','draws','capped','komiOnlyWhiteWins'];
 const total=Object.fromEntries(keys.map(k=>[k,selected.reduce((s,c)=>s+c[k],0)]));
 for(const group of['pureMirror','neededFallback'])total[group]=Object.fromEntries(['games','blackWins','whiteWins','draws','capped'].map(k=>[k,selected.reduce((s,c)=>s+c[group][k],0)]));
 return[player,total];
}));
const summary={schemaVersion:1,id:plan.id,conditions,totals,whitePolicy:report.whitePolicy,environment:report.environment,
 elapsedSeconds:read(data+'/primary-browser-command.json').elapsedSeconds,
 verification:{replayedGames:replays,allMovesLegal:true,allMirrorDecisionsVerified:true,allScoresMatch:true,ordinaryV3TurnsAt64Visits:ordinaryV3Turns,inputsUnchanged:true},
 limits:['All games start empty; seed variation is not a collection of independent opening positions. Unique trajectory counts are reported; no binomial confidence interval is claimed.',
  'Any game with an illegal antipodal reply uses the declared one-turn v2 fallback, and must not be counted as pure mirroring.',
  'Only current black v2 depth 4 and v3 WebGPU 64 visits, komi 6.5, the three application sphere sizes. No conclusion about optimal play or zero-komi rules.']};
writeFileSync(data+'/summary.json',JSON.stringify(summary,null,2)+'\n');
const table=conditions.map(c=>'| '+c.points+'交点 | '+c.player+' | '+c.blackWins+'勝'+c.whiteWins+'敗 | '+c.pureMirror.games+' | '+c.neededFallback.games+' | '+c.uniqueTrajectories+' |').join('\n');
writeFileSync(dir+'/README.md',[
 '# 白の対蹠点コピーに対する現行AI','',
 '黒v2は'+totals.v2.blackWins+'勝'+totals.v2.whiteWins+'敗、黒v3は'+totals.v3.blackWins+'勝'+totals.v3.whiteWins+'敗だった。各AI48局、打ち切りはv2 '+totals.v2.capped+'局・v3 '+totals.v3.capped+'局。白が補助手なしの対蹠点コピーだけで終えた局と、コピーが違法になって補助手を使った局は分けて解釈する。','',
 '## 条件','',
 '[事前計画](plan.json)を固定し、空の球面盤から、56・98・152交点の各盤で各AI16 seed、計96局を実行した。黒は現行v2 WASM・深さ4と、現行モデルのv3 WebGPU・厳密な64訪問。コミは6.5、上限は交点数の20倍の手数。黒のパスには白もパスする。白の対蹠点が合法なら必ずそこに打ち、違法な場合のみ、その1手を現行v2・深さ4で補い、次から真似を再開する。違法時のパス固定にはしていない。','',
 '試走2局を除いて96局を完了し、結果による局数追加・探索量変更・学習は行っていない。seedは2026102301を基準に盤サイズ・局番号から生成し、両AIで同じ手数ごとのseedを使う。ランダムな初期配置は入れていない。','',
 '## 盤別結果','',
 '| 盤 | 黒AI | 黒の勝敗 | 補助手なしの局数 | 違法コピーで補助手を使った局数 | 異なる棋譜数 |','| --- | --- | ---: | ---: | ---: | ---: |',table,'',
 '補助手なしの成績はv2で黒'+totals.v2.pureMirror.blackWins+'勝・白'+totals.v2.pureMirror.whiteWins+'勝、v3で黒'+totals.v3.pureMirror.blackWins+'勝・白'+totals.v3.pureMirror.whiteWins+'勝。補助手を使った局の成績はv2で黒'+totals.v2.neededFallback.blackWins+'勝・白'+totals.v2.neededFallback.whiteWins+'勝、v3で黒'+totals.v3.neededFallback.blackWins+'勝・白'+totals.v3.neededFallback.whiteWins+'勝だった。','',
 '同じ空盤からのseed違いであり、重複棋譜もあり得る。独立した48種類の開始局面を評価したという意味ではないため、二項分布の信頼区間は付けない。全条件の個別数・コピーが違法になった理由と手数・コミ前の得点差は[集計JSON](data/summary.json)にある。','',
 '## 検証と実行環境','',
 '全'+replays+'局（試走2局を含む）を再生し、合法手・取り・白の対蹠点対応・補助手の必要性・終局・得点・勝敗を照合した。通常のv3着手'+ordinaryV3Turns+'手が64訪問だった。対蹠点写像が隣接関係を保つこと、黒から一眼の大石を先に取って白の対蹠点応手を自殺手にできることも3サイズで確認した。[方策の事前検査](data/policy-checks.json)に件数がある。','',
 '実ブラウザーWorkerを使い、ブラウザー '+report.environment.browser+'、CPU '+report.environment.cpu.trim()+' で逐次実行した。評価の所要時間は'+summary.elapsedSeconds.toFixed(2)+'秒。端末速度を揃える評価やPixel 8a上の再測定ではない。','',
 '## 保存と再実行','',
 '[全棋譜と手ごとの応手](data/primary-browser.json)、[実行コマンド](data/primary-browser-command.json)、[実行条件と入力ハッシュ](data/execution.json)、[ソース差分](data/source.patch)、[保存物のハッシュ目録](manifest.json)を保存した。測定コード・モデル・WASMは `data/source/` に固定し、基準コミットは `'+plan.sourceBaseCommit+'`。追試は新しい出力先へ保存し、過去の記録を上書きしない。','',
 '```powershell','node tools/ai-gnn/mirror-match.mjs --games 16 --seed 2026102301 --output tools/ai-gnn/target/antipodal-recheck.json','node tools/ai-tuner/check-experiments.mjs','```','',
 'この白方策への成績であり、球面囲碁の最善応手や理論上の先後の優劣を証明するものではない。モデル・AIの選択方法・公開サイトは変更していない。',''
].join('\n'));
const files=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(p+'/'+e.name):[p+'/'+e.name]);
const manifest={schemaVersion:1,id:plan.id,architecture:'v3',title:'Black v2 and fixed-64 v3 versus white antipodal copying',source:{baseCommit:plan.sourceBaseCommit,patch:'data/source.patch'},plan:{path:'plan.json',sha256:execution.planSha256},variants:['v2-depth4','v3-webgpu-64','white-antipodal-with-one-turn-v2-fallback'],result:{path:'data/summary.json',promotion:false},artifacts:files(data).sort().map(p=>({path:p.slice(dir.length+1),sha256:hash(p)}))};
writeFileSync(dir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({totals,conditions,verification:summary.verification},null,2));
