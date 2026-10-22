import {createServer} from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const assets=fileURLToPath(new URL('../../dist/',import.meta.url));
const pages=new Set(['ai-benchmark.html','ai-benchmark-page.js','ai-benchmark-worker.js','ai-benchmark.js','ai-benchmark-positions.json',
 'engine.js','board-analysis.js','ai-position.js','ai-v3.js','ai-v3-search.js','ai-v3-inference.js','ai-v3-webgpu.js','ai-v3.wasm',
 'models/v3/manifest.json','models/v3/model.onnx','models/v3/weights.f32','third-party.html','third-party-catalog.json']);
export const benchmarkAssets=pages;
export function createDeviceBenchmarkServer(){
 return createServer((request,response)=>{
  try{
   let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname).slice(1);if(!name)name='ai-benchmark.html';
   const path=resolve(assets,name);
   const noticeOrRuntime=['vendor/onnxruntime','licenses'].some(dir=>name.startsWith(dir+'/')&&path.startsWith(resolve(assets,dir)+sep));
   if(!path.startsWith(resolve(assets)+sep)||!(pages.has(name)||noticeOrRuntime)||!statSync(path).isFile()){response.writeHead(404);response.end();return;}
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm'};
   response.setHeader('content-type',mime[extname(path)]??'application/octet-stream');response.setHeader('cache-control','no-store');response.end(readFileSync(path));
  }catch{response.writeHead(404);response.end();}
 });
}
