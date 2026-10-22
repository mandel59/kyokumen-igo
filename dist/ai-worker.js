import {createV2AI} from './ai-v2.js';

// One module and input buffer per Worker, reused for subsequent turns.
const ready=createV2AI().then(ai=>({ai}),error=>({error}));
// v3 is an explicit experiment until independently accepted against deployed v2.
const v3Options=globalThis.location?.search?new URLSearchParams(globalThis.location.search):null;
let v3=null,v3Failed=false;
const v3Ready=v3Options?.get('ai')==='v3'
  ?import('./ai-v3.js').then(({createV3AI})=>createV3AI({backend:v3Options.get('backend')==='wasm'?'wasm':'auto'}))
    .then(ai=>{v3=ai;}).catch(error=>{v3Failed=true;console.warn('v3 initialization failed:',error.message);})
  :null;
self.onmessage=async({data})=>{
  try {
    if(data.type==='cancel'){v3?.cancel();return;}
    // An explicit v3 game waits for its model; startup speed must not choose a different player.
    if(v3Ready)await v3Ready;
    let move,simulations,backend;
    if(v3&&!v3Failed){
      try{const result=await v3.chooseMove(data.position,{seed:(Math.random()*4294967296)>>>0});move=result.move;simulations=result.simulations;backend=result.backend;}
      catch(error){v3Failed=true;console.warn('v3 search failed:',error.message);}
    }
    if(!backend) {
      const {ai,error}=await ready;if(error)throw error;
      move=await ai.chooseMove(data.position,{depth:4});backend=ai.backend;
    }
    self.postMessage({id:data.id,move,backend,...(simulations===undefined?{}:{simulations})});
  } catch(error) {
    self.postMessage({id:data.id,error:error?.message??String(error)});
  }
};
