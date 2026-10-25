export function adjacencyFor(topology){
 const a=new Float32Array(160*160);
 if(topology.neighbors.length>160)throw new Error('v3 board too large');
 topology.neighbors.forEach((ns,p)=>ns.forEach(q=>{a[p*160+q]=1/ns.length;}));return a;
}
export function validateManifest(m){
 if(!m||m.architecture!=='v3'||m.featureVersion!==1||m.points!==160||m.channels!==32||m.globals!==8||
  m.hidden!==64||m.blocks!==6||m.status!=='experimental'||!Number.isInteger(m.parameters)||m.parameters<100000||m.parameters>150000||
  !/^[a-f0-9]{64}$/.test(m.sha256)||m.model!=='model.onnx'||!(m.trainPositions>0))throw new Error('Incompatible v3 model manifest');
 if(m.search!==undefined&&(!m.search||typeof m.search!=='object'||!Number.isInteger(m.search.fpu)||m.search.fpu<0||m.search.fpu>2))throw new Error('Invalid v3 search manifest');
}
function validateFeatures(request,adjacency,batchSize){
 const count=request.count;
 if(!Number.isInteger(count)||count<1||count>batchSize||adjacency.length!==160*160||request.x.length!==count*160*32||
  request.mask.length!==count*160||request.global_features.length!==count*8)throw new Error('Invalid v3 features');
}
const runtimeBinaries=new Map();
async function loadRuntimeBinary(variant){
 if(!runtimeBinaries.has(variant))runtimeBinaries.set(variant,(async()=>{
  const suffix=variant==='wasm'?'':'.asyncify';
  const r=await fetch(new URL('./vendor/onnxruntime/ort-wasm-simd-threaded'+suffix+'.wasm.gz',import.meta.url));
  if(!r.ok)throw new Error('v3 inference runtime HTTP '+r.status);
  const bytes=new Uint8Array(await r.arrayBuffer());
  // Also tolerate servers that already decoded a gzip Content-Encoding.
  return bytes[0]===0x1f&&bytes[1]===0x8b
   ?new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes.buffer;
 })().catch(error=>{runtimeBinaries.delete(variant);throw error;}));
 return runtimeBinaries.get(variant);
}
export async function createV3Inference({
 manifestURL=new URL('./models/v3/manifest.json',import.meta.url),backend='auto',batchSize=8,accelerator=true,
 importRuntime=variant=>variant==='wasm'?import('./vendor/onnxruntime/ort.wasm.min.mjs'):import('./vendor/onnxruntime/ort.webgpu.min.mjs'),
}={}) {
 if(!['auto','webgpu','wasm'].includes(backend)||![1,4,8].includes(batchSize))throw new Error('Invalid v3 inference options');
 manifestURL=new URL(manifestURL,import.meta.url);
 const response=await fetch(manifestURL,{cache:'no-cache'});if(!response.ok)throw new Error('v3 model manifest HTTP '+response.status);
 const manifest=await response.json();validateManifest(manifest);
 let selected=backend==='auto'?(globalThis.navigator?.gpu?'webgpu':'wasm'):backend;
 if(accelerator&&selected==='webgpu'&&manifest.webgpu){
  let gpu;
  try{const {createV3WebGPU}=await import('./ai-v3-webgpu.js');gpu=await createV3WebGPU(manifest,manifestURL,batchSize);}
  catch(error){console.warn('v3 dedicated GPU unavailable:',error.message);}
  if(gpu){
   let fallback=null,job=null,disposed=false;
   return {
    manifest,batchSize,get backend(){return fallback?.backend??'webgpu';},get runtime(){return fallback?.runtime??'wgsl';},
    async evaluate(request,adjacency,options){
     if(disposed)throw new Error('v3 inference disposed');if(job)throw new Error('v3 inference already running');validateFeatures(request,adjacency,batchSize);
     job=(async()=>{
      if(fallback)return fallback.evaluate(request,adjacency,options);
      try{
       const result=await gpu.evaluate(request,adjacency,options);
       if(Object.values(result).some(values=>!values.every(Number.isFinite)))throw new Error('Nonfinite v3 inference');return result;
      }catch(error){
       if(disposed)throw error;await gpu.dispose();
       fallback=await createV3Inference({manifestURL,backend,batchSize,accelerator:false,importRuntime});
       return fallback.evaluate(request,adjacency,options);
      }
     })();
     try{return await job;}finally{job=null;}
    },
    async dispose(){if(!disposed){disposed=true;await job?.catch(()=>{});await gpu.dispose();await fallback?.dispose();}}
   };
  }
 }
 const modelURL=new URL(manifest.model,manifestURL);modelURL.searchParams.set('sha256',manifest.sha256);
 const modelResponse=await fetch(modelURL);if(!modelResponse.ok)throw new Error('v3 model HTTP '+modelResponse.status);
 const bytes=new Uint8Array(await modelResponse.arrayBuffer());
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==manifest.sha256)throw new Error('v3 model checksum mismatch');
 const variant=selected==='wasm'?'wasm':'asyncify',ort=await importRuntime(variant);
 ort.env.wasm.wasmPaths=new URL('./vendor/onnxruntime/',import.meta.url).href;
 ort.env.wasm.wasmBinary=await loadRuntimeBinary(variant);
 ort.env.wasm.numThreads=1; // No cross-origin isolation requirement.
 let session,disposed=false,evaluating=false,gpuInputs=null,lastAdjacency=null;
 const storage={x:new Float32Array(batchSize*160*32),mask:new Float32Array(batchSize*160),global_features:new Float32Array(batchSize*8)};
 function releaseGPU(){
  if(gpuInputs){for(const t of Object.values(gpuInputs.feeds))t.dispose();for(const b of gpuInputs.buffers)b.destroy();gpuInputs=null;}
  lastAdjacency=null;
 }
 function gpuFeeds(adjacency){
  const device=ort.env.webgpu.device;
  if(!gpuInputs){
   const feeds={},buffers=[];
   for(const [key,dims,length]of [['x',[batchSize,160,32],batchSize*160*32],['mask',[batchSize,160,1],batchSize*160],
    ['global_features',[batchSize,8],batchSize*8],['adjacency',[1,160,160],160*160]]){
    const buffer=device.createBuffer({size:length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    buffers.push(buffer);feeds[key]=ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims});
   }
   gpuInputs={feeds,buffers};
  }
  for(const [key,values]of Object.entries(storage))device.queue.writeBuffer(gpuInputs.feeds[key].gpuBuffer,0,values);
  if(lastAdjacency!==adjacency){device.queue.writeBuffer(gpuInputs.feeds.adjacency.gpuBuffer,0,adjacency);lastAdjacency=adjacency;}
  return gpuInputs.feeds;
 }
 async function open(provider){return ort.InferenceSession.create(bytes,{executionProviders:[provider],
  ...(provider==='webgpu'?{freeDimensionOverrides:{batch:batchSize}}:{})});}
 try{session=await open(selected);}catch(error){if(backend!=='auto'||selected==='wasm')throw error;selected='wasm';session=await open(selected);}
 return {
  get backend(){return selected;},runtime:variant,manifest,batchSize,
  async evaluate(request,adjacency,{auxiliary=false}={}){
   if(disposed)throw new Error('v3 inference disposed');
   if(evaluating)throw new Error('v3 inference already running');
   const count=request.count;validateFeatures(request,adjacency,batchSize);
   evaluating=true;
   let gpu=selected==='webgpu',feeds,outputs;
   try{
   for(const [key,values]of Object.entries(storage)){values.set(request[key]);values.fill(0,request[key].length);}
   const cpuFeeds=()=>({x:new ort.Tensor('float32',storage.x.subarray(0,count*160*32),[count,160,32]),
    adjacency:new ort.Tensor('float32',adjacency,[1,160,160]),mask:new ort.Tensor('float32',storage.mask.subarray(0,count*160),[count,160,1]),
    global_features:new ort.Tensor('float32',storage.global_features.subarray(0,count*8),[count,8])});
   try{feeds=gpu?gpuFeeds(adjacency):cpuFeeds();outputs=await session.run(feeds,auxiliary?['policy','wdl','score','ownership']:['policy','wdl']);}
   catch(error){
    if(backend!=='auto'||selected==='wasm')throw error;
    releaseGPU();await session.release();selected='wasm';session=await open(selected);gpu=false;feeds=cpuFeeds();
    outputs=await session.run(feeds,auxiliary?['policy','wdl','score','ownership']:['policy','wdl']);
   }
   const result={};
   for(const [key,tensor] of Object.entries(outputs)){
    const width=key==='policy'?161:key==='wdl'?3:key==='ownership'?160*3:1;
    result[key]=Float32Array.from(tensor.data.subarray(0,count*width));
    if(!result[key].every(Number.isFinite))throw new Error('Nonfinite v3 inference');
   }
   return result;
   }finally{
    for(const t of Object.values(outputs??{}))t.dispose();
    if(!gpu)for(const t of Object.values(feeds??{}))t.dispose();
    evaluating=false;
   }
  },
  async dispose(){if(!disposed){disposed=true;releaseGPU();await session.release();}}
 };
}
