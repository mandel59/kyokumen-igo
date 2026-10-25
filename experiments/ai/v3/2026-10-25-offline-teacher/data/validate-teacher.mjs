import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createV3Search} from '../../../../dist/ai-v3-search.js';
import {Game,createTopology} from '../../../../dist/engine.js';
import {aiPosition} from '../../../../dist/ai-position.js';
const search=await createV3Search({load:async()=>fs.readFileSync('tools/ai-gnn/target/offline-teacher/sh32.wasm')});
const rows=[];
try{
 for(const [kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const game=new Game(createTopology(kind,size),6.5);
  for(let k=0;k<7;k++){const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);game.play(legal[(k*17+3)%legal.length]);}
  for(const visits of [65,1024]){
   search.start(aiPosition(game),{seed:11,fpu:1});let calls=0;
   while(search.result().simulations<visits){
    const b=search.collect(Math.min(8,visits-search.result().simulations),visits-search.result().simulations);
    if(b.count)search.submit(b,{policy:Float32Array.from({length:b.count*161},(_,i)=>Math.sin(i%161)),wdl:new Float32Array(b.count*3)});
    assert.ok(++calls<visits+32);
   }
   const r=search.result({diagnostics:true});assert.equal(r.simulations,visits);assert.ok(Math.abs(r.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
   assert.ok(r.move===null||game.analyze(r.move).ok);
   const visited=r.diagnostics.rawVisits.filter(v=>v>0).length;assert.ok(visited>=16,'Teacher must really expand a broader root');
   if(visits===1024)assert.ok(r.policy.filter(v=>v>0).length<=2);
   rows.push({board:kind+size,visits,visitedRootActions:visited,policySupport:r.policy.filter(v=>v>0).length,move:r.move});
  }
 }
}finally{search.dispose();}
fs.writeFileSync('tools/ai-gnn/target/offline-teacher/teacher-validation.json',JSON.stringify({schemaVersion:1,rows},null,2)+'\n');console.log('Broader teacher search: six boards, exact65/1024 visits, legal moves, expanded root and normalized policy passed.');
