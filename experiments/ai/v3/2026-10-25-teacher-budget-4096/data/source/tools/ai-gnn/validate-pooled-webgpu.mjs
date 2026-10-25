// Run separately after the strength arena; no production asset is changed.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const args=process.argv.slice(2),at=args.indexOf('--output'),output=at>=0?args[at+1]:null;
if(!output)throw Error('Expected --output NEW_FILE');
if(existsSync(output))throw Error('Output already exists: '+output);
const root=resolve('.'),mime={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.f32':'application/octet-stream','.wasm':'application/wasm'};
const allowed=['/tools/ai-gnn/pooled-inference.mjs','/tools/ai-gnn/offline-player.mjs'];
const server=createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Offline inference validation</title>');return;}if(!name.startsWith('/dist/')&&!allowed.includes(name))throw Error('Unsupported path');const path=resolve(root,'.'+name);if(!path.startsWith(root+sep))throw Error('Invalid path');res.setHeader('content-type',mime[extname(path)]??'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});
 const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port;await page.goto(base);
 const worker=async function(base){
  const {createPooledV3Inference}=await import(base+'/tools/ai-gnn/pooled-inference.mjs'),{createV3Inference,adjacencyFor}=await import(base+'/dist/ai-v3-inference.js'),{createV3Search}=await import(base+'/dist/ai-v3-search.js'),{createOfflineAI}=await import(base+'/tools/ai-gnn/offline-player.mjs'),{Game,createTopology}=await import(base+'/dist/engine.js'),{aiPosition}=await import(base+'/dist/ai-position.js');
  const check=(ok,message)=>{if(!ok)throw Error(message);},manifestURL=base+'/dist/models/v3/manifest.json',wasm=await(await fetch(base+'/dist/ai-v3.wasm')).arrayBuffer(),load=async()=>wasm;
  const reference=await createV3Inference({manifestURL,backend:'webgpu'}),pool=await createPooledV3Inference({manifestURL,capacity:64}),encoder=await createV3Search({load});check(reference.backend==='webgpu'&&reference.runtime==='wgsl','Dedicated GPU required');
  const bytesEqual=(a,b)=>{if(a.length!==b.length)return false;const x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(b.buffer,b.byteOffset,b.length);return x.every((v,i)=>v===y[i]);};
  const equalOutputs=(actual,expected,label)=>{for(const k of ['policy','wdl','score','ownership'])check(bytesEqual(actual[k],expected[k]),label+' '+k+' not bit-identical');};
  const pack=(roots,count,start)=>({count,x:Float32Array.from({length:count*5120},(_,i)=>roots[(start+Math.floor(i/5120))%roots.length].x[i%5120]),mask:Float32Array.from({length:count*160},(_,i)=>roots[(start+Math.floor(i/160))%roots.length].mask[i%160]),global_features:Float32Array.from({length:count*8},(_,i)=>roots[(start+Math.floor(i/8))%roots.length].global_features[i%8])});
  const rows=[];
  try{
   for(const[kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
    const topology=createTopology(kind,size),adjacency=adjacencyFor(topology),game=new Game(topology,6.5),roots=[];
    for(let i=0;i<8;i++){encoder.start(aiPosition(game));const leaf=encoder.collect(1);roots.push({x:leaf.x.slice(),mask:leaf.mask.slice(),global_features:leaf.global_features.slice()});encoder.cancel();const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);check(game.play(legal[(i*17+3)%legal.length]).ok,'Setup illegal');}
    for(const counts of [[1,2,3,4,5,6,7,8],Array(8).fill(8)]){
     const requests=counts.map((n,i)=>pack(roots,n,i)),expected=[];
     for(const r of requests)expected.push(await reference.evaluate(r,adjacency,{auxiliary:true}));
     const clients=requests.map(()=>pool.createClient());
     try{const actual=await Promise.all(clients.map((c,i)=>c.evaluate(requests[i],adjacency.slice(),{auxiliary:true})));actual.forEach((r,i)=>equalOutputs(r,expected[i],kind+size+' batch'+counts[i]));}finally{await Promise.all(clients.map(c=>c.dispose()));}
    }
    // Full search uses exactly the same per-client collect/backup sequence at65 visits.
    const positions=[aiPosition(game),aiPosition(new Game(topology,6.5))],expected=[];
    const ordinary=await createOfflineAI({createSearch:()=>createV3Search({load}),createInference:async()=>({manifest:reference.manifest,backend:reference.backend,batchSize:8,evaluate:(...args)=>reference.evaluate(...args),async dispose(){}})});
    try{for(const position of positions)expected.push(await ordinary.chooseMove(position,{seed:18,maxSimulations:65,diagnostics:true}));}finally{await ordinary.dispose();}
    const players=await Promise.all(positions.map(()=>createOfflineAI({createSearch:()=>createV3Search({load}),createInference:async()=>pool.createClient()})));
    try{
     const actual=await Promise.all(players.map((p,i)=>p.chooseMove(positions[i],{seed:18,maxSimulations:65,diagnostics:true})));
     actual.forEach((r,i)=>{check(r.move===expected[i].move&&r.simulations===65,'Search move/budget mismatch');check(bytesEqual(r.policy,expected[i].policy),'Search policy mismatch');check(JSON.stringify(r.diagnostics)===JSON.stringify(expected[i].diagnostics),'Search diagnostics mismatch');});
    }finally{await Promise.all(players.map(p=>p.dispose()));}
    rows.push({board:kind+size,independentBatch1To8BitIdentical:true,full64PositionBatchBitIdentical:true,twoSearches65VisitsBitIdentical:true});
   }
   return{schemaVersion:1,rows,stats:pool.stats,allBitIdentical:true};
  }finally{encoder.dispose();await pool.dispose();await reference.dispose();}
 };
 const report=await page.evaluate(async({base,source})=>await new Promise((resolve,reject)=>{const blob=new Blob(['self.onmessage=async e=>{try{self.postMessage({ok:true,result:await('+source+')(e.data)});}catch(error){self.postMessage({ok:false,error:error.stack});}};'],{type:'text/javascript'}),url=URL.createObjectURL(blob),w=new Worker(url);URL.revokeObjectURL(url);w.onmessage=e=>{w.terminate();e.data.ok?resolve(e.data.result):reject(Error(e.data.error));};w.onerror=e=>{w.terminate();reject(Error(e.message));};w.postMessage(base);}),{base,source:worker.toString()});
 assert.equal(report.allBitIdentical,true);report.environment={browser:browser.version(),node:process.version};report.sources=Object.fromEntries(['tools/ai-gnn/validate-pooled-webgpu.mjs','tools/ai-gnn/pooled-inference.mjs','tools/ai-gnn/offline-player.mjs','dist/ai-v3-webgpu.js','dist/ai-v3-inference.js','dist/ai-v3.wasm'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
