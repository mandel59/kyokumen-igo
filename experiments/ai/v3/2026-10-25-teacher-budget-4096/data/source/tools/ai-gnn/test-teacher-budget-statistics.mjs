import assert from 'node:assert/strict';
import {bootstrapInterval,teacherBudgetStatistics} from './teacher-budget-statistics.mjs';
const ordered=Array.from({length:20000},(_,i)=>i);
assert.deepEqual(bootstrapInterval(ordered,40),[499,19499]);assert.deepEqual(bootstrapInterval(ordered,80),[249,19749]);
assert.deepEqual(bootstrapInterval(Array.from({length:40},(_,i)=>i),40),[0,38]);
const report=pairScores=>({boards:[{kind:'sphere',size:3,pairScores,games:pairScores.flatMap((score,pair)=>[1,2].map(aColor=>({pair,aColor,ended:true,aScore:score})))}]});
for(const score of [0,.5,1]){const r=teacherBudgetStatistics(report(Array(8).fill(score)),{seed:17,iterations:40});assert.deepEqual(r.pairedBootstrap.interval95,[score,score]);assert.deepEqual(r.pairedBootstrap.interval97_5,[score,score]);}
const mixed=report([0,.5,1,0,1,.5,0,1]),left=teacherBudgetStatistics(mixed),right=teacherBudgetStatistics(mixed);assert.deepEqual(left,right);assert.ok(left.pairedBootstrap.interval97_5[0]<=left.pairedBootstrap.interval95[0]);assert.ok(left.pairedBootstrap.interval97_5[1]>=left.pairedBootstrap.interval95[1]);
assert.throws(()=>teacherBudgetStatistics({boards:[{kind:'sphere',size:3,pairScores:[0,0],games:[{pair:0,aColor:1,ended:false,aScore:null}]}]}));
console.log('Teacher budget statistics: exact percentile ranks, point masses, reproducibility, wider multiplicity interval, incomplete-report rejection passed.');
