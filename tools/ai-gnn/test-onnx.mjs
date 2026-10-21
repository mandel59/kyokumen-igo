import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNodeInference} from './node-inference.mjs';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
const directory=process.argv[2]??'dist/models/v3';
const golden=JSON.parse(readFileSync(process.argv[2]?directory+'/golden.json':new URL('../../tests/fixtures/ai/v3-golden.json',import.meta.url),'utf8'));
const input=Object.fromEntries(Object.entries(golden.inputs).map(([k,v])=>[k,Float32Array.from(v.data)]));
const ai=await createNodeInference(directory);
if(golden.modelSha256)assert.equal(ai.manifest.sha256,golden.modelSha256);
const output=await ai.evaluate({count:golden.inputs.x.shape[0],...input},input.adjacency,{auxiliary:true});
for(const [key,target] of Object.entries(golden.outputs)){
 assert.equal(output[key].length,target.data.length);
 let max=0;for(let i=0;i<target.data.length;i++)max=Math.max(max,Math.abs(output[key][i]-target.data[i]));
 assert.ok(max<2e-4,key+' maximum difference '+max);console.log(key,'PyTorch/ONNX max difference',max);
}
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
for(const [kind,size] of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
 const game=new Game(createTopology(kind,size)),a=adjacencyFor(game.topology);
 for(let turn=0;turn<3&&!game.ended;turn++){
  search.start(aiPosition(game),{seed:turn});
  while(search.result().simulations<24){const b=search.collect();if(b.count)search.submit(b,await ai.evaluate(b,a));}
  const {move}=search.result();assert.equal((move===null?game.pass():game.play(move)).ok,true);
 }
}
search.dispose();await ai.dispose();
console.log('v3 trained ONNX + batched WASM MCTS: legal moves on all six boards passed.');
