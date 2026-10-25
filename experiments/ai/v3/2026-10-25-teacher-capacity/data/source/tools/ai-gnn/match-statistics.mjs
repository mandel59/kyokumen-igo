import assert from 'node:assert/strict';
export function matchStatistics(report,{seed=2026102251,iterations=10000}={}){
 assert.ok(Number.isInteger(seed)&&Number.isInteger(iterations)&&iterations>=2);
 const games=report.boards.flatMap(b=>b.games),completed=games.filter(g=>g.ended),capped=games.length-completed.length;
 const boards=report.boards.map(b=>({board:b.kind+b.size,games:b.games.length,
  score:b.games.reduce((s,g)=>s+(g.aScore??0),0),pairScores:b.pairScores}));
 const result={games:games.length,completed:completed.length,capped,
  wins:completed.filter(g=>g.aScore===1).length,draws:completed.filter(g=>g.aScore===.5).length,
  losses:completed.filter(g=>g.aScore===0).length,score:completed.reduce((s,g)=>s+g.aScore,0),boards};
 result.scoreRate=completed.length?result.score/completed.length:null;
 if(!capped&&games.length&&boards.every(b=>b.pairScores.length>=2)){
  let state=seed>>>0||1;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const samples=[];
  for(const [i,b]of boards.entries()){
   assert.ok(b.pairScores.every(p=>Number.isFinite(p)&&p>=0&&p<=1));assert.equal(b.pairScores.length*2,b.games);
   for(let p=0;p<b.pairScores.length;p++)assert.equal(report.boards[i].games.filter(g=>g.pair===p).reduce((s,g)=>s+g.aScore,0)/2,b.pairScores[p]);
  }
  for(let i=0;i<iterations;i++){
   let score=0,count=0;
   for(const b of boards)for(let j=0;j<b.pairScores.length;j++){score+=b.pairScores[Math.floor(random()*b.pairScores.length)];count++;}
   samples.push(score/count);
  }
  samples.sort((a,b)=>a-b);
  result.pairedBootstrap={seed,iterations,unit:'colour-swapped opening pair',stratifiedByBoard:true,
   interval95:[samples[Math.ceil(iterations*.025)-1],samples[Math.ceil(iterations*.975)-1]]};
 }
 return result;
}
