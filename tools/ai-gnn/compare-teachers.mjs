// Compare frozen input rows and teacher shapes; this does not select a model.
import assert from 'node:assert/strict';
import {createReadStream,writeFileSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
const prefix=process.argv[2]??'experiments/ai/v3/2026-10-22-learning-revision/data/round1';
const streams=[0,1,2].map(k=>createInterface({input:createReadStream(prefix+'-t'+k+'.jsonl.gz').pipe(createGunzip()),crlfDelay:Infinity})[Symbol.asyncIterator]());
const hashes=[0,1,2].map(()=>createHash('sha256')),groups={};let positions=0,selected=0;
const invariant=['gameId','positionId','ply','action','playedAction','x','global','legal','wdl','score','ownership','policyEligible','decisionReason'];
const disjointMaxima=(a,b)=>{const x=Math.max(...a),y=Math.max(...b);return!a.some((v,p)=>v===x&&b[p]===y);};
for(;;){
 const lines=await Promise.all(streams.map(s=>s.next()));assert.ok(lines.every(l=>l.done===lines[0].done));if(lines[0].done)break;
 const rows=lines.map(l=>JSON.parse(l.value)),r=rows[0];positions++;
 rows.forEach((row,i)=>hashes[i].update(JSON.stringify(invariant.map(k=>row[k]))+'\n'));
 if(!r.policyEligible)continue;selected++;
 assert.notEqual(r.decisionReason,'certified-loss');
 for(const row of rows){
  assert.deepEqual(row.validationPolicy,rows[2].policy);
  assert.ok(row.policy.every((v,p)=>Number.isFinite(v)&&v>=0&&(row.legal[p]||v===0)));
  assert.ok(Math.abs(row.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
 }
 const n=r.x.length/32,phase=r.ply<n/2?'opening':r.ply<n?'middle':'late';
 for(const key of['all',phase,r.kind+r.size]){
  const g=groups[key]??={positions:0,rawVsNoiseFreeDisagreements:0,noiseFree128Vs512Disagreements:0,
   recipes:[0,1,2].map(recipe=>({recipe,entropy:0,maxProbability:0,support:0,lowConfidence:0}))};
  g.positions++;
  g.rawVsNoiseFreeDisagreements+=Number(disjointMaxima(rows[0].policy,rows[1].policy));
  g.noiseFree128Vs512Disagreements+=Number(disjointMaxima(rows[1].policy,rows[2].policy));
  rows.forEach((row,i)=>{const p=row.policy,s=g.recipes[i];s.entropy-=p.reduce((a,v)=>a+(v>0?v*Math.log(v):0),0);s.maxProbability+=Math.max(...p);s.support+=p.filter(v=>v>0).length;s.lowConfidence+=Number(Math.max(...p)<.25);});
 }
}
const sums=hashes.map(h=>h.digest('hex'));assert.ok(sums.every(s=>s===sums[0]));
for(const g of Object.values(groups))for(const recipe of g.recipes)for(const key of['entropy','maxProbability','support','lowConfidence'])recipe[key]/=g.positions;
const report={schemaVersion:1,role:'Teacher-shape diagnostics on identical roots; no model selection',positions,selected,sharedInputOutcomeAndEligibilitySha256:sums[0],groups};
writeFileSync(prefix+'-teacher-comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({positions,selected,groups}));
