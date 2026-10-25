// Research-only pooling across independent searches. Each client still submits at most8 leaves.
export function createInferencePool(inference,{capacity=64,maxRequest=8}={}){
 if(!Number.isInteger(capacity)||capacity<1||!Number.isInteger(maxRequest)||maxRequest<1||maxRequest>capacity)throw Error('Invalid inference pool capacity');
 const graphs=[],known=new WeakMap(),stats={requests:0,positions:0,batches:0,maxBatch:0},widths={policy:161,wdl:3,score:1,ownership:480};
 let disposed=false,failure=null,scheduled=false,running=null,cursor=0,disposal;
 const error=()=>failure??Error('Inference pool disposed');
 function graph(adjacency){
  if(!(adjacency instanceof Float32Array)||adjacency.length!==25600)throw Error('Invalid pooled adjacency');
  if(known.has(adjacency))return known.get(adjacency);
  if(!adjacency.every(Number.isFinite))throw Error('Nonfinite pooled adjacency');
  let g=graphs.find(g=>g.adjacency.every((v,i)=>Object.is(v,adjacency[i])));
  if(!g){g={adjacency:adjacency.slice(),queue:[]};graphs.push(g);}known.set(adjacency,g);return g;
 }
 function rejectQueued(reason){for(const g of graphs)for(const job of g.queue.splice(0))job.reject(reason);}
 function schedule(){if(scheduled||running||disposed||failure)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(!disposed&&!failure){running=drain();running.finally(()=>{running=null;if(!disposed&&!failure&&graphs.some(g=>g.queue.length))schedule();}).catch(()=>{});}});}
 async function drain(){
  try{while(!disposed&&!failure){
   let g;
   for(let i=0;i<graphs.length;i++){const index=(cursor+i)%graphs.length;if(graphs[index].queue.length){g=graphs[index];cursor=(index+1)%graphs.length;break;}}
   if(!g)break;
   const jobs=[];let count=0;
   while(g.queue.length&&count+g.queue[0].request.count<=capacity){const job=g.queue.shift();jobs.push(job);count+=job.request.count;}
   const batch={count,x:new Float32Array(count*5120),mask:new Float32Array(count*160),global_features:new Float32Array(count*8)};
   let offset=0;for(const j of jobs){batch.x.set(j.request.x,offset*5120);batch.mask.set(j.request.mask,offset*160);batch.global_features.set(j.request.global_features,offset*8);offset+=j.request.count;}
   const auxiliary=jobs.some(j=>j.auxiliary);
   try{
    const output=await inference.evaluate(batch,g.adjacency,{auxiliary});
    if(disposed||failure)throw error();
    const names=auxiliary?Object.keys(widths):['policy','wdl'];
    for(const name of names)if(!(output[name] instanceof Float32Array)||output[name].length!==count*widths[name]||!output[name].every(Number.isFinite))throw Error('Invalid pooled output: '+name);
    stats.batches++;stats.maxBatch=Math.max(stats.maxBatch,count);offset=0;
    for(const j of jobs){const keys=j.auxiliary?Object.keys(widths):['policy','wdl'];j.resolve(Object.fromEntries(keys.map(name=>[name,output[name].slice(offset*widths[name],(offset+j.request.count)*widths[name])])));offset+=j.request.count;}
   }catch(cause){failure=cause;for(const j of jobs)j.reject(cause);rejectQueued(cause);}
  }}catch(cause){failure=cause;rejectQueued(cause);throw cause;}
 }
 function evaluate(request,adjacency,{auxiliary=false}={}){
  if(disposed||failure)return Promise.reject(error());
  const n=request.count;
  if(!Number.isInteger(n)||n<1||n>maxRequest)return Promise.reject(Error('Invalid pooled request count'));
  for(const[name,width]of [['x',5120],['mask',160],['global_features',8]])if(!(request[name] instanceof Float32Array)||request[name].length!==n*width)return Promise.reject(Error('Invalid pooled '+name));
  let g;try{g=graph(adjacency);}catch(cause){return Promise.reject(cause);}
  stats.requests++;stats.positions+=n;
  // Preserve the feature bytes even if a client cancels or reuses its WASM buffers before dispatch.
  const snapshot={count:n,x:request.x.slice(),mask:request.mask.slice(),global_features:request.global_features.slice()};
  return new Promise((resolve,reject)=>{g.queue.push({request:snapshot,auxiliary,resolve,reject});schedule();});
 }
 return{
  get stats(){return{...stats,graphs:graphs.length};},
  createClient(){
   if(disposed||failure)throw error();let closed=false,pending=null;
   return{manifest:inference.manifest,backend:inference.backend,batchSize:maxRequest,
    async evaluate(request,adjacency,options){if(closed)throw Error('Pooled client disposed');if(pending)throw Error('Pooled client already running');pending=evaluate(request,adjacency,options);try{return await pending;}finally{pending=null;}},
    async dispose(){closed=true;await pending?.catch(()=>{});}
   };
  },
  async dispose(){if(disposal)return disposal;disposed=true;rejectQueued(error());disposal=(async()=>{await running?.catch(()=>{});await inference.dispose();})();return disposal;}
 };
}

export async function createPooledV3Inference({manifestURL,capacity=64,maxRequest=8}={}){
 const {validateManifest}=await import('../../dist/ai-v3-inference.js');
 const {createV3WebGPU}=await import('../../dist/ai-v3-webgpu.js');
 if(!manifestURL||!Number.isInteger(capacity)||capacity<1||capacity>64||!Number.isInteger(maxRequest)||maxRequest<1||maxRequest>capacity)throw Error('Invalid pooled WebGPU options');
 manifestURL=new URL(manifestURL,import.meta.url);const response=await fetch(manifestURL);if(!response.ok)throw Error('Pooled manifest HTTP '+response.status);
 const manifest=await response.json();validateManifest(manifest);const gpu=await createV3WebGPU(manifest,manifestURL,capacity);
 return createInferencePool({...gpu,manifest,backend:'webgpu'},{capacity,maxRequest});
}
