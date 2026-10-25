import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Game,createTopology} from '../../../../dist/engine.js';
import {aiPosition} from '../../../../dist/ai-position.js';
import {createV3Search} from '../../../../dist/ai-v3-search.js';
const dir='tools/ai-gnn/target/teacher-search-study',rows=[];
for(const mode of ['sh8','sh32','all','puct']){
 const search=await createV3Search({load:async()=>fs.readFileSync(dir+'/'+mode+'.wasm')});
 try{for(const[kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const game=new Game(createTopology(kind,size),6.5);for(let k=0;k<7;k++){const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);game.play(legal[(k*17+3)%legal.length]);}
  for(const budget of [65,1024,4096]){
   search.start(aiPosition(game),{seed:3,fpu:1});let stalled=0;
   while(search.result().simulations<budget){
    const before=search.result().simulations,b=search.collect(Math.min(8,budget-before),budget-before);
    if(b.count)search.submit(b,{policy:Float32Array.from({length:b.count*161},(_,i)=>i%161===160?-8:0),wdl:new Float32Array(b.count*3)});
    if(search.result().simulations===before)assert.ok(++stalled<16);else stalled=0;
   }
   const r=search.result({diagnostics:true}),visited=r.diagnostics.rawVisits.filter(v=>v>0).length,available=r.diagnostics.rootPriors.filter(v=>v>0).length,support=r.policy.filter(v=>v>0).length;
   assert.equal(r.simulations,budget);assert.ok(r.move===null||game.analyze(r.move).ok);assert.ok(Math.abs(r.policy.reduce((s,v)=>s+v,0)-1)<1e-5);
   if(mode==='sh8')assert.ok(visited<=8);if(mode==='sh32')assert.ok(visited<=32);
   if(mode==='all'&&budget>=1024)assert.equal(visited,available);
   if(mode==='puct'&&budget>=1024)assert.ok(visited>=16&&support>=16,'PUCT must actually use a broad visit policy');
   rows.push({mode,board:kind+size,budget,visited,available,support});
  }
 }}finally{search.dispose();}
 console.log('Validated',mode);
}
fs.writeFileSync(dir+'/mode-validation.json',JSON.stringify({schemaVersion:1,rows},null,2)+'\n');
