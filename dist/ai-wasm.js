import {createAIAdapter} from './ai-api.js';
async function loadBytes(){
 const response=await fetch(new URL('./ai-engine.wasm',import.meta.url));
 if(!response.ok)throw new Error('AI module HTTP '+response.status);
 return response.arrayBuffer();
}
export async function createWasmAI({load=loadBytes,...options}={}){
 if(typeof WebAssembly==='undefined')throw new Error('WebAssembly unavailable');
 const {instance}=await WebAssembly.instantiate(await load(),{});
 return createAIAdapter(instance.exports,{...options,backend:'wasm'});
}
