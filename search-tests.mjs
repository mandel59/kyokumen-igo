import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,createTopology} from './dist/engine.js';
import {aiPosition} from './dist/ai-position.js';
import {createWasmAI} from './dist/ai-wasm.js';
const study=JSON.parse(readFileSync(new URL('./tools/ai-tuner/experiments/2026-10-21/search-tuning/heldout-vs-greedy-komi-6.5.json',import.meta.url),'utf8'));
const ai=await createWasmAI({load:async()=>readFileSync(new URL('./dist/ai-engine.wasm',import.meta.url))});
const chosenParams=readFileSync(new URL('./tools/ai-tuner/experiments/2026-10-21/search-tuning/robust/params.txt',import.meta.url),'utf8').trim().split(/\s+/).map(Number);
assert.deepEqual(study.playerA.values,chosenParams,'archived match must use the deployed chosen parameters');
const adoption=JSON.parse(readFileSync(new URL('./tools/ai-tuner/experiments/2026-10-21/search-tuning/adoption.json',import.meta.url),'utf8'));
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
let turns=0,searchTurns=0;
const original=JSON.parse(readFileSync(new URL('./tools/ai-tuner/experiments/2026-10-21/search/heldout-d4-greedy.json',import.meta.url),'utf8'));
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
   assert.equal(ai.chooseMove(aiPosition(game),{depth,seed}),move<0?null:move,
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
const ko=fixture(.5,[17,24,31,18,23,32,0,26,25]);
assert.notEqual(ai.chooseMove(aiPosition(ko),{depth:4,seed:23}),24);
for(const depth of [-1,.5,5,NaN])assert.throws(()=>ai.chooseMove(aiPosition(ko),{depth}),/depth/);
ai.dispose();
console.log('Search WASM passed: '+turns+' native/JS replayed turns ('+searchTurns+' search turns), capture, superko, komi-aware pass, bounds and immutable inputs.');
