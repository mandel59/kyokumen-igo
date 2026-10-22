import {AI_WEIGHTS} from './engine.js';
import {validateAIPosition} from './ai-position.js';

const WEIGHTS=['capture','savePerStone','saveCap','killPerStone','killCap','liberty',
  'enemyAdjacent','friendAdjacent','selfAtari','crowded','open','passBelow','territory','noise'];

async function loadBytes() {
  const response=await fetch(new URL('./ai-engine.wasm',import.meta.url));
  if(!response.ok)throw new Error('AI module HTTP '+response.status);
  // Reading bytes also works on static hosts that do not set application/wasm.
  return response.arrayBuffer();
}

export async function createWasmAI({load=loadBytes,random=Math.random}={}) {
  const {instance}=await WebAssembly.instantiate(await load(),{});
  const api=instance.exports;
  if(api.ai_version()!==2||WEIGHTS.some((key,i)=>api.ai_weight(i)!==AI_WEIGHTS[key]))
    throw new Error('Incompatible AI module');
  let pointer=0,capacity=0,disposed=false;
  return {
    chooseMove(position,{seed,randomize=true,depth=0}={}) {
      if(disposed)throw new Error('AI module disposed');
      validateAIPosition(position);
      if(!Number.isInteger(depth)||depth<0||depth>4)throw new Error('Invalid AI search depth');
      const needed=Math.max(1,position.moves.length);
      if(needed>capacity) {
        const nextCapacity=Math.min(10000,Math.max(needed,capacity*2));
        const nextPointer=api.ai_alloc(nextCapacity);
        if(!nextPointer)throw new Error('AI allocation failed');
        if(pointer)api.ai_free(pointer,capacity);
        pointer=nextPointer;capacity=nextCapacity;
      }
      // Recreate the view: Rust allocations may have grown/detached the old memory buffer.
      new Int32Array(api.memory.buffer,pointer,position.moves.length).set(position.moves);
      const args=[position.kind==='sphere'?0:1,position.size,position.komi,
        pointer,position.moves.length,seed??(random()*4294967296)>>>0,randomize?1:0];
      const chosen=depth?api.ai_search(...args,depth):api.ai_choose(...args);
      if(chosen< -1)throw new Error(chosen===-3?'Illegal AI history':'Invalid AI position');
      return chosen===-1?null:chosen;
    },
    dispose() {
      if(pointer)api.ai_free(pointer,capacity);
      pointer=0;capacity=0;disposed=true;
    },
  };
}
