import {createServer} from 'node:http';
import {readFileSync,existsSync,createWriteStream,writeFileSync,createReadStream} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {createGzip,createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import {chromium} from 'playwright-core';
export const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function options(){const a=process.argv.slice(2);return(k,d)=>a.includes(k)?a[a.indexOf(k)+1]:d;}
export function newOutputs(paths){if(paths.some(p=>!p||existsSync(p)))throw Error('Expected new output paths: '+paths.join(', '));}
export async function readRows(path){const stream=createReadStream(path),input=path.endsWith('.gz')?stream.pipe(createGunzip()):stream,rows=[];for await(const line of createInterface({input,crlfDelay:Infinity}))if(line)rows.push(JSON.parse(line));return rows;}
export function rowWriter(path){
 const file=createWriteStream(path,{flags:'wx'}),gzip=createGzip({level:6}),completion=finished(file);completion.catch(()=>{});gzip.on('error',error=>file.destroy(error));gzip.pipe(file);let error;file.on('error',e=>{error=e;gzip.destroy(e);});
 return{async write(rows){if(error)throw error;for(const row of rows){if(error)throw error;if(!gzip.write(JSON.stringify(row)+'\n'))await once(gzip,'drain');}},async close(){gzip.end();await completion;}};
}
export async function runDataWorker({model,wasms,config,onEvent}){
 const root=resolve('.'),modelRoot=resolve(model),modules=new Set(['browser-data-worker.mjs','selfplay-records.mjs','training-search.mjs','selfplay-policy.mjs','pooled-inference.mjs'].map(p=>'/tools/ai-gnn/'+p)),mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.f32':'application/octet-stream','.onnx':'application/octet-stream'};
 const server=createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Offline teacher data study</title>');return;}let file;
  if(name.startsWith('/model/')){file=resolve(modelRoot,name.slice(7));if(!file.startsWith(modelRoot+sep))throw Error('Model path');}
  else if(name.startsWith('/study-wasm/')){const key=name.slice(12);if(!Object.hasOwn(wasms,key))throw Error('WASM key');file=resolve(wasms[key]);}
  else{if(!name.startsWith('/dist/')&&!modules.has(name))throw Error('Module path');file=resolve(root,'.'+name);const allowedRoot=name.startsWith('/dist/')?resolve(root,'dist'):root;if(!file.startsWith(allowedRoot+sep))throw Error('Asset path');}
  res.setHeader('content-type',name.startsWith('/study-wasm/')?'application/wasm':mime[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port;await page.goto(base);await page.exposeFunction('dataEvent',event=>onEvent(event));
  const report=await page.evaluate(async({base,config})=>await new Promise((resolve,reject)=>{
   const worker=new Worker(base+'/tools/ai-gnn/browser-data-worker.mjs',{type:'module'});let pending=Promise.resolve();
   worker.onmessage=e=>{const message=e.data;if(message.kind==='event'){pending=pending.then(()=>window.dataEvent(message.event)).then(()=>worker.postMessage({ack:message.id}));pending.catch(error=>{worker.terminate();reject(error);});}else if(message.kind==='done'){worker.terminate();pending.then(()=>resolve(message.report),reject);}else{worker.terminate();reject(Error(message.error));}};
   worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage({config:{...config,base,manifestURL:base+'/model/manifest.json'}});
  }),{base,config});
  const sources=['tools/ai-gnn/browser-data-host.mjs',...Array.from(modules,p=>p.slice(1)),'dist/engine.js','dist/ai-position.js','dist/ai-v3-search.js','dist/ai-v3-inference.js','dist/ai-v3-webgpu.js'];
  return{...report,environment:{browser:browser.version(),node:process.version},provenance:{sources:Object.fromEntries(sources.map(p=>[p,hash(p)])),wasms:Object.fromEntries(Object.entries(wasms).map(([k,p])=>[k,hash(p)])),modelFiles:Object.fromEntries(['manifest.json','model.onnx','weights.f32'].map(p=>[p,hash(modelRoot+'/'+p)]))}};
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
export function saveReport(path,report){writeFileSync(path,JSON.stringify(report,null,2)+'\n');}
