import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {matchStatistics} from './match-statistics.mjs';
const pairScores=Array.from({length:10},(_,p)=>p<5?0:1);
const games=pairScores.flatMap((score,pair)=>[1,2].map(aColor=>({pair,aColor,aScore:score,ended:true})));
const report={boards:[{kind:'torus',size:7,games,pairScores}]};
const actual=matchStatistics(report,{seed:42});
assert.equal(actual.scoreRate,.5);assert.equal(actual.wins,10);assert.equal(actual.losses,10);
assert.deepEqual(actual.pairedBootstrap.interval95,[.2,.8]);
assert.deepEqual(actual,matchStatistics(report,{seed:42}));
const invalid=structuredClone(report);invalid.boards[0].pairScores[0]=1;
assert.throws(()=>matchStatistics(invalid));
const capped=structuredClone(report);capped.boards[0].games[0].ended=false;capped.boards[0].games[0].aScore=null;
assert.equal(matchStatistics(capped).capped,1);assert.equal(matchStatistics(capped).pairedBootstrap,undefined);
writeFileSync('experiments/ai/v3/2026-10-22-learning-revision/data/statistics-verification.json',JSON.stringify({schemaVersion:1,
 pairedSampling:true,deterministic:true,inconsistentPairsRejected:true,cappedMatchesNotBootstrapped:true},null,2)+'\n');
console.log('Paired bootstrap, deterministic summaries, inconsistent-pair and cap checks passed.');
