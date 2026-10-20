import {chooseMove} from './engine.js';
import {restoreAIPosition} from './ai-position.js';
import {createWasmAI} from './ai-wasm.js';

// One module and input buffer per Worker, reused for subsequent turns.
const ready=createWasmAI().catch(()=>null);
let wasmFailed=false;
self.onmessage=async({data})=>{
  try {
    const ai=await ready;
    let move,backend='js';
    if(ai&&!wasmFailed) {
      try {move=ai.chooseMove(data.position);backend='wasm';}
      catch {wasmFailed=true;}
    }
    if(backend==='js')move=chooseMove(restoreAIPosition(data.position));
    self.postMessage({id:data.id,move,backend});
  } catch(error) {
    self.postMessage({id:data.id,error:error.message});
  }
};
