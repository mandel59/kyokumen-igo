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
import {createKataGoAnalysis,analysisPosition} from './katago-analysis.mjs';
import {fromVertex} from '../gtp/vertex.mjs';
const dir='tools/ai-gnn/target/search-campaign-20261028';
const {createV3Search}=await import('./target/search-campaign-20261028/ai-v3-search.js');
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
function openingManifest(seed,pairs,boards){return {schemaVersion:1,seed,pairsPerBoard:pairs,boards:boards.map(board=>{const topology=createTopology(board.kind,board.size);return {...board,pairs:Array.from({length:pairs},(_,pair)=>{const random=rng(fnv(seed+'|'+board.key+'|'+pair+'|opening')),g=new Game(topology,6.5),moves=[];for(let k=0;k<4;k++){const legal=Array.from(g.board,(_,p)=>p).filter(p=>g.analyze(p).ok);const move=legal[random()%legal.length];g.play(move);moves.push(move);}return {pair,moves,searchSeedFormula:seed+'|'+board.key+'|'+pair+'|ply'};})};})};}
async function matchJob({variant,board,seed,pairs,manifest,output,mode='match'}){
 if(existsSync(dir+'/'+output)){const prior=JSON.parse(readFileSync(dir+'/'+output));if(prior.status==='complete')return prior;throw Error('Incomplete artifact exists: '+output);}
 const inference=await createNodeInference(dir+'/baseline'),a=await player(variant),b=await player('A8'),topology=createTopology(board.kind,board.size),N=topology.vertices.length;
 const sink=traceSink(dir+'/'+output+'.trace.jsonl.gz'),report={schemaVersion:1,phase,variant,board,seed,pairs,status:'running',games:[],pairScores:[],provenance:{model:plan.baseline.modelSha256,a:hash(dir+'/'+variant+'.wasm'),b:hash(dir+'/A8.wasm'),driver:hash('tools/ai-gnn/search-campaign.mjs')}};
 let failure;
 try{for(let pair=0;pair<pairs;pair++){
  let pairScore=0;for(const aColor of mode==='selfplay'?[1]:[1,2]){const game=new Game(topology,6.5);for(const move of manifest.pairs[pair].moves)assert.ok(game.play(move).ok);let addedRoots=0,candidateChangedRoots=0,addedSelected=0,totalMs=0;
   while(!game.ended&&game.moves<6*N){const side=game.turn===aColor?'a':'b',actor=side==='a'?a:b,out=await choose(actor,inference,game,{seed:fnv(seed+'|'+board.key+'|'+pair+'|'+game.moves)}),d=out.diagnostics;
    const additions=d.study?.added.reduce((a,b)=>a+b,0)??0;if(additions)addedRoots++;if((d.study?.members.reduce((a,b)=>a+b,0)??0)>8)candidateChangedRoots++;if(d.study?.added[out.move??160])addedSelected++;totalMs+=out.elapsedMs;
    await sink.push({pair,aColor,ply:game.moves,side,move:out.move,simulations:out.simulations,reason:out.decisionReason,elapsedMs:out.elapsedMs,collectMs:out.collectMs,collects:out.collects,...d});
    assert.ok((out.move===null?game.pass():game.play(out.move)).ok);
   }
   const score=game.score(),aScore=game.ended?(score.winner===0?.5:score.winner===aColor?1:0):null;
   report.games.push({pair,aColor,ended:game.ended,aScore,score,addedRoots,candidateChangedRoots,addedSelected,totalMs,moves:game.history.slice(1).map(s=>s.lastMove??-1)});save(output,report);
   console.log(phase,variant,board.key,'pair',pair,'colour',aColor,'score',aScore,'moves',game.moves);
   if(!game.ended)throw Error('Registered move cap reached; retain trajectory and stop');pairScore+=aScore;
  }report.pairScores.push(pairScore/(mode==='selfplay'?1:2));}
  report.status='complete';
 }catch(error){failure=error;report.status='failed';report.error=error.stack;}
 finally{await sink.close();a.dispose();b.dispose();await inference.dispose();save(output,report);}
 if(failure)throw failure;return report;
}

