// Browser/Worker comparison against a pinned Git revision, without changing the worktree.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {cpus} from 'node:os';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';

const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const revision=arg('--baseline','a02b26a'),iterations=Number(arg('--iterations','20')),rounds=Number(arg('--rounds','2'));
if(!/^[a-f0-9]{7,40}$/.test(revision)||!Number.isInteger(iterations)||iterations<3||!Number.isInteger(rounds)||rounds<1)throw new Error('Invalid benchmark options');
const root=fileURLToPath(new URL('../../',import.meta.url));
const previous=path=>{const r=spawnSync('git',['show',revision+':'+path],{cwd:root,encoding:'utf8'});if(r.status)throw new Error(r.stderr);return r.stdout;};
const baseline=previous('dist/ai-v3-inference.js'),baselinePlayer=previous('dist/ai-v3.js').replace("'./ai-v3-inference.js'","'./ai-v3-baseline-inference.js'");
const golden=readFileSync(new URL('../../tests/fixtures/ai/v3-golden.json',import.meta.url));
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const native=await createNodeInference('dist/models/v3',{kind:'torus'}),workloads=[];
try{
 for(const [kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const game=new Game(createTopology(kind,size),6.5),adjacency=adjacencyFor(game.topology);
  for(const p of [0,2,5])assert.equal(game.play(p).ok,true);
  const leaves=[];
  for(let b=0;b<8;b++){
   search.start(aiPosition(game));leaves.push(search.collect(1));search.cancel();
   const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);game.play(legal[(b*17+3)%legal.length]);
  }
  const request={count:8};
  for(const key of ['x','mask','global_features'])request[key]=Float32Array.from(leaves.flatMap(l=>Array.from(l[key])));
  const reference=await native.evaluate(request,adjacency,{auxiliary:true});
  workloads.push({kind,size,adjacency:Array.from(adjacency),request:Object.fromEntries(Object.entries(request).map(([k,v])=>[k,k==='count'?v:Array.from(v)])),
   reference:Object.fromEntries(Object.entries(reference).map(([k,v])=>[k,Array.from(v)]))});
 }
}finally{search.dispose();await native.dispose();}
const workloadJSON=JSON.stringify(workloads),mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.onnx':'application/octet-stream'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const special={'/dist/ai-v3-baseline-inference.js':baseline,'/dist/ai-v3-baseline.js':baselinePlayer,'/workloads.json':workloadJSON,'/golden.json':golden};
 if(path==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>v3 inference benchmark</title>');return;}
 if(special[path]){res.setHeader('content-type',path.endsWith('.json')?'application/json':'text/javascript');res.end(special[path]);return;}
 const file=resolve(root,'.'+decodeURIComponent(path));
 if(!path.startsWith('/dist/')||!file.startsWith(root.endsWith(sep)?root:root+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});
const report={schemaVersion:1,baseline:revision,browserVersion:browser.version(),iterations,warmups:5,rounds,model:native.manifest.sha256,
 condition:'Sequential isolated Workers; alternating baseline/optimized order between rounds. Same FP32 weights, batch capacity 8, real leaf counts 1 and 8. Warm inference includes upload and CPU readback. Search uses 300ms budgets.',runs:[]};
try{
 const page=await browser.newPage();await page.goto(base);page.on('console',m=>{if(['warning','error'].includes(m.type()))console.error(m.text());});
 for(const backend of ['wasm','webgpu'])for(let round=0;round<rounds;round++)for(const variant of round%2?['optimized','baseline']:['baseline','optimized']){
  const result=await page.evaluate(async({base,backend,variant,iterations})=>{
   const run=async function({base,backend,variant,iterations}){
    const suffix=variant==='baseline'?'-baseline-inference':'-inference';
    const {createV3Inference}=await import(base+'/dist/ai-v3'+suffix+'.js');
    const workloads=await(await fetch(base+'/workloads.json')).json(),golden=await(await fetch(base+'/golden.json')).json();
    const begin=performance.now(),ai=await createV3Inference({manifestURL:base+'/dist/models/v3/manifest.json',backend});
    const input=Object.fromEntries(Object.entries(golden.inputs).map(([k,v])=>[k,Float32Array.from(v.data)]));
    const output=await ai.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency,{auxiliary:true}),differences={};
    for(const [key,target]of Object.entries(golden.outputs))differences[key]=Math.max(...output[key].map((v,i)=>Math.abs(v-target.data[i])));
    const coldMs=performance.now()-begin,cases=[];
    for(const w of workloads){
     const adjacency=Float32Array.from(w.adjacency);
     for(const count of [1,8]){
      const request={count};for(const [key,width]of [['x',160*32],['mask',160],['global_features',8]])request[key]=Float32Array.from(w.request[key].slice(0,count*width));
      const actual=await ai.evaluate(request,adjacency,{auxiliary:true});let error=0;
      for(const key of Object.keys(actual))error=Math.max(error,...actual[key].map((v,i)=>Math.abs(v-w.reference[key][i])));
      if(error>2e-4)throw new Error('Changed inference output '+w.kind+w.size+' count '+count+': '+error);
      for(let k=0;k<5;k++)await ai.evaluate(request,adjacency);
      const times=[];for(let k=0;k<iterations;k++){const start=performance.now();await ai.evaluate(request,adjacency);times.push(performance.now()-start);}
      cases.push({kind:w.kind,size:w.size,count,maxError:error,times});
     }
    }
    const selected=ai.backend,graphCapture=ai.graphCapture??false,runtime=ai.runtime??'asyncify';await ai.dispose();
    const {createV3AI}=await import(base+'/dist/ai-v3'+(variant==='baseline'?'-baseline':'')+'.js');
    const player=await createV3AI({manifestURL:base+'/dist/models/v3/manifest.json',backend});const turns=[];
    for(const w of workloads)for(let repeat=0;repeat<2;repeat++){
     const result=await player.chooseMove({kind:w.kind,size:w.size,komi:6.5,moves:Int32Array.from([0,2,5])},{budgetMs:300,maxSimulations:4096,seed:3});
     turns.push({kind:w.kind,size:w.size,repeat,simulations:result.simulations,batches:result.batches,elapsedMs:result.elapsedMs});
    }
    await player.dispose();
    const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():null;
    return {selected,runtime,graphCapture,coldMs,differences,cases,turns,adapterInfo:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture}:null};
   };
   return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob(['onmessage=async({data})=>{try{const run='+run.toString()+';postMessage({result:await run(data)});}catch(error){postMessage({error:error.stack});}}'],{type:'text/javascript'}));
    const worker=new Worker(url,{type:'module'});worker.onmessage=({data})=>{worker.terminate();URL.revokeObjectURL(url);data.error?reject(new Error(data.error)):resolve(data.result);};
    worker.onerror=e=>{worker.terminate();URL.revokeObjectURL(url);reject(new Error(e.message));};worker.postMessage({base,backend,variant,iterations});
   });
  },{base,backend,variant,iterations});
  assert.equal(result.selected,backend);assert.ok(Object.values(result.differences).every(e=>e<2e-4));
  if(variant==='optimized'&&backend==='webgpu')assert.equal(result.runtime,'wgsl');
  report.runs.push({backend,round,variant,...result});console.log(backend,'round',round,variant,'runtime',result.runtime,'cases',result.cases.length);
  if(args.includes('--output'))writeFileSync(arg('--output'),JSON.stringify(report,null,2)+'\n');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
