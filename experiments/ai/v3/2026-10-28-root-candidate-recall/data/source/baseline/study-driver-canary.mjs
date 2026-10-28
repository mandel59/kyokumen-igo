// Registered root-candidate study. Research artifacts only; deployed sources/binaries are untouched.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {once} from 'node:events';
import {Game,createTopology,groupAt} from '../../dist/engine.js';
import {decodeRecord} from '../../dist/record.js';
import {aiPosition} from '../../dist/ai-position.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {matchStatistics} from './match-statistics.mjs';
const dir='tools/ai-gnn/target/root-candidate-recall-20261028';
const {createV3Search}=await import('./target/root-candidate-recall-20261028/ai-v3-search.js');
const plan=JSON.parse(readFileSync(dir+'/plan.json'));
const fixture=JSON.parse(readFileSync(dir+'/reported-game.json'));
const phase=process.argv[2];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(hash('dist/models/v3/model.onnx'),plan.baseline.modelSha256);
assert.equal(hash('dist/ai-v3.wasm'),plan.baseline.wasmSha256);
const save=(name,value)=>writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n');
export function fnv(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return s>>>0;};}
function traceSink(path){const file=createWriteStream(path,{flags:'wx'}),z=createGzip();z.pipe(file);return {async push(value){if(!z.write(JSON.stringify(value)+'\n'))await once(z,'drain');},async close(){z.end();await once(file,'close');}};}
async function player(variant){const bytes=readFileSync(variant==='original'?dir+'/baseline/A8.wasm':dir+'/'+variant+'.wasm');return await createV3Search({load:async()=>bytes});}
async function choose(search,inference,game,{seed=0,budget=64,tactics=true,trace=false}={}){
 search.start(aiPosition(game),{seed,fpu:1,tactics});const adjacency=adjacencyFor(game.topology),rounds=[];let collects=0,collectMs=0,stalled=0;
 const start=performance.now();
 while(search.result().simulations<budget){const completed=search.result().simulations,remaining=budget-completed,t0=performance.now();
  const request=search.collect(Math.min(8,remaining),remaining);collectMs+=performance.now()-t0;collects++;
  if(request.count)search.submit(request,await inference.evaluate(request,adjacency));
  const out=search.result({diagnostics:trace});if(trace)rounds.push({simulations:out.simulations,study:out.diagnostics.study});
  if(out.provenLoss)break;if(out.simulations===completed){if(++stalled>16)throw Error('Search stalled');}else stalled=0;
 }
 const result=search.result({diagnostics:true});assert.ok(result.provenLoss||result.simulations===budget);
 assert.ok(result.move===null||game.analyze(result.move).ok);assert.ok(Math.abs(result.policy.reduce((a,b)=>a+b,0)-1)<1e-4);
 for(const values of Object.values(result.diagnostics))if(Array.isArray(values))assert.ok(values.every(Number.isFinite));
 return {...result,rounds,elapsedMs:performance.now()-start,collectMs,collects};
}
function mock(request){return {policy:Float32Array.from({length:request.count*161},(_,i)=>i%161===160?-8:Math.sin(i%161)*.2),wdl:new Float32Array(request.count*3)};}
function referenceScores(game,eligible){const scores=new Array(161).fill(0),seen=new Set(),groups=[],ids=new Map();
 for(let p=0;p<game.board.length;p++)if(game.board[p]===game.turn&&!seen.has(p)){const gr=groupAt(game.board,game.topology.neighbors,p),id=groups.length;groups.push(gr);for(const q of gr.stones){seen.add(q);ids.set(q,id);}}
 for(let p=0;p<game.board.length;p++){if(!eligible[p])continue;const a=game.analyze(p);if(!a.ok||a.liberties<2)continue;const adjacent=new Set(game.topology.neighbors[p].filter(q=>game.board[q]===game.turn).map(q=>ids.get(q)));
 scores[p]=a.captured+[...adjacent].filter(i=>groups[i].liberties.size<=2).reduce((s,i)=>s+groups[i].stones.length,0)+Math.max(0,adjacent.size-1);}
 return scores;
}
async function checks(){const rows=[];const {game:reported}=decodeRecord(fixture.recordCode);reported.undo(reported.moves-39);const l6=10*11+5;assert.equal(reported.analyze(l6).captured,6);
 for(const variant of ['A8','B16','C8plus4']){const search=await player(variant),baseline=variant==='A8'?await player('original'):null;try{
  for(const board of plan.boards){const topology=createTopology(board.kind,board.size),game=new Game(topology,6.5),random=rng(fnv('checks|'+board.key));
   for(let step=0;step<20;step++){const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);game.play(legal[random()%legal.length]);}
   for(const budget of [1,2,3,7,17,31,64,65,129]){const out=await choose(search,{evaluate:async r=>mock(r)},game,{seed:7,budget,trace:true});
    const d=out.diagnostics,st=d.study;if(budget>=17){for(let p=0;p<161;p++)if(st.members[p])assert.ok(d.rawVisits[p]>=1,'Initial candidate received no visit');}
    if(variant==='C8plus4'&&budget>=3){const expected=referenceScores(game,d.rootPriors);assert.deepEqual(st.scores,expected);assert.ok(st.added.reduce((a,b)=>a+b,0)<=4);assert.ok(st.members.reduce((a,b)=>a+b,0)<=12);}
    if(baseline){const other=await choose(baseline,{evaluate:async r=>mock(r)},game,{seed:7,budget});assert.equal(out.move,other.move);assert.deepEqual(d.rawVisits,other.diagnostics.rawVisits);assert.deepEqual(d.rootQ,other.diagnostics.rootQ);}
    rows.push({variant,board:board.key,budget,simulations:out.simulations});
   }
   // Exact winning pass must dominate any candidate generator on every topology.
   const passGame=new Game(topology,6.5);passGame.play(0);passGame.pass();const score=passGame.score();passGame.komi=score.black-(score.white-passGame.komi)-.5;
   const pass=await choose(search,{evaluate:async r=>mock(r)},passGame,{budget:65});assert.equal(pass.move,null);assert.equal(pass.policy[160],1);
   // Cancel a pending leaf and restart the same instance.
   search.start(aiPosition(game),{seed:3,fpu:1});search.collect(8,64);search.cancel();await choose(search,{evaluate:async r=>mock(r)},game,{budget:7});
  }
 }finally{search.dispose();baseline?.dispose();}}
 save('results/semantic-checks.json',{passed:true,checks:rows,notes:'9 boards; reference tactical scores; original A8 equivalence; finite/odd budgets; every initial candidate visited; exact winning pass; pending cancellation/reuse. Full native Rust tests archived separately.'});console.log('Semantic checks passed:',rows.length);
}
function openingManifest(seed,pairs,boards){return {schemaVersion:1,seed,pairsPerBoard:pairs,boards:boards.map(board=>{const topology=createTopology(board.kind,board.size);return {...board,pairs:Array.from({length:pairs},(_,pair)=>{const random=rng(fnv(seed+'|'+board.key+'|'+pair+'|opening')),g=new Game(topology,6.5),moves=[];for(let k=0;k<4;k++){const legal=Array.from(g.board,(_,p)=>p).filter(p=>g.analyze(p).ok);const move=legal[random()%legal.length];g.play(move);moves.push(move);}return {pair,moves,searchSeedFormula:seed+'|'+board.key+'|'+pair+'|ply'};})};})};}
async function matchJob({variant,board,seed,pairs,manifest,output,mode='match'}){
 if(existsSync(dir+'/'+output)){const prior=JSON.parse(readFileSync(dir+'/'+output));if(prior.status==='complete')return prior;throw Error('Incomplete artifact exists: '+output);}
 const inference=await createNodeInference(dir+'/baseline'),a=await player(variant),b=await player('A8'),topology=createTopology(board.kind,board.size),N=topology.vertices.length;
 const sink=traceSink(dir+'/'+output+'.trace.jsonl.gz'),report={schemaVersion:1,phase,variant,board,seed,pairs,status:'running',games:[],pairScores:[],provenance:{model:plan.baseline.modelSha256,a:hash(dir+'/'+variant+'.wasm'),b:hash(dir+'/A8.wasm'),driver:hash('tools/ai-gnn/root-candidate-study.mjs')}};
 let failure;
 try{for(let pair=0;pair<pairs;pair++){
  let pairScore=0;for(const aColor of mode==='selfplay'?[1]:[1,2]){const game=new Game(topology,6.5);for(const move of manifest.pairs[pair].moves)assert.ok(game.play(move).ok);let addedRoots=0,addedSelected=0,totalMs=0;
   while(!game.ended&&game.moves<6*N){const side=game.turn===aColor?'a':'b',actor=side==='a'?a:b,out=await choose(actor,inference,game,{seed:fnv(seed+'|'+board.key+'|'+pair+'|'+game.moves)}),d=out.diagnostics;
    const additions=d.study?.added.reduce((a,b)=>a+b,0)??0;if(additions)addedRoots++;if(d.study?.added[out.move??160])addedSelected++;totalMs+=out.elapsedMs;
    await sink.push({pair,aColor,ply:game.moves,side,move:out.move,simulations:out.simulations,reason:out.decisionReason,elapsedMs:out.elapsedMs,collectMs:out.collectMs,collects:out.collects,...d});
    assert.ok((out.move===null?game.pass():game.play(out.move)).ok);
   }
   const score=game.score(),aScore=game.ended?(score.winner===0?.5:score.winner===aColor?1:0):null;
   report.games.push({pair,aColor,ended:game.ended,aScore,score,addedRoots,addedSelected,totalMs,moves:game.history.slice(1).map(s=>s.lastMove??-1)});save(output,report);
   console.log(phase,variant,board.key,'pair',pair,'colour',aColor,'score',aScore,'moves',game.moves);
   if(!game.ended)throw Error('Registered move cap reached; retain trajectory and stop');pairScore+=aScore;
  }report.pairScores.push(pairScore/(mode==='selfplay'?1:2));}
  report.status='complete';
 }catch(error){failure=error;report.status='failed';report.error=error.stack;}
 finally{await sink.close();a.dispose();b.dispose();await inference.dispose();save(output,report);}
 if(failure)throw failure;return report;
}
async function matches(stage){const variants=stage==='canary'?['B16','C8plus4']:stage==='development'?['B16','C8plus4']:[JSON.parse(readFileSync(dir+'/results/selection.json')).selected];
 if(stage==='independent')assert.ok(variants[0]);
 const config=plan[stage],manifest=openingManifest(config.seed,config.pairsPerBoard,plan.boards),manifestPath='results/'+stage+'-openings.json';
 if(existsSync(dir+'/'+manifestPath))assert.deepEqual(JSON.parse(readFileSync(dir+'/'+manifestPath)),manifest);else save(manifestPath,manifest);
 const jobs=variants.flatMap(variant=>plan.boards.map(board=>({variant,board,seed:config.seed,pairs:config.pairsPerBoard,manifest:manifest.boards.find(x=>x.key===board.key),output:'results/'+stage+'-'+variant+'-'+board.key+'.json'})));
 let next=0;const results=[];await Promise.all(Array.from({length:2},async()=>{while(next<jobs.length){const job=jobs[next++];results.push(await matchJob(job));}}));
 const summaries=variants.map(variant=>{const rr=results.filter(r=>r.variant===variant),report={boards:plan.boards.map(board=>{const r=rr.find(x=>x.board.key===board.key);return {kind:board.kind,size:board.size,games:r.games,pairScores:r.pairScores};})};return {variant,...matchStatistics(report,{seed:plan.independent.bootstrapSeed}),changedRoots:rr.reduce((s,r)=>s+r.games.reduce((s,g)=>s+g.addedRoots,0),0),addedSelected:rr.reduce((s,r)=>s+r.games.reduce((s,g)=>s+g.addedSelected,0),0)};});
 save('results/'+stage+'-summary.json',{schemaVersion:1,stage,summaries});console.log('SUMMARY',JSON.stringify(summaries));
}
async function corpus(){const c=plan.diagnostics.corpus,manifest=openingManifest(c.seed,c.gamesPerBoard,plan.boards);const path='results/corpus-openings.json';if(!existsSync(dir+'/'+path))save(path,manifest);let next=0;
 await Promise.all(Array.from({length:2},async()=>{while(next<plan.boards.length){const board=plan.boards[next++];await matchJob({variant:'A8',board,seed:c.seed,pairs:c.gamesPerBoard,manifest:manifest.boards.find(x=>x.key===board.key),output:'results/corpus-'+board.key+'.json',mode:'selfplay'});}}));
 // Origin-game split is fixed before teacher labels; the runner never opens holdout labels here.
 const roots=[];for(const board of plan.boards){const r=JSON.parse(readFileSync(dir+'/results/corpus-'+board.key+'.json')),topology=createTopology(board.kind,board.size),N=topology.vertices.length;
  for(const game of r.games)for(const ply of [Math.floor(N/4),Math.floor(N/2),Math.floor(3*N/4),N])roots.push({id:board.key+':'+game.pair+':'+ply,board:board.key,kind:board.kind,size:board.size,game:game.pair,partition:game.pair<4?'development':'holdout',ply,missing:game.moves.length<=ply,moves:game.moves.length>ply?game.moves.slice(0,ply):null});
 }save('results/corpus-roots.json',{seed:c.seed,roots});console.log('Corpus saved:',roots.length,'scheduled roots');}
if(phase==='checks')await checks();else if(['canary','development','independent'].includes(phase))await matches(phase);else if(phase==='corpus')await corpus();else throw Error('Expected checks|canary|corpus|development|independent');
