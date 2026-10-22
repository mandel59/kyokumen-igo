import assert from 'node:assert/strict';
import {createReadStream,readFileSync,writeFileSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
const data='experiments/ai/v3/2026-10-22-learning-revision/data';
const audit=JSON.parse(readFileSync(data+'/teacher-target-audit.json','utf8')),blocked=new Set(audit.blockedPositionIds);
const iterator=path=>createInterface({input:createReadStream(path).pipe(createGunzip()),crlfDelay:Infinity})[Symbol.asyncIterator]();
const before=iterator(data+'/teacher-annotated-unfiltered.jsonl.gz'),after=iterator(data+'/teacher-annotated.jsonl.gz');
const hashes=[createHash('sha256'),createHash('sha256')];let positions=0,exclusions=0;
const keys=['gameId','positionId','ply','playedAction','x','global','legal','action','policy','ownership','wdl','score','decisionReason'];
for(;;){
 const [a,b]=await Promise.all([before.next(),after.next()]);assert.equal(a.done,b.done);if(a.done)break;
 const rows=[JSON.parse(a.value),JSON.parse(b.value)];
 rows.forEach((r,i)=>hashes[i].update(JSON.stringify(keys.map(k=>r[k]))+'\n'));
 if(blocked.has(rows[0].positionId)){
  assert.equal(rows[0].policyEligible,true);assert.equal(rows[1].policyEligible,false);
  assert.equal(rows[1].policyExclusionReason,'rule-masked-teacher-target');exclusions++;
 }else assert.equal(rows[1].policyEligible,rows[0].policyEligible);
 positions++;
}
const sums=hashes.map(h=>h.digest('hex'));assert.equal(sums[0],sums[1]);assert.equal(exclusions,160);assert.equal(positions,16365);
const report={schemaVersion:1,positions,policyOnlyExclusions:exclusions,featuresMovesAndAllOutcomeLabelsUnchanged:true,coreContentSha256:sums[0]};
writeFileSync(data+'/preprocessing-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
