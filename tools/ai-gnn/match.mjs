// Reproducible colour-swapped diagnostic matches; fixed visits are not equal wall time.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTopology,Game} from '../../dist/engine.js';
import {aiPosition,AI_BOARDS} from '../../dist/ai-position.js';
import {createWasmAI} from '../../dist/ai-wasm.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {createTeacherInference} from './teacher-inference.mjs';
import {createOfflineAI} from './offline-player.mjs';
import {matchStatistics} from './match-statistics.mjs';

const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const pairs=Number(arg('--pairs','1')),simulations=Number(arg('--simulations','128')),seed=Number(arg('--seed','20261101'));
if(!Number.isInteger(pairs)||pairs<1||!Number.isInteger(simulations)||simulations<2||!Number.isInteger(seed))throw new Error('Invalid match options');
const playerMode=arg('--player','puct');
if(!['puct','offline'].includes(playerMode))throw new Error('Invalid native player mode');
const bytes=readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url));
async function player(model,tactics,side){
 const teacher=arg('--'+side+'-teacher',null);
 if(teacher&&(playerMode!=='offline'||args.includes('--'+side)))throw new Error('Native teachers require --player offline and cannot also specify --'+side);
 if(teacher)model=teacher;
 if(model==='v2'){
  const loaded=readFileSync(new URL('../../dist/ai-engine.wasm',import.meta.url));
  const ai=await createWasmAI({load:async()=>loaded});
  return {name:'v2-deployed',config:{architecture:'v2',depth:4,wasmSha256:createHash('sha256').update(loaded).digest('hex')},async choose(position,seed){return {move:ai.chooseMove(position,{depth:4,seed})};},async dispose(){ai.dispose();}};
 }
 const wasm=arg('--'+side+'-wasm',null),loaded=wasm?readFileSync(wasm):bytes;
 const fpu=Number(arg('--'+side+'-fpu',playerMode==='offline'?'1':'0')),visits=Number(arg('--'+side+'-simulations',String(simulations)));
 if(!Number.isInteger(fpu)||fpu<0||fpu>2||!Number.isInteger(visits)||visits<2)throw new Error('Invalid per-player search configuration');
 if(playerMode==='offline'){
  if(tactics!=='safe')throw Error('Offline native player requires safe tactics');
  let inference;
  const ai=await createOfflineAI({fpu,createSearch:()=>createV3Search({load:async()=>loaded}),createInference:async()=>{
   inference=teacher?await createTeacherInference({directory:teacher,device:arg('--'+side+'-device','cuda')}):await createNodeInference(model);
   if(!teacher){inference.backend='onnx-cpu';inference.batchSize=8;}return inference;
  }});
  const config={model:inference.manifest.sha256,format:teacher?'offline-teacher-v1':'v3-onnx',backend:ai.backend,tactics,fpu,visits,wasmSha256:createHash('sha256').update(loaded).digest('hex')};
  return {name:config.model+':offline:fpu='+fpu,config,choose:(position,seed)=>ai.chooseMove(position,{seed,maxSimulations:visits,diagnostics:arg('--diagnostics','false')==='true'}),dispose:()=>ai.dispose()};
 }
 const search=await createV3Search({load:async()=>loaded}),inference=await createNodeInference(model);
 const config={model:inference.manifest.sha256,tactics,fpu,visits,wasmSha256:createHash('sha256').update(loaded).digest('hex')};
 return {name:inference.manifest.sha256+':tactics='+tactics+':fpu='+fpu,config,async choose(position,seed,adjacency){
  search.start(position,{seed,tactics:tactics!=='none',fpu});let root,stalled=0;
  while(search.result().simulations<visits){
   const leaves=search.collect();if(!root&&leaves.count)root=leaves;
   if(leaves.count)search.submit(leaves,await inference.evaluate(leaves,adjacency));
   if(!leaves.count){if(++stalled>16)throw new Error('Stalled match search');}else stalled=0;
   if(search.result().provenLoss)break;
  }
  return {...search.result({diagnostics:arg('--diagnostics','false')==='true'}),root};
 },async dispose(){search.dispose();await inference.dispose();}};
}
let state=seed>>>0||1;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
const a=await player(arg('--a','dist/models/v3'),arg('--a-tactics','safe'),'a');
let b;try{b=await player(arg('--b','v2'),arg('--b-tactics','safe'),'b');}catch(error){await a.dispose();throw error;}
const report={schemaVersion:1,playerMode,seed,pairsPerBoard:pairs,simulations,komi:6.5,openingMoves:4,a:a.name,b:b.name,aConfig:a.config,bConfig:b.config,
 condition:playerMode==='offline'?'Finite fixed visits, research-only native ONNX/Torch inference; separate per-player budgets/backends, no wall-time cutoff or speed claim.':'Fixed v3 simulations (certified losses stop early) vs v2 depth 4 or another v3; native CPU inference, not a browser equal-time strength estimate.',boards:[]};
