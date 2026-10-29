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
const positionPath=arg('--positions','dist/ai-benchmark-positions.json'),positionBytes=readFileSync(positionPath);
const root=resolve('.'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const binaries=Object.fromEntries(Object.entries(paths).map(([k,p])=>['/'+k+'.wasm',readFileSync(p)]));
const mime={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.onnx':'application/octet-stream','.f32':'application/octet-stream'};
const server=createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Fixed-root search comparison</title>');return;}
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(name==='/dist/ai-benchmark-positions.json'){res.setHeader('content-type','application/json');res.end(positionBytes);return;}
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
const report={schemaVersion:1,repeats:5,seed:2026102924,condition:'Fresh isolated Worker for each side and repeat. Alternate A/B order. Constructor/default curve load plus first plane turn; then curve->plane->curve. Fixed64 visits, same frozen quarter roots.',wasm:Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(p)])),models:Object.fromEntries(Object.entries(modelPaths).map(([k,p])=>[k,JSON.parse(readFileSync(p+'/manifest.json')).sha256])),fixture:hash(positionPath),environment:{browser:browser.version(),cpu:cpus()[0].model,node:process.version},runs:[]};
try{
 const page=await browser.newPage();await page.goto(base);
 for(const backend of ['wasm','webgpu']){
  const rows=[];
  for(let repeat=0;repeat<5;repeat++)for(const side of repeat%2?['b','a']:['a','b']){
   const row=await page.evaluate(async config=>{
    const execute=async({base,backend,side,seed})=>{
     const{createV3AI}=await import(base+'/dist/ai-v3.js');
     const fixtures=(await(await fetch(base+'/dist/ai-benchmark-positions.json')).json()).positions;
     const position=kind=>{const p=fixtures.find(p=>p.kind===kind&&p.size===7&&p.phase==='ordinary-quarter');if(!p)throw Error('Missing frozen cold fixture');return{kind:p.kind,size:p.size,komi:p.komi,moves:Int32Array.from(p.moves)};};
     const started=performance.now();
     const player=await createV3AI({backend,manifestURL:base+'/models/'+side+'/manifest.json',load:async()=>await(await fetch(base+'/'+side+'.wasm')).arrayBuffer()});
     const initializedMs=performance.now()-started,turns=[];
     try{
      for(const kind of['plane','torus','plane','torus']){
       const before=performance.now(),r=await player.chooseMove(position(kind),{seed,maxSimulations:64});
       if(r.backend!=='v3-'+backend||(!r.provenLoss&&r.simulations!==64))throw Error('Unexpected backend or budget');
       turns.push({kind,ms:performance.now()-before,simulations:r.simulations,move:r.move,modelSha256:r.modelSha256??null});
      }
      return{initializedMs,coldFirstPlaneMs:initializedMs+turns[0].ms,turns};
     }finally{await player.dispose();}
    };
    return new Promise((resolve,reject)=>{
     const url=URL.createObjectURL(new Blob(['onmessage=async({data})=>{try{postMessage({result:await ('+execute.toString()+')(data)});}catch(e){postMessage({error:e.stack});}}'],{type:'text/javascript'}));
     const worker=new Worker(url,{type:'module'});URL.revokeObjectURL(url);
     worker.onmessage=({data})=>{worker.terminate();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage(config);
    });
   },{base,backend,side,seed:report.seed+repeat});
   rows.push({repeat,side,...row});
  }
  report.runs.push({backend,rows});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Completed',backend,'cold/switch');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
const p95=a=>a.slice().sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1];
report.summary=report.runs.map(run=>{
 const metrics=[{name:'initial-default-plus-first-plane',get:r=>r.coldFirstPlaneMs},...[1,2,3].map(i=>({name:['','plane-to-curve','curve-to-plane','plane-to-curve-again'][i],get:r=>r.turns[i].ms}))];
 const results=metrics.map(m=>{const a=p95(run.rows.filter(r=>r.side==='a').map(m.get)),b=p95(run.rows.filter(r=>r.side==='b').map(m.get)),limitMs=Math.max(1.5*b,b+250);return{name:m.name,aP95Ms:a,bP95Ms:b,limitMs,passes:a<=limitMs};});
 return{backend:run.backend,metrics:results,passes:results.every(r=>r.passes)};
});
report.passes=report.summary.every(r=>r.passes);writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
