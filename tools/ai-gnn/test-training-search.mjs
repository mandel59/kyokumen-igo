import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {runTrainingSearch,trainingTarget,legalPrior} from './training-search.mjs';
const inference={async evaluate(batch){return {policy:Float32Array.from({length:batch.count*161},(_,i)=>Math.sin(i%161)),wdl:new Float32Array(batch.count*3)};}};
const search=await createV3Search({load:async()=>readFileSync('dist/ai-v3.wasm')});
try{
 for(const [kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]])for(const visits of[2,63,64,65]){
  const game=new Game(createTopology(kind,size),6.5);search.start(aiPosition(game),{fpu:1});
  const r=await runTrainingSearch(search,inference,null,{visits});assert.equal(r.simulations,visits);assert.ok(r.root);assert.ok(r.prior);
  const target=trainingTarget(r.policy,r.prior);assert.ok(Math.abs(target.policy.reduce((a,b)=>a+b,0)-1)<1e-6);
  for(let i=0;i<161;i++){if(!r.root.legal[i])assert.equal(target.policy[i],0);assert.ok(target.policy[i]>=.25*r.prior[i]-1e-7);}
  assert.ok(Number.isFinite(target.policySurprise));if(visits>=63)assert.ok(Array.from(r.policy).filter(v=>v>0).length<=2);
 }
 for(const [kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const won=new Game(createTopology(kind,size),6.5);won.play(0);won.pass();const score=won.score();won.komi=score.black-score.white-.5;
  search.start(aiPosition(won),{fpu:1});const exact=await runTrainingSearch(search,inference,null,{visits:4096});assert.equal(exact.simulations,4096);assert.equal(exact.move,null);assert.equal(exact.policy[160],1);
 }
 const game=new Game(createTopology('torus',7),6.5);search.start(aiPosition(game),{fpu:0});
 const legacy=await runTrainingSearch(search,inference,null,{visits:65,mode:'puct'});assert.equal(legacy.simulations,65);
 assert.deepEqual(legalPrior(Float32Array.of(1000,0,1000),[1,0,1]),[.5,0,.5]);
 assert.equal(trainingTarget([.5,.5],[.5,.5]).policySurprise,0);
 assert.throws(()=>trainingTarget([1,0],[.5,.5],NaN));
}finally{search.dispose();}
console.log('Training search: all six boards, exact odd/even budgets, halving support, legal smoothed targets and finite surprise passed.');
