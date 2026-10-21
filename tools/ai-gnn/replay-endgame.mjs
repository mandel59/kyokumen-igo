// Compare the endgame guard with the preceding v3 on the reported real game.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game} from '../../dist/engine.js';
import {decodeRecord} from '../../dist/record.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';

const fixture=readFileSync(new URL('../../tests/fixtures/ai/v3-endgame.json',import.meta.url));
const {game:record,ai:colour}=decodeRecord(JSON.parse(fixture).code);
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const inference=await createNodeInference(arg('--model','dist/models/v3'));
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const adjacency=adjacencyFor(record.topology),game=new Game(record.topology,record.komi);
const report={schemaVersion:1,fixtureSha256:createHash('sha256').update(fixture).digest('hex'),
 model:inference.manifest.sha256,seed:3,simulations:64,aiColour:colour,kind:record.topology.kind,size:record.topology.size,
 komi:record.komi,originalMoves:record.moves,condition:'Same model, root tactics and seed; only certified-loss passing toggled. Fixed visits, native CPU inference.',positions:[]};
try{
 for(let k=1;k<record.history.length;k++){
  const move=record.history[k].lastMove;
  if([164,166,168,184,210,228].includes(k)){
   const position={ply:k,originalMove:move,score:game.score()};
   for(const endgame of [false,true]){
    search.start(aiPosition(game),{seed:report.seed,endgame});const start=performance.now();
    while(search.result().simulations<report.simulations){
     const request=search.collect();
     if(request.count){
      const evaluation=await inference.evaluate(request,adjacency);
      if(!endgame&&!position.neural){
       const logits=evaluation.policy.subarray(0,161),points=Array.from(request.legal,(_,p)=>p).filter(p=>request.legal[p]);
       const max=Math.max(...points.map(p=>logits[p])),total=points.reduce((sum,p)=>sum+Math.exp(logits[p]-max),0);
       const w=Array.from(evaluation.wdl.subarray(0,3)),peak=Math.max(...w),probability=w.map(v=>Math.exp(v-peak)),denominator=probability.reduce((a,b)=>a+b,0);
       position.neural={passPrior:Math.exp(logits[160]-max)/total,passRank:1+points.filter(p=>logits[p]>logits[160]).length,
        win:probability[0]/denominator,draw:probability[1]/denominator,loss:probability[2]/denominator};
      }
      search.submit(request,evaluation);
     }
     if(search.result().provenLoss)break;
    }
    const result=search.result();position[endgame?'after':'before']={move:result.move,simulations:result.simulations,
     provenLoss:result.provenLoss,lossMarginLowerBound:result.lossMarginLowerBound,passPolicy:result.policy[160],elapsedMs:performance.now()-start};
    if(endgame&&k>=166){assert.equal(result.move,null);assert.equal(result.provenLoss,true);}
    if(endgame&&k===164)assert.equal(result.provenLoss,false);
    search.cancel();
   }
   report.positions.push(position);console.log(JSON.stringify(position));
  }
  assert.equal((move===null?game.pass():game.play(move)).ok,true);
 }
}finally{search.dispose();await inference.dispose();}
report.summary={checkedPositions:report.positions.length,certifiedPasses:report.positions.filter(p=>p.after.provenLoss).length,
 priorNonPassesAfterCertificate:report.positions.filter(p=>p.after.provenLoss&&p.before.move!==null).length};
if(args.includes('--output'))writeFileSync(arg('--output'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
