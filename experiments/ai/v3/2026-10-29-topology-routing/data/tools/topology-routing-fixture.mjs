// Public reported game only; explanatory diagnostic, never an adoption gate.
import {readFileSync,writeFileSync} from 'node:fs';
import {decodeRecord} from '../../dist/record.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {fromVertex,toVertex} from '../gtp/vertex.mjs';
const dir='tools/ai-gnn/target/topology-routing-study-20261029',fixture=JSON.parse(readFileSync(dir+'/reported-game.json'));
const {game}=decodeRecord(fixture.recordCode);game.undo(game.moves-39);const point=fromVertex('L6',11),capture=game.analyze(point).captured,rows=[];
for(const id of ['baseline','Routed-r0-model']){
 const inference=await createNodeInference(dir+'/'+id,{kind:game.topology.kind}),search=await createV3Search({load:async()=>readFileSync(dir+'/search.wasm')});
 try{for(let seed=0;seed<4;seed++){
  search.start(aiPosition(game),{seed,fpu:1,tactics:true});
  while(search.result().simulations<64){const left=64-search.result().simulations,r=search.collect(Math.min(8,left),left);if(r.count)search.submit(r,await inference.evaluate(r,adjacencyFor(game.topology)));if(search.result().provenLoss)break;}
  const out=search.result({diagnostics:true}),d=out.diagnostics;rows.push({id,modelSha256:inference.manifest.sha256,seed,selected:toVertex(out.move,11),L6:{point,capture,prior:d.rootPriors[point],rank:1+d.rootPriors.filter(p=>p>d.rootPriors[point]).length,visits:d.rawVisits[point]},simulations:out.simulations,diagnostics:d});
 }}finally{search.dispose();await inference.dispose();}
}
writeFileSync(dir+'/results/reported-game-diagnostic.json',JSON.stringify({role:'Public development fixture; no training or selection use. Shared record does not encode original runtime hashes; this reproduces frozen current baseline and candidates.',rows},null,2)+'\n');
console.log(JSON.stringify(rows.filter(r=>r.seed===0).map(({diagnostics,...r})=>r)));
