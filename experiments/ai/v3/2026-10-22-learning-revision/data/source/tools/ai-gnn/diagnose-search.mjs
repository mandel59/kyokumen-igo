// Compare all FPU variants on exactly the same development roots and neural evaluations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
const directory='experiments/ai/v3/2026-10-22-learning-revision/data';
const sourceName=existsSync(directory+'/search-s1.json')?'search-s1.json':'search-s1.json.gz';
const source=JSON.parse(sourceName.endsWith('.gz')?gunzipSync(readFileSync(directory+'/'+sourceName)):readFileSync(directory+'/'+sourceName,'utf8'));
assert.equal(source.summary.completed,96);
const bytes=readFileSync('dist/ai-v3.wasm'),search=await createV3Search({load:async()=>bytes});
const inference=await createNodeInference(directory+'/baseline-model');
const report={schemaVersion:1,source:sourceName,model:inference.manifest.sha256,
 wasm:createHash('sha256').update(bytes).digest('hex'),seed:2026102212,visits:128,rootNoise:false,
 condition:'Same roots from first two development games per board; fixed neural model, same seed, no root noise. Timing is not isolated.',roots:[]};
try{
 for(const board of source.boards){
  const topology=createTopology(board.kind,board.size),n=topology.vertices.length,adjacency=adjacencyFor(topology);
  for(let gameIndex=0;gameIndex<2;gameIndex++){
   const recorded=board.games[gameIndex];
   for(const ply of[Math.floor(n*.25),Math.floor(n*.75),n+4]){
    if(ply>=recorded.moves.length)continue;
    const game=new Game(topology,6.5);for(const move of recorded.moves.slice(0,ply))assert.ok((move===-1?game.pass():game.play(move)).ok);
    const root={board:board.kind+board.size,game:gameIndex,ply,phase:ply<n/2?'opening':ply<n?'middle':'late',variants:[]};
    for(const fpu of[0,1,2]){
     search.start(aiPosition(game),{fpu,seed:report.seed});let initial,legal;
     while(search.result().simulations<128){
      const leaves=search.collect();
      if(leaves.count){
       const evaluation=await inference.evaluate(leaves,adjacency);
       if(initial===undefined){
        const w=Array.from(evaluation.wdl.slice(0,3)),max=Math.max(...w),e=w.map(v=>Math.exp(v-max));
        initial=(e[0]-e[2])/e.reduce((a,b)=>a+b,0);legal=leaves.legal.reduce((a,b)=>a+b,0);
       }
       search.submit(leaves,evaluation);
      }
      if(search.result().provenLoss)break;
     }
     const result=search.result({diagnostics:true});
     if(result.provenLoss)break;
     root.neuralValue=initial;root.legalMoves=legal;
     const p=Array.from(result.policy),visits=result.diagnostics.rawVisits,total=visits.reduce((a,b)=>a+b,0);
     root.variants.push({fpu,move:result.move,simulations:result.simulations,support:p.filter(v=>v>0).length,
      singleVisitMass:visits.filter(v=>v===1).length/total,maxProbability:Math.max(...p),
      entropy:-p.reduce((s,v)=>s+(v>0?v*Math.log(v):0),0),...result.diagnostics});
    }
    if(root.variants.length===3)report.roots.push(root);
   }
  }
 }
}finally{search.dispose();await inference.dispose();}
report.groups={};
for(const phase of['opening','middle','late','all'])for(const value of['losing','uncertain','winning','all']){
 const roots=report.roots.filter(r=>(phase==='all'||r.phase===phase)&&(value==='all'||value==='losing'&&r.neuralValue<-.5||value==='winning'&&r.neuralValue>.5||value==='uncertain'&&Math.abs(r.neuralValue)<=.5));
 if(!roots.length)continue;
 report.groups[phase+'/'+value]={roots:roots.length,meanLegalMoves:roots.reduce((s,r)=>s+r.legalMoves,0)/roots.length,
  variants:[0,1,2].map(fpu=>Object.fromEntries([['fpu',fpu],...['support','singleVisitMass','maxProbability','entropy','unvisitedSelections'].map(k=>[k,roots.reduce((s,r)=>s+r.variants[fpu][k],0)/roots.length])]))};
}
writeFileSync(directory+'/search-diagnostics.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.groups));
