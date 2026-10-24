import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,createTopology} from './dist/engine.js';
import {aiPosition} from './dist/ai-position.js';
import {createWasmAI} from './dist/ai-wasm.js';
import {createJSAI} from './dist/ai-js.js';
import {createV3Search} from './dist/ai-v3-search.js';
import {decodeRecord} from './dist/record.js';
const study=JSON.parse(readFileSync(new URL('./experiments/ai/v2/2026-10-21-tuning/data/heldout-vs-greedy-komi-6.5.json',import.meta.url),'utf8'));
const ai=await createWasmAI({load:async()=>readFileSync(new URL('./dist/ai-engine.wasm',import.meta.url))});
const guard=await createV3Search({load:async()=>readFileSync(new URL('./dist/ai-v3.wasm',import.meta.url))});
function certified(game){
 guard.start(aiPosition(game),{tactics:false});guard.collect(1);
 const proven=guard.result().provenLoss;guard.cancel();return proven;
}
const chosenParams=readFileSync(new URL('./experiments/ai/v2/2026-10-21-tuning/data/robust/params.txt',import.meta.url),'utf8').trim().split(/\s+/).map(Number);
assert.deepEqual(study.playerA.values,chosenParams,'archived match must use the deployed chosen parameters');
const adoption=JSON.parse(readFileSync(new URL('./experiments/ai/v2/2026-10-21-tuning/data/adoption.json',import.meta.url),'utf8'));
const mask=(1n<<64n)-1n;
function rng(seed) {
 let state=(seed^0x6a09e667f3bcc909n)&mask;
 return ()=>{
  state=(state+0x9e3779b97f4a7c15n)&mask;let z=state;
  z=((z^(z>>30n))*0xbf58476d1ce4e5b9n)&mask;
  z=((z^(z>>27n))*0x94d049bb133111ebn)&mask;
  return z^(z>>31n);
 };
}
let turns=0,searchTurns=0,certifiedRoots=0,winningPassRoots=0;
const original=JSON.parse(readFileSync(new URL('./experiments/ai/v2/2026-10-21-initial/data/heldout-d4-greedy.json',import.meta.url),'utf8'));
for(const [data,onlyOriginal]of [[study,false],[original,true]]){
for(const [config,board] of data.boards.entries()){
 const points=board.kind==='sphere'?6*board.size**2+2:board.size**2;
 const adopted=adoption.tunedPoints.includes(points);
 if(onlyOriginal?adopted:!adopted)continue;
 const master=rng(((BigInt(data.seed)*0x100000001b3n)&mask)^(BigInt(config)<<40n));
 const a=master(),b=master();
 for(const [index,example] of board.examples.entries()){
  const game=new Game(createTopology(board.kind,board.size),data.komi);
  const black=rng(index===0?a:b),white=rng(index===0?b:a);
  const blackDepth=index===0?data.depthA:data.depthB;
  const whiteDepth=index===0?data.depthB:data.depthA;
  for(const move of example.moves){
   const seed=Number((game.turn===1?black():white())&0xffffffffn);
   const depth=game.turn===1?blackDepth:whiteDepth;
   const before=JSON.stringify(game.toJSON());
   const proven=depth>0&&certified(game);if(proven)certifiedRoots++;
   const winningPass=depth>0&&game.passes===1&&game.score().winner===game.turn;if(winningPass)winningPassRoots++;
   assert.equal(ai.chooseMove(aiPosition(game),{depth,seed}),winningPass||proven||move<0?null:move,
     board.kind+' '+board.size+' '+game.moves+' depth '+depth);
   assert.equal(JSON.stringify(game.toJSON()),before);
   assert.equal((move<0?game.pass():game.play(move)).ok,true);
   turns++;if(depth)searchTurns++;
  }
  assert.equal(game.ended,example.ended);
  assert.equal(game.score().black-game.score().white+game.komi,example.margin);
 }
}
}
function fixture(komi,moves){
 const game=new Game(createTopology('torus',7),komi);
 for(const move of moves)assert.equal((move<0?game.pass():game.play(move)).ok,true);
 return game;
}
const capture=fixture(6.5,[17,24,18,25,19,26,31,0,32,1,33,2,23,3]);
const chosen=ai.chooseMove(aiPosition(capture),{depth:4,seed:19});
assert.ok(capture.analyze(chosen).captured>=3);
assert.equal(ai.chooseMove(aiPosition(fixture(6.5,[-1])),{depth:4,seed:1}),null);
assert.notEqual(ai.chooseMove(aiPosition(fixture(-6.5,[-1])),{depth:4,seed:1}),null);
const js=await createJSAI();
for(const [kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
 for(const colour of [1,2]){
  const game=new Game(createTopology(kind,size),0),moves=colour===1?[0,2,5,-1]:[0,2,-1];
  for(const move of moves)assert.equal((move<0?game.pass():game.play(move)).ok,true);
  const score=game.score();game.komi=score.black-score.white+(colour===1?-0.5:0.5);
  const before=JSON.stringify(game.toJSON());
  for(const depth of [1,2,3,4])for(const seed of [0,3,0xffffffff])for(const backend of [ai,js]){
   assert.equal(backend.chooseMove(aiPosition(game),{depth,seed}),null,'accept the immediate win on '+kind+size+' colour '+colour);
  }
  assert.equal(JSON.stringify(game.toJSON()),before);
  const ended=Game.fromJSON(game.toJSON());assert.equal(ended.pass().ok,true);
  assert.equal(ended.ended,true);assert.equal(ended.score().winner,colour);
 }
}
js.dispose();
const ko=fixture(.5,[17,24,31,18,23,32,0,26,25]);
assert.notEqual(ai.chooseMove(aiPosition(ko),{depth:4,seed:23}),24);
for(const depth of [-1,.5,5,NaN])assert.throws(()=>ai.chooseMove(aiPosition(ko),{depth}),/depth/);
const record=decodeRecord(JSON.parse(readFileSync(new URL('./tests/fixtures/ai/v3-endgame.json',import.meta.url))).code).game;
const replay=new Game(record.topology,record.komi);let checked=0;
for(let ply=1;ply<record.history.length;ply++){
 if(replay.turn===2&&ply>=166){
  const before=JSON.stringify(replay.toJSON());
  for(const depth of [1,2,3,4])assert.equal(ai.chooseMove(aiPosition(replay),{depth,seed:3}),null,'certified pass at move '+ply+' depth '+depth);
  assert.equal(JSON.stringify(replay.toJSON()),before);checked++;
 }
 const move=record.history[ply].lastMove;assert.equal((move===null?replay.pass():replay.play(move)).ok,true);
}
assert.equal(checked,33);guard.dispose();
ai.dispose();
console.log('Kyokugo AI v2 WASM passed: '+turns+' archived turns ('+searchTurns+' search turns, '+certifiedRoots+' certified-loss roots, '+winningPassRoots+' winning-pass roots), unchanged choices outside forced passes, six-board / both-colour winning passes in WASM and generated JS, 33 reported endgame roots at depths1..4, capture, superko, bounds and immutable inputs.');