const output=arg('--output','tools/ai-gnn/target/match.json');
try{
 for(const [kind,size]of AI_BOARDS){
  if(arg('--board','all')!=='all'&&arg('--board','all')!==kind+size)continue;
  const topology=createTopology(kind,size),adjacency=adjacencyFor(topology),board={kind,size,games:[],pairScores:[]};report.boards.push(board);
  for(let pair=0;pair<pairs;pair++){
   const opening=new Game(topology,6.5),moves=[];
   for(let k=0;k<4;k++){
    const legal=Array.from(opening.board,(_,p)=>p).filter(p=>opening.analyze(p).ok),move=legal[random()%legal.length];
    opening.play(move);moves.push(move);
   }
   const turnSeeds=Array.from({length:topology.vertices.length*20},random);let pairScore=0,completed=0;
   for(const aColor of [1,2]){
    const game=new Game(topology,6.5);for(const move of moves)game.play(move);
    const stats=()=>({turns:0,ms:0,simulations:0,passes:0,losingPasses:0,earlyPasses:0,certifiedLossPasses:0,uncertifiedLosingPasses:0,selfAtaris:0,eyeFills:0,missedCaptures:0});
    const metrics={a:stats(),b:stats()},searchDiagnostics=[];
    while(!game.ended&&game.moves<turnSeeds.length){
     const side=game.turn===aColor?'a':'b',actor=side==='a'?a:b,m=metrics[side];
     const start=performance.now(),result=await actor.choose(aiPosition(game),turnSeeds[game.moves],adjacency);m.ms+=performance.now()-start;
     m.turns++;m.simulations+=result.simulations??0;
     const score=game.score(),move=result.move;
     if(result.diagnostics)searchDiagnostics.push({ply:game.moves,side,decisionReason:result.decisionReason,...result.diagnostics});
     if(move===null){
      m.passes++;if(game.moves<topology.vertices.length/2)m.earlyPasses++;
      if(result.provenLoss)m.certifiedLossPasses++;
      if(score.winner!==0&&score.winner!==game.turn){m.losingPasses++;if(!result.provenLoss)m.uncertifiedLosingPasses++;}
     }
     else{
      const analysis=game.analyze(move);if(!analysis.ok)throw new Error('Illegal AI move');
      if(analysis.liberties===1&&!analysis.captured)m.selfAtaris++;
      if(!analysis.captured&&topology.neighbors[move].every(p=>game.board[p]===game.turn))m.eyeFills++;
      if(!analysis.captured&&Array.from(game.board,(_,p)=>p).some(p=>game.analyze(p).captured>0))m.missedCaptures++;
     }
     if(!(move===null?game.pass():game.play(move)).ok)throw new Error('Illegal AI move');
    }
    const score=game.score(),aScore=game.ended?(score.winner===0?.5:score.winner===aColor?1:0):null;
    if(aScore!==null){pairScore+=aScore;completed++;}
    board.games.push({pair,aColor,ended:game.ended,aScore,marginForA:(score.black-score.white)*(aColor===1?1:-1),metrics,searchDiagnostics,
     moves:game.history.slice(1).map(s=>s.lastMove??-1)});
    console.log(kind,size,'pair',pair,'A colour',aColor,'score',aScore,'margin',board.games.at(-1).marginForA,'moves',game.moves);
    writeFileSync(output,JSON.stringify(report,null,2)+'\n');
   }
   board.pairScores.push(completed===2?pairScore/2:null);
  }
 }
}finally{await a.dispose();await b.dispose();}
report.summary={games:report.boards.reduce((s,b)=>s+b.games.length,0),completed:0,capped:0,score:0,metrics:{}};
for(const board of report.boards)for(const game of board.games){
 if(game.ended){report.summary.completed++;report.summary.score+=game.aScore;}else report.summary.capped++;
 for(const side of ['a','b'])for(const [key,value]of Object.entries(game.metrics[side])){
  const name=side+'_'+key;report.summary.metrics[name]=(report.summary.metrics[name]??0)+value;
 }
}
report.summary.scoreRate=report.summary.completed?report.summary.score/report.summary.completed:null;
Object.assign(report.summary,matchStatistics(report,{seed:Number(arg('--bootstrap-seed',String(seed+1)))}));
report.provenance={sources:Object.fromEntries(['tools/ai-gnn/match.mjs',...(playerMode==='offline'?['tools/ai-gnn/offline-player.mjs','tools/ai-gnn/teacher-inference.mjs','tools/ai-gnn/teacher_server.py','tools/ai-gnn/teacher_model.py','tools/ai-gnn/teacher_package.py']:[]),'tools/ai-gnn/node-inference.mjs','tools/ai-gnn/match-statistics.mjs','dist/ai-v3-inference.js','dist/ai-position.js','dist/ai-v3-search.js','dist/engine.js'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
