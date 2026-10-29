import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,createTopology} from './dist/engine.js';
import {aiPosition,AI_BOARDS} from './dist/ai-position.js';
import {decodeRecord} from './dist/record.js';
import {createV3Search} from './dist/ai-v3-search.js';
const ai=await createV3Search({load:async()=>readFileSync(process.env.V3_TEST_WASM??new URL('./dist/ai-v3.wasm',import.meta.url))});
const fixture=(kind,size,moves,komi=6.5)=>{
 const game=new Game(createTopology(kind,size),komi);
 for(const m of moves)assert.equal((m<0?game.pass():game.play(m)).ok,true);return game;
};
function reference(game){
 const x=new Float32Array(160*32),legal=new Float32Array(161),mask=new Float32Array(160),n=game.board.length;
 for(let p=0;p<n;p++){
  mask[p]=1;const stone=game.board[p],ns=game.topology.neighbors[p];
  x[p*32+(stone===0?2:stone===game.turn?0:1)]=1;
  x[p*32+13]=ns.length===3?1:0;x[p*32+14]=ns.length===4?1:0;
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
const ko=fixture('torus',7,[17,24,31,18,23,32,0,26,25],.5);
const capturing=fixture('torus',7,[17,24,18,25,19,26,31,0,32,1,33,2,23,3]);
const cases=[
 ...AI_BOARDS.map(([kind,size])=>fixture(kind,size,[0,2,5])),
 ko,
 ...[7,9,11].map(size=>fixture('plane',size,[1,0,size])),
 fixture('torus',7,[1,0,7,48,-1]),
 capturing,
];
for(const game of cases){
 const before=JSON.stringify(game.toJSON());ai.start(aiPosition(game));const batch=ai.collect(8),expected=reference(game);
 assert.equal(batch.count,1);
 assert.equal(batch.global_features[2],game.topology.kind==='sphere'?1:0);
 assert.equal(batch.global_features[3],game.topology.kind==='torus'?1:0);
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
// A declared fixed budget uses the root finalists as its improved policy.
// Verify the shipped WASM path, not just native root-planner unit tests.
for(const [kind,size] of AI_BOARDS){
 const game=fixture(kind,size,[]);ai.start(aiPosition(game),{seed:3,fpu:1,tactics:false,endgame:false});
 let calls=0;
 while(ai.result().simulations<64){
  const remaining=64-ai.result().simulations,batch=ai.collect(Math.min(8,remaining),remaining);
  if(batch.count)ai.submit(batch,{policy:new Float32Array(batch.count*161),wdl:new Float32Array(batch.count*3)});
  assert.ok(++calls<100,'finite-budget search must make progress');
 }
 const result=ai.result({diagnostics:true});
 assert.equal(result.simulations,64);assert.equal(result.diagnostics.rootVisits,64);
 assert.ok(result.policy.filter(p=>p>0).length<=2,'fixed-budget policy retains only final root candidates');
 assert.ok(Math.abs(result.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
 assert.equal(result.policy[result.move??160],Math.max(...result.policy));
 assert.ok(result.move===null||game.analyze(result.move).ok);ai.cancel();
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
// A first pass that hands the opponent an immediate win must be evaluated
// exactly, even when their network confidently predicts a loss instead.
for(const [kind,size] of AI_BOARDS){
 for(const colour of [1,2])for(const margin of [-0.5,0,0.5]){
  const game=fixture(kind,size,colour===1?[]:[0],0),score=game.score();
  game.komi=score.black-score.white+(colour===1?-margin:margin);
  assert.equal(game.turn,colour);assert.equal(game.passes,0);
  const before=JSON.stringify(game.toJSON());
  ai.start(aiPosition(game),{seed:3,tactics:false,endgame:false,fpu:1});
  const root=ai.collect(1,1),policy=new Float32Array(161).fill(-100);policy[160]=100;
  ai.submit(root,{policy,wdl:new Float32Array(3)});
  const child=ai.collect(1,1);
  if(margin<0){
   assert.equal(child.count,0,'opponent can win by passing: no neural evaluation');
   const result=ai.result({diagnostics:true});
   assert.equal(result.simulations,2,'exact pass consumes one visit');
   assert.equal(result.diagnostics.rawVisits[160],1);
   assert.equal(result.diagnostics.rootQ[160],-1,'losing first pass has exact -1 value');
   assert.equal(result.provenLoss,false,'this does not prove every root move loses');
   assert.equal(result.policy[160],0,'a refuted first pass is excluded while other moves remain unresolved');
   while(ai.result().simulations<64){
    const batch=ai.collect(8,64-ai.result().simulations);
    if(batch.count){
     const p=new Float32Array(batch.count*161).fill(-100),wdl=new Float32Array(batch.count*3);
     for(let b=0;b<batch.count;b++){p[b*161+160]=100;wdl.set([-100,0,100],b*3);}
     ai.submit(batch,{policy:p,wdl});
    }
   }
   assert.notEqual(ai.result().move,null,'do not select a proven losing pass despite adversarial neural evaluations');
   assert.equal(ai.result().simulations,64);
  }else{
   assert.equal(child.count,1,'a draw or loss for the opponent still needs search');
   ai.submit(child,{policy,wdl:Float32Array.from([-100,0,100])});
  }
  assert.equal(JSON.stringify(game.toJSON()),before);ai.cancel();
 }
}
// Plane edges must not wrap. Capturing the corner takes two neighbours, not four.
for(const size of [7,9,11]){
 const corner=fixture('plane',size,[1,0,size]);assert.equal(corner.board[0],0);
 const wrapped=fixture('torus',size,[1,0,size]);assert.equal(wrapped.board[0],2);
 ai.start(aiPosition(corner));const batch=ai.collect();
 for(const [point,degree]of [[0,2],[size-1,2],[size*(size-1),2],[size*size-1,2],[1,3],[size+1,4]]){
  assert.deepEqual(Array.from(batch.x.subarray(point*32+13,point*32+15)),[degree===3?1:0,degree===4?1:0]);
 }
 assert.equal(batch.mask.reduce((a,b)=>a+b,0),size*size);
 assert.deepEqual(Array.from(batch.global_features.subarray(2,4)),[0,0]);ai.cancel();
}
ai.start(aiPosition(ko));const legal=ai.collect().legal;assert.equal(legal[24],0);ai.cancel();
assert.throws(()=>ai.start({...aiPosition(ko),moves:[...aiPosition(ko).moves,24]}),/Illegal AI history/);
assert.throws(()=>ai.collect(),/Start/);
const ended=fixture('sphere',3,[-1,-1]);ai.start(aiPosition(ended));assert.equal(ai.collect().count,0);assert.equal(ai.result().move,null);
// An arbitrarily optimistic policy/value must not override a proven useless invasion.
function forcePolicy(game,target,tactics=true,endgame=false){
 ai.start(aiPosition(game),{seed:3,tactics,endgame});const batch=ai.collect(1);
 const policy=new Float32Array(161).fill(-100);policy[target]=100;
 ai.submit(batch,{policy,wdl:Float32Array.from([100,0,-100])});return ai.result();
}
// Take an immediate win even when the neural policy insists on another move.
for(const [kind,size]of AI_BOARDS){
 for(const colour of [1,2])for(const precedingPass of [true,false])for(const margin of [0.5,0,-0.5]){
  const moves=colour===1?[0,2,5]:[0,2];moves.push(precedingPass?-1:8);
  const game=fixture(kind,size,moves,0),score=game.score();
  game.komi=score.black-score.white+(colour===1?-margin:margin);
  assert.equal(game.turn,colour);assert.equal(game.passes,precedingPass?1:0);
  const target=Array.from(game.board,(_,p)=>p).find(p=>game.analyze(p).ok);
  assert.notEqual(target,undefined);
  const before=JSON.stringify(game.toJSON()),result=forcePolicy(game,target,false,false);
  if(precedingPass&&margin>0){
   assert.equal(result.move,null,'a winning second pass overrides neural policy on '+kind+size+' colour '+colour);
   assert.equal(result.policy[160],1);assert.equal(result.provenLoss,false);
   const ended=Game.fromJSON(game.toJSON());assert.equal(ended.pass().ok,true);
   assert.equal(ended.ended,true);assert.equal(ended.score().winner,colour);
  }else assert.equal(result.move,target,'first passes, draws and losses must remain searchable');
  assert.equal(JSON.stringify(game.toJSON()),before);
 }
}
for(const [kind,size]of AI_BOARDS){
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
// Keep the tactical fixture drawn; otherwise the preceding pass already offers a win.
const snapbackScore=snapback.score();snapback.komi+=snapbackScore.black-snapbackScore.white;
assert.equal(snapback.score().winner,0);
assert.equal(snapback.analyze(24).liberties,1);assert.equal(snapback.analyze(24).captured,0);
assert.equal(forcePolicy(snapback,24).move,24,'a sacrificial snapback remains searchable');
snapback.play(24);assert.equal(snapback.analyze(31).captured,1);snapback.play(31);
assert.equal(snapback.analyze(24).captured,8);
const capturePoint=Array.from(capturing.board,(_,p)=>p).find(p=>capturing.analyze(p).captured>=3);
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
// A half-point loss on a settled board must not turn into filling one's own eyes.
const planeRecord=decodeRecord(JSON.parse(readFileSync(new URL('./tests/fixtures/ai/v3-plane-endgame.json',import.meta.url))).code).game;
assert.equal(planeRecord.moves,189);
const atPlaneMove=ply=>Game.fromJSON({...planeRecord.toJSON(),history:planeRecord.history.slice(0,ply+1)});
for(const ply of [149,153,155,157]){
 const game=atPlaneMove(ply),before=JSON.stringify(game.toJSON()),target=planeRecord.history[ply+1].lastMove;
 const result=forcePolicy(game,target,true,true);
 assert.equal(result.move,null,'accept the settled half-point loss after move '+ply);
 assert.equal(result.policy[160],1);assert.equal(result.settledPass,true);assert.equal(result.decisionReason,'settled-position');
 assert.equal(result.provenLoss,false,'settlement is separate from the stone-count loss bound');
 assert.equal(JSON.stringify(game.toJSON()),before);
}
const beforeEyeFill=atPlaneMove(157);
for(const eye of [12,96]){ // B10 and J3 in the app's column-major point numbering.
 assert.equal(beforeEyeFill.analyze(eye).ok,true);
 assert.equal(forcePolicy(beforeEyeFill,eye,false,false).move,eye,'unguarded policy can reproduce eye filling');
 assert.equal(forcePolicy(beforeEyeFill,eye,true,false).policy[eye],0,'preserve a certified living chain even without settlement passing');
}
// A surrounded connection between uncertified chains is not an expendable eye.
const connection=fixture('torus',7,[17,-1,23,-1,25,-1,31,-1]);
const connectionScore=connection.score();connection.komi+=connectionScore.black-connectionScore.white;
assert.equal(forcePolicy(connection,24,true,false).move,24,'retain connections between unsettled friendly chains');
// Force the network to prefer self-destruction: both colours and every topology must still stop.
for(const [kind,size] of AI_BOARDS){
 const topology=createTopology(kind,size),n=topology.vertices.length;
 const second=topology.neighbors.findIndex((_,p)=>p!==0&&!topology.neighbors[0].includes(p));
 for(const colour of [1,2])for(const deficit of [0,0.5]){
  const moves=Array.from({length:n},(_,p)=>p).filter(p=>p!==0&&p!==second).flatMap(p=>colour===1?[p,-1]:[-1,p]);
  const game=fixture(kind,size,moves);
  if(game.turn!==colour)assert.equal(game.pass().ok,true);
  const score=game.score();game.komi+=score.black-score.white+(colour===1?deficit:-deficit);
  const before=JSON.stringify(game.toJSON()),result=forcePolicy(game,0,false,true);
  assert.equal(result.move,null,'settled losing pass overrides adversarial policy on '+kind+size+' colour '+colour);
  assert.equal(result.settledPass,true);assert.equal(result.policy[160],1);
  const ended=Game.fromJSON(game.toJSON());ended.pass();assert.equal(ended.ended,true);assert.equal(ended.score().margin,deficit);
  assert.equal(JSON.stringify(game.toJSON()),before);
 }
}
ai.dispose();ai.dispose();assert.throws(()=>ai.start(aiPosition(ko)),/disposed/);
console.log('v3 WASM: nine-board features, plane corners/edge captures, captures/superko/history, PUCT, terminal signs, nine-board / both-colour immediate winning passes against adversarial policy, exact internal pass proofs / refuted first passes at 64 visits, finite-budget root finalists on nine boards, first-pass/draw/loss controls, tactics, snapback, 33 reported endgame positions / 31 prevented futile moves, loss-certificate safeguards, reported plane half-point settlement, certified eye preservation, nine-board/both-colour settled passes/draws and disposal passed.');
