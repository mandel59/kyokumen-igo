// Analyze paired self-play scores and verify sample games against production WASM.
// Input defaults to the Rust runner's output in target/komi-study/scores.json.
import fs from 'node:fs';
import {outputPath,writeReport} from './experiment-paths.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createTopology,Game} from '../../dist/engine.js';
import {AI_WEIGHTS} from './legacy-v1.mjs';
import {aiPosition} from '../../dist/ai-position.js';
import {createWasmAI} from '../../dist/ai-wasm.js';
const root=new URL('./',import.meta.url);
const input=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:new URL('target/komi-study/scores.json',root);
const study=JSON.parse(fs.readFileSync(input,'utf8'));
assert.deepEqual(study.weights,AI_WEIGHTS);
const wasm=await createWasmAI({load:async()=>fs.readFileSync(new URL('../../dist/ai-engine.wasm',root))});
const mask=(1n<<64n)-1n;
function rng(seed) {
  let state=(seed^0x6a09e667f3bcc909n)&mask;
  return ()=>{
    state=(state+0x9e3779b97f4a7c15n)&mask;
    let z=state;
    z=((z^(z>>30n))*0xbf58476d1ce4e5b9n)&mask;
    z=((z^(z>>27n))*0x94d049bb133111ebn)&mask;
    return z^(z>>31n);
  };
}
let verifiedMoves=0;
for(const [index,board] of study.boards.entries()) {
  const master=rng(((BigInt(study.seed)*0x100000001b3n)&mask)^(BigInt(index)<<40n));
  const a=master(),b=master();
  for(const [exampleIndex,example] of board.examples.entries()) {
    const black=rng(exampleIndex===0?a:b),white=rng(exampleIndex===0?b:a);
    const game=new Game(createTopology(board.kind,board.size),0);
    for(const move of example.moves) {
      const seed=Number((game.turn===1?black():white())&0xffffffffn);
      assert.equal(wasm.chooseMove(aiPosition(game),{seed}),move===-1?null:move,
        board.kind+' '+board.size+' move '+game.moves);
      assert.equal((move===-1?game.pass():game.play(move)).ok,true);
      verifiedMoves++;
    }
    const score=game.score();
    assert.equal(score.black-score.white,example.margin);
    assert.equal(game.ended,example.ended);
  }
}
wasm.dispose();
function pairedEstimate(pairs,fn) {
  const values=pairs.map(([a,b])=>(fn(a)+fn(b))/2);
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const variance=values.reduce((s,x)=>s+(x-mean)**2,0)/(values.length-1);
  const half=1.96*Math.sqrt(variance/values.length);
  return {value:mean,ci95:[mean-half,mean+half]};
}
function medianHistogram(hist,offset,n) {
  const left=n/2-1,right=n/2;
  let sum=0,a;
  for(let i=0;i<hist.length;i++) {
    sum+=hist[i];
    if(a===undefined&&sum>left)a=i-offset;
    if(sum>right)return (a+i-offset)/2;
  }
  throw Error('empty histogram');
}
function bootstrapMedian(pairs,points,seed,repetitions=2000) {
  let state=seed;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  const medians=[];
  for(let round=0;round<repetitions;round++) {
    const hist=new Int32Array(2*points+1);
    for(let i=0;i<pairs.length;i++) {
      const [a,b]=pairs[Math.floor(random()*pairs.length)];
      hist[a+points]++;hist[b+points]++;
    }
    medians.push(medianHistogram(hist,points,pairs.length*2));
  }
  medians.sort((a,b)=>a-b);
  return [medians[Math.floor(repetitions*.025)],medians[Math.ceil(repetitions*.975)-1]];
}
const rows=study.boards.map((board,index)=>{
  const {pairMargins:pairs,points}=board;
  assert.equal(pairs.length,study.pairsPerBoard);
  assert.equal(board.capped,0,'only naturally ended games are used');
  const hist=new Int32Array(points*2+1);
  for(const pair of pairs)for(const margin of pair) {
    assert.ok(Number.isInteger(margin)&&Math.abs(margin)<=points);
    hist[margin+points]++;
  }
  const games=pairs.length*2;
  const median=medianHistogram(hist,points,games);
  const histogram=Array.from(hist,(count,i)=>[i-points,count]).filter(([,n])=>n);
  const komiRates=[];
  for(let k=-.5;k<=9.5;k+=.5) {
    const win=pairedEstimate(pairs,d=>Number(d>k));
    const draw=hist[k+points]??0;
    const score=pairedEstimate(pairs,d=>d>k?1:d===k?.5:0);
    komiRates.push({komi:k,blackWin:win,drawRate:draw/games,blackScore:score});
  }
  const bestUI=komiRates.filter(r=>r.komi>=.5&&r.komi%1===.5)
    .reduce((a,b)=>Math.abs(a.blackWin.value-.5)<=Math.abs(b.blackWin.value-.5)?a:b);
  const row={kind:board.kind,size:board.size,points,games,capped:board.capped,
    meanMoves:board.totalMoves/games,meanMargin:pairedEstimate(pairs,d=>d),
    medianMargin:median,medianCI95:bootstrapMedian(pairs,points,study.seed+index),
    histogram,komiRates,bestUI};
  console.log(JSON.stringify({kind:row.kind,size:row.size,median,medianCI95:row.medianCI95,
    mean:row.meanMargin.value,meanCI95:row.meanMargin.ci95,
    blackWin6_5:komiRates.find(k=>k.komi===6.5).blackWin,
    bestUI:{komi:bestUI.komi,blackWin:bestUI.blackWin.value},
    at1:komiRates.find(k=>k.komi===1)}));
  return row;
});
const sha256={};
for(const name of ['experiment-paths.mjs','src/ai.rs','src/board.rs','src/rng.rs','komi-study.rs','komi-study.mjs',
  '../../dist/ai-engine.wasm','../../dist/ai-wasm.js']) {
  sha256[name]=createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex');
}
const report={date:'2026-10-21',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  seed:study.seed,pairsPerBoard:study.pairsPerBoard,gamesPerBoard:study.pairsPerBoard*2,
  totalGames:study.pairsPerBoard*12,workers:study.workers,elapsedSeconds:study.elapsedSeconds,
  methodology:{komiDuringPlay:0,limitFactor:study.limitFactor,noise:'shipped WASM policy: a fresh 32-bit seed per turn',
    pairing:'swap the two player noise streams between black and white',
    meanAndWinCI:'normal approximation from independent pair means',
    medianCI:'2000 paired bootstrap resamples; percentile 2.5% and 97.5%',
    verifiedExampleGames:study.boards.length*2,verifiedExampleMoves:verifiedMoves},
  weights:study.weights,sha256,boards:rows};
writeReport(outputPath('target/komi-study/summary.json'),report);
console.log('Verified '+verifiedMoves+' moves and scores in 12 full games against production WASM / JS.');
