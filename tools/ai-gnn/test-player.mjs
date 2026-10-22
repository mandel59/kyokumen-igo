// Run the actual player against real WASM search and a deterministic evaluator/clock.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createTopology} from '../../dist/engine.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
const source=readFileSync(new URL('../../dist/ai-v3.js',import.meta.url),'utf8');
const wasm=readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url));
async function player(latency,searchFactory=()=>createV3Search({load:async()=>wasm})){
 let clock=0;
 const context=vm.createContext({Int32Array,performance:{now:()=>clock},setTimeout:fn=>queueMicrotask(fn)});
 const modules={
  './engine.js':{createTopology},'./ai-v3-search.js':{createV3Search:searchFactory},
  './ai-v3-inference.js':{adjacencyFor,async createV3Inference(){return{
   backend:'wasm',batchSize:8,manifest:{search:{fpu:1}},async evaluate(request){
    clock+=latency;const policy=new Float32Array(request.count*161),wdl=new Float32Array(request.count*3);
    for(let b=0;b<request.count;b++)for(let p=0;p<161;p++)policy[b*161+p]=p===160?-10:-.01*p;
    return{policy,wdl};
   },async dispose(){}
  };}}
 };
 const module=new vm.SourceTextModule(source,{context});
 await module.link(name=>{const values=modules[name];assert.ok(values,name);return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});
 await module.evaluate();assert.equal(module.namespace.V3_DEFAULT_SIMULATIONS,64);
 return module.namespace.createV3AI();
}
const position={kind:'torus',size:7,komi:6.5,moves:new Int32Array()};
const fast=await player(1),slow=await player(1000);
try{
 const a=await fast.chooseMove(position,{seed:3}),b=await slow.chooseMove(position,{seed:3});
 assert.equal(a.simulations,64);assert.equal(b.simulations,64);assert.ok(b.elapsedMs>300);
 assert.equal(a.move,b.move);assert.deepEqual(a.policy,b.policy);
 for(const maxSimulations of[1,2,7,8,9,17,128,512])assert.equal((await fast.chooseMove(position,{seed:3,maxSimulations})).simulations,maxSimulations);
 const timed=await slow.chooseMove(position,{seed:3,maxSimulations:512,budgetMs:100});
 assert.equal(timed.simulations,1,'Explicit time limit remains available for benchmarks');
 for(const maxSimulations of[0,-1,1.5,NaN,Infinity,0x100000000])await assert.rejects(fast.chooseMove(position,{maxSimulations}),/budget/);
 for(const budgetMs of[null,0,-1,NaN,Infinity])await assert.rejects(fast.chooseMove(position,{budgetMs}),/budget/);
 const waiting=slow.chooseMove(position,{seed:3});
 await assert.rejects(slow.chooseMove(position),/already running/);slow.cancel();
 await assert.rejects(waiting,/cancelled/);
 assert.equal((await slow.chooseMove(position,{maxSimulations:9})).simulations,9);
}finally{await fast.dispose();await slow.dispose();}
const stalled=await player(1,async()=>{
 let simulations=0;
 return{start(){simulations=0;},collect(){return{count:simulations?0:1};},submit(){simulations++;},
  result(){return{simulations,move:0,provenLoss:false};},cancel(){},dispose(){}};
});
try{await assert.rejects(stalled.chooseMove(position),/stalled/);}finally{await stalled.dispose();}
console.log('v3 player: fixed 64 visits despite slow inference, exact odd/larger budgets, explicit timed mode, validation, cancellation/reuse and stalled-search guard passed.');
