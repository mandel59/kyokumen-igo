import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {createOfflineAI} from './offline-player.mjs';
const wasm=readFileSync('dist/ai-v3.wasm');
const evaluation=batch=>({policy:Float32Array.from({length:batch.count*161},(_,i)=>i%161===160?-10:-.01*(i%161)),wdl:new Float32Array(batch.count*3)});
const make=(extra={})=>createOfflineAI({createSearch:()=>createV3Search({load:async()=>wasm}),createInference:async()=>({backend:'mock',batchSize:8,manifest:{search:{fpu:1}},async evaluate(b){return evaluation(b);},async dispose(){}}),...extra});
const player=await make();
try{
 for(const[kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  const game=new Game(createTopology(kind,size),6.5);
  for(const visits of [1,65,1024]){const r=await player.chooseMove(aiPosition(game),{seed:3,maxSimulations:visits});assert.equal(r.simulations,visits);assert.ok(r.move===null||game.analyze(r.move).ok);assert.ok(Math.abs(r.policy.reduce((a,b)=>a+b,0)-1)<1e-5);}
  game.play(0);game.pass();const score=game.score();game.komi=score.black-score.white-.5;
  const r=await player.chooseMove(aiPosition(game),{seed:3,maxSimulations:4096});assert.equal(r.move,null);assert.equal(r.simulations,4096);assert.equal(r.policy[160],1);
 }
 const position=aiPosition(new Game(createTopology('torus',7),6.5));
 for(const maxSimulations of [undefined,0,-1,1.5,NaN,Infinity,0x100000000])await assert.rejects(player.chooseMove(position,{maxSimulations}),/budget/);
 await assert.rejects(player.chooseMove(position,{maxSimulations:64,budgetMs:100}),/budget/);
 const first=player.chooseMove(position,{maxSimulations:64});await assert.rejects(player.chooseMove(position,{maxSimulations:64}),/already running/);await first;
}finally{await player.dispose();}
const position=aiPosition(new Game(createTopology('torus',7),6.5));await assert.rejects(player.chooseMove(position,{maxSimulations:64}),/disposed/);
let release,hold=true;
const cancellable=await make({createInference:async()=>({backend:'mock',batchSize:8,async evaluate(b){if(hold){hold=false;await new Promise(r=>{release=r;});}return evaluation(b);},async dispose(){}})});
try{const pending=cancellable.chooseMove(position,{maxSimulations:64});cancellable.cancel();release();await assert.rejects(pending,/cancelled/);assert.equal((await cancellable.chooseMove(position,{maxSimulations:64})).simulations,64);}finally{await cancellable.dispose();}
const stalled=await make({createSearch:async()=>({start(){},result(){return{simulations:0,provenLoss:false};},collect(){return{count:0};},cancel(){},dispose(){}})});
try{await assert.rejects(stalled.chooseMove(position,{maxSimulations:64}),/stalled/);}finally{await stalled.dispose();}
console.log('Offline player: six boards, exact1/65/1024 visits,4096 cached proof visits without false stalls, legality, cancellation/reuse, overlap, disposal and invalid budgets passed.');
