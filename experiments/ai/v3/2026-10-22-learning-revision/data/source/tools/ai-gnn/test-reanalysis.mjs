import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const prefix=process.argv[2]??'tools/ai-gnn/target/learning-revision/preflight';
const recipes=[0,1,2].map(k=>gunzipSync(readFileSync(prefix+'-t'+k+'.jsonl.gz')).toString('utf8').trim().split('\n').map(JSON.parse));
let selected=0;
for(let i=0;i<recipes[0].length;i++){
 const rows=recipes.map(r=>r[i]),base=rows[0];
 for(const row of rows){
  for(const key of ['gameId','positionId','ply','action','playedAction','wdl','score','ownership','x','global','legal','policyEligible'])assert.deepEqual(row[key],base[key],key);
  assert.ok(row.policy.every(v=>Number.isFinite(v)&&v>=0));assert.ok(Math.abs(row.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
  assert.ok(row.policy.every((v,p)=>row.legal[p]||v===0));
 }
 if(base.policyEligible){
  selected++;assert.notEqual(base.decisionReason,'certified-loss');
  for(const row of rows)assert.deepEqual(row.validationPolicy,rows[2].policy,'Common teacher must be identical across recipes');
  for(const [row,budget]of[[rows[1],128],[rows[2],512]]){
   assert.equal(row.targetSearch.noise,false);assert.equal(row.targetSearch.requestedVisits,budget);
   assert.ok(row.targetSearch.completedVisits>=budget);
   assert.equal(row.targetSearch.diagnostics.rawVisits.reduce((a,b)=>a+b,0),row.targetSearch.completedVisits-1);
  }
 }
}
assert.ok(selected>0);
const report={schemaVersion:1,role:'Preflight only; not used in study training or model selection',positions:recipes[0].length,selected,
 samePositionsAndOutcomes:true,commonValidationTargetsIdentical:true,policyTargetsNormalizedAndLegal:true,searchBudgetsVerified:true};
writeFileSync('experiments/ai/v3/2026-10-22-learning-revision/data/reanalysis-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
