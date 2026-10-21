// node experiments/ai/v3/2026-10-22-learning/data/reproduce-summary.mjs
// Writes JSON to stdout; never modifies the archived measurements.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
function match(name){
 const r=read(name),games=r.boards.flatMap(b=>b.games);
 assert.ok(games.every(g=>g.ended),'Incomplete match');
 return {games:games.length,wins:games.filter(g=>g.aScore===1).length,draws:games.filter(g=>g.aScore===.5).length,
  losses:games.filter(g=>g.aScore===0).length,score:games.reduce((s,g)=>s+g.aScore,0),capped:0,
  boards:r.boards.map(b=>({board:b.kind+b.size,games:b.games.length,score:b.games.reduce((s,g)=>s+g.aScore,0),pairScores:b.pairScores})),
  metrics:r.summary.metrics};
}
const final=match('final-match.json');assert.equal(final.games,48);
let seed=20261251;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
const bootstrap=[];
for(let iteration=0;iteration<10000;iteration++){
 let sum=0,count=0;
 for(const b of final.boards){assert.equal(b.pairScores.length,4);for(let i=0;i<4;i++){sum+=b.pairScores[Math.floor(random()*4)];count++;}}
 bootstrap.push(sum/count);
}
bootstrap.sort((a,b)=>a-b);
const candidates=['candidate-a','candidate-b','candidate-c'].map(name=>{
 const m=read(name+'-manifest.json');
 return {name,sha256:m.sha256,selectedEpoch:m.selectedEpoch,trainable:m.trainable,
  initial:m.initialValidationMetrics,selected:m.validationMetrics,bySource:m.validationBySource};
});
const promoted=final.score>=30&&final.boards.every(b=>b.score>=2)&&final.capped===0;
console.log(JSON.stringify({candidates,development:{a:match('development-match.json'),b:match('development-match-b.json'),
 c:{selectedEpoch:0,identicalToBaseline:true,partialMatchExcluded:true}},final,
 pairedBootstrap:{seed:20261251,iterations:10000,stratifiedByBoard:true,unit:'colour-swapped opening pair',
  interval95:[bootstrap[249],bootstrap[9749]],condition:'Descriptive interval for this fixed opponent and search budget; six fixed boards, 24 opening pairs.'},
 promoted,baselineRetained:!promoted},null,2));
