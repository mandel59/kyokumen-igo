// Paired matches in a real Worker using the application's WebGPU player with time or visit budgets.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {matchStatistics} from './match-statistics.mjs';
import {AI_BOARDS} from '../../dist/ai-position.js';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const root=resolve('.'),models={a:resolve(arg('--a')),b:resolve(arg('--b','dist/models/v3'))},output=arg('--output');
const v2Opponent=arg('--b')==='v2',sides=v2Opponent?['a']:['a','b'];
if(!args.includes('--a')||!output)throw new Error('Expected --a MODEL --output FILE');
if(existsSync(output))throw new Error('Output already exists: '+output);
const pairs=Number(arg('--pairs','4')),budgetMs=Number(arg('--budget-ms','300')),seed=Number(arg('--seed','2026102252'));
const perPlayerVisits=args.includes('--a-simulations')||args.includes('--b-simulations');
const fixedVisits=args.includes('--simulations')||perPlayerVisits?Number(arg('--simulations','64')):null;
const visitsBySide=fixedVisits===null?null:Object.fromEntries(['a','b'].map(side=>[side,Number(arg('--'+side+'-simulations',String(fixedVisits)))]));
if(visitsBySide&&Object.values(visitsBySide).some(v=>!Number.isInteger(v)||v<1||v>0xffffffff))throw new Error('Invalid per-player visit budget');
if(v2Opponent&&args.includes('--b-simulations'))throw new Error('v2 uses depth, not v3 visits');
if(fixedVisits!==null&&(!Number.isInteger(fixedVisits)||fixedVisits<1||fixedVisits>0xffffffff||args.includes('--budget-ms')))throw new Error('Use either --simulations VISITS or --budget-ms MS');
const playerMode=arg('--player','app');
if(!['app','offline'].includes(playerMode)||(playerMode==='offline'&&fixedVisits===null))throw new Error('Offline player requires fixed visits');
const selectedBoard=arg('--board','all');
if(!Number.isInteger(pairs)||pairs<1||!Number.isFinite(budgetMs)||budgetMs<=0||!Number.isInteger(seed)||
 !['all',...AI_BOARDS.map(([kind,size])=>kind+size)].includes(selectedBoard))throw new Error('Invalid browser match options');
const wasm={a:resolve(arg('--a-wasm','dist/ai-v3.wasm')),b:resolve(arg('--b-wasm',v2Opponent?'dist/ai-engine.wasm':'dist/ai-v3.wasm'))};
const fpu=Object.fromEntries(sides.map(side=>[side,Number(arg('--'+side+'-fpu',String(JSON.parse(readFileSync(models[side]+'/manifest.json','utf8')).search?.fpu??0)))]));
if(Object.values(fpu).some(v=>!Number.isInteger(v)||v<0||v>2))throw new Error('Invalid FPU mode');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const mime={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.onnx':'application/octet-stream','.f32':'application/octet-stream'};
const server=createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Kyokugo AI evaluation</title>');return;}
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  let path;
  if(name==='/tools/ai-gnn/offline-player.mjs')path=resolve(root,'tools/ai-gnn/offline-player.mjs');
  else if(name==='/wasm/a'||name==='/wasm/b')path=wasm[name.at(-1)];
  else if(/^\/models\/[ab]\//.test(name)){
   const side=name[8],base=models[side];path=resolve(base,name.slice(10));
   if(!path.startsWith(base+sep))throw new Error('Invalid model path');
  }else{
   path=resolve(root,'.'+name);if(!name.startsWith('/dist/')||!path.startsWith(root+sep))throw new Error('Invalid asset path');
  }
  if(!existsSync(path)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',mime[extname(path)]??'application/octet-stream');res.end(readFileSync(path));
 }catch{res.writeHead(400);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});