const ids=['A8',...plan.variants.map(v=>v.id)];
async function contracts(){const rows=[],reference=await player('original');
 try{for(const id of ids){const search=await player(id);try{for(const b of plan.boards){const g=new Game(createTopology(b.kind,b.size),6.5),random=rng(fnv('contracts|'+b.key));for(let k=0;k<20;k++){const legal=Array.from(g.board,(_,p)=>p).filter(p=>g.analyze(p).ok);g.play(legal[random()%legal.length]);}
 for(const budget of [1,3,17,64,65]){const o=await choose(search,{evaluate:async r=>mock(r)},g,{seed:5,budget});if(id==='A8'){const r=await choose(reference,{evaluate:async r=>mock(r)},g,{seed:5,budget});assert.deepEqual(o.diagnostics.rawVisits,r.diagnostics.rawVisits);assert.deepEqual(o.diagnostics.rootQ,r.diagnostics.rootQ);assert.equal(o.move,r.move);}
 const d=o.diagnostics,s=d.study;if(id!=='PUCTQ')assert.ok(s.members.reduce((a,b)=>a+b,0)<=(id==='Skip16'?16:id==='TacticalFast'?12:8));for(let a=0;a<161;a++)if(s.members[a])assert.ok(d.rootPriors[a]>0);rows.push({id,board:b.key,budget});}
 const pass=new Game(g.topology,6.5);pass.play(0);pass.pass();const score=pass.score();pass.komi=score.black-(score.white-pass.komi)-.5;const o=await choose(search,{evaluate:async r=>mock(r)},pass,{budget:65});assert.equal(o.move,null);assert.equal(o.policy[160],1);
 search.start(aiPosition(g),{seed:3,fpu:1});search.collect(8,64);search.cancel();await choose(search,{evaluate:async r=>mock(r)},g,{budget:7});
 }}finally{search.dispose();}}}finally{reference.dispose();}
 const inference=await createNodeInference(dir+'/baseline'),fixtureRows=[];const {game:g}=decodeRecord(fixture.recordCode);g.undo(g.moves-39);
 try{for(const id of ids){const search=await player(id);try{for(let seed=0;seed<4;seed++){const o=await choose(search,inference,g,{seed});fixtureRows.push({id,seed,move:o.move,diagnostics:o.diagnostics});}}finally{search.dispose();}}}finally{await inference.dispose();}
 save('results/contracts.json',{passed:true,count:rows.length,rows});save('results/fixture.json',{role:'development diagnostic only; not an adoption requirement',rows:fixtureRows});console.log('Contracts passed',rows.length,'fixture trials',fixtureRows.length);
}
function shortlistInput(stage){if(stage==='screen')return plan.variants.map(v=>v.id);if(stage==='refine')return JSON.parse(readFileSync(dir+'/results/screen-selection.json')).selected;return [JSON.parse(readFileSync(dir+'/results/refine-selection.json')).selected].filter(Boolean);}
function statsFor(reports,predicate=()=>true){return matchStatistics({boards:plan.boards.filter(predicate).map(b=>{const r=reports.find(r=>r.board.key===b.key);return {kind:b.kind,size:b.size,games:r.games,pairScores:r.pairScores};})},{seed:plan.seeds.bootstrap});}
async function runStage(stage){const selected=shortlistInput(stage);assert.ok(selected.length,'No selected candidate');const config=plan[stage],seed=plan.seeds[stage],manifest=openingManifest(seed,config.pairsPerBoard,plan.boards),manifestPath='results/'+stage+'-openings.json';
 if(existsSync(dir+'/'+manifestPath))assert.deepEqual(JSON.parse(readFileSync(dir+'/'+manifestPath)),manifest);else save(manifestPath,manifest);
 const jobs=selected.flatMap(variant=>plan.boards.map(board=>({variant,board,seed,pairs:config.pairsPerBoard,manifest:manifest.boards.find(x=>x.key===board.key),output:'results/'+stage+'-'+variant+'-'+board.key+'.json'})));
 let next=0;await Promise.all(Array.from({length:plan.matches.concurrency},async()=>{while(next<jobs.length)await matchJob(jobs[next++]);}));
 const results=selected.map(id=>{const reports=plan.boards.map(b=>JSON.parse(readFileSync(dir+'/results/'+stage+'-'+id+'-'+b.key+'.json')));return {id,all:statsFor(reports),plane:statsFor(reports,b=>b.kind==='plane'),curves:statsFor(reports,b=>b.kind!=='plane')};});save('results/'+stage+'-summary.json',{stage,results});console.log('SUMMARY',JSON.stringify(results.map(x=>({id:x.id,score:x.all.score,games:x.all.games,plane:x.plane.scoreRate,curves:x.curves.scoreRate}))));
}
function selection(stage){const summary=JSON.parse(readFileSync(dir+'/results/'+stage+'-summary.json')),config=plan[stage];const ranked=summary.results.map(x=>({...x,eligible:x.all.score>=config.minScore&&x.all.boards.every(b=>b.score>=config.minPerBoardScore)&&x.plane.scoreRate>=config.minPlaneScoreRate&&x.curves.scoreRate>=config.minCurveScoreRate&&!x.all.capped}));ranked.sort((a,b)=>b.all.score-a.all.score||plan.tieOrder.indexOf(a.id)-plan.tieOrder.indexOf(b.id));const selected=stage==='screen'?ranked.filter(x=>x.eligible).slice(0,2).map(x=>x.id):ranked.find(x=>x.eligible)?.id??null;
 save('results/'+stage+'-selection.json',{stage,selected,ranked,model:plan.baseline.modelSha256,driver:hash('tools/ai-gnn/search-campaign.mjs'),builds:JSON.parse(readFileSync(dir+'/builds.json'))});console.log('SELECTED',JSON.stringify(selected));
}
function assess(){const r=JSON.parse(readFileSync(dir+'/results/independent-summary.json')).results[0],c=plan.independent;const gates={overall:r.all.scoreRate>=c.minScoreRate&&r.all.pairedBootstrap.interval95[0]>c.minPaired95LowerExclusive,everyBoard:r.all.boards.every(b=>b.score>=c.minPerBoardScore),plane:r.plane.scoreRate>=c.minPlaneScoreRate,curves:r.curves.scoreRate>=c.minCurveScoreRate,completed:r.all.capped===0};save('results/independent-decision.json',{id:r.id,passesStrength:Object.values(gates).every(Boolean),gates,result:r,productionUpdated:false});console.log(JSON.stringify(gates));}
if(phase==='contracts')await contracts();else if(['screen','refine','independent'].includes(phase))await runStage(phase);else if(phase==='select-screen')selection('screen');else if(phase==='select-refine')selection('refine');else if(phase==='assess')assess();else throw Error('Expected contracts|screen|select-screen|refine|select-refine|independent|assess');
