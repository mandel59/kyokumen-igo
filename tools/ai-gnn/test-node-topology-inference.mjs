import test from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{Game,createTopology}from'../../dist/engine.js';
import{aiPosition,AI_BOARDS}from'../../dist/ai-position.js';
import{createV3Search}from'../../dist/ai-v3-search.js';
import{adjacencyFor}from'../../dist/ai-v3-inference.js';
import{createNodeInference}from'./node-inference.mjs';
import{createTopologyNodeInference}from'./node-topology-inference.mjs';
const d='tools/ai-gnn/target/topology-routing-study-20261029';
test('native research wrapper matches each direct child on all9 boards and records its actual model',async()=>{
 const wrapped=await createTopologyNodeInference(d+'/Routed-r0-model'),search=await createV3Search({load:async()=>readFileSync(d+'/search.wasm')});
 try{
  for(const[kind,size]of AI_BOARDS){
   await wrapped.setKind(kind);const direct=await createNodeInference(d+'/Routed-r0-model',{kind});
   try{
    assert.equal(wrapped.manifest.sha256,direct.manifest.sha256);
    const game=new Game(createTopology(kind,size),6.5);game.play(0);
    search.start(aiPosition(game),{seed:3});const request=search.collect(1),adjacency=adjacencyFor(game.topology);
    const a=await wrapped.evaluate(request,adjacency,{auxiliary:true}),b=await direct.evaluate(request,adjacency,{auxiliary:true});
    for(const key of Object.keys(a))assert.deepEqual(a[key],b[key],kind+size+' '+key);
    search.cancel();
   }finally{await direct.dispose();}
  }
  await assert.rejects(wrapped.setKind('unknown'),/kind/);
  search.start(aiPosition(new Game(createTopology('plane',7),6.5)),{seed:3});
  const request=search.collect(1),adjacency=adjacencyFor(createTopology('plane',7)),pending=wrapped.evaluate(request,adjacency);
  await assert.rejects(wrapped.setKind('torus'),/during evaluation/);
  await assert.rejects(wrapped.dispose(),/during evaluation/);await pending;
 }finally{search.dispose();await wrapped.dispose();await wrapped.dispose();}
 await assert.rejects(wrapped.evaluate({},[]),/unavailable/);
});
test('legacy single-model native wrapper retains one identity across topologies',async()=>{
 const wrapped=await createTopologyNodeInference(d+'/baseline');
 try{for(const kind of['sphere','torus','plane']){await wrapped.setKind(kind);assert.equal(wrapped.manifest.sha256,wrapped.bundleManifest.sha256);}}finally{await wrapped.dispose();}
});
