import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {validateManifest} from '../../dist/ai-v3-inference.js';
const manifest=JSON.parse(readFileSync('dist/models/v3/manifest.json','utf8'));
for(const fpu of[0,1,2])assert.doesNotThrow(()=>validateManifest({...manifest,search:{fpu}}));
for(const search of[null,{},'bad',{fpu:-1},{fpu:3},{fpu:'1'}])assert.throws(()=>validateManifest({...manifest,search}),/search manifest/);
const before=await createV3Search({load:async()=>readFileSync('experiments/ai/v3/2026-10-22-learning-revision/data/baseline-search.wasm')});
const after=await createV3Search({load:async()=>readFileSync('dist/ai-v3.wasm')});
function evaluation(leaves){
 const policy=new Float32Array(leaves.count*161),wdl=new Float32Array(leaves.count*3);
 for(let b=0;b<leaves.count;b++){
  for(let p=0;p<161;p++)policy[b*161+p]=-.02*p;
  wdl.set([-1.2,.4,.7],b*3);
 }return{policy,wdl};
}
let positions=0;
try{
 for(const[kind,size]of[['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const game=new Game(createTopology(kind,size),6.5);
  for(let ply=0;ply<=32;ply++){
   if([0,4,16,32].includes(ply)){
    const position=aiPosition(game);before.start(position,{seed:123});after.start(position,{seed:123,fpu:0});
    while(before.result().simulations<128){
     const a=before.collect(),b=after.collect();
     for(const key of ['count','ids','x','global_features','mask','legal'])assert.deepEqual(a[key],b[key],kind+size+' '+key);
     if(a.count){const e=evaluation(a);before.submit(a,e);after.submit(b,e);}
    }
    const a=before.result(),b=after.result({diagnostics:true});
    for(const key of ['move','policy','simulations','avoidedInvasions','provenLoss','lossMarginLowerBound'])assert.deepEqual(a[key],b[key],key);
    assert.equal(b.diagnostics.rawVisits.reduce((a,b)=>a+b,0),b.simulations-1);
    for(const fpu of[1,2]){
     after.start(position,{seed:123,fpu});
     while(after.result().simulations<128){const leaves=after.collect();if(leaves.count)after.submit(leaves,evaluation(leaves));}
     const r=after.result({diagnostics:true});assert.ok(r.policy.every(Number.isFinite));
     assert.ok(Math.abs(r.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
     assert.ok(r.move===null||game.analyze(r.move).ok);
    }
    positions++;
   }
   if(ply===32)break;
   const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);
   assert.ok((legal.length?game.play(legal[(ply*17+3)%legal.length]):game.pass()).ok);
  }
 }
}finally{before.dispose();after.dispose();}
const report={schemaVersion:1,positions,boards:6,baselineModeExactParity:true,fpuVariantsFiniteAndLegal:true};
writeFileSync('experiments/ai/v3/2026-10-22-learning-revision/data/search-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
