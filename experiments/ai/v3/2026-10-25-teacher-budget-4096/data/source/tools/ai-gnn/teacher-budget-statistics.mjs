import assert from 'node:assert/strict';
import {matchStatistics} from './match-statistics.mjs';
// The two tails are exact rational1/40 and1/80; avoid binary rounding at order-statistic boundaries.
export function bootstrapInterval(samples,tailDenominator){
 assert.ok(samples.length&&Number.isInteger(tailDenominator)&&tailDenominator>2);
 return[samples[Math.ceil(samples.length/tailDenominator)-1],samples[Math.ceil(samples.length*(tailDenominator-1)/tailDenominator)-1]];
}
export function teacherBudgetStatistics(report,{seed=2026102667,iterations=20000}={}){
 const result=matchStatistics(report,{seed,iterations}),boards=report.boards;
 assert.equal(result.capped,0);assert.ok(boards.every(b=>b.pairScores.length>=2));
 let state=seed>>>0||1;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;},samples=[];
 for(let k=0;k<iterations;k++){let score=0,count=0;for(const b of boards)for(let j=0;j<b.pairScores.length;j++){score+=b.pairScores[Math.floor(random()*b.pairScores.length)];count++;}samples.push(score/count);}
 samples.sort((a,b)=>a-b);
 const interval95=bootstrapInterval(samples,40),interval97_5=bootstrapInterval(samples,80);assert.deepEqual(interval95,result.pairedBootstrap.interval95);
 return{...result,pairedBootstrap:{...result.pairedBootstrap,interval97_5,multiplicity:'Bonferroni two candidates, familywise95% approximate percentile-bootstrap coverage'}};
}
