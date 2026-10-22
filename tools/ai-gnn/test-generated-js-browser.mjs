// Real application fallbacks plus a same-input, depth-4 WASM/JS latency comparison.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const root=resolve('dist');let mode='normal',requests=[];
const server=createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 requests.push(name);
 const send=()=>{try{
  if(name==='/ai-engine.wasm'&&mode==='missing'){res.writeHead(404);res.end();return;}
  if(name==='/ai-engine.wasm'&&mode==='corrupt'){res.end('corrupt');return;}
  if(name==='/ai-engine.generated.js'&&mode==='generated-failure'){res.writeHead(404);res.end();return;}
  const path=resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!path.startsWith(root+sep))throw new Error('Invalid path');
  res.setHeader('content-type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream');
  const file=readFileSync(path);
  if(name==='/ai-worker.js'&&mode==='unsupported')res.end('globalThis.WebAssembly=undefined;\n'+file);
  else if(name==='/ai-worker.js'&&mode==='worker-error')res.end('throw new Error("Worker initialization failed");');
  else res.end(file);
 }catch{res.writeHead(404);res.end();}};
 if(name==='/ai-engine.generated.js'&&mode==='cancel-load')setTimeout(send,300);else send();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run']});
const scenarios=[];
try{
 for(const scenario of['normal','missing','corrupt','unsupported','no-worker','worker-error','generated-failure','cancel-load']){
  mode=scenario;requests=[];
  const context=await browser.newContext();
  await context.addInitScript(mode=>{
   globalThis.workerReplies=[];
   if(['no-worker','generated-failure','cancel-load'].includes(mode))globalThis.Worker=undefined;
   else{
    const NativeWorker=Worker;
    globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',e=>workerReplies.push(e.data));}};
   }
  },mode);
  const page=await context.newPage();await page.goto(base);
  const loading=mode==='cancel-load'?page.waitForRequest('**/ai-engine.generated.js'):null;
  await page.locator('#board').press('Enter');
  if(mode==='generated-failure'){
   await page.waitForFunction(()=>document.getElementById('status').textContent.includes('AIを実行できませんでした'));
   assert.equal(await page.locator('#moveCount').textContent(),'1 手');
  }else if(mode==='cancel-load'){
   // The generated module is still loading when undo cancels this turn.
   await loading;await page.locator('#undo').click();await page.waitForTimeout(500);
   assert.equal(await page.locator('#moveCount').textContent(),'0 手');
   await page.locator('#board').press('Enter');await page.waitForFunction(()=>document.getElementById('moveCount').textContent==='2 手');
  }else await page.waitForFunction(()=>document.getElementById('moveCount').textContent==='2 手');
  const replies=await page.evaluate(()=>workerReplies),generatedLoads=requests.filter(x=>x==='/ai-engine.generated.js').length;
  if(mode==='normal'){assert.equal(generatedLoads,0,'Normal WASM games must not download generated JS');assert.equal(replies[0].backend,'wasm');}
  else assert.equal(generatedLoads,1,'Generated module is fetched lazily and reused');
  if(['missing','corrupt','unsupported'].includes(mode))assert.equal(replies[0].backend,'generated-js');
  if(mode==='unsupported'||mode==='no-worker')assert.equal(requests.filter(x=>x==='/ai-engine.wasm').length,0);
  assert.equal(requests.some(x=>x.includes('legacy-v1')),false);
  scenarios.push({mode,generatedLoads,backend:replies[0]?.backend??'main-thread-generated-js'});
  await context.close();
 }
 mode='normal';
 const page=await browser.newPage();await page.goto(base);
 const performanceReport=await page.evaluate(async()=>{
  const {createWasmAI}=await import('./ai-wasm.js'),{createJSAI}=await import('./ai-js.js');
  let start=performance.now();const wasm=await createWasmAI(),wasmInitMs=performance.now()-start;
  start=performance.now();const js=await createJSAI(),jsInitMs=performance.now()-start;
  const positions=(await(await fetch('./ai-benchmark-positions.json')).json()).positions;
  const players={wasm,js},samples={wasm:[],js:[]};
  try{
   for(const p of positions)for(const player of Object.values(players))player.chooseMove(p,{depth:4,seed:42});
   for(let round=0;round<3;round++)for(const p of positions){
    const chosen={};
    for(const side of round%2?['js','wasm']:['wasm','js']){
     const begin=performance.now();chosen[side]=players[side].chooseMove(p,{depth:4,seed:42});
     samples[side].push({board:p.kind+p.size,phase:p.phase,elapsedMs:performance.now()-begin});
    }
    if(chosen.wasm!==chosen.js)throw new Error('Browser parity mismatch');
   }
  }finally{wasm.dispose();js.dispose();}
  const summary=Object.fromEntries(Object.entries(samples).map(([side,xs])=>{
   const times=xs.map(x=>x.elapsedMs).sort((a,b)=>a-b);return[side,{samples:xs.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.ceil(times.length*.95)-1]}];
  }));
  return{wasmInitMs,jsInitMs,depth:4,positions:18,rounds:3,summary,samples};
 });
 const sizes=Object.fromEntries(['ai-engine.wasm','ai-engine.generated.js'].map(name=>{const bytes=readFileSync(root+'/'+name);return[name,{bytes:bytes.length,gzipBytes:gzipSync(bytes).length,sha256:createHash('sha256').update(bytes).digest('hex')}];}));
 const report={schemaVersion:1,environment:{browser:browser.version(),cpu:cpus()[0].model},scenarios,sizes,performance:performanceReport};
 writeFileSync('tools/ai-gnn/target/generated-js-browser.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({scenarios,sizes,timing:performanceReport.summary},null,2));
 console.log('Real browser: normal WASM lazy-loading, missing/corrupt/unsupported WASM, unavailable/failed Worker, failed JS load and cancellation during loading passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
