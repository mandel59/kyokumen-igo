// Real deployed-model regression for the reported 11x11 eye-filling game.
// Optional: --baseline path/to/preceding-ai-v3.wasm for an identical-model comparison.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Game} from '../../dist/engine.js';
import {decodeRecord} from '../../dist/record.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {toVertex} from '../gtp/vertex.mjs';
const record=decodeRecord(JSON.parse(readFileSync(new URL('../../tests/fixtures/ai/v3-plane-endgame.json',import.meta.url))).code).game;
const args=process.argv.slice(2),baselineIndex=args.indexOf('--baseline');
if(baselineIndex>=0&&!args[baselineIndex+1])throw Error('--baseline requires a WASM path');
const inference=await createNodeInference(fileURLToPath(new URL('../../dist/models/v3',import.meta.url)),{kind:'plane'});
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const baseline=baselineIndex>=0?await createV3Search({load:async()=>readFileSync(args[baselineIndex+1])}):null;
const adjacency=adjacencyFor(record.topology),at=ply=>Game.fromJSON({...record.toJSON(),history:record.history.slice(0,ply+1)});
async function choose(engine,game,seed){
 const before=JSON.stringify(game.toJSON());engine.start(aiPosition(game),{seed,fpu:inference.manifest.search?.fpu??0});
 let calls=0;
 while(engine.result().simulations<64){
  const remaining=64-engine.result().simulations,leaves=engine.collect(Math.min(8,remaining),remaining);
  if(leaves.count)engine.submit(leaves,await inference.evaluate(leaves,adjacency));
  if(engine.result().provenLoss)break;
  assert.ok(++calls<100,'bounded search must keep progressing');
 }
 const result=engine.result();engine.cancel();assert.equal(JSON.stringify(game.toJSON()),before);return result;
}
try{
 const report={model:inference.manifest.sha256,visits:64,roots:[]};
 for(const ply of [149,153,155,157])for(const seed of [0,1,42]){
  const game=at(ply),result=await choose(search,game,seed);
  assert.equal(result.move,null);assert.equal(result.settledPass,true);assert.equal(result.policy[160],1);
  assert.equal(result.simulations,64);assert.equal(result.provenLoss,false);
  const old=baseline?await choose(baseline,game,seed):null;
  const ended=Game.fromJSON(game.toJSON());assert.equal(ended.pass().ok,true);
  assert.equal(ended.ended,true);assert.equal(ended.score().winner,1);assert.equal(ended.score().margin,0.5);
  report.roots.push({after:ply,seed,before:old?toVertex(old.move,11):undefined,afterMove:'pass',reason:result.decisionReason});
 }
 const firstPass=await choose(search,at(156),3);assert.equal(firstPass.settledPass,false,'do not force a first pass');
 console.log(JSON.stringify(report));
}finally{search.dispose();baseline?.dispose();await inference.dispose();}
