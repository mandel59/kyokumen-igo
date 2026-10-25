import {createTopology} from '../../dist/engine.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {createV3Inference,adjacencyFor} from '../../dist/ai-v3-inference.js';

// Research-only fixed-visit player. No UI timer yields or time cutoffs.
// Search and inference factories allow a separate teacher backend without changing dist/.
export async function createOfflineAI(options={}){
 const search=await(options.createSearch??createV3Search)(options),adjacencies=new Map();
 let inference,epoch=0,busy=false,disposed=false;
 const adjacency=position=>{
  const key=position.kind+':'+position.size;
  if(!adjacencies.has(key))adjacencies.set(key,adjacencyFor(createTopology(position.kind,position.size)));
  return adjacencies.get(key);
 };
 try{inference=await(options.createInference??createV3Inference)(options);}
 catch(error){search.dispose();throw error;}
 const fpu=options.fpu??inference.manifest?.search?.fpu??1;
 if(!Number.isInteger(fpu)||fpu<0||fpu>2){search.dispose();await inference.dispose();throw Error('Invalid offline FPU');}
 return {
  get backend(){return 'offline-'+inference.backend;},
  async chooseMove(position,{seed=0,maxSimulations,budgetMs}={}){
   if(disposed)throw Error('Offline player disposed');
   if(busy)throw Error('Offline search already running');
   if(budgetMs!==undefined||!Number.isInteger(maxSimulations)||maxSimulations<1||maxSimulations>0xffffffff)throw Error('Offline search requires an explicit fixed visit budget');
   busy=true;const generation=epoch,start=performance.now();let batches=0,stalled=0;
   try{
    search.start(position,{seed,fpu});const adjacent=adjacency(position);
    while(search.result().simulations<maxSimulations){
     if(generation!==epoch)throw Error('Offline search cancelled');
     const completed=search.result().simulations,remaining=maxSimulations-completed;
     const leaves=search.collect(Math.min(8,inference.batchSize??8,remaining),remaining);
     if(leaves.count){
      const evaluation=await inference.evaluate(leaves,adjacent);
      if(generation!==epoch)throw Error('Offline search cancelled');
      search.submit(leaves,evaluation);batches++;
     }
     const result=search.result();
     if(result.provenLoss)break;
     if(result.simulations===completed){if(++stalled>=16)throw Error('Offline search stalled');}else stalled=0;
    }
    const result=search.result();
    if(!result.provenLoss&&result.simulations!==maxSimulations)throw Error('Offline visit budget mismatch');
    return {...result,backend:this.backend,elapsedMs:performance.now()-start,batches};
   }finally{if(!disposed)search.cancel();busy=false;}
  },
  cancel(){epoch++;if(!disposed)search.cancel();},
  async dispose(){if(disposed)return;epoch++;disposed=true;search.dispose();await inference.dispose();}
 };
}
