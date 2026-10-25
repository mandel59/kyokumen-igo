// Compare two search binaries on identical roots, seeds and fixed visit budgets.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const output=arg('--output'),paths={a:arg('--a-wasm'),b:arg('--b-wasm')};
const repeats=Number(arg('--repeats','7')),warmups=Number(arg('--warmups','2')),visits=Number(arg('--simulations','64'));
if(!output||!paths.a||!paths.b||existsSync(output)||!Number.isInteger(repeats)||repeats<3||!Number.isInteger(warmups)||warmups<1||!Number.isInteger(visits)||visits<2)throw Error('Expected fresh --output, --a-wasm, --b-wasm and valid repeat/visit counts');
const modelPaths={a:resolve(arg('--a-model','dist/models/v3')),b:resolve(arg('--b-model','dist/models/v3'))};
const root=resolve('.'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const binaries=Object.fromEntries(Object.entries(paths).map(([k,p])=>['/'+k+'.wasm',readFileSync(p)]));
const mime={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.onnx':'application/octet-stream','.f32':'application/octet-stream'};
const server=createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Fixed-root search comparison</title>');return;}
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(binaries[name]){res.setHeader('content-type','application/wasm');res.end(binaries[name]);return;}
  if(/^\/models\/[ab]\//.test(name)){
   const side=name[8],base=modelPaths[side],file=resolve(base,name.slice(10));
   if(!file.startsWith(base+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
   res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(readFileSync(file));return;
  }
  const file=resolve(root,'.'+name);
  if(!name.startsWith('/dist/')||!file.startsWith(root+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
 }catch{res.writeHead(400);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});
const report={schemaVersion:1,visits,repeats,warmups,seed:2026102535,condition:'Same 18 roots and seeds; paired alternating player order in one isolated Worker per backend. Includes history restore/search/inference/cancellation yields, excludes initialization and rendering.',wasm:Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(p)])),models:Object.fromEntries(Object.entries(modelPaths).map(([k,p])=>[k,JSON.parse(readFileSync(p+'/manifest.json')).sha256])),fixture:hash('dist/ai-benchmark-positions.json'),environment:{browser:browser.version(),cpu:cpus()[0].model,node:process.version},runs:[]};
try{
 const page=await browser.newPage();await page.goto(base);
 for(const backend of ['wasm','webgpu']){
  const run=await page.evaluate(async config=>{
   const execute=async({base,backend,repeats,warmups,visits,seed})=>{
    const {createV3AI}=await import(base+'/dist/ai-v3.js');
    const positions=(await(await fetch(base+'/dist/ai-benchmark-positions.json')).json()).positions,players={};
    for(const side of ['a','b'])players[side]=await createV3AI({backend,manifestURL:base+'/models/'+side+'/manifest.json',load:async()=>await(await fetch(base+'/'+side+'.wasm')).arrayBuffer()});
    const results=[];
    try{
     for(const p of positions){
      const position={kind:p.kind,size:p.size,komi:p.komi,moves:Int32Array.from(p.moves)};
      for(let k=0;k<warmups;k++)for(const side of k%2?['b','a']:['a','b'])await players[side].chooseMove(position,{seed:seed+k,maxSimulations:visits});
      const row={board:p.kind+p.size,phase:p.phase,a:[],b:[]};
      for(let k=0;k<repeats;k++)for(const side of k%2?['b','a']:['a','b']){
       const start=performance.now(),r=await players[side].chooseMove(position,{seed:seed+k,maxSimulations:visits});
       if(r.backend!=='v3-'+backend||(!r.provenLoss&&r.simulations!==visits))throw Error('Unexpected backend or visit count');
       row[side].push({ms:performance.now()-start,batches:r.batches,simulations:r.simulations,provenLoss:r.provenLoss,move:r.move});
      }
      results.push(row);
     }
    }finally{for(const p of Object.values(players))await p.dispose();}
    return {backend,results};
   };
   return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob(['onmessage=async({data})=>{try{postMessage({result:await ('+execute.toString()+')(data)});}catch(e){postMessage({error:e.stack});}}'],{type:'text/javascript'}));
    const worker=new Worker(url,{type:'module'});URL.revokeObjectURL(url);
    worker.onmessage=({data})=>{worker.terminate();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage(config);
   });
  },{base,backend,repeats,warmups,visits,seed:report.seed});
  report.runs.push(run);writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Completed',backend,'fixed roots');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
const p95=a=>a.slice().sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1];
function statistics(rows,side){const samples=rows.flatMap(r=>r[side]);return {samples:samples.length,p95Ms:p95(samples.map(s=>s.ms)),meanMs:samples.reduce((s,r)=>s+r.ms,0)/samples.length,meanBatches:samples.reduce((s,r)=>s+r.batches,0)/samples.length,maxBatches:Math.max(...samples.map(s=>s.batches))};}
report.summary=report.runs.map(run=>{
 const a=statistics(run.results,'a'),b=statistics(run.results,'b');
 const boards=Array.from(new Set(run.results.map(r=>r.board))).map(board=>{const rows=run.results.filter(r=>r.board===board),a=statistics(rows,'a'),b=statistics(rows,'b');return {board,a,b,p95Ratio:a.p95Ms/b.p95Ms};});
 return {backend:run.backend,a,b,p95Ratio:a.p95Ms/b.p95Ms,boards,passes:a.p95Ms/b.p95Ms<=1.05&&boards.every(b=>b.p95Ratio<=1.10)};
});
report.passes=report.summary.every(s=>s.passes);writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
