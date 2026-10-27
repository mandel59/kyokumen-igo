import {validateAIPosition} from './ai-position.js';
export class AIInputError extends Error {}
// Shared ABI, validation and allocation for WASM and wasm2js output.
export function createAIAdapter(api,{random=Math.random,backend}={}){
 if(api.ai_version?.()!==2||!['ai_alloc','ai_free','ai_choose','ai_search'].every(key=>typeof api[key]==='function')||!api.memory?.buffer)throw new Error('Incompatible AI module');
 let pointer=0,capacity=0,disposed=false;
 return{backend,
  chooseMove(position,{seed,randomize=true,depth=0}={}){
   if(disposed)throw new Error('AI module disposed');
   try{validateAIPosition(position);}catch(error){throw new AIInputError(error.message);}
   if(!Number.isInteger(depth)||depth<0||depth>4)throw new AIInputError('Invalid AI search depth');
   const needed=Math.max(1,position.moves.length);
   if(needed>capacity){
    const nextCapacity=Math.min(10000,Math.max(needed,capacity*2)),nextPointer=api.ai_alloc(nextCapacity);
    if(!nextPointer)throw new Error('AI allocation failed');
    if(pointer)api.ai_free(pointer,capacity);
    pointer=nextPointer;capacity=nextCapacity;
   }
   new Int32Array(api.memory.buffer,pointer,position.moves.length).set(position.moves);
   const args=[['sphere','torus','plane'].indexOf(position.kind),position.size,position.komi,pointer,position.moves.length,seed??(random()*4294967296)>>>0,randomize?1:0];
   const chosen=depth?api.ai_search(...args,depth):api.ai_choose(...args);
   if(chosen< -1)throw new AIInputError(chosen===-3?'Illegal AI history':'Invalid AI position');
   return chosen===-1?null:chosen;
  },
  dispose(){if(pointer)api.ai_free(pointer,capacity);pointer=0;capacity=0;disposed=true;}
 };
}
