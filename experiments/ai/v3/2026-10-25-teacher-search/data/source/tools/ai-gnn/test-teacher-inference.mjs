import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createTeacherInference} from './teacher-inference.mjs';
import {createOfflineAI} from './offline-player.mjs';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
const directory=process.argv[2];if(!directory)throw Error('Pass a bootstrapped teacher directory');
const device=process.argv[3]??'cpu',golden=JSON.parse(fs.readFileSync('tests/fixtures/ai/v3-golden.json'));
const inputs=Object.fromEntries(Object.entries(golden.inputs).map(([k,v])=>[k,Float32Array.from(v.data)])),batch={count:golden.inputs.x.shape[0],...inputs};
const inference=await createTeacherInference({directory,device});let maxErrors;
try{
 const outputs=await inference.evaluate(batch,inputs.adjacency,{auxiliary:true});
 maxErrors=Object.fromEntries(Object.entries(outputs).map(([name,values])=>{const reference=golden.outputs[name].data;assert.equal(values.length,reference.length);const error=Math.max(...values.map((v,i)=>Math.abs(v-reference[i])));assert.ok(error<3e-4,name+': '+error);return[name,error];}));
 const results=await Promise.all([inference.evaluate(batch,inputs.adjacency),inference.evaluate(batch,inputs.adjacency)]);assert.deepEqual(results[0],results[1]);
 await assert.rejects(inference.evaluate({...batch,count:0},inputs.adjacency),/batch size/);
 const invalid=inputs.x.slice();invalid[0]=NaN;await assert.rejects(inference.evaluate({...batch,x:invalid},inputs.adjacency),/features/);
 await assert.rejects(inference.evaluate({...batch,mask:new Float32Array(inputs.mask.length)},inputs.adjacency),/point mask/);
 const recovery=await inference.evaluate(batch,inputs.adjacency);assert.deepEqual(recovery,results[0]);
}finally{await inference.dispose();await inference.dispose();}
await assert.rejects(inference.evaluate(batch,inputs.adjacency),/disposed/);
await assert.rejects(createTeacherInference({directory:resolve(directory,'missing'),device:'cpu'}),/exited/);
// The same adapter drives the unchanged production WASM, across every supported graph.
const wasm=fs.readFileSync('dist/ai-v3.wasm'),player=await createOfflineAI({createSearch:()=>createV3Search({load:async()=>wasm}),createInference:()=>createTeacherInference({directory,device})});
try{
 for(const[kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const game=new Game(createTopology(kind,size),6.5),r=await player.chooseMove(aiPosition(game),{maxSimulations:65,seed:9,diagnostics:true});
  assert.equal(r.simulations,65);assert.ok(r.move===null||game.analyze(r.move).ok);assert.ok(Math.abs(r.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
 }
}finally{await player.dispose();}
console.log(JSON.stringify({directory,device,manifest:inference.manifest,bootstrapGoldenMaxErrors:maxErrors,concurrentRequests:true,errorRecovery:true,allSixBoards65Visits:true},null,2));
