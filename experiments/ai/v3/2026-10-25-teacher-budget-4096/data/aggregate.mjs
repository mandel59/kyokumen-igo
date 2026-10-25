import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {Game,createTopology} from '../../../../dist/engine.js';import {teacherBudgetStatistics} from '../../teacher-budget-statistics.mjs';import {matchStatistics} from '../../match-statistics.mjs';
const dir='tools/ai-gnn/target/teacher-budget-4096',plan=JSON.parse(fs.readFileSync(dir+'/plan.json')),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const[p,h]of Object.entries({...plan.sourceHashes,...plan.baselineFiles}))assert.equal(sha(p),h,'Changed input: '+p);
const results=[],openingMap=new Map();let turns=0,games=0;
for(const variant of plan.variants){
 const shards=plan.boards.map(board=>{const path=dir+'/'+variant+'-'+board.key+'.json',r=JSON.parse(fs.readFileSync(path)),command=JSON.parse(fs.readFileSync(dir+'/'+variant+'-'+board.key+'-command.json'));assert.equal(command.exitCode,0,'Incomplete command '+path);assert.equal(r.summary.games,16);assert.ok(r.summary.capped>=0);assert.equal(r.boards.length,1);assert.equal(r.seed,board.seed);assert.deepEqual(r.simulationsByPlayer,plan.visits);assert.deepEqual(r.fpu,plan.fpu);assert.equal(r.playerMode,'offline');assert.equal(r.models.a,plan.modelSha256);assert.equal(r.models.b,plan.modelSha256);assert.equal(r.provenance.wasm.a,plan.wasmHashes[variant]);assert.equal(r.provenance.wasm.b,plan.wasmHashes.sh8);
  for(const[p,h]of Object.entries(r.provenance.sources))assert.equal(sha(p),h,'Runtime changed '+p);
  for(const g of r.boards[0].games){
   const game=new Game(createTopology(board.kind,board.size),6.5);for(const move of g.moves){assert.ok((move<0?game.pass():game.play(move)).ok,'Illegal replay '+path);}
   assert.equal(game.ended,g.ended);const score=game.score();assert.equal(g.marginForA,(score.black-score.white)*(g.aColor===1?1:-1));if(g.ended)assert.equal(g.aScore,score.winner===0?.5:score.winner===g.aColor?1:0);else{assert.equal(g.aScore,null);assert.equal(g.moves.length,game.board.length*20);}
   const opening=g.moves.slice(0,4),key=board.key+':'+g.pair;if(openingMap.has(key))assert.deepEqual(opening,openingMap.get(key),'Different opening '+key);else openingMap.set(key,opening);
   for(const t of g.turnMetrics){assert.equal(t.backend,'offline-webgpu');assert.ok(Number.isInteger(t.simulations)&&t.simulations>=1&&t.simulations<=plan.visits[t.side]);if(!t.provenLoss)assert.equal(t.simulations,plan.visits[t.side]);turns++;}
   assert.equal(g.turnMetrics.length,g.moves.length-4);games++;
  }
  return{board:board.key,path,sha256:sha(path),report:r};
 });
 const report={...shards[0].report,seed:null,seedsByBoard:Object.fromEntries(plan.boards.map(b=>[b.key,b.seed])),boards:shards.flatMap(s=>s.report.boards),shards:shards.map(({board,path,sha256})=>({board,path,sha256})),environment:shards.map(s=>({board:s.board,...s.report.environment})),analysis:{scriptSha256:sha(dir+'/aggregate.mjs'),statisticsSha256:sha('tools/ai-gnn/teacher-budget-statistics.mjs'),revision:'exact rational percentile ranks; see analysis-revision.json'}};
 report.summary=report.boards.some(b=>b.games.some(g=>!g.ended))?matchStatistics(report,plan.bootstrap):teacherBudgetStatistics(report,plan.bootstrap);const s=report.summary,eligible=s.games===96&&s.capped===0&&s.scoreRate>=.6&&(s.pairedBootstrap?.interval97_5[0]??0)>.5&&s.boards.every(b=>b.score>=8);
 fs.writeFileSync(dir+'/'+variant+'-final.json',JSON.stringify(report,null,2)+'\n');results.push({variant,eligible,summary:s});console.log(variant,JSON.stringify(s));
}
const passing=results.filter(r=>r.eligible).sort((a,b)=>b.summary.score-a.summary.score||plan.variants.indexOf(a.variant)-plan.variants.indexOf(b.variant));
fs.writeFileSync(dir+'/final-selection.json',JSON.stringify({schemaVersion:1,rule:plan.gate,candidates:results,selected:passing[0]?.variant??null,teacherAdopted:false,browserAdopted:false,interpretation:passing.length?'A stronger-search candidate relative to the frozen64-visit opponent; student distillation remains untested.':'No candidate passed; no teacher-data expansion or distillation from these settings.'},null,2)+'\n');
fs.writeFileSync(dir+'/replay-validation.json',JSON.stringify({schemaVersion:1,games,turns,allGamesReplayedLegally:true,cappedGames:results.reduce((n,r)=>n+r.summary.capped,0),endedOutcomesAndCapFlagsMatch:true,openingPairsMatchAcrossVariants:true,allMarginsOutcomesMatch:true,exactNormalBudgets:true,allBackendsWebGPU:true,inputRuntimeHashesMatch:true,allCommandsExitedZero:true,analysisReaggregatedWithExactPercentileRanks:true},null,2)+'\n');
console.log('Selected',passing[0]?.variant??'none');
