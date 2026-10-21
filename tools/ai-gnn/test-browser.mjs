// Real Edge + Worker + ONNX WebGPU test. No external server or browser profile required.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const root=fileURLToPath(new URL('../../',import.meta.url));
const golden=readFileSync(new URL('../../tests/fixtures/ai/v3-golden.json',import.meta.url));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.html':'text/html','.css':'text/css','.onnx':'application/octet-stream'};
const server=createServer((req,res)=>{
 try{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Kyokugo v3 verification</title>');return;}
  if(name==='/golden.json'){res.setHeader('content-type','application/json');res.end(golden);return;}
  if(name==='/endgame.json'){res.setHeader('content-type','application/json');res.end(readFileSync(new URL('../../tests/fixtures/ai/v3-endgame.json',import.meta.url)));return;}
  if(name==='/dist/models/v3/bad-gpu-manifest.json'){
   const manifest=JSON.parse(readFileSync(new URL('../../dist/models/v3/manifest.json',import.meta.url)));
   manifest.webgpu.sha256='0'.repeat(64);res.setHeader('content-type','application/json');res.end(JSON.stringify(manifest));return;
  }
  const path=resolve(root,'.'+decodeURIComponent(name));
  if(!name.startsWith('/dist/')||!path.startsWith(root.endsWith(sep)?root:root+sep)||!existsSync(path)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',mime[extname(path)]??'application/octet-stream');res.end(readFileSync(path));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});
try{
 const page=await browser.newPage();page.on('console',message=>{if(['error','warning'].includes(message.type()))console.error(message.text());});
 await page.goto(base);
 const result=await page.evaluate(async(base)=>{
  const run=async function({base,backend}){
   const {createV3Inference}=await import(base+'/dist/ai-v3-inference.js');
   const {createV3AI}=await import(base+'/dist/ai-v3.js');
   const {Game,createTopology}=await import(base+'/dist/engine.js');
   const {decodeRecord}=await import(base+'/dist/record.js');
   const {aiPosition}=await import(base+'/dist/ai-position.js');
   const golden=await(await fetch(base+'/golden.json')).json();
   const input=Object.fromEntries(Object.entries(golden.inputs).map(([k,v])=>[k,Float32Array.from(v.data)]));
   const begin=performance.now();
   const ai=await createV3Inference({manifestURL:base+'/dist/models/v3/manifest.json',backend});
   const output=await ai.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency,{auxiliary:true});
   const differences={};
   for(const [key,target]of Object.entries(golden.outputs)){
    if(output[key].length!==target.data.length)throw new Error('Output shape '+key);
    differences[key]=Math.max(...output[key].map((v,i)=>Math.abs(v-target.data[i])));
   }
   const coldMs=performance.now()-begin;
   const times=[];for(let k=0;k<5;k++){
    const start=performance.now();await ai.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency);times.push(performance.now()-start);
   }
   const selected=ai.backend,runtime=ai.runtime;
   // Exercise changing real batch counts and data after buffer reuse, not just repeated inputs.
   const widths={policy:161,wdl:3,score:1,ownership:480},batchParity=[];
   for(const count of [8,1,4,8]){
    const request={count};
    for(const [key,width]of [['x',160*32],['mask',160],['global_features',8]]){
     request[key]=new Float32Array(count*width);
     for(let b=0;b<count;b++)request[key].set(input[key].subarray((b%2)*width,(b%2+1)*width),b*width);
    }
    const result=await ai.evaluate(request,input.adjacency,{auxiliary:true});let max=0;
    for(const [key,width]of Object.entries(widths))for(let b=0;b<count;b++)for(let j=0;j<width;j++)max=Math.max(max,Math.abs(result[key][b*width+j]-golden.outputs[key].data[(b%2)*width+j]));
    if(max>2e-4)throw new Error('Real batch '+count+' changed outputs: '+max);batchParity.push({count,maxError:max});
   }
   // The specialized kernels must preserve graph permutation equivariance, including padding.
   const permutation=Array.from({length:160},(_,p)=>(p*37+13)%160),permuted={count:1,global_features:input.global_features.slice(0,8),x:new Float32Array(160*32),mask:new Float32Array(160)};
   const permutedAdjacency=new Float32Array(160*160);
   for(let p=0;p<160;p++){
    permuted.x.set(input.x.subarray(permutation[p]*32,(permutation[p]+1)*32),p*32);permuted.mask[p]=input.mask[permutation[p]];
    for(let q=0;q<160;q++)permutedAdjacency[p*160+q]=input.adjacency[permutation[p]*160+permutation[q]];
   }
   const permutedOutput=await ai.evaluate(permuted,permutedAdjacency,{auxiliary:true});let permutationError=0;
   for(const [key,width]of Object.entries(widths))for(let i=0;i<width;i++){
    const source=key==='policy'&&i<160?permutation[i]:key==='ownership'?permutation[Math.floor(i/3)]*3+i%3:i;
    permutationError=Math.max(permutationError,Math.abs(permutedOutput[key][i]-golden.outputs[key].data[source]));
   }
   if(permutationError>2e-4)throw new Error('Graph permutation changed outputs: '+permutationError);
   const waitingEvaluation=ai.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency);let concurrentRejected=false;
   try{await ai.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency);}catch(error){concurrentRejected=/already running/.test(error.message);}
   await waitingEvaluation;if(!concurrentRejected)throw new Error('Concurrent inference was not rejected');
   await ai.dispose();
   const capacityParity=[];
   if(backend==='webgpu')for(const batchSize of [1,4]){
    const small=await createV3Inference({manifestURL:base+'/dist/models/v3/manifest.json',backend,batchSize}),request={count:batchSize};
    for(const [key,width]of [['x',160*32],['mask',160],['global_features',8]]){
     request[key]=new Float32Array(batchSize*width);for(let b=0;b<batchSize;b++)request[key].set(input[key].subarray((b%2)*width,(b%2+1)*width),b*width);
    }
    const result=await small.evaluate(request,input.adjacency,{auxiliary:true});let error=0;
    for(const [key,width]of Object.entries(widths))for(let b=0;b<batchSize;b++)for(let j=0;j<width;j++)error=Math.max(error,Math.abs(result[key][b*width+j]-golden.outputs[key].data[(b%2)*width+j]));
    if(small.runtime!=='wgsl'||error>2e-4)throw new Error('GPU capacity '+batchSize+' failed: '+error);capacityParity.push({batchSize,maxError:error});await small.dispose();
   }
   let gpuChecksumFallback=false,gpuExecutionFallback=false;
   if(backend==='webgpu'){
    const fallback=await createV3Inference({manifestURL:base+'/dist/models/v3/bad-gpu-manifest.json',backend});
    const result=await fallback.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency);
    const error=Math.max(...result.policy.map((v,i)=>Math.abs(v-golden.outputs.policy.data[i])));
    gpuChecksumFallback=fallback.backend==='webgpu'&&fallback.runtime==='asyncify'&&error<2e-4;
    await fallback.dispose();if(!gpuChecksumFallback)throw new Error('Corrupt GPU sidecar did not fall back to the verified ONNX model');
    const unusual=input.adjacency.slice();
    const row=Array.from({length:160},(_,p)=>p).find(p=>unusual.subarray(p*160,(p+1)*160).filter(Boolean).length===4);
    const extra=Array.from({length:160},(_,q)=>q).find(q=>unusual[row*160+q]===0);unusual[row*160+extra]=.1;
    const native=await createV3Inference({manifestURL:base+'/dist/models/v3/manifest.json',backend});
    await native.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency);
    const actual=await native.evaluate({count:golden.inputs.x.shape[0],...input},unusual);
    const reference=await createV3Inference({manifestURL:base+'/dist/models/v3/manifest.json',backend:'wasm'});
    const expected=await reference.evaluate({count:golden.inputs.x.shape[0],...input},unusual);
    const max=Math.max(...actual.policy.map((v,i)=>Math.abs(v-expected.policy[i])),...actual.wdl.map((v,i)=>Math.abs(v-expected.wdl[i])));
    gpuExecutionFallback=native.runtime==='asyncify'&&native.backend==='webgpu'&&max<2e-4;
    await native.dispose();await reference.dispose();if(!gpuExecutionFallback)throw new Error('Unsupported graph did not switch from dedicated GPU to ONNX');
   }
   const player=await createV3AI({manifestURL:base+'/dist/models/v3/manifest.json',backend});
   const turns=[];
   for(const [kind,size] of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
    const position={kind,size,komi:6.5,moves:new Int32Array()};
    const chosen=await player.chooseMove(position,{budgetMs:100,maxSimulations:128,seed:3});
    const game=new Game(createTopology(kind,size));
    if(chosen.move!==null&&!game.analyze(chosen.move).ok)throw new Error('Illegal neural move');
    turns.push({kind,size,simulations:chosen.simulations,elapsedMs:chosen.elapsedMs,batches:chosen.batches});
   }
   const pocket={kind:'torus',size:7,komi:6.5,moves:Int32Array.from([-1,16,-1,30,-1,22,-1,17,-1,31,-1,18,-1,32,-1,26])};
   const pocketResult=await player.chooseMove(pocket,{budgetMs:100,maxSimulations:64,seed:3});
   if(pocketResult.move===24||pocketResult.avoidedInvasions<1)throw new Error('Doomed pocket invasion was not guarded');
   const holes=new Set([16,17,18,23,24,25,40]);
   const eyeMoves=Array.from({length:49},(_,p)=>p).filter(p=>!holes.has(p)).flatMap(p=>[-1,p]);
   const eyesResult=await player.chooseMove({kind:'torus',size:7,komi:6.5,moves:Int32Array.from(eyeMoves)},{budgetMs:100,maxSimulations:64,seed:3});
   if(eyesResult.move!==null||eyesResult.avoidedInvasions!==6)throw new Error('Pass-alive eye invasions were not guarded');
   const {game:record}=decodeRecord((await(await fetch(base+'/endgame.json')).json()).code);
   const replay=new Game(record.topology,record.komi),endgame=[];
   for(let ply=1;ply<record.history.length;ply++){
    const move=record.history[ply].lastMove;
    if([164,166,168,184,210,228].includes(ply)){
     const result=await player.chooseMove(aiPosition(replay),{budgetMs:100,maxSimulations:64,seed:3});
     if(ply>=166&&(result.move!==null||!result.provenLoss||result.policy[160]!==1))throw new Error('Futile continuation on reported move '+ply);
     if(ply===164&&result.provenLoss)throw new Error('Premature loss certificate');
     endgame.push({ply,move:result.move,provenLoss:result.provenLoss,lossMarginLowerBound:result.lossMarginLowerBound,batches:result.batches,elapsedMs:result.elapsedMs});
    }
    if(!(move===null?replay.pass():replay.play(move)).ok)throw new Error('Invalid reported game');
   }
   const waiting=player.chooseMove({kind:'torus',size:7,komi:6.5,moves:new Int32Array()},{budgetMs:1000});
   player.cancel();let cancelled=false;try{await waiting;}catch(error){cancelled=/cancelled/.test(error.message);}
   if(!cancelled)throw new Error('Cancellation did not reject the stale result');
   await player.dispose();
   const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():null;
   const adapterInfo=adapter?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):null;
   return {selected,runtime,adapterInfo,differences,coldMs,warmBatchMs:times,batchParity,capacityParity,permutationError,concurrentRejected,gpuChecksumFallback,gpuExecutionFallback,turns,cancelled,
    tactics:{pocketAvoided:pocketResult.avoidedInvasions,eyePointsAvoided:eyesResult.avoidedInvasions},endgame};
  };
  const runWorker=backend=>new Promise((resolve,reject)=>{
   const source='self.onmessage=async({data})=>{try{const run='+run.toString()+';self.postMessage({result:await run(data)});}catch(e){self.postMessage({error:e.stack});}}';
   const blob=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
   const worker=new Worker(blob,{type:'module'});
   worker.onmessage=({data})=>{worker.terminate();URL.revokeObjectURL(blob);data.error?reject(new Error(data.error)):resolve(data.result);};
   worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage({base,backend});
  });
  const cpu=await runWorker('wasm'),gpu=await runWorker('webgpu');
  // Verify the actual production Worker switches from v2 to ready v3.
  const worker=new Worker(base+'/dist/ai-worker.js?ai=v3',{type:'module'});
  let production;
  try{
   for(let id=1;id<=60;id++){
    production=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(new Error(e.message));
     worker.postMessage({id,position:{kind:'torus',size:7,komi:6.5,moves:new Int32Array()}});});
    if(production.backend?.startsWith('v3-'))break;
    await new Promise(r=>setTimeout(r,250));
   }
  }finally{worker.terminate();}
  return {cpu,gpu,production};
 },base);
 for(const backend of ['cpu','gpu'])for(const [key,difference]of Object.entries(result[backend].differences))assert.ok(difference<1e-3,backend+' '+key+': '+difference);
 assert.equal(result.cpu.selected,'wasm');assert.equal(result.gpu.selected,'webgpu');
 assert.equal(result.cpu.runtime,'wasm');assert.equal(result.gpu.runtime,'wgsl');assert.equal(result.gpu.gpuChecksumFallback,true);assert.equal(result.gpu.gpuExecutionFallback,true);
 assert.equal(result.production.backend,'v3-webgpu');assert.equal(result.production.error,undefined);
 result.environment={node:process.version,browser:browser.version(),platform:process.platform,arch:process.arch,cpu:cpus()[0].model};
 if(process.argv.includes('--output'))writeFileSync(process.argv[process.argv.indexOf('--output')+1],JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 console.log('Real browser Worker: WebGPU/WASM numerical parity, six-board MCTS, cancellation and production v3 routing passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