try{
 const page=await browser.newPage();await page.goto(base);
 await page.exposeFunction('studyProgress',report=>{writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Browser games',report.boards.reduce((s,b)=>s+b.games.length,0));});
 const report=await page.evaluate(async config=>{
  const run=async function(config){
   const {base,seed,pairs,budgetMs,fixedVisits,visitsBySide,playerMode,fpu,v2Opponent,sides,selectedBoard}=config;
   const {Game,createTopology}=await import(base+'/dist/engine.js');
   const {aiPosition,AI_BOARDS}=await import(base+'/dist/ai-position.js');
   const {createV3Search}=await import(base+'/dist/ai-v3-search.js');
   const {createV3AI}=await import(base+'/dist/ai-v3.js');
   const createPlayer=playerMode==='offline'?(await import(base+'/tools/ai-gnn/offline-player.mjs')).createOfflineAI:createV3AI;
   const {createWasmAI}=await import(base+'/dist/ai-wasm.js');
   const {createV3Inference,adjacencyFor}=await import(base+'/dist/ai-v3-inference.js');
   const boards=AI_BOARDS.filter(([kind,size])=>selectedBoard==='all'||kind+size===selectedBoard);
   const manifest={};for(const side of sides)manifest[side]=await(await fetch(base+'/models/'+side+'/manifest.json')).json();
   const searchBudget=side=>fixedVisits!==null?{maxSimulations:visitsBySide[side]}:{budgetMs,maxSimulations:4096};
   const configuration=side=>({architecture:'v3',backend:'webgpu',playerMode,budgetMs:fixedVisits===null?budgetMs:null,maxSimulations:searchBudget(side).maxSimulations,fpu:fpu[side]});
   const report={schemaVersion:1,seed,pairsPerBoard:pairs,budgetMsPerMove:fixedVisits===null?budgetMs:null,simulationsPerMove:fixedVisits===null||visitsBySide.a!==visitsBySide.b?null:visitsBySide.a,playerMode,simulationsByPlayer:visitsBySide&&{a:visitsBySide.a,b:v2Opponent?null:visitsBySide.b},komi:6.5,openingMoves:4,
    models:{a:manifest.a.sha256,b:v2Opponent?'v2-deployed':manifest.b.sha256},fpu,boards:[],inferenceTimings:[],
    configurations:{a:configuration('a'),b:v2Opponent?{architecture:'v2',backend:'wasm',depth:4}:configuration('b')},
    condition:v2Opponent?'Current application configurations: v3 WebGPU with 300ms default budget versus deployed v2 WASM depth 4. Same Worker, sequential turns; actual compute time is measured, not equalized.':'Same Worker, sequential turns, actual application WebGPU player; fixed time, max 4096 visits, early stop on certified loss.'};
   if(v2Opponent)report.condition=report.condition.replace('300ms',budgetMs+'ms');
   if(fixedVisits!==null)report.condition='Actual application WebGPU player with fixed visits A='+visitsBySide.a+', B='+(v2Opponent?'v2 depth4':visitsBySide.b)+' and no time cutoff; certified losses stop early. '+(v2Opponent?'Opponent is deployed v2 WASM depth 4.':visitsBySide.a===visitsBySide.b?'Both players use the same visit budget.':'Players use different visit budgets; this is not an equal-compute comparison.')+' Same Worker, sequential turns; not equal compute time.';
   if(playerMode==='offline')report.condition+=' Offline research player without UI timer yields; search and neural evaluations are unchanged.';
   const load=side=>async()=>{const r=await fetch(base+'/wasm/'+side);if(!r.ok)throw new Error('Missing WASM');return r.arrayBuffer();};
   const native={};for(const side of sides){
    native[side]=await createV3Inference({manifestURL:base+'/models/'+side+'/manifest.json',backend:'webgpu'});
    if(native[side].backend!=='webgpu'||native[side].runtime!=='wgsl')throw new Error('Dedicated WebGPU required');
   }
   const encoder=await createV3Search({load:load('a')}),allTimes={a:[],b:[]};
   const p95=a=>a.slice().sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1];
   try{
    for(const[kind,size]of boards){
     const game=new Game(createTopology(kind,size),6.5),leaves=[];
     for(let b=0;b<8;b++){
      encoder.start(aiPosition(game));leaves.push(encoder.collect(1));encoder.cancel();
      const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);game.play(legal[(b*17+3)%legal.length]);
     }
     const adjacency=adjacencyFor(game.topology);
     for(const count of[1,4,8]){
      const request={count};for(const key of['x','mask','global_features'])request[key]=Float32Array.from(leaves.slice(0,count).flatMap(l=>Array.from(l[key])));
      for(const side of sides)for(let i=0;i<5;i++)await native[side].evaluate(request,adjacency);
      const times={a:[],b:[]};
      for(let round=0;round<3;round++)for(const side of round%2?sides.slice().reverse():sides)for(let i=0;i<20;i++){
       const start=performance.now();await native[side].evaluate(request,adjacency);const dt=performance.now()-start;times[side].push(dt);allTimes[side].push(dt);
      }
      report.inferenceTimings.push({board:kind+size,batch:count,aP95:p95(times.a),bP95:v2Opponent?null:p95(times.b),ratio:v2Opponent?null:p95(times.a)/p95(times.b)});
     }
    }
   }finally{encoder.dispose();for(const v of Object.values(native))await v.dispose();}
   report.warmInference={aP95:p95(allTimes.a),bP95:v2Opponent?null:p95(allTimes.b),ratio:v2Opponent?null:p95(allTimes.a)/p95(allTimes.b),samplesPerModel:allTimes.a.length};
   const players={};for(const side of sides)players[side]=await createPlayer({load:load(side),manifestURL:base+'/models/'+side+'/manifest.json',backend:'webgpu',fpu:fpu[side]});
   if(v2Opponent){
    const ai=await createWasmAI({load:load('b')});
    players.b={async chooseMove(position,{seed}){return{move:ai.chooseMove(position,{depth:4,seed}),backend:'v2-wasm'};},async dispose(){ai.dispose();}};
   }
   let state=seed>>>0||1;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
   try{
    for(const[kind,size]of boards){
     const topology=createTopology(kind,size),board={kind,size,games:[],pairScores:[]};report.boards.push(board);
     for(let pair=0;pair<pairs;pair++){
      const opening=new Game(topology,6.5),moves=[];
      for(let k=0;k<4;k++){const legal=Array.from(opening.board,(_,p)=>p).filter(p=>opening.analyze(p).ok),move=legal[random()%legal.length];opening.play(move);moves.push(move);}
      const turnSeeds=Array.from({length:topology.vertices.length*20},random);let score=0,completed=0;
      for(const aColor of[1,2]){
       const game=new Game(topology,6.5);for(const move of moves)game.play(move);
       const metrics={a:{turns:0,ms:0,simulations:0,passes:0,certifiedLossPasses:0},b:{turns:0,ms:0,simulations:0,passes:0,certifiedLossPasses:0}},turnMetrics=[];
       while(!game.ended&&game.moves<turnSeeds.length){
        const side=game.turn===aColor?'a':'b',start=performance.now();
        const result=await players[side].chooseMove(aiPosition(game),{seed:turnSeeds[game.moves],...searchBudget(side)});
        if(result.backend!==(side==='b'&&v2Opponent?'v2-wasm':playerMode==='offline'?'offline-webgpu':'v3-webgpu'))throw new Error('Unexpected backend during browser match');
        if(fixedVisits!==null&&!(side==='b'&&v2Opponent)&&!result.provenLoss&&result.simulations!==visitsBySide[side])throw new Error('Fixed visit budget was not reached exactly');
        const elapsedMs=performance.now()-start,m=metrics[side];m.turns++;m.ms+=elapsedMs;m.simulations+=result.simulations??0;
        turnMetrics.push({ply:game.moves,side,elapsedMs,simulations:result.simulations??null,backend:result.backend,batches:result.batches??null,move:result.move,provenLoss:result.provenLoss??null});
        if(result.move===null)m.passes++;if(result.provenLoss)m.certifiedLossPasses++;
        if(!(result.move===null?game.pass():game.play(result.move)).ok)throw new Error('Illegal browser move');
       }
       const margin=game.score(),aScore=game.ended?(margin.winner===0?.5:margin.winner===aColor?1:0):null;
       if(aScore!==null){score+=aScore;completed++;}
       board.games.push({pair,aColor,ended:game.ended,aScore,marginForA:(margin.black-margin.white)*(aColor===1?1:-1),metrics,turnMetrics,moves:game.history.slice(1).map(s=>s.lastMove??-1)});
       self.postMessage({kind:'progress',report});
      }
      board.pairScores.push(completed===2?score/2:null);
     }
    }
   }finally{for(const player of Object.values(players))await player.dispose();}
   return report;
  };
  return await new Promise((resolve,reject)=>{
   const blob=new Blob(['self.onmessage=async event=>{try{const report=await ('+run.toString()+')(event.data);self.postMessage({kind:"done",report});}catch(error){self.postMessage({kind:"error",message:error.stack});}};'],{type:'text/javascript'});
   const url=URL.createObjectURL(blob),worker=new Worker(url);URL.revokeObjectURL(url);
   let pending=Promise.resolve();
   worker.onmessage=event=>{const r=event.data;if(r.kind==='progress'){pending=pending.then(()=>window.studyProgress(r.report));pending.catch(reject);}else if(r.kind==='done'){worker.terminate();pending.then(()=>resolve(r.report),reject);}else{worker.terminate();reject(new Error(r.message));}};
   worker.onerror=event=>{worker.terminate();reject(new Error(event.message));};worker.postMessage(config);
  });
 },{base,seed,pairs,budgetMs,fixedVisits,visitsBySide,playerMode,fpu,v2Opponent,sides,selectedBoard});
 report.role=arg('--role','evaluation');
 report.summary=matchStatistics(report,{seed:Number(arg('--bootstrap-seed',String(report.seed+1)))});report.environment={browser:browser.version(),node:process.version,cpu:cpus()[0].model};
 report.provenance={wasm:{a:hash(wasm.a),b:hash(wasm.b)},sources:Object.fromEntries(['tools/ai-gnn/browser-match.mjs',...(playerMode==='offline'?['tools/ai-gnn/offline-player.mjs']:[]),'dist/engine.js','dist/ai-position.js','dist/ai-wasm.js','dist/ai-v3.js','dist/ai-v3-search.js','dist/ai-v3-inference.js'].map(p=>[p,hash(p)]))};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:report.summary,warmInference:report.warmInference}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
