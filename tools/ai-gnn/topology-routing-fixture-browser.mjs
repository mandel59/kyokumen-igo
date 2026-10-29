// Diagnose the public L6 fixture through the actual browser router; no timing claims.
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
const report={schemaVersion:1,role:'Public L6 fixture only; no training, selection, strength or latency use. Independent matches may be running concurrently.',fixture:hash(positionPath),models:Object.fromEntries(Object.entries(modelPaths).map(([k,p])=>[k,JSON.parse(readFileSync(p+'/manifest.json')).sha256])),environment:{browser:browser.version(),cpu:cpus()[0].model,node:process.version},runs:[]};
try{
 const page=await browser.newPage();await page.goto(base);
 for(const backend of ['wasm','webgpu']){
  const result=await page.evaluate(async config=>{
   const execute=async({base,backend})=>{
    const{createV3AI}=await import(base+'/dist/ai-v3.js');
    const p=(await(await fetch(base+'/dist/ai-benchmark-positions.json')).json()).positions[0],position={kind:p.kind,size:p.size,komi:p.komi,moves:Int32Array.from(p.moves)},rows=[];
    for(const side of['a','b']){
     const player=await createV3AI({backend,manifestURL:base+'/models/'+side+'/manifest.json',load:async()=>await(await fetch(base+'/'+side+'.wasm')).arrayBuffer()});
     try{for(let seed=0;seed<4;seed++){
      const r=await player.chooseMove(position,{seed,maxSimulations:64});
      if(r.backend!=='v3-'+backend||r.simulations!==64)throw Error('Wrong backend or visits');
      rows.push({side,seed,move:r.move,backend:r.backend,simulations:r.simulations,modelSha256:r.modelSha256??null});
     }}finally{await player.dispose();}
    }
    return rows;
   };
   return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob(['onmessage=async({data})=>{try{postMessage({result:await ('+execute.toString()+')(data)});}catch(e){postMessage({error:e.stack});}}'],{type:'text/javascript'}));
    const worker=new Worker(url,{type:'module'});URL.revokeObjectURL(url);
    worker.onmessage=({data})=>{worker.terminate();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage(config);
   });
  },{base,backend});
  report.runs.push({backend,rows:result});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
const expected=JSON.parse(readFileSync(modelPaths.a+'/manifest.json')).modelRoutes.plane.sha256;
report.allCandidateSelectL6=report.runs.every(r=>r.rows.filter(t=>t.side==='a').every(t=>t.move===115&&t.modelSha256===expected));
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({allCandidateSelectL6:report.allCandidateSelectL6,runs:report.runs}));
