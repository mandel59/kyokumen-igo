import {createTopology} from './engine.js';
import {createV3Search} from './ai-v3-search.js';
import {createV3Inference,adjacencyFor} from './ai-v3-inference.js';

export const V3_DEFAULT_SIMULATIONS=512;

export async function createV3AI(options={}){
 const search=await createV3Search(options);
 const adjacencies=new Map();
 function adjacencyForPosition(position){
  const key=position.kind+':'+position.size;
  if(!adjacencies.has(key))adjacencies.set(key,adjacencyFor(createTopology(position.kind,position.size)));
  return adjacencies.get(key);
 }
 let inference,configuredFpu=0;
 try{
  inference=await createV3Inference(options);
  configuredFpu=options.fpu??inference.manifest.search?.fpu??0;
  if(!Number.isInteger(configuredFpu)||configuredFpu<0||configuredFpu>2)throw new Error('Invalid v3 FPU configuration');
  // Compile kernels during initialization; the Worker keeps serving v2 meanwhile.
  const warm={kind:'torus',size:7,komi:6.5,moves:new Int32Array()};
  search.start(warm,{fpu:configuredFpu});const leaves=search.collect(1);
  search.submit(leaves,await inference.evaluate(leaves,adjacencyForPosition(warm)));
  search.cancel();
 }catch(error){search.dispose();await inference?.dispose();throw error;}
 let cancelled=0,busy=false;
 return {
  get backend(){return 'v3-'+inference.backend;},
  async chooseMove(position,{seed=0,budgetMs,maxSimulations=V3_DEFAULT_SIMULATIONS}={}){
   if(busy)throw new Error('v3 search already running');
   if((budgetMs!==undefined&&(!Number.isFinite(budgetMs)||budgetMs<=0))||!Number.isInteger(maxSimulations)||maxSimulations<1||maxSimulations>0xffffffff)throw new Error('Invalid v3 search budget');
   busy=true;const generation=cancelled;
   try{
    search.start(position,{seed,fpu:configuredFpu});const adjacency=adjacencyForPosition(position);
    const start=performance.now();let batches=0,lastBatchMs=0,stalled=0;
    while(search.result().simulations<maxSimulations){
     if(budgetMs!==undefined&&batches&&budgetMs-(performance.now()-start)<Math.max(1,lastBatchMs))break;
     if(generation!==cancelled)throw new Error('v3 cancelled');
     const completed=search.result().simulations,remaining=maxSimulations-completed;
     const leaves=search.collect(Math.min(inference.batchSize,remaining),remaining);
     if(!leaves.count){
      const next=search.result().simulations;if(!next)break;
      if(next===completed){if(++stalled>=16)throw new Error('v3 search stalled');}else stalled=0;
      await new Promise(r=>setTimeout(r,0));continue;
     }
     stalled=0;
     const batchStart=performance.now();const evaluation=await inference.evaluate(leaves,adjacency);
     if(generation!==cancelled)throw new Error('v3 cancelled');
     search.submit(leaves,evaluation);batches++;lastBatchMs=performance.now()-batchStart;
     if(search.result().provenLoss)break;
     // Let cancellation messages run between batches.
     await new Promise(r=>setTimeout(r,0));
    }
    return {...search.result(),backend:this.backend,elapsedMs:performance.now()-start,batches};
   }finally{search.cancel();busy=false;}
  },
  cancel(){cancelled++;search.cancel();},
  async dispose(){cancelled++;search.dispose();await inference.dispose();}
 };
}
