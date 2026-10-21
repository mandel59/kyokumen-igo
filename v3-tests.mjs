import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,createTopology} from './dist/engine.js';
import {aiPosition} from './dist/ai-position.js';
import {decodeRecord} from './dist/record.js';
import {createV3Search} from './dist/ai-v3-search.js';
const ai=await createV3Search({load:async()=>readFileSync(new URL('./dist/ai-v3.wasm',import.meta.url))});
const fixture=(kind,size,moves,komi=6.5)=>{
 const game=new Game(createTopology(kind,size),komi);
 for(const m of moves)assert.equal((m<0?game.pass():game.play(m)).ok,true);return game;
};
function reference(game){
 const x=new Float32Array(160*32),legal=new Float32Array(161),mask=new Float32Array(160),n=game.board.length;
 for(let p=0;p<n;p++){
  mask[p]=1;const stone=game.board[p],ns=game.topology.neighbors[p];
  x[p*32+(stone===0?2:stone===game.turn?0:1)]=1;x[p*32+13+(ns.length===4?1:0)]=1;
  x[p*32+30]=ns.filter(q=>game.board[q]===game.turn).length/4;
  x[p*32+31]=ns.filter(q=>game.board[q]===3-game.turn).length/4;
  if(stone){
   const stones=[p],seen=new Set(stones),libs=new Set();
   for(let k=0;k<stones.length;k++)for(const q of game.topology.neighbors[stones[k]]){
    if(!game.board[q])libs.add(q);else if(game.board[q]===stone&&!seen.has(q)){seen.add(q);stones.push(q);}
   }
   const side=stone===game.turn?0:1;
   x[p*32+3+side*4+Math.min(4,Math.max(1,libs.size))-1]=1;
   x[p*32+11+side]=Math.log1p(stones.length)/Math.log1p(n);
  }
  const move=game.analyze(p);
  if(move.ok){legal[p]=1;x[p*32+27]=1;x[p*32+28]=Math.sqrt(move.captured/n);x[p*32+29]=Math.min(8,move.liberties)/8;}
 }
 game.history.slice(1).reverse().slice(0,4).forEach((s,k)=>{if(s.lastMove!==null)x[s.lastMove*32+15+k]=1;});
 game.history.slice(0,-1).reverse().slice(0,4).forEach((s,k)=>s.board.forEach((v,p)=>{
  if(v)x[p*32+19+2*k+(v===game.turn?0:1)]=1;
 }));
 legal[160]=game.ended?0:1;
 return {x,legal,mask};
}
const cases=[
 ...[['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]].map(([kind,size])=>fixture(kind,size,[0,2,5])),
 fixture('torus',7,[17,24,31,18,23,32,0,26,25],.5),
 fixture('torus',7,[1,0,7,48,-1]),
 fixture('torus',7,[17,24,18,25,19,26,31,0,32,1,33,2,23,3]),
];
for(const game of cases){
 const before=JSON.stringify(game.toJSON());ai.start(aiPosition(game));const batch=ai.collect(8),expected=reference(game);
 assert.equal(batch.count,1);
 for(const name of ['x','mask','legal']){
  assert.equal(batch[name].length,expected[name].length);
  for(let k=0;k<expected[name].length;k++)assert.ok(Math.abs(batch[name][k]-expected[name][k])<2e-7,name+' '+k);
 }
 assert.equal(JSON.stringify(game.toJSON()),before);
 assert.throws(()=>ai.collect(),/pending/);
 assert.throws(()=>ai.submit(batch,{policy:new Float32Array(161).fill(NaN),wdl:new Float32Array(3)}),/evaluation/);
 ai.submit(batch,{policy:new Float32Array(161),wdl:new Float32Array(3)});
 const result=ai.result();assert.ok(result.move===null||game.analyze(result.move).ok);
 const pending=ai.collect();ai.cancel();
 if(pending.count)assert.throws(()=>ai.submit(pending,{policy:new Float32Array(pending.count*161),wdl:new Float32Array(pending.count*3)}),/Stale/);
}
// Terminal values are exact even when a neural evaluator strongly favours passing.
for(const komi of [-6.5,0,6.5]){
 const game=fixture('torus',7,[-1],komi);ai.start(aiPosition(game),{seed:3});
 for(let k=0;k<30;k++){
  const batch=ai.collect();if(!batch.count)continue;
  const policy=new Float32Array(batch.count*161).fill(-10),wdl=new Float32Array(batch.count*3);
  for(let b=0;b<batch.count;b++)policy[b*161+160]=10;
  ai.submit(batch,{policy,wdl});
 }
 if(komi>0)assert.equal(ai.result().move,null);
 if(komi<0)assert.notEqual(ai.result().move,null);
 const result=ai.result();assert.ok(result.simulations>20);
 assert.ok(Math.abs(result.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
}
const ko=cases[6];ai.start(aiPosition(ko));const legal=ai.collect().legal;assert.equal(legal[24],0);ai.cancel();
assert.throws(()=>ai.start({...aiPosition(ko),moves:[...aiPosition(ko).moves,24]}),/Illegal AI history/);
assert.throws(()=>ai.collect(),/Start/);
const ended=fixture('sphere',3,[-1,-1]);ai.start(aiPosition(ended));assert.equal(ai.collect().count,0);assert.equal(ai.result().move,null);
// An arbitrarily optimistic policy/value must not override a proven useless invasion.
function forcePolicy(game,target,tactics=true,endgame=false){
 ai.start(aiPosition(game),{seed:3,tactics,endgame});const batch=ai.collect(1);
 const policy=new Float32Array(161).fill(-100);policy[target]=100;
 ai.submit(batch,{policy,wdl:Float32Array.from([100,0,-100])});return ai.result();
}
for(const [kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
 const topology=createTopology(kind,size);
 const target=topology.neighbors.findIndex(ns=>ns.length===4&&ns.every(p=>topology.neighbors[p].length===4));
 const moves=topology.neighbors[target].slice(0,3).flatMap(p=>[-1,p]);
 const game=fixture(kind,size,moves);
 assert.equal(game.analyze(target).liberties,1);
 assert.equal(forcePolicy(game,target,false).move,target,'unprotected search reproduces the mistake');
 const fixed=forcePolicy(game,target);
 assert.equal(fixed.policy[target],0,'certain isolated loss is excluded from root search');
 assert.notEqual(fixed.move,target);assert.ok(fixed.avoidedInvasions>=1);
 assert.equal(game.analyze(target).ok,true,'the Go rule still permits the move');
}
const pocket=fixture('torus',7,[-1,16,-1,30,-1,22,-1,17,-1,31,-1,18,-1,32,-1,26]);
assert.equal(pocket.analyze(24).liberties,2);
assert.equal(forcePolicy(pocket,24).policy[24],0,'two-liberty enclosed invasion has a four-ply refutation');
for(const size of [7,9,11]){
 const topology=createTopology('torus',size),target=Math.floor(size*size/2),region=new Set([target-1,target,target+1]),border=new Set();
 for(const p of region)for(const q of topology.neighbors[p])if(!region.has(q))border.add(q);
 const game=fixture('torus',size,[...border].flatMap(p=>[-1,p]));
 assert.equal(game.analyze(target).liberties,2);
 assert.equal(forcePolicy(game,target).policy[target],0,'capture proof covers every defender reply on torus '+size);
}
const escaping=fixture('torus',7,[-1,17,-1,23]);
assert.equal(forcePolicy(escaping,24).move,24,'two liberties with an open extension are not a proof of death');
function whiteEnclosure(holes){return fixture('torus',7,Array.from({length:49},(_,p)=>p).filter(p=>!holes.includes(p)).flatMap(p=>[-1,p]));}
const twoEyes=whiteEnclosure([16,17,18,23,24,25,40]);
assert.equal(twoEyes.analyze(17).liberties,3);
assert.equal(forcePolicy(twoEyes,17).policy[17],0,'pass-alive vital eye spaces reject even three-liberty invasions');
const oneEye=whiteEnclosure([16,17,18,23,24,25]);
assert.equal(forcePolicy(oneEye,17).move,17,'an unsettled one-eye enclosure remains searchable');
const largeEnclosure=whiteEnclosure([8,9,10,15,16,17,22,23,24,40,45]);
assert.equal(forcePolicy(largeEnclosure,16).move,16,'large enclosed regions are not automatically dead');
const snapback=fixture('torus',7,[38,16,9,17,15,18,10,23,11,25,19,30,22,32,26,-1,29,-1,37,-1,39,-1,33,-1]);
assert.equal(snapback.analyze(24).liberties,1);assert.equal(snapback.analyze(24).captured,0);
assert.equal(forcePolicy(snapback,24).move,24,'a sacrificial snapback remains searchable');
snapback.play(24);assert.equal(snapback.analyze(31).captured,1);snapback.play(31);
assert.equal(snapback.analyze(24).captured,8);
const capturing=cases[8],capturePoint=Array.from(capturing.board,(_,p)=>p).find(p=>capturing.analyze(p).captured>=3);
assert.equal(forcePolicy(capturing,capturePoint).move,capturePoint,'profitable captures remain searchable');
// The reported game must not resume futile play after passing on move 166.
const reported=decodeRecord(JSON.parse(readFileSync(new URL('./tests/fixtures/ai/v3-endgame.json',import.meta.url))).code);
assert.equal(reported.ai,2);assert.equal(reported.game.moves,231);
const replay=new Game(reported.game.topology,reported.game.komi);let checked=0,prevented=0;
for(let k=1;k<reported.game.history.length;k++){
 const move=reported.game.history[k].lastMove;
 if(replay.turn===2&&k>=166){
  const before=JSON.stringify(replay.toJSON()),target=move??27;
  const result=forcePolicy(replay,target,true,true);
  assert.equal(result.move,null,'certified loss keeps passing at move '+k);
  assert.equal(result.provenLoss,true);assert.ok(result.lossMarginLowerBound>=1.5);
  assert.equal(result.policy[160],1);assert.equal(JSON.stringify(replay.toJSON()),before);
  checked++;if(move!==null)prevented++;
 }
 if(move===null)replay.pass();else replay.play(move);
}
assert.equal(checked,33);assert.equal(prevented,31);
// A large raw lead, low liberties or an uncertain neural value is not a loss certificate.
const sparseAlive=fixture('torus',7,[8,9,10,11,12,15,17,19,22,23,24,25,26].flatMap(p=>[-1,p]));
assert.equal(forcePolicy(sparseAlive,0,true,true).move,0,'a living enemy chain is not enough to certify defeat');
for(const game of [oneEye,sparseAlive,escaping,snapback,capturing]){
 ai.start(aiPosition(game));const leaves=ai.collect(1);assert.equal(ai.result().provenLoss,false,'unsettled enemy stones cannot certify a loss');ai.cancel();
}
ai.dispose();ai.dispose();assert.throws(()=>ai.start(aiPosition(ko)),/disposed/);
console.log('v3 WASM: six-board features, captures/superko/history, PUCT, terminal signs, tactics, snapback, 33 reported endgame positions / 31 prevented futile moves, loss-certificate safeguards and disposal passed.');
