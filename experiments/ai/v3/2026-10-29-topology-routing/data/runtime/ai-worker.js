import {createV2AI} from './ai-v2.js';

// One module and input buffer per Worker, reused for subsequent turns.
const ready=createV2AI().then(ai=>({ai}),error=>({error}));
// v3 is an explicit experiment until independently accepted against deployed v2.
const v3Options=globalThis.location?.search?new URLSearchParams(globalThis.location.search):null;
let v3=null,v3Failed=false,v3Generation=0;
const v3Ready=v3Options?.get('ai')==='v3'
  ?import('./ai-v3.js').then(({createV3AI})=>createV3AI({discoverModels:true,backend:v3Options.get('backend')==='wasm'?'wasm':'auto'}))
    .then(ai=>{v3=ai;}).catch(error=>{v3Failed=true;console.warn('v3 initialization failed:',error.message);})
  :null;
// Report the backend once loading settles, so the page can show which AI this device runs.
(async()=>{
  if(v3Ready)await v3Ready;
  if(v3&&!v3Failed){self.postMessage({type:'info',backend:v3.backend});return;}
  const {ai,error}=await ready;
  self.postMessage(error?{type:'info',error:error?.message??String(error)}:{type:'info',backend:ai.backend});
})();
let pendingTurn=Promise.resolve();
self.onmessage=({data})=>{
  if(data.type==='cancel'){v3Generation++;v3?.cancel();return;}
  const generation=v3Generation,previous=pendingTurn;
  pendingTurn=(async()=>{
    await previous.catch(()=>{});
    if(generation!==v3Generation)return;
    try{
      if(v3Ready)await v3Ready;
      if(generation!==v3Generation)return;
      let move,simulations,backend,modelSha256;
      if(v3&&!v3Failed){
        try{
          const result=await v3.chooseMove(data.position,{seed:(Math.random()*4294967296)>>>0});
          move=result.move;simulations=result.simulations;backend=result.backend;modelSha256=result.modelSha256;
        }catch(error){
          if(error?.message==='v3 cancelled'||generation!==v3Generation)return;
          v3Failed=true;console.warn('v3 search failed:',error.message);
        }
      }
      if(!backend){
        const {ai,error}=await ready;if(error)throw error;
        move=await ai.chooseMove(data.position,{depth:4});backend=ai.backend;
      }
      if(generation!==v3Generation)return;
      self.postMessage({id:data.id,move,backend,...(simulations===undefined?{}:{simulations}),...(modelSha256?{modelSha256}:{})});
    }catch(error){
      if(generation===v3Generation)self.postMessage({id:data.id,error:error?.message??String(error)});
    }
  })();
};