const median=a=>{const sorted=[...a].sort((x,y)=>x-y),m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;};
report.summary=[];
for(const backend of ['wasm','webgpu'])for(const count of [1,8]){
 const stats={backend,count};for(const variant of ['baseline','optimized']){
  const runs=report.runs.filter(r=>r.backend===backend&&r.variant===variant);
  stats[variant+'Ms']=median(runs.flatMap(r=>r.cases.filter(c=>c.count===count).flatMap(c=>c.times)));
 }
 stats.speedup=stats.baselineMs/stats.optimizedMs;report.summary.push(stats);
}
report.searchSummary=['wasm','webgpu'].map(backend=>{
 const result={backend};for(const variant of ['baseline','optimized']){
  const turns=report.runs.filter(r=>r.backend===backend&&r.variant===variant).flatMap(r=>r.turns);
  result[variant+'Simulations']=median(turns.map(t=>t.simulations));result[variant+'ElapsedMs']=median(turns.map(t=>t.elapsedMs));
 }result.speedup=result.optimizedSimulations/result.baselineSimulations;return result;
});
report.environment={node:process.version,browser:report.browserVersion,cpu:cpus()[0].model,platform:process.platform};
if(args.includes('--output'))writeFileSync(arg('--output'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({inference:report.summary,search:report.searchSummary},null,2));
