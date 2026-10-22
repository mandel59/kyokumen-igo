// Feature ABI v1. The independent v2 module remains the production fallback.
import {validateAIPosition} from './ai-position.js';
export const V3={points:160,channels:32,globals:8,actions:161,batch:8};
export async function createV3Search({load=async()=>{
 const r=await fetch(new URL('./ai-v3.wasm?abi=3&build=ef392c214c83',import.meta.url));
 if(!r.ok)throw new Error('v3 WASM HTTP '+r.status);return r.arrayBuffer();
}}={}) {
 const {instance}=await WebAssembly.instantiate(await load(),{}),api=instance.exports;
 if(api.v3_version()!==3)throw new Error('Incompatible v3 search ABI');
 let ptr=0,capacity=0,generation=0,pending=null,disposed=false,position=null;
 function allocate(words){
  if(words>capacity){if(ptr)api.v3_free(ptr,capacity);capacity=Math.max(words,10000);ptr=api.v3_alloc(capacity);if(!ptr)throw new Error('v3 allocation failed');}
 }
 function check(){if(disposed)throw new Error('v3 search disposed');}
 function read(kind,length,Type=Float32Array){return new Type(api.memory.buffer,api.v3_buffer(kind),length).slice();}
 return {
  start(next,{seed=0,tactics=true,endgame=true,fpu=0,rootNoise=false}={}){
   check();validateAIPosition(next);api.v3_cancel();pending=null;generation++;position=null;
   allocate(Math.max(1,next.moves.length));new Int32Array(api.memory.buffer,ptr,next.moves.length).set(next.moves);
   const result=api.v3_start(next.kind==='sphere'?0:1,next.size,next.komi,ptr,next.moves.length,seed>>>0);
   if(result)throw new Error(result===-3?'Illegal AI history':'Invalid v3 position');
   if(api.v3_set_tactics(tactics?1:0))throw new Error('Invalid v3 tactics configuration');
   if(api.v3_set_endgame(endgame?1:0))throw new Error('Invalid v3 endgame configuration');
   if(!Number.isInteger(fpu)||fpu<0||fpu>2||(!api.v3_set_fpu&&fpu!==0)||
    (api.v3_set_fpu&&api.v3_set_fpu(fpu,rootNoise?1:0)))throw new Error('Invalid v3 FPU configuration');
   position={...next,moves:Int32Array.from(next.moves)};
  },
  collect(batch=V3.batch,remainingVisits){
   check();if(!position)throw new Error('Start v3 search first');if(pending)throw new Error('v3 batch still pending');
   if(!Number.isInteger(batch)||batch<1||batch>8)throw new Error('Invalid v3 batch size');
   if(remainingVisits!==undefined&&(!Number.isInteger(remainingVisits)||remainingVisits<1||remainingVisits>0xffffffff||!api.v3_collect_limited))throw new Error('Invalid v3 visit limit or incompatible WASM');
   const count=remainingVisits===undefined?api.v3_collect(batch):api.v3_collect_limited(batch,remainingVisits);if(count<0)throw new Error('v3 collect failed');
   const request={generation,count,ids:read(4,count,Uint32Array),x:read(0,count*160*32),
    global_features:read(1,count*8),mask:read(2,count*160),legal:read(3,count*161)};
   if(count)pending={generation,ids:request.ids.slice()};return request;
  },
  submit(request,{policy,wdl}){
   check();if(!pending||request.generation!==generation||request.generation!==pending.generation||
    request.ids.length!==pending.ids.length||request.ids.some((id,k)=>id!==pending.ids[k]))throw new Error('Stale v3 batch');
   const count=pending.ids.length;
   if(policy?.length!==count*161||wdl?.length!==count*3||!policy.every(Number.isFinite)||!wdl.every(Number.isFinite))throw new Error('Invalid v3 evaluation');
   allocate(count*(163));
   new Uint32Array(api.memory.buffer,ptr,count).set(pending.ids);
   const values=new Float32Array(api.memory.buffer,ptr+count*4,count*162);
   for(let b=0;b<count;b++){
    values.set(policy.subarray(b*161,(b+1)*161),b*162);
    const w=wdl.subarray(b*3,b*3+3),max=Math.max(...w),exp=Array.from(w,v=>Math.exp(v-max));
    values[b*162+161]=(exp[0]-exp[2])/(exp[0]+exp[1]+exp[2]);
   }
   if(api.v3_submit(ptr,ptr+count*4,count))throw new Error('v3 rejected evaluation');
   pending=null;
  },
  result({diagnostics=false}={}){check();if(!position)throw new Error('Start v3 search first');const move=api.v3_best();
   if(move< -1)throw new Error('v3 has no position');const lossMarginLowerBound=api.v3_loss_margin();
   const avoidedInvasions=api.v3_avoided(),result={move:move===-1?null:move,policy:read(5,161),simulations:api.v3_completed(),avoidedInvasions,
    provenLoss:lossMarginLowerBound>0,lossMarginLowerBound,
    decisionReason:lossMarginLowerBound>0?'certified-loss':avoidedInvasions?'tactics-pruned':'normal'};
   if(diagnostics&&api.v3_statistics){
    const pointer=api.v3_statistics(),data=new Float32Array(api.memory.buffer,pointer,3+161*3).slice();
    result.diagnostics={rootValue:data[0],unvisitedSelections:data[1],rootVisits:data[2],
     rawVisits:Array.from(data.subarray(3,164)),rootPriors:Array.from(data.subarray(164,325)),rootQ:Array.from(data.subarray(325))};
   }
   return result;},
  cancel(){check();generation++;pending=null;api.v3_cancel();},
  dispose(){if(disposed)return;api.v3_cancel();if(ptr)api.v3_free(ptr,capacity);ptr=0;disposed=true;}
 };
}
